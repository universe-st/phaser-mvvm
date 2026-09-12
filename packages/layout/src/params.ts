/**
 * Layout parameters: the per-node declarative sizing model, plus its normalised form.
 *
 * Authors write `Partial<LayoutParams>` (with string shorthands such as `'50%'`, `'auto'`,
 * `'fill'` and insets shorthands); the engine works with `ResolvedParams`, which has every
 * field filled in with a concrete value and insets expanded.
 */

import type { Insets, InsetsInput } from './geom';
import { ZERO_INSETS, clamp, finiteOr } from './geom';

/** A single length unit: a number of design pixels, or a keyword/percentage. */
export type LengthUnit = number | 'auto' | 'fill' | `${number}%`;

/** A length unit with optional extra clamps, e.g. `{ value: 'fill', min: 80, max: 240 }`. */
export interface LengthValue {
  value: LengthUnit;
  min?: number;
  max?: number;
}

export type Length = LengthUnit | LengthValue;

export type Align = 'auto' | 'start' | 'center' | 'end' | 'stretch';
export type Justify =
  'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';

export interface LayoutParams {
  width?: Length;
  height?: Length;
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  maxHeight?: Length;

  /** Flex-grow weight on the parent's main axis (default 0). */
  grow?: number;
  /** Flex-shrink weight used when the line overflows (default 0 — overflow is allowed). */
  shrink?: number;
  /** Initial main-axis size before grow/shrink is applied. */
  basis?: Length;

  margin?: InsetsInput;
  padding?: InsetsInput;
  alignSelf?: Align;
  aspectRatio?: number;

  position?: 'flow' | 'absolute';
  left?: Length;
  top?: Length;
  right?: Length;
  bottom?: Length;

  /** Ordering hint inside box/grid containers; ties keep declaration order. */
  order?: number;
  /** `collapse` (default) removes the node from the flow when it is not visible. */
  hideMode?: 'collapse' | 'keep';

  gridColumn?: number;
  gridRow?: number;
  gridColumnSpan?: number;
  gridRowSpan?: number;
}

export interface ResolvedParams {
  width: LengthUnit;
  height: LengthUnit;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  grow: number;
  shrink: number;
  basis: LengthUnit | null;
  margin: Insets;
  padding: Insets;
  alignSelf: Align;
  aspectRatio: number | null;
  position: 'flow' | 'absolute';
  left: LengthUnit | null;
  top: LengthUnit | null;
  right: LengthUnit | null;
  bottom: LengthUnit | null;
  order: number;
  hideMode: 'collapse' | 'keep';
  gridColumn: number | null;
  gridRow: number | null;
  gridColumnSpan: number;
  gridRowSpan: number;
  /** Extra clamps carried by `{ value, min, max }` length objects. */
  widthMin: number;
  widthMax: number;
  heightMin: number;
  heightMax: number;
}

export const UNBOUNDED_LENGTH = Number.POSITIVE_INFINITY;

export const DEFAULT_LAYOUT_PARAMS: Readonly<ResolvedParams> = Object.freeze({
  width: 'auto',
  height: 'auto',
  minWidth: 0,
  maxWidth: UNBOUNDED_LENGTH,
  minHeight: 0,
  maxHeight: UNBOUNDED_LENGTH,
  grow: 0,
  shrink: 0,
  basis: null,
  margin: { ...ZERO_INSETS },
  padding: { ...ZERO_INSETS },
  alignSelf: 'auto',
  aspectRatio: null,
  position: 'flow',
  left: null,
  top: null,
  right: null,
  bottom: null,
  order: 0,
  hideMode: 'collapse',
  gridColumn: null,
  gridRow: null,
  gridColumnSpan: 1,
  gridRowSpan: 1,
  widthMin: 0,
  widthMax: UNBOUNDED_LENGTH,
  heightMin: 0,
  heightMax: UNBOUNDED_LENGTH,
});

const PERCENT_PATTERN = /^(-?\d+(?:\.\d+)?)%$/;

/** `12` → `{ value: 12 }`; `'50%'` → `{ value: '50%' }`; `undefined` → `undefined`. */
export function toLengthValue(length?: Length): LengthValue | undefined {
  if (length === undefined || length === null) {
    return undefined;
  }
  if (typeof length === 'object') {
    return length;
  }
  return { value: length };
}

export function toLengthUnit(length?: Length): LengthUnit | undefined {
  return toLengthValue(length)?.value;
}

export function resolveInsets(input?: InsetsInput): Insets {
  if (input === undefined || input === null) {
    return { ...ZERO_INSETS };
  }
  if (typeof input === 'number') {
    return { top: input, right: input, bottom: input, left: input };
  }
  if (Array.isArray(input)) {
    if (input.length === 2) {
      const [vertical, horizontal] = input as readonly [number, number];
      return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
    }
    if (input.length === 4) {
      const [top, right, bottom, left] = input as readonly [number, number, number, number];
      return { top, right, bottom, left };
    }
    throw new Error('resolveInsets: array shorthand must have exactly 2 or 4 entries');
  }
  const partial = input as Partial<Insets>;
  return {
    top: partial.top ?? 0,
    right: partial.right ?? 0,
    bottom: partial.bottom ?? 0,
    left: partial.left ?? 0,
  };
}

