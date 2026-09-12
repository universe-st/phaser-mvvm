/**
 * Bring-into-view tests: the geometry that decides *where* a port has to scroll, and the ancestor
 * walk that asks the ports in the first place.
 *
 * Both are pure — `revealOffset` is arithmetic, `contentRectOf` is a tree walk and
 * `revealInViewports` only needs objects that answer `revealDescendant` — so the whole feature is
 * covered here, in CI, without a renderer. The scene-level half (a real `ScrollView`, a real Tab
 * press, real clipping) is the `#/scroll` acceptance run; these tests are what keeps the arithmetic
 * from regressing while that runs less often.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVEAL_MARGIN,
  contentRectOf,
  revealInViewports,
  revealOffset,
  type ContentRectSource,
  type PositionedNode,
} from '../src/reveal';
import type { Widget } from '../src/Widget';

/* ------------------------------------------------------------------ revealOffset */

describe('revealOffset', () => {
  const base = { offset: 0, viewport: 400, margin: DEFAULT_REVEAL_MARGIN };

  it('leaves an offset alone when the target is already inside, margin included', () => {
    expect(revealOffset({ ...base, start: 8, length: 40 })).toBe(0);
    expect(revealOffset({ ...base, start: 352, length: 40 })).toBe(0);
    expect(revealOffset({ ...base, offset: 100, start: 200, length: 40 })).toBe(100);
  });

  it('scrolls up by the smallest amount when the target is above the band', () => {
    // Target at content 100, offset 200 → it sits at -100; it has to end up at +8.
    expect(revealOffset({ ...base, offset: 200, start: 100, length: 40 })).toBe(92);
  });

  it('scrolls down by the smallest amount when the target is below the band', () => {
    // Target ends at content 1000; it has to end up at viewport - margin = 392.
    expect(revealOffset({ ...base, start: 960, length: 40 })).toBe(608);
  });

  it('aligns the leading edge of a target taller than the viewport', () => {
    // A 900px target in a 400px viewport leaves no free space, so the margin is clamped to 0 and the
    // answer is "put the target's start edge at the viewport's start edge" — aligning the trailing
    // edge instead would hide the beginning of what the user is reading.
    expect(revealOffset({ ...base, start: 500, length: 900 })).toBe(500);
    // At offset 1000 the target's span on screen is [-500, 400): it already covers the whole band, so
    // the rule above ("never move for nothing") wins over the leading-edge rule.
    expect(revealOffset({ ...base, offset: 1000, start: 500, length: 900 })).toBe(1000);
    // At offset 100 the target starts 400px *below* the band's start → scroll up to align it.
    expect(revealOffset({ ...base, offset: 100, start: 500, length: 900 })).toBe(500);
  });

  it('leaves a target that already covers the whole band alone', () => {
    // Offsets -100..300 are all "the band is inside the target": moving would reveal nothing.
    for (const offset of [-100, 0, 200, 300]) {
      expect(revealOffset({ ...base, offset, start: -200, length: 900 })).toBe(offset);
    }
  });

  it('never asks for a change that the margin cannot have caused', () => {
    // Exactly at the edges: visibleStart == margin, visibleEnd == viewport - margin → no move.
    expect(revealOffset({ ...base, start: 8, length: 384 })).toBe(0);
    // One pixel further and the bottom edge has to move.
    expect(revealOffset({ ...base, start: 9, length: 384 })).toBe(1);
  });

  it('clamps a large margin instead of letting the two edges fight', () => {
    // A 300px margin in a 400px viewport with a 40px target: half the free space is 180, so the target
    // is only asked to keep 180 from the edge. At 180 exactly nothing moves; one pixel higher and the
    // answer is `start - margin` = -1, which is negative on purpose — the *port* clamps to its own
    // limits (`setOffset`), the arithmetic here only says where the widget should be.
    expect(revealOffset({ offset: 0, viewport: 400, start: 180, length: 40, margin: 300 })).toBe(0);
    expect(revealOffset({ offset: 0, viewport: 400, start: 179, length: 40, margin: 300 })).toBe(
      -1,
    );
    expect(revealOffset({ offset: 0, viewport: 400, start: 100, length: 40, margin: 300 })).toBe(
      -80,
    );
  });

  it('is a no-op for a viewport with no length', () => {
    expect(revealOffset({ offset: 42, viewport: 0, start: 10, length: 10, margin: 8 })).toBe(42);
    expect(revealOffset({ offset: 42, viewport: -5, start: 10, length: 10, margin: 8 })).toBe(42);
  });

  it('handles a zero margin (snap flush to the edge)', () => {
    expect(revealOffset({ offset: 0, viewport: 400, start: -30, length: 40, margin: 0 })).toBe(-30);
  });
});

/* ------------------------------------------------------------------ contentRectOf */

interface FakeNode extends PositionedNode {
  readonly parentContainer: FakeNode | null;
}

function node(x: number, y: number, parent: FakeNode | null = null): FakeNode {
  return { x, y, parentContainer: parent };
}

