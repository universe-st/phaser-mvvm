/**
 * The pointer event chain, in Node.
 *
 * The chain is the framework's answer to "who gets this press, and who may take it away from them" —
 * the question that decides whether a text field inside a scroll port, or a port inside another port,
 * behaves. None of it needs a renderer, so its whole contract is pinned here: delivery order, where
 * the walk stops, what a bubbling decline does, what an interception during a drag tells the previous
 * owner, and what a disallow request suppresses.
 *
 * The helper below attaches a hook **only when the test asks for one**, which is also how the
 * "a node without hooks is skipped, not reported as declining" rule stays honest.
 */

import { describe, expect, it } from 'vitest';
import { PointerChainHub, type PointerChainNode, type PointerPhase } from '../src/pointer-chain';

interface TestNode extends PointerChainNode {
  name: string;
  /** `phase@name` of every hook call, in order. */
  calls: string[];
  interceptResult: boolean;
  handleResult: boolean;
  /** What the last event looked like, for the coordinate and depth assertions. */
  last: {
    x: number;
    y: number;
    inside: boolean;
    depth: number;
    dx: number;
    dy: number;
    reason: string | null;
  } | null;
  reset(): void;
}

interface NodeOptions {
  width?: number;
  height?: number;
  /** Attach `onPointerIntercept` (Android's `onInterceptTouchEvent`). */
  intercept?: boolean;
  /** Attach `onPointerEvent` (Android's `onTouchEvent`). */
  handle?: boolean;
}

function makeNode(name: string, options: NodeOptions = {}): TestNode {
  const node: TestNode = {
    name,
    chainLabel: name,
    appliedRect: { width: options.width ?? 100, height: options.height ?? 100 },
    calls: [],
    interceptResult: false,
    handleResult: false,
    last: null,
    reset(): void {
      node.calls.length = 0;
      node.last = null;
    },
  };

  const record = (event: Parameters<NonNullable<PointerChainNode['onPointerEvent']>>[0]): void => {
    node.last = {
      x: event.x,
      y: event.y,
      inside: event.inside,
      depth: event.depth,
      dx: event.dx,
      dy: event.dy,
      reason: event.cancelReason,
    };
  };

  if (options.intercept) {
    node.onPointerIntercept = (event) => {
      node.calls.push(`intercept@${node.name}`);
      record(event);
      return node.interceptResult;
    };
  }
  if (options.handle) {
    node.onPointerEvent = (event) => {
      node.calls.push(`${event.phase}@${node.name}`);
      record(event);
      return node.handleResult;
    };
  }
  return node;
}

/** A node without hooks: "no hook" must not read as "declined". */
function silentNode(name: string): PointerChainNode & { name: string } {
  return { name, chainLabel: name, appliedRect: { width: 100, height: 100 } };
}

interface DispatchOptions {
  x: number;
  y: number;
  phase?: PointerPhase;
  pointerId?: number;
  /** A separate stage point, when the test wants the pointer away from the local point. */
  stageX?: number;
  stageY?: number;
  disallowed?: (node: PointerChainNode) => boolean;
}

/** One dispatch input; `x`/`y` are the stage point **and** every node's local point (a flat tree). */
function inputFor(path: readonly PointerChainNode[], options: DispatchOptions) {
  return {
    phase: options.phase ?? ('down' as PointerPhase),
    pointerId: options.pointerId ?? 1,
    kind: 'mouse' as const,
    path,
    stageX: options.stageX ?? options.x,
    stageY: options.stageY ?? options.y,
    pointFor: () => ({ x: options.x, y: options.y }),
    ...(options.disallowed ? { disallowed: options.disallowed } : {}),
  };
}

/** `label:action=result` lines, so the assertions read like the delivery log they describe. */
function log(trace: {
  entries: readonly { label: string; action: string; result: boolean }[];
}): string[] {
  return trace.entries.map(
    (entry) => `${entry.label}:${entry.action}=${entry.result ? 'true' : 'false'}`,
  );
}

