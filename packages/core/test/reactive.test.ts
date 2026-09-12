import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effect,
  flushSync,
  isProxy,
  isReactive,
  isReadonly,
  markRaw,
  onDevWarning,
  reactive,
  readonly,
  ref,
  resetDevWarnings,
  setDevMode,
  shallowReactive,
  toRaw,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('reactive objects', () => {
  it('tracks property reads and notifies on writes', () => {
    const state = reactive({ count: 0, name: 'a' });
    const seen: number[] = [];
    effect(() => {
      seen.push(state.count);
    });
    state.count = 1;
    flushSync();
    state.name = 'b';
    flushSync();
    expect(seen).toEqual([0, 1]);
  });

  it('lazily proxies nested objects and tracks them deeply', () => {
    const state = reactive({ nested: { count: 0 }, list: [{ id: 1 }] });
    expect(isReactive(state.nested)).toBe(true);
    expect(isReactive(state.list)).toBe(true);
    expect(isReactive(state.list[0])).toBe(true);

    let runs = 0;
    effect(() => {
      void state.nested.count;
      runs++;
    });
    state.nested.count++;
    flushSync();
    expect(runs).toBe(2);
  });

  it('notifies iteration dependents when keys are added or deleted', () => {
    const state = reactive<Record<string, number>>({ a: 1 });
    let keys: string[] = [];
    effect(() => {
      keys = Object.keys(state);
    });
    state.b = 2;
    flushSync();
    expect(keys).toEqual(['a', 'b']);
    delete state.a;
    flushSync();
    expect(keys).toEqual(['b']);
  });

  it('does not notify when a property is written with an equal value', () => {
    const state = reactive({ count: 0 });
    const spy = vi.fn();
    effect(() => {
      spy(state.count);
    });
    spy.mockClear();
    state.count = 0;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('tracks `in` checks and only invalidates them on add/delete', () => {
    const state = reactive<Record<string, number>>({ a: 1 });
    let runs = 0;
    effect(() => {
      void ('b' in state);
      runs++;
    });
    state.a = 5;
    flushSync();
    expect(runs).toBe(1);
    state.b = 2;
    flushSync();
    expect(runs).toBe(2);
  });

  it('reports isReactive/isProxy for proxies and raw values', () => {
    const raw = { a: 1 };
    const proxy = reactive(raw);
    expect(isReactive(proxy)).toBe(true);
    expect(isProxy(proxy)).toBe(true);
    expect(isReactive(raw)).toBe(false);
    expect(isReactive(readonly(raw))).toBe(false);
    expect(isReadonly(readonly(raw))).toBe(true);
  });
});

describe('proxy identity and raw access', () => {
  it('returns the same proxy for the same target', () => {
    const raw = { a: { b: 1 } };
    const first = reactive(raw);
    expect(reactive(raw)).toBe(first);
    expect(reactive(first)).toBe(first);
    expect(first.a).toBe(reactive(raw.a));
  });

  it('toRaw unwraps proxies and passes raw values through', () => {
    const raw = { a: { b: 1 } };
    const proxy = reactive(raw);
    expect(toRaw(proxy)).toBe(raw);
    expect(toRaw(proxy.a)).toBe(raw.a);
    expect(toRaw(raw)).toBe(raw);
    expect(toRaw(1)).toBe(1);
  });

  it('leaves unsupported targets alone', () => {
    const warnings: string[] = [];
    const off = onDevWarning((message) => warnings.push(message));
    class Widget {
      value = 1;
    }
    const widget = new Widget();
    expect(reactive(widget as unknown as object)).toBe(widget);
    const date = new Date(0);
    expect(reactive(date as unknown as object)).toBe(date);
    expect(warnings.length).toBeGreaterThan(0);
    off();
  });

  it('markRaw opts a value out of proxying', () => {
    const raw = markRaw({ count: 0 });
    const state = reactive({ child: raw });
    expect(state.child).toBe(raw);
    expect(isReactive(state.child)).toBe(false);
  });
});

describe('shallowReactive', () => {
  it('tracks top-level writes but not nested ones', () => {
    const state = shallowReactive({ nested: { count: 0 }, count: 0 });
    let runs = 0;
    effect(() => {
      void state.nested.count;
      runs++;
    });
    state.nested.count = 1;
    flushSync();
    expect(runs).toBe(1);
    state.nested = { count: 9 };
    flushSync();
    expect(runs).toBe(2);
  });
});

describe('readonly', () => {
  it('tracks reads but ignores writes with a warning', () => {
    const warnings: string[] = [];
    const off = onDevWarning((message) => warnings.push(message));
    const state = readonly({ count: 0, nested: { value: 1 } });
    let runs = 0;
    effect(() => {
      void state.count;
      runs++;
    });
    (state as { count: number }).count = 5;
    expect(state.count).toBe(0);
    expect(warnings.some((message) => message.includes('readonly'))).toBe(true);
    expect(runs).toBe(1);
    off();
  });

  it('reads nested values through read-only proxies', () => {
    const state = readonly({ nested: { value: 1 } });
    expect(isReadonly(state.nested)).toBe(true);
    expect(state.nested.value).toBe(1);
  });

  it('wraps a ref into a read-only view that keeps tracking', () => {
    const count = ref(0);
    const view = readonly(count);
    const seen: number[] = [];
    effect(() => {
      seen.push(view.value);
    });
    count.value = 1;
    flushSync();
    expect(seen).toEqual([0, 1]);
  });
});

describe('reactive arrays', () => {
  it('tracks a single index independently of the others', () => {
    const list = reactive([1, 2, 3]);
    const seen: number[] = [];
    effect(() => {
      seen.push(list[1]!);
    });
    list[0] = 10;
    flushSync();
    expect(seen).toEqual([2]);
    list[1] = 20;
    flushSync();
    expect(seen).toEqual([2, 20]);
  });

  it('notifies index and length dependents when growing past the end', () => {
    const list = reactive<number[]>([1]);
    let length = 0;
    effect(() => {
      length = list.length;
    });
    list[3] = 4;
    flushSync();
    expect(length).toBe(4);
    expect(list[3]).toBe(4);
  });

  it('truncating through length notifies dropped indices', () => {
    const list = reactive([1, 2, 3]);
    const seen: number[] = [];
    effect(() => {
      seen.push(list[2]!);
    });
    list.length = 1;
    flushSync();
    expect(seen).toEqual([3, undefined]);
  });

  it('push notifies once per batch and merges multiple calls', () => {
    const list = reactive<number[]>([]);
    const runs: number[][] = [];
    effect(() => {
      runs.push([...list]);
    });
    list.push(1);
    list.push(2, 3);
    flushSync();
    expect(runs).toEqual([[], [1, 2, 3]]);
  });

  it('push notifies an index consumer exactly once per call', () => {
    const list = reactive([1]);
    let runs = 0;
    effect(() => {
      void list.length;
      void list[0];
      runs++;
    });
    expect(runs).toBe(1);
    list.push(2);
    flushSync();
    expect(runs).toBe(2);
  });

  it.each([
    ['pop', (list: number[]) => list.pop()],
    ['shift', (list: number[]) => list.shift()],
    ['unshift', (list: number[]) => list.unshift(0)],
    ['splice', (list: number[]) => list.splice(1, 1)],
    ['sort', (list: number[]) => list.sort((a, b) => b - a)],
    ['reverse', (list: number[]) => list.reverse()],
    ['fill', (list: number[]) => list.fill(7)],
    ['copyWithin', (list: number[]) => list.copyWithin(0, 1)],
  ])('%s triggers exactly one notification per call', (_name, mutate) => {
    const list = reactive([1, 2, 3]);
    let runs = 0;
    effect(() => {
      // Reads the whole array so every index and the length are tracked.
      for (let i = 0; i < list.length; i++) void list[i];
      runs++;
    });
    expect(runs).toBe(1);
    mutate(list as number[]);
    flushSync();
    expect(runs).toBe(2);
  });

  it('splice only invalidates the range it touched', () => {
    const list = reactive([1, 2, 3, 4]);
    let firstRuns = 0;
    effect(() => {
      void list[0];
      firstRuns++;
    });
    let lastRuns = 0;
    effect(() => {
      void list[3];
      lastRuns++;
    });
    expect(firstRuns).toBe(1);
    expect(lastRuns).toBe(1);
    // Removing index 2 shifts index 3 but leaves index 0 untouched.
    list.splice(2, 1);
    flushSync();
    expect(firstRuns).toBe(1);
    expect(lastRuns).toBe(2);
    // Removing the head invalidates index 0.
    list.splice(0, 1);
    flushSync();
    expect(firstRuns).toBe(2);
  });

  it('includes finds a raw object stored through the proxy', () => {
    const item = { id: 1 };
    const list = reactive<{ id: number }[]>([]);
    list.push(item);
    expect(list.includes(item)).toBe(true);
    expect(list.indexOf(item)).toBe(0);
    expect(list.includes(reactive(item))).toBe(true);
  });

  it('array iterator methods track their reads', () => {
    const list = reactive([1, 2, 3]);
    let total = 0;
    effect(() => {
      total = list.reduce((sum, value) => sum + value, 0);
    });
    list.push(4);
    flushSync();
    expect(total).toBe(10);
  });
});
