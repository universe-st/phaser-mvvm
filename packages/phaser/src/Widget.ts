/**
 * `Widget` — the base class of every phaser-mvvm widget.
 *
 * A widget is a `Phaser.GameObjects.Container` that also implements the layout engine's
 * `LayoutNode` contract:
 *
 * - the engine measures it through `measureContent` and writes geometry back through `applyRect`,
 * - it keeps its own list of *widget* children (`children`), which may be a subset of `list`
 *   (a Label, for example, owns a plain `Phaser.GameObjects.Text` that must not participate in
 *   layout),
 * - `markDirty()` bumps `revision` and invalidates the node in the engine, which propagates
 *   upwards so that only the affected subtree is re-measured.
 */

import Phaser from 'phaser';
import {
  type BoxConstraints,
  type ContainerLayout,
  type LayoutEngine,
  type LayoutNode,
  type LayoutParams,
  type Rect,
  type ResolvedParams,
  type Size,
  mergeParams,
  normalizeParams,
} from '@phaser-mvvm/layout';
import { effectScope, type EffectScope } from '@phaser-mvvm/core';
import { getTheme, onThemeChange, type Theme } from './theme';
import type { NavAction } from './nav';
import { devLog, isDevMode } from '@phaser-mvvm/core';
import { inFlowOf } from '@phaser-mvvm/layout';
import { resolveWidgetState, type WidgetState } from './widget-state';
import type { A11yDescriptor } from './a11y';

export interface WidgetOptions {
  /** Declarative sizing/placement parameters, see `LayoutParams`. */
  layout?: LayoutParams;
  /** Debug name; also used by `scene.children.getByName`. */
  name?: string;
  visible?: boolean;
  /**
   * Tab order hint for the focus manager (lower first; ties keep the widget-tree order).
   *
   * It is a plain field on the widget, so this option is the declarative form of setting it. Without
   * it here, `Button('确定', { focusOrder: 1 })` compiled and was silently dropped - the same trap as
   * any other key that never reaches a setter.
   */
  focusOrder?: number;
  /**
   * Accessible name for the DOM mirror (`a11y.ts`).
   *
   * A control that draws its own text (a button, a field with a placeholder) already has a name; one
   * that does not (a slider, a scroll area, a clickable card) needs this, or a screen reader would read
   * the widget's debug `name` — an internal id nobody should hear.
   */
  label?: string;
}

export class Widget extends Phaser.GameObjects.Container implements LayoutNode {
  /** Normalised layout params. Mutate through `setLayoutParams`, not directly. */
  readonly layoutParams: ResolvedParams;

  /** Container algorithm used for this widget's children; `null` means "leaf". */
  container: ContainerLayout | null = null;

  /** Content revision: bumped by `markDirty()`. */
  revision = 0;

  /** Parent layout node; maintained by `addWidget`/`removeWidget`. */
  parent: LayoutNode | null = null;

  /** Layout engine this widget belongs to; propagated down the widget tree. */
  engine: LayoutEngine | null = null;

  /**
   * Notified whenever this widget or one of its descendants gains or loses a child.
   *
   * The layout root installs one listener and bumps a version counter, which is how the scene plugin
   * knows it has to re-collect input targets — a structural change cannot be detected through the
   * layout dirty flag, because `UIRoot.addWidget()` lays out eagerly and consumes it.
   */
  structureListener: (() => void) | null = null;

  /** Rect assigned by the engine, in the parent's local coordinates. */
  protected readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  private readonly widgetChildren: Widget[] = [];

  constructor(scene: Phaser.Scene, options: WidgetOptions = {}) {
    super(scene, 0, 0);

    this.layoutParams = normalizeParams(options.layout);

    if (options.name !== undefined) {
      this.name = options.name;
    }
    if (options.visible !== undefined) {
      super.setVisible(options.visible);
    }
    if (options.focusOrder !== undefined && Number.isFinite(options.focusOrder)) {
      this.focusOrder = options.focusOrder;
    }
    if (options.label !== undefined) {
      this.a11yLabel = options.label;
    }

    this.setSize(0, 0);

    this.unsubscribeTheme = onThemeChange(() => {
      this.refreshAppearance();
      this.markDirty();
    });
  }

