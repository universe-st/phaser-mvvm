import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deepEqual,
  devLog,
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

  it('is symmetric when a sub-object is aliased on one side only', () => {
    const shared = { v: 1 };
    const left = { p: shared, q: shared };
    const right = { p: { v: 1 }, q: { v: 1 } };
    // The pair must be remembered only for the open comparison path, otherwise `shared` stays bound
    // to the first right-hand object and `q` is compared against it a second time.
    expect(deepEqual(left, right)).toBe(true);
    expect(deepEqual(right, left)).toBe(true);
    expect(deepEqual(left, { p: { v: 1 }, q: { v: 2 } })).toBe(false);
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

describe('devLog · tracing costs nothing in release', () => {
  it('prints a prefixed line while dev mode is on', () => {
    const lines: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args);
    try {
      devLog('mount: page attached');
      devLog('layout: 12 widget(s)', { passes: 3 });
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([
      ['[phaser-mvvm] mount: page attached'],
      ['[phaser-mvvm] layout: 12 widget(s)', { passes: 3 }],
    ]);
  });

  it('prints nothing once dev mode is off', () => {
    setDevMode(false);
    const lines: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args);
    try {
      devLog('activate: ok (pointer)');
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([]);
  });

  it('leaves release call sites free to skip building the message', () => {
    // Call sites in the frame path are written as `if (isDevMode()) devLog(...)` so the template
    // string is never built in release; this pins the contract they rely on.
    setDevMode(false);
    expect(isDevMode()).toBe(false);
  });
});
