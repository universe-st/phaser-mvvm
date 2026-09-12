/**
 * Theme registry and the widget state machine.
 *
 * Both modules are deliberately free of Phaser imports, so they run in plain Node — which is why the
 * adapter package can have real unit tests before any DOM/WebGL exists.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_THEMES,
  DARK_THEME,
  LIGHT_THEME,
  getTheme,
  onThemeChange,
  setTheme,
  themeListenerCount,
  type ThemeColorName,
} from '../src/theme';
import { resolveWidgetState } from '../src/widget-state';

const COLOR_KEYS: ThemeColorName[] = [
  'background',
  'surface',
  'surfaceAlt',
  'surfaceHover',
  'overlay',
  'primary',
  'primaryHover',
  'primaryPressed',
  'onPrimary',
  'text',
  'textMuted',
  'textDisabled',
  'border',
  'borderStrong',
  'danger',
  'success',
  'warning',
  'focusRing',
];

describe('theme tokens', () => {
  beforeEach(() => {
    setTheme('dark');
  });

  it('exposes every semantic colour in both built-in themes', () => {
    for (const theme of [DARK_THEME, LIGHT_THEME]) {
      for (const key of COLOR_KEYS) {
        expect(typeof theme.colors[key], `${theme.name}.${key}`).toBe('number');
      }
    }
  });

  it('keeps the typography and spacing scales aligned between themes', () => {
    expect(LIGHT_THEME.fontSize).toEqual(DARK_THEME.fontSize);
    expect(LIGHT_THEME.spacing).toEqual(DARK_THEME.spacing);
    expect(LIGHT_THEME.controlHeight).toEqual(DARK_THEME.controlHeight);
    expect(LIGHT_THEME.radius).toEqual(DARK_THEME.radius);
  });

  it('uses genuinely different palettes for dark and light', () => {
    expect(DARK_THEME.colors.background).not.toBe(LIGHT_THEME.colors.background);
    expect(DARK_THEME.colors.text).not.toBe(LIGHT_THEME.colors.text);
    expect(DARK_THEME.colors.surface).not.toBe(LIGHT_THEME.colors.surface);
  });

  it('defaults to the dark theme', () => {
    expect(getTheme().name).toBe('dark');
    expect(BUILT_IN_THEMES.dark).toBe(DARK_THEME);
  });

  it('switches by name and by object', () => {
    expect(setTheme('light')).toBe(LIGHT_THEME);
    expect(getTheme()).toBe(LIGHT_THEME);
    expect(setTheme(DARK_THEME)).toBe(DARK_THEME);
    expect(getTheme()).toBe(DARK_THEME);
  });

  it('ignores a switch to the theme that is already active', () => {
    const listener = vi.fn();
    const stop = onThemeChange(listener);
    setTheme('dark');
    setTheme('dark');
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('rejects an unknown theme name', () => {
    // @ts-expect-error deliberately invalid at the type level as well
    expect(() => setTheme('neon')).toThrow(/unknown theme/);
  });

  it('notifies every listener with the new theme', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onThemeChange(first);
    const stopSecond = onThemeChange(second);

    setTheme('light');

    expect(first).toHaveBeenCalledWith(LIGHT_THEME);
    expect(second).toHaveBeenCalledWith(LIGHT_THEME);

    stopFirst();
    stopSecond();
    expect(themeListenerCount()).toBe(0);
  });

  it('unsubscribes idempotently', () => {
    const listener = vi.fn();
    const stop = onThemeChange(listener);
    stop();
    stop();
    setTheme('light');
    expect(listener).not.toHaveBeenCalled();
    expect(themeListenerCount()).toBe(0);
  });

  it('keeps notifying the remaining listeners after one unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onThemeChange(first);
    const stopSecond = onThemeChange(second);

    stopFirst();
    setTheme('light');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
  });

  it('survives a listener unsubscribing itself during a notification', () => {
    const order: string[] = [];
    const stop = onThemeChange(() => {
      order.push('self-removing');
      stop();
    });
    const second = onThemeChange(() => order.push('second'));

    setTheme('light');

    expect(order).toEqual(['self-removing', 'second']);
    second();
  });
});

describe('widget state machine', () => {
  it('is normal with no flags', () => {
    expect(resolveWidgetState({})).toBe('normal');
  });

  it('maps each single flag', () => {
    expect(resolveWidgetState({ hovered: true })).toBe('hover');
    expect(resolveWidgetState({ pressed: true })).toBe('pressed');
    expect(resolveWidgetState({ focused: true })).toBe('focused');
    expect(resolveWidgetState({ error: true })).toBe('error');
    expect(resolveWidgetState({ enabled: false })).toBe('disabled');
  });

  it('lets disabled win over everything', () => {
    expect(
      resolveWidgetState({
        enabled: false,
        pressed: true,
        hovered: true,
        focused: true,
        error: true,
      }),
    ).toBe('disabled');
  });

  it('lets error outrank focus and pointer states', () => {
    expect(resolveWidgetState({ error: true, focused: true })).toBe('error');
    expect(resolveWidgetState({ error: true, pressed: true })).toBe('error');
  });

  it('lets pressed outrank hover, and hover outrank focus', () => {
    expect(resolveWidgetState({ pressed: true, hovered: true })).toBe('pressed');
    expect(resolveWidgetState({ hovered: true, focused: true })).toBe('hover');
  });

  it('treats explicit false flags as inactive', () => {
    expect(
      resolveWidgetState({
        enabled: true,
        hovered: false,
        pressed: false,
        focused: false,
        error: false,
      }),
    ).toBe('normal');
  });
});
