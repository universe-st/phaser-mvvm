/**
 * The `Button` state machine: activation decisions, the painted state and the loading label.
 */

import { describe, expect, it } from 'vitest';
import { buttonLabel, resolveButtonActivation, resolveButtonState } from '../src/button-state';

describe('resolveButtonActivation', () => {
  it('runs onClick for a plain enabled button', () => {
    expect(resolveButtonActivation({ enabled: true })).toEqual({
      ignored: false,
      toggles: false,
      value: false,
      invokesClick: true,
      emitsChange: false,
    });
  });

  it('ignores activation when the button is disabled', () => {
    const decision = resolveButtonActivation({ enabled: false });
    expect(decision.ignored).toBe(true);
    expect(decision.invokesClick).toBe(false);
    expect(decision.emitsChange).toBe(false);
  });

  it('ignores activation while loading', () => {
    const decision = resolveButtonActivation({ enabled: true, loading: true });
    expect(decision.ignored).toBe(true);
    expect(decision.invokesClick).toBe(false);
  });

  it('lets loading win over toggle', () => {
    const decision = resolveButtonActivation({
      enabled: true,
      loading: true,
      toggle: true,
      value: false,
    });
    expect(decision.ignored).toBe(true);
    expect(decision.toggles).toBe(false);
    expect(decision.value).toBe(false);
  });

  it('flips a toggle from off to on and emits change instead of running onClick', () => {
    const decision = resolveButtonActivation({ enabled: true, toggle: true, value: false });
    expect(decision.toggles).toBe(true);
    expect(decision.value).toBe(true);
    expect(decision.emitsChange).toBe(true);
    expect(decision.invokesClick).toBe(false);
  });

  it('flips a toggle from on to off', () => {
    const decision = resolveButtonActivation({ enabled: true, toggle: true, value: true });
    expect(decision.value).toBe(false);
  });

  it('keeps the value when a non-toggle button is activated', () => {
    const decision = resolveButtonActivation({ value: true });
    expect(decision.value).toBe(true);
    expect(decision.toggles).toBe(false);
    expect(decision.emitsChange).toBe(false);
    expect(decision.invokesClick).toBe(true);
  });

  it('treats missing flags as an enabled, non-toggle, off button', () => {
    const decision = resolveButtonActivation();
    expect(decision.ignored).toBe(false);
    expect(decision.value).toBe(false);
    expect(decision.invokesClick).toBe(true);
  });
});

describe('resolveButtonState', () => {
  it('paints a loading button as disabled', () => {
    expect(resolveButtonState({ state: 'hover', loading: true })).toBe('disabled');
  });

  it('paints a toggle that is on as pressed while idle', () => {
    expect(resolveButtonState({ state: 'normal', toggle: true, value: true })).toBe('pressed');
  });

  it('keeps a toggle that is on looking pressed while it is focused', () => {
    expect(resolveButtonState({ state: 'focused', toggle: true, value: true })).toBe('pressed');
  });

  it('keeps the pointer state of a toggle that is on', () => {
    expect(resolveButtonState({ state: 'hover', toggle: true, value: true })).toBe('hover');
    expect(resolveButtonState({ state: 'pressed', toggle: true, value: true })).toBe('pressed');
  });

  it('leaves a toggle that is off alone', () => {
    expect(resolveButtonState({ state: 'normal', toggle: true, value: false })).toBe('normal');
  });

  it('passes disabled, error and focused through untouched', () => {
    expect(resolveButtonState({ state: 'disabled' })).toBe('disabled');
    expect(resolveButtonState({ state: 'error' })).toBe('error');
    expect(resolveButtonState({ state: 'focused' })).toBe('focused');
  });

  it('lets loading win over an on toggle', () => {
    expect(resolveButtonState({ state: 'normal', loading: true, toggle: true, value: true })).toBe(
      'disabled',
    );
  });
});

describe('buttonLabel', () => {
  it('appends an ellipsis while loading', () => {
    expect(buttonLabel('Save', true)).toBe('Save\u2026');
  });

  it('returns the plain text when not loading', () => {
    expect(buttonLabel('Save', false)).toBe('Save');
  });

  it('shows only the ellipsis for an icon-only button that is loading', () => {
    expect(buttonLabel('', true)).toBe('\u2026');
  });
});
