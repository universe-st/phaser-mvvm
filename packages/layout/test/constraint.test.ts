/**
 * Tests for the constraint algebra, including the one policy for a contradictory `min > max` pair.
 *
 * A parent and a child can disagree about the bounds (a `minWidth: 300` child inside a 200px parent).
 * The engine has exactly one resolution for that, shared with `geom.clamp()`, so the measure and the
 * arrange pass cannot describe the same node with different sizes.
 */

import { describe, expect, it } from 'vitest';
import { constraints, deflate, enforce, loose, tight, unbounded } from '../src/constraint';

describe('constraint: contradictory min/max', () => {
  it('lets min win, matching geom.clamp', () => {
    const target = constraints(300, 200, 300, 200);
    enforce(target);

    // The midpoint this used to produce (250) satisfied neither bound and drifted on every nested
    // measure; CSS resolves the conflict in favour of the minimum, and `geom.clamp` already did.
    expect(target.minWidth).toBe(300);
    expect(target.maxWidth).toBe(300);
    expect(target.minHeight).toBe(300);
    expect(target.maxHeight).toBe(300);
  });

  it('is idempotent', () => {
    const target = constraints(300, 200);
    enforce(target);
    const first = { ...target };
    enforce(target);

    expect(target).toEqual(first);
  });
});

describe('constraint: constructors and deflation', () => {
  it('deflates by insets and never goes below zero', () => {
    const shrunk = deflate(tight(100, 50), { top: 10, right: 20, bottom: 10, left: 20 });

    expect(shrunk).toEqual({ minWidth: 60, maxWidth: 60, minHeight: 30, maxHeight: 30 });
    const over = deflate(loose(10, 10), { top: 20, right: 20, bottom: 20, left: 20 });
    expect(over.minWidth).toBe(0);
    expect(over.maxWidth).toBe(0);
  });

  it('builds loose, tight and unbounded constraints', () => {
    expect(loose(100, 50)).toEqual({ minWidth: 0, maxWidth: 100, minHeight: 0, maxHeight: 50 });
    expect(tight(100, 50)).toEqual({ minWidth: 100, maxWidth: 100, minHeight: 50, maxHeight: 50 });
    expect(unbounded().maxWidth).toBe(Number.POSITIVE_INFINITY);
  });
});
