/**
 * Colour packing and shading, plus the geometry helpers every widget shares.
 */

import { describe, expect, it } from 'vitest';
import { BLACK, shadeColor, toCssColor, WHITE } from '../src/color';
import { centeredOffset, centeredOffsetOverflow, contentBox } from '../src/geometry';

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
