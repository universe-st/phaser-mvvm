/**
 * `stack` and `absolute` arrangers.
 *
 * `measureStack` takes the largest child margin box, `arrangeStack` aligns every child inside the
 * content box, and `arrangeAbsolute` places the children that opted out of the flow with
 * `left`/`top`/`right`/`bottom` offsets (CSS-like, resolved against the content box).
 */

import { describe, expect, it } from 'vitest';
import { loose, tight, unbounded } from '../src/constraint';
import type { LayoutParams } from '../src/params';
import type { StackLayoutOptions } from '../src/types';
import type { TestNode } from './harness';
import {
  absolute,
  box,
  exactEngine,
  grid,
  expectRect,
  expectSize,
  leaf,
  layout,
  rectOf,
  stack,
} from './harness';

/** A child with a definite border-box size. */
function fixed(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf({ width, height, ...params });
}

/** A child that sizes itself from its content. */
function auto(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf(params, { width, height });
}

function stackOf(
  options: StackLayoutOptions,
  children: TestNode[],
  params?: LayoutParams,
): TestNode {
  return stack(options, children, params);
}

describe('stack: measurement', () => {
  it('takes the largest child margin box as the content size', () => {
    const root = stackOf({}, [auto(40, 20), auto(80, 10)]);

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 80, 20);
  });

  it('adds a child margin to the stacked size', () => {
    const root = stackOf({}, [auto(40, 20, { margin: [5, 10] })]);

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 60, 30);
  });

  it('ignores absolute children when measuring', () => {
    const root = stackOf({}, [auto(40, 20), auto(200, 200, { position: 'absolute' })]);

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 40, 20);
  });

  it('measures an empty stack as 0×0', () => {
    const root = stackOf({}, []);

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 0, 0);
  });

  it('keeps a fixed stack size instead of wrapping the children', () => {
    const root = stackOf({}, [auto(40, 20)], { width: 200, height: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 200, 100);
  });
});

