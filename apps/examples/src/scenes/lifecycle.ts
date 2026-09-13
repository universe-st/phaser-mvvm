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
 * | `frameListeners`        | a per-frame hook (scroll coasting, text drag auto-scroll) must unregister |
 *
 * `window.lifecycle` drives it: `churn(n)` restarts the scene `n` times and resolves with the
 * samples, `samples()` reads the current list, `state()` reports the current `#demo-state` values.
 * The page also mirrors the live counters into `#status` so a plain reload is informative.
 *
 * Round 110 closed the three gaps DEFECT-BACKLOG §4 had left open, all of them "a lifecycle path that
 * was never exercised":
 *
 * - **a focused field** — `focusField()` puts the caret in the text field and `churnFocused(n)` restarts
 *   with it focused, so the caret-blink timer (`clock.addEvent({ loop: true })`) and the window-level
 *   key guard are covered. They are the two things a field installs *outside* its own subtree, and a
 *   leaked blink timer keeps repainting a destroyed field forever (`timers` is the counter that sees it).
 * - **a second scene** — `churnScenes(n)` adds a companion scene, starts it, stops it and finally
 *   removes it through `SceneManager.remove()`, sampling all three phases. `scene.stop()` is the only
 *   path that runs the plugin's SHUTDOWN teardown while the scene object stays alive, and
 *   `manager.remove()` is the only one that reaches DESTROY.
 * - **coexistence** — the same rounds assert that this page's own counters are unchanged while another
 *   scene's UI comes and goes, because both scenes' widgets subscribe to the same theme emitter
 *   (`themeListenerCount()` is module-global).
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
  Slider,
  Spacer,
  Stack,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { makeTileTexture, setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

const TILE = 'lifecycle.tile';
const ROWS = 40;
/** Key of the scene `churnScenes()` brings up alongside this one. */
const COMPANION_KEY = 'lifecycle-companion';

/** How many companion scenes have been built (module-level: it outlives this scene's restarts). */
let companionBuilds = 0;
/** Every companion page built so far, so a check can ask whether it was really destroyed. */
const companionPages: Widget[] = [];

/**
 * A second scene with a UI of its own, used by `churnScenes()`.
 *
 * Deliberately a *different* scene rather than another page of this one: what is under test is that
 * `scene.stop()` and `SceneManager.remove()` tear a scene's UI down completely (the plugin's SHUTDOWN
 * handler), while the scene next to it keeps its own tree, its counters and its focus.
 */
class LifecycleCompanion extends Phaser.Scene {
  /** The companion's page, for the "was it destroyed" question. */
  page: Widget | null = null;

  constructor() {
    super(COMPANION_KEY);
  }

  create(): void {
    companionBuilds += 1;
    const page = ui(this, () => {
      Panel(
        { direction: 'vertical', gap: 8, padding: 12, variant: 'surfaceAlt', width: 'fill' },
        () => {
          Text(`伴生场景 #${companionBuilds}`, { tone: 'muted' });
          Button('伴生按钮', { name: 'companion.button' });
          Slider({ value: 10, min: 0, max: 100, width: 120, name: 'companion.slider' });
          TextField({ value: '', label: '伴生字段', name: 'companion.field', clearable: true });
        },
      );
    });
    this.page = page;
    this.mvvm.mount(page);
  }
}

/** The scene's per-frame events whose listener count is part of the leak gate (see `Sample`). */
const FRAME_EVENTS = ['preupdate', 'update', 'postupdate'] as const;

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
  /**
   * Listeners on the scene's per-frame events (`preupdate`/`update`/`postupdate`).
   *
   * A widget that drives something frame by frame registers one of these (`ScrollView`'s coasting,
   * `TextInputBase`'s drag auto-scroll), and a widget that forgets to unregister it leaks the whole
   * widget: the handler runs after the scene was torn down, and the closure keeps the object alive.
   * None of the other counters can see that — the display list, the focus manager and the input router
   * all let go of a destroyed widget just fine (round 97 added this row together with the auto-scroll).
   */
  frameListeners: number;
}

