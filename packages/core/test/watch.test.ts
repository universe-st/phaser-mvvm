import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computed,
  flushFrame,
  flushSync,
  reactive,
  ref,
  resetDevWarnings,
  setDevMode,
  triggerRef,
  watch,
  watchEffect,
  watchPostEffect,
  watchSyncEffect,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('watch sources', () => {
  it('watches a ref and passes old and new values', () => {
    const count = ref(0);
    const spy = vi.fn();
    watch(count, spy);
    count.value = 1;
    flushSync();
    expect(spy).toHaveBeenCalledWith(1, 0, expect.any(Function));
  });

  it('watches a computed ref', () => {
    const count = ref(1);
    const doubled = computed(() => count.value * 2);
    const spy = vi.fn();
    watch(doubled, spy);
    count.value = 2;
    flushSync();
    expect(spy).toHaveBeenCalledWith(4, 2, expect.any(Function));
  });

  it('watches a getter', () => {
    const state = reactive({ count: 0 });
    const spy = vi.fn();
    watch(
      () => state.count,
      (value) => spy(value),
    );
    state.count = 3;
    flushSync();
    expect(spy).toHaveBeenCalledWith(3);
  });

  it('watches a reactive object deeply by default', () => {
    const state = reactive({ nested: { count: 0 } });
    const spy = vi.fn();
    watch(state, spy);
    state.nested.count = 1;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as { nested: { count: number } }).nested.count).toBe(1);
  });

  it('watches an array of sources element-wise', () => {
    const a = ref(1);
    const b = ref(2);
    const spy = vi.fn();
    watch([a, b], spy);
    a.value = 10;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual([10, 2]);
    expect(spy.mock.calls[0]![1]).toEqual([1, 2]);
    b.value = 2;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid sources', () => {
    expect(() => watch(1 as never, () => {})).toThrow(/watch\(\) expects/);
  });

  it('watches a reactive array through its mutations', () => {
    const list = reactive<number[]>([1]);
    const spy = vi.fn();
    watch(list, spy);
    list.push(2);
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toEqual([1, 2]);
    list.splice(0, 2);
    flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0]).toEqual([]);
  });

  it('reacts to triggerRef even when the value is unchanged', () => {
    const state = ref({ count: 0 });
    const spy = vi.fn();
    watch(() => state.value, spy, { deep: true });
    state.value.count = 0;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    triggerRef(state);
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('watch change detection', () => {
  it('does not fire when the value is written back unchanged', () => {
    const count = ref(1);
    const spy = vi.fn();
    watch(count, spy);
    count.value = 1;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not fire for NaN → NaN but fires for NaN → number', () => {
    const value = ref(Number.NaN);
    const spy = vi.fn();
    watch(value, spy);
    value.value = Number.NaN;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    value.value = 1;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses reference comparison for non-deep object getters', () => {
    const state = ref({ count: 0 });
    const spy = vi.fn();
    watch(() => state.value, spy);
    state.value.count = 1;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    state.value = { count: 1 };
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fires for a nested mutation with deep: true', () => {
    const state = ref({ nested: { count: 0 } });
    const spy = vi.fn();
    watch(() => state.value, spy, { deep: true });
    state.value.nested.count = 1;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not fire when a rebuilt object is structurally equal with deep: true', () => {
    const state = ref({ count: 0 });
    const spy = vi.fn();
    watch(() => state.value, spy, { deep: true });
    state.value = { count: 0 };
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    state.value = { count: 1 };
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a nested change that is reverted inside one batch', () => {
    const state = reactive({ count: 0 });
    const spy = vi.fn();
    watch(() => state.count, spy);
    state.count = 1;
    state.count = 0;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('watch options', () => {
  it('immediate runs the callback right away', () => {
    const count = ref(1);
    const spy = vi.fn();
    watch(count, spy, { immediate: true });
    expect(spy).toHaveBeenCalledWith(1, undefined, expect.any(Function));
    count.value = 2;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('flush: "pre" (default) defers the callback to the batch flush', () => {
    const count = ref(0);
    const spy = vi.fn();
    watch(count, spy);
    count.value = 1;
    expect(spy).not.toHaveBeenCalled();
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs pre callbacks before post callbacks', () => {
    const count = ref(0);
    const order: string[] = [];
    watch(count, () => order.push('pre'));
    watch(count, () => order.push('post'), { flush: 'post' });
    count.value = 1;
    flushSync();
    expect(order).toEqual(['pre', 'post']);
  });

  it('flush: "sync" invokes the callback immediately', () => {
    const count = ref(0);
    const spy = vi.fn();
    watch(count, spy, { flush: 'sync' });
    count.value = 1;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('flush: "frame" waits for flushFrame()', () => {
    const count = ref(0);
    const spy = vi.fn();
    watch(count, spy, { flush: 'frame' });
    count.value = 1;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    flushFrame();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('watch lifecycle', () => {
  it('runs the callback cleanup before the next invocation and on stop', () => {
    const count = ref(0);
    const log: string[] = [];
    const stop = watch(count, (value, _old, onCleanup) => {
      log.push(`cb ${value}`);
      onCleanup(() => log.push(`cleanup ${value}`));
    });
    count.value = 1;
    flushSync();
    count.value = 2;
    flushSync();
    stop.stop();
    expect(log).toEqual(['cb 1', 'cleanup 1', 'cb 2', 'cleanup 2']);
  });

  it('stops through the callable handle and reports active', () => {
    const count = ref(0);
    const spy = vi.fn();
    const stop = watch(count, spy);
    expect(stop.active).toBe(true);
    count.value = 1;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    stop();
    expect(stop.active).toBe(false);
    count.value = 2;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('pause defers callbacks and resume replays only the last value', () => {
    const count = ref(0);
    const spy = vi.fn();
    const stop = watch(count, spy, { immediate: true });
    spy.mockClear();
    stop.pause();
    count.value = 1;
    count.value = 2;
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    stop.resume();
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(2, 0, expect.any(Function));
  });
});

describe('watchEffect', () => {
  it('runs immediately and re-runs on dependency changes', () => {
    const count = ref(0);
    const seen: number[] = [];
    const stop = watchEffect(() => {
      seen.push(count.value);
    });
    expect(seen).toEqual([0]);
    count.value = 1;
    count.value = 2;
    flushSync();
    expect(seen).toEqual([0, 2]);
    stop.stop();
    count.value = 3;
    flushSync();
    expect(seen).toEqual([0, 2]);
  });

  it('receives onCleanup which runs before the next run and on stop', () => {
    const count = ref(0);
    const log: string[] = [];
    const stop = watchEffect((onCleanup) => {
      const current = count.value;
      log.push(`run ${current}`);
      onCleanup(() => log.push(`cleanup ${current}`));
    });
    count.value = 1;
    flushSync();
    stop.stop();
    expect(log).toEqual(['run 0', 'cleanup 0', 'run 1', 'cleanup 1']);
  });

  it('supports flush: "post" and flush: "sync" variants', () => {
    const count = ref(0);
    const log: string[] = [];
    watchPostEffect(() => log.push(`post ${count.value}`));
    watchSyncEffect(() => log.push(`sync ${count.value}`));
    expect(log).toEqual(['post 0', 'sync 0']);
    count.value = 1;
    expect(log).toEqual(['post 0', 'sync 0', 'sync 1']);
    flushSync();
    expect(log).toEqual(['post 0', 'sync 0', 'sync 1', 'post 1']);
  });

  it('stops re-running after the stop handle is called twice', () => {
    const count = ref(0);
    let runs = 0;
    const stop = watchEffect(
      () => {
        void count.value;
        runs++;
      },
      { flush: 'sync' },
    );
    stop();
    stop();
    count.value = 1;
    expect(runs).toBe(1);
  });
});
