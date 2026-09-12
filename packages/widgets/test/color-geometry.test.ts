/**
 * Colour packing and shading, plus the geometry helpers every widget shares.
 */

import { describe, expect, it } from 'vitest';
import { BLACK, shadeColor, toCssColor, WHITE } from '../src/color';
import { centeredOffset, centeredOffsetOverflow, contentBox, fitIcon } from '../src/geometry';

describe('toCssColor', () => {
  it('packs a colour into a six-digit hex string', () => {
    expect(toCssColor(0x2f6feb)).toBe('#2f6feb');
  });

  it('pads short values', () => {
    expect(toCssColor(0x0000ff)).toBe('#0000ff');
    expect(toCssColor(0)).toBe('#000000');
  });

  it('keeps the alpha channel out of the result', () => {
    expect(toCssColor(0xff112233)).toBe('#112233');
  });

  it('falls back to black for non-finite input', () => {
    expect(toCssColor(Number.NaN)).toBe('#000000');
  });
});

describe('shadeColor', () => {
  it('returns the colour unchanged for a zero amount', () => {
    expect(shadeColor(0x2f6feb, 0)).toBe(0x2f6feb);
  });

  it('lightens towards white', () => {
    expect(shadeColor(BLACK, 1)).toBe(WHITE);
    expect(shadeColor(0x808080, 0.5)).toBe(0xc0c0c0);
  });

  it('darkens towards black', () => {
    expect(shadeColor(WHITE, -1)).toBe(BLACK);
    expect(shadeColor(0x808080, -0.5)).toBe(0x404040);
  });

  it('keeps every channel inside the byte range', () => {
    expect(shadeColor(0xfefefe, 1)).toBe(WHITE);
    expect(shadeColor(0x010101, -1)).toBe(BLACK);
  });

  it('clamps an out-of-range amount', () => {
    expect(shadeColor(0x808080, 4)).toBe(WHITE);
    expect(shadeColor(0x808080, -4)).toBe(BLACK);
    expect(shadeColor(0x808080, Number.NaN)).toBe(0x808080);
  });
});

describe('contentBox', () => {
  it('insets the rect by the padding and keeps the coordinates local', () => {
    expect(contentBox(100, 50, { top: 4, right: 8, bottom: 4, left: 8 })).toEqual({
      x: 8,
      y: 4,
      width: 84,
      height: 42,
    });
  });

  it('never reports a negative size', () => {
    const box = contentBox(10, 10, { top: 20, right: 20, bottom: 20, left: 20 });
    expect(box.width).toBe(0);
    expect(box.height).toBe(0);
  });
});

describe('fitIcon', () => {
  it('leaves an icon that already fits alone', () => {
    // A 16 px glyph in a 36 px button is a choice, not a mistake: never scale it up.
    expect(fitIcon({ width: 16, height: 16 }, { width: 120, height: 36 })).toEqual({
      width: 16,
      height: 16,
    });
  });

  it('scales a too-large icon down, keeping its aspect ratio', () => {
    // The defect this exists for: the 64 px showcase tile in an `md` (36 px) button was drawn at 64.
    expect(fitIcon({ width: 64, height: 64 }, { width: 120, height: 36 })).toEqual({
      width: 36,
      height: 36,
    });
    expect(fitIcon({ width: 64, height: 32 }, { width: 40, height: 36 })).toEqual({
      width: 40,
      height: 20,
    });
  });

  it('reports no size at all when there is no room', () => {
    // The caller drops the icon instead of drawing it over the label.
    expect(fitIcon({ width: 64, height: 64 }, { width: 0, height: 36 })).toEqual({
      width: 0,
      height: 0,
    });
    expect(fitIcon({ width: 64, height: 64 }, { width: 120, height: -4 })).toEqual({
      width: 0,
      height: 0,
    });
    // An object with no size of its own (a `Container` icon) has nothing to fit either.
    expect(fitIcon({ width: 0, height: 0 }, { width: 120, height: 36 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe('centring offsets', () => {
  it('centres the inner box', () => {
    expect(centeredOffset(50, 100)).toBe(25);
    expect(centeredOffsetOverflow(50, 100)).toBe(25);
  });

  it('reports a negative offset for overflow, but a clamped zero for centring', () => {
    expect(centeredOffset(200, 100)).toBe(0);
    expect(centeredOffsetOverflow(200, 100)).toBe(-50);
  });
});
