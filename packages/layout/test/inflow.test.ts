/**
 * `hideMode`: collapse (the default) versus keeping a hidden node's slot.
 *
 * The layout engine only ever looks at `LayoutNode#inFlow`, so the decision lives in one pure
 * function. `Widget#inFlow` calls it with the node's own `visible` and `hideMode`; these tests pin both
 * the decision and what it does to the surrounding flow (the reason the option exists).
 */

import { describe, expect, it } from 'vitest';
import { inFlowOf } from '../src/params';
import type { LayoutParams } from '../src/params';
import type { TestNode } from './harness';
import { loose } from '../src/constraint';
import { box, expectRect, layout, leaf } from './harness';

/** A child of a fixed size whose flow participation follows `hideMode`. */
function child(
  width: number,
  height: number,
  visible: boolean,
  params: LayoutParams = {},
): TestNode {
  const node = leaf({ width, height, ...params });
  node.inFlow = inFlowOf(visible, node.layoutParams.hideMode);
  return node;
}

describe('inFlowOf', () => {
  it('collapses a hidden node by default', () => {
    expect(inFlowOf(false)).toBe(false);
    expect(inFlowOf(false, 'collapse')).toBe(false);
  });

  it('keeps a hidden node in the flow when asked', () => {
    expect(inFlowOf(false, 'keep')).toBe(true);
  });

  it('never removes a visible node', () => {
    expect(inFlowOf(true, 'keep')).toBe(true);
    expect(inFlowOf(true, 'collapse')).toBe(true);
  });
});

describe('hideMode in a box', () => {
  it('moves the next sibling up when a hidden child collapses', () => {
    const root = box({ direction: 'horizontal', gap: 10, alignItems: 'start' }, [
      child(30, 20, true),
      child(40, 20, false),
      child(50, 20, true),
    ]);

    layout(root, loose(400, 200));

    expectRect(root.children[2] as TestNode, 40, 0, 50, 20);
  });

  it('keeps the slot when the hidden child asks for `hideMode: keep`', () => {
    const root = box({ direction: 'horizontal', gap: 10, alignItems: 'start' }, [
      child(30, 20, true),
      child(40, 20, false, { hideMode: 'keep' }),
      child(50, 20, true),
    ]);

    layout(root, loose(400, 200));

    // 30 (first) + 10 (gap) + 40 (kept slot) + 10 (gap) = 90: the third child did not move.
    expectRect(root.children[2] as TestNode, 90, 0, 50, 20);
  });

  it('keeps a vertical slot too, and the kept node itself is still placed', () => {
    const middle = child(80, 24, false, { hideMode: 'keep' });
    const root = box({ direction: 'vertical', gap: 6, alignItems: 'start' }, [
      child(80, 20, true),
      middle,
      child(80, 20, true),
    ]);

    layout(root, loose(400, 200));

    expectRect(middle, 0, 26, 80, 24);
    expectRect(root.children[2] as TestNode, 0, 56, 80, 20);
  });

  it('measures a kept node normally, unlike a collapsed one', () => {
    // The slot has to come from somewhere: the node keeps reporting its content size.
    const kept = child(40, 20, false, { hideMode: 'keep' });
    const collapsed = child(40, 20, false, { hideMode: 'collapse' });
    const root = box({ direction: 'horizontal', gap: 0 }, [kept, collapsed, child(10, 10, true)]);

    layout(root, loose(400, 200));

    expect(kept.measureCount).toBeGreaterThan(0);
    expect(collapsed.measureCount).toBe(0);
  });
});
