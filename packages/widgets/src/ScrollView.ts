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
 * - Filters are WebGL-only. Under the Canvas fallback the view scrolls but does not clip; the scene
 *   logs one development warning.
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
import type { BoxConstraints, LayoutParams, Rect, Size } from '@phaser-mvvm/layout';
import { stageRectOf, Widget } from '@phaser-mvvm/phaser';
import type { Theme } from '@phaser-mvvm/phaser';
import { optionBag, splitWidgetOptions } from './options';
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
  name?: string;
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
] as const;

/** Pointer travel (px) before a press becomes a scroll drag. */
export const SCROLL_DRAG_THRESHOLD = 10;
/** Velocity (px/ms) a fling needs to start. */
export const FLING_MIN_VELOCITY = 0.08;
/** Keyboard line step, in pixels. */
export const KEY_LINE_STEP = 40;
/** Smallest scrollbar thumb, in pixels. */
export const MIN_THUMB = 28;

/** The slice of a virtualised list the view drives instead of moving the content. */
export interface VirtualScrollTarget {
  readonly virtualizedEnabled: boolean;
  readonly offset: number;
  readonly maxOffset: number;
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

/** Depth-first search for the virtualised list inside a content subtree. */
function findVirtualTarget(root: Widget): VirtualScrollTarget | null {
  if (isVirtualScrollTarget(root)) {
    return root;
  }
  const children = root.getWidgetChildren();
  for (let i = 0; i < children.length; i++) {
    const found = findVirtualTarget(children[i] as Widget);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Accumulates `appliedRect`s of a subtree into rects relative to its own origin. */
function collectRects(widget: Widget, offsetX: number, offsetY: number, out: ScrollRect[]): void {
  const rect = widget.appliedRect;
  out.push({ x: offsetX, y: offsetY, width: rect.width, height: rect.height });
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
  private contentWidth = 0;
  private contentHeight = 0;

  private dragStart: { x: number; y: number } | null = null;
  private dragLast = { x: 0, y: 0, time: 0 };
  private dragVelocity = { x: 0, y: 0 };
  private dragging = false;
  private coasting = false;
  private lastTick = 0;
  private rectBuffer: ScrollRect[] = [];
  private listenersInstalled = false;

  constructor(scene: Phaser.Scene, options: ScrollViewOptions = {}) {
    const { layout, widget } = splitWidgetOptions<ScrollWidgetOptions>(
      optionBag(options),
      SCROLL_KEYS,
    );
    super(scene, { layout, name: options.name });

    this.direction = widget.direction ?? 'vertical';
    this.scrollbarMode = widget.scrollbar ?? 'auto';
    this.scrollbarSize = Math.max(2, Math.round(widget.scrollbarSize ?? 8));
    this.wheelSpeed = Number.isFinite(widget.wheelSpeed) ? (widget.wheelSpeed as number) : 1;
    this.dragEnabled = widget.drag !== false;
    this.inertiaEnabled = widget.inertia !== false;
    this.bounceEnabled = widget.bounce === true;

    // One layout child (the holder); the content inside it is the user's tree.
    this.container = { type: 'stack', options: { align: 'start' } };
    this.focusable = true;

    this.holder = new Widget(scene, {
      layout: { position: 'absolute', left: 0, top: 0 },
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
    // The holder *is* the scrollport content box: giving it the viewport size is what lets the
    // content ask for `width: 'fill'`/`height: 'fill'` (an auto-sized box would collapse a fill
    // child to nothing), while anything longer simply overflows it.
    //
    // The params are written directly rather than through `setLayoutParams()`: that helper normalises
    // a *whole* params object, so a partial patch would reset every field it omits — including the
    // `position: 'absolute'` this holder needs.
    const holderParams = this.holder.layoutParams;
    if (holderParams.width !== rect.width || holderParams.height !== rect.height) {
      holderParams.width = rect.width;
      holderParams.height = rect.height;
      this.holder.markDirty();
    }
    this.enableClip();
    if (this.clipReady) {
      // The widget may have moved inside its parent: the clip camera follows the rect.
      this.focusClipCamera();
    }
    this.clampToLimits();
    this.applyOffsets();
    this.paintScrollbar();
  }

  // ------------------------------------------------------------------ clipping

  private enableClip(): void {
    if (this.clipReady || this.rect.width <= 0 || this.rect.height <= 0) {
      return;
    }
    const renderer = this.scene?.renderer as { gl?: unknown } | undefined;
    if (!renderer?.gl) {
      if (!this.warnedNoWebgl) {
        this.warnedNoWebgl = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[phaser-mvvm] ScrollView needs the WebGL renderer to clip its content (Phaser 4 filters are WebGL-only).',
        );
      }
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
      params.left = left;
      params.top = top;
      this.holder.markDirty();
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

    this.measureContentExtent();

    if (this.coasting) {
      this.stepInertia(deltaMs);
    } else if (this.bounceEnabled && !this.dragging && this.outOfRange()) {
      this.springBack();
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
      width = viewport.width;
      height = target.maxOffset + viewport.height;
    } else if (content !== null) {
      this.rectBuffer.length = 0;
      collectRects(content, 0, 0, this.rectBuffer);
      const extent = extentOfRects(this.rectBuffer);
      width = extent.width;
      height = extent.height;
    }

    this.contentWidth = Math.max(0, width);
    this.contentHeight = Math.max(0, height);
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
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown, true);
    }
    this.scope.onScopeDispose(() => this.removeListeners());
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
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
    }
  }

  override destroy(fromScene?: boolean): void {
    this.removeListeners();
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
    const dx = normalizeWheel(event.deltaX ?? 0, event.deltaMode ?? 0, this.wheelSpeed);
    const dy = normalizeWheel(event.deltaY ?? 0, event.deltaMode ?? 0, this.wheelSpeed);
    if (dx === 0 && dy === 0) {
      return;
    }
    // The wheel belongs to the view under the pointer: stop the page from scrolling instead.
    event.preventDefault();
    this.stopScroll();
    this.scrollBy(dx, dy);
  };

  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dragEnabled || this.isDestroyed || this.enabled === false) {
      return;
    }
    if (!this.containsPoint(pointer.worldX, pointer.worldY)) {
      return;
    }
    this.stopScroll();
    this.dragStart = { x: pointer.worldX, y: pointer.worldY };
    this.dragLast = { x: pointer.worldX, y: pointer.worldY, time: this.scene?.time?.now ?? 0 };
    this.dragVelocity = { x: 0, y: 0 };
  };

