/**
 * The text input's theme-driven background (`textInputSkinStyles`).
 *
 * The point of these cases is the contract the widgets rely on: no literal colour anywhere, an
 * `error` state that uses `danger` (and therefore outranks focus, see `resolveWidgetState`), and a
 * `readOnly` field that is visibly different from an editable one.
 */

import { describe, expect, it } from 'vitest';
import { textInputSkinStyles } from '../src/appearance';
import { TEST_THEME } from './fixture-theme';

describe('textInputSkinStyles', () => {
  it('paints a bordered surface box in the normal state', () => {
    const styles = textInputSkinStyles(TEST_THEME);
    expect(styles.normal?.fill).toBe(TEST_THEME.colors.surface);
    expect(styles.normal?.border).toBe(TEST_THEME.colors.border);
    expect(styles.normal?.radius).toBe(TEST_THEME.radius.sm);
  });

  it('strengthens the border on hover and on press without changing the fill', () => {
    const styles = textInputSkinStyles(TEST_THEME);
    expect(styles.hover?.border).toBe(TEST_THEME.colors.borderStrong);
    expect(styles.pressed?.border).toBe(TEST_THEME.colors.borderStrong);
    expect(styles.hover?.fill).toBe(styles.normal?.fill);
  });

  it('uses the focus ring token when the field is focused', () => {
    expect(textInputSkinStyles(TEST_THEME).focused?.border).toBe(TEST_THEME.colors.focusRing);
  });

  it('uses the danger token for the error state', () => {
    const styles = textInputSkinStyles(TEST_THEME);
    expect(styles.error?.border).toBe(TEST_THEME.colors.danger);
    expect(styles.error?.fill).toBe(TEST_THEME.colors.surface);
  });

  it('gives every state its own entry, so an error cannot fall back to the focus ring', () => {
    // The widget paints from `visualState`; `error` wins over `focused` there (widget-state.ts), and
    // this map is what makes that visible on screen.
    const styles = textInputSkinStyles(TEST_THEME);
    expect(styles.error?.border).not.toBe(styles.focused?.border);
  });

  it('uses the disabled tokens when the field cannot be edited', () => {
    const styles = textInputSkinStyles(TEST_THEME);
    expect(styles.disabled?.fill).toBe(TEST_THEME.colors.surfaceAlt);
    expect(styles.disabled?.border).toBe(TEST_THEME.colors.border);
  });

  it('mutes a read-only field so it is recognisable', () => {
    expect(textInputSkinStyles(TEST_THEME, TEST_THEME.radius.sm, true).normal?.fill).toBe(
      TEST_THEME.colors.surfaceAlt,
    );
  });
});
