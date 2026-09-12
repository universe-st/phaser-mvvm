/**
 * `scroll` container: the content box of a scroll port.
 *
 * The contract under test is the one a `ScrollView` depends on: content may be **longer than the
 * viewport** (the port releases the cap on the axis it scrolls, which is what keeps the flow
 * positions of everything below an overflowing child correct), while the cross axis keeps the
 * viewport size, so `fill`/percentage children still see a definite box.
 */

import { describe, expect, it } from 'vitest';
import { constraints } from '../src/constraint';
import { relaxScrollConstraint } from '../src/scroll';
import { box, exactEngine, leaf, layout, measuredLeaf, rectOf, scrollPort } from './harness';

describe('relaxScrollConstraint', () => {
  it('releases the maximum on the scroll axis and drops the minimums', () => {
    const relaxed = relaxScrollConstraint(constraints(10, 200, 10, 300), 'vertical');

    expect(relaxed.maxHeight).toBe(Infinity);
    expect(relaxed.minHeight).toBe(0);
    expect(relaxed.maxWidth).toBe(200);
    expect(relaxed.minWidth).toBe(0);
  });

  it('releases the horizontal axis for a horizontal port', () => {
    const relaxed = relaxScrollConstraint(constraints(10, 200, 10, 300), 'horizontal');

    expect(relaxed.maxWidth).toBe(Infinity);
    expect(relaxed.maxHeight).toBe(300);
  });

  it('releases both axes for a two-axis port', () => {
    const relaxed = relaxScrollConstraint(constraints(0, 200, 0, 300), 'both');

    expect(relaxed.maxWidth).toBe(Infinity);
    expect(relaxed.maxHeight).toBe(Infinity);
  });

  it('defaults to the vertical axis', () => {
    const relaxed = relaxScrollConstraint(constraints(0, 200, 0, 300), undefined);

    expect(relaxed.maxHeight).toBe(Infinity);
    expect(relaxed.maxWidth).toBe(200);
  });
});

describe('measureScroll', () => {
  it('measures content taller than the port at its natural length', () => {
    const content = leaf({ width: 'fill' }, { width: 0, height: 900 });
    const port = scrollPort({ axis: 'vertical' }, [content], { width: 200, height: 120 });

    const { size } = layout(port, constraints(0, 200, 0, 120), exactEngine());

    // The port itself stays 120 tall, but the content kept its 900: the flow below it is not
    // squashed into the viewport.
    expect(size.height).toBeCloseTo(120, 6);
    expect(rectOf(content).height).toBeCloseTo(900, 6);
  });

  it('keeps the cross axis bounded, so a fill child gets the viewport width', () => {
    const content = leaf({ width: 'fill' }, { width: 0, height: 900 });
    const port = scrollPort({ axis: 'vertical' }, [content], { width: 200, height: 120 });

    layout(port, constraints(0, 200, 0, 120), exactEngine());

    expect(rectOf(content).width).toBeCloseTo(200, 6);
  });

  it('lets a fill child keep the viewport height even though the axis is unbounded', () => {
    // This is the virtualised-list case: the list asks for `height: 'fill'` and must get the
    // viewport, not `Infinity` (which would collapse it to its own content length).
    const fill = measuredLeaf(
      (constraint) => ({
        width: 0,
        height: Number.isFinite(constraint.maxHeight) ? constraint.maxHeight : 0,
      }),
      { height: 'fill' },
    );
    const port = scrollPort({ axis: 'vertical' }, [fill], { width: 200, height: 120 });

    layout(port, constraints(0, 200, 0, 120), exactEngine());

    expect(rectOf(fill).height).toBeCloseTo(120, 6);
  });

  it('places an absolute holder at the origin and honours its left/top offset', () => {
    const holder = box('vertical', [leaf({ width: 'fill' }, { width: 0, height: 900 })], {
      position: 'absolute',
      left: 0,
      top: -40,
      width: 'fill',
      height: 'auto',
    });
    const port = scrollPort({ axis: 'vertical' }, [holder], { width: 200, height: 120 });

    layout(port, constraints(0, 200, 0, 120), exactEngine());

    const rect = rectOf(holder);
    expect(rect.y).toBeCloseTo(-40, 6);
    expect(rect.height).toBeCloseTo(900, 6);
    expect(rect.width).toBeCloseTo(200, 6);
  });

  it('places a flow child at the content origin', () => {
    const child = leaf(undefined, { width: 60, height: 400 });
    const port = scrollPort({ axis: 'vertical' }, [child], { width: 200, height: 120 });

    layout(port, constraints(0, 200, 0, 120), exactEngine());

    const rect = rectOf(child);
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.y).toBeCloseTo(0, 6);
    expect(rect.height).toBeCloseTo(400, 6);
  });

  it('does not release the axis a horizontal port keeps', () => {
    const content = box('vertical', [leaf(undefined, { width: 400, height: 10 })], {
      width: 'auto',
      height: 'fill',
    });
    const port = scrollPort({ axis: 'horizontal' }, [content], { width: 200, height: 120 });

    layout(port, constraints(0, 200, 0, 120), exactEngine());

    // Height is the port's, width is the content's own: only the scroll axis was released.
    expect(rectOf(content).height).toBeCloseTo(120, 6);
    expect(rectOf(content).width).toBeCloseTo(400, 6);
  });

  it('measures nothing for an empty port', () => {
    const port = scrollPort({ axis: 'vertical' }, [], { width: 200, height: 120 });

    const { size } = layout(port, constraints(0, 200, 0, 120), exactEngine());

    expect(size.width).toBeCloseTo(200, 6);
    expect(size.height).toBeCloseTo(120, 6);
  });
});