export type LengthKind = 'fixed' | 'percent' | 'auto' | 'fill';

export function lengthKind(unit: LengthUnit): LengthKind {
  if (typeof unit === 'number') {
    return 'fixed';
  }
  if (unit === 'auto') {
    return 'auto';
  }
  if (unit === 'fill') {
    return 'fill';
  }
  return 'percent';
}

export function isDefiniteUnit(unit: LengthUnit): boolean {
  const kind = lengthKind(unit);
  return kind === 'fixed' || kind === 'percent';
}

/**
 * Turns a length into pixels against a base (the parent's content box on that axis).
 *
 * Returns `null` for `'auto'` and whenever a percentage cannot be resolved (base is not
 * bounded), which tells the caller to fall back to content sizing.
 */
export function resolveLength(unit: LengthUnit, base = 0): number | null {
  if (typeof unit === 'number') {
    return unit;
  }
  if (unit === 'auto') {
    return null;
  }
  if (unit === 'fill') {
    return Number.isFinite(base) ? base : null;
  }
  const match = PERCENT_PATTERN.exec(unit);
  if (!match) {
    return null;
  }
  if (!Number.isFinite(base)) {
    return null;
  }
  return (Number.parseFloat(match[1] as string) / 100) * base;
}

/** Resolves a length, then clamps it with the params' own min/max for that axis. */
export function resolveAxisLength(
  unit: Length | undefined,
  base: number,
  min: number,
  max: number,
): number | null {
  const resolved = resolveLength(toLengthUnit(unit) ?? 'auto', base);
  if (resolved === null) {
    return null;
  }
  return clamp(resolved, min, max);
}

function normalizeBound(value: Length | undefined, fallback: number): number {
  const resolved = resolveLength(toLengthUnit(value) ?? 'auto', 0);
  return resolved === null ? fallback : resolved;
}

export function normalizeParams(params?: LayoutParams): ResolvedParams {
  if (!params) {
    return cloneResolvedParams(DEFAULT_LAYOUT_PARAMS);
  }
  const width = toLengthValue(params.width);
  const height = toLengthValue(params.height);
  const basis = toLengthUnit(params.basis);

  return {
    width: width?.value ?? 'auto',
    height: height?.value ?? 'auto',
    minWidth: normalizeBound(params.minWidth, 0),
    maxWidth: normalizeBound(params.maxWidth, UNBOUNDED_LENGTH),
    minHeight: normalizeBound(params.minHeight, 0),
    maxHeight: normalizeBound(params.maxHeight, UNBOUNDED_LENGTH),
    grow: finiteOr(params.grow ?? 0, 0),
    shrink: finiteOr(params.shrink ?? 0, 0),
    basis: basis ?? null,
    margin: resolveInsets(params.margin),
    padding: resolveInsets(params.padding),
    alignSelf: params.alignSelf ?? 'auto',
    aspectRatio:
      params.aspectRatio !== undefined && params.aspectRatio > 0 ? params.aspectRatio : null,
    position: params.position ?? 'flow',
    left: toLengthUnit(params.left) ?? null,
    top: toLengthUnit(params.top) ?? null,
    right: toLengthUnit(params.right) ?? null,
    bottom: toLengthUnit(params.bottom) ?? null,
    order: finiteOr(params.order ?? 0, 0),
    hideMode: params.hideMode ?? 'collapse',
    gridColumn: params.gridColumn ?? null,
    gridRow: params.gridRow ?? null,
    gridColumnSpan: Math.max(1, Math.floor(params.gridColumnSpan ?? 1)),
    gridRowSpan: Math.max(1, Math.floor(params.gridRowSpan ?? 1)),
    widthMin: width?.min ?? 0,
    widthMax: width?.max ?? UNBOUNDED_LENGTH,
    heightMin: height?.min ?? 0,
    heightMax: height?.max ?? UNBOUNDED_LENGTH,
  };
}

export function cloneResolvedParams(params: ResolvedParams): ResolvedParams {
  return {
    ...params,
    margin: { ...params.margin },
    padding: { ...params.padding },
  };
}

/** The axis a box container flows along. */
export type Axis = 'horizontal' | 'vertical';

export function mainAxisOf(direction: Axis): Axis {
  return direction;
}

export function crossAxisOf(direction: Axis): Axis {
  return direction === 'vertical' ? 'horizontal' : 'vertical';
}

export function mainSizeOf(axis: Axis, value: { width: number; height: number }): number {
  return axis === 'horizontal' ? value.width : value.height;
}

export function crossSizeOf(axis: Axis, value: { width: number; height: number }): number {
  return axis === 'horizontal' ? value.height : value.width;
}

export function alignSelfOf(
  childAlign: Align,
  parentAlign: Align | undefined,
): Exclude<Align, 'auto'> {
  if (childAlign !== 'auto') {
    return childAlign;
  }
  if (!parentAlign || parentAlign === 'auto') {
    return 'start';
  }
  return parentAlign;
}
