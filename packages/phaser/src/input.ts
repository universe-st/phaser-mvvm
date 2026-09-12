/**
 * `InputRouter` — pointer routing for a widget tree.
 *
 * Phaser already does the hard part (hit testing, cameras, `topOnly`); this router adds the widget
 * semantics on top of it:
 *
 * - hover/press state is mirrored onto the widget (`setHovered`/`setPressed`) so skins can paint it,
 * - a press becomes an activation only when the pointer barely moved between down and up
 *   (`dragThreshold`), which is what keeps a future `ScrollView` drag from clicking a button,
 * - a disabled widget never hovers, presses or activates, and a widget that is disabled *while*
 *   hovering/pressed is corrected by a per-frame poll,
 * - a *capture* widget (a modal overlay) shields the widgets underneath it.
 *
 * The judgement calls (`isClickGesture`, `diffInteractionState`, `isWithinTree`) are exported as
 * pure functions and tested with plain objects; the class itself only talks to Phaser.
 */

import type Phaser from 'phaser';
import type { ActivationSource, Widget } from './Widget';

/**
 * Phaser input event names.
 *
 * They are spelled out (rather than read from `Phaser.Input.Events`) so that this module has no
 * *runtime* dependency on Phaser: importing it in a Node test costs nothing.
 */
const EVENT_OVER = 'pointerover';
const EVENT_OUT = 'pointerout';
const EVENT_DOWN = 'pointerdown';
const EVENT_UP = 'pointerup';
const EVENT_DESTROY = 'destroy';

/** Default maximum travel (in stage pixels) for a press to count as a click. */
export const DEFAULT_DRAG_THRESHOLD = 8;

export interface InputRouterOptions {
  /** Root widget whose subtree is routed; may also be given later via `attach()`. */
  root?: Widget | null;
  /** Called after a pointer activation was accepted by the widget. */
  onActivate?: (widget: Widget, source: ActivationSource) => void;
  /** Maximum pointer travel between down and up that still counts as a click. Defaults to 8. */
  dragThreshold?: number;
}

/** A plain 2D point. */
export interface PointLike {
  x: number;
  y: number;
}

/**
 * True when a press that started at `down` and ended at `up` was a click rather than a drag.
 *
 * The comparison is strict (`< threshold`), so a pointer that travelled exactly `threshold` pixels
 * is already a drag: `dragThreshold` reads as "clicks need less movement than this".
 */
export function isClickGesture(down: PointLike, up: PointLike, threshold: number): boolean {
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  return Math.sqrt(dx * dx + dy * dy) < threshold;
}

/**
 * Widgets whose interaction state must be reset because they just became disabled.
 *
 * Only the "enabled → disabled" transition is reported: a widget that becomes enabled again has no
 * stale hover/press state to clear, and a widget that was never tracked (no entry in `previous`) is
 * fresh by definition. The function does not mutate `previous` — the caller (the router) refreshes
 * the map once it has reset the widgets it got back.
 */
export function diffInteractionState(
  previous: Map<Widget, boolean>,
  widgets: readonly Widget[],
): Widget[] {
  const stale: Widget[] = [];
  for (const widget of widgets) {
    if (previous.get(widget) === true && widget.enabled === false) {
      stale.push(widget);
    }
  }
  return stale;
}

/** Minimal shape of a node in a `parentContainer` chain. */
export interface ContainerLike {
  readonly parentContainer?: ContainerLike | null;
}

/**
 * True when `node` is `ancestor` itself or one of its descendants in the container chain.
 *
 * This is the containment test behind input capture: events that reach a widget outside the capture
 * subtree must be swallowed, while events inside it (a modal's own buttons) must pass.
 */
export function isWithinTree(node: ContainerLike, ancestor: ContainerLike): boolean {
  let current: ContainerLike | null | undefined = node;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentContainer;
  }
  return false;
}

// ---------------------------------------------------------------------------- InputRouter

/** One widget's listeners, kept together so `detach()` can unhook exactly what `attach()` hooked. */
interface WidgetBinding {
  readonly widget: Widget;
  readonly onOver: (pointer: Phaser.Input.Pointer) => void;
  readonly onOut: (pointer: Phaser.Input.Pointer) => void;
  readonly onDown: (pointer: Phaser.Input.Pointer) => void;
  readonly onUp: (pointer: Phaser.Input.Pointer) => void;
  readonly onDestroy: () => void;
}

/**
 * `Widget.enablePointerInput()` is `protected` (only subclasses may call it), but enabling hit
 * testing *is* the router's job. The narrow cast below is the smallest way to reach it without
 * changing `Widget`.
 */
interface PointerEnableable {
  enablePointerInput(): unknown;
}

function enablePointerInput(widget: Widget): void {
  (widget as unknown as PointerEnableable).enablePointerInput();
}

