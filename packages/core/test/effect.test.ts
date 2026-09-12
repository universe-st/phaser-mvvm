import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effect,
  flushSync,
  nextTick,
  pauseTracking,
  reactive,
  ref,
  resetDevWarnings,
  resumeTracking,
  setDevMode,
  untrack,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('effect', () => {
  it('runs immediately and tracks what it read', () => {
    const count = ref(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.value);
    });
    expect(seen).toEqual([0]);
    count.value = 1;
    flushSync();
    expect(seen).toEqual([0, 1]);
  });

  it('defers the first run when lazy', () => {
    const count = ref(0);
    const spy = vi.fn(() => count.value);
    const handle = effect(spy, { lazy: true });
    expect(spy).not.toHaveBeenCalled();
    // A dependency change still schedules the (never started) effect.
    handle.run();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('exposes active and stops through the callable handle', () => {
    const count = ref(0);
    let runs = 0;
    const handle = effect(() => {
      void count.value;
      runs++;
    });
    expect(handle.active).toBe(true);
    count.value = 1;
    flushSync();
    expect(runs).toBe(2);
    handle();
    expect(handle.active).toBe(false);
  });

  it('drops stale dependencies when a conditional branch switches', () => {
    const useA = ref(true);
    const a = ref(0);
    const b = ref(0);
    let runs = 0;
    effect(() => {
      runs++;
      if (useA.value) void a.value;
      else void b.value;
    });
    useA.value = false;
    flushSync();
    expect(runs).toBe(2);
    a.value = 1;
    flushSync();
    expect(runs).toBe(2);
    b.value = 1;
    flushSync();
    expect(runs).toBe(3);
  });

  it('runs cleanups before every re-run', () => {
    const count = ref(0);
    const log: string[] = [];
    effect((onCleanup) => {
      const current = count.value;
      log.push(`run ${current}`);
      onCleanup(() => log.push(`cleanup ${current}`));
    });
    count.value = 1;
    flushSync();
    count.value = 2;
    flushSync();
    expect(log).toEqual(['run 0', 'cleanup 0', 'run 1', 'cleanup 1', 'run 2']);
  });

  it('runs cleanups on stop', () => {
    const log: string[] = [];
    const handle = effect((onCleanup) => {
      log.push('run');
      onCleanup(() => log.push('cleanup'));
    });
    handle.stop();
    handle.stop();
    expect(log).toEqual(['run', 'cleanup']);
  });

  it('never notifies after stop', () => {
    const count = ref(0);
    let runs = 0;
    const handle = effect(() => {
      void count.value;
      runs++;
    });
    handle.stop();
    count.value = 1;
    count.value = 2;
    flushSync();
    expect(runs).toBe(1);
  });

  it('does not run a queued effect that was stopped before the flush', () => {
    const count = ref(0);
    let runs = 0;
    const handle = effect(() => {
      void count.value;
      runs++;
    });
    count.value = 1;
    handle.stop();
    flushSync();
    expect(runs).toBe(1);
  });

  it('pause defers updates and resume replays a single run', () => {
    const count = ref(0);
    const seen: number[] = [];
    const handle = effect(() => {
      seen.push(count.value);
    });
    handle.pause();
    count.value = 1;
    count.value = 2;
    flushSync();
    expect(seen).toEqual([0]);
    handle.resume();
    flushSync();
    expect(seen).toEqual([0, 2]);
  });

  it('supports a custom scheduler and dedupes within a batch', () => {
    const count = ref(0);
    const runs: number[] = [];
    const jobs: Array<() => void> = [];
    effect(
      () => {
        runs.push(count.value);
      },
      {
        scheduler: (run) => {
          jobs.push(run);
        },
      },
    );
    expect(runs).toEqual([0]);
    count.value = 1;
    count.value = 2;
    expect(jobs).toHaveLength(1);
    jobs[0]!();
    expect(runs).toEqual([0, 2]);
    count.value = 3;
    flushSync();
    // A custom scheduler owns the timing: `flushSync()` does not run its jobs.
    expect(runs).toEqual([0, 2]);
    jobs[1]!();
    expect(runs).toEqual([0, 2, 3]);
  });

  it('runs synchronously with flush: "sync"', () => {
    const count = ref(0);
    const seen: number[] = [];
    effect(
      () => {
        seen.push(count.value);
      },
      { flush: 'sync' },
    );
    count.value = 1;
    expect(seen).toEqual([0, 1]);
    count.value = 2;
    expect(seen).toEqual([0, 1, 2]);
  });

  it('re-runs a lazy effect only when its dependency changes', () => {
    const count = ref(0);
    let runs = 0;
    const handle = effect(
      () => {
        void count.value;
        runs++;
      },
      { lazy: true },
    );
    expect(runs).toBe(0);
    handle.run();
    expect(runs).toBe(1);
    flushSync();
    expect(runs).toBe(1);
    count.value = 1;
    flushSync();
    expect(runs).toBe(2);
  });
});

describe('nested effects', () => {
  it('tracks inner and outer dependencies', () => {
    const outer = ref(0);
    const inner = ref(0);
    const log: string[] = [];
    effect(() => {
      log.push(`outer ${outer.value}`);
      effect(() => {
        log.push(`inner ${inner.value}`);
      });
    });
    expect(log).toEqual(['outer 0', 'inner 0']);
    inner.value = 1;
    flushSync();
    expect(log).toEqual(['outer 0', 'inner 0', 'inner 1']);
    outer.value = 1;
    flushSync();
    expect(log).toEqual(['outer 0', 'inner 0', 'inner 1', 'outer 1', 'inner 1']);
  });

  it('does not leak the inner effect dependencies to the outer effect', () => {
    const outer = ref(0);
    const inner = ref(0);
    let outerRuns = 0;
    effect(() => {
      void outer.value;
      outerRuns++;
      effect(() => {
        void inner.value;
      });
    });
    inner.value = 1;
    flushSync();
    expect(outerRuns).toBe(1);
  });
});

describe('untrack', () => {
  it('reads values without creating a dependency', () => {
    const tracked = ref(0);
    const ignored = ref(0);
    let runs = 0;
    effect(() => {
      void tracked.value;
      untrack(() => ignored.value);
      runs++;
    });
    ignored.value = 1;
    flushSync();
    expect(runs).toBe(1);
    tracked.value = 1;
    flushSync();
    expect(runs).toBe(2);
  });

  it('returns the callback result and ignores reactive object reads too', () => {
    const state = reactive({ count: 0 });
    let runs = 0;
    const result = effect(() => {
      const value = untrack(() => state.count);
      runs++;
      return value;
    });
    expect(result).toBeDefined();
    state.count = 1;
    flushSync();
    expect(runs).toBe(1);
  });
});

describe('pauseTracking / resumeTracking', () => {
  it('suspends collection between the two calls', () => {
    const count = ref(0);
    let runs = 0;
    effect(() => {
      pauseTracking();
      void count.value;
      resumeTracking();
      runs++;
    });
    count.value = 1;
    flushSync();
    expect(runs).toBe(1);
  });

  it('nests pause levels', () => {
    const count = ref(0);
    let runs = 0;
    effect(() => {
      pauseTracking();
      pauseTracking();
      resumeTracking();
      void count.value;
      resumeTracking();
      runs++;
    });
    count.value = 1;
    flushSync();
    expect(runs).toBe(1);
  });
});

describe('nextTick', () => {
  it('resolves after the pending flush', async () => {
    const count = ref(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.value);
    });
    count.value = 1;
    await nextTick();
    expect(seen).toEqual([0, 1]);
  });
});
