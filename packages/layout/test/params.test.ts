/**
 * Parameter model: insets and length shorthands, normalisation into `ResolvedParams`, and the small
 * axis/alignment helpers the arrangers share.
 */

import { describe, expect, it } from 'vitest';
import { ZERO_INSETS } from '../src/geom';
import {
  DEFAULT_LAYOUT_PARAMS,
  alignSelfOf,
  cloneResolvedParams,
  mergeParams,
  crossAxisOf,
  crossSizeOf,
  isDefiniteUnit,
  lengthKind,
  mainAxisOf,
  mainSizeOf,
  normalizeParams,
  resolveAxisLength,
  resolveInsets,
  resolveLength,
  toLengthUnit,
  toLengthValue,
} from '../src/params';

describe('params: resolveInsets', () => {
  it('expands a single number to all four sides', () => {
    expect(resolveInsets(8)).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });

  it('expands a [vertical, horizontal] pair', () => {
    expect(resolveInsets([10, 20])).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
  });

  it('reads a [top, right, bottom, left] quadruple in CSS order', () => {
    expect(resolveInsets([1, 2, 3, 4])).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });

  it('fills the missing sides of a partial object with zero', () => {
    expect(resolveInsets({ top: 5, left: 15 })).toEqual({ top: 5, right: 0, bottom: 0, left: 15 });
  });

  it('returns zero insets for undefined', () => {
    expect(resolveInsets(undefined)).toEqual(ZERO_INSETS);
    expect(resolveInsets(undefined)).not.toBe(ZERO_INSETS);
  });

  it('rejects an array shorthand with an unsupported length', () => {
    expect(() => resolveInsets([1, 2, 3] as unknown as [number, number])).toThrow(/exactly 2 or 4/);
  });
});

