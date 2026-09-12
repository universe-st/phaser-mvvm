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
