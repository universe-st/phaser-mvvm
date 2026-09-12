/**
 * The pointer-claim registry: the protocol a widget uses to own a drag before a `ScrollView` takes it.
 *
 * Pure bookkeeping (a `WeakMap` of scene → pointer id → owner), so it is covered in Node; what the
 * browser adds is the gesture itself, which the `#/options` card measures.
 */

import { describe, expect, it } from 'vitest';
import {
  claimPointerDrag,
  clearPointerClaims,
  pointerClaims,
  pointerDragOwner,
  releasePointerDrag,
} from '../src/pointer-claim';

function scene(): object {
  return {};
}

describe('pointer drag claims', () => {
  it('reports the owner of a claimed pointer and null for a free one', () => {
    const host = scene();
    const field = { name: 'field' };
    expect(pointerDragOwner(host, 1)).toBeNull();
    claimPointerDrag(host, 1, field);
    expect(pointerDragOwner(host, 1)).toBe(field);
    expect(pointerDragOwner(host, 2)).toBeNull();
  });

  it('lets an owner ask whether somebody else took the gesture', () => {
    const host = scene();
    const field = { name: 'field' };
    const other = { name: 'other' };
    claimPointerDrag(host, 3, field);
    expect(pointerDragOwner(host, 3, field)).toBeNull();
    expect(pointerDragOwner(host, 3, other)).toBe(field);
  });

  it('keeps scenes apart', () => {
    const first = scene();
    const second = scene();
    claimPointerDrag(first, 1, { name: 'a' });
    expect(pointerDragOwner(second, 1)).toBeNull();
  });

  it('releases a claim, and only its own unless asked', () => {
    const host = scene();
    const field = { name: 'field' };
    claimPointerDrag(host, 1, field);
    // A stale release from a previous gesture must not drop the claim a new owner just made.
    releasePointerDrag(host, 1, { name: 'stale' });
    expect(pointerDragOwner(host, 1)).toBe(field);
    releasePointerDrag(host, 1, field);
    expect(pointerDragOwner(host, 1)).toBeNull();
  });

  it('drops every claim of a scene on shutdown', () => {
    const host = scene();
    claimPointerDrag(host, 1, { name: 'a' });
    claimPointerDrag(host, 2, { name: 'b' });
    clearPointerClaims(host);
    expect(pointerClaims(host)).toEqual([]);
  });

  it('names the outstanding claims for a probe or a dev log', () => {
    const host = scene();
    claimPointerDrag(host, 7, { name: 'canvas' });
    expect(pointerClaims(host)).toEqual([{ pointerId: 7, owner: 'canvas' }]);
  });

  it('ignores a nonsensical pointer id and a missing scene', () => {
    const host = scene();
    claimPointerDrag(host, Number.NaN, { name: 'a' });
    expect(pointerClaims(host)).toEqual([]);
    claimPointerDrag(undefined, 1, { name: 'a' });
    expect(pointerDragOwner(undefined, 1)).toBeNull();
  });
});