  // ------------------------------------------------------------------ interaction state

  /** Whether the widget accepts input. A disabled widget is skipped by pointer and keyboard. */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Whether the widget can take keyboard/gamepad focus (set by interactive widgets). */
  focusable = false;

  /**
   * Whether this widget (and its whole subtree) can be hit by the pointer. `false` means **painted and
   * laid out, but not a pointer target**.
   *
   * `visible: false` is the blunt version of the same idea: it also drops the subtree out of the layout
   * flow and stops painting it. That is wrong for a page that is still on screen while the page above it
   * fades in (a transition), or for an overlay that must not intercept the pointer yet — those keep their
   * pixels and lose only their routing.
   *
   * The hit-test walk is the only reader: the widget stays in `InputRouter#widgets` (and therefore in the
   * accessibility mirror), because a subtree that is painted is still part of what the user sees, and
   * re-creating its mirror nodes twice per transition would be worse than a page that is briefly not
   * clickable.
   */
  routingEnabled = true;

  /**
   * Ordering hint for the focus manager; ties keep the widget-tree order. Named `focusOrder`
   * because `tabIndex` already exists on `Phaser.GameObjects.GameObject`.
   */
  focusOrder = 0;

  /** Set by the focus manager so `focus()`/`blur()` work without reaching for the scene plugin. */
  focusManager: FocusTarget | null = null;

  /** Called when the widget is activated by pointer, keyboard or gamepad. */
  onActivate: ((source: ActivationSource) => void) | null = null;

  /**
   * First refusal on a key press, while this widget has focus.
   *
   * Return `true` to *consume* the key: the plugin then skips navigation for it (and calls
   * `preventDefault()`). Return `false`/`undefined` to let the focus manager handle it as usual, which
   * is what keeps `Tab`/`Escape`/arrows working on every other widget.
   *
   * This hook is for the *keys* a widget owns beyond navigation — typing, `Home`/`End`,
   * `PageUp`/`PageDown`. A direction that is a navigation action belongs in {@link Widget.onAction}
   * instead, so the widget behaves the same on a gamepad.
   */
  onKeyDown: ((event: KeyboardEvent, action: NavAction | null) => boolean) | null = null;

  /**
   * First refusal on a navigation action, **whatever device produced it**.
   *
   * The plugin asks the focused widget before the focus manager moves or activates anything, for keys
   * *and* for gamepad D-Pad/stick input, so a widget claims a direction once and gets it from both
   * devices. A `Slider` moves its value with `left`/`right`; the same directions still navigate focus
   * away from every other widget.
   *
   * Declining (`false`/`undefined`) is the default and means "this is navigation, not mine". A widget
   * should decline the directions that are *not* its own axis: that is what keeps `up`/`down`
   * available for leaving a horizontal slider with a D-Pad.
   */
  onAction: ((action: NavAction, source: ActivationSource) => boolean) | null = null;

  private _enabled = true;
  private _hovered = false;
  private _pressed = false;
  private _focused = false;
  private _error = false;
  private pointerReady = false;
  private unsubscribeTheme: (() => void) | null = null;

  /**
   * Ownership scope for everything reactive attached to this widget (bindings, watchers). Stopping
   * it on destroy is what keeps long-lived UIs free of stale subscriptions (PLAN §4.1).
   */
  readonly scope: EffectScope = effectScope(true);

  /**
   * Visual state derived from the interaction flags (see `widget-state.ts`). Named `visualState`
   * because `state` is already a `string | number` field on `Phaser.GameObjects.GameObject`.
   */
  get visualState(): WidgetState {
    return resolveWidgetState({
      enabled: this._enabled,
      hovered: this._hovered,
      pressed: this._pressed,
      focused: this._focused,
      error: this._error,
    });
  }

  get hovered(): boolean {
    return this._hovered;
  }

  get pressed(): boolean {
    return this._pressed;
  }

  get focused(): boolean {
    return this._focused;
  }

