/**
 * The layout engine: measure/arrange passes, measurement caching, dirty propagation and snapping.
 *
 * Design notes
 * ------------
 * - A node's measured size is a pure function of `(constraint, node.revision)`, which makes the
 *   measurement cache sound. The cache is per node and keyed by the constraint.
 * - `invalidate(node)` walks up the parent chain marking nodes dirty; clean nodes with an
 *   unchanged rect are skipped entirely, so a small change costs O(depth + changed subtree)
 *   instead of O(tree).
 * - Layout is sub-pixel; snapping happens once, in `arrangeNode`, right before `applyRect`.
 * - Nothing in here allocates per frame once warmed up: contexts, child records and rects are
 *   pooled per node.
 */

import { type BoxConstraints, constraintsKey, deflate, enforce, unbounded } from './constraint';
import {
  type Rect,
  type Size,
  type SnapMode,
  clamp,
  copyRect,
  deflateRect,
  rectEquals,
  snapRect,
} from './geom';
import { type LengthUnit, type ResolvedParams, resolveLength } from './params';
import type {
  ArrangerContext,
  ContainerLayout,
  LayoutChild,
  LayoutNode,
  MeasureChildFn,
  PlaceChildFn,
} from './types';
import { arrangeBox, measureBox } from './box';
import { arrangeGrid, measureGrid } from './grid';
import { arrangeAbsolute, measureAbsolute } from './stack';
import { arrangeStack, measureStack } from './stack';

export interface LayoutEngineOptions {
  /** Device pixel ratio used by snapping. Defaults to 1. */
  dpr?: number;
  /** Snapping mode applied to the final rects. Defaults to `'round'`. */
  snapMode?: SnapMode;
}

export interface LayoutEngineStats {
  passes: number;
  measureCalls: number;
  cacheHits: number;
  arrangeCalls: number;
  placedChildren: number;
  skippedSubtrees: number;
  snappedRects: number;
}

interface CacheEntry {
  revision: number;
  size: Size;
}

/** Only this many distinct constraints are cached per node; prevents unbounded growth. */
const MAX_CACHE_ENTRIES_PER_NODE = 24;

const ZERO_SIZE: Size = Object.freeze({ width: 0, height: 0 });
const ZERO_RECT: Rect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

class ChildRecord implements LayoutChild {
  node: LayoutNode = null as unknown as LayoutNode;
  params: ResolvedParams = null as unknown as ResolvedParams;
  index = 0;
  measured: Size = { width: 0, height: 0 };
  rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  reset(node: LayoutNode, index: number, measuring: boolean): void {
    this.node = node;
    this.params = node.layoutParams;
    this.index = index;
    // Only the measure pass writes `measured`; the arrange pass reads it back (arrangers size
    // `auto` children through `resolveOuterSize`), so it has to survive into the arrange pass.
    if (measuring) {
      this.measured.width = 0;
      this.measured.height = 0;
    }
    this.rect.x = 0;
    this.rect.y = 0;
    this.rect.width = 0;
    this.rect.height = 0;
  }
}

class EngineContext implements ArrangerContext {
  node: LayoutNode | null = null;
  children: ChildRecord[] = [];
  rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  constraint: BoxConstraints = unbounded();
  contentSize: Size = { width: 0, height: 0 };
  measuring = true;
  readonly measureChild: MeasureChildFn;
  readonly placeChild: PlaceChildFn;

  constructor(private readonly engine: LayoutEngine) {
    this.measureChild = (child, constraint) => engine.measureChildOf(this, child, constraint);
    this.placeChild = (child, rect) => engine.placeChildOf(this, child, rect);
  }

  resolveOuterSize(child: LayoutChild): Size {
    return this.engine.resolveOuterSizeOf(this, child);
  }

  isFill(child: LayoutChild, axis: 'horizontal' | 'vertical'): boolean {
    const unit = axis === 'horizontal' ? child.params.width : child.params.height;
    return unit === 'fill';
  }
}

export class LayoutEngine {
  dpr: number;
  snapMode: SnapMode;

  readonly stats: LayoutEngineStats = {
    passes: 0,
    measureCalls: 0,
    cacheHits: 0,
    arrangeCalls: 0,
    placedChildren: 0,
    skippedSubtrees: 0,
    snappedRects: 0,
  };

