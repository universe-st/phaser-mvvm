/**
 * `#/options` — coverage for the widget options that **no other page** exercised.
 *
 * A round-87 audit cross-checked every option key in `packages/widgets` against the example app and
 * found a handful that only ever appeared in the widget's own source: `Repeat.update`,
 * `ScrollView.inertia`/`wheelSpeed`, `TextArea.submitOnEnter`, `Grid.autoFlow`/`minRowHeight` and
 * `Box.alignContent`. None of them was broken *by inspection* — and that is exactly the problem: the
 * `bounce` option looked fine by inspection too and had never worked (V55, found in round 86 the moment
 * a demo exercised it). Uncovered options are where a framework rots.
 *
 * So this page is deliberately one card per option family, each written as an **A/B** where the option
 * has a counterpart:
 *
 * - `Repeat.update` — one list updates a replaced item in place, one has no `update` and rebuilds it;
 * - `inertia: false` — a port that must stop dead when the finger lifts;
 * - `wheelSpeed: 2` — a port next to an identical one that keeps the default speed;
 * - `TextArea.submitOnEnter` — one area submits on Enter, the other inserts a line break;
 * - `Grid.autoFlow: 'column'` + `minRowHeight`, and `Row({ wrap, alignContent })` — geometry, reported
 *   per item so a check can assert the arrangement instead of looking at a screenshot.
 *
 * `#demo-state` publishes `upd.*`/`plain.*`/`ta.*`/`inertia.*`/`wheel.*` and `pt.<name>` for every
 * clickable probe; `window.optionsDemo` drives and reads it (see `docs/ACCEPTANCE-options.md` §7).
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { pointerClaims, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Column,
  Divider,
  Grid,
  List,
  Panel,
  Rect,
  Row,
  Scroll,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import type { TextField as TextFieldWidget, ScrollView } from '@phaser-mvvm/widgets';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget, stagePosition } from '../status';

/** Two-axis port: the content is wider *and* taller than the viewport, so both limits are real. */
const BOTH_VIEW_WIDTH = 300;
const BOTH_VIEW_HEIGHT = 170;
const BOTH_CONTENT_WIDTH = 700;
const BOTH_CONTENT_HEIGHT = 420;

interface OptionRow {
  id: string;
  label: string;
}

/** The same three rows for both lists, so the only difference is the `update` option. */
function makeRows(tag: string): OptionRow[] {
  return [1, 2, 3].map((index) => ({ id: `r${index}`, label: `${tag} ${index}` }));
}

export class OptionsScene extends Phaser.Scene {
  // --- Repeat.update ---------------------------------------------------------------------------
  private readonly updatedItems = ref<OptionRow[]>(makeRows('A'));
  private readonly plainItems = ref<OptionRow[]>(makeRows('B'));
  private updateCalls = 0;
  private updatedBuilds = 0;
  private plainBuilds = 0;
  private revision = 0;
  /** What each list is **painting**, read off the row widgets (not off the item source). */
  private readonly updatedPainted = new Map<string, { getText(): string }>();
  private readonly plainPainted = new Map<string, { getText(): string }>();

  // --- TextArea.submitOnEnter ------------------------------------------------------------------
  /** Area 1 uses the option (Enter submits); area 2 is the default (Enter adds a line). */
  private readonly submitOnEnterArea = ref('');
  private readonly defaultArea = ref('');
  private enterSubmits = 0;
  private ctrlSubmits = 0;

  // --- Scroll options --------------------------------------------------------------------------
  private readonly inertiaOffset = ref(0);
  private readonly wheelPlainOffset = ref(0);
  private readonly wheelFastOffset = ref(0);

  // --- ScrollView.direction: 'both' ------------------------------------------------------------
  /**
   * The reactive `offset` slot of the two-axis port. A scalar slot drives the **primary** axis (`y` for
   * `direction: 'both'`), so it is also where "does the per-frame write-back fight the other axis?" is
   * observable: the slot writes `y` every frame and `x` must be untouched by that (V56).
   */
  private readonly bothSlotY = ref(0);
  private bothScroll: ScrollView | null = null;
  private bothControl: ScrollView | null = null;
  private readonly bothEvents = new Map<string, number>();

