/**
 * `LayoutEngine`: measurement caching, dirty propagation, relayout boundaries, snapping and the
 * two-pass contract itself.
 *
 * The statistics counters are asserted as *deltas* between two `layout()` calls, which is the only
 * stable way to express "this subtree was not measured again" without hard-coding the whole tree.
 */

import { describe, expect, it } from 'vitest';
import { loose, tight, unbounded } from '../src/constraint';
import { LayoutEngine, measureNodeOnce } from '../src/engine';
import type { LayoutEngineStats } from '../src/engine';
import type { LayoutParams } from '../src/params';
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

function counters(engine: LayoutEngine): LayoutEngineStats {
  return { ...engine.stats };
}

function delta(
  before: LayoutEngineStats,
  after: LayoutEngineStats,
  key: keyof LayoutEngineStats,
): number {
  return after[key] - before[key];
}

/** A two-child vertical box, the standard fixture for the caching tests. */
function tree(): { root: TestNode; first: TestNode; second: TestNode } {
  const first = auto(40, 20);
  const second = auto(40, 20);
  const root = box('vertical', [first, second], { width: 200 });
  return { root, first, second };
}

describe('engine: two-pass layout', () => {
  it('returns the measured root size and arranges the root at the origin', () => {
    const { root } = tree();

    const { size, engine } = layout(root, loose(300, 300));

    expectSize(size, 200, 40);
    expect(rectOf(root)).toEqual({ x: 0, y: 0, width: 200, height: 40 });
    expect(engine.stats.passes).toBe(1);
  });

  it('records every pass in the statistics', () => {
    const { root } = tree();

    const { engine } = layout(root, loose(300, 300));

    expect(engine.stats.passes).toBe(1);
    expect(engine.stats.measureCalls).toBe(5);
    expect(engine.stats.placedChildren).toBe(2);
    expect(engine.stats.arrangeCalls).toBe(3);
    expect(engine.stats.skippedSubtrees).toBe(0);
  });

  it('fills the measured size of a leaf through a custom measure function', () => {
    const child = leaf({ width: 100, height: 30 }, { width: 10, height: 10 });
    const root = box('vertical', [child], { width: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 100, 30);
  });
});

describe('engine: measurement cache', () => {
  it('answers a repeated layout from the cache', () => {
    const { root } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    const before = counters(engine);

    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    expect(delta(before, after, 'measureCalls')).toBe(0);
    expect(delta(before, after, 'cacheHits')).toBe(1);
    expect(delta(before, after, 'placedChildren')).toBe(2);
  });

  it('skips clean subtrees whose rect did not change', () => {
    const { root } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    const before = counters(engine);

    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    expect(delta(before, after, 'skippedSubtrees')).toBe(2);
    expect(delta(before, after, 'arrangeCalls')).toBe(1);
  });

  it('misses the cache when the constraint changes', () => {
    const root = box('vertical', [auto(40, 20), auto(40, 20)]);
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    const before = counters(engine);

    layout(root, loose(150, 300), engine);
    const after = counters(engine);

    expect(delta(before, after, 'measureCalls')).toBeGreaterThan(0);
  });

  it('re-measures a node whose revision changed', () => {
    const child = auto(40, 20);
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(child, loose(100, 100), engine);
    layout(child, loose(100, 100), engine);
    const before = counters(engine);
    expect(delta(before, before, 'measureCalls')).toBe(0);

    child.revision += 1;
    layout(child, loose(100, 100), engine);
    const after = counters(engine);

    expect(delta(before, after, 'measureCalls')).toBe(1);
  });

  it('keeps the cached size while the revision is unchanged', () => {
    const child = auto(40, 20);
    const engine = new LayoutEngine({ snapMode: 'none' });
    const first = layout(child, loose(100, 100), engine);
    const second = layout(child, loose(100, 100), engine);

    expectSize(first.size, 40, 20);
    expectSize(second.size, 40, 20);
  });

  it('drops the whole subtree from the cache with reset(node)', () => {
    const { root } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    engine.reset(root);
    const before = counters(engine);

    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    // "Subtree" means the node *and* its descendants: a global font change invalidates every measured
    // text, so leaving the children's cache entries in place would keep their stale sizes forever.
    expect(delta(before, after, 'measureCalls')).toBe(5);
    expect(delta(before, after, 'cacheHits')).toBe(0);
  });

  it('drops every cache with reset()', () => {
    const { root } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    engine.reset();
    const before = counters(engine);

    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    expect(delta(before, after, 'measureCalls')).toBe(5);
  });

  it('re-arranges after reset() even when no revision changed', () => {
    // What an external font/theme change looks like: the content size moved, the revision did not.
    const child = auto(40, 20);
    const root = box('vertical', [child], { width: 200 });
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, tight(200, 100), engine);
    // The box stretches its children across the cross axis, so only the height tracks the content.
    expectRect(child, 0, 0, 200, 20);

    child.contentSize.height = 50;
    engine.reset();
    layout(root, tight(200, 100), engine);

    expectRect(child, 0, 0, 200, 50);
  });

  it('re-arranges a subtree after reset(node)', () => {
    const child = auto(40, 20);
    const root = box('vertical', [child], { width: 200 });
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, tight(200, 100), engine);

    child.contentSize.height = 50;
    engine.reset(root);
    layout(root, tight(200, 100), engine);

    expectRect(child, 0, 0, 200, 50);
  });

  it('keys the cache by the percentage base as well as the constraint', () => {
    // The same constraint resolves `50%` differently against a different containing block, so a cache
    // entry that ignores the base answers the second call with the first call's width.
    const half = auto(0, 0, { width: '50%', height: 10 });
    const root = box('vertical', [half]);
    const engine = new LayoutEngine({ snapMode: 'none' });

    const wide = engine.layout(root, unbounded(), { width: 400, height: 300 });
    const narrow = engine.layout(root, unbounded(), { width: 100, height: 300 });

    expectSize(wide, 200, 10);
    expectSize(narrow, 50, 10);
  });

  it('keeps an invalidation raised during the pass for the next pass', () => {
    const first = auto(40, 20);
    const second = auto(40, 10);
    const root = box('vertical', [first, second]);
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);

    // `second` re-arranges during the pass (its content grew), and its `applyRect` invalidates the
    // sibling that was already arranged earlier in that same pass - a watcher reached from `applyRect`
    // behaves exactly like this. Nothing bumps `first.revision`: only the mark can save it.
    const originalApply = second.applyRect.bind(second);
    let invalidated = false;
    second.applyRect = (rect) => {
      originalApply(rect);
      if (!invalidated) {
        invalidated = true;
        first.contentSize.height = 60;
        engine.invalidate(first);
      }
    };
    second.contentSize.height = 30;
    engine.invalidate(second);

    layout(root, loose(300, 300), engine);

    // The mark has to survive the pass that was already running, otherwise the host sees "no pending
    // work" and never runs the pass that would heal `first`.
    expect(engine.hasDirtyNodes).toBe(true);
    expect(engine.isDirty(first)).toBe(true);

    second.applyRect = originalApply;
    layout(root, loose(300, 300), engine);

    expectRect(first, 0, 0, 40, 60);
    expect(engine.hasDirtyNodes).toBe(false);
  });

  it('does not let a caller corrupt the cache through the returned size', () => {
    const child = auto(40, 20);
    const engine = new LayoutEngine({ snapMode: 'none' });
    const first = layout(child, loose(100, 100), engine);
    first.size.width = 999;

    const second = layout(child, loose(100, 100), engine);

    expectSize(second.size, 40, 20);
  });

  it('treats a non-finite length as auto instead of spreading NaN into the rect', () => {
    const child = auto(40, 20, { width: Number.NaN });
    const root = box('vertical', [child], { width: Number.POSITIVE_INFINITY });

    const { size } = layout(root, loose(300, 300));

    // `width: NaN` and a non-finite container width are authoring mistakes; both fall back to the
    // measured content size, so every rect stays finite (hit testing and rendering depend on that).
    expectSize(size, 40, 20);
    expect(rectOf(child).width).toBeCloseTo(40, 6);
    expect(rectOf(root).width).toBeCloseTo(40, 6);
  });

  it('clamps a non-positive dpr to 1', () => {
    const child = auto(40, 20);
    const engine = new LayoutEngine({ dpr: 0 });
    layout(child, loose(100, 100), engine);

    expect(engine.dpr).toBe(1);
    expectRect(child, 0, 0, 40, 20);
  });

  it('releases the pooled contexts, so a detached subtree is not retained', () => {
    const chain = box('vertical', [box('vertical', [box('vertical', [auto(10, 10)])])]);
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(chain, loose(100, 100), engine);

    const pool = (engine as unknown as { contextPool: { node: unknown }[] }).contextPool;
    // The pool is indexed by nesting depth, so it holds one context per level — not one per visited
    // container — and every released context has dropped its strong references.
    expect(pool.length).toBeLessThanOrEqual(4);
    for (const ctx of pool) {
      expect(ctx.node).toBeNull();
    }
  });
});