/** A widget carrying the optional explicit "route my pointer input" marker. */
interface InteractiveFlagged {
  interactive?: unknown;
}

function hasInteractiveFlag(widget: Widget): boolean {
  return (widget as unknown as InteractiveFlagged).interactive === true;
}

/** Panels default to `blockPointer: true`; the flag lives on the widget library, hence the cast. */
function hasBlockPointerFlag(widget: Widget): boolean {
  return (widget as unknown as { blockPointer?: boolean }).blockPointer === true;
}

/** Reads a widget's scene defensively (a destroyed Game Object has its `scene` cleared). */
function liveSceneOf(widget: Widget): Phaser.Scene | null {
  const scene = (widget as { scene?: Phaser.Scene | null }).scene;
  return scene ?? null;
}

/** Routes pointer input for the widgets below a root, plus the per-frame disabled-state fix-up. */
export class InputRouter {
  /** Activation callback, writable so hosts can swap it after construction. */
  onActivate: ((widget: Widget, source: ActivationSource) => void) | null;
  /** Maximum travel that still counts as a click; see `isClickGesture`. */
  dragThreshold: number;

  private rootWidget: Widget | null = null;
  private scene: Phaser.Scene | null = null;
  private bindings: WidgetBinding[] = [];
  private widgetCache: Widget[] | null = null;
  private readonly enabledState = new Map<Widget, boolean>();
  private readonly pressedAt = new Map<Widget, PointLike>();
  private captureWidget: Widget | null = null;
  private previousTopOnly = true;

  // Scratch arrays, reused so that the per-frame path allocates nothing.
  private readonly hitInput: Phaser.GameObjects.GameObject[] = [];
  private readonly hitOutput: Phaser.GameObjects.GameObject[] = [];

  constructor(options: InputRouterOptions = {}) {
    this.onActivate = options.onActivate ?? null;
    this.dragThreshold = options.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
    if (options.root) {
      this.rootWidget = options.root;
    }
  }

  /** Root of the routed subtree, or `null` while detached. */
  get root(): Widget | null {
    return this.rootWidget;
  }

  /** Scene the router is bound to, or `null` while detached. */
  get boundScene(): Phaser.Scene | null {
    return this.scene;
  }

  /** Widgets currently routed, in tree order. */
  get widgets(): readonly Widget[] {
    return this.widgetList();
  }

  /** The capture widget, if any. */
  get capture(): Widget | null {
    return this.captureWidget;
  }

  /**
   * Enables pointer input for every interactive widget below `root` and hooks the Phaser events.
   *
   * Call it after the tree exists (a `UIRoot`); widgets mounted later are picked up by `refresh()`.
   * `scene` defaults to the root's own scene, so the two-argument form is the explicit one and the
   * one-argument form is what a host uses when the root is already in the scene.
   */
  attach(root: Widget, scene?: Phaser.Scene): void {
    this.detach();
    this.rootWidget = root;
    this.scene = scene ?? liveSceneOf(root);
    // Every interactive object must receive the event so `resolveTarget` can choose the deepest one;
    // with Phaser's default `topOnly` a container and its children are ranked by an undefined order.
    const input = this.scene?.input;
    if (input) {
      this.previousTopOnly = input.topOnly;
      input.topOnly = false;
    }
    this.refresh();
  }

  /**
   * Re-scans the tree: newly added interactive widgets are hooked, widgets that left the tree are
   * unhooked. Cheap enough to call after every structural change (mount/unmount), not per frame.
   */
  refresh(): void {
    if (!this.rootWidget) {
      return;
    }

    const wanted = collectInteractive(this.rootWidget);
    const wantedSet = new Set(wanted);

    for (const binding of [...this.bindings]) {
      if (!wantedSet.has(binding.widget)) {
        this.unregister(binding.widget);
      }
    }

    for (const widget of wanted) {
      if (!this.isRegistered(widget)) {
        this.register(widget);
      }
    }
  }

  /**
   * Sets (or clears) the capture widget — a modal overlay, for example.
   *
   * While a capture is set, pointer events on the widgets *underneath* its hit area are swallowed:
   * a click that lands inside the capture widget but outside its subtree does nothing, and click
   * that misses the capture widget entirely still reaches the rest of the UI (so a popup can be
   * dismissed by clicking the backdrop next to it).
   */
  setCapture(widget: Widget | null): void {
    if (widget) {
      // The hit test below needs the widget to have a hit area, and a modal mask is usually not
      // "interactive" in the routing sense (no focus, no activation), so it would not be enabled by
      // `refresh()`. Enabling input here does not add listeners: the mask stays out of the routed
      // set unless it also carries an activation callback or is focusable.
      enablePointerInput(widget);
    }
    this.captureWidget = widget;
  }

