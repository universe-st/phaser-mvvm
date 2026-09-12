/**
 * `Label`'s `size` option: the theme token → pixel resolution.
 *
 * The compose DSL documented `Text('标题', { size: 'xl' })` from the day it landed, but `size` only
 * ever existed on `Button`, so the option was silently ignored (the V13 shape: a key that compiles or
 * is documented, and that nothing reads). The resolution rule is small enough to test on its own —
 * notably "a token is looked up in the *current* theme", which is what keeps a theme switch working.
 */

import { describe, expect, it } from 'vitest';
import { resolveLabelFontSize } from '../src/text-padding';
import { TEST_THEME } from './fixture-theme';

describe('resolveLabelFontSize', () => {
  it('resolves a theme token against the scale it is given', () => {
    expect(resolveLabelFontSize('xl', TEST_THEME.fontSize)).toBe(26);
    expect(resolveLabelFontSize('sm', TEST_THEME.fontSize)).toBe(12);
  });

  it('takes the scale it is handed, so a theme switch re-sizes the text', () => {
    const doubled = { ...TEST_THEME.fontSize, md: 32 };
    expect(resolveLabelFontSize('md', doubled)).toBe(32);
  });

  it('keeps omitted/unknown/nonsense values on `md`', () => {
    expect(resolveLabelFontSize(undefined, TEST_THEME.fontSize)).toBe(16);
    expect(resolveLabelFontSize('huge', TEST_THEME.fontSize)).toBe(16);
    // A number is pixels, so it wins as soon as it is usable.
    expect(resolveLabelFontSize(40, TEST_THEME.fontSize)).toBe(40);
    expect(resolveLabelFontSize(0, TEST_THEME.fontSize)).toBe(16);
    expect(resolveLabelFontSize(Number.NaN, TEST_THEME.fontSize)).toBe(16);
    expect(resolveLabelFontSize(Number.POSITIVE_INFINITY, TEST_THEME.fontSize)).toBe(16);
  });
});