describe('engine: invalidation', () => {
  it('marks the node and its ancestors dirty', () => {
    const { root, second } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);

    engine.invalidate(second);

    expect(engine.isDirty(second)).toBe(true);
    expect(engine.isDirty(root)).toBe(true);
  });

  it('clears the dirty marks after the next layout', () => {
    const { root, second } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    engine.invalidate(second);

    layout(root, loose(300, 300), engine);

    expect(engine.isDirty(second)).toBe(false);
    expect(engine.isDirty(root)).toBe(false);
  });

  it('re-measures only the dirty subtree', () => {
    const { root, first } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    engine.invalidate(first);
    const before = counters(engine);

    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    // root + first in the measure pass, plus the tight re-measure of `first` while arranging.
    expect(delta(before, after, 'measureCalls')).toBe(3);
    expect(delta(before, after, 'cacheHits')).toBe(1);
    expect(delta(before, after, 'skippedSubtrees')).toBe(1);
  });

  it('propagates a content change into the ancestor size', () => {
    const first = auto(40, 20);
    const second = auto(40, 20);
    const root = box({ direction: 'vertical', alignItems: 'start' }, [first, second], {
      width: 200,
    });
    const engine = new LayoutEngine({ snapMode: 'none' });
    const before = layout(root, loose(300, 300), engine);
    expectSize(before.size, 200, 40);

    first.contentSize = { width: 40, height: 50 };
    first.revision += 1;
    engine.invalidate(first);
    const after = layout(root, loose(300, 300), engine);

    expectSize(after.size, 200, 70);
    expectRect(first, 0, 0, 40, 50);
    expectRect(second, 0, 50, 40, 20);
  });

  it('reports pending work through hasDirtyNodes even when the root stays clean', () => {
    const child = auto(40, 20);
    const boundary = box('vertical', [child], { width: 120 });
    boundary.isRelayoutBoundary = true;
    const root = box('vertical', [boundary], { width: 200 });
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);

    // Clean after a pass: nothing to do.
    expect(engine.hasDirtyNodes).toBe(false);

    engine.invalidate(child);

    // The boundary hides the change from the root, but the host still has to know that a pass is
    // required — this is the contract `UIRoot.flushLayout()` relies on.
    expect(engine.isDirty(root)).toBe(false);
    expect(engine.hasDirtyNodes).toBe(true);

    layout(root, loose(300, 300), engine);
    expect(engine.hasDirtyNodes).toBe(false);
  });

  it('stops the upward walk at a relayout boundary', () => {
    const child = auto(40, 20);
    const boundary = box('vertical', [child], { width: 120 });
    boundary.isRelayoutBoundary = true;
    const root = box('vertical', [boundary], { width: 200 });
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);

    engine.invalidate(child);

    expect(engine.isDirty(child)).toBe(true);
    expect(engine.isDirty(boundary)).toBe(true);
    expect(engine.isDirty(root)).toBe(false);
  });

  it('re-measures only the boundary subtree after an invalidation inside it', () => {
    const child = auto(40, 20);
    const boundary = box('vertical', [child], { width: 120 });
    boundary.isRelayoutBoundary = true;
    const root = box('vertical', [boundary], { width: 200 });
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);
    engine.invalidate(child);
    const before = counters(engine);

    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    // The root answered from the cache (one cache hit) and only the boundary subtree re-measured:
    // the boundary plus the two measurements of the child (measure pass and tight arrange pass).
    expect(delta(before, after, 'measureCalls')).toBe(3);
    expect(delta(before, after, 'cacheHits')).toBe(1);
  });

  it('costs less to invalidate below a relayout boundary than without one', () => {
    const cost = (isBoundary: boolean): number => {
      const child = auto(40, 20);
      const boundary = box('vertical', [child], { width: 120 });
      boundary.isRelayoutBoundary = isBoundary;
      const root = box('vertical', [boundary], { width: 200 });
      const engine = new LayoutEngine({ snapMode: 'none' });
      layout(root, loose(300, 300), engine);
      engine.invalidate(child);
      const before = counters(engine);
      layout(root, loose(300, 300), engine);
      return delta(before, counters(engine), 'measureCalls');
    };

    expect(cost(true)).toBeLessThan(cost(false));
  });

  it('ignores an invalidate on an already dirty node', () => {
    const { root, second } = tree();
    const engine = new LayoutEngine({ snapMode: 'none' });
    layout(root, loose(300, 300), engine);

    engine.invalidate(second);
    engine.invalidate(second);
    const before = counters(engine);
    layout(root, loose(300, 300), engine);
    const after = counters(engine);

    expect(delta(before, after, 'measureCalls')).toBe(3);
  });
});

