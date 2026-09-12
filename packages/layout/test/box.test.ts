/**
 * `box` arranger: flow, gaps, alignment, flex, wrapping, ordering and percentage sizing.
 *
 * Geometry is asserted through the rects the harness records in `applyRect`, so every expectation
 * below is the final, parent-local border box of a child. Tests that produce sub-pixel values use
 * `exactEngine()` (snapping off) and note it; the engine's own pixel snapping is covered in
 * `engine.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { loose, tight, unbounded } from '../src/constraint';
import type { LayoutParams } from '../src/params';
import type { BoxLayoutOptions } from '../src/types';
import type { TestNode } from './harness';
import { box, exactEngine, expectRect, expectSize, leaf, layout, rectOf } from './harness';

/** A child with a definite border-box size. */
function fixed(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf({ width, height, ...params });
}

/** A child that sizes itself from its content. */
function auto(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf(params, { width, height });
}

function vertical(
  options: BoxLayoutOptions,
  children: TestNode[],
  params?: LayoutParams,
): TestNode {
  return box({ direction: 'vertical', alignItems: 'start', ...options }, children, params);
}

function horizontal(
  options: BoxLayoutOptions,
  children: TestNode[],
  params?: LayoutParams,
): TestNode {
  return box({ direction: 'horizontal', alignItems: 'start', ...options }, children, params);
}

