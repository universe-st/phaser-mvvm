/**
 * `detectRenderScale` / `quantizeTextResolution`: how big one layout unit is on the glass, and what
 * resolution a glyph texture should therefore be baked at.
 *
 * The module is Phaser-free at runtime (structural reads only), so these cases run in plain Node — no
 * DOM stub, no renderer. What they pin down is the arithmetic that the browser acceptance cannot state
 * as a number: a 450×900 `FIT` design on a 2× display is 1.504 device pixels per layout unit, which is
 * why a 1× glyph texture reaches the screen upsampled by 1.5.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { detectRenderScale, quantizeTextResolution } from '../src/render-scale';

interface ScaleStub {
  gameSize: { width: number; height: number };
  displaySize: { width: number; height: number };
  on: (event: string, handler: () => void) => void;
  resized: () => void;
}

/** A scene with just the surface the module reads: `scale`, and optionally a canvas rectangle. */
function stubScene(options: { gameSize?: number; cssWidth?: number; withCanvas?: boolean } = {}) {
  const gameSize = options.gameSize ?? 450;
  const listeners = new Map<string, Set<() => void>>();
  const scale: ScaleStub = {
    gameSize: { width: gameSize, height: gameSize * 2 },
    displaySize: { width: gameSize, height: gameSize * 2 },
    on: (event, handler) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    },
    resized: () => {
      for (const handler of listeners.get('resize') ?? []) {
        handler();
      }
    },
  };
  let reads = 0;
  const canvas =
    options.withCanvas === false
      ? null
      : {
          getBoundingClientRect: () => {
            reads += 1;
            return { width: options.cssWidth ?? gameSize };
          },
        };
  return {
    scene: { scale, game: { canvas } } as unknown as Parameters<typeof detectRenderScale>[0],
    scale,
    canvasReads: () => reads,
  };
}

/** The module reads the global, which Node does not define. */
function setDpr(value: number | undefined): void {
  if (value === undefined) {
    delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    return;
  }
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = value;
}

afterEach(() => setDpr(undefined));

describe('detectRenderScale', () => {
  it('is the device ratio times the canvas-to-game ratio', () => {
    setDpr(2);
    // The measured case: a 450×900 design scaled down to 338.5 CSS pixels on a 2× display, which the
    // browser then upscales to 677 device pixels.
    const { scene } = stubScene({ cssWidth: 338.5 });
    expect(detectRenderScale(scene)).toBeCloseTo(1.504, 3);
  });

  it('is 1 when the canvas and the game size agree on a plain display', () => {
    setDpr(1);
    const { scene } = stubScene({ cssWidth: 1280, gameSize: 1280 });
    expect(detectRenderScale(scene)).toBe(1);
  });

  it('falls back to Phaser’s display size when there is no canvas rectangle', () => {
    setDpr(2);
    const { scene, scale } = stubScene({ withCanvas: false });
    scale.displaySize = { width: 225, height: 450 };
    expect(detectRenderScale(scene)).toBe(1);
    scale.displaySize = { width: 900, height: 1800 };
    scale.resized();
    expect(detectRenderScale(scene)).toBe(4);
  });

  it('is 1 when nothing can be measured', () => {
    setDpr(2);
    expect(detectRenderScale(undefined)).toBe(1);
    expect(detectRenderScale({} as Parameters<typeof detectRenderScale>[0])).toBe(1);
    const { scene } = stubScene({ gameSize: 0 });
    expect(detectRenderScale(scene)).toBe(1);
  });

  it('divides by the layout space, not the game size, when the two differ', () => {
    setDpr(2);
    // The device-resolution shape: a 780-CSS-pixel canvas over a 900-unit game whose page lays out 450
    // design units with a camera zoomed 2×. One *design* unit is 780/450 CSS pixels, so glyphs have to be
    // baked at 3.47 — measuring against the game size would say 1.73 and leave the text soft.
    const { scene } = stubScene({ cssWidth: 780, gameSize: 900 });
    expect(detectRenderScale(scene)).toBeCloseTo(1.733, 3);
    expect(detectRenderScale(scene, 450)).toBeCloseTo(3.467, 3);
    // Switching back is not a stale hit either: the cache remembers which width produced the value.
    expect(detectRenderScale(scene)).toBeCloseTo(1.733, 3);
  });

  it('measures once, and measures again after the scale manager reports a resize', () => {
    setDpr(2);
    const { scene, scale, canvasReads } = stubScene({ cssWidth: 338.5 });
    expect(detectRenderScale(scene)).toBeCloseTo(1.504, 3);
    expect(detectRenderScale(scene)).toBeCloseTo(1.504, 3);
    // One DOM query for a whole UI build: a label asks per text object, and `getBoundingClientRect` is
    // the only thing here that touches the document.
    expect(canvasReads()).toBe(1);

    scale.resized();
    expect(detectRenderScale(scene)).toBeCloseTo(1.504, 3);
    // A resize is exactly the event that can move the ratio (`Scale.FIT` zoom), so the cache drops.
    expect(canvasReads()).toBe(2);
  });
});

describe('quantizeTextResolution', () => {
  it('rounds to a half step, never below 1', () => {
    expect(quantizeTextResolution(1.504)).toBe(1.5);
    expect(quantizeTextResolution(1.3)).toBe(1.5);
    expect(quantizeTextResolution(1.2)).toBe(1);
    expect(quantizeTextResolution(2)).toBe(2);
  });

  it('caps the automatic value at 2, because texture area grows with the square', () => {
    expect(quantizeTextResolution(2.625)).toBe(2);
    expect(quantizeTextResolution(3)).toBe(2);
  });

  it('treats nonsense as 1', () => {
    expect(quantizeTextResolution(0)).toBe(1);
    expect(quantizeTextResolution(-2)).toBe(1);
    expect(quantizeTextResolution(Number.NaN)).toBe(1);
    expect(quantizeTextResolution(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