  /**
   * Per-frame maintenance, called by the host plugin.
   *
   * Polls `Widget.enabled` (a widget disabled while hovered or pressed must drop both states) and
   * prunes references to widgets that were destroyed without an explicit `refresh()`.
   */
  update(_time = 0, _delta = 0): void {
    const widgets = this.widgetList();
    const stale = diffInteractionState(this.enabledState, widgets);
    for (const widget of stale) {
      this.resetInteraction(widget);
    }

    for (const widget of widgets) {
      this.enabledState.set(widget, widget.enabled);
      if (widget.isDestroyed || liveSceneOf(widget) === null) {
        this.unregister(widget);
      }
    }
  }

  /**
   * Removes every listener and clears all references. Safe to call twice; call it from the scene's
   * `shutdown`/`destroy` handler so no listener outlives the UI.
   */
  detach(): void {
    if (this.scene?.input) {
      this.scene.input.topOnly = this.previousTopOnly;
    }
    for (const binding of [...this.bindings]) {
      this.unregister(binding.widget);
    }
    this.bindings = [];
    this.widgetCache = null;
    this.enabledState.clear();
    this.pressedAt.clear();
    this.captureWidget = null;
    this.rootWidget = null;
    this.scene = null;
  }

  // ------------------------------------------------------------------ internals

  private widgetList(): Widget[] {
    if (this.widgetCache === null) {
      this.widgetCache = this.bindings.map((binding) => binding.widget);
    }
    return this.widgetCache;
  }

  private isRegistered(widget: Widget): boolean {
    return this.bindings.some((binding) => binding.widget === widget);
  }

  private register(widget: Widget): void {
    enablePointerInput(widget);

    const binding: WidgetBinding = {
      widget,
      onOver: (pointer) => {
        this.handleOver(widget, pointer);
      },
      onOut: (pointer) => {
        this.handleOut(widget, pointer);
      },
      onDown: (pointer) => {
        this.handleDown(widget, pointer);
      },
      onUp: (pointer) => {
        this.handleUp(widget, pointer);
      },
      onDestroy: () => {
        this.unregister(widget);
      },
    };

    widget.on(EVENT_OVER, binding.onOver);
    widget.on(EVENT_OUT, binding.onOut);
    widget.on(EVENT_DOWN, binding.onDown);
    widget.on(EVENT_UP, binding.onUp);
    widget.once(EVENT_DESTROY, binding.onDestroy);

    this.bindings.push(binding);
    this.widgetCache = null;
    this.enabledState.set(widget, widget.enabled);
  }

  private unregister(widget: Widget): void {
    const index = this.bindings.findIndex((binding) => binding.widget === widget);
    if (index === -1) {
      return;
    }

    const binding = this.bindings[index];
    this.bindings.splice(index, 1);
    this.widgetCache = null;

    if (binding) {
      widget.off(EVENT_OVER, binding.onOver);
      widget.off(EVENT_OUT, binding.onOut);
      widget.off(EVENT_DOWN, binding.onDown);
      widget.off(EVENT_UP, binding.onUp);
      widget.off(EVENT_DESTROY, binding.onDestroy);
    }

    this.resetInteraction(widget);
    this.enabledState.delete(widget);
  }

  /** Drops hover/press state; used on disable, on destroy and on pointer-out. */

  /**
   * Resolves which interactive widget owns a pointer position, **from the inside out**.
   *
   * Phaser's own `topOnly` dispatch cannot be relied on for UI trees: container children are not on
   * the scene display list, so their sort order against their own container is undefined and a panel
   * with a hit area can swallow its child buttons. Walking the widget tree front-to-back (last child
   * is drawn on top) gives the semantics a UI needs.
   */
  private resolveTarget(pointer: Phaser.Input.Pointer): Widget | null {
    const root = this.rootWidget;
    if (!root) {
      return null;
    }

    const x = pointer.worldX;
    const y = pointer.worldY;

    const visit = (widget: Widget, offsetX: number, offsetY: number): Widget | null => {
      const children = widget.getWidgetChildren();
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (!child || child.visible === false) {
          continue;
        }
        const found = visit(child, offsetX + child.x, offsetY + child.y);
        if (found) {
          return found;
        }
      }

      if (!this.isRegistered(widget) || widget.enabled === false) {
        return null;
      }

      // `offset` already includes this widget's own position, so the point is expressed relative to
      // the widget's origin: the box to test is (0,0)-(width,height), *not* its parent-local rect.
      const rect = widget.appliedRect;
      const localX = x - offsetX;
      const localY = y - offsetY;
      const inside = localX >= 0 && localX <= rect.width && localY >= 0 && localY <= rect.height;
      return inside ? widget : null;
    };

