/**
 * `#/hud` — a camera-pinned HUD over a scrolling world (the standing acceptance page for ADR-0009).
 *
 * ADR-0009 fixed "a pinned UI is visible but not clickable" by making `setScrollFactor` propagate down
 * the widget tree *and* by putting the input router in the same coordinate space as Phaser's own hit
 * test. That fix was accepted from runtime probes only — this scene makes it permanent and adds the two
 * cases the probes did not cover:
 *
 * 1. a **real click** on a pinned control while `camera.scrollX/Y ≠ 0` (score + focus);
 * 2. an **interactive control added after mount** (`window.hud.spawn()`), which must inherit the pinned
 *    scroll factor through `Widget.addWidget()` and still be clickable.
 *
 * The world is a 2400×1600 field of tiles; the HUD is one DSL page whose root is pinned with
 * `page.setScrollFactor(0)`. Everything a check needs is published:
 *
 * - `#demo-state`: `cam=x,y` · `clicks` · `score` · `world.clicks` · `late.spawned` · `late.sf` ·
 *   `late.clicks` · `focus` · `st.<name>` (visual state) · `pt.<name>` (page coordinate).
 * - `window.hud`: `scroll(x,y)` / `scrollBy(dx,dy)` / `auto(on)` / `spawn()` / `state()` / `names()` /
 *   `rest()` / `states()` / `sf(name)` / `hitTest(name,x,y)` / `pinRoot(on)` / `focus()` / `geometry()`.
 *
 * `pt.<name>` is the widget's **layout** position: with a pinned tree that is the on-screen point (which
 * is why the coordinate stays `@167,28` at any camera scroll). `pinRoot(false)` is only an A/B switch
 * for the unpinned case — then the layout position is *not* where the widget is drawn any more.
 *
 * Acceptance run: `docs/ACCEPTANCE-hud.md`.
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { buildUiSubtree, type Widget } from '@phaser-mvvm/phaser';
import { Button, Panel, Spacer, Text, TextField, ui } from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const TILE = 200;
const AUTO_SPEED = 1.4;
const MAX_LATE = 3;

interface Probe {
  widget: Widget;
  /** Expected `visualState` at rest, so a check can assert the baseline. */
  rest: string;
}

export class HudScene extends Phaser.Scene {
  private readonly score = ref(0);
  private readonly clicks = ref(0);
  private readonly lateClicks = ref(0);
  private readonly note = ref('');

  private worldClicks = 0;
  private lateSpawned = 0;
  private auto = false;
  private drift = 1;

  /** Names of the interactive objects Phaser's own pipeline reports under the pointer. */
  private over: string[] = [];

  private page: Widget | null = null;
  private hudBar: Widget | null = null;
  private lateSlot: Widget | null = null;