describe('engine: pixel snapping', () => {
  const build = (): { root: TestNode; a: TestNode; b: TestNode } => {
    const a = fixed(10.4, 20);
    const b = fixed(5, 20);
    const root = box({ direction: 'horizontal', alignItems: 'start' }, [a, b], { height: 20 });
    return { root, a, b };
  };

  it('keeps sub-pixel geometry with snapMode none', () => {
    const { root, a, b } = build();

    layout(root, loose(300, 300), exactEngine());

    expectRect(a, 0, 0, 10.4, 20);
    expectRect(b, 10.4, 0, 5, 20);
  });

  it('rounds to whole device pixels at dpr 1', () => {
    const { root, a, b } = build();

    layout(root, loose(300, 300), new LayoutEngine());

    expectRect(a, 0, 0, 10, 20);
    expectRect(b, 10, 0, 5, 20);
  });

  it('rounds to half device pixels at dpr 2', () => {
    const { root, a, b } = build();
    const engine = new LayoutEngine({ dpr: 2 });

    layout(root, loose(300, 300), engine);

    expectRect(a, 0, 0, 10.5, 20);
    expectRect(b, 10.5, 0, 5, 20);
    expect(engine.stats.snappedRects).toBeGreaterThan(0);
  });

  it('floors to the device pixel grid at dpr 2', () => {
    const { root, a, b } = build();

    layout(root, loose(300, 300), new LayoutEngine({ dpr: 2, snapMode: 'floor' }));

    expectRect(a, 0, 0, 10, 20);
    expectRect(b, 10, 0, 5, 20);
  });

  it('ceils to the device pixel grid at dpr 2', () => {
    const { root, a } = build();

    layout(root, loose(300, 300), new LayoutEngine({ dpr: 2, snapMode: 'ceil' }));

    expectRect(a, 0, 0, 10.5, 20);
  });

  it('snaps the root rect as well', () => {
    const { root } = build();

    const { size } = layout(root, loose(300, 300), new LayoutEngine());

    expectSize(size, 15.4, 20);
    expectRect(root, 0, 0, 15, 20);
  });

  it('does not count snapped rects when snapping is off', () => {
    const { root } = build();

    const { engine } = layout(root, loose(300, 300), exactEngine());

    expect(engine.stats.snappedRects).toBe(0);
  });
});

