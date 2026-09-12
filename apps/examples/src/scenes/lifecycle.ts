/**
 * `#/lifecycle` — the leak gate: scene create → destroy, 100 times, with counters that must return to
 * their baseline.
 *
 * PLAN §7 / AGENTS §4.4 make "counters back to zero after create→destroy ×100" a hard gate, but until
 * now nothing automated checked it: the Node unit tests only cover pure helpers, and the other scenes
 * never destroy themselves. This scene builds one page containing **every** widget and container type,
 * then restarts the scene on demand and samples the framework's leak indicators after each create:
 *
 * | sample                  | why it must stay flat                                              |
 * | ----------------------- | ------------------------------------------------------------------ |
 * | `themeListeners`        | every widget subscribes to theme changes and must unsubscribe       |
 * | `displayList`           | Phaser's display list must not accumulate game objects              |
 * | `focusables`            | the focus manager must not keep destroyed widgets                   |
 * | `pointerTargets`        | the input router must not keep destroyed widgets                    |
 * | `sceneObjects`          | no orphan `GameObject`s left on the scene                           |
 * | `textures`              | no texture created per cycle                                        |
 * | `tweens` / `timers`     | no timer (caret blink) outliving its field                          |
 *
 * `window.lifecycle` drives it: `churn(n)` restarts the scene `n` times and resolves with the
 * samples, `samples()` reads the current list, `state()` reports the current `#demo-state` values.
 * The page also mirrors the live counters into `#status` so a plain reload is informative.
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { themeListenerCount, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Column,
  Divider,
  Grid,
  Image,
  List,
  Panel,
  Row,
  Scroll,
  Spacer,
  Stack,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { makeTileTexture, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

const TILE = 'lifecycle.tile';
const ROWS = 40;

interface Sample {
  cycle: number;
  themeListeners: number;
  displayList: number;
  sceneObjects: number;
  focusables: number;
  pointerTargets: number;
  textures: number;
  tweens: number;
  timers: number;
  widgets: number;
}

/** Samples are module-level: they have to survive the scene restarts they describe. */
const samples: Sample[] = [];
/** Every page built so far, so a check can ask whether the previous one was really destroyed. */
const pages: { cycle: number; page: Widget; root: unknown }[] = [];
let cycle = 0;

interface RowItem {
  id: string;
  label: string;
}

export class LifecycleScene extends Phaser.Scene {
  private readonly name = ref('张三');
  private readonly notes = ref('');
  private readonly rows = ref<RowItem[]>(
    Array.from({ length: ROWS }, (_, index) => ({ id: `r${index}`, label: `行 ${index + 1}` })),
  );
  private readonly clicks = ref(0);

  private page: Widget | null = null;
  /** Controls whose page coordinates are republished every frame (`pt.<key>`), like `#/compose`. */
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();
  private created = 0;
  /** Frames still to wait before sampling; see the comment in `create()`. */
  private pendingSample = 0;
  private resolveCreate: (() => void) | null = null;

  constructor() {
    super('lifecycle');
  }

