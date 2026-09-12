/**
 * `ScrollView` — a clipped, gesture-driven viewport over an oversized child (PLAN §4.5, milestone M7).
 *
 * ## Clipping
 *
 * Phaser 4 removed the Phaser 3 `GeometryMask` for WebGL (PLAN §2): the supported path is
 * `Components.Filters`. Enabling filters on a Game Object makes it render into a framebuffer *sized
 * to the object itself* (`focusFilters()` sets the filter camera to the object's `width`/`height`),
 * and "anything outside the bounds of the framebuffer is not rendered" — that is the clip. An
 * internal `Mask` filter fed the `__WHITE` texture is the identity mask ("when the mask filter is
 * used as an internal filter, the mask will match the object/view being filtered"), so it only
 * forces that composite path.
 *
 * Three consequences worth knowing:
 * - `enableFilters()` marks the object as "context focused" when its size is still `0×0`, and context
 *   focus means "do not clip". The view therefore enables filters on the first non-zero rect, and
 *   clears `filtersFocusContext` defensively.
 * - The filter camera is focused **manually** (`filtersAutoFocus = false`, then size/origin/zoom are
 *   written on every layout). Phaser's own auto focus treats the camera origin as a half-object
 *   offset and lands the object's content off-centre inside the framebuffer, so a nested scroll view
 *   painted only its top-left ~half ("measured" in `.tmp/m7`: content cut at 53% × 53% of the
 *   viewport with auto focus, full viewport with the manual focus below).
 * - Filters are WebGL-only, so under the Canvas fallback the view clips with a `GeometryMask`
 *   instead — Phaser 4's `GeometryMask` is Canvas-only (PLAN §2), i.e. exactly the mirror image of
 *   the filter path. The mask is a white rectangle in stage space, repainted on every layout and
 *   frame so it follows the viewport; one development warning says which path is in use.
 *
 * Because the clip follows the ScrollView's own rect, the *viewport* must not move while scrolling —
 * which is exactly why the content is offset instead (see below).
 *
 * ## Moving the content
 *
 * The user's content lives in an internal, absolutely positioned holder whose `top`/`left` are the
 * negated offsets, so the layout engine itself places it (no post-layout position patching, no fight
 * with the arranger).
 *
 * When the content (or a descendant) is a **virtualised `Repeat`**, the view *also* forwards the
 * offset to `repeat.setScrollOffset()`, which is what tells the list which window of rows to mount.
 * That is not a second scroll: the list keeps every row at its *content* coordinate (`index ×
 * itemExtent`, padded by fillers so the unmounted rows still occupy their space) and only decides
 * *which* rows exist. The holder translation above is what actually moves them on screen, so the two
 * mechanisms compose into exactly one scroll. `get scrollTarget()` reports the list when it is found.
 */

import Phaser from 'phaser';
import { devLog, isDevMode, warn } from '@phaser-mvvm/core';
import type { BoxConstraints, LayoutParams, Rect, Size } from '@phaser-mvvm/layout';
import { stageRectOf, Widget } from '@phaser-mvvm/phaser';
import type { Theme } from '@phaser-mvvm/phaser';
import { optionBag, splitWidgetOptions, baseWidgetOptions } from './options';
import {
  clampZoomOffset,
  pinchDistance,
  pinchMidpoint,
  pinchOffset,
  pinchScale,
  type ZoomPoint,
} from './zoom-plan';
import {
  INERTIA_DECELERATION,
  applyInertia,
  clampOffset,
  extentOfRects,
  isScrollable,
  normalizeWheel,
  planScrollDrag,
  planScrollKey,
  thumbGeometry,
  type ScrollRect,
} from './scroll-plan';

export type ScrollDirection = 'vertical' | 'horizontal' | 'both';

/** Scrollbar visibility: `true` always, `false` never, `'auto'` only when the content overflows. */
export type ScrollbarMode = boolean | 'auto';

export interface ScrollViewOptions extends LayoutParams {
  /** Axis (or axes) the view scrolls along. Defaults to `'vertical'`. */
  direction?: ScrollDirection;
  /** Initial content. Same as calling `setContent()` after construction. */
  content?: Widget;
  /** Scrollbar policy. Defaults to `'auto'`. */
  scrollbar?: ScrollbarMode;
  /** Scrollbar thickness in design pixels. Defaults to `8`. */
  scrollbarSize?: number;
  /** Multiplier applied to wheel deltas. Defaults to `1`. */
  wheelSpeed?: number;
  /** Enables pointer dragging. Defaults to `true`. */
  drag?: boolean;
  /** Enables the fling after a drag. Defaults to `true`. */
  inertia?: boolean;
  /** Enables rubber-band overscroll that springs back. Defaults to `false`. */
  bounce?: boolean;
  /**
   * Enables two-finger pinch zoom (`true`, or `{ min, max }`), default off.
   *
   * Not available while a virtualised list is the scroll target: a scaled list would have to map
   * `itemExtent` through the scale, so the view reports the conflict once and ignores the gesture
   * instead of scrolling to the wrong rows.
   */
  zoom?: boolean | { min?: number; max?: number };
  name?: string;
  /** Tab order hint for the focus manager (lower first). */
  focusOrder?: number;
}

type ScrollWidgetOptions = Omit<ScrollViewOptions, keyof LayoutParams | 'name'>;

const SCROLL_KEYS = [
  'direction',
  'content',
  'scrollbar',
  'scrollbarSize',
  'wheelSpeed',
  'drag',
  'inertia',
  'bounce',
  'zoom',
] as const;

/** Pointer travel (px) before a press becomes a scroll drag. */
export const SCROLL_DRAG_THRESHOLD = 10;
/** Velocity (px/ms) a fling needs to start. */
export const FLING_MIN_VELOCITY = 0.08;
/** Keyboard line step, in pixels. */
export const KEY_LINE_STEP = 40;
/** Smallest scrollbar thumb, in pixels. */
export const MIN_THUMB = 28;

/**
 * The slice of a virtualised list the view drives instead of moving the content.
 *
 * `contentExtent` is the list's **full** length in pixels (every item, not the mounted window), which
 * is what an enclosing port has to measure. Deriving it from `maxOffset + <port viewport>` mixes two
 * different viewports as soon as the list's own box and the port disagree — either letting the port
 * scroll past the end into blank space or leaving the last rows unreachable.
 */
export interface VirtualScrollTarget {
  readonly virtualizedEnabled: boolean;
  readonly offset: number;
  readonly maxOffset: number;
  /** Full content length in pixels, independent of any viewport. */
  readonly contentExtent: number;
  setScrollOffset(offset: number): void;
}

function isVirtualScrollTarget(value: unknown): value is VirtualScrollTarget {
  const candidate = value as Partial<VirtualScrollTarget> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.virtualizedEnabled === true &&
    typeof candidate.setScrollOffset === 'function'
  );
}

/**
 * Live scroll views per scene.
 *
 * The wheel is dispatched to every listener that could handle it, so two *nested* views would both
 * scroll from one gesture. The registry lets a view check whether a deeper view also contains the
 * pointer and, if so, leave the event to it: the innermost scrollable area wins, which is what a
 * user expects from a list inside a page.
 */
