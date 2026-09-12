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
  keepsHoverAfterPress,
  pointerInWidgetSpace,
  shouldFocusOnPress,
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

/* ------------------------------------------------------------------ shouldFocusOnPress */

describe('shouldFocusOnPress', () => {
  it('focuses a focusable, enabled widget', () => {
    expect(shouldFocusOnPress({ focusable: true })).toBe(true);
    expect(shouldFocusOnPress({ focusable: true, enabled: true })).toBe(true);
  });

  it('never focuses a widget that is not focusable', () => {
    // Labels, images, spacers and dividers are not in the focus set, so a press must not try.
    expect(shouldFocusOnPress({ focusable: false })).toBe(false);
    expect(shouldFocusOnPress({})).toBe(false);
  });

  it('never focuses a disabled widget', () => {
    // A disabled control is skipped by traversal; focusing it would put the ring on a control the user
    // cannot use and would break `Tab` (it would have to skip back out).
    expect(shouldFocusOnPress({ focusable: true, enabled: false })).toBe(false);
  });
});

/* ------------------------------------------------------------------ interactive collection of commands */

describe('collectInteractive · command hosts', () => {
  it('collects a plain widget that only carries an activation callback', () => {
    // This is what `bindCommand()` installs on a widget that declares nothing else: the router has to
    // treat it as a pointer target, otherwise a command bound to a plain Label or Image never fires.
    const label = fakeWidget({ onActivate: () => undefined });
    const root = fakeWidget({ children: [label] });

    expect(collectInteractive(asWidget(root))).toEqual([asWidget(label)]);
  });

  it('skips a widget with no marker at all', () => {
    const plain = fakeWidget();
    const root = fakeWidget({ children: [plain] });

    expect(collectInteractive(asWidget(root))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ pointer space */

describe('pointerInWidgetSpace · the router and Phaser agree on where the pointer is', () => {
  const camera = { scrollX: 260, scrollY: 140 };
  /** A pointer at screen (167, 28) with the camera scrolled: Phaser stores the world point on it. */
  const pointer = {
    x: 167,
    y: 28,
    worldX: 167 + camera.scrollX,
    worldY: 28 + camera.scrollY,
    camera,
  };
  const world = { scrollFactorX: 1, scrollFactorY: 1 };
  const pinned = { scrollFactorX: 0, scrollFactorY: 0 };

  it('returns the world point for a scroll factor of 1 (the default UI)', () => {
    expect(pointerInWidgetSpace(pointer, world, null)).toEqual({ x: 427, y: 168 });
  });

  it('returns the screen point for a camera-pinned widget', () => {
    // `px = worldX + scrollX * 0 - scrollX` — the exact expression `InputManager#hitTest` uses, which
    // is why a pinned tree now passes both gates no matter *which* node was pinned.
    expect(pointerInWidgetSpace(pointer, pinned, null)).toEqual({ x: 167, y: 28 });
  });

  it('interpolates for a partial scroll factor, like the renderer draws it', () => {
    const half = { scrollFactorX: 0.5, scrollFactorY: 0.5 };
    expect(pointerInWidgetSpace(pointer, half, null)).toEqual({ x: 297, y: 98 });
  });

  it('falls back to the main camera when the pointer carries none', () => {
    const loose = { x: 167, y: 28, worldX: 427, worldY: 168, camera: null };
    expect(pointerInWidgetSpace(loose, pinned, camera)).toEqual({ x: 167, y: 28 });
    expect(pointerInWidgetSpace(loose, world, camera)).toEqual({ x: 427, y: 168 });
  });

  it('treats a missing camera as unscrolled instead of producing NaN', () => {
    const loose = { x: 10, y: 20, worldX: 10, worldY: 20, camera: null };
    expect(pointerInWidgetSpace(loose, pinned, null)).toEqual({ x: 10, y: 20 });
  });
});

/* ------------------------------------------------------------------ touch presses */

describe('keepsHoverAfterPress · a tap must not leave a hover behind', () => {
  it('keeps the hover for a mouse press', () => {
    expect(keepsHoverAfterPress({ wasTouch: false })).toBe(true);
    expect(keepsHoverAfterPress({})).toBe(true);
    expect(keepsHoverAfterPress(null)).toBe(true);
  });

  it('drops it for a touch press', () => {
    // Phaser marks the touch pointer (`pointer1`) with `wasTouch = true`; the mouse pointer never is.
    expect(keepsHoverAfterPress({ wasTouch: true })).toBe(false);
  });
});
