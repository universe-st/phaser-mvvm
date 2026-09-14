/**
 * `#/states` — the interaction-state matrix: every stateful widget, driven by **real** pointer and
 * keyboard input, with its state machine published for assertions.
 *
 * The other acceptance pages (`#/showcase`, `#/compose`) prove that widgets *build* and *render*.
 * This one proves the thing a screenshot cannot: that hover, press, focus, disabled, error and
 * loading transitions actually happen, in the right priority order, on the right widget.
 *
 * It is written with the Compose-style DSL (`@phaser-mvvm/widgets/compose`) and exposes:
 *
 * - `#demo-state`:
 *   - `st.<name>` — the widget's `visualState` (`normal`/`hover`/`pressed`/`disabled`/`focused`/`error`),
 *     published every frame while it changes;
 *   - `ring.<name>` — `on`/`off`: whether that widget may paint its focus ring right now. It is **not**
 *     the same reading as `st.<name> === 'focused'`: a pointer press focuses a control without lighting
 *     it up (CSS `:focus-visible`), so `st.x=focused` with `ring.x=off` is the expected pair after a
 *     mouse click, while a `Tab`/D-Pad walk produces `focused` + `on`;
 *   - `pt.<name>` — the widget's page coordinate, so a check can move/click/tap it;
 *   - `focus`, `clicks`, `toggled`, `field.*`, `scroll.*` — the behavioural readouts.
 * - `window.states`: `names()`, `state()`, `geometry()`, `focusables()`, `ring()`, `point(name)`.
 *
 * Run the acceptance sweep with Playwright MCP (see `docs/ACCEPTANCE-states.md`).
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { WIDGET_EVENTS } from '@phaser-mvvm/phaser';
import { bindCommand, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Column,
  Divider,
  Image,
  List,
  Panel,
  Row,
  Scroll,
  Slider,
  Spacer,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { textMetricsStats } from '@phaser-mvvm/widgets';
import { makeTileTexture, setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

const TILE = 'states.tile';

interface Probe {
  name: string;
  widget: Widget;
  /** Expected `visualState` at rest, so the check can assert the baseline. */
  rest: string;
}

interface RowItem {
  id: string;
  label: string;
}

/** How many events a probe's history keeps before the oldest is dropped. */
const EVENT_LOG_LIMIT = 40;

export class StatesScene extends Phaser.Scene {
  private readonly clicks = ref(0);
  private readonly toggled = ref(false);
  private readonly text = ref('');
  private readonly invalid = ref('');
  private readonly notes = ref('');
  private readonly commandClicks = ref(0);
  /** Bound to the first slider (two-way): the readout next to it must follow the drag. */
  private readonly volume = ref(40);
  private readonly stepped = ref(30);
  private readonly rows = ref<RowItem[]>(
    Array.from({ length: 30 }, (_, index) => ({ id: `r${index}`, label: `第 ${index + 1} 行` })),
  );

  private readonly probes = new Map<string, Probe>();
  private readonly tracked = new Map<string, Widget>();
  /**
   * The four events every widget emits, recorded per probe.
   *
   * `WIDGET_EVENTS` (`widget:activate` / `widget:state` / `widget:focus` / `widget:blur`) is the
   * framework's per-widget event vocabulary, and until round 96 **no demo or test ever listened to
   * it** — so nothing proved that an activation from the three input devices arrives with the right
   * `ActivationSource`, or that the visual state machine announces its transitions at all. The
   * focus/blur pair joined the table in round 110 together with its implementation: before that,
   * "this field gained/lost focus" existed only as the `onFocus`/`onBlur` *constructor options* of a
   * text field, which nothing outside the field could observe (guide 08 §5.3). Capped, because a page
   * can be driven for a while and a probe's history is only interesting near the gesture under test.
   */
  private readonly eventLog: {
    activated: Array<{ name: string; source: string }>;
    states: Array<{ name: string; state: string }>;
    focused: string[];
    blurred: string[];
  } = { activated: [], states: [], focused: [], blurred: [] };
  private readonly published = new Map<string, string>();
  private page: Widget | null = null;

  constructor() {
    super('states');
  }