  create(): void {
    makeTileTexture(this, TILE);
    cycle += 1;
    this.created = cycle;

    const page = ui(this, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 10,
          padding: 16,
          variant: 'surface',
          width: 'fill',
          height: 'fill',
          alignItems: 'stretch',
        },
        () => {
          Text(() => `生命周期检查 · 第 ${this.clicks.value} 次点击`, { tone: 'muted' });
          Divider({});
          Row({ gap: 8, alignItems: 'center', wrap: true }, () => {
            this.track(
              'click',
              Button('点击', { name: 'click', onClick: () => this.clicks.value++ }),
            );
            Button('开关', { toggle: true, value: false });
            Button('禁用', { disabled: true });
            Button('加载', { loading: true });
            Button('图标', { icon: TILE });
            Text('文本', { tone: 'muted' });
            Spacer({ width: 12 });
            Image({ texture: TILE, width: 24, height: 24 });
          });
          Grid({ columns: 3, columnGap: 8, rowGap: 8 }, () => {
            for (let index = 0; index < 3; index += 1) {
              Panel({ variant: 'surfaceAlt', radius: 8, padding: 8, height: 40 }, () => {
                Text(`格子 ${index + 1}`, { tone: 'muted' });
              });
            }
          });
          Stack({ align: 'start', width: 200, height: 60 }, () => {
            Panel({ variant: 'surfaceAlt', radius: 8, width: 'fill', height: 'fill' });
            Text('层叠', { tone: 'muted' });
          });
          Row({ gap: 8, width: 'fill', alignItems: 'stretch' }, () => {
            Column({ gap: 8, grow: 1, alignItems: 'stretch' }, () => {
              this.track(
                'name',
                TextField({ value: this.name, label: '姓名', name: 'name', clearable: true }),
              );
              Text(() => `读出：${this.name.value}`, { tone: 'muted' });
            });
            Column({ gap: 8, grow: 1, alignItems: 'stretch' }, () => {
              TextArea({ value: this.notes, rows: 2, label: '备注' });
            });
          });
          Scroll({ direction: 'vertical', height: 140, width: 'fill', name: 'list' }, () => {
            List(
              {
                items: () => this.rows.value,
                key: (row) => row.id,
                width: 'fill',
                height: 140,
                container: { gap: 2 },
                virtualize: true,
                itemExtent: 24,
              },
              (row) => {
                Row({ gap: 6, height: 22, alignItems: 'center', width: 'fill' }, () => {
                  Text(() => row.label);
                  Spacer({ flex: true });
                });
              },
            );
          });
        },
      );
    });

    this.page = page;
    this.mvvm.mount(page);
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    pages.push({ cycle: this.created, page, root: this.mvvm.hasRoot ? this.mvvm.root : null });

    appendStatus(`--- lifecycle · create #${this.created} ---`);
    reportWidget('page', page);
    reportCanvas(this.game);

    // Sampled in `update()`, and not on the first frame either: the virtualised list mounts its rows
    // and the input/focus collections are refreshed *after* the create frame, so a sample taken any
    // earlier would describe a partially built page (and the very first cycle of a game boot sees one
    // more internal step than a restart does, which would make the baseline incomparable).
    this.pendingSample = 2;
    this.exposeGlobals();
  }

  override update(): void {
    this.publishControls();
    if (this.pendingSample === 0) {
      return;
    }
    this.pendingSample -= 1;
    if (this.pendingSample > 0) {
      return;
    }

    const sample = this.sample();
    samples.push(sample);
    setDemoState('cycle', sample.cycle);
    setDemoState('themeListeners', sample.themeListeners);
    setDemoState('displayList', sample.displayList);
    setDemoState('focusables', sample.focusables);
    setDemoState('pointerTargets', sample.pointerTargets);
    appendStatus(
      `lifecycle#${sample.cycle} theme=${sample.themeListeners} list=${sample.displayList} ` +
        `focus=${sample.focusables} pointer=${sample.pointerTargets} tex=${sample.textures} ` +
        `tweens=${sample.tweens} timers=${sample.timers} widgets=${sample.widgets}`,
    );

    this.resolveCreate?.();
    this.resolveCreate = null;
  }

  private track(key: string, widget: Widget): void {
    this.tracked.set(key, widget);
  }

  /** Repaints `pt.<key>=@x,y` so a check can click the restarted scene's controls. */
  private publishControls(): void {
    const canvas = this.game.canvas.getBoundingClientRect();
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed || !widget.visible) {
        continue;
      }
      const rect = widget.appliedRect;
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const origin = stagePosition(widget);
      const value = `@${Math.round(canvas.left + origin.x + rect.width / 2)},${Math.round(
        canvas.top + origin.y + rect.height / 2,
      )}`;
      if (this.published.get(key) === value) {
        continue;
      }
      this.published.set(key, value);
      setDemoState(`pt.${key}`, value);
    }
  }

  /** Snapshot of every leak indicator the framework can report. */
  private sample(): Sample {
    return {
      cycle: this.created,
      themeListeners: themeListenerCount(),
      displayList: this.children.length,
      sceneObjects: this.children.list.length,
      focusables: this.mvvm.hasRoot ? this.mvvm.focus.focusables.length : 0,
      pointerTargets: this.mvvm.hasRoot ? this.mvvm.input.widgets.length : 0,
      textures: this.textures.getTextureKeys().length,
      tweens: this.tweens.getTweens().length,
      // `Clock#_active` is the only public-ish view of pending timer events (Phaser 4 has no getter).
      timers: (this.time as unknown as { _active?: unknown[] })._active?.length ?? 0,
      widgets: countWidgets(this.page),
    };
  }

  private exposeGlobals(): void {
    (window as unknown as { lifecycle?: unknown }).lifecycle = {
      samples: () => samples.map((sample) => ({ ...sample })),
      /** Live/dead state of every page ever built, oldest first. */
      pages: () =>
        pages.map((entry) => ({
          cycle: entry.cycle,
          destroyed: entry.page.isDestroyed,
          widgets: countWidgets(entry.page),
          active: entry.page.active,
        })),
      themeListeners: () => themeListenerCount(),
      state: () => ({
        cycle: this.created,
        name: this.name.value,
        notes: this.notes.value,
        clicks: this.clicks.value,
        rows: this.rows.value.length,
      }),
      /** Restarts the scene `count` times, awaiting each `create()`. */
      churn: async (count: number): Promise<Sample[]> => {
        for (let index = 0; index < count; index += 1) {
          const done = new Promise<void>((resolve) => {
            this.resolveCreate = resolve;
          });
          this.scene.restart();
          await done;
        }
        return samples.map((sample) => ({ ...sample }));
      },
      /** Scrolls the list, so the churn also covers a scrolled/rows-mutated state. */
      poke: (): void => {
        const list = this.children.getByName('list');
        void list;
        this.rows.value = this.rows.value.slice(0, 5);
      },
    };
  }
}

function countWidgets(widget: Widget | null): number {
  if (!widget) {
    return 0;
  }
  let total = 1;
  for (const child of widget.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
