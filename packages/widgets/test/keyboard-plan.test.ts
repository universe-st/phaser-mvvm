/**
 * The keyboard's tables and state machine, without a renderer.
 *
 * Why these tests exist: the widget is 33 keys × two pages × three case states, and the *interesting*
 * behaviour (shift is a one-shot, a second press locks it, the symbols page has no shift key, every
 * character a page claims is reachable) is invisible in a screenshot and expensive in a browser run.
 * The widget class delegates exactly these decisions to `keyboard-plan.ts`, so pinning them here is what
 * makes the browser acceptance about input paths rather than about string tables.
 */

import { describe, expect, it } from 'vitest';
import {
  afterTyping,
  CASE_OFF,
  describeSlot,
  KEY_GAP,
  KEY_UNIT,
  keyboardRows,
  keyWidth,
  labelFor,
  pageOf,
  pressShift,
  type CaseState,
  type KeySlot,
} from '../src/keyboard-plan';

/** Flattens the rows of a page. */
function slotsOf(kind: 'text' | 'numeric', page: 'letters' | 'symbols' | 'numeric'): KeySlot[] {
  return keyboardRows(kind, page).flatMap((row) => [...row]);
}

/** Presses shift `n` times. */
function shifts(n: number, from: CaseState = CASE_OFF): CaseState {
  let state = from;
  for (let i = 0; i < n; i++) {
    state = pressShift(state);
  }
  return state;
}

