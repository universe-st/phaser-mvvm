/**
 * A minimal slice of the binding layer (PLAN §4.4, milestone M6) that the M4 widget library and the
 * demos need: pull-based bindings that keep a widget property in sync with reactive state.
 *
 * Design:
 * - every binding runs as an `effect` owned by the target widget's `scope`, so destroying the widget
 *   stops its bindings (no stale subscribers, no manual bookkeeping);
 * - the default flush mode is `'frame'`: the scene plugin calls `flushFrame()` once per frame before
 *   layout, so N state changes in a frame cost exactly one repaint and one layout pass (ADR-0008);
 * - bindings are pull-through: the getter is evaluated on every run, and the applied value is written
 *   only when it differs, which keeps two-way-ish flows from oscillating.
 *
 * `repeat`/virtualisation and the template compiler remain M6 work; this module deliberately stays
 * small and dependency-free.
 */

import { effect, type EffectHandle } from '@phaser-mvvm/core';
import type { Widget } from './Widget';

export type BindingFlush = 'sync' | 'pre' | 'post' | 'frame';

export interface BindingOptions {
  flush?: BindingFlush;
}

export type StopBinding = () => void;

/**
 * Runs `apply(read())` inside `host.scope`, immediately and then whenever the reactive state read by
 * `read` changes. Returns a stop function (the widget's destruction also stops it).
 */
export function bindValue<T>(
  host: Widget,
  read: () => T,
  apply: (value: T, host: Widget) => void,
  options: BindingOptions = {},
): StopBinding {
  const handle: EffectHandle = effect(
    () => {
      apply(read(), host);
    },
    { scope: host.scope, flush: options.flush ?? 'frame' },
  );
  return () => handle.stop();
}

/** Binds a label's text (works with anything exposing `setText`). */
export function bindText(
  host: Widget & { setText(value: string): unknown },
  read: () => string,
  options: BindingOptions = {},
): StopBinding {
  return bindValue(
    host,
    read,
    (value, widget) => {
      (widget as Widget & { setText(v: string): unknown }).setText(String(value ?? ''));
    },
    options,
  );
}

/** Binds visibility through the layout engine (hidden widgets collapse out of the flow). */
export function bindVisible(
  host: Widget,
  read: () => boolean,
  options: BindingOptions = {},
): StopBinding {
  return bindValue(
    host,
    read,
    (value, widget) => {
      widget.setVisible(value !== false);
    },
    options,
  );
}

/** Binds the enabled state (drives the `disabled` visual state and input handling). */
export function bindEnabled(
  host: Widget,
  read: () => boolean,
  options: BindingOptions = {},
): StopBinding {
  return bindValue(
    host,
    read,
    (value, widget) => {
      widget.setEnabled(value !== false);
    },
    options,
  );
}

/** Binds an error/validation state (drives the `error` visual state). */
export function bindError(
  host: Widget,
  read: () => boolean,
  options: BindingOptions = {},
): StopBinding {
  return bindValue(
    host,
    read,
    (value, widget) => {
      widget.setError(value === true);
    },
    options,
  );
}

export interface CommandBindingOptions extends BindingOptions {
  /** When it returns `false` the host is disabled (`canExecute` semantics). */
  canExecute?: () => boolean;
}

/**
 * Binds an activation callback to a command getter.
 *
 * `read` returns the command to run (or `null`/`undefined` for "nothing to do"); when `canExecute`
 * is provided the host's enabled state follows it. Any pre-existing `onActivate` handler is chained,
 * not replaced.
 */
export function bindCommand(
  host: Widget,
  read: () => ((...args: unknown[]) => unknown) | null | undefined,
  options: CommandBindingOptions = {},
): StopBinding {
  const previous = host.onActivate;
  host.onActivate = (source) => {
    previous?.(source);
    const command = read();
    command?.();
  };

  let stopCanExecute: StopBinding | null = null;
  if (options.canExecute) {
    const canExecute = options.canExecute;
    stopCanExecute = bindEnabled(host, canExecute, options);
  }

  return () => {
    stopCanExecute?.();
    if (host.onActivate !== null) {
      host.onActivate = previous;
    }
  };
}