describe('stack: alignment', () => {
  const build = (align: StackLayoutOptions['align']): TestNode => {
    const child = auto(40, 20);
    const root = stackOf({ align }, [child], { width: 200, height: 100 });
    layout(root, loose(300, 300));
    return child;
  };

  it('centers the children by default', () => {
    const child = build(undefined);
    expectRect(child, 80, 40, 40, 20);
  });

  it('aligns the children with the start corner', () => {
    const child = build('start');
    expectRect(child, 0, 0, 40, 20);
  });

  it('aligns the children with the end corner', () => {
    const child = build('end');
    expectRect(child, 160, 80, 40, 20);
  });

  it('offsets an aligned child by its margin', () => {
    const child = auto(40, 20, { margin: { left: 10, top: 4 } });
    const root = stackOf({ align: 'start' }, [child], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(child, 10, 4, 40, 20);
  });

  it('centers a content-sized child inside a tight full-screen parent', () => {
    const child = auto(420, 240);
    const root = stackOf({ align: 'center' }, [child], { width: 1280, height: 633 });

    const { size } = layout(root, tight(1280, 633), exactEngine());

    expectSize(size, 1280, 633);
    // The tight parent must not resize the child: it keeps its content size and is centered.
    expectRect(child, (1280 - 420) / 2, (633 - 240) / 2, 420, 240);
  });

  it('layers the children on top of each other inside the content box', () => {
    const bottom = auto(200, 100);
    const top = auto(40, 20);
    const root = stackOf({ align: 'end' }, [bottom, top], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(bottom, 0, 0, 200, 100);
    expectRect(top, 160, 80, 40, 20);
  });

  it('stacks children inside the padded content box', () => {
    const child = auto(40, 20);
    const root = stackOf({ align: 'end' }, [child], {
      width: 200,
      height: 100,
      padding: 20,
    });

    layout(root, loose(300, 300));

    expectRect(child, 140, 60, 40, 20);
  });
});

describe('absolute: offsets', () => {
  const placeChild = (params: LayoutParams): TestNode => {
    const child = fixed(40, 20, { position: 'absolute', ...params });
    const root = absolute([child], { width: 200, height: 100 });
    layout(root, loose(300, 300));
    return child;
  };

  it('places a child at left/top', () => {
    expectRect(placeChild({ left: 10, top: 20 }), 10, 20, 40, 20);
  });

  it('places a child at right/top', () => {
    expectRect(placeChild({ right: 10, top: 20 }), 150, 20, 40, 20);
  });

  it('places a child at left/bottom', () => {
    expectRect(placeChild({ left: 10, bottom: 20 }), 10, 60, 40, 20);
  });

  it('places a child at right/bottom', () => {
    expectRect(placeChild({ right: 10, bottom: 20 }), 150, 60, 40, 20);
  });

  it('falls back to the content box origin when no offset is set', () => {
    expectRect(placeChild({}), 0, 0, 40, 20);
  });

  it('resolves only the axes that carry an offset', () => {
    expectRect(placeChild({ left: 30 }), 30, 0, 40, 20);
    expectRect(placeChild({ bottom: 5 }), 0, 75, 40, 20);
  });

  it('resolves percentage offsets against the content box', () => {
    expectRect(placeChild({ left: '50%', top: '50%' }), 100, 50, 40, 20);
  });

  it('resolves right/bottom percentages against the content box', () => {
    expectRect(placeChild({ right: '25%', bottom: '10%' }), 110, 70, 40, 20);
  });

  it('offsets the placed rect by the child margin', () => {
    expectRect(placeChild({ left: 10, top: 10, margin: { left: 5, top: 2 } }), 15, 12, 40, 20);
  });

  it('positions an auto-sized absolute child at its content size', () => {
    const child = auto(24, 24, { position: 'absolute', left: 8, bottom: 8 });
    const root = absolute([child], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(child, 8, 68, 24, 24);
  });

  it('does not place flow children through the absolute arranger', () => {
    const flow = fixed(40, 20);
    const positioned = fixed(10, 10, { position: 'absolute', left: 1, top: 2 });
    const root = absolute([flow, positioned], { width: 100, height: 100 });

    layout(root, loose(300, 300));

    expect(flow.arranged).toBeNull();
    expectRect(positioned, 1, 2, 10, 10);
  });
});

describe('absolute: inside flow containers', () => {
  it('positions absolute children of a box without affecting its layout', () => {
    const child = fixed(20, 20);
    const overlay = fixed(30, 30, { position: 'absolute', right: 5, bottom: 5 });
    const root = box({ direction: 'vertical', alignItems: 'start' }, [child, overlay], {
      width: 100,
      height: 100,
    });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 100, 100);
    expectRect(child, 0, 0, 20, 20);
    expectRect(overlay, 65, 65, 30, 30);
  });

  it('positions absolute children of a stack relative to the content box', () => {
    const overlay = fixed(30, 30, { position: 'absolute', left: 5, top: 5 });
    const root = stackOf({}, [auto(40, 40), overlay], { width: 120, height: 80 });

    layout(root, loose(300, 300));

    expectRect(overlay, 5, 5, 30, 30);
  });

  it('positions absolute children of a grid relative to the content box', () => {
    const overlay = fixed(30, 30, { position: 'absolute', right: 4, bottom: 6 });
    const cell = auto(20, 20);
    const root = grid({ columns: 2 }, [overlay, cell], { width: 100, height: 100 });

    layout(root, loose(300, 300));

    expectRect(cell, 0, 0, 50, 20);
    expectRect(overlay, 66, 64, 30, 30);
  });

  it('keeps an absolute child out of the flow order driven by `order`', () => {
    const first = fixed(10, 10, { order: 5 });
    const overlay = fixed(10, 10, { order: -1, position: 'absolute', left: 2, top: 2 });
    const root = box({ direction: 'vertical', alignItems: 'start' }, [first, overlay], {
      width: 100,
      height: 100,
    });

    layout(root, loose(300, 300));

    expectRect(first, 0, 0, 10, 10);
    expectRect(overlay, 2, 2, 10, 10);
  });
});

describe('absolute: sizing', () => {
  it('wraps its children when it has an auto size', () => {
    const root = absolute([fixed(40, 20), fixed(80, 10)]);

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 80, 20);
  });

  it('keeps a fixed absolute container size', () => {
    const root = absolute([fixed(40, 20)], { width: 200, height: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 200, 100);
  });

  it('reports a zero size for an unbounded absolute container with no children', () => {
    const root = absolute([]);

    const { size } = layout(root, unbounded());

    expectSize(size, 0, 0);
    expect(rectOf(root)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('places children inside the padded content box', () => {
    const child = fixed(40, 20, { position: 'absolute', left: 0, top: 0 });
    const root = absolute([child], { width: 200, height: 100, padding: 15 });

    layout(root, loose(300, 300));

    expectRect(child, 15, 15, 40, 20);
  });

  it('aligns sub-pixel offsets exactly when snapping is off', () => {
    const child = fixed(25, 25, { position: 'absolute', left: 33.5, top: 12.25 });
    const root = absolute([child], { width: 200, height: 100 });

    layout(root, loose(300, 300), exactEngine());

    expectRect(child, 33.5, 12.25, 25, 25);
  });
});