describe('box: basic flow', () => {
  it('stacks children top-down on the vertical axis, in declaration order', () => {
    const a = fixed(30, 20);
    const b = fixed(50, 10);
    const root = vertical({}, [a, b], { width: 100 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 100, 30);
    expectRect(a, 0, 0, 30, 20);
    expectRect(b, 0, 20, 50, 10);
  });

  it('lays children out left-to-right on the horizontal axis', () => {
    const a = fixed(30, 20);
    const b = fixed(50, 10);
    const root = horizontal({}, [a, b], { height: 50 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 80, 50);
    expectRect(a, 0, 0, 30, 20);
    expectRect(b, 30, 0, 50, 10);
  });

  it('defaults to a vertical flow', () => {
    const a = fixed(30, 20);
    const b = fixed(30, 10);
    const root = box({ alignItems: 'start' }, [a, b], { width: 100 });

    layout(root, loose(200, 200));

    expectRect(a, 0, 0, 30, 20);
    expectRect(b, 0, 20, 30, 10);
  });

  it('measures an empty container as 0×0', () => {
    const root = box('vertical', [], { width: 100, height: 100 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 100, 100);
    expect(root.arranged).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('measures an auto-sized box with no children as 0×0', () => {
    const root = box('horizontal', []);

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 0, 0);
  });

  it('places children inside the content box when the container is padded', () => {
    const a = fixed(40, 20);
    const root = vertical({}, [a], { width: 200, height: 200, padding: 10 });

    layout(root, loose(300, 300));

    expectRect(a, 10, 10, 40, 20);
  });

  it('grows the container to fit its content when the height is auto', () => {
    const a = auto(40, 20);
    const b = auto(60, 30);
    const root = vertical({}, [a, b], { width: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 100, 50);
    expectRect(a, 0, 0, 40, 20);
    expectRect(b, 0, 20, 60, 30);
  });
});

describe('box: gaps', () => {
  it('applies `gap` between siblings on the main axis', () => {
    const a = fixed(30, 20);
    const b = fixed(30, 20);
    const root = vertical({ gap: 10 }, [a, b], { width: 100 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 100, 50);
    expectRect(a, 0, 0, 30, 20);
    expectRect(b, 0, 30, 30, 20);
  });

  it('lets `rowGap` override `gap` on a vertical main axis', () => {
    const a = fixed(30, 20);
    const b = fixed(30, 20);
    const root = vertical({ gap: 10, rowGap: 4 }, [a, b], { width: 100 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 100, 44);
    expectRect(b, 0, 24, 30, 20);
  });

  it('lets `columnGap` override `gap` on a horizontal main axis', () => {
    const a = fixed(30, 20);
    const b = fixed(30, 20);
    const root = horizontal({ gap: 10, columnGap: 4 }, [a, b], { height: 50 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 64, 50);
    expectRect(b, 34, 0, 30, 20);
  });

  it('adds the gap on top of the space distributed by `justifyContent`', () => {
    const a = fixed(20, 20);
    const b = fixed(20, 20);
    const root = vertical({ gap: 10, justifyContent: 'space-between' }, [a, b], {
      width: 100,
      height: 100,
    });

    layout(root, loose(200, 200));

    // leftover = 100 − 40 = 60 → line box is full, the gap stays where it is.
    expectRect(a, 0, 0, 20, 20);
    expectRect(b, 0, 80, 20, 20);
  });

  it('applies no gap before the first or after the last child', () => {
    const a = fixed(20, 20);
    const root = vertical({ gap: 12 }, [a], { width: 100 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 100, 20);
    expectRect(a, 0, 0, 20, 20);
  });
});

describe('box: justifyContent', () => {
  const build = (justifyContent: BoxLayoutOptions['justifyContent']): TestNode[] => {
    const children = [fixed(20, 40), fixed(20, 40), fixed(20, 40)];
    const root = vertical({ justifyContent }, children, { width: 100, height: 300 });
    layout(root, loose(300, 400));
    return children;
  };

  it('start aligns the first child with the content box start', () => {
    const [a, b, c] = build('start');
    expectRect(a as TestNode, 0, 0, 20, 40);
    expectRect(b as TestNode, 0, 40, 20, 40);
    expectRect(c as TestNode, 0, 80, 20, 40);
  });

  it('center splits the leftover space in half', () => {
    const [a, b, c] = build('center');
    expectRect(a as TestNode, 0, 90, 20, 40);
    expectRect(b as TestNode, 0, 130, 20, 40);
    expectRect(c as TestNode, 0, 170, 20, 40);
  });

  it('end pushes the children to the end of the content box', () => {
    const [a, b, c] = build('end');
    expectRect(a as TestNode, 0, 180, 20, 40);
    expectRect(b as TestNode, 0, 220, 20, 40);
    expectRect(c as TestNode, 0, 260, 20, 40);
  });

  it('space-between leaves the first and last child flush with the edges', () => {
    const [a, b, c] = build('space-between');
    expectRect(a as TestNode, 0, 0, 20, 40);
    expectRect(b as TestNode, 0, 130, 20, 40);
    expectRect(c as TestNode, 0, 260, 20, 40);
  });

  it('space-around gives every child half a share on each side', () => {
    const [a, b, c] = build('space-around');
    expectRect(a as TestNode, 0, 30, 20, 40);
    expectRect(b as TestNode, 0, 130, 20, 40);
    expectRect(c as TestNode, 0, 230, 20, 40);
  });

  it('space-evenly gives every gap the same size', () => {
    const [a, b, c] = build('space-evenly');
    expectRect(a as TestNode, 0, 45, 20, 40);
    expectRect(b as TestNode, 0, 130, 20, 40);
    expectRect(c as TestNode, 0, 215, 20, 40);
  });

  it('treats a single child with space-between as start-aligned', () => {
    const a = fixed(20, 40);
    const root = vertical({ justifyContent: 'space-between' }, [a], { width: 100, height: 300 });

    layout(root, loose(300, 400));

    expectRect(a, 0, 0, 20, 40);
  });

  it('falls back to start when the children overflow the content box', () => {
    const a = fixed(20, 200);
    const b = fixed(20, 200);
    const root = vertical({ justifyContent: 'center' }, [a, b], { width: 100, height: 300 });

    layout(root, loose(300, 400));

    expectRect(a, 0, 0, 20, 200);
    expectRect(b, 0, 200, 20, 200);
  });
});

describe('box: alignItems and alignSelf', () => {
  const build = (options: BoxLayoutOptions): { a: TestNode; b: TestNode } => {
    const a = fixed(40, 20);
    const b = fixed(60, 30);
    const root = box({ direction: 'vertical', ...options }, [a, b], { width: 200, height: 200 });
    layout(root, loose(300, 300));
    return { a, b };
  };

  it('start lines the children up with the content box start', () => {
    const { a, b } = build({ alignItems: 'start' });
    expectRect(a, 0, 0, 40, 20);
    expectRect(b, 0, 20, 60, 30);
  });

  it('center centers the children inside the line', () => {
    const { a, b } = build({ alignItems: 'center' });
    expectRect(a, 80, 0, 40, 20);
    expectRect(b, 70, 20, 60, 30);
  });

  it('end lines the children up with the line end', () => {
    const { a, b } = build({ alignItems: 'end' });
    expectRect(a, 160, 0, 40, 20);
    expectRect(b, 140, 20, 60, 30);
  });

  it('stretch fills the cross axis with the line cross size only', () => {
    const { a, b } = build({ alignItems: 'stretch' });
    expectRect(a, 0, 0, 200, 20);
    expectRect(b, 0, 20, 200, 30);
  });

  it('defaults to stretch', () => {
    const a = fixed(40, 20);
    const root = box({ direction: 'vertical' }, [a], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 200, 20);
  });

  it('lets `alignSelf` override `alignItems` per child', () => {
    const a = fixed(40, 20, { alignSelf: 'start' });
    const b = fixed(40, 20, { alignSelf: 'end' });
    const c = fixed(40, 20, { alignSelf: 'stretch' });
    const d = fixed(40, 20);
    const root = vertical({ alignItems: 'center' }, [a, b, c, d], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 40, 20);
    expectRect(b, 160, 20, 40, 20);
    expectRect(c, 0, 40, 200, 20);
    expectRect(d, 80, 60, 40, 20);
  });

  it('does not stretch the main axis, only the cross axis', () => {
    const a = auto(40, 20, { alignSelf: 'stretch' });
    const root = horizontal({ alignItems: 'start' }, [a], { width: 300, height: 50 });

    layout(root, loose(400, 400));

    expectRect(a, 0, 0, 40, 50);
  });
});

describe('box: margins', () => {
  it('offsets a child by its numeric margin and grows the container by it', () => {
    const a = fixed(40, 20, { margin: 8 });
    const root = vertical({}, [a], { width: 200 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 200, 36);
    expectRect(a, 8, 8, 40, 20);
  });

  it('supports the [vertical, horizontal] margin shorthand', () => {
    const a = fixed(40, 20, { margin: [10, 20] });
    const root = vertical({}, [a], { width: 200 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 200, 40);
    expectRect(a, 20, 10, 40, 20);
  });

  it('supports partial margin objects', () => {
    const a = fixed(40, 20, { margin: { top: 5, left: 15 } });
    const root = vertical({}, [a], { width: 200 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 200, 25);
    expectRect(a, 15, 5, 40, 20);
  });

  it('treats the margin box as the flex item size when growing', () => {
    const a = fixed(100, 20, { grow: 1, margin: { left: 10 } });
    const b = fixed(100, 20);
    const root = horizontal({}, [a, b], { width: 300, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    // outer sizes are 110 and 100, so `a` grows into the 90px of leftover space.
    expectRect(a, 10, 0, 190, 20);
    expectRect(b, 200, 0, 100, 20);
  });

  it('aligns the margin box, not the border box', () => {
    const a = fixed(40, 20, { alignSelf: 'center', margin: { left: 20 } });
    const root = vertical({ alignItems: 'start' }, [a], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    // outer width is 60, centered at (200 − 60) / 2 = 70 → border box starts at 70 + 20.
    expectRect(a, 90, 0, 40, 20);
  });

  it('stretches the border box inside the margins', () => {
    const a = fixed(40, 20, { margin: { left: 15, right: 25 } });
    const root = vertical({ alignItems: 'stretch' }, [a], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 15, 0, 160, 20);
  });
});

describe('box: grow', () => {
  it('splits the leftover space proportionally to the grow weights', () => {
    const a = fixed(40, 20, { grow: 1 });
    const b = fixed(40, 20, { grow: 2 });
    const root = horizontal({}, [a, b], { width: 300, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 40 + 220 / 3, 20);
    expectRect(b, 40 + 220 / 3, 0, 40 + 440 / 3, 20);
  });

  it('splits a tiny leftover space between equal weights', () => {
    const a = fixed(40, 20, { grow: 1 });
    const b = fixed(40, 20, { grow: 1 });
    const root = horizontal({}, [a, b], { width: 81, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 40.5, 20);
    expectRect(b, 40.5, 0, 40.5, 20);
  });

  it('leaves children without a grow weight alone', () => {
    const a = fixed(40, 20);
    const b = fixed(40, 20, { grow: 1 });
    const root = horizontal({}, [a, b], { width: 200, height: 50 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 40, 20);
    expectRect(b, 40, 0, 160, 20);
  });

  it('grows along a vertical main axis', () => {
    const a = fixed(30, 40, { grow: 1 });
    const b = fixed(30, 40);
    const root = vertical({}, [a, b], { width: 100, height: 200 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 30, 160);
    expectRect(b, 0, 160, 30, 40);
  });

  it('grows with three different weights', () => {
    const a = fixed(0, 20, { grow: 1 });
    const b = fixed(0, 20, { grow: 2 });
    const c = fixed(0, 20, { grow: 5 });
    const root = horizontal({}, [a, b, c], { width: 80, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 10, 20);
    expectRect(b, 10, 0, 20, 20);
    expectRect(c, 30, 0, 50, 20);
  });

  it('does not grow when the line exactly fits', () => {
    const a = fixed(100, 20, { grow: 1 });
    const b = fixed(200, 20, { grow: 1 });
    const root = horizontal({}, [a, b], { width: 300, height: 50 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 100, 20);
    expectRect(b, 100, 0, 200, 20);
  });
});

describe('box: main-axis fill', () => {
  it('treats `fill` as grow: 1 with a base size of 0', () => {
    const a = fixed(100, 20);
    const b = leaf({ width: 'fill', height: 20 });
    const root = horizontal({}, [a, b], { width: 300, height: 50 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 100, 20);
    expectRect(b, 100, 0, 200, 20);
  });

  it('lets an explicit grow weight win over the implicit fill weight', () => {
    const a = leaf({ width: 'fill', height: 20, grow: 2 });
    const b = leaf({ width: 'fill', height: 20 });
    const root = horizontal({}, [a, b], { width: 300, height: 50 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 200, 20);
    expectRect(b, 200, 0, 100, 20);
  });

  it('fills the cross axis when `fill` names the cross axis', () => {
    const a = leaf({ height: 'fill', minHeight: 0 });
    const root = vertical({ alignItems: 'start' }, [a], { width: 200, height: 120 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 0, 120);
  });

  it('gives a `fill` child on the main axis the whole leftover space', () => {
    const a = leaf({ width: 'fill', height: 20 });
    const root = horizontal({}, [a], { width: 250, height: 50 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 250, 20);
  });
});

describe('box: shrink', () => {
  it('shrinks overflowing children proportionally to their weights', () => {
    const a = fixed(200, 20, { shrink: 1 });
    const b = fixed(200, 20, { shrink: 1 });
    const root = horizontal({}, [a, b], { width: 200, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 100, 20);
    expectRect(b, 100, 0, 100, 20);
  });

  it('weights the shrink factor by the base size', () => {
    const a = fixed(200, 20, { shrink: 1 });
    const b = fixed(100, 20, { shrink: 2 });
    const root = horizontal({}, [a, b], { width: 200, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    // weights are 1×200 and 2×100; the 100px deficit is shared equally → 150 and 50.
    expectRect(a, 0, 0, 150, 20);
    expectRect(b, 150, 0, 50, 20);
  });

  it('never shrinks a child below 0', () => {
    const a = fixed(10, 20, { shrink: 100 });
    const b = fixed(200, 20, { shrink: 1 });
    const root = horizontal({}, [a, b], { width: 50, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 0, 20);
    expectRect(b, 0, 0, 200 - 160 / 6, 20);
  });

  it('lets children overflow when no shrink weight is declared', () => {
    const a = fixed(200, 20);
    const b = fixed(200, 20);
    const root = horizontal({}, [a, b], { width: 100, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 200, 20);
    expectRect(b, 200, 0, 200, 20);
  });

  it('shrinks on a vertical main axis', () => {
    const a = fixed(30, 150, { shrink: 1 });
    const b = fixed(30, 150, { shrink: 1 });
    const root = vertical({}, [a, b], { width: 100, height: 100 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 30, 50);
    expectRect(b, 0, 50, 30, 50);
  });
});

describe('box: wrap', () => {
  it('starts a new line when the next child no longer fits', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const c = fixed(80, 20);
    const root = horizontal({ wrap: true, columnGap: 5, rowGap: 10 }, [a, b, c], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 80, 20);
    expectRect(b, 85, 0, 80, 20);
    expectRect(c, 0, 30, 80, 20);
  });

  it('keeps a single overflowing line when wrap is off', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const c = fixed(80, 20);
    const root = horizontal({ columnGap: 5 }, [a, b, c], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 80, 20);
    expectRect(b, 85, 0, 80, 20);
    expectRect(c, 170, 0, 80, 20);
  });

  it('measures a wrapped container as max line main × stacked line crosses', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const c = fixed(80, 20);
    const root = horizontal({ wrap: true, columnGap: 5, rowGap: 10 }, [a, b, c]);

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 165, 50);
    expectRect(a, 0, 0, 80, 20);
    expectRect(b, 85, 0, 80, 20);
    expectRect(c, 0, 30, 80, 20);
  });

  it('does not wrap when the main axis is unbounded', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const root = horizontal({ wrap: true, columnGap: 5 }, [a, b]);

    const { size } = layout(root, unbounded());

    expectSize(size, 165, 20);
    expectRect(b, 85, 0, 80, 20);
  });

  it('distributes the cross-axis leftover with alignContent center', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const c = fixed(80, 20);
    const root = horizontal({ wrap: true, rowGap: 10, alignContent: 'center' }, [a, b, c], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    // lines occupy 20 + 10 + 20 = 50 of the 200px cross extent → 75px of leading space.
    expectRect(a, 0, 75, 80, 20);
    expectRect(b, 80, 75, 80, 20);
    expectRect(c, 0, 105, 80, 20);
  });

  it('distributes the cross-axis leftover with alignContent end', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const c = fixed(80, 20);
    const root = horizontal({ wrap: true, rowGap: 10, alignContent: 'end' }, [a, b, c], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(a, 0, 150, 80, 20);
    expectRect(c, 0, 180, 80, 20);
  });

  it('distributes the cross-axis leftover with alignContent space-between', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const c = fixed(80, 20);
    const root = horizontal({ wrap: true, rowGap: 10, alignContent: 'space-between' }, [a, b, c], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 80, 20);
    expectRect(c, 0, 180, 80, 20);
  });

  it('grows the children of each line independently', () => {
    const a = fixed(80, 20, { grow: 1 });
    const b = fixed(80, 20, { grow: 1 });
    const c = fixed(80, 20, { grow: 1 });
    const root = horizontal({ wrap: true, columnGap: 10, rowGap: 10 }, [a, b, c], {
      width: 200,
      height: 200,
    });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 95, 20);
    expectRect(b, 105, 0, 95, 20);
    expectRect(c, 0, 30, 200, 20);
  });

  it('wraps along a vertical main axis, stacking the lines sideways', () => {
    const a = fixed(20, 40);
    const b = fixed(20, 40);
    const c = fixed(20, 40);
    const root = vertical({ wrap: true }, [a, b, c], { height: 100 });

    const { size } = layout(root, loose(300, 300));

    // 100px of main extent fits two 40px children; the third starts a line to the right.
    expectSize(size, 40, 100);
    expectRect(a, 0, 0, 20, 40);
    expectRect(b, 0, 40, 20, 40);
    expectRect(c, 20, 0, 20, 40);
  });

  it('uses the cross-axis gap between wrapped lines', () => {
    const a = fixed(20, 40);
    const b = fixed(20, 40);
    const root = vertical({ wrap: true, rowGap: 30, columnGap: 7 }, [a, b], { height: 100 });

    layout(root, loose(300, 300));

    // rowGap is the main-axis gap (40 + 30 = 70 still fits), columnGap separates the two lines.
    expectRect(a, 0, 0, 20, 40);
    expectRect(b, 27, 0, 20, 40);
  });

  it('aligns each line along the main axis with justifyContent', () => {
    const a = fixed(80, 20);
    const b = fixed(80, 20);
    const root = horizontal({ wrap: true, justifyContent: 'end' }, [a, b], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(a, 40, 0, 80, 20);
    expectRect(b, 120, 0, 80, 20);
  });
});

describe('box: order and reverse', () => {
  it('sorts children by `order`, keeping declaration order for ties', () => {
    const a = fixed(20, 20, { order: 1 });
    const b = fixed(20, 20, { order: 0 });
    const c = fixed(20, 20, { order: 1 });
    const root = vertical({}, [a, b, c], { width: 100 });

    layout(root, loose(300, 300));

    expectRect(b, 0, 0, 20, 20);
    expectRect(a, 0, 20, 20, 20);
    expectRect(c, 0, 40, 20, 20);
  });

  it('sorts by `order` with non-zero orders and equal values', () => {
    const a = fixed(20, 20, { order: 5 });
    const b = fixed(20, 20, { order: -1 });
    const c = fixed(20, 20, { order: 5 });
    const root = vertical({}, [a, b, c], { width: 100 });

    layout(root, loose(300, 300));

    expectRect(b, 0, 0, 20, 20);
    expectRect(a, 0, 20, 20, 20);
    expectRect(c, 0, 40, 20, 20);
  });

  it('reverses the visual order of the flow', () => {
    const a = fixed(20, 20);
    const b = fixed(20, 30);
    const c = fixed(20, 40);
    const root = vertical({ reverse: true }, [a, b, c], { width: 100 });

    layout(root, loose(300, 300));

    expectRect(c, 0, 0, 20, 40);
    expectRect(b, 0, 40, 20, 30);
    expectRect(a, 0, 70, 20, 20);
  });

  it('applies `order` before `reverse`', () => {
    const a = fixed(20, 20, { order: 1 });
    const b = fixed(20, 30, { order: 0 });
    const root = vertical({ reverse: true }, [a, b], { width: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 20, 20);
    expectRect(b, 0, 20, 20, 30);
  });

  it('reverses a horizontal flow too', () => {
    const a = fixed(30, 20);
    const b = fixed(40, 20);
    const root = horizontal({ reverse: true }, [a, b], { height: 50 });

    layout(root, loose(300, 300));

    expectRect(b, 0, 0, 40, 20);
    expectRect(a, 40, 0, 30, 20);
  });
});

describe('box: out-of-flow children', () => {
  it('skips children with inFlow false and ignores them for sizing', () => {
    const hidden = auto(10, 10);
    hidden.inFlow = false;
    const normal = fixed(20, 20);
    const root = vertical({}, [hidden, normal], { width: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 100, 20);
    expect(hidden.arranged).toBeNull();
    expectRect(normal, 0, 0, 20, 20);
  });

  it('skips hidden children even with hideMode keep, because inFlow drives the flow', () => {
    const hidden = auto(10, 10, { hideMode: 'keep' });
    hidden.inFlow = false;
    const normal = fixed(20, 20);
    const root = vertical({}, [hidden, normal], { width: 100 });

    layout(root, loose(300, 300));

    expect(hidden.arranged).toBeNull();
    expectRect(normal, 0, 0, 20, 20);
  });

  it('skips absolute children in the flow but positions them afterwards', () => {
    const absoluteChild = auto(12, 12, { position: 'absolute', left: 5, top: 7 });
    const normal = auto(20, 20);
    const root = vertical({}, [absoluteChild, normal]);

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 20, 20);
    expectRect(normal, 0, 0, 20, 20);
    expectRect(absoluteChild, 5, 7, 12, 12);
  });

  it('keeps an absolute child out of the measured size of a fixed container', () => {
    const absoluteChild = auto(200, 200, { position: 'absolute' });
    const normal = auto(20, 30);
    const root = vertical({}, [normal, absoluteChild], { width: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 100, 30);
    // The absolutely positioned child keeps its content size, clamped to the content box.
    expectRect(absoluteChild, 0, 0, 100, 200);
  });

  it('orders absolute children out of the flow order', () => {
    const first = fixed(10, 10, { order: 9 });
    const second = fixed(10, 10, { order: 1, position: 'absolute', left: 3, top: 4 });
    const root = vertical({}, [first, second], { width: 100, height: 100 });

    layout(root, loose(300, 300));

    expectRect(first, 0, 0, 10, 10);
    expectRect(second, 3, 4, 10, 10);
  });
});

describe('box: percentage sizing', () => {
  it('resolves a percentage width against the parent content box', () => {
    const a = leaf({ width: '50%', height: 20 });
    const b = fixed(50, 20);
    const root = horizontal({}, [a, b], { width: 400, height: 50 });

    layout(root, loose(500, 500));

    expectRect(a, 0, 0, 200, 20);
    expectRect(b, 200, 0, 50, 20);
  });

  it('resolves a percentage height against the parent content box', () => {
    const a = leaf({ width: 30, height: '50%' });
    const root = vertical({}, [a], { width: 100, height: 200 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 30, 100);
  });

  it('resolves percentages against the content box, not the border box', () => {
    const a = leaf({ width: '50%', height: 20 });
    const root = horizontal({}, [a], { width: 300, height: 100, padding: 20 });

    layout(root, loose(400, 400));

    expectRect(a, 20, 20, 130, 20);
  });

  it('resolves percentages against a tight content box', () => {
    const a = leaf({ width: '25%', height: 20 });
    const root = horizontal({}, [a]);

    const { size } = layout(root, tight(400, 200));

    expectSize(size, 400, 200);
    expectRect(a, 0, 0, 100, 20);
  });

  it('falls back to the content size while measuring when the percent base is unbounded', () => {
    const a = leaf({ width: '50%', height: '50%' }, { width: 30, height: 40 });
    const root = horizontal({}, [a]);

    const { size } = layout(root, unbounded());

    // Measure sees an unbounded base, so the child reports its content size and the auto-sized
    // parent shrink-wraps around it; the arrange pass then resolves the percentage against the
    // actual (now bounded) content box, which is the documented two-pass behaviour.
    expectSize(size, 30, 40);
    expectRect(a, 0, 0, 15, 20);
  });

  it('resolves a percentage against the constraint while measuring, then the actual box', () => {
    const a = leaf({ width: '50%', height: 20 });
    const root = horizontal({}, [a], { height: 50 });

    const { size } = layout(root, loose(120, 200));

    // The 120px constraint is the percent base during measure (→ 60px content), so the auto-width
    // parent ends up 60px wide; in arrange the same child resolves against that final 60px box.
    expectSize(size, 60, 50);
    expectRect(a, 0, 0, 30, 20);
  });

  it('combines a percentage basis with grow', () => {
    const a = leaf({ width: '50%', height: 20, grow: 1 });
    const b = fixed(100, 20);
    const root = horizontal({}, [a, b], { width: 400, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    // base sizes are 200 and 100 → leftover 100 all goes to the growing child.
    expectRect(a, 0, 0, 300, 20);
    expectRect(b, 300, 0, 100, 20);
  });
});

describe('box: min and max constraints', () => {
  it('raises an auto-sized child to its minWidth', () => {
    const a = auto(30, 20, { minWidth: 80 });
    const root = horizontal({}, [a], { height: 50 });

    const { size } = layout(root, loose(200, 200));

    expectSize(size, 80, 50);
    expectRect(a, 0, 0, 80, 20);
  });

  it('caps a percentage width with maxWidth', () => {
    const a = leaf({ width: '50%', height: 20, maxWidth: 80 });
    const root = horizontal({}, [a], { width: 400, height: 50 });

    layout(root, loose(500, 500));

    expectRect(a, 0, 0, 80, 20);
  });

  it('applies the min/max carried by a {value, min, max} length', () => {
    const a = leaf({ width: { value: '50%', min: 10, max: 80 }, height: 20 });
    const root = horizontal({}, [a], { width: 400, height: 50 });

    layout(root, loose(500, 500));

    expectRect(a, 0, 0, 80, 20);
  });

  it('raises a {value, min, max} length to its min', () => {
    const a = leaf({ width: { value: '10%', min: 60 }, height: 20 });
    const root = horizontal({}, [a], { width: 400, height: 50 });

    layout(root, loose(500, 500));

    expectRect(a, 0, 0, 60, 20);
  });

  it('clamps the main-axis size with minHeight and maxHeight', () => {
    const a = auto(30, 20, { minHeight: 60 });
    const b = auto(30, 20, { maxHeight: 5 });
    const root = vertical({}, [a, b], { width: 100 });

    const { size } = layout(root, loose(200, 300));

    expectSize(size, 100, 65);
    expectRect(a, 0, 0, 30, 60);
    expectRect(b, 0, 60, 30, 5);
  });

  it('grows an auto-sized container to fit a child with a larger minWidth', () => {
    const a = auto(30, 20, { minWidth: 300 });
    const root = horizontal({}, [a], { height: 50 });

    const { size } = layout(root, loose(400, 400));

    expectSize(size, 300, 50);
    expectRect(a, 0, 0, 300, 20);
  });
});

describe('box: nested containers', () => {
  it('sizes a nested box from its children and stretches it with the parent', () => {
    const inner = vertical({}, [fixed(30, 10), fixed(50, 20)], { width: 'fill' });
    const sibling = fixed(40, 15);
    const root = vertical({ gap: 5 }, [inner, sibling], { width: 200 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 200, 50);
    expectRect(inner, 0, 0, 200, 30);
    expectRect(sibling, 0, 35, 40, 15);
  });

  it('does not force an auto nested box to fill a fixed parent', () => {
    const inner = vertical({}, [auto(40, 20)]);
    const root = vertical({ alignItems: 'start' }, [inner], { width: 400, height: 300 });

    const { size } = layout(root, tight(400, 300));

    expectSize(size, 400, 300);
    expectRect(inner, 0, 0, 40, 20);
  });

  it('keeps a single auto child at its content size inside a fixed parent', () => {
    const child = auto(40, 20);
    const root = vertical({ alignItems: 'start' }, [child], { width: 400, height: 300 });

    layout(root, tight(400, 300));

    expectRect(child, 0, 0, 40, 20);
  });

  it('centers a content-sized child inside a fixed parent', () => {
    const child = auto(40, 20);
    const root = vertical({ justifyContent: 'center', alignItems: 'start' }, [child], {
      width: 400,
      height: 300,
    });

    layout(root, tight(400, 300));

    expectRect(child, 0, 140, 40, 20);
  });

  it('stretches only the cross axis of a fixed parent', () => {
    const child = auto(40, 20);
    const root = vertical({ alignItems: 'stretch' }, [child], { width: 400, height: 300 });

    layout(root, tight(400, 300));

    expectRect(child, 0, 0, 400, 20);
  });

  it('uses `basis` as the initial main size, like CSS flex-basis', () => {
    const a = fixed(40, 20, { basis: 100 });
    const b = fixed(40, 20, { basis: 300 });
    const root = horizontal({}, [a, b], { width: 400, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    // Nothing grows or shrinks, so each child keeps its basis as its main-axis size.
    expectRect(a, 0, 0, 100, 20);
    expectRect(b, 100, 0, 300, 20);
  });

  it('distributes the leftover space on top of the basis', () => {
    const a = fixed(40, 20, { basis: 100, grow: 1 });
    const b = fixed(40, 20, { basis: 100 });
    const root = horizontal({}, [a, b], { width: 400, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 300, 20);
    expectRect(b, 300, 0, 100, 20);
  });

  it('resolves a percentage basis against the content box', () => {
    const a = fixed(40, 20, { basis: '50%' });
    const b = fixed(40, 20);
    const root = horizontal({}, [a, b], { width: 400, height: 50 });

    layout(root, loose(1000, 1000), exactEngine());

    expectRect(a, 0, 0, 200, 20);
    expectRect(b, 200, 0, 40, 20);
  });

  it('reports every child rect through the harness, not the engine pool', () => {
    const a = fixed(10, 10);
    const root = vertical({}, [a], { width: 50, height: 50 });

    layout(root, loose(100, 100));

    expect(rectOf(a)).not.toBe(rectOf(root));
    expect(rectOf(a)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('box: stretch honours the child cross-axis clamps', () => {
  it('keeps maxWidth inside a stretching container', () => {
    const child = leaf({ width: 40, height: 20, maxWidth: 50 });
    const root = box('vertical', [child], { width: 200 });

    layout(root, loose(300, 300));

    // Both passes must agree: the measure pass clamps to 50, so the arrange pass hands out 50 too.
    expect(rectOf(child).width).toBeCloseTo(50, 6);
  });

  it('keeps minWidth inside a stretching container, overflowing instead of shrinking', () => {
    const child = leaf({ width: 40, height: 20, minWidth: 120 });
    const root = box('vertical', [child], { width: 80 });

    layout(root, loose(300, 300));

    // The line is only 80 wide, but the child's own minimum is a floor the container cannot take
    // away - the same 120 the measure pass computes.
    expect(rectOf(child).width).toBeCloseTo(120, 6);
  });

  it('honours a { value, min, max } clamp on a stretched child', () => {
    const child = leaf({ width: { value: 'fill', max: 60 }, height: 20 });
    const root = box('vertical', [child], { width: 200 });

    layout(root, loose(300, 300));

    expect(rectOf(child).width).toBeCloseTo(60, 6);
  });
});
