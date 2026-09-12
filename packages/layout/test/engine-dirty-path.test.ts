/**
 * `LayoutEngine` — the dirty path through relayout boundaries.
 *
 * A change *below* a relayout boundary only marks the boundary (and its subtree) dirty; the
 * ancestors above it stay clean and answer from the measurement cache. That is the whole point of a
 * boundary. It used to break the arrange pass: `placeChildOf()` skips clean subtrees whose rect did
 * not change, so the walk from the root stopped at the first clean ancestor and never reached the
 * boundary — the freshly changed/attached nodes kept a `0×0` rect (invisible, unclickable) while the
 * measured sizes were perfectly correct.
 *
 * The engine now collects those ancestors in a separate `dirtyPath` set which relaxes nothing but
 * that skip: the measurement cache above the boundary must stay valid (asserted here), while the
 * arrange pass descends to the boundary again.
 */

import { describe, expect, it } from 'vitest';
import { loose } from '../src/constraint';
import { LayoutEngine } from '../src/engine';
import type { LayoutEngineStats } from '../src/engine';
import type { Axis } from '../src/params';
import type { LayoutParams } from '../src/params';
import type { BoxLayoutOptions, LayoutNode } from '../src/types';
import type { TestNode } from './harness';
import { box, exactEngine, expectRect, leaf, layout, rectOf } from './harness';

/** A child that sizes itself from its content. */
function auto(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf(params, { width, height });
}

/** A `box` that top-aligns its children, so they keep their own measured cross size. */
function vbox(children: readonly LayoutNode[], params?: LayoutParams): TestNode {
  const options: BoxLayoutOptions = { direction: 'vertical' as Axis, alignItems: 'start' };
  return box(options, children, params);
}

