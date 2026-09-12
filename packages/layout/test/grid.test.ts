/**
 * `grid` arranger: column derivation, cell geometry, spans, auto flow and item alignment.
 *
 * Cell rects are asserted per child through the harness, i.e. the final border box the engine handed
 * to `applyRect`. Cases that produce sub-pixel cell widths run on `exactEngine()` (snapping off).
 */

import { describe, expect, it } from 'vitest';
import { loose, tight, unbounded } from '../src/constraint';
import type { LayoutParams } from '../src/params';
import type { TestNode } from './harness';
import { exactEngine, expectRect, expectSize, grid, leaf, layout, rectOf } from './harness';

/** A child with a definite border-box size. */
function fixed(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf({ width, height, ...params });
}

/** A child that sizes itself from its content. */
function auto(width: number, height: number, params: LayoutParams = {}): TestNode {
  return leaf(params, { width, height });
}

/** `count` identical children, handy for cell-by-cell assertions. */
function cells(count: number, width: number, height: number): TestNode[] {
  return Array.from({ length: count }, () => auto(width, height));
}

describe('grid: fixed column count', () => {
  it('places cells row-major and sizes them from the content box', () => {
    const kids = cells(5, 10, 20);
    const root = grid({ columns: 3, columnGap: 10, rowGap: 5 }, kids, {
      width: 320,
      height: 400,
    });

    const { size } = layout(root, loose(400, 500));

    expectSize(size, 320, 400);
    // cell width = (320 − 2×10) / 3 = 100
    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 110, 0, 100, 20);
    expectRect(kids[2] as TestNode, 220, 0, 100, 20);
    expectRect(kids[3] as TestNode, 0, 25, 100, 20);
    expectRect(kids[4] as TestNode, 110, 25, 100, 20);
  });

  it('derives row heights from the tallest child in each row', () => {
    const a = auto(10, 30);
    const b = auto(10, 50);
    const c = auto(10, 20);
    const d = auto(10, 15);
    const root = grid({ columns: 2, rowGap: 4 }, [a, b, c, d], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    // items stretch over the whole row by default: row 0 is 50 tall, row 1 is 20 tall.
    expectRect(a, 0, 0, 100, 50);
    expectRect(b, 100, 0, 100, 50);
    expectRect(c, 0, 54, 100, 20);
    expectRect(d, 100, 54, 100, 20);
  });

  it('measures the grid box as the full column × row box', () => {
    const root = grid({ columns: 2, columnGap: 10, rowGap: 6 }, [
      auto(10, 20),
      auto(10, 30),
      auto(10, 40),
    ]);

    const { size } = layout(root, loose(230, 500));

    // cell width = (230 − 10) / 2 = 110; rows are 30 and 40 → 30 + 6 + 40 = 76.
    expectSize(size, 230, 76);
  });

  it('applies gaps between cells only, never outside the grid', () => {
    const kids = cells(4, 10, 20);
    const root = grid({ columns: 2, columnGap: 8, rowGap: 8 }, kids, { width: 208, height: 200 });

    layout(root, loose(300, 300));

    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 108, 0, 100, 20);
    expectRect(kids[2] as TestNode, 0, 28, 100, 20);
    expectRect(kids[3] as TestNode, 108, 28, 100, 20);
  });

  it('handles fewer children than columns', () => {
    const a = auto(10, 20);
    const root = grid({ columns: 4, columnGap: 10 }, [a], { width: 430, height: 100 });

    const { size } = layout(root, loose(500, 500));

    expectSize(size, 430, 100);
    expectRect(a, 0, 0, 100, 20);
  });

  it('handles more children than columns by adding rows', () => {
    const kids = cells(6, 10, 20);
    const root = grid({ columns: 2, rowGap: 10 }, kids, { width: 200, height: 300 });

    layout(root, loose(300, 400));

    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 100, 0, 100, 20);
    expectRect(kids[2] as TestNode, 0, 30, 100, 20);
    expectRect(kids[5] as TestNode, 100, 60, 100, 20);
  });

  it('clamps a zero or negative column count to a single column', () => {
    const kids = cells(2, 10, 20);
    const root = grid({ columns: 0 }, kids, { width: 100, height: 100 });

    layout(root, loose(300, 300));

    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 0, 20, 100, 20);
  });

  it('measures an empty grid as 0×0', () => {
    const root = grid({ columns: 2 }, [], { width: 100, height: 100 });

    const { size } = layout(root, loose(300, 300));

    expectSize(size, 100, 100);
  });
});

