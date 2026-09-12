/**
 * `List`'s row-flow shorthands: the merge rules that turn `gap` / `rowGap` / `columnGap` into the
 * `container` spec `Repeat` actually reads.
 */

import { describe, expect, it } from 'vitest';
import { withListFlow } from '../src/list-flow';

describe('withListFlow', () => {
  it('returns undefined when there is nothing to merge', () => {
    expect(withListFlow(undefined, {})).toBeUndefined();
  });

  it('turns `gap` into a box container with that gap', () => {
    expect(withListFlow(undefined, { gap: 6 })).toEqual({ gap: 6 });
  });

  it('keeps the explicit container fields and fills the rest in', () => {
    expect(withListFlow({ gap: 2, alignItems: 'center' }, { gap: 8 })).toEqual({
      gap: 2,
      alignItems: 'center',
    });
  });

  it('drops `gap` for a grid container instead of writing an ignored key', () => {
    // A grid has no single gap: it would be silently ignored, which is the bug this module exists for.
    expect(withListFlow({ columns: 3 }, { gap: 6 })).toEqual({ columns: 3 });
    expect(withListFlow({ columns: 3 }, { rowGap: 4, columnGap: 8 })).toEqual({
      columns: 3,
      rowGap: 4,
      columnGap: 8,
    });
  });

  it('applies the shorthands to a box without an explicit container', () => {
    expect(withListFlow(undefined, { rowGap: 4, columnGap: 8 })).toEqual({
      rowGap: 4,
      columnGap: 8,
    });
  });
});