const sceneScrollViews = new WeakMap<Phaser.Scene, Set<ScrollView>>();

function registerScrollView(view: ScrollView): void {
  const scene = view.scene;
  if (!scene) {
    return;
  }
  let set = sceneScrollViews.get(scene);
  if (set === undefined) {
    set = new Set();
    sceneScrollViews.set(scene, set);
  }
  set.add(view);
}

function unregisterScrollView(view: ScrollView): void {
  const scene = view.scene;
  if (!scene) {
    return;
  }
  sceneScrollViews.get(scene)?.delete(view);
}

/**
 * Depth-first search for the virtualised list inside a content subtree.
 *
 * The walk stops at a nested `ScrollView`: a port inside the content owns its own virtual window, and
 * claiming it here made an enclosing page drive the inner list's offset (and report the list's extent
 * as its own content length) — the same parent/child conflict as a shared drag.
 */
function findVirtualTarget(root: Widget): VirtualScrollTarget | null {
  if (isVirtualScrollTarget(root)) {
    return root;
  }
  const children = root.getWidgetChildren();
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Widget;
    if (child instanceof ScrollView) {
      continue;
    }
    const found = findVirtualTarget(child);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Accumulates `appliedRect`s of a subtree into rects relative to its own origin.
 *
 * The walk stops at a nested `ScrollView`: what an enclosing port has to measure is that view's
 * *viewport*, never the content inside it. Descending would count the virtualised fillers a list uses
 * to reserve its full length, so a page containing a 5000-pixel list could be scrolled thousands of
 * pixels past its own end (into blank space) — the vertical twin of the shared-drag conflict.
 */
function collectRects(widget: Widget, offsetX: number, offsetY: number, out: ScrollRect[]): void {
  const rect = widget.appliedRect;
  out.push({ x: offsetX, y: offsetY, width: rect.width, height: rect.height });
  if (widget instanceof ScrollView) {
    return;
  }
  const children = widget.getWidgetChildren();
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as Widget;
    if (child.visible === false) {
      continue;
    }
    collectRects(child, offsetX + child.x, offsetY + child.y, out);
  }
}

export class ScrollView extends Widget {
  /** Axis the view scrolls along. */
  readonly direction: ScrollDirection;
  /** Scrollbar policy. */
  readonly scrollbarMode: ScrollbarMode;
  /** Scrollbar thickness in design pixels. */
  readonly scrollbarSize: number;
  /** Wheel delta multiplier. */
  readonly wheelSpeed: number;
  /** Whether pointer dragging is enabled. */
  readonly dragEnabled: boolean;
  /** Whether a fling coasts after the pointer is released. */
  readonly inertiaEnabled: boolean;
  /** Whether overscroll rubber-bands back. */
  readonly bounceEnabled: boolean;

  /** Holder of the user's content; positioned by the layout engine. */
  private readonly holder: Widget;
  private readonly scrollbarGraphics: Phaser.GameObjects.Graphics;

  private contentWidget: Widget | null = null;
  private virtualTarget: VirtualScrollTarget | null = null;
  private clipReady = false;
  private warnedNoWebgl = false;

  private currentX = 0;
  private currentY = 0;
  private limitX = 0;
  private limitY = 0;
  /** Current pinch scale (1 = natural size). */
  private zoomScale = 1;
  private zoomMin = 0.5;
  private zoomMax = 3;
  private zoomEnabled = false;
  /** Pointers currently down inside the viewport, in order of arrival. */
  private readonly activePointers: Phaser.Input.Pointer[] = [];
  /** Pinch state while two pointers are down (`null` outside a pinch). */
  private pinch: {
    startDistance: number;
    startScale: number;
    anchorX: number;
    anchorY: number;
  } | null = null;
  private contentWidth = 0;
  private contentHeight = 0;

  /** Canvas-only clip shape (see `enableClip`). */
  private canvasMask: Phaser.GameObjects.Graphics | null = null;
  /** `thumb` while the scrollbar thumb is being dragged, `track` for a jump-to-position press. */
  private barDrag: 'thumb' | 'track' | null = null;
  private barGrab = 0;
  private dragStart: { x: number; y: number } | null = null;
  /** Pointer that owns the content drag (touch pointers are 1..n, the mouse is 0). */
  private dragPointerId: number | null = null;
  /** Pointer that owns the scrollbar drag. */
  private barPointerId: number | null = null;
  private dragLast = { x: 0, y: 0, time: 0 };
  private dragVelocity = { x: 0, y: 0 };
  private dragging = false;
  private coasting = false;

  /**
   * Marks this widget as a **clipping container for hit testing**.
   *
   * The viewport's mask hides the content that is scrolled out of it, so that content must not be
   * clickable either: the router skips this node's whole subtree for a point outside its box
   * (`resolveTargetInTree`). Without it, a row scrolled out of the port still hovered and clicked at
   * its logical position — including *below* the port, over whatever the user saw there (V23).
   *
   * Always `true`: a `ScrollView` always clips (WebGL filter, or a `GeometryMask` on Canvas).
   */
  readonly clipsPointer = true;
  private lastTick = 0;
  private rectBuffer: ScrollRect[] = [];
  private listenersInstalled = false;

  constructor(scene: Phaser.Scene, options: ScrollViewOptions = {}) {
    const { layout, widget } = splitWidgetOptions<ScrollWidgetOptions>(
      optionBag(options),
      SCROLL_KEYS,
    );
    super(scene, { layout, ...baseWidgetOptions(options) });

    this.direction = widget.direction ?? 'vertical';
    this.scrollbarMode = widget.scrollbar ?? 'auto';
    this.scrollbarSize = Math.max(2, Math.round(widget.scrollbarSize ?? 8));
    this.wheelSpeed = Number.isFinite(widget.wheelSpeed) ? (widget.wheelSpeed as number) : 1;
    this.dragEnabled = widget.drag !== false;
    this.inertiaEnabled = widget.inertia !== false;
    this.bounceEnabled = widget.bounce === true;
    if (widget.zoom === true || (typeof widget.zoom === 'object' && widget.zoom !== null)) {
      const zoom = typeof widget.zoom === 'object' ? widget.zoom : {};
      this.zoomEnabled = true;
      this.zoomMin = Number.isFinite(zoom.min) ? (zoom.min as number) : 0.5;
      this.zoomMax = Number.isFinite(zoom.max) ? (zoom.max as number) : 3;
      if (this.zoomMax < this.zoomMin) {
        this.zoomMax = this.zoomMin;
      }
    }

    // The port's container is a `scroll` box: it measures the holder without the viewport's limit on
    // the axis it scrolls, so content can be longer than the viewport instead of being squashed into
    // it (see `ScrollLayoutOptions`). The holder keeps `position: 'absolute'` and carries the scroll
    // offset in `left`/`top`, which is what makes scrolling a pure arrange-time move.
    this.container = { type: 'scroll', options: { axis: this.scrollAxis() } };
    this.focusable = true;

    // Cross axis `fill` (so the content sees the viewport width/height), scroll axis `auto` (so the
    // content can be longer than the viewport). No explicit size: the arranger resolves it.
    this.holder = new Widget(scene, {
      layout: { position: 'absolute', left: 0, top: 0, ...this.holderSizing() },
      name: `${options.name ?? 'scroll'}.content`,
    });
    this.holder.container = { type: 'stack', options: { align: 'start' } };
    this.addWidget(this.holder);

    // Above the content, so the thumb is never hidden by a row.
    this.scrollbarGraphics = new Phaser.GameObjects.Graphics(scene);
    this.add(this.scrollbarGraphics);

    if (widget.content) {
      this.setContent(widget.content);
    }
    this.installListeners();
  }