  private readonly probes = new Map<string, Probe>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('hud');
  }

  create(): void {
    this.buildWorld();

    const page = ui(this, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 10,
          padding: 0,
          variant: 'plain',
          width: 'fill',
          height: 'fill',
          alignItems: 'stretch',
          name: 'hud.page',
        },
        () => {
          const bar = Panel(
            {
              direction: 'horizontal',
              gap: 10,
              padding: 10,
              variant: 'overlay',
              alignItems: 'center',
              name: 'hud.bar',
            },
            () => {
              this.track('title', Text('相机钉住的 HUD', { name: 'hud.title' }), 'normal');
              this.track(
                'score',
                Button('加分', {
                  name: 'hud.scoreButton',
                  variant: 'primary',
                  onClick: () => {
                    this.score.value += 1;
                    this.clicks.value += 1;
                  },
                }),
                'normal',
              );
              this.track(
                'reset',
                Button('重置', {
                  name: 'hud.resetButton',
                  variant: 'ghost',
                  onClick: () => {
                    this.score.value = 0;
                  },
                }),
                'normal',
              );
              this.track(
                'readout',
                Text(() => `得分 ${this.score.value} · 点击 ${this.clicks.value}`, {
                  name: 'hud.readout',
                  tone: 'muted',
                }),
                'normal',
              );
              Spacer({ flex: true });
              this.track(
                'hint',
                Text('世界在滚动，HUD 不动', { name: 'hud.hint', tone: 'muted' }),
                'normal',
              );
            },
          );
          this.hudBar = bar;

          Spacer({ flex: true });

          Panel(
            {
              direction: 'horizontal',
              gap: 10,
              padding: 10,
              variant: 'overlay',
              alignItems: 'center',
              name: 'hud.footer',
            },
            () => {
              this.track(
                'field',
                TextField({
                  name: 'hud.field',
                  value: this.note,
                  width: 240,
                  placeholder: '钉住的输入框也能打字',
                }),
                'normal',
              );
              this.track(
                'fieldReadout',
                Text(() => `note=${this.note.value.length} 字`, {
                  name: 'hud.fieldReadout',
                  tone: 'muted',
                }),
                'normal',
              );
              // Where `spawn()` drops its late buttons: an always-present, predictably placed slot.
              this.lateSlot = Panel(
                {
                  direction: 'horizontal',
                  gap: 8,
                  padding: 0,
                  variant: 'plain',
                  alignItems: 'center',
                  name: 'hud.lateSlot',
                },
                () => {
                  // Deliberately empty: `spawn()` fills it after mount.
                },
              );
            },
          );
        },
      );
    });

    this.page = page;
    // The whole point of the page: pin the tree to the camera. Because the setter propagates, this one
    // call is enough — Phaser's hit test reads the *hit object's own* factor (ADR-0009).
    page.setScrollFactor(0);
    this.mvvm.mount(page);

    this.mvvm.focus.onFocusChange = (widget) => {
      this.publish('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#0d1117');

    appendStatus('--- hud · layout ---');
    reportWidget('page', page);
    if (this.hudBar) {
      reportWidget('bar', this.hudBar);
    }
    reportCanvas(this.game);
    this.publish('late.sf', 'n/a');
    this.exposeGlobals();
  }

  override update(): void {
    if (this.auto) {
      const camera = this.cameras.main;
      const maxX = Math.max(0, WORLD_WIDTH - camera.width);
      const maxY = Math.max(0, WORLD_HEIGHT - camera.height);
      let nextX = camera.scrollX + AUTO_SPEED * this.drift;
      if (nextX > maxX || nextX < 0) {
        this.drift *= -1;
        nextX = Phaser.Math.Clamp(nextX, 0, maxX);
      }
      camera.setScroll(nextX, Phaser.Math.Clamp(camera.scrollY + AUTO_SPEED / 2, 0, maxY));
    }

    for (const [name, probe] of this.probes) {
      if (probe.widget.isDestroyed) {
        continue;
      }
      this.publish(`st.${name}`, probe.widget.visualState);
      if (!probe.widget.visible) {
        continue;
      }
      const rect = probe.widget.appliedRect;
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const canvas = this.game.canvas.getBoundingClientRect();
      const origin = stagePosition(probe.widget);
      this.publish(
        `pt.${name}`,
        `@${Math.round(canvas.left + origin.x + rect.width / 2)},${Math.round(
          canvas.top + origin.y + rect.height / 2,
        )}`,
      );
    }

    this.publish(
      'cam',
      `${Math.round(this.cameras.main.scrollX)},${Math.round(this.cameras.main.scrollY)}`,
    );
    this.publish('score', this.score.value);
    this.publish('clicks', this.clicks.value);
    this.publish('world.clicks', this.worldClicks);
    this.publish('late.clicks', this.lateClicks.value);
    this.publish('late.spawned', this.lateSpawned);
    this.publish('over', this.over.length === 0 ? 'none' : this.over.join('+'));
    this.publish('field.text', this.note.value);
  }

  // ------------------------------------------------------------------ world

  /** A tiled world plus one interactive backdrop, so a click outside the HUD has a visible home. */
  private buildWorld(): void {
    const colors = [0x161b22, 0x1b2230, 0x131a24];
    const tiles = this.add.graphics();
    tiles.setDepth(-20);
    for (let y = 0; y < WORLD_HEIGHT; y += TILE) {
      for (let x = 0; x < WORLD_WIDTH; x += TILE) {
        const color = colors[((x / TILE + y / TILE) % colors.length) | 0] ?? 0x161b22;
        tiles.fillStyle(color, 1);
        tiles.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      }
    }
    // Landmarks, so a scrolling camera is visibly scrolling.
    for (let x = 0; x < WORLD_WIDTH; x += 400) {
      this.add
        .text(x + 16, 16, `x=${x}`, { fontFamily: 'monospace', fontSize: '20px', color: '#8b949e' })
        .setDepth(-19);
    }

    for (const event of ['pointermove', 'pointerdown'] as const) {
      this.input.on(event, (_pointer: unknown, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        this.over = (currentlyOver ?? []).map(
          (object) => (object as { name?: string }).name || object.constructor.name,
        );
      });
    }

    const backdrop = this.add
      .rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, 0.001)
      .setDepth(-10);
    backdrop.setInteractive();
    backdrop.on('pointerdown', () => {
      this.worldClicks += 1;
    });
  }

  // ------------------------------------------------------------------ api / publishing

  /** Adds an interactive control **after** mount (the `addWidget` inheritance case). */
  private spawn(): number {
    const slot = this.lateSlot;
    if (!slot || this.lateSpawned >= MAX_LATE) {
      return this.lateSpawned;
    }
    const index = ++this.lateSpawned;
    const name = `late${index}`;
    const button = buildUiSubtree(
      this,
      () =>
        Button(`迟到 #${index}`, {
          name: `hud.${name}`,
          variant: 'secondary',
          onClick: () => {
            this.lateClicks.value += 1;
          },
        }),
      'hud.spawn()',
    );
    slot.addWidget(button);
    this.probes.set(name, { widget: button, rest: 'normal' });
    this.publish('late.sf', `${button.scrollFactorX},${button.scrollFactorY}`);
    return index;
  }

  /** Moves the camera and reports where it actually ended up (the bounds clamp). */
  private setScroll(x: number, y: number): string {
    this.cameras.main.setScroll(x, y);
    return `${Math.round(this.cameras.main.scrollX)},${Math.round(this.cameras.main.scrollY)}`;
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  private track(name: string, widget: Widget, rest: string): Widget {
    this.probes.set(name, { widget, rest });
    return widget;
  }

  private exposeGlobals(): void {
    (window as unknown as { hud?: unknown }).hud = {
      /** Absolute camera scroll (clamped by the world bounds). */
      scroll: (x: number, y: number): string => this.setScroll(x, y),
      scrollBy: (dx: number, dy: number): string =>
        this.setScroll(this.cameras.main.scrollX + dx, this.cameras.main.scrollY + dy),
      /** Continuous camera drift, so a human can see the pinning without touching the keyboard. */
      auto: (on: boolean): boolean => {
        this.auto = on === true;
        return this.auto;
      },
      spawn: (): number => this.spawn(),
      /**
       * A/B switch for the two pinning styles: `true` pins the whole UI root (the recipe in the guide
       * and ADR-0009), `false` puts it back in world space. The page keeps its own `setScrollFactor(0)`
       * unless the root's factor is propagated over it, so `pinRoot(false)` also unpins the page.
       */
      pinRoot: (on: boolean): string => {
        this.mvvm.root.setScrollFactor(on ? 0 : 1);
        return `${this.mvvm.root.scrollFactorX},${this.mvvm.root.scrollFactorY}`;
      },
      state: () => ({
        score: this.score.value,
        clicks: this.clicks.value,
        worldClicks: this.worldClicks,
        lateClicks: this.lateClicks.value,
        lateSpawned: this.lateSpawned,
        note: this.note.value,
        cam: [Math.round(this.cameras.main.scrollX), Math.round(this.cameras.main.scrollY)],
      }),
      names: () => [...this.probes.keys()],
      rest: () => Object.fromEntries([...this.probes].map(([name, probe]) => [name, probe.rest])),
      states: () =>
        Object.fromEntries(
          [...this.probes].map(([name, probe]) => [name, probe.widget.visualState]),
        ),
      /** Scroll factor of a probe's widget; `0,0` is what a camera-pinned tree must report. */
      sf: (name: string): string => {
        const widget = this.probes.get(name)?.widget;
        return widget ? `${widget.scrollFactorX},${widget.scrollFactorY}` : 'missing';
      },
      /**
       * Phaser's **own** hit test for a probe at a page coordinate, i.e. the first of the two gates
       * ADR-0009 describes (`1` = Phaser found it, `0` = Phaser's hit test already said no). Reading it
       * next to a real click separates "Phaser never hit it" from "our router rejected it".
       */
      hitTest: (name: string, x: number, y: number): number => {
        const widget = this.probes.get(name)?.widget;
        if (!widget) {
          return -1;
        }
        const canvas = this.game.canvas.getBoundingClientRect();
        const pointer = this.input.activePointer;
        const previous = { x: pointer.x, y: pointer.y };
        pointer.x = x - canvas.left;
        pointer.y = y - canvas.top;
        const hits = this.input.manager.hitTest(pointer, [widget], this.cameras.main);
        pointer.x = previous.x;
        pointer.y = previous.y;
        return hits.length;
      },
      focus: () => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: () => this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      geometry: () => ({
        page: rectOf(this.page),
        cam: [Math.round(this.cameras.main.scrollX), Math.round(this.cameras.main.scrollY)],
        probes: Object.fromEntries(
          [...this.probes].map(([name, probe]) => [name, rectOf(probe.widget)]),
        ),
      }),
    };
  }
}

function rectOf(widget: Widget | null): [number, number] | null {
  if (!widget || widget.isDestroyed) {
    return null;
  }
  const rect = widget.appliedRect;
  return [Math.round(rect.width), Math.round(rect.height)];
}
