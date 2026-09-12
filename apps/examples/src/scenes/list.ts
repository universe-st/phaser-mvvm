/**
 * List / `Repeat` demo (M6): a virtualised, keyed, filtered list of 220 rows.
 *
 * What it exercises:
 * - `Repeat` with `virtualize: true` — only the visible window (plus overscan) is mounted, and the
 *   mounted rows are reused when the window keeps the same keys (keyed diff, no rebuild). What
 *   "reuse" means precisely is asserted with `listDemo.created()`: stepping the window one row at a
 *   time builds exactly one row per step, deleting a row builds none, and swapping two rows inside
 *   the window builds none either — while a shuffle (which brings *different* rows into the window)
 *   necessarily builds the ones that entered;
 * - `BindingContext` with `bindTemplate` / `bindPath` / `bindTemplateText`, so every row reads
 *   `$item`, `$index` and — through `$root`/`$parent` — the page view model;
 * - `bindModel` for the two-way filter field, and `bindCommand` with a **path** `canExecute` on the
 *   Clear button (the M6 overload: `bindCommand(host, context, 'commands.clear', { canExecute })`);
 * - everything a Playwright check needs is published into `#demo-state` (`total`, `rendered`,
 *   `first`, `last`, `filter`, `deleted`, `focus`) plus the click points `pt.add`, `pt.shuffle`,
 *   `pt.clear`, `pt.filter` and `pt.rowdelete` (the first visible row's Delete button).
 */

import Phaser from 'phaser';
import { BindingContext, computed, ref } from '@phaser-mvvm/core';
import {
  bindCommand,
  bindModel,
  bindPath,
  bindTemplate,
  bindTemplateText,
  themeListenerCount,
} from '@phaser-mvvm/phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import type { Button, Label, Panel, Repeat, ScrollView } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import {
  appendStatus,
  displayScale,
  pageOrigin,
  pagePoint,
  reportCanvas,
  reportWidget,
  stagePosition,
} from '../status';

/** One fake row of the list. */
interface RowItem {
  id: string;
  name: string;
  score: number;
}

/** Rows the demo starts with (the point of the demo is that only a handful are ever mounted). */
const INITIAL_ROWS = 220;

/** Row geometry: `itemExtent` is the row height *including* the flow gap between rows. */
const ROW_HEIGHT = 34;
const ROW_GAP = 4;
const ITEM_EXTENT = ROW_HEIGHT + ROW_GAP;
const OVERSCAN = 3;

/** List viewport (design pixels) and the surrounding panel geometry. */
const LIST_HEIGHT = 408;
const LIST_WIDTH = 560;
const PANEL_PADDING = 8;
const PAGE_WIDTH = 900;
const PAGE_PADDING = 16;

/** Deterministic name/score generator, so the demo looks the same on every run. */
function createItems(count: number, from = 0): RowItem[] {
  const items: RowItem[] = [];
  for (let index = 0; index < count; index++) {
    const id = from + index;
    items.push({
      id: `p${String(id).padStart(3, '0')}`,
      name: `Player ${String(id).padStart(3, '0')}`,
      score: ((id * 7919) % 500) + 25 * (id % 4),
    });
  }
  return items;
}

export class ListScene extends Phaser.Scene {
  // ------------------------------------------------------------------ view model

  private readonly allItems = ref<RowItem[]>(createItems(INITIAL_ROWS));
  private readonly filterText = ref('');
  private readonly deleted = ref(0);
  private readonly renderedCount = ref(0);
  private nextId = INITIAL_ROWS;
  private shuffleSeed = 20_260_901;
  /**
   * How many row templates have been *built* since the scene started.
   *
   * The whole point of a virtualised list is that this stays small while the list is scrolled: a
   * window that moves by 10 rows must build about 10 rows, not 220. Without the counter that claim is
   * unverifiable — `rendered` only says how many are mounted *now*.
   */
  private rowsCreated = 0;

  /** What the list actually shows: the source filtered by `filterText`. */
  private readonly filtered = computed<readonly RowItem[]>(() => {
    const needle = this.filterText.value.trim().toLowerCase();
    const items = this.allItems.value;
    if (needle.length === 0) {
      return items;
    }
    return items.filter((item) => item.name.toLowerCase().includes(needle));
  });

  /** View model the page bindings resolve against (built in `create()`). */
  private vm: Record<string, unknown> | null = null;

