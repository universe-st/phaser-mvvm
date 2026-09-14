/**
 * `Widget#textResolution` — the ratio widgets bake their text textures at.
 *
 * The bug this closes: `Phaser.GameObjects.Text` rasterises its glyphs **once**, into a canvas texture,
 * at the font size in layout units. A display denser than the drawing buffer therefore only ever gets
 * to upsample that texture, which is the blur a 450×900 `Scale.FIT` design showed on a 2× screen —
 * `devicePixelRatio × (canvas CSS width ÷ game size)` = 1.504 there, so the glyphs reached the glass
 * magnified 1.5× (V79). The camera cannot fix that after the fact, and neither can a bigger buffer.
 *
 * What is pinned here is the *policy and the wiring*: the measured ratio, the quantisation, the app's
 * override and the fallback. Whether the extra pixels actually reach the canvas is a browser
 * assertion (the texture's width is the observable, and `Phaser.GameObjects.Text` cannot be built
 * without a real texture manager — see `test/support/fake-renderer.ts`, which deliberately stops at
 * the display list); `scripts/visual-check.mjs` and the acceptance runs are where that is checked.
 *
 * Order matters: `installDomStub()` before Phaser is imported (ESM hoists static imports).
 */

import { beforeAll, describe, expect, it, afterEach } from 'vitest';
import { asScene, createFakeScene, installDomStub, type FakeScene } from './support/fake-renderer';

installDomStub();

/** Exposes the protected getter the widgets package reads through inheritance. */
let ProbeClass: new (scene: Phaser.Scene) => { resolution(): number };

beforeAll(async () => {
  const { Widget } = await import('../src/Widget');
  // A class *expression*: `extends Widget` has to see the value, and ESM hoists a class declaration
  // above the dynamic import that produces it.
  ProbeClass = class Probe extends Widget {
    resolution(): number {
      return this.textResolution;
    }
  };
});

interface SceneExtras {
  scale?: unknown;
  game?: unknown;
  mvvm?: { textResolution?: number };
}

/** A fake scene with exactly the surface `detectRenderScale` reads. */
function probe(
  options: {
    cssWidth?: number;
    gameSize?: number;
    textResolution?: number;
    withSurface?: boolean;
  } = {},
): { resolution(): number } {
  const scene = createFakeScene() as FakeScene & SceneExtras;
  const gameSize = options.gameSize ?? 450;
  if (options.withSurface !== false) {
    scene.scale = {
      gameSize: { width: gameSize, height: gameSize * 2 },
      displaySize: { width: gameSize, height: gameSize * 2 },
      on: () => undefined,
    };
    scene.game = {
      canvas: { getBoundingClientRect: () => ({ width: options.cssWidth ?? gameSize }) },
    };
  }
  if (options.textResolution !== undefined) {
    // The plugin's getter, reduced to the one reading a widget makes of it.
    scene.mvvm = { textResolution: options.textResolution };
  }
  return new ProbeClass(asScene(scene));
}

afterEach(() => {
  delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
});

describe('the ratio text is baked at', () => {
  it('is the display’s own ratio, quantised — 1.5 for a 450-wide design shown at 338.5 CSS pixels', () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    expect(probe({ cssWidth: 338.5 }).resolution()).toBe(1.5);
  });

  it('stays 1 when the canvas already matches the game size on a plain display', () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 1;
    expect(probe({ cssWidth: 1280, gameSize: 1280 }).resolution()).toBe(1);
  });

  it('caps the automatic value at 2, because texture area grows with the square', () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 3;
    expect(probe({ cssWidth: 450 }).resolution()).toBe(2);
  });

  it('takes the app’s own value when it set one, uncapped', () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    expect(probe({ cssWidth: 338.5, textResolution: 1 }).resolution()).toBe(1);
    expect(probe({ cssWidth: 338.5, textResolution: 3 }).resolution()).toBe(3);
  });

  it('falls back to the measured ratio when the scene has no plugin', () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    expect(probe({ cssWidth: 338.5 }).resolution()).toBe(1.5);
  });

  it('is 1 where nothing can be measured — a bare scene, as in a unit test', () => {
    (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
    expect(probe({ withSurface: false }).resolution()).toBe(1);
  });
});