  get error(): boolean {
    return this._error;
  }

  /** Theme currently in use; widgets repaint themselves when it changes. */
  get theme(): Theme {
    return getTheme();
  }

  setEnabled(value: boolean): this {
    if (this._enabled === value) {
      return this;
    }
    this._enabled = value;
    if (!value) {
      this._hovered = false;
      this._pressed = false;
      this.blur();
    }
    this.appearanceChanged();
    return this;
  }

  setError(value: boolean): this {
    if (this._error === value) {
      return this;
    }
    this._error = value;
    this.appearanceChanged();
    return this;
  }

  /** @internal used by the input router. */
  setHovered(value: boolean): void {
    if (this._hovered === value) {
      return;
    }
    this._hovered = value;
    this.appearanceChanged();
  }

  /** @internal used by the input router. */
  setPressed(value: boolean): void {
    if (this._pressed === value) {
      return;
    }
    this._pressed = value;
    this.appearanceChanged();
  }

  /**
   * What this widget is, for the DOM accessibility mirror (`a11y.ts`).
   *
   * `null` (the default) means "not interactive, do not mirror it" — a `Label` is read through the
   * control that owns it, not on its own. A widget sets this in its constructor; anything that changes
   * over time (a field's text, a slider's value, a toggle's state) overrides `describeA11y()`.
   */
  a11y: A11yDescriptor | null = null;

  /**
   * Accessible name for the mirror (`label` in the widget options).
   *
   * `null` means "derive it": a widget with visible text uses that text, anything else falls back to
   * its debug `name`.
   */
  a11yLabel: string | null = null;

  /**
   * The current description for the mirror; defaults to {@link Widget.a11y}.
   *
   * The bridge calls this when it rebuilds (structure change, focus change) or when asked to
   * `sync()` a widget, so an override should be cheap and side-effect free.
   */
  describeA11y(): A11yDescriptor | null {
    return this.a11y;
  }

  /**
   * The widget's own DOM element, when it has one (`DomInputBridge` for a text field).
   *
   * Accessibility is per *element*: a text field already has a real, labelled, focusable `<input>` in
   * the DOM overlay, so a screen reader sees it without any help from the mirror. Mirroring it a second
   * time as a `<div role="textbox">` exposed the same control twice (Chrome's AX tree on `#/a11y`
   * listed four textboxes for two fields, and the `div`'s value was its own label), so the bridge asks
   * this method and **steps aside** when it answers with an element: the mirror node becomes
   * `aria-hidden` and the element receives the role/name/state.
   *
   * `null` (the default) is the normal case for a widget painted on the canvas, and it is also the
   * right answer for a field whose bridge could not be created (no DOM container, `dom: false`) — then
   * the mirror node *is* the surface again, instead of the control going unannounced.
   */
  getA11yDomElement(): HTMLElement | null {
    return null;
  }

  /** Moves keyboard/gamepad focus to this widget. */
  focus(): void {
    this.focusManager?.focus(this);
  }

  /** Releases keyboard/gamepad focus. */
  blur(): void {
    this.focusManager?.blur(this);
  }

  /**
   * Scrolls this widget's own viewport so that `target` — a descendant — becomes visible.
   *
   * The `scrollIntoView` of this framework, and the answer to "the focus ring is somewhere I cannot
   * see": the focus system walks the container chain of whatever just took focus and asks each widget
   * in turn (`revealInViewports` in `reveal.ts`), so a keyboard or gamepad user is never left
   * focusing something a mask has clipped away.
   *
   * `false` is the honest default — a plain box has no viewport to move, and a widget that *does*
   * have one (`ScrollView`) overrides this. The parameter is typed as `Widget` because that is what
   * callers have; an implementation must still check that it really contains the target
   * (`contentRectOf` returns `null` when it does not).
   */
  revealDescendant(_target: Widget): boolean {
    return false;
  }

  /** @internal used by the focus manager. */
  setFocusedInternal(value: boolean): void {
    if (this._focused === value) {
      return;
    }
    this._focused = value;
    this.appearanceChanged();
  }

