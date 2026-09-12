/**
 * The router's target walk, in Node.
 *
 * `resolveTarget` decides which widget a pointer press belongs to, and three of this project's input
 * defects lived in it: V1 (the wrong coordinate space when the UI is camera-pinned), V8 (reading the
 * space from the root instead of from each candidate) and V9 (trusting the widget Phaser happened to
 * dispatch to). None of them could have been caught by a unit test as long as the walk was buried in
 * the class, so the walk is now a pure function and this file pins its contract.
 */

import { describe, expect, it } from 'vitest';
import { resolveTargetInTree, type TargetNode } from '../src/input';

interface Node extends TargetNode {
  name: string;
  children: Node[];
  getWidgetChildren(): readonly TargetNode[];
}

function node(
  name: string,
  options: { x?: number; y?: number; width?: number; height?: number; visible?: boolean } = {},
): Node {
  const children: Node[] = [];
  return {
    name,
    x: options.x ?? 0,
    y: options.y ?? 0,
    visible: options.visible,
    appliedRect: { width: options.width ?? 100, height: options.height ?? 100 },
    children,
    getWidgetChildren: () => children,
  };
}

/** Adds `child` as the last child (drawn on top) and returns the parent. */
function withChild(parent: Node, child: Node, x = 0, y = 0): Node {
  child.x += x;
  child.y += y;
  parent.children.push(child);
  return parent;
}

const target = (item: Node): boolean => item.visible !== false;

describe('resolveTargetInTree', () => {
  it('returns the deepest widget under the point', () => {
    const inner = node('inner', { x: 10, y: 10, width: 50, height: 50 });
    const outer = withChild(node('outer', { width: 200, height: 200 }), inner);

    const hit = resolveTargetInTree(outer, () => ({ x: 30, y: 30 }), target);

    expect(hit?.name).toBe('inner');
  });

  it('prefers the last child, which is the one drawn on top', () => {
    const under = node('under', { width: 100, height: 100 });
    const over = node('over', { width: 100, height: 100 });
    const root = withChild(withChild(node('root', { width: 200, height: 200 }), under), over);

    const hit = resolveTargetInTree(root, () => ({ x: 50, y: 50 }), target);

    expect(hit?.name).toBe('over');
  });

  it('falls back to the parent when the child does not contain the point', () => {
    const child = node('child', { x: 120, y: 0, width: 50, height: 50 });
    const root = withChild(node('root', { width: 200, height: 200 }), child);

    const hit = resolveTargetInTree(root, () => ({ x: 10, y: 10 }), target);

    expect(hit?.name).toBe('root');
  });

  it('skips a hidden subtree entirely', () => {
    // A hidden widget leaves the flow, so neither it nor its children may be hit.
    const hidden = node('hidden', { visible: false, width: 200, height: 200 });
    const grandchild = node('grandchild', { width: 200, height: 200 });
    hidden.children.push(grandchild);
    const root = withChild(node('root', { width: 300, height: 300 }), hidden);

    const hit = resolveTargetInTree(root, () => ({ x: 5, y: 5 }), target);

    expect(hit?.name).toBe('root');
  });

  it('searches through a node that is not a target itself', () => {
    // A plain container is not interactive, but its children are: the walk must not stop there.
    const button = node('button', { x: 20, y: 20, width: 40, height: 40 });
    const container = withChild(node('container', { width: 200, height: 200 }), button);
    const root = withChild(node('root', { width: 300, height: 300 }), container);

    const hit = resolveTargetInTree(
      root,
      () => ({ x: 30, y: 30 }),
      (item) => item.name === 'button' || item.name === 'root',
    );

    expect(hit?.name).toBe('button');
  });

  it('returns null when the point misses every rect', () => {
    const root = withChild(node('root', { width: 100, height: 100 }), node('child'));

    expect(resolveTargetInTree(root, () => ({ x: 500, y: 500 }), target)).toBeNull();
  });

  it('includes the rect edges (the box is inclusive)', () => {
    const root = node('root', { x: 10, y: 10, width: 100, height: 100 });

    expect(resolveTargetInTree(root, () => ({ x: 10, y: 10 }), target)?.name).toBe('root');
    expect(resolveTargetInTree(root, () => ({ x: 110, y: 110 }), target)?.name).toBe('root');
    expect(resolveTargetInTree(root, () => ({ x: 110.5, y: 110 }), target)).toBeNull();
  });

  it('adds container offsets down the chain', () => {
    // The offset a node is tested against is the sum of its ancestors' positions plus its own.
    const deep = node('deep', { x: 5, y: 5, width: 10, height: 10 });
    const mid = withChild(node('mid', { x: 50, y: 50, width: 100, height: 100 }), deep);
    const root = withChild(node('root', { x: 100, y: 100, width: 300, height: 300 }), mid);

    expect(resolveTargetInTree(root, () => ({ x: 155, y: 155 }), target)?.name).toBe('deep');
    expect(resolveTargetInTree(root, () => ({ x: 154, y: 154 }), target)?.name).toBe('mid');
  });

  it('consults the point in each candidate own space (regression: V8)', () => {
    // A camera-pinned child inside an unpinned tree is drawn in screen space while its parent stays in
    // world space. Phaser's hit test asks each object with *its own* scroll factor, so the walk has to
    // do the same: the pinned button at screen (167, 28) must still be found at world (427, 168).
    const pinned = node('pinned', { x: 160, y: 20, width: 60, height: 30 });
    pinned.name = 'pinned';
    const root = withChild(node('root', { width: 1200, height: 600 }), pinned);

    const world = { x: 427, y: 168 };
    const screen = { x: 167, y: 28 };
    const hit = resolveTargetInTree(
      root,
      (item) => (item.name === 'pinned' ? screen : world),
      target,
    );

    expect(hit?.name).toBe('pinned');
  });

  it('does not hit a node whose rect is empty', () => {
    // A widget that has not been laid out yet (or is squeezed to zero) must not swallow presses.
    const root = withChild(
      node('root', { width: 200, height: 200 }),
      node('empty', { width: 0, height: 0 }),
    );

    expect(resolveTargetInTree(root, () => ({ x: 10, y: 10 }), target)?.name).toBe('root');
  });
});
