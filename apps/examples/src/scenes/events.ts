import Phaser from 'phaser';
import type { Button, Label, Panel } from '@phaser-mvvm/widgets';
import type { PointerChainEvent, PointerChainTrace, Widget } from '@phaser-mvvm/phaser';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

/**
 * The pointer event chain: dispatch, interception and consumption, on a five-level tree.
 *
 * The page exists to make the *delivery* visible. Every widget on the path from the root to the leaf
 * records what it was asked and what it answered, so the readouts answer the three questions a hit
 * test alone cannot:
 *
 * - who got the event first (the leaf, then its ancestors as it declines),
 * - who took it away (`l2` intercepting means `l3`, `l4` and the leaf never hear about the press),
 * - what the loser was told (a `cancel`, with the reason, rather than a stream that silently stops).
 *
 * Nesting is the point: five levels, one of which is the control that would normally be clicked. The
 * acceptance story is a matrix of the same click under different configurations — see
 * `docs/ACCEPTANCE-events.md` — and the two properties it leans on hardest are that a gesture stays
 * with the widget that consumed it after the pointer leaves the box, and that a `disallow` request
 * from the leaf really does suppress the ancestors' interception.
 */
export class EventsScene extends Phaser.Scene {
  private readonly nodes = new Map<string, Widget>();
  private readonly levels: Panel[] = [];
  /** The toggle buttons, by name, so their captions can follow the state they control. */
  private readonly toggles = new Map<string, Button>();
  /** The two readout labels of the control column. */
  private traceLabel: Label | null = null;
  private ledgerLabel: Label | null = null;
  private leaf: Button | null = null;

  /** Nodes whose `onPointerEvent` answers `true` (they consume the event and own the gesture). */
  private readonly consume = new Set<string>();
  /** Nodes whose `onPointerIntercept` answers `true` (they take the gesture from the leaf). */
  private readonly intercept = new Set<string>();
  /** Minimum travel, in page pixels, before an intercepting level takes the gesture (0 = at once). */
  private threshold = 0;
  /** Whether the leaf asks its ancestors to keep out of this gesture on every press. */
  private disallow = false;

  /** How many times the leaf was activated the ordinary way (the path a consumed press suppresses). */
  private clicks = 0;
  /** Per node, per phase, how many times its hook ran — the delivery ledger. */
  private readonly ledger = new Map<string, Map<string, number>>();
  private readonly log: string[] = [];
  private moves = 0;
  private cancels = 0;
  private traces = 0;
  private last: PointerChainTrace | null = null;
  private readonly published = new Map<string, string>();

  constructor() {
    super('events');
  }

  create(): void {
    const tree = this.buildTree();
    const controls = this.buildControls();

    const page = this.add.uiPanel(
      {
        direction: 'horizontal',
        gap: 24,
        padding: 20,
        alignItems: 'start',
        variant: 'surface',
        radius: 12,
        name: 'page',
      },
      [tree, controls],
    );
    this.mvvm.mount(page);

    // The chain reports every dispatch; the scene turns those records into the readouts below.
    this.mvvm.input.onPointerChain = (trace) => this.onTrace(trace);

    setDemoState('scene', 'events');
    this.reset();
    this.syncState();
    this.installProbes();

    appendStatus('--- pointer event chain (#/events) ---');
    reportWidget('events.page', page);
    for (const [name, widget] of this.nodes) {
      reportWidget(`events.${name}`, widget);
    }
    reportCanvas(this.game);
  }

