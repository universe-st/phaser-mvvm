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
  isZeroSafeArea,
} from '../src/safe-area';

const phone = { width: 390, height: 844 };

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
