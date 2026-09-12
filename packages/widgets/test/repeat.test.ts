/**
 * The pure half of `Repeat`: keyed diff, virtual window and container metrics.
 *
 * Only pure functions are exercised here — no Phaser object is ever constructed, so the file runs in
 * plain Node (the widget itself is verified in the browser check).
 */

import { describe, expect, it } from 'vitest';
import { clearTextMetrics, textMetricsOf, textMetricsStats } from '../src/text-metrics';
import {
  computeVisibleRange,
  contentExtentOf,
  describeRepeatFlow,
  diffKeys,
  isGridContainerOptions,
  planRepeatUpdate,
  planVirtualWindow,
  resolveRepeatContainer,
} from '../src/repeat-plan';

describe('diffKeys', () => {
  it('reports nothing for identical key lists', () => {
    expect(diffKeys(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual({
      added: [],
      removed: [],
      kept: ['a', 'b', 'c'],
      moved: [],
    });
  });

  it('reports an append as added only', () => {
    expect(diffKeys(['a', 'b'], ['a', 'b', 'c'])).toEqual({
      added: ['c'],
      removed: [],
      kept: ['a', 'b'],
      moved: [],
    });
  });

  it('does not treat a prepend as a move', () => {
    expect(diffKeys(['a', 'b'], ['x', 'a', 'b'])).toEqual({
      added: ['x'],
      removed: [],
      kept: ['a', 'b'],
      moved: [],
    });
  });

  it('reports a middle removal without moving the survivors', () => {
    expect(diffKeys(['a', 'b', 'c'], ['a', 'c'])).toEqual({
      added: [],
      removed: ['b'],
      kept: ['a', 'c'],
      moved: [],
    });
  });

  it('reports a head removal without moving the survivors', () => {
    expect(diffKeys(['a', 'b', 'c'], ['b', 'c'])).toEqual({
      added: [],
      removed: ['a'],
      kept: ['b', 'c'],
      moved: [],
    });
  });

  it('detects a reversal as moved keys', () => {
    expect(diffKeys(['a', 'b', 'c'], ['c', 'b', 'a'])).toEqual({
      added: [],
      removed: [],
      kept: ['c', 'b', 'a'],
      moved: ['c', 'a'],
    });
  });

  it('detects a swap as moved keys', () => {
    expect(diffKeys(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual({
      added: [],
      removed: [],
      kept: ['b', 'a', 'c'],
      moved: ['b', 'a'],
    });
  });

  it('handles a mixed add/remove/move in one pass', () => {
    expect(diffKeys(['a', 'b', 'c'], ['c', 'a', 'd'])).toEqual({
      added: ['d'],
      removed: ['b'],
      kept: ['c', 'a'],
      moved: ['c', 'a'],
    });
  });

  it('collapses duplicate keys to their first occurrence', () => {
    expect(diffKeys(['a', 'a', 'b'], ['a', 'b', 'b'])).toEqual({
      added: [],
      removed: [],
      kept: ['a', 'b'],
      moved: [],
    });
  });

  it('treats two empty lists as an empty diff', () => {
    expect(diffKeys([], [])).toEqual({ added: [], removed: [], kept: [], moved: [] });
  });

  it('reports every key of an empty → filled transition', () => {
    expect(diffKeys([], ['a', 'b'])).toEqual({
      added: ['a', 'b'],
      removed: [],
      kept: [],
      moved: [],
    });
  });

  it('reports every key of a filled → empty transition', () => {
    expect(diffKeys(['a', 'b'], [])).toEqual({
      added: [],
      removed: ['a', 'b'],
      kept: [],
      moved: [],
    });
  });
});

describe('planRepeatUpdate', () => {
  it('marks an identical list as unchanged and mirrors the order', () => {
    const plan = planRepeatUpdate(['a', 'b'], ['a', 'b']);
    expect(plan.unchanged).toBe(true);
    expect(plan.order).toEqual(['a', 'b']);
    expect(plan.duplicates).toEqual([]);
  });

  it('is not unchanged when only the order differs', () => {
    const plan = planRepeatUpdate(['a', 'b'], ['b', 'a']);
    expect(plan.unchanged).toBe(false);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.moved).toEqual(['b', 'a']);
  });

  it('is not unchanged when the length differs', () => {
    expect(planRepeatUpdate(['a'], ['a', 'a']).unchanged).toBe(false);
    expect(planRepeatUpdate(['a', 'b'], ['a']).unchanged).toBe(false);
  });

  it('reports duplicated keys of the next list', () => {
    const plan = planRepeatUpdate([], ['a', 'b', 'a', 'a']);
    expect(plan.duplicates).toEqual(['a']);
    expect(plan.added).toEqual(['a', 'b']);
  });

  it('keeps the exact next order in `order`', () => {
    expect(planRepeatUpdate(['a'], ['b', 'a', 'b']).order).toEqual(['b', 'a', 'b']);
  });
});

describe('computeVisibleRange', () => {
  it('starts at the top for a zero offset', () => {
    expect(computeVisibleRange(0, 100, 10, 500, 0)).toEqual({ start: 0, end: 10 });
  });

  it('covers exactly the rows intersecting the viewport', () => {
    expect(computeVisibleRange(50, 100, 10, 500, 0)).toEqual({ start: 5, end: 15 });
  });

  it('rounds a partially visible trailing row up', () => {
    expect(computeVisibleRange(0, 105, 10, 500, 0)).toEqual({ start: 0, end: 11 });
  });

  it('includes visible rows in the middle of a long list', () => {
    expect(computeVisibleRange(1020, 100, 10, 500, 0)).toEqual({ start: 102, end: 112 });
  });

  it('extends the window by overscan on both sides', () => {
    expect(computeVisibleRange(50, 100, 10, 500, 2)).toEqual({ start: 3, end: 17 });
  });

  it('clamps overscan at the top of the list', () => {
    expect(computeVisibleRange(0, 100, 10, 500, 3)).toEqual({ start: 0, end: 13 });
  });

  it('clamps overscan at the end of the list', () => {
    expect(computeVisibleRange(4950, 100, 10, 500, 2)).toEqual({ start: 493, end: 500 });
  });

  it('collapses to an empty window past the end of the list', () => {
    expect(computeVisibleRange(10000, 100, 10, 500, 2)).toEqual({ start: 500, end: 500 });
  });

  it('clamps a huge overscan to the whole list', () => {
    expect(computeVisibleRange(0, 100, 10, 500, 1000)).toEqual({ start: 0, end: 500 });
  });

  it('returns an empty window for an empty list', () => {
    expect(computeVisibleRange(0, 100, 10, 0, 2)).toEqual({ start: 0, end: 0 });
  });

  it('falls back to the whole list when the extent is not usable', () => {
    expect(computeVisibleRange(0, 100, 0, 500, 2)).toEqual({ start: 0, end: 500 });
    expect(computeVisibleRange(0, 100, -5, 500, 2)).toEqual({ start: 0, end: 500 });
  });

  it('mounts only the overscan rows while the viewport is unknown', () => {
    expect(computeVisibleRange(0, 0, 10, 500, 3)).toEqual({ start: 0, end: 3 });
  });

  it('treats a negative offset as the top of the list', () => {
    expect(computeVisibleRange(-50, 100, 10, 500, 0)).toEqual({ start: 0, end: 10 });
  });
});

describe('planVirtualWindow', () => {
  it('adds no leading filler at the top and a trailing one for the rest', () => {
    expect(
      planVirtualWindow({
        offset: 0,
        viewport: 100,
        itemExtent: 34,
        count: 200,
        overscan: 2,
        gap: 4,
      }),
    ).toEqual({ start: 0, end: 5, leading: 0, trailing: 6626 });
  });

  it('keeps the rows at their real scroll position with a leading filler', () => {
    expect(
      planVirtualWindow({
        offset: 340,
        viewport: 100,
        itemExtent: 34,
        count: 200,
        overscan: 2,
        gap: 4,
      }),
    ).toEqual({ start: 8, end: 15, leading: 268, trailing: 6286 });
  });

  it('drops the trailing filler when the window reaches the last row', () => {
    expect(
      planVirtualWindow({
        offset: 6800,
        viewport: 100,
        itemExtent: 34,
        count: 200,
        overscan: 2,
        gap: 4,
      }),
    ).toEqual({ start: 198, end: 200, leading: 6728, trailing: 0 });
  });

  it('ignores the gap for the fillers when none is configured', () => {
    expect(
      planVirtualWindow({ offset: 100, viewport: 100, itemExtent: 10, count: 100, overscan: 0 }),
    ).toEqual({ start: 10, end: 20, leading: 100, trailing: 800 });
  });

  it('keeps the window the same size at 220, 5 000 and a million items', () => {
    // PLAN §M7 claims "5000 items at a stable 60 fps". The part of that claim a unit test can pin is
    // *why* it holds: the mounted window is a function of the viewport and the row extent, never of the
    // item count — so the layout work per frame is O(window), not O(n). The wall-clock half of the
    // claim is measured on `#/list` (`listDemo.perf()`, see ACCEPTANCE-list.md §6).
    const windowSize = (count: number, offset: number): number => {
      const range = computeVisibleRange(offset, 408, 38, count, 3);
      return range.end - range.start;
    };
    // At the very top the leading pad is clamped away (14 rows: 11 visible + 3 overscan); anywhere in
    // the middle both pads apply (17). Either way the number does not depend on the item count.
    expect(windowSize(220, 0)).toBe(14);
    expect(windowSize(5000, 0)).toBe(14);
    expect(windowSize(1_000_000, 0)).toBe(14);
    expect(windowSize(220, 3800)).toBe(17);
    expect(windowSize(5000, 100_000)).toBe(17);
    expect(windowSize(1_000_000, 500_000)).toBe(17);
  });

  it('stays exact at a large count (no float drift in the filler heights)', () => {
    // 5000 rows × 38 px is 190 000 px — the numbers the demo really uses, checked against the closed
    // form rather than against a recomputation.
    const count = 5000;
    const extent = 38;
    const gap = 4;
    const total = contentExtentOf(count, extent, gap);
    expect(total).toBe(count * extent - gap);

    const middle = planVirtualWindow({
      offset: 100_000,
      viewport: 408,
      itemExtent: extent,
      count,
      gap,
      overscan: 3,
    });
    expect(middle.leading).toBe(middle.start * extent - gap);
    expect(middle.trailing).toBe((count - middle.end) * extent - gap);
    // The three pieces have to add up to the real content height, which is what keeps the scroll bar
    // and the row positions honest at the far end of a long list.
    expect(middle.leading + (middle.end - middle.start) * extent + middle.trailing).toBe(
      total - gap,
    );

    const end = planVirtualWindow({
      offset: total - 408,
      viewport: 408,
      itemExtent: extent,
      count,
      gap,
      overscan: 3,
    });
    expect(end.end).toBe(count);
    expect(end.trailing).toBe(0);
    expect(end.leading + (end.end - end.start) * extent).toBe(total);
  });

  it('maps rows to items for a multi-item row', () => {
    expect(
      planVirtualWindow({
        offset: 0,
        viewport: 100,
        itemExtent: 50,
        count: 100,
        overscan: 0,
        perRow: 4,
      }),
    ).toEqual({ start: 0, end: 8, leading: 0, trailing: 1150 });
  });
});

describe('resolveRepeatContainer', () => {
  it('defaults to a vertical box', () => {
    expect(resolveRepeatContainer()).toEqual({
      type: 'box',
      options: { direction: 'vertical' },
    });
  });

  it('keeps box options and defaults the direction', () => {
    expect(resolveRepeatContainer({ gap: 4, alignItems: 'center' })).toEqual({
      type: 'box',
      options: { direction: 'vertical', gap: 4, alignItems: 'center' },
    });
  });

  it('honours an explicit horizontal direction', () => {
    expect(resolveRepeatContainer({ direction: 'horizontal' })).toEqual({
      type: 'box',
      options: { direction: 'horizontal' },
    });
  });

  it('detects a grid by its column options', () => {
    expect(resolveRepeatContainer({ columns: 3, rowGap: 4 })).toEqual({
      type: 'grid',
      options: { columns: 3, rowGap: 4 },
    });
    expect(isGridContainerOptions({ columns: 'auto' })).toBe(true);
    expect(isGridContainerOptions({ gap: 4 })).toBe(false);
  });

  it('accepts a pre-declared container type', () => {
    const declared = { type: 'grid', columns: 2 } as unknown as { columns: number };
    expect(resolveRepeatContainer(declared)).toEqual({ type: 'grid', options: declared });
  });
});

describe('describeRepeatFlow', () => {
  it('describes a vertical box with its row gap', () => {
    expect(describeRepeatFlow(resolveRepeatContainer({ rowGap: 4 }))).toEqual({
      axis: 'vertical',
      perRow: 1,
      gap: 4,
      virtualizable: true,
    });
  });

  it('falls back to the shorthand gap', () => {
    expect(describeRepeatFlow(resolveRepeatContainer({ gap: 6 })).gap).toBe(6);
  });

  it('refuses to virtualise a horizontal flow', () => {
    expect(describeRepeatFlow(resolveRepeatContainer({ direction: 'horizontal' }))).toEqual({
      axis: 'horizontal',
      perRow: 1,
      gap: 0,
      virtualizable: false,
    });
  });

  it('describes a grid by its column count', () => {
    expect(describeRepeatFlow(resolveRepeatContainer({ columns: 3, rowGap: 8 }))).toEqual({
      axis: 'vertical',
      perRow: 3,
      gap: 8,
      virtualizable: false,
    });
  });

  it('reports an unpredictable grid flow as zero items per row', () => {
    expect(describeRepeatFlow(resolveRepeatContainer({ columns: 'auto' })).perRow).toBe(0);
  });

  it('describes a leaf container as not flowable', () => {
    expect(describeRepeatFlow(null)).toEqual({
      axis: 'none',
      perRow: 0,
      gap: 0,
      virtualizable: false,
    });
  });
});

describe('contentExtentOf', () => {
  it('measures the whole list, with no gap after the last row', () => {
    // `itemExtent` already includes the flow gap, so the extent is `count × extent − gap`: one row is
    // its own height (30 − 8), ten rows are ten heights minus the gap that would follow the last one.
    expect(contentExtentOf(10, 30, 8)).toBe(300 - 8);
    expect(contentExtentOf(1, 30, 8)).toBe(30 - 8);
    expect(contentExtentOf(0, 30, 8)).toBe(0);
  });

  it('collapses non-finite and non-positive inputs to zero', () => {
    expect(contentExtentOf(Number.NaN, 30, 8)).toBe(0);
    expect(contentExtentOf(10, Number.POSITIVE_INFINITY, 8)).toBe(0);
    expect(contentExtentOf(10, 0, 8)).toBe(0);
    expect(contentExtentOf(10, 30, Number.NaN)).toBe(0);
    expect(contentExtentOf(-5, 30, 8)).toBe(0);
  });

  it('matches the scroll range a virtualised list reports for its own viewport', () => {
    // What an enclosing port relies on: extent = maxOffset + the list's own viewport.
    const extent = contentExtentOf(200, 34, 4);
    expect(extent - 260).toBe(200 * 34 - 4 - 260);
  });
});

describe('scene text metrics cache', () => {
  it('caches wrap results and widths per scene and counts hits', () => {
    const scene = {};
    const metrics = textMetricsOf(scene);
    let computed = 0;

    const first = metrics.wrappedLines('k', () => {
      computed += 1;
      return ['a', 'b'];
    });
    const second = metrics.wrappedLines('k', () => {
      computed += 1;
      return ['a', 'b'];
    });

    expect(first).toEqual(['a', 'b']);
    expect(second).toBe(first);
    expect(computed).toBe(1);

    let widths = 0;
    expect(metrics.width('w', () => (widths += 1) && 12)).toBe(12);
    expect(metrics.width('w', () => (widths += 1) && 12)).toBe(12);
    expect(widths).toBe(1);

    const stats = metrics.stats;
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(2);
    expect(stats.hitRate).toBeCloseTo(0.5, 6);
  });

  it('keeps a separate cache per scene and reports nothing for an unseen scene', () => {
    const a = {};
    const b = {};
    textMetricsOf(a).width('k', () => 1);

    expect(textMetricsStats(a)?.misses).toBe(1);
    expect(textMetricsStats(b)).toBeNull();
    expect(textMetricsOf(b)).not.toBe(textMetricsOf(a));
  });

  it('clears on demand (theme/font changes that keep the same style key)', () => {
    const scene = {};
    const metrics = textMetricsOf(scene);
    let computed = 0;
    metrics.width('k', () => (computed += 1) && 5);
    clearTextMetrics(scene);
    metrics.width('k', () => (computed += 1) && 5);

    expect(computed).toBe(2);
    expect(textMetricsStats(scene)?.size).toBe(1);
  });
});
