/**
 * Test harness: a minimal, renderer-agnostic `LayoutNode` implementation plus tree builders.
 *
 * `TestNode` records every rect handed to `applyRect`, so a test can assert the final geometry by
 * walking the node instances it created instead of parsing a snapshot. Parents are wired up by the
 * builders because `LayoutEngine.invalidate()` walks the `parent` chain to mark ancestors dirty.
 */

import { expect } from 'vitest';
import type { BoxConstraints } from '../src/constraint';
import { LayoutEngine } from '../src/engine';
import type { Rect, Size } from '../src/geom';
import { normalizeParams } from '../src/params';
import type { Axis, LayoutParams, ResolvedParams } from '../src/params';
import type {
  BoxLayoutOptions,
  ContainerLayout,
  GridLayoutOptions,
  LayoutNode,
  StackLayoutOptions,
} from '../src/types';

export interface TestNodeInit {
  /** Authoring params; normalised with `normalizeParams`. */
  params?: LayoutParams;
  /** `null` (the default) makes the node a leaf. */
  container?: ContainerLayout | null;
  children?: readonly LayoutNode[];
  /** Content size reported by the default `measureContent`. Defaults to `0×0`. */
  contentSize?: Size;
  /** Custom content measurement, overriding `contentSize`. */
  measure?: (constraint: BoxConstraints) => Size;
  inFlow?: boolean;
  revision?: number;
  isRelayoutBoundary?: boolean;
}

export class TestNode implements LayoutNode {
  readonly layoutParams: ResolvedParams;
  readonly children: readonly LayoutNode[];
  readonly container: ContainerLayout | null;
  parent: LayoutNode | null = null;
  revision: number;
  inFlow: boolean;
  isRelayoutBoundary: boolean;

  /** Content size returned by the default `measureContent`. */
  contentSize: Size;
  /** Last rect handed to `applyRect`, copied so the engine can reuse its own rect objects. */
  arranged: Rect | null = null;
  /** Number of `measureContent` calls; containers with children never call it. */
  measureCount = 0;

  private readonly measureFn: ((constraint: BoxConstraints) => Size) | null;

  constructor(init: TestNodeInit = {}) {
    this.layoutParams = normalizeParams(init.params);
    this.container = init.container ?? null;
    this.children = init.children ?? [];
    this.revision = init.revision ?? 0;
    this.inFlow = init.inFlow ?? true;
    this.isRelayoutBoundary = init.isRelayoutBoundary ?? false;
    this.contentSize = init.contentSize ?? { width: 0, height: 0 };
    this.measureFn = init.measure ?? null;

    for (const child of this.children) {
      (child as { parent: LayoutNode | null }).parent = this;
    }
  }

  measureContent(constraint: BoxConstraints): Size {
    this.measureCount += 1;
    if (this.measureFn) {
      return this.measureFn(constraint);
    }
    return { width: this.contentSize.width, height: this.contentSize.height };
  }

  applyRect(rect: Rect): void {
    this.arranged = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
}

/** A leaf with a fixed content size (`0×0` by default). */
export function leaf(params?: LayoutParams, contentSize?: Size): TestNode {
  return new TestNode({ params, contentSize });
}

/** A leaf whose content size reacts to the constraint (e.g. `{ width: c.maxWidth, ... }`). */
export function measuredLeaf(
  measure: (constraint: BoxConstraints) => Size,
  params?: LayoutParams,
): TestNode {
  return new TestNode({ params, measure });
}

/** A `box` container; the first argument accepts the `direction` shorthand. */
export function box(
  directionOrOptions: BoxLayoutOptions | Axis = 'vertical',
  children: readonly LayoutNode[] = [],
  params?: LayoutParams,
): TestNode {
  const options: BoxLayoutOptions =
    typeof directionOrOptions === 'string' ? { direction: directionOrOptions } : directionOrOptions;
  return new TestNode({ params, children, container: { type: 'box', options } });
}

export function grid(
  options: GridLayoutOptions = {},
  children: readonly LayoutNode[] = [],
  params?: LayoutParams,
): TestNode {
  return new TestNode({ params, children, container: { type: 'grid', options } });
}

export function stack(
  options: StackLayoutOptions = {},
  children: readonly LayoutNode[] = [],
  params?: LayoutParams,
): TestNode {
  return new TestNode({ params, children, container: { type: 'stack', options } });
}

/** A container that only arranges its `position: 'absolute'` children. */
export function absolute(children: readonly LayoutNode[] = [], params?: LayoutParams): TestNode {
  return new TestNode({ params, children, container: { type: 'absolute' } });
}

export interface LayoutResult {
  size: Size;
  engine: LayoutEngine;
}

/** Lays `root` out inside `constraint`, returning the resulting root size and the engine used. */
export function layout(
  root: LayoutNode,
  constraint: BoxConstraints,
  engine: LayoutEngine = new LayoutEngine(),
): LayoutResult {
  return { size: engine.layout(root, constraint), engine };
}

/** An engine without pixel snapping, so sub-pixel geometry can be asserted exactly. */
export function exactEngine(): LayoutEngine {
  return new LayoutEngine({ snapMode: 'none' });
}

/** The rect a node received from `applyRect`; throws when the node was never arranged. */
export function rectOf(node: TestNode): Rect {
  if (!node.arranged) {
    throw new Error(`node was not arranged (children: ${node.children.length})`);
  }
  return node.arranged;
}

/** Asserts a node's arranged rect, component by component, with sub-pixel tolerance. */
export function expectRect(
  node: TestNode,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const rect = rectOf(node);
  expect(rect.x).toBeCloseTo(x, 6);
  expect(rect.y).toBeCloseTo(y, 6);
  expect(rect.width).toBeCloseTo(width, 6);
  expect(rect.height).toBeCloseTo(height, 6);
}

export function expectSize(actual: Size, width: number, height: number): void {
  expect(actual.width).toBeCloseTo(width, 6);
  expect(actual.height).toBeCloseTo(height, 6);
}
