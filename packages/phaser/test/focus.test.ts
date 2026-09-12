/**
 * Pure-function tests for `focus.ts`.
 *
 * Focus routing is split so that the three algorithms that are worth getting right — collecting the
 * focusable widgets in navigation order, lifting layout rects into stage coordinates and choosing a
 * directional neighbour — are plain functions over plain data. These tests therefore build
 * three-line fake nodes/rects instead of a Phaser `Scene`: no renderer, no timers, and the
 * expectations below read as the specification of `FocusManager` traversal.
 */

import { describe, expect, it } from 'vitest';
import type { Rect } from '@phaser-mvvm/layout';
import type { AnchorLike, FocusNodeLike, RectSourceLike } from '../src/focus';
import {
  collectFocusable,
  directionalTolerance,
  isFocusNodeLike,
  pickDirectional,
  stageRectOf,
  stageRectsOf,
} from '../src/focus';
import type { Widget } from '../src/Widget';

/* ------------------------------------------------------------------ fakes */

interface FakeNode extends FocusNodeLike {
  readonly children: readonly FakeNode[];
}

function node(
  options: {
    children?: FakeNode[];
    focusable?: boolean;
    enabled?: boolean;
    visible?: boolean;
    inFlow?: boolean;
    focusOrder?: number;
  } = {},
): FakeNode {
  return {
    children: options.children ?? [],
    focusable: options.focusable ?? true,
    enabled: options.enabled ?? true,
    visible: options.visible ?? true,
    inFlow: options.inFlow ?? true,
    focusOrder: options.focusOrder ?? 0,
  };
}

/** `collectFocusable` answers with `Widget[]` for the host's convenience; tests keep the fakes. */
function collected(root: FocusNodeLike): readonly FocusNodeLike[] {
  return collectFocusable(root) as unknown as readonly FocusNodeLike[];
}

function anchor(x: number, y: number, parent: AnchorLike | null = null): AnchorLike {
  return { x, y, parentContainer: parent };
}