describe('PointerChainHub: down', () => {
  it('delivers to the deepest widget first and stops there when it consumes', () => {
    const root = makeNode('root');
    const mid = makeNode('mid');
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;

    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([root, mid, leaf], { x: 10, y: 20 }));

    expect(log(trace)).toEqual(['leaf:handle=true']);
    expect(trace.stop).toBe('handled');
    expect(trace.handledBy).toBe(leaf);
    expect(trace.owner).toBe(leaf);
    expect(hub.active(1)?.owner).toBe(leaf);
    // Ancestors with no interception hook have no say and are not called at all.
    expect(root.calls).toEqual([]);
    expect(mid.calls).toEqual([]);
  });

  it('bubbles up the path when the deepest widget declines', () => {
    const root = makeNode('root');
    const mid = makeNode('mid', { handle: true });
    const leaf = makeNode('leaf', { handle: true });
    mid.handleResult = true;

    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([root, mid, leaf], { x: 10, y: 20 }));

    expect(log(trace)).toEqual(['leaf:handle=false', 'mid:handle=true']);
    expect(trace.owner).toBe(mid);
    expect(root.calls).toEqual([]);
  });

  it('keeps no gesture when every node declines', () => {
    const root = makeNode('root');
    const leaf = makeNode('leaf', { handle: true });

    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([root, leaf], { x: 10, y: 20 }));

    expect(trace.stop).toBe('declined');
    expect(trace.owner).toBeNull();
    expect(hub.active(1)).toBeNull();
    expect(log(trace)).toEqual(['leaf:handle=false']);
  });

  it('lets an ancestor intercept before the deepest widget is ever asked', () => {
    const root = makeNode('root');
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    mid.interceptResult = true;
    mid.handleResult = true;

    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([root, mid, leaf], { x: 10, y: 20 }));

    expect(log(trace)).toEqual(['mid:intercept=true', 'mid:handle=true']);
    expect(trace.stop).toBe('handled');
    expect(trace.owner).toBe(mid);
    expect(leaf.calls).toEqual([]);
  });

  it('bubbles past an interceptor that intercepts but does not handle', () => {
    const root = makeNode('root', { handle: true });
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    mid.interceptResult = true;
    root.handleResult = true;

    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([root, mid, leaf], { x: 10, y: 20 }));

    expect(log(trace)).toEqual(['mid:intercept=true', 'mid:handle=false', 'root:handle=true']);
    expect(trace.owner).toBe(root);
    expect(leaf.calls).toEqual([]);
  });

  it('never asks the deepest widget to intercept itself', () => {
    const root = makeNode('root');
    const leaf = makeNode('leaf', { intercept: true, handle: true });

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([root, leaf], { x: 10, y: 20 }));

    expect(leaf.calls).toEqual(['down@leaf']);
  });

  it('reports the depth of every node on the path', () => {
    const root = makeNode('root');
    const mid = makeNode('mid', { handle: true });
    const leaf = makeNode('leaf', { handle: true });
    mid.handleResult = true;

    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([root, mid, leaf], { x: 10, y: 20 }));

    expect(trace.entries.map((entry) => [entry.label, entry.depth])).toEqual([
      ['leaf', 2],
      ['mid', 1],
    ]);
    expect(leaf.last?.depth).toBe(2);
    expect(trace.pathLength).toBe(3);
  });

  it('reports "inside" from the node view, not from the raw point', () => {
    const leaf = makeNode('leaf', { width: 40, height: 30, handle: true });

    new PointerChainHub().dispatch(inputFor([leaf], { x: 39, y: 29 }));
    expect(leaf.last?.inside).toBe(true);

    new PointerChainHub().dispatch(inputFor([leaf], { x: 41, y: 5 }));
    expect(leaf.last?.inside).toBe(false);
  });

  it('turns no path into a no-path trace rather than an empty handled one', () => {
    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([], { x: 0, y: 0 }));
    expect(trace.stop).toBe('no-path');
    expect(trace.hitTarget).toBeNull();
  });

  it('does not report a node with no hooks as having declined', () => {
    const hub = new PointerChainHub();
    const trace = hub.dispatch(inputFor([silentNode('root'), silentNode('leaf')], { x: 5, y: 5 }));
    expect(trace.entries).toEqual([]);
    expect(trace.stop).toBe('declined');
  });
});