  // ------------------------------------------------------------------ scene state

  private pageContext: BindingContext | null = null;
  private repeat: Repeat<RowItem> | null = null;
  private listScroll: ScrollView | null = null;
  private page: Panel | null = null;
  private readonly reported = new Map<string, string>();

  constructor() {
    super('list');
  }

  create(): void {
    const theme = this.mvvm.theme;
    const scene = this;
    // Every entry is a getter over reactive state, so a binding that reads `total` re-runs exactly
    // when the list or the filter changes. (`this` inside an object literal is the literal itself,
    // hence the captured `scene`.)
    this.vm = {
      get total(): number {
        return scene.filtered.value.length;
      },
      get source(): number {
        return scene.allItems.value.length;
      },
      get rendered(): number {
        return scene.renderedCount.value;
      },
      get filter(): string {
        return scene.filterText.value;
      },
      get deleted(): number {
        return scene.deleted.value;
      },
      get first(): string {
        return scene.repeat?.getRenderedKeys()[0] ?? '';
      },
      get last(): string {
        const keys = scene.repeat?.getRenderedKeys() ?? [];
        return keys[keys.length - 1] ?? '';
      },
      get hasItems(): boolean {
        return scene.filtered.value.length > 0;
      },
      commands: {
        clear: (): void => scene.clearItems(),
      },
    };
    this.pageContext = new BindingContext(this.vm);
    this.reported.clear();

    // Toolbar -------------------------------------------------------------------------------------
    const addButton = this.add.uiButton({
      text: 'Add row',
      variant: 'primary',
      name: 'add',
      onClick: () => this.addItem(),
    });
    const shuffleButton = this.add.uiButton({
      text: 'Shuffle',
      variant: 'secondary',
      name: 'shuffle',
      onClick: () => this.shuffleItems(),
    });
    const clearButton = this.add.uiButton({
      text: 'Clear',
      variant: 'secondary',
      name: 'clear',
    });
    const filterField = this.add.uiTextField({
      placeholder: 'Filter by name…',
      width: 220,
      clearable: true,
      name: 'filter',
    });
    const counterLabel = this.add.uiLabel({
      text: '',
      tone: 'primary',
      align: 'right',
      width: 220,
      style: { fontSize: `${theme.fontSize.md}px` },
    });

    const toolbar = this.add.uiPanel(
      { direction: 'horizontal', gap: 8, alignItems: 'center', width: 'fill', variant: 'plain' },
      [
        addButton,
        shuffleButton,
        clearButton,
        filterField,
        this.add.uiSpacer({ flex: true }),
        counterLabel,
      ],
    );

    // List ----------------------------------------------------------------------------------------
    const list = this.add.uiRepeat<RowItem>({
      items: () => this.filtered.value,
      key: (item) => item.id,
      template: (item, index, context) => this.createRow(item, index, context),
      // 220 rows, but only the visible window (plus overscan) is ever mounted.
      virtualize: true,
      itemExtent: ITEM_EXTENT,
      overscan: OVERSCAN,
      container: { direction: 'vertical', gap: ROW_GAP },
      // Shown when the filter matches nothing (or after Clear).
      empty: () =>
        this.add.uiLabel({
          text: 'No rows match the filter',
          tone: 'muted',
          align: 'center',
          width: LIST_WIDTH - 2 * PANEL_PADDING,
          height: 40,
        }),
      height: LIST_HEIGHT,
      width: 'fill',
      context: this.pageContext,
      name: 'list.repeat',
    });
    this.repeat = list;

    // The list content: a plain box the scroll view owns. The Repeat keeps positioning its rows in
    // content coordinates (index x itemExtent, padded by fillers); the scroll view translates this
    // holder by the offset and clips it, which is what actually moves the rows on screen.
    const listContent = this.add.uiPanel(
      { direction: 'vertical', width: 'fill', height: 'fill', variant: 'plain' },
      [list],
    );
    const listScroll = this.add.uiScroll({
      width: 'fill',
      height: 'fill',
      direction: 'vertical',
      scrollbar: 'auto',
      content: listContent,
      name: 'list.scroll',
    });
    this.listScroll = listScroll;

    const listPanel = this.add.uiPanel(
      {
        direction: 'vertical',
        padding: PANEL_PADDING,
        width: LIST_WIDTH,
        height: LIST_HEIGHT + 2 * PANEL_PADDING,
        variant: 'surface',
        radius: 10,
      },
      [listScroll],
    );

    // Side panel: the same numbers as `#demo-state`, bound through `{{ … }}` templates -------------
    const grid = this.add.uiGrid(
      {
        columns: 2,
        columnGap: 10,
        rowGap: 6,
        width: 'fill',
        alignItems: 'center',
        justifyItems: 'stretch',
      },
      [
        this.add.uiLabel({ text: 'total', tone: 'muted' }),
        this.valueLabel('{{ total }} rows'),
        this.add.uiLabel({ text: 'rendered', tone: 'muted' }),
        this.valueLabel('{{ rendered }} mounted'),
        this.add.uiLabel({ text: 'filter', tone: 'muted' }),
        this.valueLabel('{{ filter | default("(none)") }}'),
        this.add.uiLabel({ text: 'deleted', tone: 'muted' }),
        this.pathLabel('deleted', (value) => `${String(value)} removed`),
        this.add.uiLabel({ text: 'first key', tone: 'muted' }),
        this.valueLabel('{{ first }}'),
        this.add.uiLabel({ text: 'last key', tone: 'muted' }),
        this.valueLabel('{{ last }}'),
      ],
    );

    const sidePanel = this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 10,
        padding: 14,
        variant: 'surfaceAlt',
        radius: 10,
        width: PAGE_WIDTH - 2 * PAGE_PADDING - LIST_WIDTH - 12,
      },
      [
        this.add.uiLabel({
          text: 'M6 · binding + repeat',
          style: { fontSize: `${theme.fontSize.lg}px` },
        }),
        grid,
        this.add.uiDivider({}),
        this.add.uiLabel({
          text: `${INITIAL_ROWS} rows, virtualised: only the visible window is mounted.`,
          tone: 'muted',
          maxLines: 3,
          width: 240,
        }),
        this.add.uiLabel({
          text:
            'Shuffle reorders the whole source, so the window then shows other rows and those get built. ' +
            'Swapping two rows *inside* the window reuses the mounted ones (listDemo.swapVisible()).',
          tone: 'muted',
          maxLines: 5,
          width: 240,
        }),
      ],
    );

    const body = this.add.uiPanel(
      { direction: 'horizontal', gap: 12, alignItems: 'start', width: 'fill' },
      [listPanel, sidePanel],
    );

    this.page = this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 12,
        padding: PAGE_PADDING,
        variant: 'plain',
        alignItems: 'stretch',
        width: PAGE_WIDTH,
      },
      [toolbar, body],
    );

    // Bindings ------------------------------------------------------------------------------------
    bindTemplateText(counterLabel, this.pageContext, 'rendered {{ rendered }} / {{ total }}');
    bindModel(
      filterField,
      () => this.filterText.value,
      (value) => {
        this.filterText.value = value;
      },
    );
    // Command **path** + `canExecute` path: both come from the view model, and the button disables
    // itself as soon as the (filtered) list is empty.
    bindCommand(clearButton, this.pageContext, 'commands.clear', { canExecute: 'hasItems' });

    this.mvvm.mount(this.page);

    const page = this.page;
    for (const [key, widget] of [
      ['add', addButton],
      ['shuffle', shuffleButton],
      ['clear', clearButton],
      ['filter', filterField],
    ] as const) {
      reportControl(this, key, widget);
    }
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    appendStatus('--- list layout ---');
    reportWidget('page', page);
    reportWidget('toolbar', toolbar);
    reportWidget('list', listPanel);
    reportWidget('listScroll', listScroll);
    reportWidget('repeat', list as never);
    reportWidget('side', sidePanel);
    reportCanvas(this.game);

    setDemoState('scene', 'list');
    setDemoState('filter', '');
    setDemoState('deleted', 0);
    this.publishState();

    // In-page handle for Playwright: the demo state is the primary channel, this is the escape hatch
    // for geometry questions (row rects, rendered keys) that do not fit a `key=value` line.
    (window as unknown as { listDemo?: unknown }).listDemo = {
      renderedKeys: (): string[] => this.repeat?.getRenderedKeys() ?? [],
      firstRowDeletePoint: (): { x: number; y: number } | null => this.deletePoint(),
      totals: (): Record<string, number> => ({
        total: this.filtered.value.length,
        rendered: this.repeat?.renderedCount ?? 0,
        source: this.allItems.value.length,
        created: this.rowsCreated,
      }),
      /** Rows built since the scene started — the virtualisation claim as a number. */
      created: (): number => this.rowsCreated,
      offset: (): number => Math.round(this.listScroll?.offset ?? 0),
      maxOffset: (): number => Math.round(this.listScroll?.maxOffset ?? 0),
      /** Scrolls the port to an absolute offset (0..maxOffset). */
      scrollTo: (y: number): number => {
        this.listScroll?.scrollTo(y);
        return Math.round(this.listScroll?.offset ?? 0);
      },
      /** Scrolls by whole rows, which is what a check usually wants to reason about. */
      scrollRows: (rows: number): number => {
        this.listScroll?.scrollTo(rows * ITEM_EXTENT);
        return Math.round(this.listScroll?.offset ?? 0);
      },
      window: (): { first: string; last: string; rendered: number } => {
        const keys = this.repeat?.getRenderedKeys() ?? [];
        return {
          first: keys[0] ?? '',
          last: keys[keys.length - 1] ?? '',
          rendered: keys.length,
        };
      },
      /**
       * Page coordinates of a row's Delete button, **only when that row is inside the port**.
       *
       * A virtualised list mounts `overscan` rows outside the viewport, and those are not clickable
       * (the port's clip takes them out of hit testing, V23) — a check that aims at one gets "the click
       * did nothing" for the wrong reason. `pointMounted()` is the raw version, for geometry questions.
       */
      point: (key: string): string => {
        const at = this.rowPoint(key, true);
        return at ? `@${at.x},${at.y}` : 'none';
      },
      pointMounted: (key: string): string => {
        const at = this.rowPoint(key, false);
        return at ? `@${at.x},${at.y}` : 'none';
      },
      /** Keys whose row is mounted *and* inside the port: what the user can actually click. */
      visibleKeys: (): string[] => this.visibleKeys(),
      /** The port's stage rect in page coordinates. */
      viewport: (): { x: number; y: number; width: number; height: number } | null => {
        const scroll = this.listScroll;
        if (!scroll) {
          return null;
        }
        const origin = pageOrigin(this.game, scroll);
        return {
          x: Math.round(origin.x),
          y: Math.round(origin.y),
          width: Math.round(scroll.appliedRect.width),
          height: Math.round(scroll.appliedRect.height),
        };
      },
      click: (key: string): boolean => {
        this.deleteItem(key);
        return true;
      },
      add: (): void => this.addItem(),
      shuffle: (): void => this.shuffleItems(),
      /**
       * Swaps the items of two rows that are *inside* the port.
       *
       * This is the case where keyed reuse has to hold: the window shows the same keys in a different
       * order, so the mounted rows are reused and simply re-ordered — `created` must not grow.
       * (`shuffle()` reorders the whole source, so the window then shows *different* rows and those
       * are built; that is a different property, and the demo used to claim otherwise.)
       */
      swapVisible: (a = 0, b = 1): boolean => {
        const keys = this.visibleKeys();
        const keyA = keys[a];
        const keyB = keys[b];
        if (keyA === undefined || keyB === undefined) {
          return false;
        }
        const items = this.allItems.value.slice();
        const indexA = items.findIndex((item) => item.id === keyA);
        const indexB = items.findIndex((item) => item.id === keyB);
        if (indexA === -1 || indexB === -1) {
          return false;
        }
        const first = items[indexA] as RowItem;
        items[indexA] = items[indexB] as RowItem;
        items[indexB] = first;
        this.allItems.value = items;
        return true;
      },
      clear: (): void => this.clearItems(),
      filter: (text: string): void => {
        this.filterText.value = text;
      },
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      counts: (): ListCounts => this.counts(),
      /** Scrolls through `n` windows and back, so a leak in row recycling shows up as a counter drift. */
      /**
       * Replaces the list with `n` items (PLAN §M7's "5000 items at 60 fps" claim needs a way to get
       * there). The window is recomputed and only the visible rows are built, however large `n` is.
       */
      setTotal: (n: number): number => {
        this.nextId = n;
        this.allItems.value = createItems(n);
        this.publishState();
        return this.filtered.value.length;
      },
      /**
       * Measures the frame budget **while the list is being scrolled**, which is what PLAN §M7's
       * "5000 items at 60 fps" claim is about.
       *
       * The driver advances the offset by one row from inside `requestAnimationFrame`, so what is
       * sampled is the *interval between frames* — i.e. the framework's own cost (layout +
       * virtualisation + render). A `while` loop calling `performance.now()` would only measure how
       * fast `scrollTo()` returns, which is not the question.
       *
       * Async, and it resolves with the frame intervals plus what the renderer had to do during the run.
       */
      perf: (options: { frames?: number; step?: number } = {}): Promise<Record<string, number>> => {
        const scroll = this.listScroll;
        if (!scroll) {
          return Promise.resolve({ frames: 0 });
        }
        const frames = Math.max(10, Math.floor(options.frames ?? 180));
        const step = options.step ?? ITEM_EXTENT;
        const createdBefore = this.rowsCreated;
        const engine = this.mvvm.root.layoutEngine;
        const statsBefore = { ...engine.stats };
        const samples: number[] = [];
        let offset = scroll.offset;
        return new Promise((resolve) => {
          let previous = 0;
          const tick = (now: number): void => {
            if (previous > 0) {
              samples.push(now - previous);
            }
            previous = now;
            offset = (offset + step) % Math.max(1, scroll.maxOffset);
            scroll.scrollTo(offset);
            if (samples.length < frames) {
              requestAnimationFrame(tick);
              return;
            }
            const sorted = [...samples].sort((a, b) => a - b);
            const at = (fraction: number): number =>
              sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
            resolve({
              frames: sorted.length,
              median: Number(at(0.5).toFixed(2)),
              p95: Number(at(0.95).toFixed(2)),
              max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
              fps: Number((1000 / (at(0.5) || 16.67)).toFixed(1)),
              created: this.rowsCreated - createdBefore,
              rendered: this.repeat?.renderedCount ?? 0,
              // The layout side of the claim: a virtualised list must not re-measure 5000 rows per
              // frame, so these counters are part of the measurement, not decoration.
              measureCalls: engine.stats.measureCalls - statsBefore.measureCalls,
              arrangeCalls: engine.stats.arrangeCalls - statsBefore.arrangeCalls,
              layoutPasses: engine.stats.passes - statsBefore.passes,
              cacheHits: engine.stats.cacheHits - statsBefore.cacheHits,
            });
          };
          requestAnimationFrame(tick);
        });
      },
      churn: (
        n: number,
      ): {
        before: ListCounts;
        after: ListCounts;
        created: number;
      } => {
        // Both snapshots have to describe the **same window**, and the window depends on the offset: at
        // the very top the leading overscan is clamped away (14 rows), in the middle both pads apply
        // (17). Taking `before` wherever the page happened to be and `after` back at the top compared
        // 17 mounted rows against 14 and read like a leak of ~13 widgets that did not exist (found in
        // round 77 by calling `perf()` first, which leaves the list scrolled). Normalising the offset
        // first makes the gate independent of whatever ran before it.
        this.listScroll?.scrollTo(0);
        // The router re-collects its target list on the next frame after a structural change, so a
        // synchronous reading here would catch it mid-update (measured: 19 targets instead of 25).
        // Asking for the refresh makes the leak gate deterministic instead of frame-timing dependent.
        this.mvvm.refreshInteraction();
        // Warm-up scroll *before* the snapshot, and it is not cosmetic: the very first scroll of a page
        // does one-time work (the window grows past the clamped leading overscan, and the scroll bar
        // appears) which shows up as a single step in the counts — measured `themeListeners` 91 → 92 on
        // a freshly loaded page, only on the first call, and only when the page had not scrolled yet.
        // Without this the gate compared across that step and read it as a leak whenever the run happened
        // to start before the first scroll (the 21-scene sweep hit exactly that). Same family as the offset
        // normalisation above: a leak gate must not depend on what ran before it.
        this.listScroll?.scrollTo(ITEM_EXTENT * 6);
        this.listScroll?.scrollTo(0);
        this.mvvm.refreshInteraction();
        const before = this.counts();
        const createdBefore = this.rowsCreated;
        for (let i = 0; i < n; i++) {
          this.listScroll?.scrollTo(((i + 1) % 10) * ITEM_EXTENT);
        }
        this.listScroll?.scrollTo(0);
        this.mvvm.refreshInteraction();
        const after = this.counts();
        return { before, after, created: this.rowsCreated - createdBefore };
      },
      state: (): Record<string, unknown> => {
        const keys = this.repeat?.getRenderedKeys() ?? [];
        return {
          total: this.filtered.value.length,
          source: this.allItems.value.length,
          rendered: keys.length,
          first: keys[0] ?? '',
          last: keys[keys.length - 1] ?? '',
          created: this.rowsCreated,
          offset: Math.round(this.listScroll?.offset ?? 0),
          maxOffset: Math.round(this.listScroll?.maxOffset ?? 0),
          filter: this.filterText.value,
          deleted: this.deleted.value,
          focus: this.mvvm.focus.focusedWidget?.name || 'none',
          count: this.counts(),
        };
      },
    };
  }

  /** Publishes the numbers the Playwright check asserts on; called once per frame. */
  override update(): void {
    this.publishState();
  }

  /** Live-object counters used as the leak gate of `docs/ACCEPTANCE-list.md`. */
  private counts(): ListCounts {
    return {
      widgets: this.page && !this.page.isDestroyed ? countWidgets(this.page) : 0,
      themeListeners: themeListenerCount(),
      pointerTargets: this.mvvm.input.widgets.length,
      focusables: this.mvvm.focus.focusables.length,
    };
  }

  /** Keys whose row is mounted *and* whose centre is inside the port. */
  private visibleKeys(): string[] {
    return (this.repeat?.getRenderedKeys() ?? []).filter(
      (key) => this.rowPoint(key, true) !== null,
    );
  }

  /**
   * Page coordinates of a row's Delete button, or `null` when it is not there (or, with `insidePort`,
   * when the row is mounted but scrolled outside the viewport).
   */
  private rowPoint(key: string, insidePort: boolean): { x: number; y: number } | null {
    const widget = this.findWidget(`row.delete.${key}`);
    const scroll = this.listScroll;
    if (!widget || !scroll || widget.appliedRect.width <= 0) {
      return null;
    }
    const centre = pagePoint(this.game, widget);
    const x = Math.round(centre.x);
    const y = Math.round(centre.y);
    if (!insidePort) {
      return { x, y };
    }
    // The visible band of the port, in the same page pixels.
    const scale = displayScale(this.game);
    const portOrigin = pageOrigin(this.game, scroll);
    const top = portOrigin.y;
    const bottom = top + scroll.appliedRect.height * scale.y;
    return y >= top && y <= bottom ? { x, y } : null;
  }

  /** Depth-first search for a named widget inside the page. */
  private findWidget(name: string): Widget | null {
    const root = this.page;
    if (!root) {
      return null;
    }
    const visit = (widget: Widget): Widget | null => {
      if (widget.name === name) {
        return widget;
      }
      for (const child of widget.getWidgetChildren()) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return visit(root);
  }

  // ------------------------------------------------------------------ rows

  private createRow(item: RowItem, index: number, context: BindingContext): Widget {
    this.rowsCreated += 1;
    const row = this.add.uiPanel({
      direction: 'horizontal',
      gap: 6,
      padding: { left: 10, right: 6, top: 0, bottom: 0 },
      alignItems: 'center',
      height: ROW_HEIGHT,
      variant: index % 2 === 0 ? 'surfaceAlt' : 'surface',
      radius: 6,
      blockPointer: false,
      name: `row.${item.id}`,
    });

    const name = this.add.uiLabel({ width: 220, height: 20 });
    bindTemplateText(name, context, '#{{ $index }} · {{ $item.name }}');

    const score = this.add.uiLabel({ width: 90, height: 20, tone: 'muted', align: 'right' });
    bindTemplateText(score, context, '{{ $item.score }} pts');

    const remove = this.add.uiButton({
      text: 'Delete',
      variant: 'danger',
      size: 'sm',
      width: 74,
      height: 24,
      name: `row.delete.${item.id}`,
      onClick: () => this.deleteItem(item.id),
    });

    row.addWidget(name);
    row.addWidget(score);
    row.addWidget(remove);
    return row;
  }

  /** A label bound to `{{ … }}` templates of the page context. */
  private valueLabel(template: string): Label {
    const label = this.add.uiLabel({ text: '', width: 120 });
    if (this.pageContext) {
      bindTemplate(label, this.pageContext, template, (text, widget) => {
        (widget as Label).setText(text);
      });
    }
    return label;
  }

  /** A label bound to a single path of the page context (`bindPath`, no template parsing). */
  private pathLabel(path: string, format: (value: unknown) => string): Label {
    const label = this.add.uiLabel({ text: '', width: 120 });
    if (this.pageContext) {
      bindPath(label, this.pageContext, path, (value, widget) => {
        (widget as Label).setText(format(value));
      });
    }
    return label;
  }

  // ------------------------------------------------------------------ actions

  private addItem(): void {
    const [item] = createItems(1, this.nextId);
    this.nextId += 1;
    if (item) {
      this.allItems.value.push(item);
    }
    this.publishState();
  }

  /**
   * Deterministic shuffle: a seeded Fisher–Yates, plus a guard that the new head really differs from
   * the old one, so "did the order change?" is a reliable signal for the browser check.
   */
  private shuffleItems(): void {
    const items = this.allItems.value.slice();
    if (items.length < 2) {
      return;
    }
    this.shuffleSeed = (this.shuffleSeed * 1_103_515_245 + 12_345) % 2_147_483_648;
    let state = this.shuffleSeed;
    const random = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const head = items[0]?.id;
    for (let index = items.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      const current = items[index] as RowItem;
      items[index] = items[swap] as RowItem;
      items[swap] = current;
    }
    if (items[0]?.id === head) {
      const first = items[0] as RowItem;
      items[0] = items[1] as RowItem;
      items[1] = first;
    }
    this.allItems.value = items;
    this.publishState();
  }

  private clearItems(): void {
    this.allItems.value = [];
    this.publishState();
  }

  private deleteItem(id: string): void {
    const items = this.allItems.value;
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    items.splice(index, 1);
    this.deleted.value += 1;
    this.publishState();
  }

  // ------------------------------------------------------------------ reporting

  /**
   * Mirrors the list state into `#demo-state` (only when it changed) and into `renderedCount`, which
   * the bound counter label reads — `Repeat.renderedCount` is plain state, so it needs one write
   * into a ref to become reactive for the template binding.
   */
  private publishState(): void {
    const repeat = this.repeat;
    const total = this.filtered.value.length;
    const rendered = repeat?.renderedCount ?? 0;
    const keys = repeat?.getRenderedKeys() ?? [];

    if (this.renderedCount.value !== rendered) {
      this.renderedCount.value = rendered;
    }

    this.publish('total', total);
    this.publish('rendered', rendered);
    this.publish('first', keys[0] ?? '');
    this.publish('last', keys[keys.length - 1] ?? '');
    this.publish('filter', this.filterText.value);
    this.publish('deleted', this.deleted.value);
    this.publish('created', this.rowsCreated);
    this.publish('offset', Math.round(this.listScroll?.offset ?? 0));
    this.publish('maxOffset', Math.round(this.listScroll?.maxOffset ?? 0));

    const point = this.deletePoint();
    if (point) {
      this.publish('pt.rowdelete', `@${point.x},${point.y}`);
    }
  }

  private publish(key: string, value: string | number): void {
    const text = String(value);
    if (this.reported.get(key) === text) {
      return;
    }
    this.reported.set(key, text);
    setDemoState(key, value);
  }

  /** Page coordinates of the first visible row's Delete button. */
  private deletePoint(): { x: number; y: number } | null {
    const repeat = this.repeat;
    const scroll = this.listScroll;
    if (!repeat || !scroll) {
      return null;
    }
    // The first *mounted* row is not the first *visible* one: a virtualised list also mounts
    // `overscan` rows above the viewport, and those sit outside the scroll view's clip.
    const viewport = stagePosition(scroll);
    const viewportBottom = viewport.y + scroll.appliedRect.height;

    for (const key of repeat.getRenderedKeys()) {
      const row = repeat.getWidgetForKey(key);
      if (row === null) {
        continue;
      }
      const centre = stagePosition(row).y + row.appliedRect.height / 2;
      if (centre < viewport.y || centre > viewportBottom) {
        continue;
      }
      const button = row
        .getWidgetChildren()
        .find((child) => child.name.startsWith('row.delete.')) as Button | undefined;
      if (button === undefined || button.appliedRect.width <= 0) {
        continue;
      }
      return {
        x: Math.round(pagePoint(this.game, button).x),
        y: Math.round(pagePoint(this.game, button).y),
      };
    }
    return null;
  }
}

/** Live-object counters sampled by the leak gate. */
interface ListCounts {
  widgets: number;
  themeListeners: number;
  pointerTargets: number;
  focusables: number;
}

/** Number of widgets in a subtree, the root included (used by the leak counters). */
function countWidgets(root: Widget): number {
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