  /** Builds `l1 → l2 → l3 → l4 → leaf`, each level wrapping the next. */
  private buildTree(): Panel {
    const leaf = this.add.uiButton({
      text: 'leaf · click me',
      variant: 'primary',
      name: 'leaf',
      // The ordinary click path, which is exactly what a consumed press must *not* also fire.
      onClick: () => {
        this.clicks++;
      },
    });
    leaf.onPointerEvent = (event) => this.handleLeaf(event);
    this.leaf = leaf;
    this.nodes.set('leaf', leaf);

    let inner: Widget[] = [leaf];
    for (const name of ['l4', 'l3', 'l2', 'l1']) {
      const panel = this.add.uiPanel(
        {
          direction: 'vertical',
          gap: 8,
          padding: 16,
          alignItems: 'stretch',
          variant: 'surfaceAlt',
          radius: 10,
          name,
        },
        [this.add.uiLabel({ text: name, tone: 'muted' }), ...inner],
      );
      // Every level is a *container* on the path, so it is asked both questions: "do you want to take
      // this gesture?" before the leaf hears about it, and "do you want to handle it?" as the event
      // bubbles back up.
      panel.onPointerIntercept = (event) => this.handleIntercept(name, event);
      panel.onPointerEvent = (event) => this.handleEvent(name, event);
      this.levels.unshift(panel);
      this.nodes.set(name, panel);
      inner = [panel];
    }

    const tree = inner[0];
    if (!tree) {
      throw new Error('EventsScene: the nesting loop produced no tree');
    }
    return tree as Panel;
  }