describe('PointerChainHub: move and up on a retained chain', () => {
  it('delivers to the owner even after the pointer left its box', () => {
    const leaf = makeNode('leaf', { width: 40, height: 40, handle: true });
    leaf.handleResult = true;
    const hub = new PointerChainHub();
    hub.dispatch(inputFor([leaf], { x: 10, y: 10 }));
    leaf.reset();

    const trace = hub.dispatch(inputFor([], { x: 400, y: 400, phase: 'move' }));

    expect(log(trace)).toEqual(['leaf:handle=true']);
    expect(leaf.last?.inside).toBe(false);
    // The gesture is still the leaf's: this is the property that makes a drag survive leaving a box.
    expect(hub.active(1)?.owner).toBe(leaf);
  });

  it('never re-hit-tests: a move goes to the retained owner, not to a freshly resolved target', () => {
    const leaf = makeNode('leaf', { handle: true });
    const other = makeNode('other', { handle: true });
    leaf.handleResult = true;
    other.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([leaf], { x: 10, y: 10 }));
    leaf.reset();

    // The caller passes the path of a new hit test; a retained dispatch must ignore it.
    const trace = hub.dispatch(inputFor([other], { x: 10, y: 10, phase: 'move' }));

    expect(log(trace)).toEqual(['leaf:handle=true']);
    expect(other.calls).toEqual([]);
    expect(trace.pathLength).toBe(1);
  });

  it('reports the distance travelled since the press', () => {
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    const hub = new PointerChainHub();
    hub.dispatch(inputFor([leaf], { x: 10, y: 10 }));
    hub.dispatch(inputFor([], { x: 60, y: 30, phase: 'move' }));
    expect(leaf.last).toMatchObject({ dx: 50, dy: 20 });
  });

  it('delivers the up phase and then forgets the gesture', () => {
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    const hub = new PointerChainHub();
    hub.dispatch(inputFor([leaf], { x: 10, y: 10 }));
    leaf.reset();

    const up = hub.dispatch(inputFor([], { x: 10, y: 10, phase: 'up' }));
    expect(log(up)).toEqual(['leaf:handle=true']);
    expect(hub.active(1)).toBeNull();

    const again = hub.dispatch(inputFor([], { x: 10, y: 10, phase: 'move' }));
    expect(again.stop).toBe('no-chain');
    expect(again.entries).toEqual([]);
  });

  it('still clears the chain when the up is declined', () => {
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    const hub = new PointerChainHub();
    hub.dispatch(inputFor([leaf], { x: 10, y: 10 }));
    leaf.handleResult = false;
    leaf.reset();

    const up = hub.dispatch(inputFor([], { x: 10, y: 10, phase: 'up' }));
    expect(log(up)).toEqual(['leaf:handle=false']);
    expect(up.stop).toBe('declined');
    expect(hub.active(1)).toBeNull();
  });

  it('bubbles a move up to an ancestor and hands the gesture over', () => {
    const mid = makeNode('mid', { handle: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));
    expect(hub.active(1)?.owner).toBe(leaf);

    leaf.handleResult = false;
    mid.handleResult = true;
    leaf.reset();
    mid.reset();
    const trace = hub.dispatch(inputFor([], { x: 400, y: 10, phase: 'move' }));

    expect(log(trace)).toEqual(['leaf:handle=false', 'mid:handle=true']);
    expect(hub.active(1)?.owner).toBe(mid);
  });
});