  /** Fires the activation callback (pointer click, Enter/Space, gamepad south button). */
  activate(source: ActivationSource = 'pointer'): boolean {
    if (!this._enabled) {
      return false;
    }
    if (isDevMode()) {
      // One line per successful activation, whatever the input device: the first question when a
      // control "does nothing" is whether it was activated at all, and this answers it without a
      // debugger. `isDevMode()` guards the interpolation so release builds build no string.
      devLog(`activate: ${this.name || this.constructor.name} (${source})`);
    }
    this.onActivate?.(source);
    this.emit(WIDGET_EVENTS.ACTIVATE, source);
    return true;
  }

  /**
   * Enables pointer hit testing with a hit area that follows the rect assigned by the layout
   * engine (containers need an explicit shape, unlike sprites).
   */
  enablePointerInput(): this {
    if (this.pointerReady) {
      return this;
    }
    const width = Math.max(1, this.rect.width);
    const height = Math.max(1, this.rect.height);
    // Phaser normalises hit-test coordinates by `displayOrigin`, and a Container defines that as
    // *half of its size* (`Container#displayOriginX`), so a hit area covering the local box
    // (0,0)-(w,h) has to be placed at (w/2, h/2) in hit-area space. Without the offset a small
    // widget is never hit while a large one accidentally still is — verified against Phaser 4.2.1
    // `InputManager.hitTest` (which feeds `localX + displayOriginX` to the hit area callback).
    this.setInteractive(
      new Phaser.Geom.Rectangle(width / 2, height / 2, width, height),
      Phaser.Geom.Rectangle.Contains,
    );
    this.pointerReady = true;
    return this;
  }

  /** Subclasses repaint their background here; called on state and theme changes. */
  protected refreshAppearance(): void {}

  /** Invalidates the appearance and repaints. */
  protected appearanceChanged(): void {
    this.refreshAppearance();
    this.emit(WIDGET_EVENTS.STATE_CHANGE, this.visualState);
  }

  private syncHitArea(): void {
    if (!this.pointerReady) {
      return;
    }
    const hitArea = this.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (hitArea) {
      const width = Math.max(1, this.rect.width);
      const height = Math.max(1, this.rect.height);
      hitArea.width = width;
      hitArea.height = height;
      hitArea.x = width / 2;
      hitArea.y = height / 2;
    }
  }

  // ------------------------------------------------------------------ LayoutNode

  /** Widget children that take part in layout. */
  get children(): readonly LayoutNode[] {
    return this.widgetChildren;
  }

  /**
   * Whether the widget takes part in the flow.
   *
   * A hidden widget collapses (measured as 0×0 and not placed) unless its layout params ask for
   * `hideMode: 'keep'`, which keeps the slot so siblings stay put - the CSS `visibility: hidden` of
   * this framework. Focus and pointer collection use `visible`, never `inFlow`, so a kept-but-hidden
   * widget stays unfocusable and unclickable.
   */
  get inFlow(): boolean {
    return inFlowOf(this.visible, this.layoutParams.hideMode);
  }

  /**
   * A widget whose width and height are both fixed cannot change size because of its content, so
   * dirty propagation may stop here instead of walking all the way to the root.
   */
  get isRelayoutBoundary(): boolean {
    const params = this.layoutParams;
    return (
      typeof params.width === 'number' &&
      typeof params.height === 'number' &&
      params.aspectRatio === null
    );
  }

  /** Intrinsic content size. Subclasses override; containers fall back to the arranger. */
  measureContent(_constraint: BoxConstraints): Size {
    return { width: 0, height: 0 };
  }

  /** Called by the engine with the final, snapped rect (parent-local coordinates). */
  applyRect(rect: Rect): void {
    this.rect.x = rect.x;
    this.rect.y = rect.y;
    this.rect.width = rect.width;
    this.rect.height = rect.height;

    this.setPosition(rect.x, rect.y);
    this.setSize(rect.width, rect.height);

    this.onRectChanged(this.rect);
    this.syncHitArea();
  }

