import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureScheduler,
  effect,
  flushFrame,
  flushSync,
  hasPendingFrameJobs,
  hasPendingJobs,
  nextTick,
  onDevWarning,
  ref,
  resetDevWarnings,
  setDevMode,
  watch,
} from '../src/index';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

afterEach(() => {
  configureScheduler({});
  flushSync();
  flushFrame();
});

describe('batching', () => {
  it('runs each effect once per batch no matter how many writes happened', () => {
    const a = ref(0);
    const b = ref(0);
    let runs = 0;
    effect(() => {
      void a.value;
      void b.value;
      runs++;
    });
    a.value = 1;
    b.value = 1;
    a.value = 2;
    b.value = 2;
    expect(runs).toBe(1);
    flushSync();
    expect(runs).toBe(2);
  });

  it('flushSync drains pending pre and post jobs', () => {
    const count = ref(0);
    const order: string[] = [];
    effect(() => {
      void count.value;
      order.push('pre');
    });
    effect(
      () => {
        void count.value;
        order.push('post');
      },
      { flush: 'post' },
    );
    order.length = 0;
    count.value = 1;
    flushSync();
    expect(order).toEqual(['pre', 'post']);
  });

  it('sync effects run while the batch is still open', () => {
    const count = ref(0);
    const order: string[] = [];
    effect(
      () => {
        void count.value;
        order.push('sync');
      },
      { flush: 'sync' },
    );
    effect(() => {
      void count.value;
      order.push('pre');
    });
    order.length = 0;
    count.value = 1;
    expect(order).toEqual(['sync']);
    flushSync();
    expect(order).toEqual(['sync', 'pre']);
  });

  it('runs updates produced during a flush after the current queue', () => {
    const first = ref(0);
    const second = ref(0);
    const order: string[] = [];
    effect(() => {
      order.push(`first ${first.value}`);
      if (first.value === 1) second.value = 1;
    });
    effect(() => {
      order.push(`second ${second.value}`);
    });
    order.length = 0;
    first.value = 1;
    flushSync();
    expect(order).toEqual(['first 1', 'second 1']);
  });
});

describe('flushFrame', () => {
  it('runs frame jobs only', () => {
    const count = ref(0);
    const calls: string[] = [];
    effect(() => {
      void count.value;
      calls.push('pre');
    });
    effect(
      () => {
        void count.value;
        calls.push('frame');
      },
      { flush: 'frame' },
    );
    calls.length = 0;
    count.value = 1;
    flushSync();
    expect(calls).toEqual(['pre']);
    expect(hasPendingFrameJobs()).toBe(true);
    flushFrame();
    expect(calls).toEqual(['pre', 'frame']);
    expect(hasPendingFrameJobs()).toBe(false);
  });

  it('coalesces several frame writes into one run', () => {
    const count = ref(0);
    let runs = 0;
    effect(
      () => {
        void count.value;
        runs++;
      },
      { flush: 'frame' },
    );
    expect(runs).toBe(1);
    count.value = 1;
    count.value = 2;
    flushFrame();
    expect(runs).toBe(2);
  });

  it('is a no-op when nothing is queued', () => {
    expect(() => flushFrame()).not.toThrow();
  });
});

describe('nextTick', () => {
  it('resolves after the batch has flushed', async () => {
    const count = ref(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.value);
    });
    count.value = 1;
    expect(hasPendingJobs()).toBe(true);
    await nextTick();
    expect(seen).toEqual([0, 1]);
    expect(hasPendingJobs()).toBe(false);
  });

  it('resolves immediately when nothing is queued', async () => {
    await expect(nextTick()).resolves.toBeUndefined();
  });

  it('waits for updates cascaded during the flush', async () => {
    const a = ref(0);
    const b = ref(0);
    const seen: string[] = [];
    effect(() => {
      seen.push(`a ${a.value}`);
      b.value = a.value * 2;
    });
    effect(() => {
      seen.push(`b ${b.value}`);
    });
    seen.length = 0;
    a.value = 1;
    await nextTick();
    expect(seen).toEqual(['a 1', 'b 2']);
  });
});

