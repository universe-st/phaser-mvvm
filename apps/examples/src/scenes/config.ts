/**
 * `#/config` — the acceptance page for the plugin options (`MVVMPlugin.configure` / `mvvm.configure`).
 *
 * Until round 66 plugin options could only be set at runtime, one scene at a time, because Phaser
 * instantiates scene plugins as `new Plugin(scene, pluginManager, mapKey)` — an options object in the
 * Game Config entry is never passed. The guide documented that limitation in four places. Now there are
 * two supported ways, and this page asserts both:
 *
 * - **game-wide defaults** (`MVVMPlugin.configure({ … })`, called once in `main.ts` before the game is
 *   created) — the app sets `a11y: { politeness: 'assertive' }` there, and the live region on this page
 *   reports it back;
 * - **runtime patch** (`this.mvvm.configure({ … })`) — applied immediately for the options that own a
 *   subscription or a live object, stored for the ones that describe how the UI is built.
 *
 * `window.config`: `patch(options)` / `defaults()` / `cameraColor()` / `liveAttrs()` / `theme(name)` /
 * `focus(name)` / `focusName()` / `router()` / `state()`.
 */

import Phaser from 'phaser';
import { MVVMPlugin, type MVVMPluginConfig, type Widget } from '@phaser-mvvm/phaser';
import { Button, Divider, Panel, Row, Text, ui } from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

export class ConfigScene extends Phaser.Scene {
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();
  private patched = 0;

  constructor() {
    super('config');
  }

  create(): void {
    this.buildPage();
    this.exposeApi();

    setDemoState('scene', 'config');
    appendStatus('--- config ---');
    reportCanvas(this.game);
    reportWidget('config.page', this.mvvm.root);
    appendStatus(
      `defaults.a11y=${JSON.stringify(MVVMPlugin.defaults.a11y ?? null).replace(/\s/g, '')}`,
    );
  }

  private buildPage(): void {
    // The DSL needs an open scope: widgets are built inside the lambda, never at the top level.
    this.mvvm.mount(
      ui(this, () => {
        Panel(
          {
            direction: 'vertical',
            gap: 12,
            padding: 20,
            variant: 'surface',
            radius: 12,
            width: 560,
            name: 'config.page',
          },
          () => {
            this.track(
              'title',
              Text('插件选项 · MVVMPlugin.configure', { size: 'lg', name: 'config.title' }),
            );
            this.track(
              'hint',
              Text(
                '游戏级默认值在 new Phaser.Game 之前设置；运行期补丁用 this.mvvm.configure()。',
                {
                  tone: 'muted',
                  name: 'config.hint',
                  maxLines: 2,
                },
              ),
            );
            Divider({});
            Row({ gap: 10 }, () => {
              for (let index = 1; index <= 3; index++) {
                this.track(
                  `button${index}`,
                  Button(`按钮 ${index}`, {
                    name: `config.button${index}`,
                    variant: index === 1 ? 'primary' : 'secondary',
                    onClick: () => {
                      this.patched += 1;
                    },
                  }),
                );
              }
            });
            this.track(
              'note',
              Text(() => this.note(), { tone: 'muted', name: 'config.note', maxLines: 3 }),
            );
          },
        );
      }),
    );
  }

  private note(): string {
    const defaults = MVVMPlugin.defaults.a11y;
    const politeness = defaults === false ? 'off' : (defaults?.politeness ?? 'polite (default)');
    return `游戏级 a11y.politeness = ${politeness}`;
  }

  override update(): void {
    this.publish('patched', this.patched);
    this.publish('focus', this.mvvm.focus.focusedWidget?.name || 'none');
    this.publish('dragThreshold', this.mvvm.input.dragThreshold);
    this.publish('navigation', this.mvvm.a11y.enabled ? 'a11y-on' : 'a11y-off');
    this.publish('camera', this.cameraColor());
    this.publish(
      'live',
      document.querySelector('[data-mvvm-a11y-live]')?.getAttribute('aria-live') ?? 'none',
    );
  }

  private publish(key: string, value: string | number): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  private track(key: string, widget: Widget): Widget {
    this.tracked.set(key, widget);
    return widget;
  }

  /** The main camera's clear colour as `#rrggbb`. */
  private cameraColor(): string {
    const camera = this.cameras?.main as unknown as {
      backgroundColor?: { color?: number; rgba?: string };
    };
    const color = camera?.backgroundColor;
    if (typeof color?.color === 'number') {
      return `#${(color.color & 0xffffff).toString(16).padStart(6, '0')}`;
    }
    return typeof color?.rgba === 'string' ? color.rgba : 'none';
  }

  /** Everything a check wants to read in one call. */
  private state(): Record<string, unknown> {
    return {
      camera: this.cameraColor(),
      live: document.querySelector('[data-mvvm-a11y-live]')?.getAttribute('aria-live') ?? 'none',
      a11y: this.mvvm.a11y.enabled,
      dragThreshold: this.mvvm.input.dragThreshold,
      focus: this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: this.mvvm.focus.focusables.length,
      patched: this.patched,
    };
  }

  private exposeApi(): void {
    const api = {
      /** Applies a runtime patch to this scene's plugin. */
      patch: (options: MVVMPluginConfig): Record<string, unknown> => {
        this.mvvm.configure(options);
        return this.state();
      },
      /** The game-wide defaults the app set before creating the game. */
      defaults: (): Record<string, unknown> => ({ ...MVVMPlugin.defaults }),
      cameraColor: (): string => this.cameraColor(),
      liveAttrs: (): Record<string, string> => {
        const region = document.querySelector('[data-mvvm-a11y-live]');
        return region
          ? {
              role: region.getAttribute('role') ?? '',
              live: region.getAttribute('aria-live') ?? '',
            }
          : {};
      },
      theme: (name: 'dark' | 'light'): string => this.mvvm.setTheme(name).name,
      focus: (name: string): string => {
        const widget = this.mvvm.focus.focusables.find((candidate) => candidate.name === name);
        if (!widget) {
          return 'not-focusable';
        }
        this.mvvm.focus.focus(widget);
        return this.mvvm.focus.focusedWidget?.name ?? 'none';
      },
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      router: (): { dragThreshold: number; targets: number } => ({
        dragThreshold: this.mvvm.input.dragThreshold,
        targets: this.mvvm.input.widgets.length,
      }),
      /** Page coordinates of a named control, computed on demand. */
      point: (name: string): string => {
        const widget = this.tracked.get(name);
        if (!widget) {
          return 'none';
        }
        const canvas = this.game.canvas.getBoundingClientRect();
        const origin = stagePosition(widget);
        return `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
          canvas.top + origin.y + widget.appliedRect.height / 2,
        )}`;
      },
      state: (): Record<string, unknown> => this.state(),
    };
    (window as unknown as { config?: unknown }).config = api;
  }
}
