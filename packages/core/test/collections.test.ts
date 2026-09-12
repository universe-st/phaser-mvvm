import { beforeEach, describe, expect, it } from 'vitest';
import {
  effect,
  flushSync,
  isReactive,
  reactive,
  resetDevWarnings,
  setDevMode,
  toRaw,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('reactive Map', () => {
  it('tracks get and has for a single key', () => {
    const map = reactive(new Map<string, number>([['a', 1]]));
    const seen: Array<number | undefined> = [];
    effect(() => {
      seen.push(map.get('a'));
    });
    map.set('b', 2);
    flushSync();
    expect(seen).toEqual([1]);
    map.set('a', 3);
    flushSync();
    expect(seen).toEqual([1, 3]);
  });

  it('does not notify when an existing key is set to an equal value', () => {
    const map = reactive(new Map([['a', 1]]));
    let runs = 0;
    effect(() => {
      void map.get('a');
      runs++;
    });
    map.set('a', 1);
    flushSync();
    expect(runs).toBe(1);
  });

  it('notifies size and iteration dependents when keys are added or removed', () => {
    const map = reactive(new Map<string, number>([['a', 1]]));
    const sizes: number[] = [];
    effect(() => {
      sizes.push(map.size);
    });
    const keys: string[] = [];
    effect(() => {
      keys.length = 0;
      for (const key of map.keys()) keys.push(key as string);
    });
    map.set('b', 2);
    flushSync();
    expect(sizes).toEqual([1, 2]);
    expect(keys).toEqual(['a', 'b']);
    map.delete('a');
    flushSync();
    expect(sizes).toEqual([1, 2, 1]);
    expect(keys).toEqual(['b']);
  });

  it('clear notifies every dependent once', () => {
    const map = reactive(
      new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ]),
    );
    let runs = 0;
    effect(() => {
      void map.get('a');
      void map.get('b');
      void map.size;
      runs++;
    });
    map.clear();
    flushSync();
    expect(runs).toBe(2);
    expect(map.size).toBe(0);
  });

  it('forEach and values iterate with tracked dependencies', () => {
    const map = reactive(new Map([['a', 1]]));
    const collected: unknown[] = [];
    effect(() => {
      collected.length = 0;
      map.forEach((value) => collected.push(value));
    });
    map.set('b', 2);
    flushSync();
    expect(collected).toEqual([1, 2]);
  });

  it('wraps object values into reactive proxies', () => {
    const map = reactive(new Map<string, { count: number }>());
    map.set('nested', { count: 0 });
    let runs = 0;
    effect(() => {
      void map.get('nested')?.count;
      runs++;
    });
    map.get('nested')!.count = 1;
    flushSync();
    expect(runs).toBe(2);
    expect(isReactive(map.get('nested'))).toBe(true);
  });

  it('toRaw unwraps the collection proxy', () => {
    const raw = new Map([['a', 1]]);
    const map = reactive(raw);
    expect(toRaw(map)).toBe(raw);
  });
});

describe('reactive Set', () => {
  it('tracks size and iteration dependents', () => {
    const set = reactive(new Set<number>([1]));
    const sizes: number[] = [];
    effect(() => {
      sizes.push(set.size);
    });
    set.add(2);
    flushSync();
    expect(sizes).toEqual([1, 2]);
    set.delete(1);
    flushSync();
    expect(sizes).toEqual([1, 2, 1]);
  });

  it('does not notify when adding a duplicate value', () => {
    const set = reactive(new Set([1]));
    let runs = 0;
    effect(() => {
      void set.size;
      runs++;
    });
    set.add(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it('forEach sees new values', () => {
    const set = reactive(new Set<number>());
    const collected: number[][] = [];
    effect(() => {
      const values: number[] = [];
      set.forEach((value) => values.push(value as number));
      collected.push(values);
    });
    set.add(1);
    flushSync();
    set.add(2);
    flushSync();
    expect(collected).toEqual([[], [1], [1, 2]]);
  });

  it('clear empties the set and notifies once', () => {
    const set = reactive(new Set([1, 2, 3]));
    let runs = 0;
    effect(() => {
      void set.size;
      runs++;
    });
    set.clear();
    flushSync();
    expect(runs).toBe(2);
    expect(set.size).toBe(0);
  });

  it('has() subscribes to a specific value', () => {
    const set = reactive(new Set<number>([1]));
    const seen: boolean[] = [];
    effect(() => {
      seen.push(set.has(2));
    });
    set.add(2);
    flushSync();
    expect(seen).toEqual([false, true]);
  });

  it('supports entries and the default iterator', () => {
    const set = reactive(new Set([1, 2]));
    const pairs: unknown[] = [];
    effect(() => {
      pairs.length = 0;
      for (const entry of set.entries()) pairs.push(entry);
    });
    set.add(3);
    flushSync();
    expect(pairs).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});
