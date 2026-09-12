/**
 * Integration coverage: a `makeObservable` ViewModel driving a rendered-ish sink through the
 * scheduler, the way the Phaser adapter is expected to use the kernel (mutate → frame flush →
 * layout/apply once per frame).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computed,
  configureScheduler,
  effect,
  effectScope,
  flushFrame,
  flushSync,
  makeObservable,
  nextTick,
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
  configureScheduler({});
});

describe('view-model integration', () => {
  class TodoList {
    title = 'todos';
    items: Array<{ text: string; done: boolean }> = [];
    filter: 'all' | 'done' = 'all';

    constructor() {
      makeObservable(this, { items: 'reactive' });
    }

    get visible(): Array<{ text: string; done: boolean }> {
      return this.items;
    }
  }

  it('derives view state from a ViewModel and applies it once per frame', () => {
    const vm = new TodoList();
    const applied: string[] = [];

    // A `frame` effect stands in for the renderer: it runs once per frame, never per write.
    const render = effect(
      () => {
        const visible = vm.items.filter((item) => vm.filter === 'all' || item.done);
        applied.push(visible.map((item) => item.text).join(','));
      },
      { flush: 'frame' },
    );

    vm.items.push({ text: 'a', done: false });
    vm.items.push({ text: 'b', done: true });
    vm.items[1]!.done = true;
    expect(applied).toEqual(['']);

    flushFrame();
    expect(applied).toEqual(['', 'a,b']);

    flushFrame();
    expect(applied).toEqual(['', 'a,b']);

    render.stop();
  });

  it('batches ViewModel writes into a single pre flush', async () => {
    const vm = new TodoList();
    const snapshots: number[] = [];
    effect(() => {
      snapshots.push(vm.items.length);
    });

    vm.items.push({ text: 'a', done: false });
    vm.items.push({ text: 'b', done: false });
    vm.items.splice(0, 1);
    await nextTick();
    expect(snapshots).toEqual([0, 1]);
  });

  it('keeps a computed, a watcher and a scope leak free together', () => {
    const vm = new TodoList();
    const remaining = computed(() => vm.items.filter((item) => !item.done).length);
    const scope = effectScope();
    const spy = vi.fn();

    scope.run(() => {
      watch(remaining, spy, { immediate: true });
      watchEffect(() => {
        void vm.title;
      });
    });

    expect(spy).toHaveBeenCalledWith(0, undefined, expect.any(Function));

    vm.items.push({ text: 'a', done: false });
    vm.items.push({ text: 'b', done: false });
    flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(2, 0, expect.any(Function));

    vm.items[0]!.done = true;
    flushSync();
    expect(spy).toHaveBeenLastCalledWith(1, 2, expect.any(Function));

    scope.stop();
    const calls = spy.mock.calls.length;
    vm.items[0]!.done = false;
    flushSync();
    expect(spy).toHaveBeenCalledTimes(calls);
  });

  it('supports the host taking over scheduling for the game loop', () => {
    const hostQueue: Array<() => void> = [];
    configureScheduler({ schedulePreFlush: (flush) => hostQueue.push(flush) });

    const vm = new TodoList();
    const applied: number[] = [];
    effect(() => {
      applied.push(vm.items.length);
    });

    vm.items.push({ text: 'a', done: false });
    vm.items.push({ text: 'b', done: false });
    expect(applied).toEqual([0]);
    expect(hostQueue).toHaveLength(1);

    // The render layer drains the host queue at its fixed per-frame point.
    hostQueue.shift()!();
    expect(applied).toEqual([0, 2]);

    configureScheduler({});
  });

  it('mixes reactive() state and refs without cross-triggering', () => {
    const app = reactive({ page: 'home', user: { name: 'ada' } });
    const theme = ref('dark');
    const renderLog: string[] = [];

    effect(
      () => {
        renderLog.push(`${app.page}/${theme.value}`);
      },
      { flush: 'sync' },
    );

    app.user.name = 'grace';
    expect(renderLog).toEqual(['home/dark']);

    theme.value = 'light';
    expect(renderLog).toEqual(['home/dark', 'home/light']);

    app.page = 'settings';
    expect(renderLog).toEqual(['home/dark', 'home/light', 'settings/light']);
  });
});
