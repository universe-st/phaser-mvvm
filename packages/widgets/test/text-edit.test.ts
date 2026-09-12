/**
 * The pure text-editing core of `TextField`/`TextArea` (`text-edit.ts`).
 *
 * Nothing here builds a Phaser object: the module is a set of functions over strings and numbers, so
 * the tests drive it with a fake 10px-per-code-point measurer and assert on plain results. That is
 * what makes the caret, the wrapping, the scrolling and the selection geometry verifiable at all —
 * they are the parts that used to be "guess what the canvas did".
 */

import { describe, expect, it } from 'vitest';
import {
  caretAtX,
  caretRectOf,
  clampCaret,
  clampScrollY,
  codePointCount,
  computeLineHeight,
  computeScrollX,
  computeScrollY,
  deleteRange,
  displayOffset,
  displaySlice,
  displayValue,
  filterNumeric,
  hasSelection,
  heightForRows,
  insertText,
  layoutTextLines,
  lineEndAt,
  lineIndexAt,
  lineStartAt,
  maskValue,
  moveCaret,
  moveCaretVertically,
  positionLines,
  rowsForHeight,
  sanitizeValue,
  selectedText,
  selectionRange,
  selectionRects,
  splitLines,
  stripNewlines,
  valueOffsetFromDisplay,
  visibleTextWindow,
  widestLine,
  wrapLine,
  type MeasureWidth,
} from '../src/text-edit';

/** 10 design pixels per code point: every expectation below is readable arithmetic. */
const measure: MeasureWidth = (text) => Array.from(text).length * 10;

const EMOJI = '\u{1F600}'; // 😀 — one code point, two UTF-16 code units

