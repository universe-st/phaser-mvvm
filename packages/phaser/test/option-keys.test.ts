/**
 * The option audit, without a scene.
 *
 * These cases are the contract the demos rely on: a typo must be *reported* (so the sweep over every
 * option in the library can assert silence), the report must be specific enough to be useful, and a
 * legitimate key must never be reported — a false positive would train users to ignore the warning.
 */

import { describe, expect, it } from 'vitest';
import { LAYOUT_PARAM_KEYS } from '@phaser-mvvm/layout';
import { BASE_WIDGET_OPTION_KEYS, suggestOptionKey, unknownOptionKeys } from '../src/option-keys';

/** A stand-in for a widget's own keys. */
const BUTTON_KEYS = ['text', 'variant', 'size', 'disabled', 'loading', 'toggle', 'onClick'];

describe('unknownOptionKeys', () => {
  it('accepts the widget keys, the layout params and the base options', () => {
    expect(
      unknownOptionKeys(
        { text: 'ok', padding: 8, width: 'fill', name: 'a', visible: true, focusOrder: 2 },
        BUTTON_KEYS,
      ),
    ).toEqual([]);
  });

  it('reports a mistyped key', () => {
    expect(unknownOptionKeys({ tekst: 'typo' }, BUTTON_KEYS)).toEqual(['tekst']);
  });

  it('ignores keys whose value is undefined, like the split itself does', () => {
    expect(unknownOptionKeys({ width: undefined, nope: undefined }, BUTTON_KEYS)).toEqual([]);
  });

  it('reports every unknown key, sorted, and only once each', () => {
    expect(unknownOptionKeys({ zebra: 1, apple: 2, text: 'ok' }, BUTTON_KEYS)).toEqual([
      'apple',
      'zebra',
    ]);
  });

  it('covers every layout param (the list is the source of truth)', () => {
    const bag: Record<string, unknown> = {};
    for (const key of LAYOUT_PARAM_KEYS) {
      bag[key] = 1;
    }
    expect(unknownOptionKeys(bag, [])).toEqual([]);
    // …and the list itself has no duplicates, which would make the set misleading.
    expect(new Set(LAYOUT_PARAM_KEYS).size).toBe(LAYOUT_PARAM_KEYS.length);
  });
});

describe('suggestOptionKey', () => {
  it('suggests the same key in the right case', () => {
    expect(suggestOptionKey('maxlength', ['maxLength', 'minLength'])).toBe('maxLength');
    expect(suggestOptionKey('alignself', ['alignSelf', 'alignItems'])).toBe('alignSelf');
  });

  it('suggests the closest key for a transposition or a missing letter', () => {
    expect(suggestOptionKey('pading', ['padding', 'margin'])).toBe('padding');
    expect(suggestOptionKey('widht', ['width', 'height'])).toBe('width');
    expect(suggestOptionKey('justifycontent', ['justifyContent', 'alignContent'])).toBe(
      'justifyContent',
    );
  });

  it('says nothing rather than guessing between two equally close keys', () => {
    // `blah` is one edit from both, and neither contains the other, so there is no obvious answer.
    expect(suggestOptionKey('blah', ['blam', 'blat'])).toBeNull();
    // A prefix, on the other hand, is unambiguous and is suggested.
    expect(suggestOptionKey('widt', ['width', 'withe'])).toBe('width');
  });

  it('says nothing when the key is not close to anything', () => {
    expect(suggestOptionKey('zebra', ['padding', 'width'])).toBeNull();
  });

  it('keeps the distance threshold tight for short keys', () => {
    // One edit is still a typo: `grov` → `grow`.
    expect(suggestOptionKey('grov', ['grow', 'shrink'])).toBe('grow');
    // Two edits on a short key is not: guessing there would be noise, not help.
    expect(suggestOptionKey('wa', ['max', 'min'])).toBeNull();
  });

  it('maps a prefix of a longer key when it is unambiguous', () => {
    expect(suggestOptionKey('align', ['alignSelf'])).toBe('alignSelf');
  });

  it('has the base option keys available to the caller', () => {
    expect(BASE_WIDGET_OPTION_KEYS).toContain('focusOrder');
  });
});
