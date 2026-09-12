import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computed,
  effect,
  effectScope,
  flushSync,
  getCurrentScope,
  getDepSize,
  onDevWarning,
  onScopeDispose,
  reactive,
  ref,
  resetDevWarnings,
  setDevMode,
  watch,
  watchEffect,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('effectScope', () => {
  it('collects effects created inside run() and stops them together', () => {
    const count = ref(0);
    let runs = 0;
    const scope = effectScope();
    scope.run(() => {
      effect(() => {
        void count.value;
        runs++;
      });
    });
    expect(runs).toBe(1);
    count.value = 1;
    flushSync();
    expect(runs).toBe(2);
    scope.stop();
    count.value = 2;
    flushSync();
    expect(runs).toBe(2);
    expect(scope.active).toBe(false);
  });

  it('stops watchers created inside the scope', () => {
    const count = ref(0);
    const spy = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      watch(count, spy);
    });
    count.value = 1;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    scope.stop();
    count.value = 2;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('releases the dependency sets of the effects it owns', () => {
    const state = reactive({ a: 1 });
    const runs: number[] = [];
    const scope = effectScope();
    scope.run(() => {
      effect(() => {
        runs.push(state.a);
      });
      watchEffect(() => {
        void state.a;
      });
    });
    expect(runs).toEqual([1]);
    expect(getDepSize(state, 'a')).toBe(2);
    scope.stop();
    // The subscriptions are gone: nothing is left to notify.
    expect(getDepSize(state, 'a')).toBe(0);
    state.a = 2;
    state.a = 3;
    flushSync();
    expect(runs).toEqual([1]);
  });

  it('releases subscriptions when a single effect is stopped', () => {
    const state = reactive({ a: 1 });
    const handle = effect(() => {
      void state.a;
    });
    expect(getDepSize(state, 'a')).toBe(1);
    handle.stop();
    expect(getDepSize(state, 'a')).toBe(0);
  });

  it('returns the callback result and warns when run after stop', () => {
    const warnings: string[] = [];
    const off = onDevWarning((message) => warnings.push(message));
    const scope = effectScope();
    expect(scope.run(() => 42)).toBe(42);
    scope.stop();
    expect(scope.run(() => 42)).toBeUndefined();
    expect(warnings.some((message) => message.includes('stopped'))).toBe(true);
    off();
  });

  it('reports the current scope while running and outside of it', () => {
    const scope = effectScope();
    expect(getCurrentScope()).toBeUndefined();
    scope.run(() => {
      expect(getCurrentScope()).toBe(scope);
      const nested = effectScope();
      expect(nested.active).toBe(true);
      nested.stop();
    });
    expect(getCurrentScope()).toBeUndefined();
    scope.stop();
  });

  it('runs onScopeDispose callbacks on stop, in registration order', () => {
    const log: string[] = [];
    const scope = effectScope();
    scope.run(() => {
      onScopeDispose(() => log.push('first'));
      onScopeDispose(() => log.push('second'));
    });
    expect(log).toEqual([]);
    scope.stop();
    expect(log).toEqual(['first', 'second']);
  });

  it('warns when onScopeDispose is used without a scope', () => {
    const warnings: string[] = [];
    const off = onDevWarning((message) => warnings.push(message));
    onScopeDispose(() => {});
    expect(warnings.some((message) => message.includes('onScopeDispose'))).toBe(true);
    off();
  });

  it('owns nested scopes and stops them with the parent', () => {
    const count = ref(0);
    let innerRuns = 0;
    const parent = effectScope();
    parent.run(() => {
      const child = effectScope();
      child.run(() => {
        effect(() => {
          void count.value;
          innerRuns++;
        });
      });
    });
    count.value = 1;
    flushSync();
    expect(innerRuns).toBe(2);
    parent.stop();
    count.value = 2;
    flushSync();
    expect(innerRuns).toBe(2);
  });

  it('keeps detached scopes alive when the parent stops', () => {
    const count = ref(0);
    let runs = 0;
    const parent = effectScope();
    let detached: ReturnType<typeof effectScope> | undefined;
    parent.run(() => {
      detached = effectScope(true);
      detached.run(() => {
        effect(() => {
          void count.value;
          runs++;
        });
      });
    });
    parent.stop();
    count.value = 1;
    flushSync();
    expect(runs).toBe(2);
    expect(detached!.active).toBe(true);
    detached!.stop();
    count.value = 2;
    flushSync();
    expect(runs).toBe(2);
  });

  it('stops subscribers created during a run that also stopped the scope', () => {
    const count = ref(0);
    let runs = 0;
    const scope = effectScope();
    scope.run(() => {
      scope.stop();
      effect(() => {
        void count.value;
        runs++;
      });
    });
    expect(runs).toBe(1);
    count.value = 1;
    flushSync();
    expect(runs).toBe(1);
  });

  it('stops computeds created inside the scope', () => {
    const count = ref(1);
    let evaluations = 0;
    const scope = effectScope();
    const doubled = scope.run(() =>
      computed(() => {
        evaluations++;
        return count.value * 2;
      }),
    )!;
    expect(doubled.value).toBe(2);
    scope.stop();
    count.value = 5;
    flushSync();
    expect(evaluations).toBe(1);
  });

  it('ignores stop() called twice', () => {
    const log: string[] = [];
    const scope = effectScope();
    scope.run(() => {
      onScopeDispose(() => log.push('disposed'));
    });
    scope.stop();
    scope.stop();
    expect(log).toEqual(['disposed']);
  });
});
