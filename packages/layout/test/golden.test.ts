/**
 * Golden-snapshot layout tests (PLAN §7): a constraint tree in, a rect tree out.
 *
 * Each scenario is laid out and flattened into a deterministic, human-readable JSON file under
 * `test/golden/`, so an unintended geometry change shows up as a reviewable diff instead of a
 * silently different pixel. Regenerate with `UPDATE_GOLDEN=1 pnpm test`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LayoutEngine, tight } from '../src/index';
import type { LayoutNode } from '../src/types';
import { box, grid, leaf, stack, TestNode, absolute } from './harness';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const update = process.env.UPDATE_GOLDEN === '1';

interface SnapshotEntry {
  path: string;
  rect: [number, number, number, number];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function flatten(node: LayoutNode, path: string, out: SnapshotEntry[]): void {
  const rect = (node as TestNode).arranged;
  if (rect) {
    out.push({ path, rect: [round(rect.x), round(rect.y), round(rect.width), round(rect.height)] });
  }
  node.children.forEach((child, index) => flatten(child, `${path}/${index}`, out));
}

function snapshot(name: string, root: TestNode, width: number, height: number): SnapshotEntry[] {
  const engine = new LayoutEngine({ snapMode: 'none' });
  engine.layout(root, tight(width, height));

  const out: SnapshotEntry[] = [];
  flatten(root, 'root', out);

  const file = join(goldenDir, `${name}.json`);
  const serialized = `${JSON.stringify(out, null, 2)}\n`;

  if (update || !existsSync(file)) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(file, serialized);
  }

  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(out);
  return out;
}

describe('golden layout snapshots', () => {
  it('form column: label + fields + trailing button row', () => {
    const root = box(
      { direction: 'vertical', gap: 12, alignItems: 'stretch' },
      [
        leaf({ width: 200, height: 24 }),
        box({ direction: 'vertical', gap: 8 }, [
          leaf({ width: 'fill', height: 36 }),
          leaf({ width: 'fill', height: 36 }),
        ]),
        box({ direction: 'horizontal', gap: 8, justifyContent: 'end' }, [
          leaf({ width: 80, height: 32 }),
          leaf({ width: 80, height: 32 }),
        ]),
      ],
      { width: 360, height: 'auto', padding: 16 },
    );

    snapshot('form-column', root, 360, 600);
  });

  it('grid gallery: fixed columns, gaps, spans and per-cell alignment', () => {
    const cells = [
      leaf({ width: 'fill', height: 80 }),
      leaf({ width: 40, height: 40 }),
      leaf({ width: 60, height: 60, gridColumnSpan: 2 }),
      leaf({ width: 80, height: 80 }),
      leaf({ width: 80, height: 80 }),
      leaf({ width: 80, height: 80 }),
      leaf({ width: 80, height: 80, gridColumn: 2, gridRow: 2 }),
    ];

    const root = box(
      { direction: 'vertical', gap: 16 },
      [
        grid(
          { columns: 2, columnGap: 12, rowGap: 12, justifyItems: 'center', alignItems: 'center' },
          cells,
        ),
        grid({ columns: 'auto', minColumnWidth: 90, columnGap: 8, rowGap: 8 }, [
          leaf({ width: 30, height: 30 }),
          leaf({ width: 30, height: 30 }),
          leaf({ width: 30, height: 30 }),
          leaf({ width: 30, height: 30 }),
        ]),
      ],
      { padding: 20, width: 480, height: 'auto' },
    );

    snapshot('grid-gallery', root, 480, 720);
  });

  it('dashboard: nested boxes with grow, percentages and a stacked badge', () => {
    const header = box({ direction: 'horizontal', gap: 12, alignItems: 'center' }, [
      leaf({ width: 32, height: 32 }),
      leaf({ width: 'fill', height: 20, grow: 1 }),
      leaf({ width: 80, height: 28 }),
    ]);

    const sidebar = leaf({ width: 120, height: 'fill', shrink: 0 });
    // `width: 'fill'` (main-axis grow with a zero basis) rather than `auto`: an auto-width box whose
    // children resolve `fill` against its content box would size itself to the available width and
    // then overflow its own row.
    const content = box(
      { direction: 'vertical', gap: 10, alignItems: 'stretch' },
      [leaf({ width: 'fill', height: '50%' }), leaf({ width: 'fill', height: 40 })],
      { width: 'fill' },
    );

    const main = box({ direction: 'horizontal', gap: 10 }, [sidebar, content]);

    const overlay = stack({ align: 'end' }, [leaf({ width: 24, height: 24 })]);

    const root = box({ direction: 'vertical', gap: 10 }, [header, main], {
      width: 'fill',
      height: 'fill',
      padding: 12,
    });

    const rootWithBadge = new TestNode({
      container: { type: 'box', options: { direction: 'vertical' } },
      children: [root, overlay],
    });

    snapshot('dashboard', rootWithBadge as TestNode, 800, 600);
  });

  it('absolute overlay: offsets on all four edges plus a centered backdrop', () => {
    const root = absolute(
      [
        leaf({ width: 200, height: 120 }),
        leaf({ width: 40, height: 40, position: 'absolute', left: 8, top: 8 }),
        leaf({ width: 40, height: 40, position: 'absolute', right: 8, top: 8 }),
        leaf({ width: 40, height: 40, position: 'absolute', left: 8, bottom: 8 }),
        leaf({ width: 40, height: 40, position: 'absolute', right: 8, bottom: 8 }),
      ],
      { width: 200, height: 120 },
    );

    snapshot('absolute-overlay', root, 300, 200);
  });
});