  create(): void {
    makeTileTexture(this, TILE);

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
          Text('交互状态矩阵', { size: 'lg' });
          Text('每一行一个控件；状态由真实指针/键盘输入驱动，写入 #demo-state 的 st.<name>', {
            tone: 'muted',
          });
          Divider({});

          Scroll({ direction: 'vertical', width: 'fill', height: 'fill', name: 'stage' }, () => {
            Column({ gap: 10, width: 'fill', alignItems: 'stretch' }, () => {
              this.buttonsRow();
              this.slidersRow();
              this.fieldsRow();
              this.panelsRow();
              this.listRow();
              this.scrollRow();
            });
          });
        },
      );
    });

    this.page = page;
    this.mvvm.mount(page);

    this.mvvm.focus.onFocusChange = (widget) => {
      this.publish('focus', widget ? widget.name || 'unnamed' : 'none');
    };
    this.publish('clicks', 0);

    // Bound *after* the tree was mounted: the case that used to be silently dead.
    const target = this.probes.get('cmd.label')?.widget;
    if (target) {
      bindCommand(target, () => () => this.commandClicks.value++);
    }

    appendStatus('--- states · layout ---');
    reportWidget('page', page);
    // The focus-ring A/B pair (`scripts/visual-check.mjs`): two buttons of the same size and variant,
    // reported by name so the gate can sample their **top edge** — which is the row the focus ring is
    // stroked on (`paintFocusRing`, inset by half the line width). The pointer run clicks `ring.target`
    // and expects its edge to look exactly like the untouched `ring.neighbour`; the `Tab` run expects the
    // ring colour there. Both widgets hold still under focus, so one post-layout report is enough.
    const ringTarget = this.probes.get('button.default')?.widget;
    const ringNeighbour = this.probes.get('button.toggle')?.widget;
    if (ringTarget) {
      reportWidget('ring.target', ringTarget);
    }
    if (ringNeighbour) {
      reportWidget('ring.neighbour', ringNeighbour);
    }
    // The third arm of the same gate: a `Slider` is the control whose ring once stayed on screen after a
    // pointer press (its paint cache did not cover the new visibility flag — V82), so it gets its own
    // sample point. The slider draws **no background**, so its top row is either the ring or whatever the
    // card behind it shows, which is exactly the discrimination the check needs.
    const ringSlider = this.probes.get('slider.volume')?.widget;
    if (ringSlider) {
      reportWidget('ring.slider', ringSlider);
    }
    reportCanvas(this.game);
    this.exposeGlobals();
  }

  override update(): void {
    this.publishEvents();
    for (const [name, widget] of this.tracked) {
      if (widget.isDestroyed || !widget.visible) {
        continue;
      }
      const rect = widget.appliedRect;
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      this.publish(
        `pt.${name}`,
        `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
          pagePoint(this.game, widget).y,
        )}`,
      );
    }
    for (const [name, probe] of this.probes) {
      if (!probe.widget.isDestroyed) {
        this.publish(`st.${name}`, probe.widget.visualState);
        // `focused` and `focusVisible` are two different readings on purpose: a control the mouse
        // clicked is focused (the next `Tab` continues from it) but must not paint a ring, while a
        // `Tab`/D-Pad walk must. Publishing both is what makes that rule checkable from a page instead
        // of from a screenshot (round 113, `Widget#focusRingOnPointer`).
        this.publish(`ring.${name}`, probe.widget.focusVisible ? 'on' : 'off');
      }
    }
    this.publish('clicks', this.clicks.value);
    this.publish('toggled', this.toggled.value);
    this.publish('field.text', this.text.value);
    this.publish('field.invalid', this.invalid.value);
    this.publish('field.notes', this.notes.value.length);
    this.publish('cmd.clicks', this.commandClicks.value);
    this.publish('slider.volume', Math.round(this.volume.value));
    this.publish('slider.stepped', this.stepped.value);
  }

  // ------------------------------------------------------------------ rows

  private slidersRow(): void {
    this.card(
      'Slider',
      '绑定 ref 的连续滑杆 · step=10 的量化滑杆 · disabled（拖动可离开控件范围）',
      () => {
        Row({ gap: 12, alignItems: 'center', wrap: true }, () => {
          const volume = Slider({
            value: this.volume,
            min: 0,
            max: 100,
            width: 200,
            name: 'slider.volume',
          });
          this.probe('slider.volume', volume, 'normal');
          Text(() => `volume=${Math.round(this.volume.value)}`, { tone: 'muted' });
        });
        Row({ gap: 12, alignItems: 'center', wrap: true }, () => {
          const stepped = Slider({
            value: this.stepped,
            min: 0,
            max: 100,
            step: 10,
            width: 200,
            name: 'slider.stepped',
          });
          this.probe('slider.stepped', stepped, 'normal');
          Text(() => `stepped=${this.stepped.value}`, { tone: 'muted' });
        });
        Row({ gap: 12, alignItems: 'center', wrap: true }, () => {
          this.probe(
            'slider.disabled',
            Slider({ value: 60, width: 200, disabled: true, name: 'slider.disabled' }),
            'disabled',
          );
          Text('disabled', { tone: 'muted' });
        });
      },
    );
  }

  private buttonsRow(): void {
    this.card(
      'Button',
      'default · toggle（绑 ref，双向）· 外部置开/置关（ref → 按钮）· disabled · loading',
      () => {
        Row({ gap: 10, alignItems: 'center', wrap: true }, () => {
          this.probe(
            'button.default',
            Button('普通按钮', {
              name: 'button.default',
              onClick: () => this.clicks.value++,
            }),
            'normal',
          );
          // Two-way: the ref is the state, the label derives from it — flipping the button writes the
          // ref, and the `外部置开` button below proves the other direction (ref → button).
          this.probe(
            'button.toggle',
            Button(() => `开关：${this.toggled.value ? '开' : '关'}`, {
              toggle: true,
              value: this.toggled,
              name: 'button.toggle',
            }),
            'normal',
          );
          this.probe(
            'button.setToggle',
            Button('外部置开', {
              // `focusOrder` 小的先被 Tab 到：这一对按钮在树里是 set→clear，Tab 顺序相反
              focusOrder: 2,
              name: 'button.setToggle',
              onClick: () => {
                this.toggled.value = true;
              },
            }),
            'normal',
          );
          this.probe(
            'button.clearToggle',
            Button('外部置关', {
              focusOrder: 1,
              name: 'button.clearToggle',
              onClick: () => {
                this.toggled.value = false;
              },
            }),
            'normal',
          );
          this.probe(
            'button.disabled',
            Button('禁用', { disabled: true, name: 'button.disabled' }),
            'disabled',
          );
          this.probe(
            'button.loading',
            Button('加载中', { loading: true, name: 'button.loading' }),
            'normal',
          );
        });
        Row({ gap: 10, alignItems: 'center' }, () => {
          Text(() => `clicks = ${this.clicks.value}`, { tone: 'muted' });
          Text(() => `toggled = ${String(this.toggled.value)}`, { tone: 'muted' });
        });
      },
    );
  }

  private fieldsRow(): void {
    this.card(
      'TextField & TextArea',
      'focus · 输入 · 失焦校验进入 error · readOnly · disabled',
      () => {
        Row({ gap: 10, alignItems: 'start', wrap: true }, () => {
          Column({ gap: 6, width: 220, alignItems: 'stretch' }, () => {
            this.probe(
              'field.plain',
              TextField({
                value: this.text,
                label: '普通（双向）',
                placeholder: '点我输入',
                name: 'field.plain',
                clearable: true,
              }),
              'normal',
            );
            Text(() => `读出：${this.text.value || '(空)'}`, { tone: 'muted' });
          });
          Column({ gap: 6, width: 220, alignItems: 'stretch' }, () => {
            this.probe(
              'field.error',
              TextField({
                value: this.invalid,
                label: '失焦校验（必填）',
                placeholder: '留空后点别处',
                name: 'field.error',
                validate: (value) => (value.length === 0 ? '不能为空' : null),
              }),
              'normal',
            );
            Text('留空并失焦 → error 状态', { tone: 'muted' });
          });
          Column({ gap: 6, width: 220, alignItems: 'stretch' }, () => {
            this.probe(
              'field.readonly',
              TextField({
                value: '只读内容',
                readOnly: true,
                label: 'readOnly',
                name: 'field.readonly',
              }),
              'normal',
            );
            this.probe(
              'field.disabled',
              TextField({
                value: '禁用内容',
                disabled: true,
                label: 'disabled',
                name: 'field.disabled',
              }),
              'disabled',
            );
          });
          Column({ gap: 6, width: 220, alignItems: 'stretch' }, () => {
            this.probe(
              'field.area',
              TextArea({ value: this.notes, rows: 2, label: 'TextArea', name: 'field.area' }),
              'normal',
            );
            Text(() => `字符数：${this.notes.value.length}`, { tone: 'muted' });
          });
        });
      },
    );
  }

  private panelsRow(): void {
    this.card(
      'Panel / Image / Label / Divider',
      'interactive 面板可 hover/press/聚焦；纯展示控件始终保持 normal',
      () => {
        Row({ gap: 10, alignItems: 'center', wrap: true, height: 72 }, () => {
          this.probe(
            'panel.interactive',
            Panel(
              {
                variant: 'surfaceAlt',
                radius: 8,
                padding: 12,
                interactive: true,
                name: 'panel.interactive',
                width: 150,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
              },
              () => {
                Text('可点击面板');
              },
            ),
            'normal',
          );
          this.probe(
            'image.plain',
            Image({ texture: TILE, width: 48, height: 48, name: 'image.plain' }),
            'normal',
          );
          this.probe('label.plain', Text('纯展示文本', { name: 'label.plain' }), 'normal');
          // A command bound to a *plain* widget: no `interactive` marker, no focus. `bindCommand()` has to
          // give it a hit area and ask the router to re-collect, otherwise the click never arrives.
          this.probe(
            'cmd.label',
            Text(() => `可点击文本（已点击 ${this.commandClicks.value}）`, {
              name: 'cmd.label',
              tone: 'primary',
            }),
            'normal',
          );
          Divider({ orientation: 'vertical', height: 48 });
          this.probe('spacer.plain', Spacer({ width: 40, name: 'spacer.plain' }), 'normal');
        });
      },
    );
  }

  private listRow(): void {
    this.card('List in Scroll', '行内按钮同样走状态机；拖动滚动条拇指', () => {
      Scroll({ direction: 'vertical', height: 150, width: 'fill', name: 'list' }, () => {
        List(
          {
            items: () => this.rows.value,
            key: (row) => row.id,
            width: 'fill',
            height: 'fill',
            gap: 2,
            virtualize: true,
            itemExtent: 26,
          },
          (row, index) => {
            Row({ gap: 8, height: 24, alignItems: 'center', width: 'fill' }, () => {
              Text(`${index + 1}`, { width: 36, tone: 'muted' });
              Text(() => row.label);
              Spacer({ flex: true });
              if (row.id === 'r0') {
                this.probe(
                  'row.button',
                  Button('行内按钮', { size: 'sm', name: 'row.button' }),
                  'normal',
                );
              }
            });
          },
        );
      });
    });
  }

  private scrollRow(): void {
    this.card('ScrollView', '滚轮滚动 · 状态不受影响', () => {
      Scroll({ direction: 'vertical', height: 120, width: 'fill', name: 'scroll' }, () => {
        Column({ gap: 6, width: 'fill', alignItems: 'stretch' }, () => {
          for (let index = 0; index < 12; index += 1) {
            Panel(
              {
                variant: 'surfaceAlt',
                radius: 6,
                padding: 8,
                height: 32,
                justifyContent: 'center',
              },
              () => {
                Text(`滚动内容 ${index + 1}`, { tone: 'muted' });
              },
            );
          }
        });
      });
    });
  }

  // ------------------------------------------------------------------ plumbing

  /** A titled card, the shape every row is built from. */
  private card(title: string, caption: string, content: () => void): void {
    Panel(
      { variant: 'surface', radius: 10, padding: 12, gap: 8, width: 'fill', alignItems: 'stretch' },
      () => {
        Text(title);
        Text(caption, { tone: 'muted', maxLines: 2 });
        Divider({});
        content();
      },
    );
  }

  /** Registers a widget as a state probe: tracked for `pt.<name>` and sampled for `st.<name>`. */
  private probe<T extends Widget>(name: string, widget: T, rest: string): T {
    widget.name = name;
    this.probes.set(name, { name, widget, rest });
    this.tracked.set(name, widget);
    this.watchEvents(name, widget);
    return widget;
  }

  /**
   * Records the `WIDGET_EVENTS` a probe emits (see {@link StatesScene.eventLog}).
   *
   * All four are wired for every probe, so `events()` answers "which control took focus, in what
   * order, and from which device" without polling `mvvm.focus.focusedWidget` frame by frame.
   */
  private watchEvents(name: string, widget: Widget): void {
    const cap = (list: Array<unknown>): void => {
      if (list.length > EVENT_LOG_LIMIT) {
        list.shift();
      }
    };
    widget.on(WIDGET_EVENTS.ACTIVATE, (source: string) => {
      this.eventLog.activated.push({ name, source });
      cap(this.eventLog.activated);
    });
    widget.on(WIDGET_EVENTS.STATE_CHANGE, (state: string) => {
      this.eventLog.states.push({ name, state });
      cap(this.eventLog.states);
    });
    widget.on(WIDGET_EVENTS.FOCUS, () => {
      this.eventLog.focused.push(name);
      cap(this.eventLog.focused);
    });
    widget.on(WIDGET_EVENTS.BLUR, () => {
      this.eventLog.blurred.push(name);
      cap(this.eventLog.blurred);
    });
  }

  /** Publishes the event counters, so a check can read them from `#demo-state` without the API. */
  private publishEvents(): void {
    this.publish('events.activations', this.eventLog.activated.length);
    this.publish('events.states', this.eventLog.states.length);
    this.publish('events.focus', this.eventLog.focused.length);
    this.publish('events.blur', this.eventLog.blurred.length);
    const lastActivation = this.eventLog.activated[this.eventLog.activated.length - 1];
    this.publish(
      'events.lastActivation',
      lastActivation ? `${lastActivation.name}:${lastActivation.source}` : 'none',
    );
    const lastState = this.eventLog.states[this.eventLog.states.length - 1];
    this.publish('events.lastState', lastState ? `${lastState.name}:${lastState.state}` : 'none');
    // The pair is what a form watches: "who holds focus now, and who did it leave".
    const lastFocused = this.eventLog.focused[this.eventLog.focused.length - 1] ?? 'none';
    const lastBlurred = this.eventLog.blurred[this.eventLog.blurred.length - 1] ?? 'none';
    this.publish('events.lastFocus', `${lastFocused}<-${lastBlurred}`);
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  private exposeGlobals(): void {
    (window as unknown as { states?: unknown }).states = {
      names: () => [...this.probes.keys()],
      rest: () => Object.fromEntries([...this.probes].map(([name, probe]) => [name, probe.rest])),
      state: () => ({
        clicks: this.clicks.value,
        commandClicks: this.commandClicks.value,
        volume: this.volume.value,
        stepped: this.stepped.value,
        toggled: this.toggled.value,
        text: this.text.value,
        invalid: this.invalid.value,
        notes: this.notes.value.length,
      }),
      focusables: () => this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      /**
       * Per probe: `focused` (does it hold focus) and `ringOn` (may it paint the ring right now).
       *
       * The pair is the assertion surface for the `:focus-visible` rule — after a real mouse click the
       * first is `true` and the second `false`, after a real `Tab` both are `true` — and it reads the
       * live widget rather than the last published `#demo-state` line, so a check needs no frame wait.
       */
      ring: () =>
        Object.fromEntries(
          [...this.probes].map(([name, probe]) => [
            name,
            { focused: probe.widget.focused, ringOn: probe.widget.focusVisible },
          ]),
        ),
      /**
       * Everything the `WIDGET_EVENTS` listeners have seen, in order: activations with their
       * `ActivationSource` ("pointer" / "keyboard" / "gamepad"), state transitions, and the names of
       * the probes that gained and lost focus.
       */
      events: () => ({
        activated: this.eventLog.activated.map((entry) => ({ ...entry })),
        states: this.eventLog.states.map((entry) => ({ ...entry })),
        focused: [...this.eventLog.focused],
        blurred: [...this.eventLog.blurred],
      }),
      /** Drops the recorded events, so a measurement starts from a known place. */
      clearEvents: (): void => {
        this.eventLog.activated.length = 0;
        this.eventLog.states.length = 0;
        this.eventLog.focused.length = 0;
        this.eventLog.blurred.length = 0;
      },
      /**
       * Page coordinates of a probe's **centre** — the point a real click should land on.
       *
       * `pt.<name>` in `#demo-state` is the widget's origin (layout coordinates), which is fine for a
       * probe whose size is known but wrong for driving a pointer: a click a pixel outside the box hits
       * the page panel instead. This is the same idea the other pages expose as `point(name)`.
       */
      point: (name: string): { x: number; y: number } => {
        const probe = this.probes.get(name);
        if (!probe) {
          throw new Error(`states.point: unknown probe "${name}"`);
        }
        const origin = pagePoint(this.game, probe.widget);
        const rect = probe.widget.appliedRect;
        return {
          x: Math.round(origin.x + rect.width / 2),
          y: Math.round(origin.y + rect.height / 2),
        };
      },
      /**
       * Scrolls every `ScrollView` above a probe so the probe is visible, then resolves.
       *
       * A probe below the fold (or clipped away inside a virtualised list) has no usable
       * `pt.<name>` — its rect is still the last arranged one, but the point is outside the canvas.
       * The check calls this before hovering such a probe.
       */
      reveal: async (name: string): Promise<void> => {
        const probe = this.probes.get(name);
        if (!probe) {
          throw new Error(`states.reveal: unknown probe "${name}"`);
        }
        let node: Widget | null = probe.widget;
        const ports: Widget[] = [];
        while (node) {
          if (node.constructor.name === 'ScrollView') {
            ports.push(node);
          }
          node = (node.parent as Widget | null) ?? null;
        }
        // Outermost first, so inner ports are laid out (and have their final rect) before we scroll them.
        for (const port of ports.reverse()) {
          const view = port as unknown as {
            viewport: { width: number; height: number };
            maxOffset: number;
            setScrollOffset(offset: number): unknown;
          };
          // Position of the widget inside this port's content holder.
          let y = 0;
          let cursor: Widget | null = probe.widget;
          while (cursor && cursor !== port) {
            y += cursor.y;
            cursor = (cursor.parent as Widget | null) ?? null;
          }
          const desired = Math.max(
            0,
            Math.min(
              view.maxOffset,
              y + probe.widget.appliedRect.height / 2 - view.viewport.height / 2,
            ),
          );
          view.setScrollOffset(desired);
          await new Promise<void>((resolve) => {
            this.time.delayedCall(0, () => resolve());
          });
        }
      },
      /** Current value of a text probe, or `null` for widgets without one. */
      value: (name: string): string | null => {
        const widget = this.probes.get(name)?.widget as { getValue?: () => string } | undefined;
        return typeof widget?.getValue === 'function' ? widget.getValue() : null;
      },
      /**
       * Layout-engine counters of this scene, for the PLAN §8 budgets: typing must not re-lay-out the
       * whole tree, so a check samples this before and after typing.
       */
      stats: () => {
        const { stats } = this.mvvm.root.layoutEngine;
        return {
          passes: stats.passes,
          measureCalls: stats.measureCalls,
          cacheHits: stats.cacheHits,
          arrangeCalls: stats.arrangeCalls,
          placedChildren: stats.placedChildren,
          skippedSubtrees: stats.skippedSubtrees,
        };
      },
      /** Text-metrics cache counters (PLAN §8: text measurement hit rate > 95 %). */
      textMetrics: () => textMetricsStats(this) ?? { hits: 0, misses: 0, size: 0, hitRate: 1 },
      /** Number of widgets in the page, so a measure-count delta can be read against the page size. */
      widgetCount: () => {
        let total = 0;
        const walk = (widget: Widget): void => {
          total += 1;
          for (const child of widget.getWidgetChildren()) {
            walk(child);
          }
        };
        if (this.page) {
          walk(this.page);
        }
        return total;
      },
      /** Whether a probe can be focused at all (its `focusable` flag). */
      focusable: (name: string): boolean => this.probes.get(name)?.widget.focusable === true,
      geometry: () => ({
        page: rectOf(this.page),
        probes: Object.fromEntries(
          [...this.probes].map(([name, probe]) => {
            const rect = probe.widget.appliedRect;
            return [name, [Math.round(rect.width), Math.round(rect.height)]];
          }),
        ),
      }),
    };
  }
}

function rectOf(widget: Widget | null): [number, number] | null {
  if (!widget) {
    return null;
  }
  const rect = widget.appliedRect;
  return [Math.round(rect.width), Math.round(rect.height)];
}