    const target = visit(root, -root.x, -root.y);
    if (target && this.captureWidget && !isWithinTree(target, this.captureWidget)) {
      return null;
    }
    return target;
  }

  private resetInteraction(widget: Widget): void {
    this.pressedAt.delete(widget);
    widget.setHovered(false);
    widget.setPressed(false);
  }

  private handleOver(widget: Widget, pointer: Phaser.Input.Pointer): void {
    if (this.resolveTarget(pointer) !== widget) {
      return;
    }
    if (this.isBlockedByCapture(widget, pointer)) {
      return;
    }
    if (!widget.enabled) {
      return;
    }
    widget.setHovered(true);
  }

  private handleOut(widget: Widget, pointer: Phaser.Input.Pointer): void {
    const target = this.resolveTarget(pointer);
    if (target !== null && target !== widget) {
      // Another (deeper) widget owns the pointer: never clear its hover/pressed state from here.
      return;
    }
    if (this.isBlockedByCapture(widget, pointer)) {
      return;
    }
    this.resetInteraction(widget);
  }

  private handleDown(widget: Widget, pointer: Phaser.Input.Pointer): void {
    if (this.resolveTarget(pointer) !== widget) {
      return;
    }
    if (this.isBlockedByCapture(widget, pointer)) {
      return;
    }
    if (!widget.enabled) {
      return;
    }
    this.pressedAt.set(widget, { x: pointer.worldX, y: pointer.worldY });
    widget.setPressed(true);
  }

  private handleUp(widget: Widget, pointer: Phaser.Input.Pointer): void {
    if (this.resolveTarget(pointer) !== widget) {
      // The pointer was released over a different (or deeper) widget: this one is not activated.
      widget.setPressed(false);
      return;
    }
    const down = this.pressedAt.get(widget);
    this.resetInteraction(widget);

    if (down === undefined || this.isBlockedByCapture(widget, pointer)) {
      return;
    }
    if (!widget.enabled) {
      return;
    }
    // Phaser only emits `pointerup` on an object when the pointer is still over it, so "released
    // inside the widget" is already guaranteed here; only the travel has to be checked.
    if (!isClickGesture(down, { x: pointer.worldX, y: pointer.worldY }, this.dragThreshold)) {
      return;
    }

    if (widget.activate('pointer')) {
      this.onActivate?.(widget, 'pointer');
    }

    // `resetInteraction` cleared hover above; a click leaves the pointer inside the widget, so the
    // hover state has to be restored (Phaser will not re-emit `pointerover` for a pointer that never
    // left).
    if (widget.enabled && this.resolveTarget(pointer) === widget) {
      widget.setHovered(true);
    }
  }

  /**
   * True when the event must be swallowed because it belongs to a widget outside the capture
   * subtree while the pointer is inside the capture widget's hit area.
   */
  private isBlockedByCapture(widget: Widget, pointer: Phaser.Input.Pointer): boolean {
    const capture = this.captureWidget;
    if (!capture) {
      return false;
    }
    if (isWithinTree(widget, capture)) {
      return false;
    }
    return this.pointerHitsWidget(pointer, capture);
  }

  /**
   * Hit-tests a single widget.
   *
   * `InputManager.hitTest` is used instead of `InputPlugin.hitTestPointer` because the plugin's
   * variant writes into the very array the plugin is iterating while it dispatches this event; the
   * explicit output array here keeps that internal state untouched.
   */
  private pointerHitsWidget(pointer: Phaser.Input.Pointer, widget: Widget): boolean {
    const scene = this.scene;
    const input = scene?.input;
    if (!input) {
      return false;
    }
    const camera = pointer.camera ?? scene?.cameras.main;
    if (!camera) {
      return false;
    }

    this.hitInput.length = 0;
    this.hitInput.push(widget);
    this.hitOutput.length = 0;
    input.manager.hitTest(pointer, this.hitInput, camera, this.hitOutput);
    return this.hitOutput.length > 0;
  }
}

/**
 * Collects the widgets of a subtree that should receive pointer input: focusable ones, widgets with
 * an activation callback, and widgets flagged with an explicit `interactive` marker.
 */
export function collectInteractive(root: Widget): Widget[] {
  const found: Widget[] = [];

  const visit = (widget: Widget): void => {
    // `blockPointer` widgets (the default for panels) are collected too: they are not activatable,
    // but being a target is exactly what makes them swallow a pointer that would otherwise reach
    // whatever is painted behind them.
    if (
      widget.focusable === true ||
      widget.onActivate !== null ||
      hasInteractiveFlag(widget) ||
      hasBlockPointerFlag(widget)
    ) {
      found.push(widget);
    }
    for (const child of widget.getWidgetChildren()) {
      visit(child);
    }
  };

  visit(root);
  return found;
}