  // ------------------------------------------------------------------ public API

  /** Content widget, or `null`. */
  get content(): Widget | null {
    return this.contentWidget;
  }

  /** The virtualised list this view drives, if any (then the holder stays put). */
  get scrollTarget(): VirtualScrollTarget | null {
    return this.virtualTarget;
  }

  /** Viewport size in design pixels. */
  get viewport(): Size {
    return { width: Math.max(0, this.rect.width), height: Math.max(0, this.rect.height) };
  }

  /** Content extent in design pixels, as measured from the arranged rects. */
  get contentSize(): Size {
    return { width: this.contentWidth, height: this.contentHeight };
  }

  /** Offset along the primary axis. */
  get offset(): number {
    return this.primaryAxis() === 'x' ? this.currentX : this.currentY;
  }

  /** Offset along the primary axis (largest possible value). */
  get maxOffset(): number {
    return this.primaryAxis() === 'x' ? this.limitX : this.limitY;
  }

  get offsetX(): number {
    return this.currentX;
  }

  get offsetY(): number {
    return this.currentY;
  }

  get maxOffsetX(): number {
    return this.limitX;
  }

  get maxOffsetY(): number {
    return this.limitY;
  }

  /** Current pinch scale (1 = natural size, so `1` also means "zoom disabled or untouched"). */
  get zoom(): number {
    return this.zoomScale;
  }

  /**
   * Sets the scale directly, keeping `focus` (a viewport-space point, default the viewport centre) over
   * the same content point. Clamped to the configured `min`/`max`; the content holder is scaled, so this
   * costs no layout pass.
   */
  setZoom(scale: number, focus?: { x: number; y: number }): this {
    if (!this.zoomEnabled || !Number.isFinite(scale)) {
      return this;
    }
    const next = Math.min(this.zoomMax, Math.max(this.zoomMin, scale));
    if (next === this.zoomScale) {
      return this;
    }
    const viewport = this.viewport;
    const anchor = focus ?? { x: viewport.width / 2, y: viewport.height / 2 };
    const from = this.zoomScale;
    this.zoomScale = next;
    this.holder.setScale(next);
    this.currentX = clampZoomOffset(pinchOffset(this.currentX, anchor.x, from, next), this.limitX);
    this.currentY = clampZoomOffset(pinchOffset(this.currentY, anchor.y, from, next), this.limitY);
    this.measureContentExtent();
    this.currentX = clampZoomOffset(this.currentX, this.limitX);
    this.currentY = clampZoomOffset(this.currentY, this.limitY);
    this.applyOffsets();
    this.paintScrollbar();
    this.emit('zoom', next);
    return this;
  }

  /** `true` while the content is longer than the viewport on the primary axis. */
  get scrollable(): boolean {
    return this.primaryAxis() === 'x'
      ? isScrollable(this.contentWidth, this.viewport.width)
      : isScrollable(this.contentHeight, this.viewport.height);
  }

  /** `true` while a drag gesture is scrolling. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Replaces the content (the previous one is destroyed). Resets the offset to the origin. */
  setContent(widget: Widget): this {
    const previous = this.contentWidget;
    if (previous === widget) {
      return this;
    }
    if (previous !== null) {
      this.holder.removeWidget(previous, true);
    }
    this.contentWidget = widget;
    this.holder.addWidget(widget);
    this.virtualTarget = findVirtualTarget(widget);
    if (this.zoomEnabled && this.virtualTarget !== null) {
      // A scaled list would have to map `itemExtent` through the scale to know which rows to mount, so
      // the gesture is refused loudly instead of scrolling to the wrong window.
      warn(
        'ScrollView: `zoom` is ignored while a virtualised list is the scroll target; scale the ' +
          'list itself if that is what you want.',
      );
      this.zoomEnabled = false;
      this.zoomScale = 1;
      this.holder.setScale(1);
    }
    this.currentX = 0;
    this.currentY = 0;
    this.clampToLimits();
    this.applyOffsets();
    this.emit('content', widget);
    this.sync();
    return this;
  }

  /** Sets the offset (a number moves the primary axis). Values are clamped/bounced. */
  setScrollOffset(value: number | { x?: number; y?: number }): this {
    if (typeof value === 'number') {
      const axis = this.primaryAxis();
      return this.setOffset(
        axis === 'x' ? value : this.currentX,
        axis === 'y' ? value : this.currentY,
      );
    }
    return this.setOffset(value.x ?? this.currentX, value.y ?? this.currentY);
  }

  /** Moves the offset by a delta (the axes the view does not scroll are ignored). */
  scrollBy(dx: number, dy: number): this {
    return this.setOffset(
      this.currentX + (this.scrollsX() ? dx : 0),
      this.currentY + (this.scrollsY() ? dy : 0),
    );
  }

  /** Scrolls the primary axis to a pixel offset, or to an end of the content. */
  scrollTo(target: number | 'top' | 'bottom'): this {
    const value = target === 'top' ? 0 : target === 'bottom' ? this.maxOffset : target;
    return this.setScrollOffset(value);
  }

  /** Ends any fling immediately. */
  stopScroll(): this {
    this.coasting = false;
    this.dragVelocity = { x: 0, y: 0 };
    return this;
  }

  // ------------------------------------------------------------------ layout

  /** The viewport is never content-sized: give the view a definite width/height (or `fill`). */
  override measureContent(_constraint: BoxConstraints): Size {
    return { width: 0, height: 0 };
  }

  protected override onRectChanged(rect: Rect): void {
    if (rect.width <= 0 || rect.height <= 0) {
      // A zero-sized view cannot clip; re-establish the clip when it gets a size again.
      this.clipReady = false;
      return;
    }
    // The holder used to be given the viewport size here. It no longer is: it is `fill` on the cross
    // axis (resolved by the arranger against the port's content box) and `auto` on the scroll axis
    // (its natural length, which the `scroll` container measures without the viewport's cap). The
    // offset still has to be re-applied because the limits may have changed with the new size.
    this.enableClip();
    if (this.clipReady) {
      // The widget may have moved inside its parent: the clip camera follows the rect.
      this.focusClipCamera();
    }
    this.clampToLimits();
    this.applyOffsets();
    this.paintScrollbar();
  }

  /** Layout axis of the port, in the terms the layout package uses. */
  private scrollAxis(): 'vertical' | 'horizontal' | 'both' {
    return this.direction;
  }