  /** Hook for subclasses that position/size their internal (non-widget) Game Objects. */
  protected onRectChanged(_rect: Rect): void {}

  /** Last rect assigned by the engine. */
  get appliedRect(): Readonly<Rect> {
    return this.rect;
  }

  // ------------------------------------------------------------------ tree

  /** Adds a widget child (re-parenting it if needed) and marks the tree dirty. */
  addWidget<T extends Widget>(child: T): T {
    if ((child as unknown as Widget) === this) {
      throw new Error('Widget.addWidget: a widget cannot be added to itself');
    }

    const previous = child.parent as Widget | null;
    if (previous === (this as unknown as Widget)) {
      return child;
    }
    if (previous && typeof previous.removeWidget === 'function') {
      previous.removeWidget(child, false);
    }

    child.parent = this;
    // The listener must be installed *before* the recursive walk: `setEngineRecursive` hands the
    // parent's listener to the children it visits, so a subtree attached to a widget whose own
    // listener is still unset (the usual case for a freshly built subtree) would end up with a chain
    // of `null` listeners — and `UIRoot.structureVersion` would never move, leaving every
    // dynamically created widget unregistered with the input router.
    child.structureListener = this.structureListener;
    child.setEngineRecursive(this.engine);
    this.widgetChildren.push(child);
    this.add(child);
    child.once(Phaser.GameObjects.Events.DESTROY, this.handleChildDestroyed, this);

    this.markDirty();
    // A subtree added to a camera-pinned parent has to be pinned too: Phaser's hit test uses the hit
    // object's *own* scroll factor, so a factor-1 leaf under a factor-0 root is drawn in the pinned place
    // but never hit (ADR-0009). Inheriting here is what makes "pin the root" stay true over time.
    if (this.scrollFactorX !== 1 || this.scrollFactorY !== 1) {
      child.setScrollFactorAll(this.scrollFactorX, this.scrollFactorY);
    }
    this.structureListener?.();
    return child;
  }

  removeWidget<T extends Widget>(child: T, destroy = false): T {
    const index = this.widgetChildren.indexOf(child);
    if (index === -1) {
      if (destroy) {
        child.destroy();
      }
      return child;
    }

    this.widgetChildren.splice(index, 1);
    child.parent = null;
    child.setEngineRecursive(null);
    child.off(Phaser.GameObjects.Events.DESTROY, this.handleChildDestroyed, this);
    this.remove(child, destroy);

    this.markDirty();
    this.structureListener?.();
    return child;
  }

  removeAllWidgets(destroy = false): this {
    for (let i = this.widgetChildren.length - 1; i >= 0; i--) {
      const child = this.widgetChildren[i];
      if (child) {
        this.removeWidget(child, destroy);
      }
    }
    return this;
  }

  /** Widget children as a mutable-safe copy. */
  getWidgetChildren(): Widget[] {
    return this.widgetChildren.slice();
  }

  // ------------------------------------------------------------------ dirty state

  /** Bumps the content revision and invalidates this node upwards. */
  markDirty(): void {
    this.revision++;
    if (this.engine) {
      this.engine.invalidate(this);
    }
  }

  /**
   * Applies a partial params patch and marks the widget dirty.
   *
   * Only the keys the patch mentions are rewritten (`mergeParams`), so an incremental update cannot
   * silently reset the fields it left out — patching `height` keeps a `position: 'absolute'` or a
   * `width: 'fill'` the widget was configured with.
   */
  setLayoutParams(patch: LayoutParams): this {
    Object.assign(this.layoutParams, mergeParams(this.layoutParams, patch));
    this.markDirty();
    return this;
  }

  override setVisible(value: boolean): this {
    super.setVisible(value);
    this.markDirty();
    return this;
  }