  private readonly onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    const start = this.dragStart;
    if (start === null || this.isDestroyed) {
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

  private readonly onPointerUp = (): void => {
    if (this.dragStart !== null) {
      this.endDrag();
    }
  };

  private endDrag(): void {
    const wasDragging = this.dragging;
    this.dragStart = null;
    this.dragging = false;
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
   * Keyboard scrolling.
   *
   * The guard is a capture-phase window listener, so it runs *before* the scene plugin's navigation
   * handler and can consume the key. It only acts while **this** view holds the framework focus: a
   * `TextField` inside the view is focused on its own, so its guard (and the caret keys) are
   * untouched, and `Tab`/`Enter`/`Escape` are never consumed here, so focus traversal keeps working.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.focused || this.enabled === false || this.isDestroyed) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (!this.handlesKey(event.key)) {
      return;
    }
    const step = planScrollKey(event.key, this.viewport.height, KEY_LINE_STEP);
    if (step === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.stopScroll();
    if (step.jump === 'start') {
      this.scrollTo('top');
      return;
    }
    if (step.jump === 'end') {
      this.scrollTo('bottom');
      return;
    }
    if (this.direction === 'horizontal') {
      this.scrollBy(step.delta, 0);
      return;
    }
    this.scrollBy(0, step.delta);
  };

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
