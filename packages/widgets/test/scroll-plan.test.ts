/**
 * The pure half of `ScrollView`: offset clamping, wheel normalisation, inertia, scrollbar geometry,
 * drag threshold and keyboard steps.
 *
 * Only pure functions are exercised here — no Phaser object is ever constructed, so the file runs in
 * plain Node. The widget itself (clipping, gesture wiring) is verified in the browser check.
 */

import { describe, expect, it } from 'vitest';
import {
  BOUNCE_LIMIT,
  DELTA_MODE_LINE,
  DELTA_MODE_PAGE,
  DELTA_MODE_PIXEL,
  INERTIA_DECELERATION,
  LINE_HEIGHT,
  PAGE_LINES,
  applyInertia,
  clampOffset,
  extentOfRects,
  isScrollable,
  normalizeWheel,
  keyScrollAxis,
  planScrollDrag,
  planScrollKey,
  thumbGeometry,
  cullBand,
  outsideCullBand,
} from '../src/scroll-plan';

describe('isScrollable', () => {
  it('is true only when the content is longer than the viewport', () => {
    expect(isScrollable(1000, 400)).toBe(true);
    expect(isScrollable(400, 400)).toBe(false);
    expect(isScrollable(399, 400)).toBe(false);
  });

  it('ignores sub-pixel slack', () => {
    expect(isScrollable(400.4, 400)).toBe(false);
    expect(isScrollable(401.5, 400)).toBe(true);
  });

  it('is false for non-finite input', () => {
    expect(isScrollable(Number.NaN, 400)).toBe(false);
    expect(isScrollable(1000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('clampOffset', () => {
  it('leaves an offset inside the range untouched', () => {
    expect(clampOffset(120, 400)).toBe(120);
    expect(clampOffset(0, 400)).toBe(0);
    expect(clampOffset(400, 400)).toBe(400);
  });

  it('clamps a negative offset to the top', () => {
    expect(clampOffset(-30, 400)).toBe(0);
  });

  it('clamps an offset past the end', () => {
    expect(clampOffset(900, 400)).toBe(400);
  });

  it('treats a missing or negative maximum as zero', () => {
    expect(clampOffset(50, -10)).toBe(0);
    expect(clampOffset(50, Number.NaN)).toBe(0);
  });

  it('treats a non-finite offset as the top', () => {
    expect(clampOffset(Number.NaN, 400)).toBe(0);
  });

  it('allows a resisted overshoot with bounce', () => {
    const pulled = clampOffset(-100, 400, true);
    expect(pulled).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(-BOUNCE_LIMIT);
    expect(clampOffset(500, 400, true)).toBeGreaterThan(400);
  });

  it('saturates the bounce pull just short of the limit', () => {
    const pulledDown = clampOffset(-100000, 400, true);
    expect(pulledDown).toBeGreaterThan(-BOUNCE_LIMIT);
    expect(pulledDown).toBeLessThan(-BOUNCE_LIMIT + 1);
    const pulledUp = clampOffset(100000, 400, true);
    expect(pulledUp).toBeLessThan(400 + BOUNCE_LIMIT);
    expect(pulledUp).toBeGreaterThan(400 + BOUNCE_LIMIT - 1);
  });

  it('stiffens as the pull grows', () => {
    const small = -clampOffset(-20, 400, true);
    const medium = -clampOffset(-80, 400, true);
    const huge = -clampOffset(-2000, 400, true);
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(huge);
    // The band gives less and less for the same extra pull: the increments shrink.
    const first = -clampOffset(-100, 400, true);
    const second = -clampOffset(-200, 400, true);
    const third = -clampOffset(-300, 400, true);
    expect(second - first).toBeGreaterThan(third - second);
  });

  it('keeps bounce offsets inside the range untouched', () => {
    expect(clampOffset(200, 400, true)).toBe(200);
  });
});

describe('normalizeWheel', () => {
  it('passes pixel deltas through', () => {
    expect(normalizeWheel(120, DELTA_MODE_PIXEL)).toBe(120);
  });

  it('scales line deltas by the line height', () => {
    expect(normalizeWheel(3, DELTA_MODE_LINE)).toBe(3 * LINE_HEIGHT);
  });

  it('scales page deltas by a page of lines', () => {
    expect(normalizeWheel(1, DELTA_MODE_PAGE)).toBe(LINE_HEIGHT * PAGE_LINES);
  });

  it('applies the speed multiplier in every mode', () => {
    expect(normalizeWheel(100, DELTA_MODE_PIXEL, 0.5)).toBe(50);
    expect(normalizeWheel(2, DELTA_MODE_LINE, 2)).toBe(2 * LINE_HEIGHT * 2);
  });

  it('treats an unknown delta mode as pixels', () => {
    expect(normalizeWheel(40, 7)).toBe(40);
  });

  it('is defensive about bad input', () => {
    expect(normalizeWheel(Number.NaN, DELTA_MODE_PIXEL)).toBe(0);
    expect(normalizeWheel(10, DELTA_MODE_PIXEL, Number.NaN)).toBe(10);
  });

  it('keeps the direction of the delta', () => {
    expect(normalizeWheel(-120, DELTA_MODE_PIXEL)).toBe(-120);
    expect(normalizeWheel(-1, DELTA_MODE_LINE)).toBe(-LINE_HEIGHT);
  });
});

describe('applyInertia', () => {
  it('decays the velocity and reports the distance travelled', () => {
    const step = applyInertia(1, INERTIA_DECELERATION, 16);
    expect(step.velocity).toBeLessThan(1);
    expect(step.velocity).toBeGreaterThan(0);
    expect(step.delta).toBeGreaterThan(0);
    expect(step.stopped).toBe(false);
  });

  it('stops once the velocity is below the threshold', () => {
    const step = applyInertia(0.01, INERTIA_DECELERATION, 16);
    expect(step.stopped).toBe(true);
    expect(step.velocity).toBeLessThan(0.01);
  });

  it('coasts the same distance for one long frame as for ten short ones', () => {
    let longVelocity = 3;
    let longDistance = 0;
    const longStep = applyInertia(longVelocity, INERTIA_DECELERATION, 160);
    longVelocity = longStep.velocity;
    longDistance += longStep.delta;

    let shortVelocity = 3;
    let shortDistance = 0;
    for (let i = 0; i < 10; i++) {
      const step = applyInertia(shortVelocity, INERTIA_DECELERATION, 16);
      shortVelocity = step.velocity;
      shortDistance += step.delta;
    }

    expect(longDistance).toBeCloseTo(shortDistance, 6);
    expect(longVelocity).toBeCloseTo(shortVelocity, 6);
  });

  it('handles a negative velocity (fling upwards)', () => {
    const step = applyInertia(-2, INERTIA_DECELERATION, 16);
    expect(step.velocity).toBeLessThan(0);
    expect(step.delta).toBeLessThan(0);
  });

  it('does not move for a zero or negative frame time', () => {
    expect(applyInertia(2, INERTIA_DECELERATION, 0).delta).toBe(0);
    expect(applyInertia(2, INERTIA_DECELERATION, -5).delta).toBe(0);
  });

  it('is defensive about non-finite input', () => {
    expect(applyInertia(Number.NaN, INERTIA_DECELERATION, 16).stopped).toBe(true);
    expect(applyInertia(2, Number.NaN, 16).velocity).toBeLessThan(2);
  });
});

describe('thumbGeometry', () => {
  it('hides the thumb when the content fits', () => {
    expect(thumbGeometry(0, 400, 400, 380, 24)).toEqual({
      visible: false,
      position: 0,
      length: 0,
    });
  });

  it('proportional thumb starts at the top for offset 0', () => {
    const thumb = thumbGeometry(0, 200, 1000, 400, 24);
    expect(thumb.visible).toBe(true);
    expect(thumb.length).toBeCloseTo(80, 6);
    expect(thumb.position).toBe(0);
  });

  it('moves the thumb to the end of the track at max offset', () => {
    const thumb = thumbGeometry(800, 200, 1000, 400, 24);
    expect(thumb.position).toBeCloseTo(320, 6);
    expect(thumb.length).toBeCloseTo(80, 6);
  });

  it('places the thumb proportionally in the middle', () => {
    const thumb = thumbGeometry(400, 200, 1000, 400, 24);
    expect(thumb.position).toBeCloseTo(160, 6);
  });

  it('never shrinks the thumb below the minimum', () => {
    const thumb = thumbGeometry(0, 200, 100000, 400, 24);
    expect(thumb.length).toBe(24);
  });

  it('clamps a radius outside the track', () => {
    const thumb = thumbGeometry(-50, 200, 1000, 400, 24);
    expect(thumb.position).toBe(0);
    const past = thumbGeometry(5000, 200, 1000, 400, 24);
    expect(past.position).toBeCloseTo(320, 6);
  });

  it('hides the thumb for a track that cannot hold it', () => {
    expect(thumbGeometry(10, 200, 1000, 0, 24).visible).toBe(false);
    expect(thumbGeometry(10, 200, 1000, -10, 24).visible).toBe(false);
  });
});

describe('planScrollDrag', () => {
  const start = { x: 100, y: 100 };

  it('stays a click below the threshold', () => {
    expect(planScrollDrag(start, { x: 103, y: 103 }, 10)).toEqual({
      dragging: false,
      dx: 0,
      dy: 0,
    });
  });

  it('becomes a drag at the threshold', () => {
    expect(planScrollDrag(start, { x: 100, y: 110 }, 10)).toEqual({
      dragging: true,
      dx: 0,
      dy: 10,
    });
  });

  it('measures diagonally', () => {
    const plan = planScrollDrag(start, { x: 108, y: 108 }, 10);
    expect(plan.dragging).toBe(true);
    expect(plan.dx).toBe(8);
    expect(plan.dy).toBe(8);
  });

  it('treats a zero threshold as an immediate drag', () => {
    expect(planScrollDrag(start, { x: 100, y: 100 }, 0).dragging).toBe(true);
  });

  it('reports the full travel including the threshold distance', () => {
    const plan = planScrollDrag(start, { x: 100, y: 60 }, 10);
    expect(plan.dy).toBe(-40);
  });
});

describe('extentOfRects', () => {
  it('is zero for an empty list', () => {
    expect(extentOfRects([])).toEqual({ width: 0, height: 0 });
  });

  it('unions the rectangles', () => {
    expect(
      extentOfRects([
        { x: 0, y: 0, width: 100, height: 40 },
        { x: 0, y: 40, width: 60, height: 40 },
        { x: 90, y: 0, width: 30, height: 10 },
      ]),
    ).toEqual({ width: 120, height: 80 });
  });

  it('ignores negative origins but keeps the positive extent', () => {
    expect(extentOfRects([{ x: -20, y: -5, width: 100, height: 30 }])).toEqual({
      width: 80,
      height: 25,
    });
  });

  it('tolerates a null entry', () => {
    expect(extentOfRects([null as never, { x: 0, y: 0, width: 10, height: 10 }])).toEqual({
      width: 10,
      height: 10,
    });
  });
});

/**
 * Which axis a key moves: the rule a `direction: 'both'` port needs and the one that was missing (V60 —
 * its `ArrowLeft`/`ArrowRight` went into the y axis).
 */
describe('keyScrollAxis', () => {
  it('lets the key decide on a two-axis port', () => {
    expect(keyScrollAxis('both', 'ArrowLeft')).toBe('x');
    expect(keyScrollAxis('both', 'ArrowRight')).toBe('x');
    expect(keyScrollAxis('both', 'ArrowUp')).toBe('y');
    expect(keyScrollAxis('both', 'ArrowDown')).toBe('y');
    expect(keyScrollAxis('both', 'PageDown')).toBe('y');
    expect(keyScrollAxis('both', 'Home')).toBe('y');
  });

  it('overrules the key on a one-axis port', () => {
    // A horizontal strip pages with PageUp/PageDown (its own axis), and a vertical port never moves x.
    expect(keyScrollAxis('horizontal', 'ArrowLeft')).toBe('x');
    expect(keyScrollAxis('horizontal', 'PageDown')).toBe('x');
    expect(keyScrollAxis('vertical', 'ArrowRight')).toBe('y');
    expect(keyScrollAxis('vertical', 'PageDown')).toBe('y');
  });
});

describe('planScrollKey', () => {
  it('steps one line for the arrows, and says which axis each key is on', () => {
    expect(planScrollKey('ArrowDown', 400, 40)).toEqual({ delta: 40, jump: null, axis: 'y' });
    expect(planScrollKey('ArrowUp', 400, 40)).toEqual({ delta: -40, jump: null, axis: 'y' });
    expect(planScrollKey('ArrowLeft', 400, 40)).toEqual({ delta: -40, jump: null, axis: 'x' });
    expect(planScrollKey('ArrowRight', 400, 40)).toEqual({ delta: 40, jump: null, axis: 'x' });
  });

  it('keeps the axis on the keys that page and jump', () => {
    // The widget resolves the axis from the key for a `direction: 'both'` port; a step that lost it
    // would send every key into the primary axis (V60).
    expect(planScrollKey('PageDown', 400)?.axis).toBe('y');
    expect(planScrollKey('PageUp', 400)?.axis).toBe('y');
    expect(planScrollKey('Home', 400)?.axis).toBe('y');
    expect(planScrollKey('End', 400)?.axis).toBe('y');
  });

  it('pages by a fraction of the viewport', () => {
    expect(planScrollKey('PageDown', 400, 40)?.delta).toBeCloseTo(360, 6);
    expect(planScrollKey('PageUp', 400, 40)?.delta).toBeCloseTo(-360, 6);
  });

  it('reports jumps for Home and End', () => {
    expect(planScrollKey('Home', 400)).toEqual({ delta: 0, jump: 'start', axis: 'y' });
    expect(planScrollKey('End', 400)).toEqual({ delta: 0, jump: 'end', axis: 'y' });
  });

  it('ignores keys that are not scroll keys', () => {
    expect(planScrollKey('Tab', 400)).toBeNull();
    expect(planScrollKey('a', 400)).toBeNull();
    expect(planScrollKey('Enter', 400)).toBeNull();
  });

  it('never pages less than one line', () => {
    expect(planScrollKey('PageDown', 4, 40)?.delta).toBe(40);
  });
});

/**
 * Viewport culling: the arithmetic that decides which content a scroll port stops drawing.
 *
 * The widget half (the pruning walk, the flag it writes) is browser-side, but *where* the band ends up
 * is the part that decides whether a row pops in and out at the edge, so it is pinned here.
 */
describe('cullBand', () => {
  it('covers the viewport plus the margin on both sides', () => {
    const band = cullBand(200, 400, 300, 500, 1, 50, false, true);
    expect(band.minY).toBe(350);
    expect(band.maxY).toBe(950);
    expect(band.minX).toBe(150);
    expect(band.maxX).toBe(550);
  });

  it('divides the offset and the viewport by the holder scale', () => {
    // Zoomed in to 2x, half as much content fits the same 500 px viewport and the same offset.
    const band = cullBand(0, 400, 300, 500, 2, 0, false, true);
    expect(band.minY).toBe(200);
    expect(band.maxY).toBe(450);
  });

  it('shrinks the margin with the scale too, so the band never depends on the zoom', () => {
    const band = cullBand(0, 400, 300, 500, 2, 48, false, true);
    expect(band.minY).toBe(200 - 24);
    expect(band.maxY).toBe(450 + 24);
  });

  it('falls back to scale 1 rather than producing an infinite band', () => {
    const band = cullBand(0, 100, 300, 500, 0, 0, false, true);
    expect(band.minY).toBe(100);
    expect(band.maxY).toBe(600);
  });

  it('keeps the axes the caller asked for and reuses the result object', () => {
    const target = { minX: 0, maxX: 0, minY: 0, maxY: 0, axisX: false, axisY: false };
    const band = cullBand(0, 0, 10, 10, 1, 0, true, false, target);
    expect(band).toBe(target);
    expect(band.axisX).toBe(true);
    expect(band.axisY).toBe(false);
  });
});

describe('outsideCullBand', () => {
  const band = cullBand(0, 500, 300, 400, 1, 50, false, true);

  it('treats a rect that merely touches an edge as visible', () => {
    // Ends exactly where the band starts / starts exactly where it ends.
    expect(outsideCullBand(band, 0, 450 - 100, 100, 100)).toBe(false);
    expect(outsideCullBand(band, 0, 950, 100, 100)).toBe(false);
  });

  it('culls a rect that is entirely past either edge', () => {
    expect(outsideCullBand(band, 0, 0, 100, 440)).toBe(true);
    expect(outsideCullBand(band, 0, 960, 100, 100)).toBe(true);
  });

  it('reports a zero-sized rect at the content origin as visible while the band contains it', () => {
    // A widget that has not been arranged yet sits at (0,0) with no size; culling it would hide a
    // fresh subtree for the frame before its rect arrives.
    const top = cullBand(0, 0, 300, 400, 1, 50, false, true);
    expect(outsideCullBand(top, 0, 0, 0, 0)).toBe(false);
  });

  it('ignores the axis the port does not scroll', () => {
    // A vertical port keeps a very wide row: it is off the cross axis but on screen vertically.
    expect(outsideCullBand(band, -5000, 600, 4000, 100)).toBe(false);
    const both = cullBand(0, 500, 300, 400, 1, 50, true, true);
    expect(outsideCullBand(both, -5000, 600, 4000, 100)).toBe(true);
  });
});
