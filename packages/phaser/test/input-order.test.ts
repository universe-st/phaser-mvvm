/**
 * Tests for the pure parts of `input.ts`: the click gesture, the disabled-state correction and the
 * container-chain containment used by input capture.
 *
 * `InputRouter` itself needs a live `Phaser.Scene`, so the decisions it makes are extracted into
 * functions over plain objects. The containment tests are the "order" contract of the router: a
 * capture widget shields everything *underneath* it, while its own subtree keeps receiving input —
 * which is exactly what a modal overlay (M8) needs.
 */

import { describe, expect, it } from 'vitest';
import type { ActivationSource, Widget } from '../src/Widget';
import type { ContainerLike } from '../src/input';
import {
  DEFAULT_DRAG_THRESHOLD,
  collectInteractive,
  diffInteractionState,
  isClickGesture,
  isHoverPointer,
  isWithinTree,
} from '../src/input';

/* ------------------------------------------------------------------ fakes */

interface FakeWidget {
  focusable: boolean;
  onActivate: ((source: ActivationSource) => void) | null;
  interactive?: boolean;
  enabled?: boolean;
  children: FakeWidget[];
  getWidgetChildren(): FakeWidget[];
}

function fakeWidget(options: Partial<Omit<FakeWidget, 'getWidgetChildren'>> = {}): FakeWidget {
  const children = options.children ?? [];
  return {
    focusable: options.focusable ?? false,
    onActivate: options.onActivate ?? null,
    interactive: options.interactive,
    enabled: options.enabled ?? true,
    children,
    getWidgetChildren: () => children,
  };
}

function asWidget(value: FakeWidget): Widget {
  return value as unknown as Widget;
}

function chain(parent: ContainerLike | null): ContainerLike {
  return { parentContainer: parent };
}

/* ------------------------------------------------------------------ isClickGesture */

