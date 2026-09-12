/**
 * Tests for the typed model bindings (`bindValueModel` / `bindNumberModel` / `bindBooleanModel`).
 *
 * `binding.ts` is Node-safe on purpose (Phaser is imported as types only), so the contract that matters
 * can be pinned here instead of in the browser: a programmatic write must stay *silent* (otherwise the
 * down and up directions would ping-pong forever, ADR-0008 §5), a user change writes back once, and
 * stopping the binding detaches both directions.
 */

import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from '@phaser-mvvm/core';
import {
  MODEL_CHANGE_EVENT,
  bindBooleanModel,
  bindNumberModel,
  bindValueModel,
} from '../src/binding';

/** A minimal control: a value, a silent `setValue`, and Phaser-style `on`/`off` bookkeeping. */
function fakeHost<T>(initial: T) {
  const listeners = new Set<(value: T) => void>();
  const host = {
    // A real `EffectScope` (what `Widget` uses) so the fake satisfies `BindingScope` for real.
    scope: effectScope(true),
    value: initial,
    silentWrites: 0,
    getValue(): T {
      return host.value;
    },
    setValue(next: T): void {
      host.silentWrites += 1;
      host.value = next;
    },
    on(event: string, callback: (value: T) => void): void {
      if (event === MODEL_CHANGE_EVENT) {
        listeners.add(callback);
      }
    },
    off(event: string, callback: (value: T) => void): void {
      if (event === MODEL_CHANGE_EVENT) {
        listeners.delete(callback);
      }
    },
    /** Simulates the user flipping the control: emits `change` exactly like the widget would. */
    userChange(next: T): void {
      host.value = next;
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
    get listenerCount(): number {
      return listeners.size;
    },
  };
  return host;
}

describe('bindValueModel', () => {
  it('applies the model to the control on creation, through a silent write', () => {
    const host = fakeHost<boolean>(false);
    bindValueModel<boolean>(
      host,
      () => true,
      () => undefined,
    );
    // Silent means "no `change` event": that is what stops the down direction from looking like a user
    // edit and echoing back into the model (ADR-0008 §5).
    expect(host.getValue()).toBe(true);
    expect(host.silentWrites).toBe(1);
  });

  it('writes a user change back exactly once and never echoes it into the control', () => {
    const host = fakeHost<boolean>(false);
    let model = false;
    bindValueModel<boolean>(
      host,
      () => model,
      (next) => (model = next),
    );
    const writesAfterCreation = host.silentWrites;

    host.userChange(true);

    expect(model).toBe(true);
    // No ping-pong: the write-back must not trigger another silent write into the widget.
    expect(host.silentWrites).toBe(writesAfterCreation);
  });

  it('pushes a later model change into the control (ref → widget)', () => {
    // The model has to be *reactive* for the down direction to re-run; a plain local variable would
    // never notify the binding, which is exactly what `flush: 'sync'` is here to make observable.
    const host = fakeHost<boolean>(false);
    const model = ref(false);
    bindValueModel<boolean>(
      host,
      () => model.value,
      (next) => (model.value = next),
      { flush: 'sync' },
    );
    expect(host.getValue()).toBe(false);

    model.value = true;

    expect(host.getValue()).toBe(true);
  });

  it('does not write back a value the model already has', () => {
    const host = fakeHost<number>(5);
    const write = vi.fn();
    bindNumberModel(host, () => 5, write);
    host.userChange(5);
    expect(write).not.toHaveBeenCalled();
  });

  it('writes back exactly once per user change', () => {
    const host = fakeHost<boolean>(false);
    const write = vi.fn();
    bindBooleanModel(host, () => false, write);
    host.userChange(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(true);
  });

  it('detaches the listener when the binding is stopped', () => {
    const host = fakeHost<boolean>(false);
    const write = vi.fn();
    const stop = bindBooleanModel(host, () => false, write);
    expect(host.listenerCount).toBe(1);
    stop();
    expect(host.listenerCount).toBe(0);
    host.userChange(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps a numeric value numeric (the reason this is not `bindModel`)', () => {
    // `bindModel` stringifies: `setValue("42")` would put a string inside a numeric ref.
    const host = fakeHost<number>(0);
    const seen: unknown[] = [];
    bindNumberModel(
      host,
      () => 0,
      (next) => seen.push(next),
    );
    host.userChange(42);
    expect(seen).toEqual([42]);
    expect(typeof seen[0]).toBe('number');
  });
});
