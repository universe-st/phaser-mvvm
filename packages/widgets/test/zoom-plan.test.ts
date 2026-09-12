/**
 * Pinch-zoom maths: scale from the two-finger distance, and the offset that keeps the pinch anchored.
 *
 * The anchoring half is the part users notice: scaling without moving the offset zooms towards the
 * view's corner instead of towards the fingers, which reads as "broken" even though the scale is right.
 */

import { describe, expect, it } from 'vitest';
import {
  clampZoomOffset,
  pinchDistance,
  pinchMidpoint,
  pinchOffset,
  pinchScale,
} from '../src/zoom-plan';

describe('pinchDistance / pinchMidpoint', () => {
  it('measures the gap between two fingers', () => {
    expect(pinchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it('reports the point between them', () => {
    expect(pinchMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 5, y: 10 });
  });
});

describe('pinchScale', () => {
  it('scales with the distance ratio', () => {
    expect(pinchScale(1, 100, 200, 0.5, 3)).toBe(2);
    expect(pinchScale(1, 200, 100, 0.5, 3)).toBe(0.5);
    expect(pinchScale(2, 50, 75, 0.5, 3)).toBe(3);
  });

  it('clamps to the configured range', () => {
    expect(pinchScale(1, 100, 10_000, 0.5, 3)).toBe(3);
    expect(pinchScale(1, 100, 1, 0.5, 3)).toBe(0.5);
  });

  it('keeps the current scale instead of jumping to infinity', () => {
    // Fingers landing on the same pixel would divide by zero; a non-finite measurement is ignored too.
    expect(pinchScale(1.4, 0, 50, 0.5, 3)).toBe(1.4);
    expect(pinchScale(1.4, Number.NaN, 50, 0.5, 3)).toBe(1.4);
    expect(pinchScale(1.4, 100, Number.NaN, 0.5, 3)).toBe(1.4);
  });

  it('accepts a reversed min/max pair', () => {
    expect(pinchScale(1, 100, 10_000, 3, 0.5)).toBe(3);
  });
});

describe('pinchOffset', () => {
  it('keeps the anchor over the same content point', () => {
    // Offset 0, scale 1 -> the viewport point 100 sits at content 100. At scale 2 it must stay under
    // the finger, so the content shifts left: offset = 100 * 2 - 100 = 100.
    expect(pinchOffset(0, 100, 1, 2)).toBe(100);
  });

  it('is the inverse when the scale comes back', () => {
    const zoomed = pinchOffset(0, 100, 1, 2);
    expect(pinchOffset(zoomed, 100, 2, 1)).toBeCloseTo(0, 10);
  });

  it('keeps an anchored scroll position stable when the scale does not change', () => {
    expect(pinchOffset(37, 100, 2, 2)).toBeCloseTo(37, 10);
  });

  it('leaves the offset alone for a degenerate scale', () => {
    expect(pinchOffset(42, 10, 0, 2)).toBe(42);
    expect(pinchOffset(42, 10, 1, 0)).toBe(42);
  });
});

describe('clampZoomOffset', () => {
  it('clamps into the scrollable range', () => {
    expect(clampZoomOffset(-20, 100)).toBe(0);
    expect(clampZoomOffset(150, 100)).toBe(100);
    expect(clampZoomOffset(40, 100)).toBe(40);
  });

  it('pins to the start when there is nothing to scroll', () => {
    expect(clampZoomOffset(40, 0)).toBe(0);
    expect(clampZoomOffset(40, -5)).toBe(0);
  });

  it('survives a non-finite offset', () => {
    expect(clampZoomOffset(Number.NaN, 100)).toBe(0);
  });
});
