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
 *   - `pt.<name>` — the widget's page coordinate, so a check can move/click/tap it;
 *   - `focus`, `clicks`, `toggled`, `field.*`, `scroll.*` — the behavioural readouts.
 * - `window.states`: `names()`, `state()`, `geometry()`, `focusables()`.
 *
 * Run the acceptance sweep with Playwright MCP (see `docs/ACCEPTANCE-states.md`).
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import type { Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Column,
  Divider,
  Image,
  List,
  Panel,
  Row,
  Scroll,
  Spacer,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { textMetricsStats } from '@phaser-mvvm/widgets';
import { makeTileTexture, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

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

export class StatesScene extends Phaser.Scene {
  private readonly clicks = ref(0);
  private readonly toggled = ref(false);
  private readonly text = ref('');
  private readonly invalid = ref('');
  private readonly notes = ref('');
  private readonly rows = ref<RowItem[]>(
    Array.from({ length: 30 }, (_, index) => ({ id: `r${index}`, label: `第 ${index + 1} 行` })),
  );

  private readonly probes = new Map<string, Probe>();
  private readonly tracked = new Map<string, Widget>();
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
          Text('交互状态矩阵', { style: { fontSize: `${this.mvvm.theme.fontSize.lg}px` } });
          Text('每一行一个控件；状态由真实指针/键盘输入驱动，写入 #demo-state 的 st.<name>', {
            tone: 'muted',
          });
          Divider({});

          Scroll({ direction: 'vertical', width: 'fill', height: 'fill', name: 'stage' }, () => {
            Column({ gap: 10, width: 'fill', alignItems: 'stretch' }, () => {
              this.buttonsRow();
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

    appendStatus('--- states · layout ---');
    reportWidget('page', page);
    reportCanvas(this.game);
    this.exposeGlobals();
  }

  override update(): void {
    for (const [name, widget] of this.tracked) {
      if (widget.isDestroyed || !widget.visible) {
        continue;
      }
      const rect = widget.appliedRect;
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const canvas = this.game.canvas.getBoundingClientRect();
      const origin = stagePosition(widget);
      this.publish(
        `pt.${name}`,
        `@${Math.round(canvas.left + origin.x + rect.width / 2)},${Math.round(
          canvas.top + origin.y + rect.height / 2,
        )}`,
      );
    }
    for (const [name, probe] of this.probes) {
      if (!probe.widget.isDestroyed) {
        this.publish(`st.${name}`, probe.widget.visualState);
      }
    }
    this.publish('clicks', this.clicks.value);
    this.publish('toggled', this.toggled.value);
    this.publish('field.text', this.text.value);
    this.publish('field.invalid', this.invalid.value);
    this.publish('field.notes', this.notes.value.length);
  }

  // ------------------------------------------------------------------ rows

  private buttonsRow(): void {
    this.card(
      'Button',
      'default · toggle · disabled · loading（disabled 优先于 hover/press）',
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
          const toggle = Button('开关：关', { toggle: true, value: false, name: 'button.toggle' });
          toggle.on('change', (value: boolean) => {
            this.toggled.value = value;
            toggle.setText(`开关：${value ? '开' : '关'}`);
          });
          this.probe('button.toggle', toggle, 'normal');
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
            container: { gap: 2 },
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
    return widget;
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
        toggled: this.toggled.value,
        text: this.text.value,
        invalid: this.invalid.value,
        notes: this.notes.value.length,
      }),
      focusables: () => this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
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
