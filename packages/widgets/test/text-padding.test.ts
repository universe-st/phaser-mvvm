/**
 * `glyphPadding` / `fontSizeOf`: the allowance that keeps descenders inside Phaser's text canvas.
 *
 * Found from a user report ("the tail of the `g` is cut off" in the tone labels): Phaser sizes the
 * canvas to the measured `ascent + descent` (14.6 + 3.0 = 17.6 at 16px) and assigning that fractional
 * number to `canvas.height` truncates it, so rasterised glyphs a fraction of a pixel taller than the
 * metrics lose their tail - and the label reported that clipped height to the layout too.
 */

import { describe, expect, it } from 'vitest';
import { fontSizeOf, glyphPadding } from '../src/text-padding';

describe('glyphPadding', () => {
  it('covers the canvas truncation at the theme font size', () => {
    // 16px is `theme.fontSize.md`: the measured 17.6px box is truncated to 17, so at least 1px is lost.
    expect(glyphPadding(16)).toBe(1);
  });

  it('scales with the font size, because the overshoot is a fraction of the em', () => {
    expect(glyphPadding(26)).toBe(2);
    expect(glyphPadding(64)).toBe(5);
  });

  it('never returns zero or a nonsense value', () => {
    expect(glyphPadding(0)).toBe(1);
    expect(glyphPadding(-4)).toBe(1);
    expect(glyphPadding(Number.NaN)).toBe(1);
    expect(glyphPadding(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('fontSizeOf', () => {
  it('reads a number style', () => {
    expect(fontSizeOf({ fontSize: 20 }, 16)).toBe(20);
  });

  it('reads a px string, which is how Phaser stores it after `setStyle`', () => {
    expect(fontSizeOf({ fontSize: '26px' }, 16)).toBe(26);
  });

  it('falls back for anything it cannot use', () => {
    expect(fontSizeOf(undefined, 16)).toBe(16);
    expect(fontSizeOf({}, 16)).toBe(16);
    expect(fontSizeOf({ fontSize: '1.2em' }, 16)).toBe(1.2);
    expect(fontSizeOf({ fontSize: 0 }, 16)).toBe(16);
    expect(fontSizeOf({ fontSize: 'large' }, 16)).toBe(16);
  });
});
