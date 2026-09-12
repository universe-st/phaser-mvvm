/**
 * Safe-area clamping.
 *
 * `readSafeAreaInsets()` needs a DOM, so what is tested here is the half that has a *right answer*: how
 * much of a viewport a set of insets is allowed to take. The values come from the browser, and the
 * browser does not know how small the UI box is about to become — a 44px camera strip is fine on a
 * 390×844 phone and absurd on a 390×120 landscape strip, where it would leave nothing to draw in.
 *
 * The clamping is deliberately independent per axis: a phone in landscape reports side insets of ~44
 * and a *bottom* inset of ~21, and each has to be measured against its own dimension.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_SAFE_AREA,
  SAFE_AREA_MAX_FRACTION,
  clampSafeArea,
  cssInsetsToDesign,
  insetsInsideCanvas,
  isZeroSafeArea,
} from '../src/safe-area';

const phone = { width: 390, height: 844 };

describe('insetsInsideCanvas', () => {
  const notch = { top: 47, bottom: 34, left: 0, right: 0 };
  const phone = { width: 390, height: 844 };

  it('keeps every inset when the canvas fills the viewport', () => {
    const canvas = { x: 0, y: 0, width: 390, height: 844 };
    expect(insetsInsideCanvas(notch, canvas, phone)).toEqual(notch);
  });

  it('drops an inset the letterbox keeps away from the canvas', () => {
    // `Scale.FIT` with a 980×614 design: the canvas is 390×244, centered 299px down. The camera strip
    // covers empty letterbox, so nothing is reserved.
    const canvas = { x: 0, y: 299, width: 390, height: 244 };
    expect(insetsInsideCanvas(notch, canvas, phone)).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it('keeps only the overlapping part when the canvas is partially under the cutout', () => {
    // The canvas starts 20px down: 27 of the 47px strip covers it.
    const canvas = { x: 0, y: 20, width: 390, height: 800 };
    expect(insetsInsideCanvas(notch, canvas, phone).top).toBe(27);
    // …and at the bottom the canvas ends at 820 while the 34px band runs 810…844: 10px overlap.
    expect(insetsInsideCanvas(notch, canvas, phone).bottom).toBe(10);
  });

  it('measures the side insets the same way', () => {
    // Landscape phone, notch on the left: the canvas sits 47px in and ends 37px before the right edge,
    // so 10 of the right band is over it and none of the left one.
    const landscape = { width: 844, height: 390 };
    const side = { top: 0, bottom: 0, left: 47, right: 47 };
    const canvas = { x: 47, y: 0, width: 760, height: 390 };
    const inside = insetsInsideCanvas(side, canvas, landscape);
    expect(inside.left).toBe(0);
    expect(inside.right).toBe(10);
  });

  it('keeps the full insets when there is no canvas to measure', () => {
    expect(insetsInsideCanvas(notch, null, phone)).toEqual(notch);
  });
});

describe('cssInsetsToDesign', () => {
  it('leaves the insets alone in the responsive mode', () => {
    // `Scale.RESIZE`: the canvas is displayed 1:1 with the game's coordinate space.
    expect(cssInsetsToDesign({ top: 47, bottom: 34, left: 0, right: 0 }, 1)).toEqual({
      top: 47,
      bottom: 34,
      left: 0,
      right: 0,
    });
  });

  it('scales a design-resolution canvas up into design pixels', () => {
    // A 980×614 design drawn into 390 CSS pixels wide: a 47px strip is 118 design pixels.
    const factor = 980 / 390;
    const insets = cssInsetsToDesign({ top: 47, bottom: 34, left: 0, right: 0 }, factor);
    expect(Math.round(insets.top)).toBe(118);
    expect(Math.round(insets.bottom)).toBe(85);
  });

  it('treats a nonsensical factor as 1 instead of producing NaN insets', () => {
    const raw = { top: 47, bottom: 34, left: 5, right: 5 };
    expect(cssInsetsToDesign(raw, 0)).toEqual(raw);
    expect(cssInsetsToDesign(raw, Number.NaN)).toEqual(raw);
    expect(cssInsetsToDesign(raw, -2)).toEqual(raw);
  });
});

describe('clampSafeArea', () => {
  it('keeps plausible phone insets as they are', () => {
    // iPhone-ish: a 47px camera strip and a 34px home indicator on a 844px-tall screen (12%).
    expect(clampSafeArea({ top: 47, bottom: 34, left: 0, right: 0 }, phone)).toEqual({
      top: 47,
      bottom: 34,
      left: 0,
      right: 0,
    });
  });

  it('clamps each axis against its own dimension', () => {
    // Landscape: side insets are the notch, so they are clamped against the *width*.
    const landscape = { width: 844, height: 390 };
    const insets = clampSafeArea({ top: 0, bottom: 21, left: 47, right: 47 }, landscape);
    expect(insets.left).toBe(47);
    expect(insets.bottom).toBe(21);

    // …and a 47px top inset on a 390-wide × 120-tall strip is reduced to a quarter of 120.
    const short = clampSafeArea({ top: 47, bottom: 47 }, { width: 390, height: 120 });
    expect(short.top).toBe(Math.floor(120 * SAFE_AREA_MAX_FRACTION));
    expect(short.bottom).toBe(30);
  });

  it('never takes more than a quarter of a dimension, per side', () => {
    const huge = clampSafeArea({ top: 4000, bottom: 4000, left: 4000, right: 4000 }, phone);
    expect(huge.top).toBe(Math.floor(844 / 4));
    expect(huge.left).toBe(Math.floor(390 / 4));
  });

  it('turns missing, negative and non-finite sides into zero', () => {
    expect(clampSafeArea(undefined, phone)).toEqual(NO_SAFE_AREA);
    expect(clampSafeArea(null, phone)).toEqual(NO_SAFE_AREA);
    expect(
      clampSafeArea({ top: -20, bottom: Number.NaN, left: Number.POSITIVE_INFINITY }, phone),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('reports zeros for a zero-sized box instead of clamping to something negative', () => {
    expect(clampSafeArea({ top: 44, bottom: 34 }, { width: 0, height: 0 })).toEqual(NO_SAFE_AREA);
  });

  it('is a no-op for the common case', () => {
    const none = clampSafeArea({ top: 0, bottom: 0, left: 0, right: 0 }, phone);
    expect(isZeroSafeArea(none)).toBe(true);
    expect(isZeroSafeArea(clampSafeArea({ top: 47, bottom: 34 }, phone))).toBe(false);
  });
});