describe('grid: automatic column count', () => {
  it('derives the column count from minColumnWidth', () => {
    const kids = cells(3, 10, 20);
    const root = grid({ minColumnWidth: 120 }, kids, { width: 400, height: 200 });

    layout(root, loose(400, 500), exactEngine());

    // floor((400 + 0) / (120 + 0)) = 3 columns of 400/3 each.
    expectRect(kids[0] as TestNode, 0, 0, 400 / 3, 20);
    expectRect(kids[1] as TestNode, 400 / 3, 0, 400 / 3, 20);
    expectRect(kids[2] as TestNode, 800 / 3, 0, 400 / 3, 20);
  });

  it('accounts for columnGap when deriving the column count', () => {
    const kids = cells(4, 10, 20);
    const root = grid({ minColumnWidth: 120, columnGap: 20 }, kids, { width: 400, height: 200 });

    layout(root, loose(400, 500), exactEngine());

    // floor((400 + 20) / (120 + 20)) = 3 columns of (400 − 40) / 3.
    expectRect(kids[0] as TestNode, 0, 0, 120, 20);
    expectRect(kids[1] as TestNode, 140, 0, 120, 20);
    expectRect(kids[2] as TestNode, 280, 0, 120, 20);
    expectRect(kids[3] as TestNode, 0, 20, 120, 20);
  });

  it('falls back to a single column when the width fits less than one column', () => {
    const kids = cells(3, 10, 20);
    const root = grid({ minColumnWidth: 120 }, kids, { width: 50 });

    const { size } = layout(root, loose(400, 500));

    expectSize(size, 50, 60);
    expectRect(kids[0] as TestNode, 0, 0, 50, 20);
    expectRect(kids[1] as TestNode, 0, 20, 50, 20);
    expectRect(kids[2] as TestNode, 0, 40, 50, 20);
  });

  it('puts every child in one row when the width is unbounded', () => {
    const kids = cells(3, 40, 20);
    const root = grid({ minColumnWidth: 120 }, kids);

    const { size } = layout(root, unbounded());

    expectSize(size, 360, 20);
    expectRect(kids[0] as TestNode, 0, 0, 120, 20);
    expectRect(kids[1] as TestNode, 120, 0, 120, 20);
    expectRect(kids[2] as TestNode, 240, 0, 120, 20);
  });

  it('uses minColumnWidth as the cell width when the width is unbounded', () => {
    const a = auto(10, 20);
    const root = grid({ minColumnWidth: 90 }, [a]);

    const { size } = layout(root, unbounded());

    expectSize(size, 90, 20);

    expectRect(a, 0, 0, 90, 20);
  });

  it('uses all available columns when the parent is wide', () => {
    const kids = cells(8, 10, 20);
    const root = grid({ minColumnWidth: 100, columnGap: 0 }, kids, { width: 400, height: 200 });

    layout(root, loose(600, 600));

    expectRect(kids[3] as TestNode, 300, 0, 100, 20);
    expectRect(kids[4] as TestNode, 0, 20, 100, 20);
  });
});

