/**
 * Helpers shared by the demo scenes.
 *
 * `setDemoState` writes `key=value` pairs into a dedicated DOM node so an interactive check
 * (Playwright, or the CDP script) can assert on application state — not just on pixels.
 */

import { stagePosition, type Reportable } from './status';

const state = new Map<string, string | number | boolean>();

function element(): HTMLElement | null {
  return document.getElementById('demo-state');
}

function render(): void {
  const el = element();
  if (!el) {
    return;
  }
  // `key=value` pairs joined by a space: compact and easy to grep. A *value* containing a space is
  // therefore ambiguous to a naive parser (`field.text=round seven` reads as two pairs), so a check that
  // needs such a value must ask the scene directly (`window.<scene>.state()`) instead of parsing this
  // node - the scenes that publish free text expose exactly that.
  el.textContent = Array.from(state.entries())
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}

/** Records a state value and renders the whole state line. */
export function setDemoState(key: string, value: string | number | boolean): void {
  state.set(key, value);
  render();
}

/** Reads back a recorded state value (used by in-page assertions). */
export function getDemoState(key: string): string | number | boolean | undefined {
  return state.get(key);
}

/**
 * Records the centre of a widget in **page** coordinates (`pt.<key>=@x,y`) so an interactive check
 * can click it: the canvas is not necessarily at the page origin (Phaser may centre it).
 */
export function reportControl(
  scene: Phaser.Scene,
  key: string,
  widget: Reportable & { appliedRect: { width: number; height: number } },
): void {
  const canvas = scene.game.canvas.getBoundingClientRect();
  const origin = stagePosition(widget);
  const x = Math.round(canvas.left + origin.x + widget.appliedRect.width / 2);
  const y = Math.round(canvas.top + origin.y + widget.appliedRect.height / 2);
  setDemoState(`pt.${key}`, `@${x},${y}`);
}

/**
 * Creates a procedural texture with `Graphics.generateTexture` (Phaser 4 removed the old
 * `Create.GenerateTexture` / `TextureManager.generate` helpers), so the demos need no art assets.
 */
export function makeTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (graphics: Phaser.GameObjects.Graphics) => void,
): string {
  if (scene.textures.exists(key)) {
    return key;
  }
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(graphics);
  graphics.generateTexture(key, width, height);
  graphics.destroy();
  return key;
}

/** A soft two-tone tile, handy for the `Image` widget demo. */
export function makeTileTexture(scene: Phaser.Scene, key: string, size = 64): string {
  return makeTexture(scene, key, size, size, (graphics) => {
    graphics.fillStyle(0x2f6feb, 1);
    graphics.fillRect(0, 0, size, size);
    graphics.fillStyle(0x3fb950, 1);
    graphics.fillTriangle(0, size, size, size, size, 0);
    graphics.lineStyle(2, 0xffffff, 0.6);
    graphics.strokeRect(1, 1, size - 2, size - 2);
  });
}
