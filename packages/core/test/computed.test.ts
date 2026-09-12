import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computed,
  effect,
  effectScope,
  flushSync,
  isRef,
  reactive,
  ref,
  resetDevWarnings,
  setDevMode,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('computed', () => {
  it('is lazy: nothing is evaluated before the first read', () => {
    const spy = vi.fn(() => 1);
    const value = computed(spy);
    expect(spy).not.toHaveBeenCalled();
    expect(value.value).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches until a dependency changes', () => {
    const source = ref(1);
    let calls = 0;
    const doubled = computed(() => {
      calls++;
      return source.value * 2;
    });
    expect(doubled.value).toBe(2);
    expect(doubled.value).toBe(2);
    expect(calls).toBe(1);
    source.value = 2;
    // Still cached: the recompute happens on the next read only.
    expect(calls).toBe(1);
    expect(doubled.value).toBe(4);
    expect(calls).toBe(2);
  });

  it('does not recompute when a dependency is written with an equal value', () => {
    const source = ref(1);
    let calls = 0;
    const doubled = computed(() => {
      calls++;
      return source.value * 2;
    });
    expect(doubled.value).toBe(2);
    source.value = 1;
    expect(doubled.value).toBe(2);
    expect(calls).toBe(1);
  });

  it('chains through other computeds', () => {
    const source = ref(1);
    const plusOne = computed(() => source.value + 1);
    const timesTen = computed(() => plusOne.value * 10);
    expect(timesTen.value).toBe(20);
    source.value = 2;
    expect(timesTen.value).toBe(30);
  });

  it('runs effects that read it exactly once per batch', () => {
    const source = ref(1);
    const doubled = computed(() => source.value * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(doubled.value);
    });
    source.value = 2;
    source.value = 3;
    flushSync();
    expect(seen).toEqual([2, 6]);
  });

  it('re-evaluates exactly once per dependency change and forwards it to consumers', () => {
    const source = ref(0);
    let evaluations = 0;
    const parity = computed(() => {
      evaluations++;
      return source.value % 2 === 0 ? 'even' : 'odd';
    });
    const seen: string[] = [];
    effect(() => {
      seen.push(parity.value);
    });
    source.value = 2;
    flushSync();
    expect(evaluations).toBe(2);
    // The value two updates away is not read, so no extra evaluation happens in between.
    source.value = 4;
    flushSync();
    expect(evaluations).toBe(3);
    expect(seen).toEqual(['even', 'even', 'even']);
  });

  it('peek reads without creating a dependency', () => {
    const source = ref(1);
    const doubled = computed(() => source.value * 2);
    let runs = 0;
    effect(() => {
      void doubled.peek();
      runs++;
    });
    source.value = 5;
    flushSync();
    expect(runs).toBe(1);
    expect(doubled.peek()).toBe(10);
  });

  it('supports reactive object sources with several dependencies', () => {
    const state = reactive({ price: 2, quantity: 3 });
    const total = computed(() => state.price * state.quantity);
    expect(total.value).toBe(6);
    state.quantity = 4;
    expect(total.value).toBe(8);
  });

  it('is recognised by isRef and exposes no setter', () => {
    const value = computed(() => 1);
    expect(isRef(value)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), 'value')?.set,
    ).toBeUndefined();
  });

  it('releases its dependencies when its effect scope stops', () => {
    const source = ref(1);
    let evaluations = 0;
    const scope = effectScope();
    const value = scope.run(() => {
      return computed(() => {
        evaluations++;
        return source.value;
      });
    })!;
    expect(value.value).toBe(1);
    expect(evaluations).toBe(1);
    scope.stop();
    // Nothing re-evaluates in the background once the scope is stopped.
    source.value = 2;
    flushSync();
    expect(evaluations).toBe(1);
    // Reading still yields fresh data, but no dependency is re-established.
    expect(value.value).toBe(2);
    expect(evaluations).toBe(2);
    source.value = 3;
    flushSync();
    expect(evaluations).toBe(2);
  });

  it('recomputes lazily inside a deep chain after several writes', () => {
    const a = ref(1);
    const b = ref(2);
    const sum = computed(() => a.value + b.value);
    const doubled = computed(() => sum.value * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(doubled.value);
    });
    a.value = 10;
    b.value = 20;
    flushSync();
    expect(seen).toEqual([6, 60]);
  });
});