  private caches = new WeakMap<LayoutNode, Map<string, CacheEntry>>();
  private readonly records = new WeakMap<LayoutNode, ChildRecord[]>();
  private readonly appliedRects = new WeakMap<LayoutNode, Rect>();
  private readonly dirty = new WeakSet<LayoutNode>();
  private readonly dirtyPending: LayoutNode[] = [];
  private readonly contextPool: EngineContext[] = [];
  private contextDepth = 0;

  constructor(options: LayoutEngineOptions = {}) {
    this.dpr = options.dpr ?? 1;
    this.snapMode = options.snapMode ?? 'round';
  }

  /**
   * Lays out `root` inside `constraint` and returns the root's resulting size.
   *
   * `percentBase` is the containing block used to resolve the root's own percentage lengths
   * (e.g. a UIRoot that is 100% of the camera); it defaults to the constraint's maximum.
   */
  layout(root: LayoutNode, constraint: BoxConstraints, percentBase?: Size): Size {
    this.stats.passes++;
    this.contextDepth = 0;

    const base = percentBase ?? percentBaseOf(constraint);
    const rootSize = this.measureNode(root, constraint, base);

    this.contextDepth = 0;
    const rootRect: Rect = { x: 0, y: 0, width: rootSize.width, height: rootSize.height };
    this.arrangeRoot(root, rootRect);

    this.clearDirty();
    return rootSize;
  }

  /**
   * Marks `node` and every ancestor dirty.
   *
   * Ancestors must be marked because (a) an auto-sized ancestor's measurement depends on its
   * children's sizes, and (b) the arrange pass walks down from the root and skips clean subtrees,
   * so a dirty node deep in the tree would otherwise never be re-arranged.
   *
   * The cost stays proportional to the change: ancestors re-measure, but their clean children are
   * answered from the measurement cache, and only the dirty subtree is re-arranged.
   */
  invalidate(node: LayoutNode): void {
    let current: LayoutNode | null = node;
    while (current && !this.dirty.has(current)) {
      this.dirty.add(current);
      this.dirtyPending.push(current);
      current = current.parent ?? null;
    }
  }

  isDirty(node: LayoutNode): boolean {
    return this.dirty.has(node);
  }

  /** Drops cached measurements for a subtree (used when fonts/themes change globally). */
  reset(node?: LayoutNode): void {
    if (node) {
      this.caches.delete(node);
      return;
    }
    // A WeakMap cannot be cleared, so re-point it and let the old one be collected.
    this.caches = new WeakMap();
  }

  // ---------------------------------------------------------------- measure pass

  private measureNode(node: LayoutNode, constraint: BoxConstraints, base: Size): Size {
    if (!node.inFlow) {
      return ZERO_SIZE;
    }

    const params = node.layoutParams;
    const fixedWidth = resolveOwnLength(
      params.width,
      params.widthMin,
      params.widthMax,
      base.width,
      params.minWidth,
      params.maxWidth,
    );
    const fixedHeight = resolveOwnLength(
      params.height,
      params.heightMin,
      params.heightMax,
      base.height,
      params.minHeight,
      params.maxHeight,
    );

    const own: BoxConstraints = {
      minWidth: fixedWidth ?? Math.max(constraint.minWidth, params.minWidth),
      maxWidth: fixedWidth ?? Math.min(constraint.maxWidth, params.maxWidth),
      minHeight: fixedHeight ?? Math.max(constraint.minHeight, params.minHeight),
      maxHeight: fixedHeight ?? Math.min(constraint.maxHeight, params.maxHeight),
    };
    enforce(own);

    const dirty = this.dirty.has(node);
    const cache = this.cacheFor(node);
    const key = constraintsKey(own);
    const cached = cache.get(key);
    if (cached && !dirty && cached.revision === node.revision) {
      this.stats.cacheHits++;
      return cached.size;
    }

    this.stats.measureCalls++;

    const content = deflate(own, params.padding);
    let contentWidth: number;
    let contentHeight: number;

    if (node.container && node.children.length > 0) {
      const ctx = this.acquireContext(node, ZERO_RECT, content, percentBaseOf(content), true);
      const measured = this.measureContainer(node.container, ctx);
      contentWidth = clamp(measured.width, content.minWidth, content.maxWidth);
      contentHeight = clamp(measured.height, content.minHeight, content.maxHeight);
    } else {
      const measured = node.measureContent(content);
      contentWidth = clamp(measured.width, content.minWidth, content.maxWidth);
      contentHeight = clamp(measured.height, content.minHeight, content.maxHeight);
    }

    const horizontal = params.padding.left + params.padding.right;
    const vertical = params.padding.top + params.padding.bottom;
    let width = fixedWidth ?? contentWidth + horizontal;
    let height = fixedHeight ?? contentHeight + vertical;

    if (params.aspectRatio) {
      if (fixedWidth !== null && fixedHeight === null) {
        height = width / params.aspectRatio;
      } else if (fixedHeight !== null && fixedWidth === null) {
        width = height * params.aspectRatio;
      }
    }

    const result: Size = {
      width: clamp(width, own.minWidth, own.maxWidth),
      height: clamp(height, own.minHeight, own.maxHeight),
    };

    if (cache.size >= MAX_CACHE_ENTRIES_PER_NODE) {
      cache.clear();
    }
    cache.set(key, { revision: node.revision, size: result });

    return result;
  }