describe('grid: item alignment', () => {
  it('stretches items over the whole cell by default', () => {
    const a = auto(10, 20);
    const root = grid({ columns: 2, rowGap: 4 }, [a], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 100, 20);
  });

  it('centers a fixed-size item inside its cell with justifyItems/alignItems', () => {
    const a = fixed(30, 20);
    const root = grid({ columns: 2, justifyItems: 'center', alignItems: 'center' }, [a], {
      width: 220,
      height: 200,
    });

    layout(root, loose(400, 500));

    // cell is 110 × 20 (row height follows the content).
    expectRect(a, 40, 0, 30, 20);
  });

  it('centers an auto-sized item inside its cell by its content width', () => {
    const a = auto(30, 20);
    const root = grid({ columns: 2, justifyItems: 'center', alignItems: 'center' }, [a], {
      width: 400,
      height: 200,
    });

    layout(root, loose(500, 500));

    expectRect(a, 85, 0, 30, 20);
  });

  it('aligns items with justifyItems start and end', () => {
    const a = fixed(30, 20);
    const b = fixed(30, 20);
    const root = grid({ columns: 2, justifyItems: 'start', alignItems: 'end' }, [a, b], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 30, 20);
    expectRect(b, 100, 0, 30, 20);
  });

  it('aligns items with alignItems center inside a taller row', () => {
    const tall = auto(10, 100);
    const short = fixed(10, 20);
    const root = grid({ columns: 2, alignItems: 'center' }, [tall, short], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    // justifyItems defaults to stretch, so the 10px wide item still fills its cell.
    expectRect(tall, 0, 0, 100, 100);
    expectRect(short, 100, 40, 100, 20);
  });

  it('honours a child margin inside the cell', () => {
    const a = fixed(30, 20, { margin: { left: 10, top: 5 } });
    const root = grid({ columns: 1 }, [a], { width: 100, height: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 10, 5, 90, 20);
  });

  it('stretches a margin box inside the cell', () => {
    const a = auto(10, 10, { margin: { left: 10, right: 20 } });
    const root = grid({ columns: 1 }, [a], { width: 100, height: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 10, 0, 70, 10);
  });
});

describe('grid: explicit placement and spans', () => {
  it('positions a child with gridColumn/gridRow (1-based)', () => {
    const a = auto(10, 10, { gridColumn: 2, gridRow: 2 });
    const root = grid({ columns: 3, rowGap: 5 }, [a], { width: 300, height: 300 });

    layout(root, loose(400, 400));

    // row 1 is empty, so only the row gap separates the grid top from the cell.
    expectRect(a, 100, 5, 100, 10);
  });

  it('spans a child across columns', () => {
    const a = auto(10, 10, { gridColumnSpan: 2 });
    const root = grid({ columns: 3, columnGap: 10 }, [a], { width: 320, height: 100 });

    layout(root, loose(400, 400));

    expectRect(a, 0, 0, 210, 10);
  });

  it('spans a child across rows and adds the spanned row heights', () => {
    const tall = auto(10, 40, { gridRowSpan: 2 });
    const first = auto(10, 40);
    const second = auto(10, 60);
    const root = grid({ columns: 2, rowGap: 10 }, [tall, first, second], {
      width: 200,
      height: 300,
    });

    layout(root, loose(300, 400));

    expectRect(tall, 0, 0, 100, 110);
    expectRect(first, 100, 0, 100, 40);
    expectRect(second, 100, 50, 100, 60);
  });

  it('auto-places a child that only locks its column', () => {
    const locked = auto(10, 10, { gridColumn: 2 });
    const other = auto(10, 10);
    const root = grid({ columns: 2 }, [locked, other], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(locked, 100, 0, 100, 10);
    expectRect(other, 0, 0, 100, 10);
  });

  it('auto-places a child that only locks its row', () => {
    const locked = auto(10, 10, { gridRow: 2 });
    const other = auto(10, 10);
    const root = grid({ columns: 2 }, [locked, other], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(locked, 0, 10, 100, 10);
    expectRect(other, 0, 0, 100, 10);
  });

  it('makes automatic children skip cells taken by explicit ones', () => {
    const explicit = auto(10, 10, { gridColumn: 1, gridRow: 1 });
    const first = auto(10, 10);
    const second = auto(10, 10);
    const root = grid({ columns: 2 }, [explicit, first, second], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(explicit, 0, 0, 100, 10);
    expectRect(first, 100, 0, 100, 10);
    expectRect(second, 0, 10, 100, 10);
  });

  it('makes automatic children skip cells covered by a span', () => {
    const span = auto(10, 10, { gridColumnSpan: 2 });
    const next = auto(10, 10);
    const root = grid({ columns: 2 }, [span, next], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(span, 0, 0, 200, 10);
    expectRect(next, 0, 10, 100, 10);
  });

  it('makes a row-spanning automatic child skip a column the span would collide in', () => {
    // The vertical twin of the test above, and the shape the `#/showcase` "explicit placement" card pins
    // on screen: the cursor advances one cell at a time, so a `gridRowSpan: 2` child may only take the
    // first free cell whose **whole** span is free. Cell (1, 2) is taken here, which pushes the spanning
    // child to the second column — if `isFree` only checked its first row, the two would overlap.
    const pinned = auto(10, 30, { gridColumn: 1, gridRow: 2 });
    const tall = auto(10, 10, { gridRowSpan: 2 });
    const root = grid({ columns: 2, rowGap: 4 }, [pinned, tall], { width: 200, height: 300 });

    layout(root, loose(300, 400));

    // Row 1 is empty, so the pinned cell sits one row gap down; the span then inherits its two rows
    // (0 and 30 tall) plus the 4px gap between them.
    expectRect(pinned, 0, 4, 100, 30);
    expectRect(tall, 100, 0, 100, 34);
  });

  it('moves an oversized child to the next row instead of splitting its span', () => {
    const first = auto(10, 10);
    const span = auto(10, 10, { gridColumnSpan: 2 });
    const root = grid({ columns: 2 }, [first, span], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(first, 0, 0, 100, 10);
    expectRect(span, 0, 10, 200, 10);
  });
});

describe('grid: auto flow', () => {
  it('fills cells row-major by default', () => {
    const kids = cells(6, 10, 20);
    const root = grid({ columns: 3 }, kids, { width: 300, height: 200 });

    layout(root, loose(400, 400));

    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 100, 0, 100, 20);
    expectRect(kids[2] as TestNode, 200, 0, 100, 20);
    expectRect(kids[3] as TestNode, 0, 20, 100, 20);
    expectRect(kids[4] as TestNode, 100, 20, 100, 20);
    expectRect(kids[5] as TestNode, 200, 20, 100, 20);
  });

  it('fills cells column-major with autoFlow column', () => {
    const kids = cells(6, 10, 20);
    const root = grid({ columns: 3, autoFlow: 'column' }, kids, { width: 300, height: 200 });

    layout(root, loose(400, 400));

    // 6 items over 3 columns balance into 2 rows, filled column by column.
    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 0, 20, 100, 20);
    expectRect(kids[2] as TestNode, 100, 0, 100, 20);
    expectRect(kids[3] as TestNode, 100, 20, 100, 20);
    expectRect(kids[4] as TestNode, 200, 0, 100, 20);
    expectRect(kids[5] as TestNode, 200, 20, 100, 20);
  });

  it('balances column-major flow with a partial last column', () => {
    const kids = cells(5, 10, 20);
    const root = grid({ columns: 2, autoFlow: 'column' }, kids, { width: 200, height: 200 });

    layout(root, loose(400, 400));

    // ceil(5 / 2) = 3 rows: two full columns, then the last item in column 1.
    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 0, 20, 100, 20);
    expectRect(kids[2] as TestNode, 0, 40, 100, 20);
    expectRect(kids[3] as TestNode, 100, 0, 100, 20);
    expectRect(kids[4] as TestNode, 100, 20, 100, 20);
  });

  it('skips occupied cells in column-major flow too', () => {
    const explicit = auto(10, 10, { gridColumn: 1, gridRow: 1 });
    const first = auto(10, 10);
    const second = auto(10, 10);
    const root = grid({ columns: 2, autoFlow: 'column' }, [explicit, first, second], {
      width: 200,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(explicit, 0, 0, 100, 10);
    expectRect(first, 0, 10, 100, 10);
    expectRect(second, 100, 0, 100, 10);
  });

  it('orders children by `order` before filling cells', () => {
    const a = auto(10, 10, { order: 2 });
    const b = auto(10, 10, { order: 1 });
    const root = grid({ columns: 2 }, [a, b], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(b, 0, 0, 100, 10);
    expectRect(a, 100, 0, 100, 10);
  });
});

describe('grid: rows option and out-of-flow children', () => {
  it('floors every row at minRowHeight when rows is a fixed count', () => {
    const kids = cells(2, 10, 20);
    const root = grid({ columns: 1, rows: 2, minRowHeight: 50 }, kids, {
      width: 100,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(kids[0] as TestNode, 0, 0, 100, 50);
    expectRect(kids[1] as TestNode, 0, 50, 100, 50);
  });

  it('lets content exceed minRowHeight when it needs more space', () => {
    const kids = [auto(10, 80)];
    const root = grid({ columns: 1, rows: 1, minRowHeight: 50 }, kids, {
      width: 100,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(kids[0] as TestNode, 0, 0, 100, 80);
  });

  it('does not floor auto rows at minRowHeight', () => {
    const kids = cells(2, 10, 20);
    const root = grid({ columns: 2, minRowHeight: 100 }, kids, { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(kids[0] as TestNode, 0, 0, 100, 20);
    expectRect(kids[1] as TestNode, 100, 0, 100, 20);
  });

  it('adds rows for children that overflow a fixed row count', () => {
    const kids = cells(3, 10, 20);
    const root = grid({ columns: 1, rows: 1, minRowHeight: 0 }, kids, {
      width: 100,
      height: 200,
    });

    layout(root, loose(300, 300));

    expectRect(kids[2] as TestNode, 0, 40, 100, 20);
  });

  it('skips children with inFlow false', () => {
    const hidden = auto(10, 10);
    hidden.inFlow = false;
    const visible = auto(10, 10);
    const root = grid({ columns: 2 }, [hidden, visible], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expect(hidden.arranged).toBeNull();
    expectRect(visible, 0, 0, 100, 10);
  });

  it('skips absolute children in the cells but positions them afterwards', () => {
    const absoluteChild = auto(20, 20, { position: 'absolute', left: 5, top: 5 });
    const visible = auto(10, 10);
    const root = grid({ columns: 2 }, [absoluteChild, visible], { width: 200, height: 200 });

    layout(root, loose(300, 300));

    expectRect(visible, 0, 0, 100, 10);
    expectRect(absoluteChild, 5, 5, 20, 20);
  });

  it('does not count out-of-flow children towards the automatic column count', () => {
    const hidden = auto(10, 10);
    hidden.inFlow = false;
    const visible = auto(10, 10);
    const root = grid({ minColumnWidth: 120 }, [hidden, visible]);

    const { size } = layout(root, unbounded());

    // one single flow child → one single column of minColumnWidth.
    expectSize(size, 120, 10);
    expectRect(visible, 0, 0, 120, 10);
  });
});

describe('grid: nested and percentage sizing', () => {
  it('stretches a percentage child over its cell', () => {
    const a = leaf({ width: '50%', height: 10 });
    const root = grid({ columns: 2 }, [a], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 100, 10);
  });

  it('resolves a percentage child against the grid content box when not stretched', () => {
    const a = leaf({ width: '25%', height: 10 });
    const root = grid({ columns: 2, justifyItems: 'start' }, [a], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    // 25% of the 200px content box, aligned with the start of the 100px cell.
    expectRect(a, 0, 0, 50, 10);
  });

  it('fills the cell for a `fill` item even when the container alignment is not stretch', () => {
    const a = leaf({ width: 'fill', height: 10 });
    const root = grid({ columns: 2, justifyItems: 'center' }, [a], { width: 200, height: 100 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 100, 10);
  });

  it('keeps an auto item at its content size when the grid is wider than the content', () => {
    const a = auto(30, 20);
    const root = grid({ columns: 3, justifyItems: 'start' }, [a], { width: 300, height: 100 });

    layout(root, loose(400, 400));

    expectRect(a, 0, 0, 30, 20);
  });

  it('does not stretch an auto item when justifyItems is not stretch', () => {
    const a = auto(30, 20);
    const root = grid({ columns: 2, justifyItems: 'center', alignItems: 'center' }, [a], {
      width: 400,
      height: 300,
    });

    layout(root, tight(400, 300));

    // cell width = (400 − 0) / 2 = 200 → a 30px item centered in it starts at 85.
    expectRect(a, 85, 0, 30, 20);
  });

  it('does not force an auto grid to fill a fixed parent beyond its content', () => {
    const a = auto(30, 20);
    const root = grid({ columns: 1 }, [a]);

    const { size } = layout(root, tight(400, 300));

    expectSize(size, 400, 300);
    expectRect(a, 0, 0, 400, 20);
  });

  it('reports a zero-sized grid without touching its children', () => {
    const a = auto(10, 10);
    const root = grid({ columns: 2 }, [a], { width: 0, height: 0 });

    layout(root, loose(300, 300));

    expectRect(a, 0, 0, 0, 10);
  });

  it('exposes the placed cells through the child rects, not through the grid', () => {
    const a = auto(10, 10);
    const root = grid({ columns: 1 }, [a], { width: 50, height: 50 });

    layout(root, loose(100, 100));

    expect(rectOf(root)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(rectOf(a)).toEqual({ x: 0, y: 0, width: 50, height: 10 });
  });
});