describe('caret offsets', () => {
  it('clamps an offset into the value', () => {
    expect(clampCaret('abc', -5)).toBe(0);
    expect(clampCaret('abc', 99)).toBe(3);
    expect(clampCaret('abc', 1.9)).toBe(1);
  });

  it('treats a non-finite offset as the start of the value', () => {
    expect(clampCaret('abc', Number.NaN)).toBe(0);
    expect(clampCaret('abc', Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('never leaves the caret inside a surrogate pair', () => {
    const value = `a${EMOJI}b`;
    expect(clampCaret(value, 2)).toBe(1);
    expect(clampCaret(value, 3)).toBe(3);
  });

  it('counts a surrogate pair as one code point', () => {
    expect(codePointCount(`a${EMOJI}b`)).toBe(3);
    expect(codePointCount('abc')).toBe(3);
  });
});

describe('caret movement', () => {
  it('moves by one code unit over plain text', () => {
    expect(moveCaret('abc', 0, 1)).toBe(1);
    expect(moveCaret('abc', 3, -1)).toBe(2);
  });

  it('steps over a whole emoji when moving right', () => {
    expect(moveCaret(`a${EMOJI}b`, 1, 1)).toBe(3);
  });

  it('steps over a whole emoji when moving left', () => {
    expect(moveCaret(`a${EMOJI}b`, 3, -1)).toBe(1);
  });

  it('clamps at both ends of the value', () => {
    expect(moveCaret('ab', 0, -1)).toBe(0);
    expect(moveCaret('ab', 2, 4)).toBe(2);
  });

  it('finds the start and the end of the line under the caret', () => {
    const value = 'one\ntwo\nthree';
    expect(lineStartAt(value, 6)).toBe(4);
    expect(lineEndAt(value, 6)).toBe(7);
    expect(lineStartAt(value, 0)).toBe(0);
    expect(lineEndAt(value, 13)).toBe(13);
  });
});

describe('editing', () => {
  it('inserts text at the caret', () => {
    expect(insertText('ac', 1, 1, 'b')).toEqual({ value: 'abc', caret: 2, anchor: 2 });
  });

  it('replaces the selection with the inserted text', () => {
    expect(insertText('abcd', 1, 3, 'X')).toEqual({ value: 'aXd', caret: 2, anchor: 2 });
  });

  it('deletes one code point backwards, an emoji included', () => {
    expect(deleteRange(`a${EMOJI}`, 3, 3, 'backward')).toEqual({
      value: 'a',
      caret: 1,
      anchor: 1,
    });
  });

  it('deletes the code point after the caret forwards', () => {
    expect(deleteRange(`a${EMOJI}b`, 1, 1, 'forward')).toEqual({
      value: 'ab',
      caret: 1,
      anchor: 1,
    });
  });

  it('deletes the selection whatever the direction', () => {
    // caret 4 / anchor 2 selects "cd", so the two directions agree.
    expect(deleteRange('abcdef', 4, 2, 'backward').value).toBe('abef');
    expect(deleteRange('abcdef', 4, 2, 'forward').value).toBe('abef');
    expect(deleteRange('abcdef', 4, 2, 'forward').caret).toBe(2);
  });

  it('does nothing when deleting backwards at offset 0', () => {
    expect(deleteRange('abc', 0, 0, 'backward')).toEqual({ value: 'abc', caret: 0, anchor: 0 });
  });

  it('reports and returns the selected substring', () => {
    expect(selectedText('abcdef', 4, 1)).toBe('bcd');
    expect(hasSelection(4, 1)).toBe(true);
    expect(hasSelection(2, 2)).toBe(false);
    expect(selectionRange(4, 1)).toEqual({ start: 1, end: 4 });
    expect(selectionRange(1, 4)).toEqual({ start: 1, end: 4 });
  });
});

describe('password masking and displayed offsets', () => {
  it('masks one character per code point', () => {
    expect(maskValue('ab')).toBe('\u2022\u2022');
    expect(maskValue(`a${EMOJI}`)).toBe('\u2022\u2022');
    expect(maskValue('')).toBe('');
  });

  it('passes a non-password value through unchanged', () => {
    expect(displayValue('secret', 'text')).toBe('secret');
    expect(displayValue('secret', 'password')).toBe('\u2022\u2022\u2022\u2022\u2022\u2022');
  });

  it('converts a value offset into a display offset', () => {
    expect(displayOffset(`a${EMOJI}b`, 3, 'password')).toBe(2);
    expect(displayOffset(`a${EMOJI}b`, 3, 'text')).toBe(3);
  });

  it('builds the displayed prefix up to the caret', () => {
    expect(displaySlice('abcd', 2, 'text')).toBe('ab');
    expect(displaySlice('abcd', 2, 'password')).toBe('\u2022\u2022');
  });

  it('maps a display offset back to a value offset', () => {
    const value = `a${EMOJI}b`;
    expect(valueOffsetFromDisplay(value, 2, 'password')).toBe(3);
    expect(valueOffsetFromDisplay(value, 99, 'password')).toBe(4);
    // Plain text keeps the offset, except when it points inside a surrogate pair.
    expect(valueOffsetFromDisplay(value, 3, 'text')).toBe(3);
    expect(valueOffsetFromDisplay(value, 2, 'text')).toBe(1);
  });
});

describe('numeric filtering', () => {
  it('removes everything that is not part of a number', () => {
    expect(filterNumeric('a1b2c')).toBe('12');
    expect(filterNumeric('1 000')).toBe('1000');
  });

  it('keeps a single leading minus sign', () => {
    expect(filterNumeric('-12')).toBe('-12');
    expect(filterNumeric('1-2')).toBe('12');
    expect(filterNumeric('--3')).toBe('-3');
  });

  it('keeps a single decimal point', () => {
    expect(filterNumeric('1.5')).toBe('1.5');
    expect(filterNumeric('1.2.3')).toBe('1.23');
  });

  it('accepts an empty string', () => {
    expect(filterNumeric('')).toBe('');
    expect(filterNumeric('abc')).toBe('');
  });
});

describe('sanitizeValue', () => {
  it('applies the numeric filter and the length limit together', () => {
    expect(sanitizeValue('a1b2c3', { inputType: 'number', maxLength: 2 })).toBe('12');
  });

  it('strips line breaks for a single-line field', () => {
    expect(sanitizeValue('a\nb', { multiline: false })).toBe('a b');
    expect(sanitizeValue('a\nb', { multiline: true })).toBe('a\nb');
  });

  it('cuts at maxLength without splitting an emoji', () => {
    const value = `abc${EMOJI}${EMOJI}`;
    expect(sanitizeValue(value, { maxLength: 4 })).toBe(`abc${EMOJI}`);
    expect(sanitizeValue(value, { maxLength: 5 })).toBe(value);
  });

  it('keeps the value when there is no limit', () => {
    expect(sanitizeValue('anything', { maxLength: null })).toBe('anything');
  });

  it('replaces every newline run with one space', () => {
    expect(stripNewlines('a\r\n\nb')).toBe('a b');
  });
});

describe('logical lines and wrapping', () => {
  it('splits at newlines and keeps absolute offsets', () => {
    expect(splitLines('one\ntwo')).toEqual([
      { text: 'one', start: 0, end: 3 },
      { text: 'two', start: 4, end: 7 },
    ]);
  });

  it('produces an empty last line for a trailing newline', () => {
    expect(splitLines('a\n')).toEqual([
      { text: 'a', start: 0, end: 1 },
      { text: '', start: 2, end: 2 },
    ]);
  });

  it('wraps at the last space that fits', () => {
    // 40px per line with 10px per character: "hello world" needs two lines.
    expect(wrapLine('hello world', 0, 40, measure)).toEqual([
      { text: 'hell', start: 0, end: 4 },
      { text: 'o', start: 4, end: 5 },
      { text: 'worl', start: 6, end: 10 },
      { text: 'd', start: 10, end: 11 },
    ]);
  });

  it('breaks a word that is wider than the line', () => {
    const lines = wrapLine('abcdefgh', 0, 30, measure);
    expect(lines.map((line) => line.text)).toEqual(['abc', 'def', 'gh']);
    expect(lines[2]?.start).toBe(6);
  });

  it('keeps a line that fits as one line', () => {
    expect(wrapLine('abc', 0, 100, measure)).toEqual([{ text: 'abc', start: 0, end: 3 }]);
  });

  it('wraps each logical line when asked to', () => {
    const lines = layoutTextLines('ab\ncd', { wrap: false, maxWidth: 20, measureWidth: measure });
    expect(lines.map((line) => line.text)).toEqual(['ab', 'cd']);
  });

  it('measures the widest line', () => {
    expect(widestLine(splitLines('ab\nabcd'), measure)).toBe(40);
  });
});

describe('line placement', () => {
  it('stacks lines by the line height and aligns them left', () => {
    const placed = positionLines(splitLines('ab\nc'), {
      align: 'left',
      width: 100,
      lineHeight: 20,
      measureWidth: measure,
    });
    expect(placed.map((line) => [line.x, line.y])).toEqual([
      [0, 0],
      [0, 20],
    ]);
  });

  it('centres and right-aligns a line that fits', () => {
    const centered = positionLines(splitLines('ab'), {
      align: 'center',
      width: 100,
      lineHeight: 20,
      measureWidth: measure,
    });
    expect(centered[0]?.x).toBe(40);

    const right = positionLines(splitLines('ab'), {
      align: 'right',
      width: 100,
      lineHeight: 20,
      measureWidth: measure,
    });
    expect(right[0]?.x).toBe(80);
  });

  it('left-aligns an overflowing line instead of hiding both of its ends', () => {
    const placed = positionLines(splitLines('abcdefghij'), {
      align: 'center',
      width: 50,
      lineHeight: 20,
      measureWidth: measure,
    });
    expect(placed[0]?.x).toBe(0);
  });
});

describe('vertical caret movement', () => {
  const lines = splitLines('abcdef\nab\nabcdefgh');

  it('finds the line that owns a caret offset', () => {
    expect(lineIndexAt(lines, 0)).toBe(0);
    expect(lineIndexAt(lines, 6)).toBe(0);
    expect(lineIndexAt(lines, 7)).toBe(1);
    expect(lineIndexAt(lines, 17)).toBe(2);
  });

  it('keeps the column when moving down, clamped to a shorter line', () => {
    const moved = moveCaretVertically(lines, 4, 'down', -1);
    // "ab" is only two characters long, so the caret stops at its end while remembering column 4.
    expect(moved.caret).toBe(7 + 2);
    expect(moved.columnHint).toBe(4);
  });

  it('clamps to the end of a shorter line but remembers the column', () => {
    const down = moveCaretVertically(lines, 4, 'down', -1);
    const further = moveCaretVertically(lines, down.caret, 'down', down.columnHint);
    expect(further.caret).toBe(10 + 4);
    expect(further.columnHint).toBe(4);
  });

  it('clamps at the first and the last line', () => {
    expect(moveCaretVertically(lines, 0, 'up', -1).caret).toBe(0);
    expect(moveCaretVertically(lines, 17, 'down', -1).caret).toBe(17);
    expect(moveCaretVertically([], 0, 'down', -1)).toEqual({ caret: 0, columnHint: -1 });
  });
});

describe('caret placement from a pointer position', () => {
  it('picks the nearest code point boundary', () => {
    expect(caretAtX('abcde', 0, measure)).toBe(0);
    expect(caretAtX('abcde', 16, measure)).toBe(2);
    expect(caretAtX('abcde', 24, measure)).toBe(2);
  });

  it('clamps to the end of the text', () => {
    expect(caretAtX('abc', 500, measure)).toBe(3);
    expect(caretAtX('', 50, measure)).toBe(0);
  });

  it('reports the caret rectangle in content coordinates', () => {
    const placed = positionLines(splitLines('abcd\nef'), {
      align: 'left',
      width: 100,
      lineHeight: 20,
      measureWidth: measure,
    });
    expect(caretRectOf(placed, 2, measure)).toEqual({ x: 20, y: 0 });
    expect(caretRectOf(placed, 6, measure)).toEqual({ x: 10, y: 20 });
  });
});

describe('selection rectangles', () => {
  const placed = positionLines(splitLines('abcd\nef\ng'), {
    align: 'left',
    width: 100,
    lineHeight: 20,
    measureWidth: measure,
  });

  it('returns one rectangle for a selection inside one line', () => {
    expect(selectionRects(placed, { start: 1, end: 3 }, 20, measure)).toEqual([
      { x: 10, y: 0, width: 20, height: 20 },
    ]);
  });

  it('returns one rectangle per spanned line', () => {
    const rects = selectionRects(placed, { start: 2, end: 7 }, 20, measure);
    expect(rects).toEqual([
      { x: 20, y: 0, width: 20, height: 20 },
      { x: 0, y: 20, width: 20, height: 20 },
    ]);
  });

  it('skips zero-width fragments', () => {
    expect(selectionRects(placed, { start: 5, end: 5 }, 20, measure)).toEqual([]);
  });

  it('ignores lines outside the selection', () => {
    const rects = selectionRects(placed, { start: 8, end: 9 }, 20, measure);
    expect(rects).toEqual([{ x: 0, y: 40, width: 10, height: 20 }]);
  });
});

describe('horizontal window and scrolling', () => {
  it('keeps the whole line when it fits', () => {
    expect(visibleTextWindow('abc', 0, 100, measure)).toEqual({
      start: 0,
      end: 3,
      text: 'abc',
      offset: 0,
    });
  });

  it('drops what is scrolled away and keeps a partially visible character', () => {
    const window = visibleTextWindow('abcdefgh', 25, 30, measure);
    // The view covers [25, 55): "c" is partly scrolled away, "g" starts past the right edge.
    expect(window.text).toBe('cdef');
    expect(window.start).toBe(2);
    expect(window.offset).toBe(-5);
  });

  it('renders nothing into a collapsed box', () => {
    expect(visibleTextWindow('abcdef', 0, 0, measure)).toEqual({
      start: 6,
      end: 6,
      text: '',
      offset: 0,
    });
  });

  it('does not scroll while the caret is inside the view', () => {
    expect(computeScrollX(20, 100, 0)).toBe(0);
    expect(computeScrollX(40, 100, 10)).toBe(10);
  });

  it('scrolls right just enough to keep the caret visible', () => {
    expect(computeScrollX(120, 100, 0)).toBe(21);
    expect(computeScrollX(105, 100, 0, 2)).toBe(7);
  });

  it('scrolls back when the caret moves before the window', () => {
    expect(computeScrollX(30, 100, 80)).toBe(30);
  });

  it('never scrolls a collapsed view', () => {
    expect(computeScrollX(50, 0, 20)).toBe(0);
  });
});

describe('vertical scrolling', () => {
  it('keeps the caret line inside the view', () => {
    expect(computeScrollY(60, 80, 100, 0)).toBe(0);
    expect(computeScrollY(140, 160, 100, 0)).toBe(60);
    expect(computeScrollY(20, 40, 100, 60)).toBe(20);
  });

  it('clamps a scroll offset to the content', () => {
    expect(clampScrollY(500, 200, 100)).toBe(100);
    expect(clampScrollY(-5, 200, 100)).toBe(0);
    expect(clampScrollY(50, 40, 100)).toBe(0);
    expect(clampScrollY(Number.NaN, 200, 100)).toBe(0);
  });

  it('never scrolls a collapsed view', () => {
    expect(computeScrollY(40, 60, 0, 30)).toBe(0);
  });
});

describe('metrics', () => {
  it('derives the line height from the font size', () => {
    expect(computeLineHeight(16)).toBe(20);
    expect(computeLineHeight(16, 2)).toBe(32);
    expect(computeLineHeight(0)).toBe(1);
  });

  it('derives a text area height from its rows and padding', () => {
    const padding = { top: 8, right: 12, bottom: 8, left: 12 };
    expect(heightForRows(3, 20, padding)).toBe(76);
    expect(heightForRows(0, 20, padding)).toBe(36);
  });

  it('recovers the row count from a height', () => {
    const padding = { top: 8, right: 12, bottom: 8, left: 12 };
    expect(rowsForHeight(76, 20, padding)).toBe(3);
    expect(rowsForHeight(79, 20, padding)).toBe(3);
    expect(rowsForHeight(0, 20, padding)).toBe(1);
  });
});
