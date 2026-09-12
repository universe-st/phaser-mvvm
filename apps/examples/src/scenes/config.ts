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
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

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
            // Safe area: zero on a desktop, and the *only* plugin option whose value comes from the
            // device rather than the config object (`env(safe-area-inset-*)`, re-read on every resize).
            this.track(
              'safeArea',
              Text(
                () => {
                  const root = this.mvvm.root;
                  const insets = root.safeAreaInsets;
                  const device = root.deviceSafeAreaInsets;
                  return (
                    `safe area: device ${Math.round(device.top)}/${Math.round(device.bottom)} → ` +
                    `reserved top ${Math.round(insets.top)} / bottom ${Math.round(insets.bottom)} ` +
                    `(${root.safeAreaEnabled ? 'on' : 'off'}, ${this.scaleMode()})`
                  );
                },
                { tone: 'muted', name: 'config.safeArea' },
              ),
            );
          },
        );
      }),
    );
  }

  /** `RESIZE` / `FIT` / … — the scale mode decides how page coordinates and insets relate. */
  private scaleMode(): string {
    const mode = this.scale.scaleMode;
    const names: Record<number, string> = {
      0: 'NONE',
      1: 'WIDTH_CONTROLS_HEIGHT',
      2: 'HEIGHT_CONTROLS_WIDTH',
      3: 'FIT',
      4: 'ENVELOP',
      5: 'RESIZE',
    };
    return names[mode] ?? String(mode);
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
    this.publishSafeArea();
    this.publishMotion();
  }

  /**
   * Publishes the motion policy this scene would use right now.
   *
   * `transitionFor()` is what `modal.open()` asks, so these numbers are "what the next dialog will do"
   * rather than a copy of the config: it resolves the game-wide defaults, the runtime patch and
   * `prefers-reduced-motion` on every call. The acceptance uses it to show that a `patch({
   * transition })` really reaches the layer, and that patching one duration keeps the other
   * (`mergePluginConfig` does one level of merging per bag).
   */
  private publishMotion(): void {
    const policy = this.mvvm.transitionFor();
    this.publish('motion.enter', policy.enter.duration);
    this.publish('motion.exit', policy.exit.duration);
    this.publish('motion.reduced', policy.reduced ? 1 : 0);
  }

  /** Publishes the safe-area readings so a check can watch them change (see `ACCEPTANCE-mobile.md`). */
  private publishSafeArea(): void {
    const root = this.mvvm.root;
    const insets = root.safeAreaInsets;
    const device = root.deviceSafeAreaInsets;
    const padding = root.layoutParams.padding;
    this.publish('device.top', Math.round(device.top));
    this.publish('device.bottom', Math.round(device.bottom));
    this.publish('safeArea.top', Math.round(insets.top));
    this.publish('safeArea.bottom', Math.round(insets.bottom));
    this.publish('safeArea.left', Math.round(insets.left));
    this.publish('safeArea.right', Math.round(insets.right));
    this.publish('root.padding.top', Math.round(padding.top));
    this.publish('root.padding.bottom', Math.round(padding.bottom));
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
      /** The motion policy in force, as `modal.open()` would resolve it (durations in ms). */
      motion: (): { enter: number; exit: number; reduced: boolean } => {
        const policy = this.mvvm.transitionFor();
        return {
          enter: policy.enter.duration,
          exit: policy.exit.duration,
          reduced: policy.reduced,
        };
      },
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
        return `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
          pagePoint(this.game, widget).y,
        )}`;
      },
      state: (): Record<string, unknown> => this.state(),
      /**
       * Safe-area readings: what the browser reports (`env(safe-area-inset-*)`) and what the root
       * reserved for it. On a desktop both are zero; on an emulated notched phone the second follows
       * the first (see `ACCEPTANCE-mobile.md`).
       */
      safeArea: () => {
        const root = this.mvvm.root;
        const device = root.deviceSafeAreaInsets;
        return {
          enabled: root.safeAreaEnabled,
          /** What the device reports (`env(safe-area-inset-*)`, CSS pixels). */
          device: {
            top: Math.round(device.top),
            right: Math.round(device.right),
            bottom: Math.round(device.bottom),
            left: Math.round(device.left),
          },
          /** What the root reserved after the canvas overlap, the CSS→design conversion and the clamp. */
          reserved: { ...root.safeAreaInsets },
          padding: { ...root.layoutParams.padding },
        };
      },
      /** Re-reads the insets and re-lays out — what a rotation does through the scene's resize handler. */
      resize: (): void => this.mvvm.root.resize(),
    };
    (window as unknown as { config?: unknown }).config = api;
  }
}