describe('keyboard rows', () => {
  it('gives the text keyboard four rows: ten, nine, nine and five keys', () => {
    const rows = keyboardRows('text', 'letters');
    expect(rows.map((row) => row.length)).toEqual([10, 9, 9, 5]);
  });

  it('keeps the slot ids unique across both pages', () => {
    for (const page of ['letters', 'symbols'] as const) {
      const ids = slotsOf('text', page).map((slot) => slot.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('drops the shift key on the symbols page but keeps the other commands', () => {
    const ids = slotsOf('text', 'symbols').map((slot) => slot.id);
    expect(ids).not.toContain('shift');
    for (const id of ['page', 'space', 'backspace', 'enter']) {
      expect(ids).toContain(id);
    }
    // The page key is what gets the player back, so it must survive the switch.
    expect(labelFor(pageKey('symbols'), 'symbols', false)).toBe('ABC');
  });

  it('offers every letter and every digit exactly once across the two pages', () => {
    const letters = slotsOf('text', 'letters')
      .filter((slot) => !slot.command)
      .map((slot) => labelFor(slot, 'letters', false))
      .join('');
    expect(letters).toBe('qwertyuiopasdfghjklzxcvbnm.-');
    const symbols = slotsOf('text', 'symbols')
      .filter((slot) => !slot.command)
      .map((slot) => labelFor(slot, 'symbols', false))
      .join('');
    for (const digit of '0123456789') {
      expect(symbols).toContain(digit);
    }
  });

  it('lays the numpad out as three digits, three digits, three digits and a bottom row', () => {
    const rows = keyboardRows('numeric', 'numeric');
    expect(rows.map((row) => row.map((slot) => slot.id))).toEqual([
      ['n1', 'n2', 'n3'],
      ['n4', 'n5', 'n6'],
      ['n7', 'n8', 'n9'],
      ['n.', 'n0', 'backspace', 'enter'],
    ]);
    // There is no shift and no letters page on a numpad.
    expect(slotsOf('numeric', 'numeric').some((slot) => slot.command === 'case')).toBe(false);
  });
});

describe('key labels', () => {
  it('upper-cases only the letters page', () => {
    const q = slotOf('text', 'letters', 'q');
    expect(labelFor(q, 'letters', false)).toBe('q');
    expect(labelFor(q, 'letters', true)).toBe('Q');
    expect(labelFor(q, 'symbols', true)).toBe('1');
  });

  it('shows ⇧ for a released shift and ⇪ for a locked one', () => {
    const shift = shiftKey();
    expect(labelFor(shift, 'letters', false)).toBe('⇧');
    expect(labelFor(shift, 'letters', true)).toBe('⇪');
  });

  it('swaps the page key between 123 and ABC so it always names its destination', () => {
    expect(labelFor(pageKey('letters'), 'letters', false)).toBe('123');
    expect(labelFor(pageKey('symbols'), 'symbols', false)).toBe('ABC');
  });

  it('names the page key after where it goes, and keeps the fixed names for the rest', () => {
    // A reader that announces "Numbers and symbols" while the player is already on that page is
    // describing the state, not the button: the name follows the destination.
    expect(describeSlot(pageKey('letters'), 'letters', false).a11yLabel).toBe(
      'Numbers and symbols',
    );
    expect(describeSlot(pageKey('symbols'), 'symbols', false).a11yLabel).toBe('Letters');
    expect(describeSlot(shiftKey(), 'letters', false).a11yLabel).toBe('Shift');
    expect(describeSlot(slotOf('text', 'letters', 'backspace'), 'letters', false).a11yLabel).toBe(
      'Delete',
    );
    // A letter key has no label of its own — its glyph is its name.
    expect(
      describeSlot(slotOf('text', 'letters', 'q'), 'letters', false).a11yLabel,
    ).toBeUndefined();
  });

  it('gives a command key a glyph and a11y label, and a character key a 1-unit width', () => {
    const space = slotOf('text', 'letters', 'space');
    expect(describeSlot(space, 'letters', false)).toMatchObject({
      label: 'Space',
      weight: 4,
      primary: false,
    });
    const enter = slotOf('text', 'letters', 'enter');
    expect(describeSlot(enter, 'letters', false).primary).toBe(true);
    expect(describeSlot(slotOf('text', 'letters', 'q'), 'letters', false)).toEqual({
      label: 'q',
      weight: 1,
      primary: false,
    });
  });

  it('measures a key as its weight in units plus the gaps between them', () => {
    expect(keyWidth(1)).toBe(KEY_UNIT);
    expect(keyWidth(2)).toBe(2 * KEY_UNIT + KEY_GAP);
    expect(keyWidth(4)).toBe(4 * KEY_UNIT + 3 * KEY_GAP);
  });
});

describe('shift is a one-shot that locks on a second press', () => {
  it('upper-cases exactly one character', () => {
    const oneShot = pressShift(CASE_OFF);
    expect(oneShot).toEqual({ upper: true, capsLock: false });
    // The character consumed it…
    expect(afterTyping(oneShot)).toEqual(CASE_OFF);
    // …and the key went back to ⇧, so the next letter is lower case again.
    expect(labelFor(slotOf('text', 'letters', 'q'), 'letters', afterTyping(oneShot).upper)).toBe(
      'q',
    );
  });

  it('locks the case on the second press and releases it on the third', () => {
    const locked = shifts(2);
    expect(locked).toEqual({ upper: true, capsLock: true });
    // Typing does not release a lock — that is the whole difference from one press.
    expect(afterTyping(locked)).toEqual(locked);
    expect(afterTyping(afterTyping(locked))).toEqual(locked);
    expect(shifts(3)).toEqual(CASE_OFF);
    expect(shifts(4)).toEqual({ upper: true, capsLock: false });
  });

  it('releases a one-shot on space too, because shift applies to the next character', () => {
    // Space goes through the same "something was inserted" path as a letter (`typed()` in the widget).
    expect(afterTyping(pressShift(CASE_OFF))).toEqual(CASE_OFF);
  });

  it('keeps the same object when nothing changes, so the relabel is skipped', () => {
    expect(afterTyping(CASE_OFF)).toBe(CASE_OFF);
    const locked = shifts(2);
    expect(afterTyping(locked)).toBe(locked);
  });
});

describe('page state', () => {
  it('maps the letters/symbols toggle to a page, and a numpad to its one page', () => {
    expect(pageOf('text', false)).toBe('letters');
    expect(pageOf('text', true)).toBe('symbols');
    expect(pageOf('numeric', false)).toBe('numeric');
    expect(pageOf('numeric', true)).toBe('numeric');
  });
});

/** The slot with this id on a page. */
function slotOf(
  kind: 'text' | 'numeric',
  page: 'letters' | 'symbols' | 'numeric',
  id: string,
): KeySlot {
  const slot = slotsOf(kind, page).find((candidate) => candidate.id === id);
  if (!slot) {
    throw new Error(`no slot ${id} on ${page}`);
  }
  return slot;
}

/** The `page` command key of the text keyboard. */
function pageKey(page: 'letters' | 'symbols'): KeySlot {
  return slotOf('text', page, 'page');
}

/** The shift key (only the letters page has one). */
function shiftKey(): KeySlot {
  return slotOf('text', 'letters', 'shift');
}