/** Adds a child to an existing test node (a structural change, the way a list grows). */
function attach(parent: TestNode, child: TestNode): void {
  (parent.children as TestNode[]).push(child);
  (child as { parent: LayoutNode | null }).parent = parent;
  parent.revision += 1;
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

interface BoundaryTree {
  root: TestNode;
  middle: TestNode;
  above: TestNode;
  boundary: TestNode;
  inner: TestNode;
  sibling: TestNode;
}

/**
 * `root → middle → [above, boundary → [inner, sibling]]`, where `middle` is a clean, auto-sized
 * ancestor and `boundary` is a fixed-size relayout boundary — the shape a virtualised list has inside
 * a fixed-height panel.
 */
function boundaryTree(): BoundaryTree {
  const inner = auto(40, 20);
  const sibling = auto(40, 20);
  const boundary = vbox([inner, sibling], { width: 120, height: 100 });
  boundary.isRelayoutBoundary = true;
  const above = auto(40, 20);
  const middle = vbox([above, boundary], { width: 200 });
  const root = vbox([middle], { width: 200 });
  return { root, middle, above, boundary, inner, sibling };
}

/** Lays the fixture out and returns the engine (with pixel snapping off for exact geometry). */
function setUp(): { tree: BoundaryTree; engine: LayoutEngine } {
  const tree = boundaryTree();
  const engine = exactEngine();
  layout(tree.root, loose(300, 300), engine);
  return { tree, engine };
}

describe('engine: dirty path through relayout boundaries', () => {
  it('arranges a subtree that changed below a clean ancestor chain', () => {
    const { tree, engine } = setUp();
    expectRect(tree.middle, 0, 0, 200, 120);
    expectRect(tree.boundary, 0, 20, 120, 100);
    expectRect(tree.inner, 0, 0, 40, 20);

    tree.inner.contentSize = { width: 40, height: 50 };
    tree.inner.revision += 1;
    engine.invalidate(tree.inner);
    const before = counters(engine);

    layout(tree.root, loose(300, 300), engine);

    // Before the fix the pass stopped at `middle` (clean, unchanged rect): only the root was
    // arranged and both children of the boundary kept their stale rects.
    expectRect(tree.inner, 0, 0, 40, 50);
    expectRect(tree.sibling, 0, 50, 40, 20);
    const after = counters(engine);
    expect(delta(before, after, 'arrangeCalls')).toBe(5);
    // Only the untouched sibling of the boundary *above* it is skipped.
    expect(delta(before, after, 'skippedSubtrees')).toBe(1);
  });

  it('arranges a child attached below a clean ancestor chain', () => {
    const row = auto(40, 20);
    const list = vbox([row], { width: 120 });
    const boundary = vbox([list], { width: 120, height: 100 });
    boundary.isRelayoutBoundary = true;
    const middle = vbox([boundary], { width: 200 });
    const root = vbox([middle], { width: 200 });
    const engine = exactEngine();
    layout(root, loose(300, 300), engine);
    expectRect(row, 0, 0, 40, 20);

    const added = auto(40, 30);
    attach(list, added);
    engine.invalidate(list);

    layout(root, loose(300, 300), engine);

    // The new row is below a clean ancestor and a boundary: it still has to receive its rect.
    expectRect(row, 0, 0, 40, 20);
    expectRect(added, 0, 20, 40, 30);
  });

  it('arranges changes above and inside the boundary in the same pass', () => {
    const { tree, engine } = setUp();

    tree.above.contentSize = { width: 40, height: 32 };
    tree.above.revision += 1;
    tree.inner.contentSize = { width: 40, height: 60 };
    tree.inner.revision += 1;
    engine.invalidate(tree.above);
    engine.invalidate(tree.inner);

    layout(tree.root, loose(300, 300), engine);

    expectRect(tree.above, 0, 0, 40, 32);
    // The boundary moved down because the sibling above it grew …
    expectRect(tree.boundary, 0, 32, 120, 100);
    // … and its own children were re-arranged too.
    expectRect(tree.inner, 0, 0, 40, 60);
    expectRect(tree.sibling, 0, 60, 40, 20);
  });

  it('keeps the measurement cache above the boundary intact', () => {
    const { tree, engine } = setUp();

    tree.inner.contentSize = { width: 40, height: 50 };
    tree.inner.revision += 1;
    engine.invalidate(tree.inner);

    // The boundary is stale, everything above it is not: that is the optimisation.
    expect(engine.isDirty(tree.boundary)).toBe(true);
    expect(engine.isDirty(tree.middle)).toBe(false);
    expect(engine.isDirty(tree.root)).toBe(false);
    // `hasDirtyNodes` still answers "a pass is needed" without folding `dirtyPath` in.
    expect(engine.hasDirtyNodes).toBe(true);

    const before = counters(engine);
    layout(tree.root, loose(300, 300), engine);
    const after = counters(engine);

    // Only the boundary subtree was measured again (the boundary plus the two measurements of the
    // changed child), while the root and the middle answered from the cache.
    expect(delta(before, after, 'measureCalls')).toBe(3);
    expect(delta(before, after, 'cacheHits')).toBeGreaterThanOrEqual(2);
    expect(engine.hasDirtyNodes).toBe(false);
  });

  it('walks through an unchanged ancestor instead of skipping it', () => {
    const { tree, engine } = setUp();
    const middleRect = tree.middle.arranged;
    const rootRect = tree.root.arranged;

    tree.inner.contentSize = { width: 40, height: 50 };
    tree.inner.revision += 1;
    engine.invalidate(tree.inner);
    const before = counters(engine);

    layout(tree.root, loose(300, 300), engine);
    const after = counters(engine);

    // Same geometry, but both ancestors were applied again — that is what carries the walk down to
    // the boundary (the arranged rect is a fresh object on every `applyRect`).
    expect(tree.middle.arranged).not.toBe(middleRect);
    expect(tree.root.arranged).not.toBe(rootRect);
    expectRect(tree.middle, 0, 0, 200, 120);
    expect(delta(before, after, 'skippedSubtrees')).toBe(1);
  });

  it('drops the dirty path at the end of a pass', () => {
    const { tree, engine } = setUp();
    tree.inner.contentSize = { width: 40, height: 50 };
    tree.inner.revision += 1;
    engine.invalidate(tree.inner);
    layout(tree.root, loose(300, 300), engine);

    // Nothing was invalidated in between, so the next pass must not descend again because of a
    // leftover path entry: the root is the only node arranged and the clean middle is skipped.
    const before = counters(engine);
    layout(tree.root, loose(300, 300), engine);
    const after = counters(engine);

    expect(delta(before, after, 'arrangeCalls')).toBe(1);
    expect(delta(before, after, 'skippedSubtrees')).toBe(1);
    expect(delta(before, after, 'measureCalls')).toBe(0);
  });

  it('descends to a boundary nested inside another boundary', () => {
    const inner = auto(40, 20);
    const innerBoundary = vbox([inner], { width: 80, height: 60 });
    innerBoundary.isRelayoutBoundary = true;
    const between = vbox([innerBoundary], { width: 100 });
    const outerBoundary = vbox([between], { width: 120, height: 100 });
    outerBoundary.isRelayoutBoundary = true;
    const middle = vbox([outerBoundary], { width: 200 });
    const root = vbox([middle], { width: 200 });
    const engine = exactEngine();
    layout(root, loose(300, 300), engine);
    expectRect(inner, 0, 0, 40, 20);

    inner.contentSize = { width: 40, height: 30 };
    inner.revision += 1;
    engine.invalidate(inner);

    // The walk stops marking at the *inner* boundary; the outer one is only on the arrange path.
    expect(engine.isDirty(innerBoundary)).toBe(true);
    expect(engine.isDirty(outerBoundary)).toBe(false);

    layout(root, loose(300, 300), engine);

    expectRect(inner, 0, 0, 40, 30);
    expectRect(innerBoundary, 0, 0, 80, 60);
    expectRect(outerBoundary, 0, 0, 120, 100);
  });

  it('keeps marking every ancestor dirty when no boundary is involved', () => {
    const inner = auto(40, 20);
    const middle = vbox([inner], { width: 200 });
    const root = vbox([middle], { width: 200 });
    const engine = exactEngine();
    layout(root, loose(300, 300), engine);

    inner.contentSize = { width: 40, height: 50 };
    inner.revision += 1;
    engine.invalidate(inner);

    expect(engine.isDirty(inner)).toBe(true);
    expect(engine.isDirty(middle)).toBe(true);
    expect(engine.isDirty(root)).toBe(true);

    layout(root, loose(300, 300), engine);
    expectRect(inner, 0, 0, 40, 50);
  });

  it('re-arranges the boundary subtree of a fixed-size (boundary) root', () => {
    const inner = auto(40, 20);
    const panel = vbox([inner], { width: 120, height: 100 });
    panel.isRelayoutBoundary = true;
    const engine = exactEngine();
    layout(panel, loose(300, 300), engine);
    expectRect(inner, 0, 0, 40, 20);

    inner.contentSize = { width: 40, height: 70 };
    inner.revision += 1;
    engine.invalidate(inner);
    layout(panel, loose(300, 300), engine);

    expectRect(inner, 0, 0, 40, 70);
    expect(rectOf(panel).height).toBe(100);
  });
});