describe('params: resolveLength', () => {
  it('returns a plain number unchanged', () => {
    expect(resolveLength(42, 100)).toBe(42);
    expect(resolveLength(0, 100)).toBe(0);
  });

  it('resolves a percentage against the base', () => {
    expect(resolveLength('50%', 400)).toBe(200);
    expect(resolveLength('12.5%', 80)).toBe(10);
  });

  it('resolves a negative percentage', () => {
    expect(resolveLength('-25%', 100)).toBe(-25);
  });

  it('returns null for a percentage with an unbounded base', () => {
    expect(resolveLength('50%', Number.POSITIVE_INFINITY)).toBeNull();
    expect(resolveLength('50%', Number.NaN)).toBeNull();
  });

  it('returns null for auto so callers fall back to content sizing', () => {
    expect(resolveLength('auto', 400)).toBeNull();
  });

  it('resolves fill to the base when it is bounded', () => {
    expect(resolveLength('fill', 300)).toBe(300);
    expect(resolveLength('fill', 0)).toBe(0);
  });

  it('returns null for fill when the base is unbounded', () => {
    expect(resolveLength('fill', Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('returns null for a malformed percentage', () => {
    expect(resolveLength('half' as unknown as '50%', 100)).toBeNull();
    expect(resolveLength('50' as unknown as '50%', 100)).toBeNull();
  });

  it('uses 0 as the default base', () => {
    expect(resolveLength('50%')).toBe(0);
    expect(resolveLength(7)).toBe(7);
  });
});

describe('params: normalizeParams', () => {
  it('fills in every default', () => {
    const params = normalizeParams();

    expect(params).toEqual(DEFAULT_LAYOUT_PARAMS);
    expect(params.width).toBe('auto');
    expect(params.height).toBe('auto');
    expect(params.minWidth).toBe(0);
    expect(params.maxWidth).toBe(Number.POSITIVE_INFINITY);
    expect(params.grow).toBe(0);
    expect(params.shrink).toBe(0);
    expect(params.basis).toBeNull();
    expect(params.alignSelf).toBe('auto');
    expect(params.aspectRatio).toBeNull();
    expect(params.position).toBe('flow');
    expect(params.hideMode).toBe('collapse');
    expect(params.order).toBe(0);
    expect(params.gridColumn).toBeNull();
    expect(params.gridColumnSpan).toBe(1);
  });

  it('treats an empty object like no params at all', () => {
    expect(normalizeParams({})).toEqual(DEFAULT_LAYOUT_PARAMS);
  });

  it('does not leak the frozen defaults into the caller', () => {
    const params = normalizeParams();
    params.margin.left = 12;
    expect(DEFAULT_LAYOUT_PARAMS.margin.left).toBe(0);
  });

  it('splits a {value, min, max} length into the value and its clamps', () => {
    const params = normalizeParams({ width: { value: '50%', min: 10, max: 240 } });

    expect(params.width).toBe('50%');
    expect(params.widthMin).toBe(10);
    expect(params.widthMax).toBe(240);
    expect(params.heightMin).toBe(0);
    expect(params.heightMax).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps min/max params separate from the length clamps', () => {
    const params = normalizeParams({ width: '50%', minWidth: 20, maxWidth: 300 });

    expect(params.widthMin).toBe(0);
    expect(params.widthMax).toBe(Number.POSITIVE_INFINITY);
    expect(params.minWidth).toBe(20);
    expect(params.maxWidth).toBe(300);
  });

  it('normalises margin and padding shorthands', () => {
    const params = normalizeParams({ margin: [4, 8], padding: { top: 2 } });

    expect(params.margin).toEqual({ top: 4, right: 8, bottom: 4, left: 8 });
    expect(params.padding).toEqual({ top: 2, right: 0, bottom: 0, left: 0 });
  });

  it('keeps flex, order and visibility parameters', () => {
    const params = normalizeParams({
      grow: 2,
      shrink: 0.5,
      basis: '30%',
      order: -3,
      hideMode: 'keep',
    });

    expect(params.grow).toBe(2);
    expect(params.shrink).toBe(0.5);
    expect(params.basis).toBe('30%');
    expect(params.order).toBe(-3);
    expect(params.hideMode).toBe('keep');
  });

  it('replaces non-finite flex numbers with 0', () => {
    const params = normalizeParams({ grow: Number.NaN, shrink: Number.POSITIVE_INFINITY });

    expect(params.grow).toBe(0);
    expect(params.shrink).toBe(0);
  });

  it('normalises grid placement parameters', () => {
    const params = normalizeParams({
      gridColumn: 3,
      gridRow: 2,
      gridColumnSpan: 2.7,
      gridRowSpan: 0,
    });

    expect(params.gridColumn).toBe(3);
    expect(params.gridRow).toBe(2);
    expect(params.gridColumnSpan).toBe(2);
    expect(params.gridRowSpan).toBe(1);
  });

  it('keeps absolute positioning parameters, including their defaults', () => {
    const params = normalizeParams({ position: 'absolute', left: '25%', bottom: 12 });

    expect(params.position).toBe('absolute');
    expect(params.left).toBe('25%');
    expect(params.top).toBeNull();
    expect(params.right).toBeNull();
    expect(params.bottom).toBe(12);
  });

  it('drops a non-positive aspect ratio', () => {
    expect(normalizeParams({ aspectRatio: 0 }).aspectRatio).toBeNull();
    expect(normalizeParams({ aspectRatio: -2 }).aspectRatio).toBeNull();
    expect(normalizeParams({ aspectRatio: 1.5 }).aspectRatio).toBe(1.5);
  });

  it('normalises a numeric minWidth and maxWidth', () => {
    const params = normalizeParams({ minWidth: 40, maxWidth: '80%' });

    expect(params.minWidth).toBe(40);
    expect(params.maxWidth).toBe(0);
  });

  it('clones resolved params deeply enough to be mutated safely', () => {
    const source = normalizeParams({ margin: 4, padding: 6 });
    const clone = cloneResolvedParams(source);

    clone.margin.top = 99;
    clone.padding.left = 99;

    expect(source.margin.top).toBe(4);
    expect(source.padding.left).toBe(6);
    expect(clone.grow).toBe(source.grow);
  });
});

describe('params: helpers', () => {
  it('classifies every length kind', () => {
    expect(lengthKind(12)).toBe('fixed');
    expect(lengthKind('50%')).toBe('percent');
    expect(lengthKind('auto')).toBe('auto');
    expect(lengthKind('fill')).toBe('fill');
  });

  it('knows which lengths are definite', () => {
    expect(isDefiniteUnit(12)).toBe(true);
    expect(isDefiniteUnit('50%')).toBe(true);
    expect(isDefiniteUnit('auto')).toBe(false);
    expect(isDefiniteUnit('fill')).toBe(false);
  });

  it('wraps a length into a LengthValue', () => {
    expect(toLengthValue(12)).toEqual({ value: 12 });
    expect(toLengthValue('50%')).toEqual({ value: '50%' });
    expect(toLengthValue({ value: 'fill', max: 100 })).toEqual({ value: 'fill', max: 100 });
    expect(toLengthValue(undefined)).toBeUndefined();
  });

  it('extracts the unit of a length', () => {
    expect(toLengthUnit(12)).toBe(12);
    expect(toLengthUnit({ value: 'auto', min: 5 })).toBe('auto');
    expect(toLengthUnit()).toBeUndefined();
  });

  it('resolves an axis length and clamps it', () => {
    expect(resolveAxisLength('50%', 200, 0, 60)).toBe(60);
    expect(resolveAxisLength(30, 200, 0, 60)).toBe(30);
    expect(resolveAxisLength(undefined, 200, 0, 60)).toBeNull();
  });

  it('maps a direction to its main and cross axes', () => {
    expect(mainAxisOf('vertical')).toBe('vertical');
    expect(mainAxisOf('horizontal')).toBe('horizontal');
    expect(crossAxisOf('vertical')).toBe('horizontal');
    expect(crossAxisOf('horizontal')).toBe('vertical');
  });

  it('reads the main and cross extent of a size', () => {
    const size = { width: 30, height: 40 };

    expect(mainSizeOf('horizontal', size)).toBe(30);
    expect(mainSizeOf('vertical', size)).toBe(40);
    expect(crossSizeOf('horizontal', size)).toBe(40);
    expect(crossSizeOf('vertical', size)).toBe(30);
  });

  it('resolves alignSelf against the container alignment', () => {
    expect(alignSelfOf('center', 'end')).toBe('center');
    expect(alignSelfOf('auto', 'end')).toBe('end');
    expect(alignSelfOf('auto', 'stretch')).toBe('stretch');
    expect(alignSelfOf('auto', 'auto')).toBe('start');
    expect(alignSelfOf('auto', undefined)).toBe('start');
  });
});

describe('params: mergeParams (partial patch)', () => {
  it('keeps every field the patch does not mention', () => {
    const current = normalizeParams({ width: 'fill', height: 120, position: 'absolute', top: 10 });
    const next = mergeParams(current, { height: 200 });

    expect(next.height).toBe(200);
    expect(next.width).toBe('fill');
    expect(next.position).toBe('absolute');
    expect(next.top).toBe(10);
  });

  it('does not reset a position to flow when only a size changes', () => {
    const current = normalizeParams({ position: 'absolute', left: 4 });
    const next = mergeParams(current, { width: 80 });

    expect(next.position).toBe('absolute');
    expect(next.left).toBe(4);
    expect(next.width).toBe(80);
  });

  it('refreshes the length clamps only when the length itself is patched', () => {
    const current = normalizeParams({ width: { value: 100, min: 20, max: 300 } });
    expect(current.widthMin).toBe(20);

    const untouched = mergeParams(current, { height: 50 });
    expect(untouched.widthMin).toBe(20);

    const replaced = mergeParams(current, { width: 60 });
    expect(replaced.width).toBe(60);
    expect(replaced.widthMin).toBe(0);
    expect(replaced.widthMax).toBe(Number.POSITIVE_INFINITY);
  });

  it('expands insets shorthands and keeps the other axis', () => {
    const current = normalizeParams({ padding: 8, margin: [1, 2] });
    const next = mergeParams(current, { padding: { left: 20 } });

    expect(next.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 20 });
    expect(next.margin).toEqual({ top: 1, right: 2, bottom: 1, left: 2 });
  });

  it('never shares insets objects with the input', () => {
    const current = normalizeParams({ padding: 4 });
    const next = mergeParams(current, { padding: 4 });

    next.padding.left = 99;
    expect(current.padding.left).toBe(4);
    expect(DEFAULT_LAYOUT_PARAMS.padding.left).toBe(0);
  });

  it('treats an explicitly undefined value as "not mentioned"', () => {
    const current = normalizeParams({ grow: 3, height: 40 });
    const next = mergeParams(current, { grow: undefined, height: 50 });

    expect(next.grow).toBe(3);
    expect(next.height).toBe(50);
  });

  it('returns a copy for an empty patch', () => {
    const current = normalizeParams({ width: 10 });
    const next = mergeParams(current, {});
    const bare = mergeParams(current);

    expect(next).not.toBe(current);
    expect(next).toEqual(current);
    expect(bare).toEqual(current);
  });

  it('applies the small value params one by one', () => {
    const current = normalizeParams({});
    const next = mergeParams(current, {
      grow: 2,
      shrink: 1,
      order: 5,
      alignSelf: 'center',
      aspectRatio: 2,
      hideMode: 'keep',
      gridColumn: 3,
      gridRowSpan: 2,
    });

    expect(next.grow).toBe(2);
    expect(next.shrink).toBe(1);
    expect(next.order).toBe(5);
    expect(next.alignSelf).toBe('center');
    expect(next.aspectRatio).toBe(2);
    expect(next.hideMode).toBe('keep');
    expect(next.gridColumn).toBe(3);
    expect(next.gridRowSpan).toBe(2);
    // Untouched defaults survive.
    expect(next.width).toBe('auto');
    expect(next.position).toBe('flow');
    expect(next.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('drops an invalid aspect ratio to null only when it is patched', () => {
    const current = normalizeParams({ aspectRatio: 2 });
    expect(mergeParams(current, { width: 10 }).aspectRatio).toBe(2);
    expect(mergeParams(current, { aspectRatio: 0 }).aspectRatio).toBeNull();
  });

  it('patches the four absolute offsets independently', () => {
    const current = normalizeParams({ position: 'absolute', left: 1, top: 2, right: 3, bottom: 4 });
    const next = mergeParams(current, { top: 20 });

    expect(next).toMatchObject({ left: 1, top: 20, right: 3, bottom: 4, position: 'absolute' });
  });
});

describe('params: non-finite values', () => {
  it('falls back to the defaults for NaN and Infinity bounds', () => {
    const resolved = normalizeParams({
      width: Number.NaN,
      minWidth: Number.NaN,
      maxWidth: Number.POSITIVE_INFINITY,
    });

    expect(resolved.width).toBe('auto');
    expect(resolved.minWidth).toBe(0);
    expect(resolved.maxWidth).toBe(Number.POSITIVE_INFINITY);
  });

  it('sanitises the clamps of a { value, min, max } length', () => {
    const resolved = normalizeParams({ width: { value: 'fill', min: Number.NaN, max: Infinity } });

    expect(resolved.widthMin).toBe(0);
    expect(resolved.widthMax).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.heightMin).toBe(0);
  });
});