describe('engine: params that interact with measurement', () => {
  it('derives the height from a fixed width and an aspect ratio', () => {
    const node = leaf({ width: 200, aspectRatio: 2 }, { width: 10, height: 10 });

    const { size } = layout(node, loose(400, 400));

    expectSize(size, 200, 100);
  });

  it('derives the width from a fixed height and an aspect ratio', () => {
    const node = leaf({ height: 100, aspectRatio: 0.5 }, { width: 10, height: 10 });

    const { size } = layout(node, loose(400, 400));

    expectSize(size, 50, 100);
  });

  it('applies an aspect ratio to a percentage width', () => {
    const node = leaf({ width: '50%', aspectRatio: 2 });

    const { size } = layout(node, loose(400, 400));

    expectSize(size, 200, 100);
  });

  it('clamps the derived height with maxHeight', () => {
    const node = leaf({ width: 200, aspectRatio: 2, maxHeight: 60 });

    const { size } = layout(node, loose(400, 400));

    expectSize(size, 200, 60);
  });

  it('clamps the width before deriving the height', () => {
    const node = leaf({ width: 50, minWidth: 200, aspectRatio: 2 });

    const { size } = layout(node, loose(400, 400));

    expectSize(size, 200, 100);
  });

  it('recomputes the derived size when the revision changes', () => {
    const node = leaf({ width: 200, aspectRatio: 2 }, { width: 10, height: 10 });
    const engine = new LayoutEngine({ snapMode: 'none' });
    const first = layout(node, loose(400, 400), engine);
    // The aspect ratio does not change the constraint, so only the revision can invalidate the
    // cached measurement.
    const before = counters(engine);

    node.layoutParams.aspectRatio = 4;
    node.revision += 1;
    const second = layout(node, loose(400, 400), engine);

    expectSize(first.size, 200, 100);
    expectSize(second.size, 200, 50);
    expect(delta(before, counters(engine), 'measureCalls')).toBe(1);
  });

  it('keeps minWidth and maxWidth in the measured size of a constrained leaf', () => {
    const node = leaf({ width: 10, minWidth: 60, maxWidth: 80 });

    const { size } = layout(node, loose(400, 400));

    expectSize(size, 60, 0);
  });

  it('lays out through the measureNodeOnce helper', () => {
    const engine = new LayoutEngine({ snapMode: 'none' });
    const node = auto(40, 20);

    const size = measureNodeOnce(engine, node, tight(50, 50));

    expectSize(size, 50, 50);
    expect(engine.stats.passes).toBe(1);
  });
});

