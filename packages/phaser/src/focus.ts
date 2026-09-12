/**
 * `FocusManager` — keyboard/gamepad focus for a widget tree.
 *
 * The manager owns one *collection* of focusable widgets (a stable, ordered list built from the
 * tree) and the single index inside that list that currently holds focus. Everything device
 * specific lives in `nav.ts`; everything pointer specific lives in `input.ts`; this file decides
 * *which* widget should be focused.
 *
 * Two rules shape the design:
 *
 * - the collection is the boundary: `focus()` ignores widgets that were not collected, and a
 *   trapped manager (`trapFocus`, used by modal pages in M8) cannot lose focus at all,
 * - the interesting algorithms are exported as pure functions (`collectFocusable`,
 *   `stageRectsOf`, `pickDirectional`, `directionalTolerance`) so they can be tested with plain
 *   objects, without a Phaser runtime.
 */

import type { Rect } from '@phaser-mvvm/layout';
import type { NavAction, NavDirection } from './nav';
import type { ActivationSource, FocusTarget, Widget } from './Widget';

/** Default funnel width multiplier used by `directionalTolerance`. */
const TOLERANCE_FACTOR = 0.6;
/** Floor for `directionalTolerance`, in design pixels. */
const MIN_TOLERANCE = 64;

// ---------------------------------------------------------------------------- pure helpers

/**
 * Minimal view of a widget-tree node.
 *
 * A real `Widget` satisfies this structurally, and so does a three-line object literal in a test —
 * which is the point: collection and ordering can be verified without building a Scene.
 */
export interface FocusNodeLike {
  /** Widget children, in tree order. Non-widget children are ignored. */
  readonly children: readonly unknown[];
  /** `false` when the node (and therefore its subtree) is out of the layout flow, i.e. hidden. */
  readonly inFlow: boolean;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly focusable: boolean;
  /** Ordering hint; ties keep the widget-tree order. */
  readonly focusOrder: number;
}

/** True for values that carry the focus-related fields of a widget. */
export function isFocusNodeLike(value: unknown): value is FocusNodeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'focusable' in value &&
    'focusOrder' in value &&
    'inFlow' in value
  );
}

/**
 * Collects the focusable widgets of a subtree, in navigation order.
 *
 * A widget is collected when it is focusable, enabled and visible. A subtree that is out of flow
 * (`inFlow === false`, which for `Widget` means "hidden") contributes nothing at all, because
 * anything inside it is invisible even though its own `visible` flag may still be `true`.
 *
 * The result is sorted by `focusOrder` with the tree order (pre-order) as the tie breaker, and the
 * sort is stable, so repeated calls on an unchanged tree return the same order.
 */
export function collectFocusable(root: FocusNodeLike): Widget[] {
  const found: Array<{ widget: Widget; order: number; treeIndex: number }> = [];
  let treeIndex = 0;

  const visit = (node: FocusNodeLike): void => {
    const index = treeIndex++;
    if (node.inFlow === false) {
      return;
    }
    if (node.focusable === true && node.enabled !== false && node.visible !== false) {
      found.push({ widget: node as unknown as Widget, order: node.focusOrder, treeIndex: index });
    }
    for (const child of node.children) {
      if (isFocusNodeLike(child)) {
        visit(child);
      }
    }
  };

  visit(root);

  found.sort((a, b) => (a.order === b.order ? a.treeIndex - b.treeIndex : a.order - b.order));
  return found.map((entry) => entry.widget);
}

/** Minimal shape of a container in the `parentContainer` chain. */
export interface AnchorLike {
  readonly x: number;
  readonly y: number;
  readonly parentContainer?: AnchorLike | null;
}

/**
 * Minimal shape needed to lift a widget's rect into stage coordinates.
 *
 * `appliedRect` is the rect written by the layout engine and is relative to the widget's parent
 * container, so the parent chain is summed on top of it — the widget's own `x`/`y` are ignored
 * on purpose, `appliedRect` is the layout's answer and the authoritative one.
 */
export interface RectSourceLike {
  readonly appliedRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly parentContainer?: AnchorLike | null;
}

/**
 * Converts a widget's `appliedRect` into stage coordinates.
 *
 * Rotation and scale of the intermediate containers are ignored: the layout engine only ever
 * positions containers, and geometry is what directional navigation needs (PLAN M3).
 */
export function stageRectOf(source: RectSourceLike): Rect {
  const rect = source.appliedRect;
  let x = rect.x;
  let y = rect.y;

  let parent = source.parentContainer;
  while (parent) {
    x += parent.x;
    y += parent.y;
    parent = parent.parentContainer;
  }

  return { x, y, width: rect.width, height: rect.height };
}

/** `stageRectOf` for a list of widgets (index-aligned with the input list). */
export function stageRectsOf(widgets: readonly RectSourceLike[]): Rect[] {
  const rects: Rect[] = [];
  for (const widget of widgets) {
    rects.push(stageRectOf(widget));
  }
  return rects;
}

/**
 * Funnel width used by `FocusManager.move()`: 60% of the tangential size of the current rect, but
 * never less than 64 design pixels (a 40px-tall row in a list would otherwise be unreachable
 * sideways).
 */
