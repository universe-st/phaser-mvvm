/**
 * `UIRootOptions.designResolution` — the layout space, when the game is bigger than it.
 *
 * A game that renders at device resolution sizes its game at `design × devicePixelRatio` and zooms its
 * camera by the same factor, so one design pixel covers several *buffer* pixels instead of being
 * upsampled by the browser afterwards (V79). What must not change is the page's coordinate space: the
 * root still lays out 450×900, widgets still measure in those units, and the only difference is that the
 * buffer can now represent half-pixel positions — which is what `layoutEngine.dpr` follows.
 *
 * The fake scene carries just enough `scale` for the root: `gameSize`, `displaySize` and `on`. Safe
 * area is switched off in every case, because the fixture has no document to measure insets from — the
 * inset *conversion* under a design resolution is covered by the live acceptance run instead.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { asScene, createFakeScene, installDomStub, type FakeScene } from './support/fake-renderer';

installDomStub();

type UIRootModule = typeof import('../src/UIRoot');

let UIRootClass: UIRootModule['UIRoot'];

beforeAll(async () => {
  UIRootClass = (await import('../src/UIRoot')).UIRoot;
});

/** A fake scene whose scale manager reports the given game and display sizes. */
function sceneWithScale(gameWidth: number, gameHeight: number): FakeScene {
  const scene = createFakeScene() as FakeScene & { scale?: unknown };
  scene.scale = {
    gameSize: { width: gameWidth, height: gameHeight },
    displaySize: { width: gameWidth / 2, height: gameHeight / 2 },
    on: () => undefined,
    off: () => undefined,
  };
  return scene;
}

describe('the layout space', () => {
  it('follows the game size by default, and snaps on whole units', () => {
    const root = new UIRootClass(asScene(sceneWithScale(450, 900)), { safeArea: false });
    expect(root.layoutSize).toEqual({ width: 450, height: 900 });
    expect(root.layoutScale).toBe(1);
    expect(root.layoutEngine.dpr).toBe(1);
  });

  it('is the design resolution when the game renders bigger, and snaps on the buffer grid', () => {
    // The device-resolution shape: a 450×900 design rendered into a 900×1800 game, camera zoom 2.
    const root = new UIRootClass(asScene(sceneWithScale(900, 1800)), {
      designResolution: { width: 450, height: 900 },
      safeArea: false,
    });
    expect(root.layoutSize).toEqual({ width: 450, height: 900 });
    // Two game units — and therefore two buffer pixels — cover one layout unit…
    expect(root.layoutScale).toBe(2);
    // …so half-unit positions are exactly representable and are the grid a rect should land on.
    expect(root.layoutEngine.dpr).toBe(2);
    expect(root.layoutEngine.snapMode).toBe('round');
  });

  it('keeps an explicit snap grid when the caller sets one', () => {
    const root = new UIRootClass(asScene(sceneWithScale(900, 1800)), {
      designResolution: { width: 450, height: 900 },
      dpr: 1,
      snapMode: 'floor',
      safeArea: false,
    });
    expect(root.layoutEngine.dpr).toBe(1);
    expect(root.layoutEngine.snapMode).toBe('floor');
  });

  it('re-sizes to the design resolution on a scale resize, not to the game size', () => {
    const scene = sceneWithScale(900, 1800);
    const root = new UIRootClass(asScene(scene), {
      designResolution: { width: 450, height: 900 },
      safeArea: false,
    });
    // A device rotation keeps the same design and magnifies differently; the layout must not follow the
    // game size into a 1800×900 space.
    (
      scene as unknown as { scale: { gameSize: { width: number; height: number } } }
    ).scale.gameSize = {
      width: 1800,
      height: 900,
    };
    root.resize();
    expect(root.layoutSize).toEqual({ width: 450, height: 900 });
    expect(root.layoutScale).toBe(4);
    expect(root.layoutEngine.dpr).toBe(4);
  });

  it('ignores a nonsense design resolution instead of laying out nothing', () => {
    const root = new UIRootClass(asScene(sceneWithScale(450, 900)), {
      designResolution: { width: 0, height: 900 },
      safeArea: false,
    });
    expect(root.layoutSize).toEqual({ width: 450, height: 900 });
    expect(root.layoutScale).toBe(1);
  });
});
