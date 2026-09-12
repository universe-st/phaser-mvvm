import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computed,
  customRef,
  effect,
  flushSync,
  isRef,
  reactive,
  ref,
  resetDevWarnings,
  setDevMode,
  shallowRef,
  triggerRef,
  unref,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('ref', () => {
  it('reads and writes a tracked value', () => {
    const count = ref(1);
    expect(count.value).toBe(1);
    count.value = 5;
    expect(count.value).toBe(5);
  });

  it('notifies dependents when the value changes', () => {
    const count = ref(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.value);
    });
    count.value = 1;
    flushSync();
    expect(seen).toEqual([0, 1]);
  });

  it('short-circuits writes of an unchanged value', () => {
    const count = ref(0);
    const spy = vi.fn();
    effect(() => {
      spy(count.value);
    });
    spy.mockClear();
    count.value = 0;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats NaN as unchanged and a number as changed', () => {
    const value = ref(Number.NaN);
    let runs = 0;
    effect(() => {
      void value.value;
      runs++;
    });
    value.value = Number.NaN;
    flushSync();
    expect(runs).toBe(1);
    value.value = 0;
    flushSync();
    expect(runs).toBe(2);
  });

  it('deeply converts object values', () => {
    const state = ref({ nested: { count: 0 } });
    let runs = 0;
    effect(() => {
      void state.value.nested.count;
      runs++;
    });
    state.value.nested.count = 1;
    flushSync();
    expect(runs).toBe(2);
    expect(state.value.nested.count).toBe(1);
  });

  it('isRef recognises refs, computed refs and custom refs', () => {
    expect(isRef(ref(1))).toBe(true);
    expect(isRef(shallowRef(1))).toBe(true);
    expect(isRef(computed(() => 1))).toBe(true);
    expect(isRef(customRef(() => ({ get: () => 1, set: () => {} })))).toBe(true);
    expect(isRef(reactive({}))).toBe(false);
    expect(isRef({ value: 1 })).toBe(false);
    expect(isRef(undefined)).toBe(false);
    expect(isRef(1)).toBe(false);
  });

  it('unref unwraps refs and passes plain values through', () => {
    const count = ref(2);
    expect(unref(count)).toBe(2);
    expect(unref(7)).toBe(7);
  });
});

describe('shallowRef', () => {
  it('does not track nested mutation', () => {
    const state = shallowRef({ count: 0 });
    let runs = 0;
    effect(() => {
      void state.value.count;
      runs++;
    });
    state.value.count = 1;
    flushSync();
    expect(runs).toBe(1);
  });

  it('still notifies on reassignment', () => {
    const state = shallowRef({ count: 0 });
    const seen: number[] = [];
    effect(() => {
      seen.push(state.value.count);
    });
    state.value = { count: 5 };
    flushSync();
    expect(seen).toEqual([0, 5]);
  });

  it('stores the raw object without proxying it', () => {
    const raw = { count: 0 };
    const state = shallowRef(raw);
    expect(state.value).toBe(raw);
  });
});

describe('triggerRef', () => {
  it('forces a notification without a value change', () => {
    const count = ref(0);
    let runs = 0;
    effect(() => {
      void count.value;
      runs++;
    });
    triggerRef(count);
    flushSync();
    expect(runs).toBe(2);
  });

  it('works for shallowRef as well', () => {
    const state = shallowRef({ count: 0 });
    const spy = vi.fn();
    effect(() => {
      spy(state.value.count);
    });
    state.value.count = 3;
    triggerRef(state);
    flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(3);
  });
});

describe('customRef', () => {
  it('delegates reading and writing to the factory', () => {
    let value = 1;
    let notify: (() => void) | undefined;
    const custom = customRef<number>((track, trigger) => {
      notify = trigger;
      return {
        get() {
          track();
          return value;
        },
        set(next: number) {
          value = next;
          trigger();
        },
      };
    });

    const seen: number[] = [];
    effect(() => {
      seen.push(custom.value);
    });
    custom.value = 2;
    flushSync();
    expect(seen).toEqual([1, 2]);

    // `trigger` from the factory can notify without going through the setter.
    value = 3;
    notify?.();
    flushSync();
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('peek', () => {
  it('reads without collecting a dependency', () => {
    const count = ref(0);
    let runs = 0;
    effect(() => {
      void count.peek();
      runs++;
    });
    count.value = 1;
    flushSync();
    expect(runs).toBe(1);
  });
});