function source(rect: Rect, parent: AnchorLike | null = null): RectSourceLike {
  return { appliedRect: rect, parentContainer: parent };
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/* ------------------------------------------------------------------ collectFocusable */

describe('collectFocusable', () => {
  it('collects focusable children in tree order', () => {
    const a = node();
    const b = node();
    const root = node({ children: [a, b], focusable: false });

    expect(collected(root)).toEqual([a, b]);
  });

  it('skips widgets that are not focusable but descends into them', () => {
    const leaf = node();
    const plain = node({ children: [leaf], focusable: false });
    const root = node({ children: [plain], focusable: false });

    expect(collected(root)).toEqual([leaf]);
  });

  it('skips disabled widgets', () => {
    const enabled = node();
    const disabled = node({ enabled: false });
    const root = node({ children: [enabled, disabled], focusable: false });

    expect(collected(root)).toEqual([enabled]);
  });

  it('skips invisible widgets', () => {
    const visible = node();
    const hidden = node({ visible: false });
    const root = node({ children: [visible, hidden], focusable: false });

    expect(collected(root)).toEqual([visible]);
  });

  it('skips a whole subtree that is out of flow', () => {
    const reachable = node();
    const buried = node();
    const hiddenBox = node({ children: [buried], inFlow: false, visible: false });
    const root = node({ children: [reachable, hiddenBox], focusable: false });

    expect(collected(root)).toEqual([reachable]);
  });

  it('includes the root itself when it is focusable', () => {
    const child = node();
    const root = node({ children: [child] });

    expect(collected(root)).toEqual([root, child]);
  });

  it('returns an empty list when nothing is focusable', () => {
    const root = node({ focusable: false, children: [node({ focusable: false })] });

    expect(collected(root)).toEqual([]);
  });

  it('sorts by focusOrder before tree order', () => {
    const first = node({ focusOrder: 0 });
    const second = node({ focusOrder: 1 });
    const minus = node({ focusOrder: -5 });
    const root = node({ children: [second, first, minus], focusable: false });

    expect(collected(root)).toEqual([minus, first, second]);
  });

  it('keeps tree order when focusOrder ties, across nesting levels', () => {
    // Pre-order: outer-a, inner-a, outer-b — all with focusOrder 0.
    const outerA = node({ focusOrder: 3 });
    const innerA = node({ focusOrder: 3 });
    const outerB = node({ focusOrder: 3 });
    const boxA = node({ children: [outerA, innerA], focusOrder: 3, focusable: false });
    const root = node({ children: [boxA, outerB], focusable: false });

    expect(collected(root)).toEqual([outerA, innerA, outerB]);
  });

  it('is stable across repeated calls on an unchanged tree', () => {
    const root = node({
      focusable: false,
      children: [node({ focusOrder: 1 }), node({ focusOrder: 1 }), node({ focusOrder: 0 })],
    });

    const first = collected(root);
    const second = collected(root);

    expect(second).toEqual(first);
  });

  it('ignores children that are not widget-like', () => {
    const real = node();
    const root = {
      children: [null, 42, { notFocusable: true }, real],
      focusable: false,
      enabled: true,
      visible: true,
      inFlow: true,
      focusOrder: 0,
    } as unknown as FocusNodeLike;

    expect(collected(root)).toEqual([real]);
  });
});

describe('isFocusNodeLike', () => {
  it('accepts a widget-like node and rejects primitives', () => {
    expect(isFocusNodeLike(node())).toBe(true);
    expect(isFocusNodeLike(null)).toBe(false);
    expect(isFocusNodeLike('focusable')).toBe(false);
    expect(isFocusNodeLike({ focusable: true })).toBe(false);
  });
});

/* ------------------------------------------------------------------ stage rects */

describe('stageRectOf', () => {
  it('uses appliedRect unchanged for a node without a parent', () => {
    expect(stageRectOf(source(rect(5, 7, 30, 20)))).toEqual(rect(5, 7, 30, 20));
  });

  it('adds one ancestor offset', () => {
    expect(stageRectOf(source(rect(5, 7, 30, 20), anchor(100, 50)))).toEqual(rect(105, 57, 30, 20));
  });

  it('sums a deep parent chain, ignoring rotation and scale', () => {
    const grandParent = anchor(1, 2);
    const parent = anchor(10, 20, grandParent);
    const container = anchor(100, 200, parent);

    expect(stageRectOf(source(rect(3, 4, 8, 9), container))).toEqual(rect(114, 226, 8, 9));
  });

  it('stops at a node whose parentContainer is undefined', () => {
    const parent: AnchorLike = { x: 4, y: 6 };
    expect(stageRectOf(source(rect(1, 1, 2, 2), parent))).toEqual(rect(5, 7, 2, 2));
  });

  it('keeps the list index-aligned', () => {
    const rects = stageRectsOf([
      source(rect(0, 0, 10, 10)),
      source(rect(1, 1, 10, 10), anchor(10, 0)),
      source(rect(2, 2, 10, 10), anchor(0, 20)),
    ]);

    expect(rects).toEqual([rect(0, 0, 10, 10), rect(11, 1, 10, 10), rect(2, 22, 10, 10)]);
  });
});

/* ------------------------------------------------------------------ directional picking */

describe('directionalTolerance', () => {
  it('uses 60% of the width for vertical moves', () => {
    expect(directionalTolerance(rect(0, 0, 200, 40), 'down')).toBe(120);
  });

  it('uses 60% of the height for horizontal moves', () => {
    expect(directionalTolerance(rect(0, 0, 200, 40), 'right')).toBe(64);
  });

  it('never drops below 64px', () => {
    expect(directionalTolerance(rect(0, 0, 40, 20), 'down')).toBe(64);
  });
});

describe('pickDirectional', () => {
  // A 3x3 grid of 100x40 buttons, 20px gaps: centres at x = 50/170/290, y = 20/80/140.
  const grid = [
    /* 0 top-left     */ rect(0, 0, 100, 40),
    /* 1 top-middle   */ rect(120, 0, 100, 40),
    /* 2 top-right    */ rect(240, 0, 100, 40),
    /* 3 middle-left  */ rect(0, 60, 100, 40),
    /* 4 centre       */ rect(120, 60, 100, 40),
    /* 5 middle-right */ rect(240, 60, 100, 40),
    /* 6 bottom-left  */ rect(0, 120, 100, 40),
    /* 7 bottom-middle*/ rect(120, 120, 100, 40),
    /* 8 bottom-right */ rect(240, 120, 100, 40),
  ];

  const centre = grid[4] as Rect;

  it('picks the nearest candidate below for down', () => {
    expect(pickDirectional(centre, grid, 'down', 200)).toBe(7);
  });

  it('picks the nearest candidate above for up', () => {
    expect(pickDirectional(centre, grid, 'up', 200)).toBe(1);
  });

  it('picks the nearest candidate to the sides for left and right', () => {
    expect(pickDirectional(centre, grid, 'left', 200)).toBe(3);
    expect(pickDirectional(centre, grid, 'right', 200)).toBe(5);
  });

  it('ignores candidates in the opposite half-plane', () => {
    // Only the bottom row remains; the top and middle rows must not be reachable.
    const candidates = [grid[0] as Rect, grid[1] as Rect, grid[7] as Rect];

    expect(pickDirectional(centre, candidates, 'up', 200)).toBe(1);
    expect(pickDirectional(centre, candidates, 'down', 200)).toBe(2);
  });

  it('rejects a candidate whose tangential offset exceeds the funnel', () => {
    // The bottom-right button is 120px off-axis: outside a 64px funnel, inside a 200px one.
    const candidates = [grid[8] as Rect];

    expect(pickDirectional(centre, candidates, 'down', 64)).toBeNull();
    expect(pickDirectional(centre, candidates, 'down', 200)).toBe(0);
  });

  it('breaks a tie on the primary axis with the smaller tangential offset', () => {
    const current = rect(0, 0, 100, 40);
    const farOffAxis = rect(200, 60, 100, 40);
    const onAxis = rect(0, 60, 100, 40);

    expect(pickDirectional(current, [farOffAxis, onAxis], 'down', 300)).toBe(1);
    expect(pickDirectional(current, [onAxis, farOffAxis], 'down', 300)).toBe(0);
  });

  it('prefers the closer candidate even when a further one is better aligned', () => {
    const current = rect(0, 0, 100, 40);
    const near = rect(30, 50, 100, 40);
    const far = rect(0, 200, 100, 40);

    expect(pickDirectional(current, [near, far], 'down', 300)).toBe(0);
  });

  it('never picks the current rect itself', () => {
    const current = rect(0, 0, 100, 40);

    expect(pickDirectional(current, [rect(0, 0, 100, 40)], 'down', 300)).toBeNull();
    expect(pickDirectional(current, [rect(0, 0, 100, 40)], 'up', 300)).toBeNull();
    expect(pickDirectional(current, [rect(0, 0, 100, 40)], 'left', 300)).toBeNull();
    expect(pickDirectional(current, [rect(0, 0, 100, 40)], 'right', 300)).toBeNull();
  });

  it('returns null when there is no candidate at all', () => {
    expect(pickDirectional(centre, [], 'down', 200)).toBeNull();
  });

  it('returns null when every candidate is outside the funnel', () => {
    const current = rect(0, 0, 100, 40);
    const candidates = [rect(500, 60, 100, 40), rect(-500, 60, 100, 40)];

    expect(pickDirectional(current, candidates, 'down', 64)).toBeNull();
  });

  it('measures the tangential offset on the vertical axis for left/right', () => {
    const current = rect(0, 0, 100, 40);
    const below = rect(200, 300, 100, 40);
    const aligned = rect(200, 0, 100, 40);

    expect(pickDirectional(current, [below], 'right', 64)).toBeNull();
    expect(pickDirectional(current, [below, aligned], 'right', 64)).toBe(1);
  });
});

/* ------------------------------------------------------------------ type sanity */

describe('structural compatibility', () => {
  it('accepts the fakes above through the contracts FocusManager is typed with', () => {
    // Compilation is half the assertion: the fakes satisfy `FocusNodeLike` / `RectSourceLike`, which
    // is what lets `FocusManager` be driven from a test without a Scene.
    const fakeWidget = node({ focusOrder: 2 }) as unknown as Widget;

    expect(collectFocusable(fakeWidget as unknown as FocusNodeLike)).toEqual([fakeWidget]);
    expect(stageRectsOf([source(rect(0, 0, 10, 10))])).toEqual([rect(0, 0, 10, 10)]);
  });
});
