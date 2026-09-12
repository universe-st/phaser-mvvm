/**
 * `planBranch` tests: which builder a key resolves to, and — the part that matters — that a miss is
 * reported as a miss.
 *
 * A branch map is a plain object, so `branches[key]` walks `Object.prototype`: the keys `constructor`,
 * `toString` and `__proto__` all come back with something truthy that is not a branch, and the widget
 * would then call it (`branches['constructor']()` → "… is not a constructor"). Same story for a key
 * that is present but `undefined`. Both are reachable from application code — a tab key read from a
 * URL, an enum that grew a case — and both are silent until they aren't.
 */

import { describe, expect, it } from 'vitest';
import { planBranch, type BranchBuilder } from '../src/branch-plan';

const a: BranchBuilder = () => {};
const b: BranchBuilder = () => {};

describe('planBranch', () => {
  it('resolves a key that has a branch', () => {
    expect(planBranch({ a, b }, 'b')).toEqual({ builder: b, missing: false, key: 'b' });
  });

  it('reports an unknown key instead of inventing a builder', () => {
    expect(planBranch({ a }, 'nope')).toEqual({ builder: null, missing: true, key: 'nope' });
  });

  it('normalises number keys to the string form the map uses', () => {
    // `{ 1: … }` and `{ '1': … }` are the same property; a `ref<number>` must find it.
    expect(planBranch({ 1: a }, 1).builder).toBe(a);
    expect(planBranch({ 1: a }, '1').builder).toBe(a);
  });

  it('treats null and undefined as no branch', () => {
    expect(planBranch({ a }, null)).toEqual({ builder: null, missing: true, key: null });
    expect(planBranch({ a }, undefined)).toEqual({ builder: null, missing: true, key: null });
  });

  it('never returns an inherited Object.prototype member', () => {
    // The three spellings that would otherwise resolve to `Object`'s own members.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(planBranch({ a }, key)).toEqual({ builder: null, missing: true, key });
    }
  });

  it('treats a key that is present but not a function as missing', () => {
    const partial = { a, b: undefined } as Record<string, BranchBuilder | undefined>;
    expect(planBranch(partial, 'b').missing).toBe(true);
    expect(planBranch(partial, 'b').builder).toBeNull();
  });

  it('accepts an object with no prototype at all', () => {
    const bare = Object.assign(Object.create(null) as Record<string, BranchBuilder>, { a });
    expect(planBranch(bare, 'a').builder).toBe(a);
    expect(planBranch(bare, 'constructor').missing).toBe(true);
  });

  it('reports a miss for an empty map', () => {
    expect(planBranch({}, 'a')).toEqual({ builder: null, missing: true, key: 'a' });
  });
});
