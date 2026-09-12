import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deepEqual,
  isDevMode,
  onDevWarning,
  readonly,
  reactive,
  resetDevWarnings,
  setDevMode,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

afterEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('dev mode', () => {
  it('is enabled by default and can be toggled', () => {
    expect(isDevMode()).toBe(true);
    setDevMode(false);
    expect(isDevMode()).toBe(false);
    setDevMode(true);
    expect(isDevMode()).toBe(true);
  });

  it('delivers warnings to registered listeners and can unsubscribe', () => {
    const messages: string[] = [];
    const off = onDevWarning((message) => messages.push(message));
    const state = readonly(reactive({ count: 0 }));
    (state as { count: number }).count = 1;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[phaser-mvvm]');
    off();
    (state as { count: number }).count = 2;
    expect(messages).toHaveLength(1);
  });

  it('suppresses warnings when dev mode is off', () => {
    setDevMode(false);
    const messages: string[] = [];
    const off = onDevWarning((message) => messages.push(message));
    const state = readonly({ count: 0 });
    (state as { count: number }).count = 1;
    expect(messages).toEqual([]);
    off();
  });

  it('reports a warning only once until the cache is reset', () => {
    const messages: string[] = [];
    const off = onDevWarning((message) => messages.push(message));
    const state = readonly({ count: 0 });
    (state as { count: number }).count = 1;
    (state as { count: number }).count = 2;
    expect(messages).toHaveLength(1);
    resetDevWarnings();
    (state as { count: number }).count = 3;
    expect(messages).toHaveLength(2);
    off();
  });
});

describe('deepEqual', () => {
  it('compares primitives with Object.is semantics', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
  });

  it('compares arrays and nested objects structurally', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('compares Map, Set and Date values', () => {
    expect(deepEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true);
    expect(deepEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
    expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(deepEqual(new Date(0), new Date(0))).toBe(true);
    expect(deepEqual(new Date(0), new Date(1))).toBe(false);
  });

  it('handles cyclic structures without hanging', () => {
    interface Node {
      self?: Node;
      value: number;
    }
    const a: Node = { value: 1 };
    a.self = a;
    const b: Node = { value: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);
    const c: Node = { value: 2 };
    c.self = c;
    expect(deepEqual(a, c)).toBe(false);
  });

  it('treats class instances as identity-comparable only', () => {
    class Thing {
      constructor(public value: number) {}
    }
    const thing = new Thing(1);
    expect(deepEqual(thing, thing)).toBe(true);
    expect(deepEqual(thing, new Thing(1))).toBe(false);
  });
});