export function directionalTolerance(current: Rect, direction: NavDirection): number {
  const tangential = direction === 'left' || direction === 'right' ? current.height : current.width;
  return Math.max(tangential * TOLERANCE_FACTOR, MIN_TOLERANCE);
}

/**
 * Picks the index of the best directional neighbour, or `null` when there is none.
 *
 * A candidate qualifies when its centre is strictly inside the requested half-plane (below for
 * `down`, …) and its tangential offset from the current centre is within `tolerance`. Among the
 * qualifying candidates the winner is the one with the smallest primary-axis distance; ties are
 * broken by the smaller tangential offset. The current rect never wins: its primary distance is 0,
 * which is not "strictly inside" the half-plane.
 */
export function pickDirectional(
  current: Rect,
  candidates: readonly Rect[],
  direction: NavDirection,
  tolerance: number,
): number | null {
  const currentX = current.x + current.width / 2;
  const currentY = current.y + current.height / 2;
  const horizontal = direction === 'left' || direction === 'right';

  let best: number | null = null;
  let bestPrimary = Number.POSITIVE_INFINITY;
  let bestTangential = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }

    const dx = candidate.x + candidate.width / 2 - currentX;
    const dy = candidate.y + candidate.height / 2 - currentY;

    const primary =
      direction === 'down' ? dy : direction === 'up' ? -dy : direction === 'right' ? dx : -dx;
    if (primary <= 0) {
      continue;
    }

    const tangential = horizontal ? Math.abs(dy) : Math.abs(dx);
    if (tangential > tolerance) {
      continue;
    }

    if (primary < bestPrimary || (primary === bestPrimary && tangential < bestTangential)) {
      best = index;
      bestPrimary = primary;
      bestTangential = tangential;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------- FocusManager

export interface FocusManagerOptions {
  /** Root widget to collect focusable widgets from; may also be given later via `attach()`. */
  root?: Widget | null;
  /**
   * Keeps focus inside the collected set: traversal wraps at the edges and `blur()` cannot release
   * focus. Used by modal pages (M8).
   */
  trapFocus?: boolean;
  /** Whether `next()`/`previous()` wrap around at the ends. Defaults to `true`. */
  wrap?: boolean;
  /** Called whenever the focused widget changes (`null` when focus is released). */
  onFocusChange?: (widget: Widget | null) => void;
  /**
   * Advisory flag for hosts and skins: when `true` the focused widget may paint a focus ring. The
   * manager itself never renders anything, so the flag changes no routing behaviour.
   */
  ring?: boolean;
  /** Called when a navigation source reports `back` (Escape, gamepad B/○, …). */
  onBack?: () => void;
}

/**
 * The focus manager of one widget subtree.
 *
 * It implements `FocusTarget`, so `widget.focus()` / `widget.blur()` (`Widget` forwards those to
 * `widget.focusManager`) work without the widget knowing about the scene plugin.
 */
export class FocusManager implements FocusTarget {
  /** Whether traversal wraps at the ends of the collection. */
  wrap: boolean;
  /** When `true`, focus can neither wrap out of the set nor be released. */
  trapFocus: boolean;
  /** Advisory focus-ring flag, see `FocusManagerOptions.ring`. */
  ring: boolean;
  /** Change callback, writable so hosts can swap it after construction. */
  onFocusChange: ((widget: Widget | null) => void) | null;
  /** `back` handler, writable for the same reason. */
  onBack: (() => void) | null;

  private rootWidget: Widget | null = null;
  private widgets: Widget[] = [];
  private index = -1;

  constructor(options: FocusManagerOptions = {}) {
    this.wrap = options.wrap ?? true;
    this.trapFocus = options.trapFocus ?? false;
    this.ring = options.ring ?? true;
    this.onFocusChange = options.onFocusChange ?? null;
    this.onBack = options.onBack ?? null;

    if (options.root) {
      this.attach(options.root);
    }
  }

  /** Root of the collected subtree, or `null` while detached. */
  get root(): Widget | null {
    return this.rootWidget;
  }

  /** The collected widgets, in navigation order. */
  get focusables(): readonly Widget[] {
    return this.widgets;
  }

  /** Widget that currently holds focus, or `null`. */
  get focusedWidget(): Widget | null {
    return this.index >= 0 ? (this.widgets[this.index] ?? null) : null;
  }

  /** True when `widget` is part of the collected set. */
  has(widget: Widget): boolean {
    return this.widgets.includes(widget);
  }

  /** Sets the root of the collection and collects its focusable widgets. */
  attach(root: Widget): void {
    if (this.rootWidget === root) {
      this.refresh();
      return;
    }
    this.detach();
    this.rootWidget = root;
    this.refresh();
  }

  /**
   * Re-collects the focusable widgets.
   *
   * Call after the tree changed (a widget was added/removed, or made focusable/visible) or after
   * `focusOrder` was changed. Focus is kept when the widget is still collectable.
   */
  refresh(): void {
    const previous = this.focusedWidget;

    for (const widget of this.widgets) {
      if (widget.focusManager === this) {
        widget.focusManager = null;
      }
    }

    this.widgets = this.rootWidget ? collectFocusable(this.rootWidget) : [];
    for (const widget of this.widgets) {
      widget.focusManager = this;
    }

    this.index = previous ? this.widgets.indexOf(previous) : -1;
    if (previous && this.index === -1) {
      // The focused widget is no longer focusable: release it instead of keeping a stale reference.
      previous.setFocusedInternal(false);
      this.notify(null);
    }
  }

  /** Moves focus to `widget`. Widgets outside the collected set are ignored. */
  focus(widget: Widget): void {
    const index = this.widgets.indexOf(widget);
    if (index === -1) {
      return;
    }
    this.applyFocus(widget, index);
  }

  /** Releases focus from `widget` (only if it actually holds it). */
  blur(widget: Widget): void {
    if (this.trapFocus) {
      return;
    }
    if (this.focusedWidget !== widget) {
      return;
    }
    this.index = -1;
    widget.setFocusedInternal(false);
    this.notify(null);
  }

  /**
   * Focuses the next widget in the collection (the first one when nothing is focused).
   *
   * Returns `true` when focus moved, `false` when it could not (empty set, or an edge with
   * `wrap === false` and no trap).
   */
  next(): boolean {
    return this.step(1);
  }

  /** Focuses the previous widget in the collection; mirrors `next()`. */
  previous(): boolean {
    return this.step(-1);
  }

  /**
   * Moves focus geometrically: the nearest widget whose centre lies in `direction` and whose
   * centre is within the funnel (`directionalTolerance`) of the focused rect.
   *
   * With no focused widget the geometric move has no origin, so focus enters the set (the first
   * focusable widget), which is what pressing an arrow key in a fresh page should do.
   */
  move(direction: NavDirection): boolean {
    const current = this.focusedWidget;
    if (!current) {
      return this.next();
    }

    const rects = stageRectsOf(this.widgets);
    const currentRect = rects[this.index];
    if (!currentRect) {
      return false;
    }

    const picked = pickDirectional(
      currentRect,
      rects,
      direction,
      directionalTolerance(currentRect, direction),
    );
    if (picked === null) {
      return false;
    }

    const widget = this.widgets[picked];
    if (!widget) {
      return false;
    }
    return this.applyFocus(widget, picked);
  }

  /**
   * Activates the focused widget.
   *
   * Keyboard activations use `'keyboard'` (the default) and gamepad ones `'gamepad'`; the source is
   * forwarded to `Widget.activate()` so widgets can behave differently per device.
   */
  activate(source: ActivationSource = 'keyboard'): boolean {
    const widget = this.focusedWidget;
    if (!widget) {
      return false;
    }
    return widget.activate(source);
  }

  /** Reports `back` to the host; returns `true` when a handler consumed it. */
  back(): boolean {
    if (!this.onBack) {
      return false;
    }
    this.onBack();
    return true;
  }

  /**
   * Dispatches a navigation action to the matching traversal/activation method.
   *
   * `source` is threaded through to `Widget.activate()`; returning `false` means "nothing happened"
   * (no focus, no neighbour, no `back` handler), which lets a host keep the action for itself.
   */
  handleAction(action: NavAction, source: ActivationSource): boolean {
    switch (action) {
      case 'next':
        return this.next();
      case 'prev':
        return this.previous();
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        return this.move(action);
      case 'activate':
        return this.activate(source);
      case 'back':
        return this.back();
      default:
        return false;
    }
  }

  /**
   * Releases focus, clears the collection and disconnects every widget's `focusManager` back
   * reference. Idempotent; safe to call from a scene shutdown handler.
   */
  detach(): void {
    const focused = this.focusedWidget;

    for (const widget of this.widgets) {
      if (widget.focusManager === this) {
        widget.focusManager = null;
      }
      widget.setFocusedInternal(false);
    }

    this.widgets = [];
    this.index = -1;
    this.rootWidget = null;

    if (focused) {
      this.notify(null);
    }
  }

  /** Alias for `detach()`, so hosts can use the usual teardown name. */
  dispose(): void {
    this.detach();
  }

  private step(delta: number): boolean {
    const count = this.widgets.length;
    if (count === 0) {
      return false;
    }

    if (this.index === -1) {
      // Nothing focused yet: tab into the set from the correct end.
      return delta > 0 ? this.focusAt(0) : this.focusAt(count - 1);
    }

    let next = this.index + delta;
    if (next < 0 || next >= count) {
      if (!this.wrap && !this.trapFocus) {
        return false;
      }
      next = next < 0 ? count - 1 : 0;
    }
    return this.focusAt(next);
  }

  private focusAt(index: number): boolean {
    const widget = this.widgets[index];
    if (!widget) {
      return false;
    }
    return this.applyFocus(widget, index);
  }

  private applyFocus(widget: Widget, index: number): boolean {
    if (index === this.index && this.focusedWidget === widget) {
      return false;
    }

    this.focusedWidget?.setFocusedInternal(false);
    this.index = index;
    widget.setFocusedInternal(true);
    this.notify(widget);
    return true;
  }

  private notify(widget: Widget | null): void {
    this.onFocusChange?.(widget);
  }
}