  /** The control column: the toggles, plus a live readout of the last dispatch. */
  private buildControls(): Panel {
    const button = (
      text: string,
      name: string,
      run: () => void,
      variant: 'secondary' | 'ghost' = 'secondary',
    ): Button => {
      const created = this.add.uiButton({ text, name, variant, onClick: run });
      this.toggles.set(name, created);
      return created;
    };
    // Fixed boxes on purpose: a readout that grows moves everything below it, and the click coordinates
    // a probe reads a moment earlier would then point at a different widget (the §8.47 trap, hit here for
    // real — the ledger line jumped from one to four lines, the page grew by 34px and the press that was
    // aimed at the leaf landed on `l4`).
    const trace = this.add.uiLabel({
      text: '—',
      name: 'trace',
      width: 300,
      height: 64,
      maxLines: 4,
      ellipsis: true,
    });
    const ledger = this.add.uiLabel({
      text: '—',
      name: 'ledger',
      width: 300,
      height: 48,
      maxLines: 3,
      ellipsis: true,
      tone: 'muted',
    });
    this.traceLabel = trace;
    this.ledgerLabel = ledger;

    return this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 8,
        padding: 16,
        variant: 'surfaceAlt',
        radius: 10,
        width: 330,
        name: 'controls',
      },
      [
        this.add.uiLabel({ text: 'Chain controls', size: 'lg' }),
        button('l2 intercept: off', 'toggleIntercept', () => this.toggleIntercept('l2')),
        button('l3 intercept: off', 'toggleIntercept3', () => this.toggleIntercept('l3')),
        button('leaf consume: off', 'toggleConsume', () => this.toggleConsume('leaf')),
        button('l4 consume: off', 'toggleConsume4', () => this.toggleConsume('l4')),
        button('threshold: immediate', 'toggleThreshold', () => this.toggleThreshold()),
        button('leaf disallow: off', 'toggleDisallow', () => this.toggleDisallow()),
        button('cancel gesture', 'cancelGesture', () => this.cancelGesture(), 'ghost'),
        button('reset counters', 'resetCounters', () => this.reset(), 'ghost'),
        this.add.uiDivider({}),
        this.add.uiLabel({ text: 'Last dispatch', tone: 'muted' }),
        trace,
        this.add.uiLabel({ text: 'Deliveries', tone: 'muted' }),
        ledger,
      ],
    );
  }

  // ------------------------------------------------------------------ the chain hooks

  /**
   * The leaf's own handler: the deepest node on the path, and the only one that can make the press
   * mean "activate me".
   */
  private handleLeaf(event: PointerChainEvent): boolean {
    this.record('leaf', event.phase);
    if (this.disallow) {
      if (event.phase === 'down') {
        // Android's `requestDisallowInterceptTouchEvent(true)`: from here on, no ancestor may take this
        // gesture. The veto is released with the gesture, or a later drag would inherit it (V24).
        this.leaf?.requestDisallowInterceptPointer(event.pointerId);
      } else if (event.phase === 'up' || event.phase === 'cancel') {
        this.leaf?.releaseDisallowInterceptPointer(event.pointerId);
      }
    }
    if (event.phase === 'up' || event.phase === 'cancel') {
      // A cheap, visible proof of the "the gesture keeps coming to you after you leave the box" rule:
      // whatever the release position is, the leaf is told.
      this.record(`leaf:${event.inside ? 'inside' : 'outside'}`, event.phase);
    }
    return this.consume.has('leaf');
  }

  /** A level's pre-hook: this is where a scroll port decides "a drag, not a click". */
  private handleIntercept(name: string, event: PointerChainEvent): boolean {
    this.record(`${name}.intercept`, event.phase);
    if (!this.intercept.has(name)) {
      return false;
    }
    if (this.threshold <= 0) {
      return true;
    }
    // "Only once the pointer has travelled far enough": the shape a `ScrollView` uses, and the reason an
    // interception can happen *during* a gesture rather than at the press.
    return Math.hypot(event.dx, event.dy) >= this.threshold;
  }

  /** A level's own handler: it is asked as the event bubbles up, and only if it consumes does it win. */
  private handleEvent(name: string, event: PointerChainEvent): boolean {
    this.record(`${name}.handle`, event.phase);
    return this.consume.has(name);
  }

  // ------------------------------------------------------------------ probes / controls

  private record(node: string, phase: string): void {
    let phases = this.ledger.get(node);
    if (!phases) {
      phases = new Map();
      this.ledger.set(node, phases);
    }
    phases.set(phase, (phases.get(phase) ?? 0) + 1);
  }

  private onTrace(trace: PointerChainTrace): void {
    this.traces++;
    this.last = trace;
    if (trace.phase === 'move') {
      this.moves++;
    }
    if (trace.phase === 'cancel') {
      this.cancels++;
    }
    if (trace.entries.length === 0) {
      return;
    }
    const line =
      `${trace.phase}:` +
      trace.entries
        .map((entry) => {
          const tag = entry.disallowed ? '!' : entry.result ? '1' : '0';
          return `${entry.label}.${entry.action}${tag}`;
        })
        .join('>') +
      `|${trace.stop}`;
    this.log.push(line);
    if (this.log.length > 60) {
      this.log.splice(0, this.log.length - 60);
    }
  }

  private toggleConsume(name: string): void {
    if (this.consume.has(name)) {
      this.consume.delete(name);
    } else {
      this.consume.add(name);
    }
    this.refreshControlLabels();
    this.syncState();
  }

  private toggleIntercept(name: string): void {
    if (this.intercept.has(name)) {
      this.intercept.delete(name);
    } else {
      this.intercept.add(name);
    }
    this.refreshAppearance();
    this.refreshControlLabels();
    this.syncState();
  }

  private toggleThreshold(): void {
    this.threshold = this.threshold === 0 ? 20 : 0;
    this.refreshControlLabels();
    this.syncState();
  }

  private toggleDisallow(): void {
    this.disallow = !this.disallow;
    this.refreshControlLabels();
    this.syncState();
  }

  private cancelGesture(): void {
    for (const chain of this.mvvm.input.chainHub.activeChains()) {
      this.mvvm.input.cancelPointer(chain.pointerId, 'probe: cancel gesture');
    }
  }

  private reset(): void {
    this.ledger.clear();
    this.log.length = 0;
    this.moves = 0;
    this.cancels = 0;
    this.traces = 0;
    this.clicks = 0;
    this.last = null;
    this.consume.clear();
    this.intercept.clear();
    this.refreshAppearance();
    this.refreshControlLabels();
    this.syncState();
  }

  /** Panels that would take the gesture are painted as armed; the leaf says when it will consume. */
  private refreshAppearance(): void {
    for (const panel of this.levels) {
      panel.setVariant(this.intercept.has(panel.name) ? 'danger' : 'surfaceAlt');
    }
    this.leaf?.setVariant(this.consume.has('leaf') ? 'danger' : 'primary');
  }

  private refreshControlLabels(): void {
    const text = (name: string, label: string): void => {
      this.toggles.get(name)?.setText(label);
    };
    text('toggleIntercept', `l2 intercept: ${this.intercept.has('l2') ? 'on' : 'off'}`);
    text('toggleIntercept3', `l3 intercept: ${this.intercept.has('l3') ? 'on' : 'off'}`);
    text('toggleConsume', `leaf consume: ${this.consume.has('leaf') ? 'on' : 'off'}`);
    text('toggleConsume4', `l4 consume: ${this.consume.has('l4') ? 'on' : 'off'}`);
    text(
      'toggleThreshold',
      `threshold: ${this.threshold === 0 ? 'immediate' : `${this.threshold}px`}`,
    );
    text('toggleDisallow', `leaf disallow: ${this.disallow ? 'on' : 'off'}`);
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  /** Per-frame readouts: the gesture in flight, the last dispatch, and each node's coordinates. */
  override update(): void {
    this.syncState();
  }

  private syncState(): void {
    const chains = this.mvvm.input.chains();
    const chain = chains[0] ?? null;
    this.publish('chain.count', chains.length);
    this.publish('chain.owner', chain ? chain.owner : 'none');
    this.publish('chain.hit', chain ? chain.hitTarget : 'none');
    this.publish('chain.path', chain ? chain.path.join('>') : 'none');
    this.publish('chain.stop', this.last ? this.last.stop : 'none');
    this.publish('chain.phase', this.last ? this.last.phase : 'none');
    this.publish('chain.entries', this.last ? this.formatEntries(this.last) : 'none');
    this.publish('chain.traces', this.traces);
    this.publish('chain.moves', this.moves);
    this.publish('chain.cancels', this.cancels);
    this.publish('chain.clicks', this.clicks);
    this.publish('chain.threshold', this.threshold);
    this.publish('chain.disallow', this.disallow ? 'on' : 'off');
    this.publish('chain.consume', [...this.consume].sort().join('+') || 'none');
    this.publish('chain.intercept', [...this.intercept].sort().join('+') || 'none');
    this.publish('chain.ledger', this.formatLedger());
    this.publish(
      'chain.log',
      this.log.length > 0 ? (this.log[this.log.length - 1] as string) : 'none',
    );
    this.traceLabel?.setText(this.last ? this.formatEntries(this.last) : '—');
    this.ledgerLabel?.setText(this.formatLedger() === 'none' ? '—' : this.formatLedger());

    for (const [name, widget] of this.nodes) {
      if (widget.isDestroyed) {
        this.publish(`st.${name}`, 'gone');
        continue;
      }
      this.publish(`st.${name}`, widget.visualState);
      const point = pagePoint(this.game, widget);
      this.publish(`pt.${name}`, `@${Math.round(point.x)},${Math.round(point.y)}`);
    }
  }

  /** `l2.intercept0>l2.handle1|declined` — the last dispatch in one string, no spaces. */
  private formatEntries(trace: PointerChainTrace): string {
    if (trace.entries.length === 0) {
      return `${trace.phase}:none|${trace.stop}`;
    }
    return (
      `${trace.phase}:` +
      trace.entries
        .map((entry) => {
          const tag = entry.disallowed ? '!' : entry.result ? '1' : '0';
          return `${entry.label}.${entry.action}${tag}`;
        })
        .join('>') +
      `|${trace.stop}`
    );
  }

  /**
   * The delivery ledger, flattened and ordered: `l2.intercept.down=1+leaf.handle.up=1`.
   *
   * Keys are `node.phase` for the leaf and `level.question.phase` for a level, because "which of the two
   * questions was this level asked" is exactly what an interception changes: a level that intercepts is
   * asked `intercept` and *not* asked to handle, and a level below an interceptor is not asked at all.
   */
  private ledgerEntries(): Array<[string, string, number]> {
    const out: Array<[string, string, number]> = [];
    for (const node of [...this.ledger.keys()].sort()) {
      const phases = this.ledger.get(node);
      if (!phases) {
        continue;
      }
      for (const [phase, count] of [...phases].sort()) {
        out.push([node, phase, count]);
      }
    }
    return out;
  }

  /** `leaf.down=2+leaf.move=7+l2.intercept.down=3` — who was asked what, and how often. */
  private formatLedger(): string {
    const parts = this.ledgerEntries().map(([node, phase, count]) => `${node}.${phase}=${count}`);
    return parts.join('+') || 'none';
  }

  /**
   * `window.chain` — the probe an acceptance run drives the page with.
   *
   * `state()` and `deliveries()` are the two readouts the matrix leans on: the first says where the
   * event went, the second says who was asked and how often (a node missing from the ledger is a node
   * the chain never reached, which is the whole point of an interception).
   */
  private installProbes(): void {
    const scene = this;
    (window as unknown as { chain?: unknown }).chain = {
      state: (): Record<string, unknown> => ({
        consume: [...scene.consume].sort(),
        intercept: [...scene.intercept].sort(),
        threshold: scene.threshold,
        disallow: scene.disallow,
        clicks: scene.clicks,
        traces: scene.traces,
        moves: scene.moves,
        cancels: scene.cancels,
        chains: scene.mvvm.input.chains(),
        last: scene.last === null ? null : scene.traceSummary(scene.last),
      }),
      /** The last dispatch as `phase:node.action1>…|stop`. */
      last: (): string => (scene.last ? scene.formatEntries(scene.last) : 'none'),
      /** The recent dispatches, oldest first. */
      log: (): string[] => [...scene.log],
      clearLog: (): void => {
        scene.log.length = 0;
        scene.traces = 0;
        scene.syncState();
      },
      /** `node.phase=count`, the delivery ledger. */
      deliveries: (): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const [node, phase, count] of scene.ledgerEntries()) {
          out[`${node}.${phase}`] = count;
        }
        return out;
      },
      /** Live page coordinates, what a real click needs. */
      points: (): Record<string, { x: number; y: number }> => scene.pagePoints(),
      /** The centre of one node, in page coordinates. */
      point: (name: string): { x: number; y: number } | null => scene.pagePoints()[name] ?? null,
      setConsume: (name: string, on: boolean): void => {
        if (on) {
          scene.consume.add(name);
        } else {
          scene.consume.delete(name);
        }
        scene.refreshAppearance();
        scene.refreshControlLabels();
        scene.syncState();
      },
      setIntercept: (name: string, on: boolean): void => {
        if (on) {
          scene.intercept.add(name);
        } else {
          scene.intercept.delete(name);
        }
        scene.refreshAppearance();
        scene.refreshControlLabels();
        scene.syncState();
      },
      setThreshold: (px: number): void => {
        scene.threshold = px;
        scene.refreshControlLabels();
        scene.syncState();
      },
      setDisallow: (on: boolean): void => {
        scene.disallow = on;
        scene.refreshControlLabels();
        scene.syncState();
      },
      /** Ends whatever gesture is in flight, the way a scene switch would. */
      cancelGesture: (): void => scene.cancelGesture(),
      reset: (): void => scene.reset(),
      counts: (): Record<string, number> => ({
        clicks: scene.clicks,
        traces: scene.traces,
        moves: scene.moves,
        cancels: scene.cancels,
        chains: scene.mvvm.input.chains().length,
      }),
      /** How many widgets the scene owns, so a churn test can prove nothing leaked. */
      widgets: (): number => {
        let count = 0;
        const visit = (widget: Widget): void => {
          count++;
          for (const child of widget.getWidgetChildren()) {
            visit(child);
          }
        };
        visit(scene.mvvm.root);
        return count;
      },
    };
  }

  /** Live page coordinates of every node, which is what a real click needs. */
  private pagePoints(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const [name, widget] of this.nodes) {
      if (widget.isDestroyed) {
        continue;
      }
      const point = pagePoint(this.game, widget);
      out[name] = { x: Math.round(point.x), y: Math.round(point.y) };
    }
    return out;
  }

  /** The `state()` shape for one trace, without the live objects. */
  private traceSummary(trace: PointerChainTrace): Record<string, unknown> {
    return {
      phase: trace.phase,
      stop: trace.stop,
      handledBy: trace.handledBy ? (trace.handledBy.chainLabel ?? 'anonymous') : null,
      hitTarget: trace.hitTarget ? (trace.hitTarget.chainLabel ?? 'anonymous') : null,
      owner: trace.owner ? (trace.owner.chainLabel ?? 'anonymous') : null,
      pathLength: trace.pathLength,
      cancelReason: trace.cancelReason,
      entries: trace.entries.map((entry) => ({
        node: entry.label,
        action: entry.action,
        result: entry.result,
        disallowed: entry.disallowed === true,
        depth: entry.depth,
      })),
    };
  }
}
