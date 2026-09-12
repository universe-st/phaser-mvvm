/**
 * Tests for `ProceduralSkin`.
 *
 * The skin only ever talks to a `Graphics` object, so a recording stub is enough to pin down *which*
 * drawing calls a state produces. That matters for the square-corner case: Phaser 4's `fillRect` is an
 * immediate fill command that opens no path, so a border drawn as "fill a square, then `strokePath()`"
 * silently paints nothing — the regression this file guards against.
 */

import { describe, expect, it } from 'vitest';
import { ProceduralSkin } from '../src/skin';

interface GraphicsStub {
  graphics: Phaser.GameObjects.Graphics;
  calls: string[];
}

function stubGraphics(): GraphicsStub {
  const calls: string[] = [];
  const graphics = {
    clear() {
      calls.push('clear');
      return graphics;
    },
    fillStyle() {
      calls.push('fillStyle');
      return graphics;
    },
    lineStyle(width: number) {
      calls.push(`lineStyle(${width})`);
      return graphics;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push(`fillRect(${x},${y},${w},${h})`);
      return graphics;
    },
    fillRoundedRect(x: number, y: number, w: number, h: number, radius: number) {
      calls.push(`fillRoundedRect(${x},${y},${w},${h},${radius})`);
      return graphics;
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push(`strokeRect(${x},${y},${w},${h})`);
      return graphics;
    },
    strokeRoundedRect(x: number, y: number, w: number, h: number, radius: number) {
      calls.push(`strokeRoundedRect(${x},${y},${w},${h},${radius})`);
      return graphics;
    },
    fillPath() {
      calls.push('fillPath');
      return graphics;
    },
    strokePath() {
      calls.push('strokePath');
      return graphics;
    },
  } as unknown as Phaser.GameObjects.Graphics;

  return { graphics, calls };
}

describe('ProceduralSkin', () => {
  it('strokes the border of a square-cornered state instead of a no-op fillPath/strokePath pair', () => {
    const skin = new ProceduralSkin({ normal: { fill: 'surface', border: 'border', radius: 0 } });
    const { graphics, calls } = stubGraphics();

    skin.paint(graphics, 100, 40, 'normal');

    expect(calls).toContain('fillRect(0,0,100,40)');
    // The border is half a pixel inside, because a stroke straddles the path.
    expect(calls).toContain('strokeRect(0.5,0.5,99,39)');
    expect(calls).not.toContain('strokePath');
  });

  it('strokes a rounded border with the inset radius', () => {
    const skin = new ProceduralSkin({ normal: { fill: 'surface', border: 'border', radius: 8 } });
    const { graphics, calls } = stubGraphics();

    skin.paint(graphics, 100, 40, 'normal');

    expect(calls).toContain('fillRoundedRect(0,0,100,40,8)');
    expect(calls).toContain('strokeRoundedRect(0.5,0.5,99,39,7.5)');
  });

  it('skips the border when the state asks for none', () => {
    const skin = new ProceduralSkin({ normal: { fill: 'primary', border: null } });
    const { graphics, calls } = stubGraphics();

    skin.paint(graphics, 100, 40, 'normal');

    expect(calls.some((call) => call.startsWith('stroke'))).toBe(false);
  });
});