describe('isClickGesture', () => {
  it('accepts a press and release on the same pixel', () => {
    expect(isClickGesture({ x: 10, y: 20 }, { x: 10, y: 20 }, DEFAULT_DRAG_THRESHOLD)).toBe(true);
  });

  it('accepts a small move under the threshold', () => {
    expect(isClickGesture({ x: 10, y: 20 }, { x: 13, y: 23 }, 8)).toBe(true);
  });

  it('measures the Euclidean distance for a diagonal move', () => {
    // 3-4-5 triangle: 6/8/10, so 10 is over the threshold while 5 is not.
    expect(isClickGesture({ x: 0, y: 0 }, { x: 6, y: 8 }, 10)).toBe(false);
    expect(isClickGesture({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)).toBe(true);
  });

  it('treats exactly the threshold distance as a drag, not a click', () => {
    expect(isClickGesture({ x: 0, y: 0 }, { x: 8, y: 0 }, 8)).toBe(false);
    expect(isClickGesture({ x: 0, y: 0 }, { x: 7, y: 0 }, 8)).toBe(true);
  });

  it('rejects a long drag', () => {
    expect(isClickGesture({ x: 0, y: 0 }, { x: 120, y: 4 }, 8)).toBe(false);
  });

  it('rejects any movement when the threshold is zero', () => {
    expect(isClickGesture({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toBe(false);
  });
});

/* ------------------------------------------------------------------ diffInteractionState */

describe('diffInteractionState', () => {
  it('reports a widget that became disabled', () => {
    const button = fakeWidget({ enabled: false });
    const previous = new Map<Widget, boolean>([[asWidget(button), true]]);

    expect(diffInteractionState(previous, [asWidget(button)])).toEqual([asWidget(button)]);
  });

  it('reports nothing while a widget stays enabled', () => {
    const button = fakeWidget({ enabled: true });
    const previous = new Map<Widget, boolean>([[asWidget(button), true]]);

    expect(diffInteractionState(previous, [asWidget(button)])).toEqual([]);
  });

  it('reports nothing while a widget stays disabled', () => {
    const button = fakeWidget({ enabled: false });
    const previous = new Map<Widget, boolean>([[asWidget(button), false]]);

    expect(diffInteractionState(previous, [asWidget(button)])).toEqual([]);
  });

  it('reports nothing when a widget is re-enabled (there is no stale state to clear)', () => {
    const button = fakeWidget({ enabled: true });
    const previous = new Map<Widget, boolean>([[asWidget(button), false]]);

    expect(diffInteractionState(previous, [asWidget(button)])).toEqual([]);
  });

  it('ignores widgets that were never tracked', () => {
    const button = fakeWidget({ enabled: false });

    expect(diffInteractionState(new Map<Widget, boolean>(), [asWidget(button)])).toEqual([]);
  });

  it('reports every changed widget, in list order', () => {
    const first = fakeWidget({ enabled: false });
    const stable = fakeWidget({ enabled: true });
    const last = fakeWidget({ enabled: false });
    const previous = new Map<Widget, boolean>([
      [asWidget(first), true],
      [asWidget(stable), true],
      [asWidget(last), true],
    ]);

    expect(
      diffInteractionState(previous, [asWidget(first), asWidget(stable), asWidget(last)]),
    ).toEqual([asWidget(first), asWidget(last)]);
  });

  it('does not mutate the caller-owned map', () => {
    const button = fakeWidget({ enabled: false });
    const previous = new Map<Widget, boolean>([[asWidget(button), true]]);

    diffInteractionState(previous, [asWidget(button)]);

    expect(previous.get(asWidget(button))).toBe(true);
  });
});

/* ------------------------------------------------------------------ hover pointer */

describe('isHoverPointer', () => {
  it('accepts a mouse that has moved', () => {
    expect(isHoverPointer({ active: true, wasTouch: false, moveTime: 12 })).toBe(true);
  });

  it('rejects a missing pointer', () => {
    expect(isHoverPointer(null)).toBe(false);
    expect(isHoverPointer(undefined)).toBe(false);
  });

  it('rejects an inactive pointer', () => {
    expect(isHoverPointer({ active: false, moveTime: 12 })).toBe(false);
  });

  it('rejects a pointer that has driven a touch (it would pin the hover where the finger lifted)', () => {
    expect(isHoverPointer({ active: true, wasTouch: true, moveTime: 12 })).toBe(false);
  });

  it('rejects a pointer that never moved, so a fresh page highlights nothing', () => {
    expect(isHoverPointer({ active: true, wasTouch: false, moveTime: 0 })).toBe(false);
  });
});

/* ------------------------------------------------------------------ capture containment */

describe('isWithinTree', () => {
  it('treats a node as within itself', () => {
    const modal = chain(null);

    expect(isWithinTree(modal, modal)).toBe(true);
  });

  it('follows a long parent chain upwards', () => {
    const root = chain(null);
    const modal = chain(root);
    const panel = chain(modal);
    const button = chain(panel);

    expect(isWithinTree(button, modal)).toBe(true);
    expect(isWithinTree(button, root)).toBe(true);
  });

  it('rejects a widget that is not in the capture subtree', () => {
    const root = chain(null);
    const modal = chain(root);
    const backgroundButton = chain(root);
    const modalButton = chain(modal);

    expect(isWithinTree(backgroundButton, modal)).toBe(false);
    expect(isWithinTree(modalButton, modal)).toBe(true);
  });

  it('rejects a node from an unrelated chain', () => {
    const capture = chain(null);
    const stranger = chain(chain(null));

    expect(isWithinTree(stranger, capture)).toBe(false);
  });

  it('stops safely at the end of a chain', () => {
    const orphan: ContainerLike = {};

    expect(isWithinTree(orphan, chain(null))).toBe(false);
  });
});

/* ------------------------------------------------------------------ interactive collection */

describe('collectInteractive', () => {
  it('collects focusable widgets, activation handlers and explicitly interactive widgets', () => {
    const focusable = fakeWidget({ focusable: true });
    const clickable = fakeWidget({ onActivate: () => {} });
    const marked = fakeWidget({ interactive: true });
    const plain = fakeWidget();
    const root = fakeWidget({ children: [focusable, plain, clickable, marked] });

    expect(collectInteractive(asWidget(root))).toEqual([
      asWidget(focusable),
      asWidget(clickable),
      asWidget(marked),
    ]);
  });

  it('descends through non-interactive containers, in tree order', () => {
    const nested = fakeWidget({ focusable: true });
    const inner = fakeWidget({ children: [nested] });
    const outer = fakeWidget({ focusable: true, children: [inner] });
    const root = fakeWidget({ children: [outer] });

    expect(collectInteractive(asWidget(root))).toEqual([asWidget(outer), asWidget(nested)]);
  });

  it('collects nothing from a subtree without interactive widgets', () => {
    const root = fakeWidget({ children: [fakeWidget({ children: [fakeWidget()] })] });

    expect(collectInteractive(asWidget(root))).toEqual([]);
  });
});
