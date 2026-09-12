/**
 * Tests for `Slider`'s pure geometry: clamping/snapping and the value ↔ position mapping.
 *
 * The widget itself needs a live `Phaser.Scene`, so the arithmetic is exported as plain functions -
 * they are what decides whether a drag reports `42` or `41.999999`, and whether a bound `ref` can ever
 * see a value outside `[min, max]`.
 */

import { describe, expect, it } from 'vitest';
import {
  clampSliderValue,
  sliderFraction,
  sliderValueForKey,
  sliderValueFromPosition,
} from '../src/slider-geometry';

describe('clampSliderValue', () => {
  it('clamps into the range', () => {
    expect(clampSliderValue(-5, 0, 100)).toBe(0);
    expect(clampSliderValue(150, 0, 100)).toBe(100);
    expect(clampSliderValue(42, 0, 100)).toBe(42);
  });

  it('snaps to a step grid anchored at min', () => {
    // `min: 5, step: 10` must produce 5/15/25 - the values the caller asked for, not 0/10/20.
    expect(clampSliderValue(12, 5, 100, 10)).toBe(15);
    expect(clampSliderValue(4, 5, 100, 10)).toBe(5);
    expect(clampSliderValue(99, 5, 100, 10)).toBe(95);
  });

  it('keeps the ends of the range reachable for a fractional step', () => {
    expect(clampSliderValue(0.5, 0, 1, 0.25)).toBe(0.5);
    expect(clampSliderValue(0.62, 0, 1, 0.25)).toBe(0.5);
    expect(clampSliderValue(0.99, 0, 1, 0.25)).toBe(1);
  });

  it('treats a zero or invalid step as continuous', () => {
    expect(clampSliderValue(37.5, 0, 100, 0)).toBe(37.5);
    expect(clampSliderValue(37.5, 0, 100, Number.NaN)).toBe(37.5);
  });

  it('never returns NaN, even for garbage input', () => {
    expect(clampSliderValue(Number.NaN, 0, 100)).toBe(0);
    expect(clampSliderValue(10, Number.NaN, Number.NaN)).toBe(10);
    expect(clampSliderValue(10, 100, 0)).toBe(100);
  });

  it('floats the snapped value clean of binary noise', () => {
    // 0.1 * 3 in binary floating point is 0.30000000000000004; a bound ref must not see that.
    expect(clampSliderValue(0.3, 0, 1, 0.1)).toBe(0.3);
  });
});

describe('sliderFraction', () => {
  it('maps the range onto 0..1', () => {
    expect(sliderFraction(0, 0, 100)).toBe(0);
    expect(sliderFraction(100, 0, 100)).toBe(1);
    expect(sliderFraction(25, 0, 100)).toBe(0.25);
  });

  it('clamps outside the range and survives a zero span', () => {
    expect(sliderFraction(-10, 0, 100)).toBe(0);
    expect(sliderFraction(200, 0, 100)).toBe(1);
    expect(sliderFraction(5, 5, 5)).toBe(0);
  });
});

describe('sliderValueFromPosition', () => {
  it('maps the track ends onto the range', () => {
    expect(sliderValueFromPosition(0, 200, 0, 100)).toBe(0);
    expect(sliderValueFromPosition(200, 200, 0, 100)).toBe(100);
    expect(sliderValueFromPosition(50, 200, 0, 100)).toBe(25);
  });

  it('clamps a drag that left the widget', () => {
    // Dragging past the end of the track must pin the value, not extrapolate past `max`.
    expect(sliderValueFromPosition(-40, 200, 0, 100)).toBe(0);
    expect(sliderValueFromPosition(999, 200, 0, 100)).toBe(100);
  });

  it('applies the step while dragging', () => {
    const values = [0, 50, 100, 150, 200].map((x) => sliderValueFromPosition(x, 200, 0, 100, 10));
    expect(values).toEqual([0, 30, 50, 80, 100]);
  });

  it('degrades to the minimum for a zero-length track', () => {
    // A slider that has not been laid out yet (width 0) must not divide by zero.
    expect(sliderValueFromPosition(10, 0, 5, 100)).toBe(5);
  });
});

describe('sliderValueForKey', () => {
  it('moves by one step with the arrows', () => {
    expect(sliderValueForKey(40, 'ArrowRight', 0, 100, 10)).toBe(50);
    expect(sliderValueForKey(40, 'ArrowUp', 0, 100, 10)).toBe(50);
    expect(sliderValueForKey(40, 'ArrowLeft', 0, 100, 10)).toBe(30);
    expect(sliderValueForKey(40, 'ArrowDown', 0, 100, 10)).toBe(30);
  });

  it('uses a twentieth of the range for a continuous slider', () => {
    // Without a step there is no grid to move along, so the arrow has to pick a granularity itself.
    expect(sliderValueForKey(40, 'ArrowRight', 0, 100)).toBe(45);
    // A 0..1 range moves by 0.05 per press, not by a whole unit.
    expect(sliderValueForKey(0.5, 'ArrowRight', 0, 1)).toBeCloseTo(0.55, 10);
    expect(sliderValueForKey(0.5, 'ArrowLeft', 0, 1)).toBeCloseTo(0.45, 10);
  });

  it('jumps to the ends with Home/End', () => {
    expect(sliderValueForKey(40, 'Home', 0, 100, 10)).toBe(0);
    expect(sliderValueForKey(40, 'End', 0, 100, 10)).toBe(100);
  });

  it('moves by a tenth of the range with PageUp/PageDown', () => {
    expect(sliderValueForKey(40, 'PageUp', 0, 100, 10)).toBe(50);
    expect(sliderValueForKey(40, 'PageDown', 0, 100, 10)).toBe(30);
    // On a continuous slider a page is still a tenth, i.e. twice the arrow move.
    expect(sliderValueForKey(40, 'PageUp', 0, 100)).toBe(50);
    expect(sliderValueForKey(40, 'ArrowRight', 0, 100)).toBe(45);
    // A coarse step must not make PageUp smaller than the one-step move: `max(step, range/10)`.
    expect(sliderValueForKey(40, 'PageUp', 0, 100, 20)).toBe(60);
    // …and the result still lands on the grid: 40 + 30 is snapped back to the nearest multiple of 30.
    expect(sliderValueForKey(40, 'PageUp', 0, 100, 30)).toBe(60);
  });

  it('clamps at the ends instead of running past them', () => {
    expect(sliderValueForKey(100, 'ArrowRight', 0, 100, 10)).toBe(100);
    expect(sliderValueForKey(0, 'ArrowLeft', 0, 100, 10)).toBe(0);
  });

  it('declines every other key, so navigation keeps working', () => {
    // `Tab`, `Enter` and `Escape` must stay with the focus manager.
    expect(sliderValueForKey(40, 'Tab', 0, 100, 10)).toBeNull();
    expect(sliderValueForKey(40, 'Enter', 0, 100, 10)).toBeNull();
    expect(sliderValueForKey(40, 'Escape', 0, 100, 10)).toBeNull();
    expect(sliderValueForKey(40, 'a', 0, 100, 10)).toBeNull();
  });
});