  /** Cross-axis `fill` / scroll-axis `auto` sizing for the holder. */
  private holderSizing(): LayoutParams {
    if (this.direction === 'vertical') {
      return { width: 'fill', height: 'auto' };
    }
    if (this.direction === 'horizontal') {
      return { width: 'auto', height: 'fill' };
    }
    return { width: 'auto', height: 'auto' };
  }

  // ------------------------------------------------------------------ clipping

  private enableClip(): void {
    if (this.clipReady || this.rect.width <= 0 || this.rect.height <= 0) {
      return;
    }
    const renderer = this.scene?.renderer as { gl?: unknown } | undefined;
    if (!renderer?.gl) {
      // No WebGL: filters cannot clip, but a `GeometryMask` can — in Phaser 4 it works on the Canvas
      // renderer only (the mirror image of the WebGL-only filter path, PLAN §2). The mask is a
      // Graphics rectangle in *stage* space, repainted with the viewport on every layout and frame.
      if (this.canvasMask === null && this.scene) {
        const shape = this.scene.make.graphics({ x: 0, y: 0 }, false);
        this.canvasMask = shape;
        this.setMask(shape.createGeometryMask());
      }
      if (!this.warnedNoWebgl) {
        this.warnedNoWebgl = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[phaser-mvvm] ScrollView is clipping with a GeometryMask because the renderer is not WebGL (Phaser 4 filters are WebGL-only).',
        );
      }
      this.paintCanvasMask();
      this.clipReady = true;
      return;
    }