/** Samples are module-level: they have to survive the scene restarts they describe. */
const samples: Sample[] = [];
/** Rounds of the most recent `churnScenes()` run; module-level for the same reason as `samples`. */
const sceneRounds: SceneRound[] = [];
/** Every page built so far, so a check can ask whether the previous one was really destroyed. */
const pages: { cycle: number; page: Widget; root: unknown }[] = [];
let cycle = 0;

interface RowItem {
  id: string;
  label: string;
}

/** One round of `churnScenes()`: three samples around a companion scene's whole life. */
interface SceneRound {
  round: number;
  /** Active scenes in the SceneManager — 2 while the companion runs, 1 once it is stopped. */
  activeScenes: number;
  /** How many companion scenes have been built since the page loaded. */
  builds: number;
  /** This page's counters while the companion is up (its theme listeners are included). */
  during: Sample;
  /** …after `scene.stop(COMPANION_KEY)` — the companion's UI must be gone. */
  after: Sample;
  /** …after `SceneManager.remove(COMPANION_KEY)` — the DESTROY path. */
  removed: Sample;
  /** Whether the companion's page reports itself destroyed after the stop. */
  companionDestroyed: boolean;
}

export class LifecycleScene extends Phaser.Scene {
  private readonly name = ref('张三');
  private readonly notes = ref('');
  private readonly rows = ref<RowItem[]>(
    Array.from({ length: ROWS }, (_, index) => ({ id: `r${index}`, label: `行 ${index + 1}` })),
  );
  private readonly clicks = ref(0);
  private readonly slider = ref(30);

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
            // The slider is the one widget that listens to the *scene* pointer stream while dragging;
            // it is here so the leak gate covers its listener bookkeeping.
            Slider({ value: this.slider, min: 0, max: 100, width: 160, name: 'slider' });
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
                gap: 2,
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
    setDemoState('frameListeners', sample.frameListeners);
    appendStatus(
      `lifecycle#${sample.cycle} theme=${sample.themeListeners} list=${sample.displayList} ` +
        `focus=${sample.focusables} pointer=${sample.pointerTargets} tex=${sample.textures} ` +
        `tweens=${sample.tweens} timers=${sample.timers} widgets=${sample.widgets} ` +
        `frame=${sample.frameListeners}`,
    );

