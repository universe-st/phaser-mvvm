/**
 * The pure half of the DOM input bridge (`input-bridge.ts`) plus its Node safety.
 *
 * The judgements that matter for a Chinese/Japanese form — "may this `input` event reach the model?",
 * "how long may the value be?", "where does a selection clamp to?" — are plain functions, so they are
 * tested without a browser. The class itself is only checked for the behaviour that must hold in
 * Node: importing it is side-effect free, and without a Phaser DOM container it degrades to
 * `available === false` instead of throwing.
 */

import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOM_CONTAINER_WARNING,
  DomInputBridge,
  clampSelection,
  clampValue,
  resetBridgeWarning,
  shouldEmitInput,
} from '../src/input-bridge';

const EMOJI = '\u{1F600}'; // 😀 — one code point, two UTF-16 code units

afterEach(() => {
  vi.restoreAllMocks();
  resetBridgeWarning();
});

describe('shouldEmitInput', () => {
  it('rejects an input event while a composition is open', () => {
    expect(shouldEmitInput(true)).toBe(false);
  });

  it('accepts an input event once the composition ended', () => {
    expect(shouldEmitInput(false)).toBe(true);
  });
});

describe('clampValue', () => {
  it('keeps the value when no limit is configured', () => {
    expect(clampValue('abcdef')).toBe('abcdef');
    expect(clampValue('abcdef', null)).toBe('abcdef');
  });

  it('cuts the value at the limit', () => {
    expect(clampValue('abcdef', 3)).toBe('abc');
    expect(clampValue('abcdef', 6)).toBe('abcdef');
  });

  it('allows nothing at all for a limit of zero', () => {
    expect(clampValue('abc', 0)).toBe('');
  });

  it('treats a negative or non-finite limit as "no limit"', () => {
    expect(clampValue('abc', -1)).toBe('abc');
    expect(clampValue('abc', Number.NaN)).toBe('abc');
    expect(clampValue('abc', Number.POSITIVE_INFINITY)).toBe('abc');
  });

  it('never cuts a surrogate pair in half', () => {
    const value = `abc${EMOJI}${EMOJI}`;
    expect(clampValue(value, 4)).toBe(`abc${EMOJI}`);
    expect(clampValue(value, 5)).toBe(value);
  });

  it('counts an emoji as one character', () => {
    // Two code points, four code units: a naive slice would keep 1.5 characters.
    expect(clampValue(`${EMOJI}${EMOJI}`, 1)).toBe(EMOJI);
  });
});

describe('clampSelection', () => {
  it('clamps both offsets into the value length', () => {
    expect(clampSelection(-3, 99, 5)).toEqual({ start: 0, end: 5 });
  });

  it('orders a reversed pair', () => {
    expect(clampSelection(4, 1, 10)).toEqual({ start: 1, end: 4 });
  });

  it('treats a non-finite offset as zero', () => {
    expect(clampSelection(Number.NaN, Number.NaN, 10)).toEqual({ start: 0, end: 0 });
  });

  it('collapses onto an empty value', () => {
    expect(clampSelection(2, 5, 0)).toEqual({ start: 0, end: 0 });
  });

  it('keeps a selection that is already valid', () => {
    expect(clampSelection(2, 4, 10)).toEqual({ start: 2, end: 4 });
  });
});

describe('DomInputBridge without a DOM container', () => {
  /** The bridge only reads `scene.sys.game`; nothing else of the Scene is touched before `place()`. */
  function fakeScene(domContainer: HTMLElement | null = null): Phaser.Scene {
    return { sys: { game: { domContainer, canvas: null } } } as unknown as Phaser.Scene;
  }

  it('reports itself unavailable instead of throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bridge = new DomInputBridge(fakeScene());
    expect(bridge.available).toBe(false);
    expect(bridge.element).toBeNull();
    expect(bridge.isAttached).toBe(false);
  });

  it('warns exactly once about the missing container', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new DomInputBridge(fakeScene());
    new DomInputBridge(fakeScene());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(DOM_CONTAINER_WARNING);
  });

  it('keeps the documented warning text', () => {
    expect(DOM_CONTAINER_WARNING).toBe('[phaser-mvvm] TextField 需要 dom.createContainer: true');
  });

  it('no-ops every DOM operation while detached', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bridge = new DomInputBridge(fakeScene());
    expect(() => {
      bridge.attach();
      bridge.focus();
      bridge.blur();
      bridge.setValue('abc');
      bridge.setSelection(0, 1);
      bridge.setEnabled(false);
      bridge.setReadOnly(true);
      bridge.setMaxLength(4);
      bridge.setSecure(true);
      bridge.place({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 });
      bridge.detach();
      bridge.dispose();
    }).not.toThrow();
    expect(bridge.getValue()).toBe('');
    expect(bridge.canvasRect).toBeNull();
    expect(bridge.isComposing).toBe(false);
  });
});