describe('engine: constraints go down, sizes go up', () => {
  it('does not force an auto child to fill a tight parent', () => {
    const child = auto(40, 20);
    const root = box({ direction: 'vertical', alignItems: 'start' }, [child], {
      width: 400,
      height: 300,
    });

    layout(root, tight(400, 300));

    expectRect(child, 0, 0, 40, 20);
  });

  it('re-measures a placed child against its final rect', () => {
    const child = leaf({ width: 'fill', height: 'fill' }, { width: 5, height: 5 });
    const root = box({ direction: 'vertical', alignItems: 'stretch' }, [child], {
      width: 120,
      height: 80,
    });

    layout(root, tight(120, 80));

    expectRect(child, 0, 0, 120, 80);
  });

  it('lets alignSelf opt a child out of the container cross-axis stretch', () => {
    const child = leaf({ width: 30, height: 10, alignSelf: 'start' }, { width: 30, height: 10 });
    const stretched = leaf({ height: 10 }, { width: 30, height: 10 });
    const root = box({ direction: 'vertical', alignItems: 'stretch' }, [child, stretched], {
      width: 200,
      height: 200,
    });

    layout(root, tight(200, 200));

    expectRect(child, 0, 0, 30, 10);
    expectRect(stretched, 0, 10, 200, 10);
  });

  it('falls back to the leaf measurement for an empty container', () => {
    const empty = box('vertical', [], { width: 'fill', height: 'fill' });
    const root = box('vertical', [empty], { width: 100, height: 50 });

    layout(root, loose(200, 200));

    expectRect(empty, 0, 0, 100, 50);
  });

  it('lets an unbounded constraint reach the children', () => {
    const child = auto(40, 20);
    const root = box('vertical', [child]);

    const { size } = layout(root, unbounded());

    expectSize(size, 40, 20);
    expectRect(child, 0, 0, 40, 20);
  });
});