  measureChildOf(ctx: EngineContext, child: LayoutChild, constraint: BoxConstraints): Size {
    const params = child.params;
    const base = ctx.contentSize;
    const margin = params.margin;
    const horizontal = margin.left + margin.right;
    const vertical = margin.top + margin.bottom;

    const available: BoxConstraints = {
      minWidth: Math.max(0, constraint.minWidth - horizontal),
      maxWidth: Math.max(0, constraint.maxWidth - horizontal),
      minHeight: Math.max(0, constraint.minHeight - vertical),
      maxHeight: Math.max(0, constraint.maxHeight - vertical),
    };

    const fixedWidth = resolveOwnLength(
      params.width,
      params.widthMin,
      params.widthMax,
      base.width,
      params.minWidth,
      params.maxWidth,
    );
    const fixedHeight = resolveOwnLength(
      params.height,
      params.heightMin,
      params.heightMax,
      base.height,
      params.minHeight,
      params.maxHeight,
    );

    const childConstraint: BoxConstraints = {
      minWidth: fixedWidth ?? Math.max(available.minWidth, params.minWidth),
      maxWidth: fixedWidth ?? Math.min(available.maxWidth, params.maxWidth),
      minHeight: fixedHeight ?? Math.max(available.minHeight, params.minHeight),
      maxHeight: fixedHeight ?? Math.min(available.maxHeight, params.maxHeight),
    };
    enforce(childConstraint);

    const measured = this.measureNode(child.node, childConstraint, base);
    child.measured.width = measured.width + horizontal;
    child.measured.height = measured.height + vertical;
    return child.measured;
  }

  resolveOuterSizeOf(ctx: EngineContext, child: LayoutChild): Size {
    const params = child.params;
    const base = ctx.contentSize;
    const margin = params.margin;
    const fixedWidth = resolveOwnLength(
      params.width,
      params.widthMin,
      params.widthMax,
      base.width,
      params.minWidth,
      params.maxWidth,
    );
    const fixedHeight = resolveOwnLength(
      params.height,
      params.heightMin,
      params.heightMax,
      base.height,
      params.minHeight,
      params.maxHeight,
    );

    return {
      width:
        (fixedWidth ?? child.measured.width - margin.left - margin.right) +
        margin.left +
        margin.right,
      height:
        (fixedHeight ?? child.measured.height - margin.top - margin.bottom) +
        margin.top +
        margin.bottom,
    };
  }

  private measureContainer(container: ContainerLayout, ctx: EngineContext): Size {
    switch (container.type) {
      case 'box':
        return measureBox(ctx, container.options);
      case 'grid':
        return measureGrid(ctx, container.options);
      case 'stack':
        return measureStack(ctx, container.options);
      case 'absolute':
        return measureAbsolute(ctx);
      default:
        return ZERO_SIZE;
    }
  }

  // ---------------------------------------------------------------- arrange pass

  private arrangeRoot(root: LayoutNode, rect: Rect): void {
    this.arrangeNode(root, this.snap(rect));
  }

  private arrangeNode(node: LayoutNode, rect: Rect): void {
    node.applyRect(rect);
    this.stats.arrangeCalls++;

    if (!node.container || node.children.length === 0) {
      return;
    }

    const params = node.layoutParams;
    const ctx = this.acquireContext(node, rect, unbounded(), { width: 0, height: 0 }, false);
    deflateRect(ctx.rect, params.padding);
    ctx.constraint = {
      minWidth: 0,
      maxWidth: ctx.rect.width,
      minHeight: 0,
      maxHeight: ctx.rect.height,
    };
    ctx.contentSize.width = ctx.rect.width;
    ctx.contentSize.height = ctx.rect.height;

    this.arrangeContainer(node.container, ctx);
  }

