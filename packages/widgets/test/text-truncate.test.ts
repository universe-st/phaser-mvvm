/**
 * Line limiting and ellipsis (`Label`'s clipping policy).
 *
 * The width measurer is a fake monospace font (10px per character) so every expectation is exact.
 */

import { describe, expect, it } from 'vitest';
import {
  applyLineLimit,
  ELLIPSIS,
  ellipsizeLine,
  truncateLines,
  type MeasureWidth,
} from '../src/text-truncate';

/** Monospace measurer: one character is 10px wide. */
const width10: MeasureWidth = (text) => text.length * 10;

describe('ellipsizeLine', () => {
  it('returns the text untouched when it already fits', () => {
    expect(ellipsizeLine('abc', width10, 30)).toBe('abc');
    expect(ellipsizeLine('abc', width10, 100)).toBe('abc');
  });

  it('returns an empty string when there is no room at all', () => {
    expect(ellipsizeLine('abcdef', width10, 0)).toBe('');
  });

  it('returns an empty string when not even the ellipsis fits', () => {
    expect(ellipsizeLine('abcdef', width10, 5)).toBe('');
  });

  it('keeps the longest prefix that leaves room for the ellipsis', () => {
    // '…' is 10 wide, so 50px leaves room for four characters.
    expect(ellipsizeLine('abcdefgh', width10, 50)).toBe(`abcd${ELLIPSIS}`);
  });

  it('trims exactly one character when only one fits', () => {
    expect(ellipsizeLine('abcdefgh', width10, 20)).toBe(`a${ELLIPSIS}`);
  });

  it('ignores the width when it is unbounded', () => {
    expect(ellipsizeLine('abcdefgh', width10, Number.POSITIVE_INFINITY)).toBe('abcdefgh');
  });

  it('never ellipsizes an empty string', () => {
    expect(ellipsizeLine('', width10, 10)).toBe('');
  });

  it('supports a custom ellipsis string', () => {
    expect(ellipsizeLine('abcdefgh', width10, 50, '...')).toBe('ab...');
  });
});

describe('truncateLines', () => {
  const lines = ['one', 'two', 'three', 'four'];

  it('returns every line when the limit is not reached', () => {
    const result = truncateLines(lines, 4, width10, 100);
    expect(result.lines).toEqual(lines);
    expect(result.truncated).toBe(false);
  });

  it('drops the extra lines and reports truncation', () => {
    const result = truncateLines(lines, 2, width10, 100);
    expect(result.lines).toEqual(['one', 'two']);
    expect(result.truncated).toBe(true);
  });

  it('does not mutate the input array', () => {
    const input = ['one', 'two', 'three'];
    truncateLines(input, 1, width10, 100);
    expect(input).toEqual(['one', 'two', 'three']);
  });

  it('ellipsizes the last kept line when the width is bounded', () => {
    const result = truncateLines(lines, 2, width10, 20);
    // 'two' is 30 wide, 20 leaves room for the 10px ellipsis plus one character.
    expect(result.lines).toEqual(['one', `t${ELLIPSIS}`]);
  });

  it('appends a bare ellipsis when the width is unbounded', () => {
    const result = truncateLines(lines, 2, width10, Number.POSITIVE_INFINITY);
    expect(result.lines).toEqual(['one', `two${ELLIPSIS}`]);
  });

  it('returns nothing when the limit is zero', () => {
    const result = truncateLines(lines, 0, width10, 100);
    expect(result.lines).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it('cuts without shortening the last line when the ellipsis is empty', () => {
    const result = truncateLines(lines, 2, width10, 20, '');
    expect(result.lines).toEqual(['one', 'two']);
    expect(result.truncated).toBe(true);
  });
});

describe('applyLineLimit', () => {
  it('passes lines through when nothing is limited', () => {
    const result = applyLineLimit(['a', 'b'], { measureWidth: width10 });
    expect(result).toEqual({ lines: ['a', 'b'], truncated: false });
  });

  it('clips at maxLines and marks the result truncated', () => {
    const result = applyLineLimit(['a', 'b', 'c'], {
      maxLines: 2,
      measureWidth: width10,
      maxWidth: 100,
    });
    expect(result.lines).toEqual(['a', 'b']);
    expect(result.truncated).toBe(true);
  });

  it('adds an ellipsis to the last kept line when asked to', () => {
    const result = applyLineLimit(['aaaa', 'bbbbbb', 'cccc'], {
      maxLines: 2,
      ellipsis: true,
      measureWidth: width10,
      maxWidth: 40,
    });
    expect(result.lines).toEqual(['aaaa', `bbb${ELLIPSIS}`]);
  });

  it('keeps the last line intact when the ellipsis is off', () => {
    const result = applyLineLimit(['aaaa', 'bbbb', 'cccc'], {
      maxLines: 2,
      measureWidth: width10,
      maxWidth: 10,
    });
    expect(result.lines).toEqual(['aaaa', 'bbbb']);
  });

  it('ellipsizes a single unwrappable line that overflows the width', () => {
    const result = applyLineLimit(['abcdefgh'], {
      ellipsis: true,
      measureWidth: width10,
      maxWidth: 50,
    });
    expect(result.lines).toEqual([`abcd${ELLIPSIS}`]);
    expect(result.truncated).toBe(true);
  });

  it('leaves a single overflowing line alone when the ellipsis is off', () => {
    const result = applyLineLimit(['abcdefgh'], { measureWidth: width10, maxWidth: 50 });
    expect(result).toEqual({ lines: ['abcdefgh'], truncated: false });
  });

  it('does not touch wrapped multi-line content when maxLines is absent', () => {
    const result = applyLineLimit(['aaaa', 'bbbb'], {
      ellipsis: true,
      measureWidth: width10,
      maxWidth: 10,
    });
    expect(result).toEqual({ lines: ['aaaa', 'bbbb'], truncated: false });
  });
});

describe('ellipsizeLine · code points', () => {
  it('never slices a surrogate pair in half', () => {
    // Width == code-unit count: the binary search lands on index 4, the low half of the second emoji.
    // Cutting there would render a lone surrogate (a tofu box), so the cut moves back a unit — dropping
    // a whole glyph is the correct trade.
    const text = 'ab😀😀';
    const result = ellipsizeLine(text, (value) => value.length, 4);
    expect(result).toBe('ab…');
    expect(result).not.toMatch(/[\uD800-\uDBFF](?!\uDC00|[\uDC00-\uDFFF])/u);
  });

  it('keeps an emoji that fits, pair intact', () => {
    const text = 'ab😀';
    expect(ellipsizeLine(text, (value) => value.length, 4)).toBe('ab😀');
    expect(ellipsizeLine(text, (value) => value.length, 3)).toBe('ab…');
  });

  it('keeps the whole string when it already fits', () => {
    expect(ellipsizeLine('ab😀', (value) => value.length, 10)).toBe('ab😀');
  });
});