  // --- drag selection on the pure-Canvas text path -------------------------------------------------
  /**
   * The card that measures the drag-ownership protocol: a `dom: false` field inside the page's own
   * `ScrollView` stage, next to a drag target that is *not* a field.
   *
   * The stage is what makes it a real test rather than a unit test in disguise: without the claim, a
   * drag across the text would scroll the page and select nothing (or both).
   */
  private readonly canvasSelection = ref('');
  private selectField: TextFieldWidget | null = null;

  /** The page's stage; the gesture cards live below the fold, so a check has to scroll to them. */
  private stage: ScrollView | null = null;

  private readonly tracked = new Map<string, Widget>();
  /** Widgets the cards want tracked; drained right after the section is built (`track()` needs them). */
  private readonly pendingTracked: Array<readonly [string, Widget]> = [];
  private readonly published = new Map<string, string>();

  constructor() {
    super('options');
  }

  create(): void {
    const page = ui(this, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 10,
          padding: 14,
          variant: 'plain',
          width: 'fill',
          height: 'fill',
          alignItems: 'stretch',
        },
        () => {
          Text('选项覆盖 · options with no other demo', {
            size: 'lg',
          });
          Text('每条都是 A/B：开了这个选项的一侧与没开的一侧并排，读数写进 #demo-state', {
            tone: 'muted',
          });
          Divider({});
          const stage = Scroll(
            { direction: 'vertical', width: 'fill', height: 'fill', name: 'options.stage' },
            () => {
              Column({ gap: 12, width: 'fill', alignItems: 'stretch' }, () => {
                this.updateCard();
                this.submitCard();
                this.inertiaCard();
                this.directionCard();
                this.selectionCard();
                this.gridCard();
                // Registered after the cards are built: `track()` needs the widget the lambda returned.
                for (const [key, widget] of this.pendingTracked) {
                  this.track(key, widget);
                }
                this.pendingTracked.length = 0;
              });
            },
          );
          this.stage = stage;
        },
      );
    });

    this.mvvm.mount(page);
    this.mvvm.focus.onFocusChange = (widget) => {
      this.publish('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    appendStatus('--- options · layout ---');
    reportCanvas(this.game);
    for (const key of [
      'options.updated',
      'options.plain',
      'options.inertia',
      'options.wheelPlain',
      'options.wheelFast',
      'options.wrapRow',
    ]) {
      const widget = this.tracked.get(key);
      if (widget) {
        reportWidget(key, widget);
      }
    }
    this.exposeGlobals();
  }

  /** `Repeat.update`: does a replaced item re-render in place, or is the row rebuilt? */
  private updateCard(): void {
    this.card('Repeat.update', '同一 key 换成新对象：给 update 的原地刷新，没给的销毁重建', () => {
      Row({ gap: 16, alignItems: 'start' }, () => {
        Column({ gap: 6, width: 260 }, () => {
          Text('with update', { tone: 'muted' });
          const list = List<OptionRow>(
            {
              items: () => this.updatedItems.value,
              key: (row) => row.id,
              gap: 4,
              height: 108,
              width: 'fill',
              name: 'options.updated',
              update: (widget, item) => {
                this.updateCalls += 1;
                const label = widget as unknown as { setText?: (text: string) => void };
                label.setText?.(item.label);
              },
            },
            (row) => {
              this.updatedBuilds += 1;
              const label = Text(() => row.label, { height: 32 });
              // The `update` callback writes through `setText`, so the painted text is the only honest
              // answer to "did the row change?" — the item source changed in both lists by construction.
              this.updatedPainted.set(row.id, label as unknown as { getText(): string });
            },
          );
          this.track('options.updated', list);
          Text(() => `update 调用 ${this.updateCalls} · 模板构建 ${this.updatedBuilds}`, {
            tone: 'muted',
          });
        });
        Column({ gap: 6, width: 260 }, () => {
          Text('without update', { tone: 'muted' });
          const list = List<OptionRow>(
            {
              items: () => this.plainItems.value,
              key: (row) => row.id,
              gap: 4,
              height: 108,
              width: 'fill',
              name: 'options.plain',
            },
            (row) => {
              this.plainBuilds += 1;
              const label = Text(() => row.label, { height: 32 });
              this.plainPainted.set(row.id, label as unknown as { getText(): string });
            },
          );
          this.track('options.plain', list);
          Text(() => `模板构建 ${this.plainBuilds}`, { tone: 'muted' });
        });
      });
      Row({ gap: 8 }, () => {
        this.track(
          'options.replace',
          Button('换数据（同 key，新对象）', {
            size: 'sm',
            variant: 'primary',
            name: 'options.replace',
            onClick: () => this.replaceItems(),
          }),
        );
      });
    });
  }

  /**
   * Replaces every item with a **new object** of the same key.
   *
   * `Repeat` compares items by identity (`Object.is`), which is what makes "same key, new value" a
   * distinguishable case from "same item": with `update` the row is refreshed in place, without it the
   * row is destroyed and rebuilt.
   */
  private replaceItems(): void {
    this.revision += 1;
    const tag = `A${this.revision}`;
    this.updatedItems.value = this.updatedItems.value.map((row, index) => ({
      id: row.id,
      label: `${tag} ${index + 1}`,
    }));
    this.plainItems.value = this.plainItems.value.map((row, index) => ({
      id: row.id,
      label: `B${this.revision} ${index + 1}`,
    }));
  }

  /** `TextArea.submitOnEnter`: Enter commits in one area and adds a line in the other. */
  private submitCard(): void {
    this.card(
      'TextArea.submitOnEnter',
      '默认 Enter 换行 / Ctrl+Enter 提交；开了选项就反过来',
      () => {
        Row({ gap: 16, alignItems: 'start' }, () => {
          Column({ gap: 6, width: 260 }, () => {
            Text('submitOnEnter: true', { tone: 'muted' });
            this.track(
              'options.submitArea',
              TextArea({
                value: this.submitOnEnterArea,
                rows: 3,
                submitOnEnter: true,
                width: 'fill',
                name: 'options.submitArea',
                label: '回车提交',
                onSubmit: () => {
                  this.enterSubmits += 1;
                },
              }),
            );
            Text(() => `Enter 提交 ${this.enterSubmits} 次`, { tone: 'muted' });
          });
          Column({ gap: 6, width: 260 }, () => {
            Text('默认（Ctrl+Enter 提交）', { tone: 'muted' });
            this.track(
              'options.defaultArea',
              TextArea({
                value: this.defaultArea,
                rows: 3,
                width: 'fill',
                name: 'options.defaultArea',
                label: '回车换行',
                onSubmit: () => {
                  this.ctrlSubmits += 1;
                },
              }),
            );
            Text(() => `Ctrl+Enter 提交 ${this.ctrlSubmits} 次`, { tone: 'muted' });
          });
        });
      },
    );
  }

  /** `inertia: false` and `wheelSpeed`. */
  private inertiaCard(): void {
    this.card(
      'ScrollView.inertia / wheelSpeed',
      '拖完立刻停 vs 惯性滑行；滚轮一格的距离倍率',
      () => {
        Row({ gap: 16, alignItems: 'start' }, () => {
          Column({ gap: 6, width: 200 }, () => {
            Text('inertia: false', { tone: 'muted' });
            this.track(
              'options.inertia',
              Scroll(
                {
                  height: 120,
                  width: 'fill',
                  direction: 'vertical',
                  inertia: false,
                  name: 'options.inertia',
                  offset: this.inertiaOffset,
                },
                () => this.filler(8),
              ),
            );
            Text(() => `offset ${Math.round(this.inertiaOffset.value)}`, { tone: 'muted' });
          });
          Column({ gap: 6, width: 200 }, () => {
            Text('wheelSpeed: 1（默认）', { tone: 'muted' });
            this.track(
              'options.wheelPlain',
              Scroll(
                {
                  height: 120,
                  width: 'fill',
                  direction: 'vertical',
                  name: 'options.wheelPlain',
                  offset: this.wheelPlainOffset,
                },
                () => this.filler(8),
              ),
            );
            Text(() => `offset ${Math.round(this.wheelPlainOffset.value)}`, { tone: 'muted' });
          });
          Column({ gap: 6, width: 200 }, () => {
            Text('wheelSpeed: 2', { tone: 'muted' });
            this.track(
              'options.wheelFast',
              Scroll(
                {
                  height: 120,
                  width: 'fill',
                  direction: 'vertical',
                  wheelSpeed: 2,
                  name: 'options.wheelFast',
                  offset: this.wheelFastOffset,
                },
                () => this.filler(8),
              ),
            );
            Text(() => `offset ${Math.round(this.wheelFastOffset.value)}`, { tone: 'muted' });
          });
        });
      },
    );
  }

  /**
   * `ScrollView.direction: 'both'` — the x half of the widget.
   *
   * The option has existed since M7 and no page had ever built a port with it, so the whole cross axis
   * was unproven on screen: its own limit (`maxOffsetX`), its own scrollbar, wheel `deltaX`, a diagonal
   * drag, and — the part that has bitten this widget before — whether a **focus reveal** and the
   * **per-frame `offset` slot** respect the axis they do not own.
   *
   * A/B: two ports with the same 700×420 content and the same 300×170 viewport; the left one is
   * `vertical` (the control, whose `x` must never leave 0), the right one is `both`.
   */
  private directionCard(): void {
    this.card(
      "ScrollView.direction: 'both'",
      'the cross axis: own limit, own scrollbar, wheel deltaX, diagonal drag, focus reveal',
      () => {
        Row({ gap: 10, alignItems: 'start', width: 'fill' }, () => {
          Column({ gap: 4 }, () => {
            Text('vertical (control)', { tone: 'muted' });
            const control = Scroll(
              {
                direction: 'vertical',
                width: BOTH_VIEW_WIDTH,
                height: BOTH_VIEW_HEIGHT,
                // Always-on bars: `auto` paints them only while the port is being used, which would make a
                // screenshot-based check race the gesture that produced it.
                scrollbar: true,
                name: 'options.bothControl',
              },
              () => this.bothBoard('options.bothControl'),
            );
            this.bothControl = control;
            this.pendingTracked.push(['options.bothControl', control]);
            Text(() => `y ${Math.round(this.bothControl?.offset ?? 0)}`, { tone: 'muted' });
          });
          Column({ gap: 4 }, () => {
            Text("direction: 'both' (+ offset slot)", { tone: 'muted' });
            const both = Scroll(
              {
                direction: 'both',
                width: BOTH_VIEW_WIDTH,
                height: BOTH_VIEW_HEIGHT,
                offset: this.bothSlotY,
                scrollbar: true,
                name: 'options.both',
              },
              () => this.bothBoard('options.both'),
            );
            this.bothScroll = both;
            this.pendingTracked.push(['options.both', both]);
            Text(
              () =>
                `x ${Math.round(this.bothScroll?.offsetX ?? 0)} y ${Math.round(
                  this.bothScroll?.offsetY ?? 0,
                )} · slot ${Math.round(this.bothSlotY.value)}`,
              { tone: 'muted' },
            );
          });
        });
      },
    );
  }

  /** The 700×420 board both ports share: corner controls, so a focus reveal has somewhere to go. */
  private bothBoard(tag: string): void {
    Panel(
      {
        direction: 'vertical',
        gap: 8,
        padding: 8,
        width: BOTH_CONTENT_WIDTH,
        height: BOTH_CONTENT_HEIGHT,
        variant: 'plain',
      },
      () => {
        Row({ gap: 8, alignItems: 'center' }, () => {
          const nw = Button('NW', {
            name: `${tag}.nw`,
            variant: 'primary',
            size: 'sm',
            focusOrder: -1,
            onClick: () => undefined,
          });
          this.pendingTracked.push([`${tag}.nw`, nw]);
          Text('content is 700 × 420, the port only 300 × 170', { tone: 'muted' });
        });
        for (let index = 0; index < 6; index += 1) {
          Text(`both row ${index}`, { height: 40, tone: index % 3 === 0 ? 'default' : 'muted' });
        }
        Row({ gap: 8, alignItems: 'center', justifyContent: 'end', width: 'fill' }, () => {
          Text('bottom-right', { tone: 'muted' });
          const se = Button('SE', {
            name: `${tag}.se`,
            variant: 'danger',
            size: 'sm',
            focusOrder: -1,
            onClick: () => undefined,
          });
          this.pendingTracked.push([`${tag}.se`, se]);
        });
      },
    );
  }

  /**
   * Selection by dragging on the pure-Canvas path (`dom: false`), inside a scrolling page.
   *
   * V58: that path had **no pointer-driven selection at all** — the caret could be placed by a click and
   * moved by the keyboard, but a drag did nothing, because `TextInputBase` never listened for
   * `pointermove`. Adding the listener alone would have been worse than the gap: the page's `ScrollView`
   * claims the same drag and would scroll while the selection grew.
   *
   * So the card is A/B by construction — one canvas field and one plain region inside the page's
   * scrolling stage, and a check drags across both: the field selects and the page stays put, the region
   * scrolls and nothing is selected.
   */
  private selectionCard(): void {
    this.card(
      'drag to select (dom: false)',
      'the field claims the drag; the page around it keeps scrolling — text and a control next to it',
      () => {
        Column({ gap: 8, width: 'fill', alignItems: 'stretch' }, () => {
          const field = TextField({
            value: 'Drag across this text to select it',
            dom: false,
            width: 420,
            alignSelf: 'start',
            name: 'options.select',
          });
          this.selectField = field;
          this.pendingTracked.push(['options.select', field]);
          field.on('change', (value: string) => {
            this.canvasSelection.value = value;
          });
          // A drag target that is *not* a field: dragging here must scroll the page (the control half of
          // the A/B), and the field's selection must not change.
          const region = Panel(
            {
              direction: 'horizontal',
              alignItems: 'center',
              justifyContent: 'center',
              variant: 'surfaceAlt',
              radius: 8,
              height: 64,
              width: 420,
              alignSelf: 'start',
              name: 'options.dragRegion',
            },
            () => {
              Text('drag here → the page scrolls', { tone: 'muted' });
            },
          );
          this.pendingTracked.push(['options.dragRegion', region]);
          Text(
            () => {
              const info = this.selectionInfo();
              return `caret ${info.caret} · selection ${info.selection} · stage ${info.stage}`;
            },
            { tone: 'muted' },
          );
        });
      },
    );
  }

  /** Caret/selection of the canvas field, plus what the drag claim is doing. */
  private selectionInfo(): {
    value: string;
    caret: number;
    selection: number;
    claim: string;
    stage: number;
  } {
    const field = this.selectField as unknown as {
      getValue?: () => string;
      caretIndex?: number;
      selectionAnchor?: number;
    } | null;
    const caret = field?.caretIndex ?? -1;
    const anchor = field?.selectionAnchor ?? caret;
    const scene = this as unknown as object;
    const claims = pointerClaims(scene);
    return {
      value: field?.getValue?.() ?? '',
      caret,
      selection: Math.abs(caret - anchor),
      claim:
        claims.length === 0 ? 'none' : claims.map((c) => `${c.pointerId}:${c.owner}`).join(','),
      stage: Math.round(this.stage?.offset ?? -1),
    };
  }

  /** `Grid.autoFlow`/`minRowHeight` and `Row({ wrap, alignContent })`. */
  private gridCard(): void {
    this.card(
      'Grid.autoFlow · minRowHeight / Row.alignContent',
      '列优先填充与行高下限（minRowHeight 只在 rows 固定时生效）；换行后整块内容在交叉轴上的分布',
      () => {
        Row({ gap: 16, alignItems: 'start' }, () => {
          // Two grids that differ **only** in the row floor: `minRowHeight` applies when `rows` is a fixed
          // count (`packages/layout/src/grid.ts`); with `rows: 'auto'` the row is as tall as its tallest
          // child, and the tiles here are 30 px, so a page that only set `minRowHeight` without `rows`
          // would prove nothing. `autoFlow: 'column'` puts the first two tiles in the same column.
          this.gridPair('options.gridA', 90);
          this.gridPair('options.gridB', 140);
          Row(
            {
              wrap: true,
              height: 120,
              gap: 6,
              alignContent: 'space-between',
              width: 300,
              name: 'options.wrapRow',
            },
            () => {
              for (let index = 0; index < 6; index++) {
                const chip = Rect({
                  color: 0x8b949e,
                  width: 140,
                  height: 30,
                  name: `options.chip${index}`,
                });
                this.track(`options.chip${index}`, chip);
              }
            },
          );
        });
      },
    );
  }

  /** One `rows: 2` grid with a given `minRowHeight`, four short tiles, column-major flow. */
  private gridPair(prefix: string, minRowHeight: number): void {
    Column({ gap: 4, width: 300 }, () => {
      Text(`minRowHeight: ${minRowHeight}`, { tone: 'muted' });
      Grid(
        {
          columns: 2,
          rows: 2,
          autoFlow: 'column',
          minRowHeight,
          rowGap: 6,
          columnGap: 6,
          width: 'fill',
        },
        () => {
          const colors = [0x2f6feb, 0x3fb950, 0xf2a33c, 0xa371f7];
          for (let index = 0; index < 4; index++) {
            const tile = Rect({
              color: colors[index] ?? 0x2f6feb,
              width: 140,
              height: 30,
              name: `${prefix}.tile${index}`,
            });
            this.track(`${prefix}.tile${index}`, tile);
          }
        },
      );
    });
  }

  /** Filler rows for the gesture ports. */
  private filler(count: number): void {
    Column({ gap: 4, width: 'fill' }, () => {
      for (let index = 0; index < count; index++) {
        Text(`line ${index + 1}`, { height: 26, tone: 'muted' });
      }
    });
  }

  /** A titled card, the shape every section of this page uses. */
  private card(title: string, caption: string, content: () => void): void {
    Panel(
      { variant: 'surface', radius: 10, padding: 12, gap: 8, width: 'fill', alignItems: 'stretch' },
      () => {
        Text(title, { size: 'md' });
        Text(caption, { tone: 'muted', maxLines: 2 });
        content();
      },
    );
  }

  private track(key: string, widget: Widget): Widget {
    this.tracked.set(key, widget);
    this.publish(`pt.${key}`, this.pointOf(widget));
    return widget;
  }

  private pointOf(widget: Widget): string {
    const point = pagePoint(this.game, widget);
    return `@${Math.round(point.x)},${Math.round(point.y)}`;
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  override update(): void {
    this.publish('upd.calls', this.updateCalls);
    this.publish('upd.builds', this.updatedBuilds);
    this.publish('plain.builds', this.plainBuilds);
    this.publish('ta.enterSubmits', this.enterSubmits);
    this.publish('ta.ctrlSubmits', this.ctrlSubmits);
    this.publish('ta.defaultBreaks', (this.defaultArea.value.match(/\n/g) ?? []).length);
    this.publish('ta.submitBreaks', (this.submitOnEnterArea.value.match(/\n/g) ?? []).length);
    const selection = this.selectionInfo();
    this.publish('select.caret', selection.caret);
    this.publish('select.selection', selection.selection);
    this.publish('select.claim', selection.claim);
    const both = this.bothScroll;
    if (both) {
      this.publish('both.x', Math.round(both.offsetX));
      this.publish('both.y', Math.round(both.offsetY));
      this.publish('both.maxX', Math.round(both.maxOffsetX));
      this.publish('both.maxY', Math.round(both.maxOffsetY));
      this.publish('both.slot', Math.round(this.bothSlotY.value));
    }
    const control = this.bothControl;
    if (control) {
      this.publish('both.controlY', Math.round(control.offsetY));
    }
    this.publish('inertia.offset', Math.round(this.inertiaOffset.value));
    this.publish('wheel.plain', Math.round(this.wheelPlainOffset.value));
    this.publish('wheel.fast', Math.round(this.wheelFastOffset.value));
    for (const [key, widget] of this.tracked) {
      if (!widget.isDestroyed && widget.visible) {
        this.publish(`pt.${key}`, this.pointOf(widget));
      }
    }
  }

  /** The page's API: drive it and read it without hunting for coordinates. */
  private exposeGlobals(): void {
    (window as unknown as { optionsDemo?: unknown }).optionsDemo = {
      replaceItems: (): Record<string, number> => {
        this.replaceItems();
        return {
          updCalls: this.updateCalls,
          updBuilds: this.updatedBuilds,
          plainBuilds: this.plainBuilds,
        };
      },
      /** Background colour of every grid tile / wrapped chip, in page coordinates. */
      points: (): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [key, widget] of this.tracked) {
          if (!widget.isDestroyed) {
            out[key] = this.pointOf(widget);
          }
        }
        return out;
      },
      /** Stage rects of the tiles and chips, so the arrangement can be asserted. */
      rects: (): Record<string, { x: number; y: number; width: number; height: number }> => {
        const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
        for (const [key, widget] of this.tracked) {
          if (widget.isDestroyed) {
            continue;
          }
          const origin = stagePosition(widget);
          out[key] = {
            x: Math.round(origin.x),
            y: Math.round(origin.y),
            width: Math.round(widget.appliedRect.width),
            height: Math.round(widget.appliedRect.height),
          };
        }
        const row = this.tracked.get('options.wrapRow');
        if (row && !row.isDestroyed) {
          const origin = stagePosition(row);
          out['options.wrapRow'] = {
            x: Math.round(origin.x),
            y: Math.round(origin.y),
            width: Math.round(row.appliedRect.width),
            height: Math.round(row.appliedRect.height),
          };
        }
        return out;
      },
      /** Item source, painted text and counters — all three, because they can disagree. */
      state: (): Record<string, unknown> => ({
        updated: this.updatedItems.value.map((row) => row.label),
        updatedPainted: [...this.updatedPainted].map(([id, label]) => `${id}:${label.getText()}`),
        plainPainted: [...this.plainPainted].map(([id, label]) => `${id}:${label.getText()}`),
        plain: this.plainItems.value.map((row) => row.label),
        updCalls: this.updateCalls,
        updBuilds: this.updatedBuilds,
        plainBuilds: this.plainBuilds,
        enterSubmits: this.enterSubmits,
        ctrlSubmits: this.ctrlSubmits,
        inertiaOffset: this.inertiaOffset.value,
        wheelPlain: this.wheelPlainOffset.value,
        wheelFast: this.wheelFastOffset.value,
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
      }),
      /**
       * Brings the two-axis card into view and publishes both ports' rects into `#status`.
       *
       * Returns a promise so `scripts/visual-check.mjs` can await it (`awaitPromise`): a `reportWidget()`
       * inside a build or before the next layout pass reads `appliedRect` as `0x0` (round 89).
       */
      prepare: async (): Promise<boolean> => {
        this.stage?.setScrollOffset(900);
        for (let frame = 0; frame < 2; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        // Two labels per port: the sampler takes one point per status label, and this check needs two
        // edges of the same box (the bottom band and the right band).
        for (const [key, alias] of [
          ['options.both', 'options.bothx'],
          ['options.bothControl', 'options.bothControlx'],
        ] as const) {
          const widget = this.tracked.get(key);
          if (widget) {
            reportWidget(key, widget as never);
            reportWidget(alias, widget as never);
          }
        }
        return true;
      },
      /** Scrolls the page's stage, so the gesture cards below the fold come into view. */
      scrollStage: (y: number): number => {
        this.stage?.setScrollOffset(y);
        return Math.round(this.stage?.offset ?? -1);
      },
      stageOffset: (): number => Math.round(this.stage?.offset ?? -1),
      /**
       * What the three gesture ports actually got: the options as the widgets hold them, plus the
       * offset, so "the option never reached the widget" can be told apart from "it is ignored there".
       */
      scrollInfo: (): Record<string, unknown> => {
        const info: Record<string, unknown> = {};
        for (const key of ['options.inertia', 'options.wheelPlain', 'options.wheelFast']) {
          const view = this.tracked.get(key) as unknown as
            | {
                inertiaEnabled?: boolean;
                wheelSpeed?: number;
                scrollbarSize?: number;
                offset?: number;
                isDragging?: boolean;
                coasting?: boolean;
                dragVelocity?: { x: number; y: number };
              }
            | undefined;
          info[key] = view
            ? {
                inertiaEnabled: view.inertiaEnabled,
                wheelSpeed: view.wheelSpeed,
                scrollbarSize: view.scrollbarSize,
                offset: Math.round(view.offset ?? 0),
                dragging: view.isDragging,
                coasting: view.coasting,
                velocity: view.dragVelocity
                  ? {
                      x: Math.round(view.dragVelocity.x * 1000) / 1000,
                      y: Math.round(view.dragVelocity.y * 1000) / 1000,
                    }
                  : null,
              }
            : null;
        }
        return info;
      },
      /**
       * The two-axis port (and its vertical control) as one object: both offsets, both limits, the box
       * sizes and the `offset` slot's own reading.
       *
       * `x`/`y` come from the widget and `slot` from the ref the DSL writes, so "the cross axis was moved
       * by the slot's per-frame write-back" is a comparison rather than a guess (V56).
       */
      bothInfo: (): Record<string, unknown> | null => {
        const both = this.bothScroll as unknown as {
          offsetX: number;
          offsetY: number;
          maxOffsetX: number;
          maxOffsetY: number;
          direction: string;
          contentSize: { width: number; height: number };
          viewport: { width: number; height: number };
          isDragging?: boolean;
        } | null;
        if (!both) {
          return null;
        }
        const control = this.bothControl as unknown as {
          offsetY: number;
          maxOffsetY: number;
        } | null;
        return {
          direction: both.direction,
          x: Math.round(both.offsetX),
          y: Math.round(both.offsetY),
          maxX: Math.round(both.maxOffsetX),
          maxY: Math.round(both.maxOffsetY),
          slotY: Math.round(this.bothSlotY.value),
          dragging: both.isDragging,
          // Ownership, not just "is a drag running": V24 was a port that kept its owner after the
          // pointer was gone and then refused every later press.
          dragPointer: (both as unknown as { dragPointerId?: number | null }).dragPointerId ?? null,
          barPointer: (both as unknown as { barPointerId?: number | null }).barPointerId ?? null,
          content: {
            width: Math.round(both.contentSize.width),
            height: Math.round(both.contentSize.height),
          },
          viewport: {
            width: Math.round(both.viewport.width),
            height: Math.round(both.viewport.height),
          },
          control: control
            ? { y: Math.round(control.offsetY), maxY: Math.round(control.maxOffsetY) }
            : null,
        };
      },
      /** Scroll the vertical control of the same card, so both ports' bars can be compared. */
      setControl: (y: number): void => {
        this.bothControl?.setScrollOffset(y);
      },
      /** Jump the two-axis port; `null` leaves that axis alone. */
      setBoth: (x: number | null, y: number | null): void => {
        this.bothScroll?.setScrollOffset({
          ...(x === null ? {} : { x }),
          ...(y === null ? {} : { y }),
        });
      },
      /** Caret, selection and the outstanding drag claim of the `dom: false` field. */
      selection: (): ReturnType<OptionsScene['selectionInfo']> => this.selectionInfo(),
      /** Where the field's page rect is, so a check can drag across it rather than guess. */
      selectionRects: (): Record<
        string,
        { x: number; y: number; width: number; height: number }
      > => {
        const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
        for (const key of ['options.select', 'options.dragRegion']) {
          const widget = this.tracked.get(key);
          if (widget && !widget.isDestroyed) {
            const origin = stagePosition(widget);
            out[key] = {
              x: Math.round(origin.x),
              y: Math.round(origin.y),
              width: Math.round(widget.appliedRect.width),
              height: Math.round(widget.appliedRect.height),
            };
          }
        }
        return out;
      },
      /** Page coordinates of a named widget (the corner buttons), for a click or a gesture. */
      pointOf: (name: string): { x: number; y: number } | null => {
        const widget = this.tracked.get(name);
        if (!widget || widget.isDestroyed) {
          return null;
        }
        const point = pagePoint(this.game, widget as never);
        return { x: Math.round(point.x), y: Math.round(point.y) };
      },
      /** Focus a widget through the focus manager — the path that has to reveal it in its port. */
      focus: (name: string): string => {
        const widget = this.tracked.get(name);
        if (!widget || widget.isDestroyed) {
          return 'missing';
        }
        widget.focus();
        return this.mvvm.focus.focusedWidget?.name ?? 'none';
      },
      /** Counts the `scroll` events of a port, so "every offset change is announced" is checkable. */
      watchScroll: (name = 'options.both'): number => {
        const widget = this.tracked.get(name) as unknown as { on?: Function } | undefined;
        if (!widget?.on) {
          return -1;
        }
        this.bothEvents.set(name, 0);
        (widget.on as (event: string, handler: () => void) => void)('scroll', () =>
          this.bothEvents.set(name, (this.bothEvents.get(name) ?? 0) + 1),
        );
        return 0;
      },
      scrollEvents: (name = 'options.both'): number => this.bothEvents.get(name) ?? -1,
      /** Resets the three gesture ports, so a wheel/drag measurement starts from a known place. */
      resetScroll: (): Record<string, number> => {
        this.inertiaOffset.value = 0;
        this.wheelPlainOffset.value = 0;
        this.wheelFastOffset.value = 0;
        return { inertia: 0, plain: 0, fast: 0 };
      },
      counts: (): Record<string, number> => ({
        widgets: countWidgets(this.mvvm.root),
        themeListeners: 0,
        pointerTargets: this.mvvm.input.widgets.length,
        focusables: this.mvvm.focus.focusables.length,
      }),
    };
  }
}

/** Number of widgets in a subtree, the root included. */
function countWidgets(root: Widget): number {
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
