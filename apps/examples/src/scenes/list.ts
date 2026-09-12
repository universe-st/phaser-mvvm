/**
 * List / `Repeat` demo (M6): a virtualised, keyed, filtered list of 220 rows.
 *
 * What it exercises:
 * - `Repeat` with `virtualize: true` — only the visible window (plus overscan) is mounted, and the
 *   mounted `Panel` rows are reused across add / delete / shuffle (keyed diff, no rebuild);
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
} from '@phaser-mvvm/phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import type { Button, Label, Panel, Repeat } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

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

    const listPanel = this.add.uiPanel(
      {
        direction: 'vertical',
        padding: PANEL_PADDING,
        width: LIST_WIDTH,
        height: LIST_HEIGHT + 2 * PANEL_PADDING,
        variant: 'surface',
        radius: 10,
      },
      [list],
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
          text: 'Shuffle keeps every mounted row (keyed reuse); Clear disables itself when the list is empty.',
          tone: 'muted',
          maxLines: 4,
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

    // Wheel scrolling drives the virtual window directly: only the rows that enter the viewport are
    // mounted, the fillers keep the rest of the list's height (M6 ships no `ScrollView` yet).
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_pointer: unknown, _objects: unknown, _dx: number, dy: number) => {
        list.setScrollOffset(list.offset + dy);
      },
    );

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
      }),
    };
  }

  /** Publishes the numbers the Playwright check asserts on; called once per frame. */
  override update(): void {
    this.publishState();
  }

  // ------------------------------------------------------------------ rows

  private createRow(item: RowItem, index: number, context: BindingContext): Widget {
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
    if (!repeat) {
      return null;
    }
    const key = repeat.getRenderedKeys()[0];
    if (key === undefined) {
      return null;
    }
    const row = repeat.getWidgetForKey(key);
    if (row === null) {
      return null;
    }
    const button = row.getWidgetChildren().find((child) => child.name.startsWith('row.delete.')) as
      Button | undefined;
    if (button === undefined || button.appliedRect.width <= 0) {
      return null;
    }
    const canvas = this.game.canvas.getBoundingClientRect();
    const origin = stagePosition(button);
    return {
      x: Math.round(canvas.left + origin.x + button.appliedRect.width / 2),
      y: Math.round(canvas.top + origin.y + button.appliedRect.height / 2),
    };
  }
}