  /**
   * Sets the scroll factor on this widget **and every descendant**.
   *
   * Phaser's hit test restores the pointer with the *hit object's own* scroll factor
   * (`InputManager.js:905` overwrites `worldX/Y` from `camera.getWorldPoint`, `:924` then applies
   * `worldX + scrollX * object.scrollFactorX - scrollX`). A camera-pinned UI therefore has to be pinned on
   * **every** widget: pinning only the root leaves the leaves at factor 1, the restored coordinate lands in
   * a different space than the world-matrix inverse, and every hit test misses (measured: `hitTest` returns
   * 0 with only the root pinned, 1 with the whole tree pinned).
   */
  override setScrollFactor(x: number, y: number = x): this {
    return this.setScrollFactorAll(x, y);
  }

  /** Propagates a scroll factor down the widget tree; see `setScrollFactor`. */
  setScrollFactorAll(x: number, y: number = x): this {
    super.setScrollFactor(x, y);
    for (const child of this.widgetChildren) {
      child.setScrollFactorAll(x, y);
    }
    return this;
  }

  override destroy(fromScene?: boolean): void {
    for (let i = this.widgetChildren.length - 1; i >= 0; i--) {
      const child = this.widgetChildren[i];
      if (child) {
        child.parent = null;
        child.setEngineRecursive(null);
      }
    }
    this.widgetChildren.length = 0;

    this.scope.stop();
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.focusManager = null;
    // The input router and the focus manager keep poking widgets they handed back (a removed row is
    // unregistered a frame later, and `refreshInteraction()` runs once after a structural change).
    // Leaving the flags set made those pokes look like real transitions, so a destroyed widget would
    // repaint — touching `Graphics`/`Text` objects the destroy already released. Clearing them here
    // turns every later `setHovered(false)`/`setPressed(false)`/`setFocusedInternal(false)` into a
    // no-op through the existing equality guards.
    this._hovered = false;
    this._pressed = false;
    this._focused = false;
    this.pointerReady = false;

    const engine = this.engine;
    this.engine = null;
    this.parent = null;
    if (engine) {
      engine.invalidate(this);
    }

    super.destroy(fromScene);
  }

  // ------------------------------------------------------------------ internals

  /** Propagates the engine reference and the structure listener down the widget tree. */
  protected setEngineRecursive(engine: LayoutEngine | null): void {
    this.engine = engine;
    for (let i = 0; i < this.widgetChildren.length; i++) {
      const child = this.widgetChildren[i];
      if (child) {
        child.structureListener = this.structureListener;
        child.setEngineRecursive(engine);
      }
    }
  }

  private handleChildDestroyed(child: Phaser.GameObjects.GameObject): void {
    const index = this.widgetChildren.indexOf(child as Widget);
    if (index !== -1) {
      this.widgetChildren.splice(index, 1);
      this.markDirty();
      this.structureListener?.();
    }
  }
}

/** Activation sources a widget can receive. */
export type ActivationSource = 'pointer' | 'keyboard' | 'gamepad';

/** Minimal focus-manager surface `Widget.focus()` needs (implemented by `FocusManager`). */
export interface FocusTarget {
  focus(widget: Widget): void;
  blur(widget: Widget): void;
  /**
   * Re-collects the focusable widgets of the scope in play (optional; `FocusManager` implements it).
   *
   * A widget that replaces its own descendants — an on-screen keyboard switching its key set — has to
   * call this before it can hand focus to one of the new widgets: `focus()` only accepts a widget of the
   * scope's *collection*, which still describes the nodes that were just destroyed, so the call would be
   * silently ignored and the player would be left with nothing focused.
   */
  refresh?(): void;
  /**
   * Dispatches a navigation action (optional; `FocusManager` implements it).
   *
   * It exists for widgets that have to drive traversal *themselves*: a text field whose hidden DOM
   * element holds the browser's focus has to `preventDefault()` the key to keep the caret where it
   * is, and Phaser's keyboard manager then ignores that event entirely (`KeyboardManager` returns
   * early on `defaultPrevented`). Without a way to hand the action back, `Tab` would never leave a
   * focused field and `Escape` would be dead inside a modal.
   */
  handleAction?(action: NavAction, source: ActivationSource): boolean;
}

/** Events emitted by widgets on the Phaser emitter. */
export const WIDGET_EVENTS = {
  ACTIVATE: 'widget:activate',
  STATE_CHANGE: 'widget:state',
} as const;