describe('PointerChainHub: interception during a gesture', () => {
  it('tells the previous owner it was cancelled, then hands the move to the interceptor', () => {
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    mid.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));
    expect(hub.active(1)?.owner).toBe(leaf);
    leaf.reset();
    mid.reset();

    mid.interceptResult = true;
    const trace = hub.dispatch(inputFor([], { x: 10, y: 200, phase: 'move' }));

    expect(log(trace)).toEqual(['mid:intercept=true', 'leaf:cancel=true', 'mid:handle=true']);
    expect(trace.stop).toBe('handled');
    expect(trace.owner).toBe(mid);
    expect(hub.active(1)?.owner).toBe(mid);
  });

  it('names the interceptor in the cancel reason', () => {
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    mid.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));
    mid.interceptResult = true;
    hub.dispatch(inputFor([], { x: 10, y: 200, phase: 'move' }));

    expect(leaf.last?.reason).toBe('intercepted by mid');
  });

  it('sends the cancel even when the interceptor then declines to handle', () => {
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));
    leaf.reset();
    mid.interceptResult = true;

    const trace = hub.dispatch(inputFor([], { x: 400, y: 200, phase: 'move' }));

    // The interceptor took the gesture and declined it; the cancel still went out first, which is what
    // stops the field's selection drag.
    expect(log(trace)).toEqual(['mid:intercept=true', 'leaf:cancel=true', 'mid:handle=false']);
    expect(trace.owner).toBe(mid);
    expect(hub.active(1)?.owner).toBe(mid);
  });

  it('asks an ancestor for interception exactly once per phase, never twice', () => {
    const mid = makeNode('mid', { intercept: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));
    mid.reset();
    hub.dispatch(inputFor([], { x: 10, y: 10, phase: 'up' }));

    expect(mid.calls).toEqual(['intercept@mid']);
  });
});

describe('PointerChainHub: disallowIntercept', () => {
  it('skips an ancestor a descendant asked to keep out, and says why in the trace', () => {
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));
    leaf.reset();
    mid.reset();
    mid.interceptResult = true;

    const asked: string[] = [];
    const trace = hub.dispatch(
      inputFor([], {
        x: 10,
        y: 300,
        phase: 'move',
        disallowed: (node) => {
          asked.push(node.chainLabel ?? '?');
          return node === mid;
        },
      }),
    );

    expect(mid.calls).toEqual([]);
    expect(asked).toEqual(['mid']);
    expect(trace.entries).toEqual([
      expect.objectContaining({
        label: 'mid',
        action: 'intercept',
        result: false,
        disallowed: true,
      }),
      expect.objectContaining({ label: 'leaf', action: 'handle', result: true }),
    ]);
    expect(hub.active(1)?.owner).toBe(leaf);
  });

  it('honours a claim that already existed when the press landed', () => {
    const mid = makeNode('mid', { intercept: true, handle: true });
    const leaf = makeNode('leaf', { handle: true });
    mid.interceptResult = true;
    leaf.handleResult = true;

    const hub = new PointerChainHub();
    const trace = hub.dispatch(
      inputFor([mid, leaf], { x: 10, y: 10, disallowed: (node) => node === mid }),
    );

    expect(log(trace)).toEqual(['mid:intercept=false', 'leaf:handle=true']);
    expect(mid.calls).toEqual([]);
  });
});