/** A node that a `contentRectOf` call may ask for a rect; only the offset-free part matters here. */
function target(
  rect: { x: number; y: number; width?: number; height?: number },
  parent: PositionedNode | null,
): ContentRectSource {
  return { appliedRect: { width: 40, height: 20, ...rect }, parentContainer: parent };
}

describe('contentRectOf', () => {
  it('sums the containers between the target and the content root', () => {
    const root = node(0, 0);
    const middle = node(10, 20, root);
    const leaf = node(1, 2, middle);
    expect(contentRectOf(target({ x: 100, y: 200 }, leaf), root)).toEqual({
      x: 111,
      y: 222,
      width: 40,
      height: 20,
    });
  });

  it('excludes the content root itself, so the answer does not depend on the scroll offset', () => {
    // The holder of a port is placed at `-offset`; a rect that included it would change whenever the
    // port scrolled, which is precisely the value the caller is trying to compute.
    const root = node(0, -500);
    const leaf = node(0, 0, root);
    expect(contentRectOf(target({ x: 0, y: 300 }, leaf), root)?.y).toBe(300);
  });

  it('returns null when the content root is not an ancestor', () => {
    const root = node(0, 0);
    const other = node(0, 0);
    expect(contentRectOf(target({ x: 0, y: 0 }, other), root)).toBeNull();
    expect(contentRectOf(target({ x: 0, y: 0 }, null), root)).toBeNull();
    expect(contentRectOf(target({ x: 0, y: 0 }, other), null)).toBeNull();
  });

  it('uses appliedRect rather than the game object position', () => {
    // A widget's own x/y is a Phaser detail; the layout's answer is the authoritative one.
    const root = node(0, 0);
    expect(contentRectOf(target({ x: 7, y: 9 }, root), root)).toMatchObject({ x: 7, y: 9 });
  });
});

/* ------------------------------------------------------------------ revealInViewports */

class FakeHost {
  readonly calls: string[] = [];
  moves: boolean;
  readonly parentContainer: FakeHost | null;

  constructor(
    readonly name: string,
    moves: boolean,
    parent: FakeHost | null = null,
  ) {
    this.moves = moves;
    this.parentContainer = parent;
  }

  revealDescendant(target: Widget): boolean {
    this.calls.push((target as unknown as { name: string }).name);
    // One move per host, like a port that has already put the widget where it belongs.
    const moved = this.moves;
    this.moves = false;
    return moved;
  }
}

describe('revealInViewports', () => {
  it('asks every port above the target, innermost first', () => {
    const outer = new FakeHost('outer', false);
    const inner = new FakeHost('inner', false, outer);
    const target = { name: 'row', parentContainer: inner } as unknown as Widget;

    revealInViewports(target);

    expect(inner.calls).toEqual(['row']);
    expect(outer.calls).toEqual(['row']);
  });

  it('stops after one pass when nothing moved', () => {
    const host = new FakeHost('port', false);
    const target = { name: 'row', parentContainer: host } as unknown as Widget;
    let flushes = 0;

    expect(revealInViewports(target, { flushLayout: () => flushes++ })).toBe(false);
    expect(flushes).toBe(0);
  });

  it('re-walks after a move, laying out in between so the next pass sees the new offsets', () => {
    // A nested chain is a fixed point problem: the inner port moves the target, which changes where
    // the outer one has to scroll. Without the layout pass in between, pass two would measure the
    // geometry pass one had just invalidated.
    const outer = new FakeHost('outer', true);
    const inner = new FakeHost('inner', true, outer);
    const target = { name: 'row', parentContainer: inner } as unknown as Widget;
    const flushes: number[] = [];

    expect(revealInViewports(target, { flushLayout: () => flushes.push(flushes.length + 1) })).toBe(
      true,
    );
    // Pass 1 moved (both), flush; pass 2 found nothing left to do.
    expect(inner.calls).toEqual(['row', 'row']);
    expect(outer.calls).toEqual(['row', 'row']);
    expect(flushes).toHaveLength(1);
  });

  it('gives up after maxPasses instead of looping forever', () => {
    const host = new FakeHost('port', true);
    // A host that always claims a move would otherwise repeat until the pass cap.
    host.revealDescendant = function revealDescendant(this: FakeHost): boolean {
      this.calls.push('row');
      return true;
    };
    const target = { name: 'row', parentContainer: host } as unknown as Widget;
    let flushes = 0;

    revealInViewports(target, { flushLayout: () => flushes++, maxPasses: 2 });

    expect(host.calls).toHaveLength(2);
    expect(flushes).toBe(2);
  });

  it('ignores containers that have no viewport', () => {
    const plain = { x: 0, y: 0, parentContainer: null };
    const target = { name: 'row', parentContainer: plain } as unknown as Widget;
    expect(revealInViewports(target)).toBe(false);
  });

  it('walks through a non-widget container to reach a port above it', () => {
    const port = new FakeHost('port', true);
    const container = { x: 0, y: 0, parentContainer: port };
    const target = { name: 'row', parentContainer: container } as unknown as Widget;

    expect(revealInViewports(target)).toBe(true);
    // Twice: the port claimed a move, so the walk repeats (and the second pass finds it done).
    expect(port.calls).toEqual(['row', 'row']);
  });
});