describe('configureScheduler', () => {
  it('lets the host drive the pre lane', () => {
    const flushes: Array<() => void> = [];
    configureScheduler({
      schedulePreFlush: (flush) => flushes.push(flush),
    });
    const count = ref(0);
    let runs = 0;
    effect(() => {
      void count.value;
      runs++;
    });
    count.value = 1;
    expect(runs).toBe(1);
    expect(flushes).toHaveLength(1);
    flushes[0]!();
    expect(runs).toBe(2);
  });

  it('lets the host drive the post lane separately', () => {
    const preFlushes: Array<() => void> = [];
    const postFlushes: Array<() => void> = [];
    configureScheduler({
      schedulePreFlush: (flush) => preFlushes.push(flush),
      schedulePostFlush: (flush) => postFlushes.push(flush),
    });
    const count = ref(0);
    const order: string[] = [];
    effect(() => {
      void count.value;
      order.push('pre');
    });
    effect(
      () => {
        void count.value;
        order.push('post');
      },
      { flush: 'post' },
    );
    order.length = 0;
    count.value = 1;
    preFlushes[0]!();
    expect(order).toEqual(['pre']);
    expect(postFlushes).toHaveLength(1);
    postFlushes[0]!();
    expect(order).toEqual(['pre', 'post']);
  });

  it('restores the microtask default when hooks are cleared', async () => {
    const preFlushes: Array<() => void> = [];
    configureScheduler({ schedulePreFlush: (flush) => preFlushes.push(flush) });
    configureScheduler({});
    const count = ref(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.value);
    });
    count.value = 1;
    expect(preFlushes).toHaveLength(0);
    await nextTick();
    expect(seen).toEqual([0, 1]);
  });

  it('keeps each lane coalesced into one host callback per batch', () => {
    const flushes: Array<() => void> = [];
    configureScheduler({ schedulePreFlush: (flush) => flushes.push(flush) });
    const a = ref(0);
    const b = ref(0);
    effect(() => {
      void a.value;
    });
    effect(() => {
      void b.value;
    });
    a.value = 1;
    b.value = 1;
    a.value = 2;
    expect(flushes).toHaveLength(1);
  });
});

describe('error handling', () => {
  it('re-throws an effect error after the whole flush ran', () => {
    const boom = ref(0);
    const other = ref(0);
    const seen: string[] = [];
    effect(() => {
      if (boom.value > 0) throw new Error('boom');
    });
    effect(() => {
      void other.value;
      seen.push('other');
    });
    seen.length = 0;
    other.value = 1;
    boom.value = 1;
    expect(() => flushSync()).toThrow('boom');
    // Sibling jobs still ran even though one of them threw.
    expect(seen).toEqual(['other']);
  });

  it('reports cyclic updates in the pre lane with a clear error', () => {
    const off = onDevWarning(() => {});
    const count = ref(0);
    effect(() => {
      count.value = count.value + 1;
    });
    expect(() => flushSync()).toThrow(/Maximum recursive updates/);
    off();
  });

  it('reports cyclic updates for sync effects', () => {
    const off = onDevWarning(() => {});
    const count = ref(0);
    expect(() => {
      effect(
        () => {
          count.value = count.value + 1;
        },
        { flush: 'sync' },
      );
    }).toThrow(/Maximum recursive updates/);
    off();
  });

  it('reports a cyclic cascade between two batch effects', () => {
    const off = onDevWarning(() => {});
    const a = ref(0);
    const b = ref(0);
    effect(() => {
      b.value = a.value + 1;
    });
    effect(() => {
      a.value = b.value + 1;
    });
    expect(() => flushSync()).toThrow(/Maximum recursive updates/);
    off();
  });

  it('allows a bounded write back into a dependency', () => {
    const count = ref(0);
    effect(() => {
      if (count.value < 3) count.value++;
    });
    flushSync();
    expect(count.value).toBe(3);
  });

  it('keeps the scheduler usable after a cyclic update error', () => {
    const off = onDevWarning(() => {});
    const count = ref(0);
    effect(() => {
      count.value = count.value + 1;
    });
    expect(() => flushSync()).toThrow();
    off();

    const fresh = ref(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(fresh.value);
    });
    fresh.value = 1;
    flushSync();
    expect(seen).toEqual([0, 1]);
  });

  it('does not notify an effect stopped during the same flush', () => {
    const count = ref(0);
    const spy = vi.fn();
    const stop = watch(count, spy);
    count.value = 1;
    stop.stop();
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });
});