describe('PointerChainHub: several pointers and cancellation', () => {
  it('keeps one gesture per pointer id', () => {
    const first = makeNode('first', { handle: true });
    const second = makeNode('second', { handle: true });
    first.handleResult = true;
    second.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([first], { x: 10, y: 10, pointerId: 1 }));
    hub.dispatch(inputFor([second], { x: 50, y: 50, pointerId: 2 }));

    expect(hub.pointerIds.slice().sort()).toEqual([1, 2]);
    first.reset();
    second.reset();

    hub.dispatch(inputFor([], { x: 20, y: 20, phase: 'move', pointerId: 2 }));
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual(['move@second']);
  });

  it('cancels one pointer without touching the other', () => {
    const first = makeNode('first', { handle: true });
    const second = makeNode('second', { handle: true });
    first.handleResult = true;
    second.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([first], { x: 10, y: 10, pointerId: 1 }));
    hub.dispatch(inputFor([second], { x: 50, y: 50, pointerId: 2 }));
    first.reset();
    second.reset();

    const trace = hub.cancel(1, { kind: 'mouse' }, 'capture changed');
    expect(log(trace)).toEqual(['first:cancel=true']);
    expect(trace.cancelReason).toBe('capture changed');
    expect(hub.active(1)).toBeNull();
    expect(hub.active(2)?.owner).toBe(second);
    expect(second.calls).toEqual([]);
  });

  it('reports an unknown pointer as no-chain instead of throwing', () => {
    const hub = new PointerChainHub();
    const trace = hub.cancel(7, undefined, 'why');
    expect(trace.stop).toBe('no-chain');
    expect(trace.cancelReason).toBe('why');
  });

  it('replaces a gesture that never got its up, without delivering a cancel', () => {
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    const hub = new PointerChainHub();
    hub.dispatch(inputFor([leaf], { x: 10, y: 10 }));
    leaf.reset();

    hub.dispatch(inputFor([leaf], { x: 12, y: 12 }));
    expect(leaf.calls).toEqual(['down@leaf']);
    expect(hub.active(1)?.owner).toBe(leaf);
  });

  it('drops a gesture whose owner left the tree, without a stray delivery', () => {
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    const path: PointerChainNode[] = [leaf];

    const hub = new PointerChainHub();
    hub.dispatch(inputFor(path, { x: 10, y: 10 }));
    expect(hub.active(1)).not.toBeNull();

    path.length = 0;
    leaf.reset();
    const trace = hub.dispatch(inputFor([], { x: 10, y: 10, phase: 'move' }));

    expect(trace.stop).toBe('no-chain');
    expect(leaf.calls).toEqual([]);
    expect(hub.active(1)).toBeNull();
  });

  it('cancelAll tells every owner and empties the hub', () => {
    const first = makeNode('first', { handle: true });
    const second = makeNode('second', { handle: true });
    first.handleResult = true;
    second.handleResult = true;

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([first], { x: 10, y: 10, pointerId: 1 }));
    hub.dispatch(inputFor([second], { x: 50, y: 50, pointerId: 2 }));

    const traces = hub.cancelAll('scene shutdown');
    expect(traces).toHaveLength(2);
    expect(hub.pointerIds).toEqual([]);
    expect(first.calls).toContain('cancel@first');
    expect(second.calls).toContain('cancel@second');
  });
});

describe('PointerChainHub: contract details', () => {
  it('hands the same event object to every hook of one dispatch', () => {
    const mid = makeNode('mid', { intercept: true });
    const leaf = makeNode('leaf', { handle: true });
    const seen: unknown[] = [];
    mid.onPointerIntercept = (event) => {
      seen.push(event);
      return false;
    };
    leaf.onPointerEvent = (event) => {
      seen.push(event);
      return true;
    };

    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 3, y: 4 }));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    // …and it ends up describing the last node, which is why handlers must copy what they need.
    expect((seen[0] as { node: PointerChainNode }).node).toBe(leaf);
  });

  it('reports a cancel with the owner depth of the retained path', () => {
    const mid = makeNode('mid', { handle: true });
    const leaf = makeNode('leaf', { handle: true });
    leaf.handleResult = true;
    const hub = new PointerChainHub();
    hub.dispatch(inputFor([mid, leaf], { x: 10, y: 10 }));

    const trace = hub.cancel(1, undefined, 'destroyed');
    expect(trace.entries).toEqual([
      expect.objectContaining({ label: 'leaf', action: 'cancel', depth: 1, result: true }),
    ]);
  });
});
