/**
 * Tests for the reactive-argument rules of the Compose-style DSL.
 *
 * `Text(() => vm.title.value)` and `Text(vm.title)` differ only in which shape the slot received, so
 * the three shapes — constant, `Ref`, getter — and the write-back rule are pinned down here, in plain
 * Node, rather than discovered through a scene.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ref, resetDevWarnings, setDevMode } from '@phaser-mvvm/core';
import {
  isReactiveSource,
  isWritableSource,
  readReactive,
  sourceGetter,
  writeReactive,
} from '../src/reactive-source';

beforeEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

afterEach(() => {
  setDevMode(true);
  resetDevWarnings();
});

describe('reactive arguments', () => {
  it('treats a constant as not reactive, so no binding is created', () => {
    expect(isReactiveSource('保存')).toBe(false);
    expect(isReactiveSource(0)).toBe(false);
    expect(readReactive('保存')).toBe('保存');
    expect(readReactive(0)).toBe(0);
  });

  it('recognises refs and getters as reactive', () => {
    expect(isReactiveSource(ref('a'))).toBe(true);
    expect(isReactiveSource(() => 'a')).toBe(true);
  });

  it('reads the current value of every shape', () => {
    const count = ref(2);
    expect(readReactive(count)).toBe(2);
    expect(readReactive(() => count.value * 3)).toBe(6);
    expect(readReactive('text')).toBe('text');
  });

  it('wraps a source into a getter that stays live', () => {
    const title = ref('first');
    const get = sourceGetter(title);
    expect(get()).toBe('first');
    title.value = 'second';
    expect(get()).toBe('second');
  });

  it('reports only refs as writable, and writes through them', () => {
    const title = ref('first');
    expect(isWritableSource(title)).toBe(true);
    writeReactive(title, 'second');
    expect(title.value).toBe('second');

    const getter = (): string => 'fixed';
    expect(isWritableSource(getter)).toBe(false);
  });

  it('warns instead of silently dropping a write to a getter', () => {
    const messages: string[] = [];
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    try {
      writeReactive(() => 'fixed', 'ignored');
    } finally {
      console.warn = original;
    }
    messages.push(...warnings);
    expect(messages.join('\n')).toMatch(/getter is read-only/);
  });

  it('stays silent about a dropped write once dev mode is off', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    try {
      setDevMode(false);
      writeReactive(() => 'fixed', 'ignored');
    } finally {
      console.warn = original;
    }
    expect(warnings).toEqual([]);
  });
});