    this.resolveCreate?.();
    this.resolveCreate = null;
  }

  private track(key: string, widget: Widget): void {
    this.tracked.set(key, widget);
  }

  /** Repaints `pt.<key>=@x,y` so a check can click the restarted scene's controls. */
  private publishControls(): void {
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed || !widget.visible) {
        continue;
      }
      const rect = widget.appliedRect;
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const value = `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
        pagePoint(this.game, widget).y,
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
      frameListeners: (this.events as unknown as { listenerCount?: (event: string) => number })
        .listenerCount
        ? FRAME_EVENTS.reduce(
            (total, event) =>
              total +
              ((
                this.events as unknown as { listenerCount: (event: string) => number }
              ).listenerCount(event) || 0),
            0,
          )
        : -1,
    };
  }

  /**
   * Focuses the page's text field and restarts the scene, resolving after the restart was sampled.
   *
   * The restart is the point: a field that leaks its caret-blink timer keeps a `TimerEvent` on the
   * *scene's* clock, so the sample taken after the next `create()` shows one more timer than the
   * baseline — and that is exactly the counter DEFECT-BACKLOG §4 asked for.
   */
  private async focusFieldAndRestart(): Promise<void> {
    const field = this.tracked.get('name');
    if (field && !field.isDestroyed) {
      this.mvvm.focus.focus(field as never);
      // The blink timer is created by the field's per-frame focus bookkeeping, not by `focus()`.
      await this.waitFrames(2);
    }
    const done = new Promise<void>((resolve) => {
      this.resolveCreate = resolve;
    });
    this.scene.restart();
    await done;
  }

  /**
   * Resolves after `count` more POST_UPDATE frames of this scene.
   *
   * The listener is removed before resolving, so a sample taken right after the await never counts the
   * waiter itself among the frame listeners it is measuring.
   */
  private waitFrames(count: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let left = count;
      const tick = (): void => {
        left -= 1;
        if (left > 0) {
          return;
        }
        this.events.off(Phaser.Scenes.Events.POST_UPDATE, tick);
        resolve();
      };
      this.events.on(Phaser.Scenes.Events.POST_UPDATE, tick);
    });
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
      /**
       * Puts the framework focus into the page's text field and reports who holds it.
       *
       * Focusing is what starts the caret blink (`clock.addEvent({ loop: true })`) and installs the
       * window-level key guard — two things a field owns *outside* its own subtree, and the only two a
       * careless `destroy()` can leave behind.
       */
      focusField: (): string => {
        const field = this.tracked.get('name');
        if (!field || field.isDestroyed) {
          return 'none';
        }
        this.mvvm.focus.focus(field as never);
        return field.name || 'unnamed';
      },
      /**
       * What the focused-field path looks like from outside: who holds focus, and the two counters a
       * leak there would move — pending clock events (the caret blink) and per-frame listeners (the
       * drag auto-scroll and the scroll coasting).
       */
      fieldProbe: (): { focused: string; timers: number; frameListeners: number } => {
        const sample = this.sample();
        return {
          focused: this.mvvm.focus.focusedWidget?.name || 'none',
          timers: sample.timers,
          frameListeners: sample.frameListeners,
        };
      },
      /** Restarts `count` times with the text field focused, so the caret/blink path is covered. */
      churnFocused: async (count: number): Promise<Sample[]> => {
        for (let index = 0; index < count; index += 1) {
          await this.focusFieldAndRestart();
        }
        return samples.map((sample) => ({ ...sample }));
      },
      /**
       * Brings a second scene up, stops it and removes it — `count` times — sampling all three phases.
       *
       * The three phases are the three teardown paths Phaser has: `stop()` fires SHUTDOWN with the
       * scene object alive (and able to `start()` again), `SceneManager.remove()` follows with DESTROY
       * and takes the scene out of the manager for good. Sampling between them is what tells "the UI
       * was destroyed" apart from "the widget tree is still there, unreferenced".
       */
      churnScenes: async (count: number): Promise<SceneRound[]> => {
        const rounds: SceneRound[] = [];
        for (let index = 0; index < count; index += 1) {
          const builds = companionBuilds;
          if (!this.scene.manager.getScene(COMPANION_KEY)) {
            this.scene.add(COMPANION_KEY, LifecycleCompanion, false);
          }
          const companion = this.scene.manager.getScene(COMPANION_KEY) as LifecycleCompanion;
          this.scene.launch(COMPANION_KEY);
          await this.waitFrames(2);

          const during = this.sample();
          const activeScenes = this.scene.manager.getScenes(true).length;

          this.scene.stop(COMPANION_KEY);
          await this.waitFrames(2);
          const after = this.sample();
          const companionDestroyed = companion.page?.isDestroyed === true;
          if (companion.page && !companionPages.includes(companion.page)) {
            companionPages.push(companion.page);
          }

          this.scene.manager.remove(COMPANION_KEY);
          await this.waitFrames(2);
          const removed = this.sample();

          rounds.push({
            round: index + 1,
            activeScenes,
            builds,
            during,
            after,
            removed,
            companionDestroyed,
          });
          setDemoState('scenes.round', index + 1);
          setDemoState('scenes.builds', companionBuilds);
          setDemoState('scenes.active', this.scene.manager.getScenes(true).length);
        }
        sceneRounds.length = 0;
        sceneRounds.push(...rounds);
        return rounds.map((round) => ({ ...round }));
      },
      /** Samples the three phases of a `churnScenes()` round from the outside. */
      sceneRounds: (): SceneRound[] =>
        sceneRounds.map((round) => ({
          ...round,
          during: { ...round.during },
          after: { ...round.after },
          removed: { ...round.removed },
        })),
      /** Live/dead state of every companion page ever built. */
      companionPages: () =>
        companionPages.map((page) => ({
          destroyed: page.isDestroyed,
          widgets: countWidgets(page),
        })),
      /** How many companion scenes have been built since the page loaded. */
      companionBuilds: () => companionBuilds,
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