  placeChildOf(_ctx: EngineContext, child: LayoutChild, rect: Rect): void {
    copyRect(child.rect, rect);
    this.stats.placedChildren++;

    const target = this.snap(rect);
    const applied = this.appliedRects.get(child.node);
    if (applied && rectEquals(applied, target) && !this.dirty.has(child.node)) {
      this.stats.skippedSubtrees++;
      return;
    }

    if (applied) {
      copyRect(applied, target);
    } else {
      this.appliedRects.set(child.node, {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
      });
    }

    const tight: BoxConstraints = {
      minWidth: target.width,
      maxWidth: target.width,
      minHeight: target.height,
      maxHeight: target.height,
    };
    this.measureNode(child.node, tight, { width: target.width, height: target.height });
    this.arrangeNode(child.node, target);
  }

  private arrangeContainer(container: ContainerLayout, ctx: EngineContext): void {
    switch (container.type) {
      case 'box':
        arrangeBox(ctx, container.options);
        arrangeAbsolute(ctx);
        break;
      case 'grid':
        arrangeGrid(ctx, container.options);
        arrangeAbsolute(ctx);
        break;
      case 'stack':
        arrangeStack(ctx, container.options);
        arrangeAbsolute(ctx);
        break;
      case 'absolute':
        arrangeAbsolute(ctx);
        break;
      default:
        break;
    }
  }

  /** Snaps a rect in place to the device pixel grid (layout stays sub-pixel until here). */
  private snap(rect: Rect): Rect {
    if (this.snapMode === 'none') {
      return rect;
    }
    this.stats.snappedRects++;
    return snapRect(rect, this.dpr, this.snapMode);
  }

  // ---------------------------------------------------------------- plumbing

  private cacheFor(node: LayoutNode): Map<string, CacheEntry> {
    let cache = this.caches.get(node);
    if (!cache) {
      cache = new Map();
      this.caches.set(node, cache);
    }
    return cache;
  }

  private acquireContext(
    node: LayoutNode,
    rect: Rect,
    constraint: BoxConstraints,
    contentSize: Size,
    measuring: boolean,
  ): EngineContext {
    let ctx = this.contextPool[this.contextDepth];
    if (!ctx) {
      ctx = new EngineContext(this);
      this.contextPool[this.contextDepth] = ctx;
    }
    this.contextDepth++;

    ctx.node = node;
    ctx.measuring = measuring;
    ctx.constraint = constraint;
    ctx.contentSize.width = contentSize.width;
    ctx.contentSize.height = contentSize.height;

    // The arrange rect is mutated in place (padding is deflated out of it), so reset it here.
    ctx.rect.x = rect.x;
    ctx.rect.y = rect.y;
    ctx.rect.width = rect.width;
    ctx.rect.height = rect.height;

    const children = node.children;
    let records = this.records.get(node);
    if (!records || records.length !== children.length) {
      records = new Array<ChildRecord>(children.length);
      for (let i = 0; i < children.length; i++) {
        records[i] = new ChildRecord();
      }
      this.records.set(node, records);
    }
    ctx.children = records;
    for (let i = 0; i < children.length; i++) {
      (records[i] as ChildRecord).reset(children[i] as LayoutNode, i, measuring);
    }

    return ctx;
  }

  private clearDirty(): void {
    for (let i = 0; i < this.dirtyPending.length; i++) {
      this.dirty.delete(this.dirtyPending[i] as LayoutNode);
    }
    this.dirtyPending.length = 0;
  }
}

function resolveOwnLength(
  unit: LengthUnit,
  lengthMin: number,
  lengthMax: number,
  base: number,
  paramMin: number,
  paramMax: number,
): number | null {
  const resolved = resolveLength(unit, base);
  if (resolved === null) {
    return null;
  }
  const min = Math.max(lengthMin, paramMin);
  const max = Math.min(lengthMax, paramMax);
  return clamp(resolved, min, max);
}

function percentBaseOf(constraint: BoxConstraints): Size {
  return {
    width: Number.isFinite(constraint.maxWidth) ? constraint.maxWidth : Infinity,
    height: Number.isFinite(constraint.maxHeight) ? constraint.maxHeight : Infinity,
  };
}

/** Convenience for tests and adapters: lays out a single node and returns its size. */
export function measureNodeOnce(
  engine: LayoutEngine,
  node: LayoutNode,
  constraint: BoxConstraints,
): Size {
  return engine.layout(node, constraint);
}