    // `enableFilters()` flags context focus when the size is still zero, and context focus disables
    // the object-sized framebuffer that does the clipping.
    this.filtersFocusContext = false;
    this.enableFilters();
    this.filtersFocusContext = false;
    this.filters?.internal.addMask('__WHITE');
    // From here on the camera is ours to aim (see the class comment).
    this.filtersAutoFocus = false;
    this.focusClipCamera();
    this.clipReady = true;
  }

  /**
   * Points the filter camera at exactly this widget's own rect.
   *
   * The framebuffer is camera-sized, so this is what decides the clip rectangle: size = the viewport,
   * origin/zoom left at neutral, and the scroll set to the widget's *local* position (the framebuffer
   * lives in the widget's parent space, which is why auto focus — which works in object space — puts
   * the content in the wrong place for a widget nested inside containers).
   */
  private focusClipCamera(): void {
    const camera = this.filterCamera;
    if (!camera) {
      return;
    }
    camera.setSize(
      Math.max(1, Math.round(this.rect.width)),
      Math.max(1, Math.round(this.rect.height)),
    );
    camera.setOrigin(0, 0);
    camera.setRotation(0);
    camera.setZoom(1, 1);
    camera.setScroll(this.x, this.y);
  }

  // ------------------------------------------------------------------ offsets

  private primaryAxis(): 'x' | 'y' {
    return this.direction === 'horizontal' ? 'x' : 'y';
  }

  private scrollsX(): boolean {
    return this.direction === 'horizontal' || this.direction === 'both';
  }

  private scrollsY(): boolean {
    return this.direction === 'vertical' || this.direction === 'both';
  }

  private setOffset(x: number, y: number): this {
    this.measureContentExtent();
    const nextX = this.scrollsX() ? clampOffset(x, this.limitX, this.bounceEnabled) : 0;
    const nextY = this.scrollsY() ? clampOffset(y, this.limitY, this.bounceEnabled) : 0;
    if (isDevMode() && (nextX !== x || nextY !== y) && !this.bounceEnabled) {
      // A *request* that the limits had to correct: exactly what "the list will not scroll to the end"
      // looks like from the outside (see DEFECT-BACKLOG V-… on re-clamping after a viewport change).
      devLog(`scroll: clamped (${Math.round(x)}, ${Math.round(y)}) -> (${nextX}, ${nextY})`);
    }
    if (nextX === this.currentX && nextY === this.currentY) {
      return this;
    }
    this.currentX = nextX;
    this.currentY = nextY;
    this.applyOffsets();
    this.paintScrollbar();
    this.emit('scroll', { x: nextX, y: nextY, maxOffsetX: this.limitX, maxOffsetY: this.limitY });
    return this;
  }

  private clampToLimits(): void {
    this.currentX = clampOffset(this.currentX, this.limitX, false);
    this.currentY = clampOffset(this.currentY, this.limitY, false);
  }

  /**
   * Places the content.
   *
   * The holder always carries the visual offset (the layout engine places it at the negated offset),
   * and a virtualised list is additionally told which window to mount. Those are two halves of one
   * scroll, not two scrolls: the list positions its rows in content space (see the class comment).
   */
  private applyOffsets(): void {
    const left = -this.currentX;
    const top = -this.currentY;
    const params = this.holder.layoutParams;
    if (params.left !== left || params.top !== top) {
      this.holder.setLayoutParams({ left, top });
    }
    const target = this.virtualTarget;
    if (target !== null && this.scrollsY() && target.offset !== this.currentY) {
      target.setScrollOffset(this.currentY);
    }
  }

  // ------------------------------------------------------------------ per-frame

  private sync(): void {
    if (this.isDestroyed || !this.scene) {
      return;
    }
    const now = this.scene.time?.now ?? 0;
    const deltaMs = this.lastTick === 0 ? 16 : Math.min(64, Math.max(0, now - this.lastTick));
    this.lastTick = now;

    if (this.canvasMask !== null) {
      // The mask lives in stage space, so it follows the viewport even if an ancestor moved without
      // re-arranging this widget.
      this.paintCanvasMask();
    }

    this.prunePinchPointers();
    this.measureContentExtent();

    if (this.coasting) {
      this.stepInertia(deltaMs);
    } else if (this.bounceEnabled && !this.dragging && this.outOfRange()) {
      this.springBack();
    } else if (!this.dragging && this.outOfRange()) {
      // The limits are recomputed here every frame, but the offset used to be clamped only when it
      // *moved*: a viewport that grew (window resize) or content that shrank (rows removed) left the
      // view parked past its end, showing blank space until the user scrolled again. `setOffset()`
      // clamps, re-applies the offsets and emits `scroll`; it is a no-op once back in range, and with
      // rubber-band enabled `springBack()` above owns this case instead.
      this.setOffset(this.currentX, this.currentY);
    }
  }

  /** Recomputes the content length (and the resulting limits) from the arranged rects. */
  private measureContentExtent(): void {
    const content = this.contentWidget;
    const viewport = this.viewport;
    const target = this.virtualTarget;

    let width = 0;
    let height = 0;
    if (target !== null && this.scrollsY()) {
      // A virtualised list already knows how long it is; its mounted window is not the whole story.
      // `contentExtent` is that length; the old `maxOffset + viewport` only agreed with it while the
      // list's own box happened to be exactly as tall as this port.
      const extent = target.contentExtent;
      width = viewport.width;
      height = Number.isFinite(extent) ? extent : target.maxOffset + viewport.height;
    } else if (content !== null) {
      this.rectBuffer.length = 0;
      collectRects(content, 0, 0, this.rectBuffer);
      const extent = extentOfRects(this.rectBuffer);
      width = extent.width;
      height = extent.height;
    }

    // A scaled holder occupies `extent * scale` on screen, so the scrollable range grows with the zoom
    // (a zoomed-in image has more to pan through, a zoomed-out one has less).
    this.contentWidth = Math.max(0, width) * this.zoomScale;
    this.contentHeight = Math.max(0, height) * this.zoomScale;
    this.limitX = this.scrollsX() ? Math.max(0, this.contentWidth - viewport.width) : 0;
    this.limitY = this.scrollsY() ? Math.max(0, this.contentHeight - viewport.height) : 0;
  }

  private outOfRange(): boolean {
    return (
      this.currentX < 0 ||
      this.currentY < 0 ||
      this.currentX > this.limitX ||
      this.currentY > this.limitY
    );
  }

  /** Eases a rubber-banded offset back into range. */
  private springBack(): void {
    const targetX = clampOffset(this.currentX, this.limitX, false);
    const targetY = clampOffset(this.currentY, this.limitY, false);
    const nextX =
      Math.abs(targetX - this.currentX) < 0.5
        ? targetX
        : this.currentX + (targetX - this.currentX) * 0.3;
    const nextY =
      Math.abs(targetY - this.currentY) < 0.5
        ? targetY
        : this.currentY + (targetY - this.currentY) * 0.3;
    this.setOffset(nextX, nextY);
  }

  private stepInertia(deltaMs: number): void {
    const stepX = applyInertia(this.dragVelocity.x, INERTIA_DECELERATION, deltaMs);
    const stepY = applyInertia(this.dragVelocity.y, INERTIA_DECELERATION, deltaMs);
    this.dragVelocity = { x: stepX.velocity, y: stepY.velocity };

    const beforeX = this.currentX;
    const beforeY = this.currentY;
    this.setOffset(this.currentX + stepX.delta, this.currentY + stepY.delta);

    // A hard bound (no bounce) ends the fling instead of letting it push against the clamp.
    const blockedX = !this.bounceEnabled && beforeX === this.currentX && stepX.delta !== 0;
    const blockedY = !this.bounceEnabled && beforeY === this.currentY && stepY.delta !== 0;
    if (blockedX) {
      this.dragVelocity.x = 0;
    }
    if (blockedY) {
      this.dragVelocity.y = 0;
    }
    if ((stepX.stopped || blockedX) && (stepY.stopped || blockedY)) {
      this.coasting = false;
    }
  }

  // ------------------------------------------------------------------ scrollbar

  /** Repaints the Canvas clip rectangle in stage coordinates. */
  private paintCanvasMask(): void {
    const shape = this.canvasMask;
    if (shape === null) {
      return;
    }
    const stage = stageRectOf(this);
    shape.clear();
    shape.fillStyle(0xffffff, 1);
    shape.fillRect(stage.x, stage.y, Math.max(0, this.rect.width), Math.max(0, this.rect.height));
  }

  private paintScrollbar(): void {
    const graphics = this.scrollbarGraphics;
    graphics.clear();
    if (this.scrollbarMode === false || this.isDestroyed) {
      return;
    }
    const width = this.rect.width;
    const height = this.rect.height;
    if (width <= 0 || height <= 0) {
      return;
    }
    const theme: Theme = this.theme;
    const thickness = Math.min(this.scrollbarSize, Math.max(2, Math.min(width, height) / 3));
    const color = theme.colors.textMuted;
    const margin = 2;

    if (this.scrollsY()) {
      const thumb = thumbGeometry(
        this.currentY,
        height,
        this.contentHeight,
        Math.max(0, height - 2 * margin),
        MIN_THUMB,
      );
      if (thumb.visible || this.scrollbarMode === true) {
        const length = thumb.visible ? thumb.length : height - 2 * margin;
        graphics.fillStyle(color, 0.45);
        graphics.fillRoundedRect(
          width - margin - thickness,
          margin + (thumb.visible ? thumb.position : 0),
          thickness,
          Math.max(MIN_THUMB / 2, length),
          thickness / 2,
        );
      }
    }

    if (this.scrollsX()) {
      const thumb = thumbGeometry(
        this.currentX,
        width,
        this.contentWidth,
        Math.max(0, width - 2 * margin),
        MIN_THUMB,
      );
      if (thumb.visible || this.scrollbarMode === true) {
        const length = thumb.visible ? thumb.length : width - 2 * margin;
        graphics.fillStyle(color, 0.45);
        graphics.fillRoundedRect(
          margin + (thumb.visible ? thumb.position : 0),
          height - margin - thickness,
          Math.max(MIN_THUMB / 2, length),
          thickness,
          thickness / 2,
        );
      }
    }
  }

  // ------------------------------------------------------------------ input

  private installListeners(): void {
    if (this.listenersInstalled) {
      return;
    }
    this.listenersInstalled = true;
    const scene = this.scene;
    const canvas = scene?.game?.canvas;
    canvas?.addEventListener('wheel', this.onWheel, { passive: false });
    scene?.input?.on('pointerdown', this.onPointerDown);
    scene?.input?.on('pointermove', this.onPointerMove);
    scene?.input?.on('pointerup', this.onPointerUp);
    scene?.input?.on('pointerupoutside', this.onPointerUp);
    scene?.events?.on(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate);
    registerScrollView(this);
    this.scope.onScopeDispose(() => this.removeListeners());
    this.onKeyDown = (event) => this.scrollWithKey(event);
  }

  private removeListeners(): void {
    if (!this.listenersInstalled) {
      return;
    }
    this.listenersInstalled = false;
    const scene = this.scene;
    scene?.game?.canvas?.removeEventListener('wheel', this.onWheel);
    scene?.input?.off('pointerdown', this.onPointerDown);
    scene?.input?.off('pointermove', this.onPointerMove);
    scene?.input?.off('pointerup', this.onPointerUp);
    scene?.input?.off('pointerupoutside', this.onPointerUp);
    scene?.events?.off(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate);
  }

  override destroy(fromScene?: boolean): void {
    this.removeListeners();
    unregisterScrollView(this);
    if (this.canvasMask !== null) {
      this.clearMask(true);
      this.canvasMask.destroy();
      this.canvasMask = null;
    }
    super.destroy(fromScene);
  }

  /** Stage-space rect of the viewport (the clip rectangle). */
  private viewportRect(): Rect {
    return stageRectOf(this);
  }

  private containsPoint(x: number, y: number): boolean {
    const rect = this.viewportRect();
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }

  /** Client (page) coordinates to game (canvas) coordinates. */
  private pageToStage(clientX: number, clientY: number): { x: number; y: number } {
    const scale = this.scene?.scale;
    if (scale && typeof scale.transformX === 'function') {
      return { x: scale.transformX(clientX), y: scale.transformY(clientY) };
    }
    const canvas = this.scene?.game?.canvas;
    const bounds = canvas?.getBoundingClientRect();
    return { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) };
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.isDestroyed || this.enabled === false) {
      return;
    }
    const point = this.pageToStage(event.clientX, event.clientY);
    if (!this.containsPoint(point.x, point.y)) {
      return;
    }
    // A deeper scroll view under the same pointer owns the gesture; it chains what it cannot consume
    // back up through `dispatchWheel`, so the event is handled exactly once per gesture.
    if (this.innermostAt(point.x, point.y) !== this) {
      return;
    }
    const dx = normalizeWheel(event.deltaX ?? 0, event.deltaMode ?? 0, this.wheelSpeed);
    const dy = normalizeWheel(event.deltaY ?? 0, event.deltaMode ?? 0, this.wheelSpeed);
    if (dx === 0 && dy === 0) {
      return;
    }
    // The wheel belongs to the view under the pointer: stop the page from scrolling instead.
    event.preventDefault();
    this.dispatchWheel(dx, dy, point);
  };

  /**
   * Applies a wheel delta to this view, then hands whatever it could not use to the scroll views that
   * enclose it.
   *
   * A view takes an axis only when it actually scrolls along it *and* still has room in that
   * direction. That is what keeps nesting predictable: a vertical wheel over a horizontal strip
   * scrolls the page instead of being swallowed, and a list that has reached its end passes the rest
   * of the gesture to its container rather than feeling stuck.
   */
  private dispatchWheel(dx: number, dy: number, point: { x: number; y: number }): void {
    let remainingX = dx;
    let remainingY = dy;
    let view: ScrollView | null = this;
    while (view && (remainingX !== 0 || remainingY !== 0)) {
      if (view !== this && !view.containsPoint(point.x, point.y)) {
        break;
      }
      const used = view.applyWheel(remainingX, remainingY);
      remainingX -= used.x;
      remainingY -= used.y;
      view = view.enclosingScrollView();
    }
  }

  /** Moves by as much of `dx`/`dy` as this view has room for; returns the part it consumed. */
  private applyWheel(dx: number, dy: number): { x: number; y: number } {
    if (this.isDestroyed || this.enabled === false) {
      return { x: 0, y: 0 };
    }
    const wantX = this.scrollsX() ? dx : 0;
    const wantY = this.scrollsY() ? dy : 0;
    if (wantX === 0 && wantY === 0) {
      return { x: 0, y: 0 };
    }
    this.stopScroll();
    const beforeX = this.currentX;
    const beforeY = this.currentY;
    // `setOffset` clamps (or bounces), so the difference is exactly what was consumed.
    this.setOffset(this.currentX + wantX, this.currentY + wantY);
    return { x: this.currentX - beforeX, y: this.currentY - beforeY };
  }

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (this.zoomEnabled && !this.activePointers.includes(pointer)) {
      // Two fingers down inside the viewport is a pinch; the first one still scrolls until the second
      // arrives, which is what makes a pinch start feel immediate.
      if (this.containsPoint(pointer.worldX, pointer.worldY)) {
        this.activePointers.push(pointer);
        this.updatePinch();
      }
    }
    // A pinch in progress owns the gesture: without this the *second* finger's press armed a scroll
    // drag owned by that finger, and every movement after the pinch failed the ownership check below -
    // the view stayed dead until the page was reloaded.
    if (this.pinch !== null) {
      return;
    }
    if (!this.dragEnabled || this.isDestroyed || this.enabled === false) {
      return;
    }
    // A drag belongs to the pointer that started it: with a second finger on screen, its movements
    // arrive on the same scene stream and used to drag this view as well.
    if (this.dragPointerId !== null || this.barPointerId !== null) {
      return;
    }
    if (!this.containsPoint(pointer.worldX, pointer.worldY)) {
      return;
    }
    this.stopScroll();

    // A press on the scrollbar drives the thumb and must not also start a content drag.
    const bar = this.barHit(pointer.worldX, pointer.worldY);
    if (bar !== null) {
      this.barDrag = bar.mode;
      this.barGrab = bar.grab;
      this.barPointerId = pointer.id;
      this.dragBarTo(bar, { x: pointer.worldX, y: pointer.worldY });
      this.dragStart = null;
      this.dragPointerId = null;
      return;
    }

    // A deeper scroll view under the same pointer owns the drag: without this, dragging inside a
    // nested list scrolled the list *and* the page behind it at the same time.
    if (this.innermostAt(pointer.worldX, pointer.worldY) !== this) {
      this.dragStart = null;
      return;
    }

    this.dragPointerId = pointer.id;
    this.dragStart = { x: pointer.worldX, y: pointer.worldY };
    this.dragLast = { x: pointer.worldX, y: pointer.worldY, time: this.scene?.time?.now ?? 0 };
    this.dragVelocity = { x: 0, y: 0 };
  };

  /**
   * Recomputes the pinch state from the pointers currently down.
   *
   * Two fingers start a pinch (or re-anchor it when a third one leaves); one finger ends it and hands
   * control back to the drag; the anchor is the midpoint, so the content point between the fingers
   * stays under them while the scale changes.
   */
  private updatePinch(): void {
    if (this.activePointers.length < 2) {
      if (this.pinch !== null) {
        if (isDevMode()) {
          devLog(`scroll: pinch end (${this.activePointers.length} pointer(s) down)`);
        }
        // The gesture is over: drop whatever drag the fingers left behind, so the next press starts
        // from a clean slate instead of inheriting an owner that is no longer on the screen.
        this.dragStart = null;
        this.dragPointerId = null;
        this.dragging = false;
      }
      this.pinch = null;
      return;
    }
    const [first, second] = this.activePointers;
    if (!first || !second) {
      this.pinch = null;
      return;
    }
    const a: ZoomPoint = { x: first.x, y: first.y };
    const b: ZoomPoint = { x: second.x, y: second.y };
    const midpoint = pinchMidpoint(a, b);
    // The pointers are in stage space and the offsets are viewport-local, so the anchor has to be
    // translated: without it the content zooms towards the view's own origin whenever the view is not
    // at (0, 0) - which every nested view is.
    const origin = this.viewportRect();
    this.pinch = {
      startDistance: pinchDistance(a, b),
      startScale: this.zoomScale,
      anchorX: midpoint.x - origin.x,
      anchorY: midpoint.y - origin.y,
    };
    // A pinch is not a scroll drag: stop the fling and forget the grab so the content does not also
    // travel with the fingers.
    this.stopScroll();
    this.dragStart = null;
    this.dragPointerId = null;
    if (isDevMode()) {
      devLog(`scroll: pinch start at (${Math.round(midpoint.x)}, ${Math.round(midpoint.y)})`);
    }
  }

  /**
   * Forgets pointers that are no longer down.
   *
   * `pointerup` is the normal way out of a pinch, but it is not guaranteed to arrive (a browser may
   * cancel a touch, and an aborted gesture never sends one). Without this poll a stale pair of pointers
   * would keep `pinch` alive forever and swallow every later drag - the framework's hover state is
   * derived per frame for the same reason.
   */
  private prunePinchPointers(): void {
    // A drag owner whose pointer is no longer down wedges the view exactly like a stale pinch pair: the
    // browser does not always deliver the release (an aborted touch never sends `pointerup`, and CDP's
    // `touchEnd` can arrive without a point), and `onPointerDown` then refuses every later press. The
    // hover state is derived per frame for the same reason.
    if (this.dragPointerId !== null) {
      const owner = this.pointerOf(this.dragPointerId);
      if (owner === null || owner.isDown !== true) {
        this.releaseDrag();
        if (isDevMode()) {
          devLog('scroll: dropped a drag whose pointer is gone');
        }
      }
    }
    if (this.barPointerId !== null) {
      const owner = this.pointerOf(this.barPointerId);
      if (owner === null || owner.isDown !== true) {
        this.endBarDrag();
        if (isDevMode()) {
          devLog('scroll: dropped a scrollbar drag whose pointer is gone');
        }
      }
    }

    if (this.activePointers.length === 0) {
      return;
    }
    let dropped = 0;
    for (let i = this.activePointers.length - 1; i >= 0; i--) {
      const pointer = this.activePointers[i];
      if (!pointer || pointer.isDown !== true) {
        this.activePointers.splice(i, 1);
        dropped += 1;
      }
    }
    if (dropped > 0 && isDevMode()) {
      devLog(`scroll: dropped ${dropped} released pointer(s) from the pinch`);
    }
    if (this.activePointers.length < 2 && this.pinch !== null) {
      this.pinch = null;
    } else if (this.activePointers.length >= 2 && this.pinch === null) {
      this.updatePinch();
    }
  }

  /** Applies the current two-finger distance as a scale, keeping the pinch anchor in place. */
  private applyPinch(): void {
    const pinch = this.pinch;
    const [first, second] = this.activePointers;
    if (pinch === null || !first || !second) {
      return;
    }
    const distance = pinchDistance({ x: first.x, y: first.y }, { x: second.x, y: second.y });
    const next = pinchScale(
      pinch.startScale,
      pinch.startDistance,
      distance,
      this.zoomMin,
      this.zoomMax,
    );
    if (next === this.zoomScale) {
      return;
    }
    const from = this.zoomScale;
    this.zoomScale = next;
    this.holder.setScale(next);
    this.currentX = pinchOffset(this.currentX, pinch.anchorX, from, next);
    this.currentY = pinchOffset(this.currentY, pinch.anchorY, from, next);
    // The scrollable range follows the scale, so the limits have to be recomputed before clamping.
    this.measureContentExtent();
    this.currentX = clampZoomOffset(this.currentX, this.limitX);
    this.currentY = clampZoomOffset(this.currentY, this.limitY);
    this.applyOffsets();
    this.paintScrollbar();
    this.emit('zoom', next);
  }

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.pinch !== null && this.activePointers.length >= 2) {
      this.applyPinch();
      return;
    }
    if (this.barDrag !== null) {
      if (this.barPointerId !== pointer.id) {
        return;
      }
      if (!pointer.isDown) {
        this.endBarDrag();
        return;
      }
      const hit = this.barHit(pointer.worldX, pointer.worldY);
      this.dragBarTo(
        {
          axis: hit?.axis ?? (this.scrollsY() ? 'y' : 'x'),
          mode: this.barDrag,
          grab: this.barGrab,
        },
        { x: pointer.worldX, y: pointer.worldY },
      );
      return;
    }

    const start = this.dragStart;
    if (start === null || this.isDestroyed || this.dragPointerId !== pointer.id) {
      return;
    }
    if (!pointer.isDown) {
      this.endDrag();
      return;
    }
    const plan = planScrollDrag(
      start,
      { x: pointer.worldX, y: pointer.worldY },
      SCROLL_DRAG_THRESHOLD,
    );
    if (!plan.dragging) {
      return;
    }
    this.dragging = true;

    const now = this.scene?.time?.now ?? 0;
    const stepX = pointer.worldX - this.dragLast.x;
    const stepY = pointer.worldY - this.dragLast.y;
    const elapsed = Math.max(1, now - this.dragLast.time);
    // Velocity in *offset* space, so the fling keeps travelling the way the drag was going (the
    // content follows the pointer, i.e. the offset moves against it).
    this.dragVelocity = { x: -stepX / elapsed, y: -stepY / elapsed };
    this.dragLast = { x: pointer.worldX, y: pointer.worldY, time: now };

    this.scrollBy(-stepX, -stepY);
  };

  private readonly onPointerUp = (pointer?: Phaser.Input.Pointer): void => {
    if (this.activePointers.length > 0) {
      const index = pointer ? this.activePointers.indexOf(pointer) : 0;
      this.activePointers.splice(index >= 0 ? index : 0, 1);
      this.updatePinch();
    }
    // Another finger lifting must not end this drag (Phaser hands the `pointerup` of every pointer to
    // the same scene listener).
    if (
      pointer &&
      this.dragPointerId !== null &&
      pointer.id !== this.dragPointerId &&
      this.barPointerId !== pointer.id
    ) {
      return;
    }
    if (this.barDrag !== null) {
      this.endBarDrag();
      return;
    }
    if (this.dragStart !== null) {
      this.endDrag();
      return;
    }
    // Ownership can outlive the drag when the press never moved: the arming path clears `dragStart`
    // (a scrollbar press, a nested port owning the gesture, a click that never travelled), but the
    // owner itself has to be released here. Leaving it set wedged the view — every later press was
    // refused by the ownership guard in `onPointerDown`, so a single *click* inside the port
    // permanently disabled dragging it (V24; measured: after clicking a row, both mouse and touch
    // drags were dead until a scene restart).
    if (pointer) {
      if (this.dragPointerId === pointer.id) {
        this.releaseDrag();
      }
      if (this.barPointerId === pointer.id) {
        this.endBarDrag();
      }
    }
  };

  /**
   * The scene's pointer object with this id, or `null`.
   *
   * Phaser keeps one `Pointer` per id in `InputManager#pointers`, indexed by that id (`Pointer` gets
   * `id` from the loop that creates them), so a pointer that has gone away still has an entry — which
   * is exactly what the "is it still down?" poll below needs.
   */
  private pointerOf(id: number): Phaser.Input.Pointer | null {
    const pointers = this.scene?.input?.manager?.pointers as Phaser.Input.Pointer[] | undefined;
    return pointers?.[id] ?? null;
  }

  /** Drops the drag ownership and the in-flight drag state (the fling keeps coasting if it had started). */
  private releaseDrag(): void {
    this.dragStart = null;
    this.dragPointerId = null;
    this.dragging = false;
  }

  private endBarDrag(): void {
    this.barDrag = null;
    this.barPointerId = null;
    this.barGrab = 0;
  }

  private endDrag(): void {
    const wasDragging = this.dragging;
    this.releaseDrag();
    if (!wasDragging || !this.inertiaEnabled) {
      return;
    }
    const speed = Math.hypot(this.dragVelocity.x, this.dragVelocity.y);
    if (speed >= FLING_MIN_VELOCITY) {
      this.coasting = true;
      return;
    }
    this.dragVelocity = { x: 0, y: 0 };
  }

  /**
   * Keyboard scrolling, through the base class's "first refusal" hook.
   *
   * It used to be a capture-phase `window` listener per scroll view, which ran before the plugin's
   * navigation handler. The hook reaches the same place without a global listener: `MVVMPlugin` asks
   * the focused widget first, so this runs for the view that holds focus and never for anyone else —
   * `Tab`/`Enter`/`Escape` and every key a `TextField` inside the view owns stay untouched.
   */
  private readonly scrollWithKey = (event: KeyboardEvent): boolean => {
    if (!this.focused || this.enabled === false || this.isDestroyed) {
      return false;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    if (!this.handlesKey(event.key)) {
      return false;
    }
    const step = planScrollKey(event.key, this.viewport.height, KEY_LINE_STEP);
    if (step === null) {
      return false;
    }
    this.stopScroll();
    if (step.jump === 'start') {
      this.scrollTo('top');
      return true;
    }
    if (step.jump === 'end') {
      this.scrollTo('bottom');
      return true;
    }
    if (this.direction === 'horizontal') {
      this.scrollBy(step.delta, 0);
      return true;
    }
    this.scrollBy(0, step.delta);
    return true;
  };

  /** How many scroll views enclose this one (0 for a top-level view). */
  private scrollDepth(): number {
    let depth = 0;
    let node = this.parentContainer;
    while (node) {
      if (node instanceof ScrollView) {
        depth += 1;
      }
      node = node.parentContainer;
    }
    return depth;
  }

  /** The nearest scroll view above this one in the display chain, or `null`. */
  private enclosingScrollView(): ScrollView | null {
    let node = this.parentContainer;
    while (node) {
      if (node instanceof ScrollView) {
        return node;
      }
      node = node.parentContainer;
    }
    return null;
  }

  /** The innermost live scroll view under a point, or `null`. */
  private innermostAt(x: number, y: number): ScrollView | null {
    const scene = this.scene;
    if (!scene) {
      return null;
    }
    let best: ScrollView | null = null;
    let bestDepth = -1;
    for (const view of sceneScrollViews.get(scene) ?? []) {
      if (view.isDestroyed || !view.containsPoint(x, y)) {
        continue;
      }
      const depth = view.scrollDepth();
      if (depth > bestDepth) {
        best = view;
        bestDepth = depth;
      }
    }
    return best;
  }

  /**
   * Where a press landed inside the scrollbar, if anywhere.
   *
   * `'thumb'` starts a proportional drag of the thumb (its own length is respected, so grabbing an
   * edge does not jump), `'track'` jumps so the thumb centres on the pointer — the behaviour of a
   * native scrollbar. Both are computed from `thumbGeometry`, i.e. from the same pure function the
   * painter uses.
   */
  private barHit(
    x: number,
    y: number,
  ): { axis: 'x' | 'y'; mode: 'thumb' | 'track'; grab: number } | null {
    const local = { x: x - (this.x + this.stageOffsetX()), y: y - (this.y + this.stageOffsetY()) };
    const margin = 2;
    const thickness = Math.min(
      this.scrollbarSize,
      Math.max(2, Math.min(this.rect.width, this.rect.height) / 3),
    );

    if (
      this.scrollsY() &&
      this.scrollbarMode !== false &&
      local.x >= this.rect.width - margin - thickness
    ) {
      const thumb = thumbGeometry(
        this.currentY,
        this.rect.height,
        this.contentHeight,
        Math.max(0, this.rect.height - 2 * margin),
        MIN_THUMB,
      );
      const trackStart = margin;
      const withinThumb =
        local.y >= trackStart + thumb.position &&
        local.y <= trackStart + thumb.position + thumb.length;
      return {
        axis: 'y',
        mode: withinThumb ? 'thumb' : 'track',
        grab: local.y - (trackStart + thumb.position),
      };
    }
    if (
      this.scrollsX() &&
      this.scrollbarMode !== false &&
      local.y >= this.rect.height - margin - thickness
    ) {
      const thumb = thumbGeometry(
        this.currentX,
        this.rect.width,
        this.contentWidth,
        Math.max(0, this.rect.width - 2 * margin),
        MIN_THUMB,
      );
      const trackStart = margin;
      const withinThumb =
        local.x >= trackStart + thumb.position &&
        local.x <= trackStart + thumb.position + thumb.length;
      return {
        axis: 'x',
        mode: withinThumb ? 'thumb' : 'track',
        grab: local.x - (trackStart + thumb.position),
      };
    }
    return null;
  }

  /** Stage position of the enclosing container chain (the widget's own x/y are parent-local). */
  private stageOffsetX(): number {
    let x = 0;
    let node = this.parentContainer;
    while (node) {
      x += node.x;
      node = node.parentContainer;
    }
    return x;
  }

  private stageOffsetY(): number {
    let y = 0;
    let node = this.parentContainer;
    while (node) {
      y += node.y;
      node = node.parentContainer;
    }
    return y;
  }

  /** Moves the offset so the scrollbar thumb's centre sits under the pointer. */
  private dragBarTo(
    hit: { axis: 'x' | 'y'; mode: 'thumb' | 'track'; grab: number },
    pointer: { x: number; y: number },
  ): void {
    const margin = 2;
    if (hit.axis === 'y') {
      const track = Math.max(0, this.rect.height - 2 * margin);
      const thumb = thumbGeometry(
        this.currentY,
        this.rect.height,
        this.contentHeight,
        track,
        MIN_THUMB,
      );
      const travel = Math.max(1, track - thumb.length);
      const local = pointer.y - (this.y + this.stageOffsetY()) - margin;
      const position = hit.mode === 'thumb' ? local - hit.grab : local - thumb.length / 2;
      const progress = Math.min(1, Math.max(0, position / travel));
      this.setOffset(this.currentX, progress * this.limitY);
      return;
    }
    const track = Math.max(0, this.rect.width - 2 * margin);
    const thumb = thumbGeometry(
      this.currentX,
      this.rect.width,
      this.contentWidth,
      track,
      MIN_THUMB,
    );
    const travel = Math.max(1, track - thumb.length);
    const local = pointer.x - (this.x + this.stageOffsetX()) - margin;
    const position = hit.mode === 'thumb' ? local - hit.grab : local - thumb.length / 2;
    const progress = Math.min(1, Math.max(0, position / travel));
    this.setOffset(progress * this.limitX, this.currentY);
  }

  /** Which keys this view owns, given its direction. */
  private handlesKey(key: string): boolean {
    if (key === 'Home' || key === 'End') {
      return true;
    }
    if (this.direction === 'vertical') {
      return key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown';
    }
    if (this.direction === 'horizontal') {
      return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'PageUp' || key === 'PageDown';
    }
    return (
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'PageUp' ||
      key === 'PageDown'
    );
  }

  private readonly onPostUpdate = (): void => {
    this.sync();
  };
}

/**
 * Creates a scroll view and adds it to the Scene.
 *
 * The content is `options.content`, or the first entry of `children` (a scroll view holds exactly
 * one content tree; extra entries are ignored).
 */
export function scrollView(
  scene: Phaser.Scene,
  options: ScrollViewOptions = {},
  children: readonly Widget[] = [],
): ScrollView {
  const widget = new ScrollView(scene, options);
  if (options.content === undefined && children.length > 0) {
    widget.setContent(children[0] as Widget);
  }
  scene.add.existing(widget);
  return widget;
}
