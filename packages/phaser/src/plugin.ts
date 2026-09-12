/**
 * Scene plugin: `this.mvvm` inside a Scene.
 *
 * Registered through the Game Config:
 *
 * ```ts
 * new Phaser.Game({
 *   plugins: {
 *     scene: [{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm', start: true }],
 *   },
 * });
 * ```
 *
 * Responsibilities:
 * - own the `UIRoot` (created lazily through `this.mvvm.root`),
 * - drive the frame-aligned flush: pending reactive updates are flushed once per frame **before**
 *   layout, so N data changes in a frame cost one layout pass (see ADR-0008),
 * - tear the UI down on scene `shutdown`/`destroy` so widgets, listeners and bindings cannot leak.
 */

import Phaser from 'phaser';
import { flushFrame } from '@phaser-mvvm/core';
import { UIRoot, type UIRootOptions } from './UIRoot';
import { Widget } from './Widget';

export interface MVVMPluginConfig extends UIRootOptions {}

export class MVVMPlugin extends Phaser.Plugins.ScenePlugin {
  private readonly config: MVVMPluginConfig;
  private uiRoot: UIRoot | null = null;

  constructor(
    scene: Phaser.Scene,
    pluginManager: Phaser.Plugins.PluginManager,
    pluginKey: string,
    config: MVVMPluginConfig = {},
  ) {
    super(scene, pluginManager, pluginKey);
    this.config = config;
  }

  override boot(): void {
    const events = this.systems?.events;
    if (!events) {
      return;
    }
    events.on(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
  }

  /** The UI root of this scene; created on first access. */
  get root(): UIRoot {
    if (!this.uiRoot) {
      const scene = this.scene;
      if (!scene) {
        throw new Error('MVVMPlugin.root: the plugin is not attached to a Scene yet');
      }
      this.uiRoot = new UIRoot(scene, this.config);
    }
    return this.uiRoot;
  }

  /** True once a UI root exists (used by tests to avoid creating one accidentally). */
  get hasRoot(): boolean {
    return this.uiRoot !== null;
  }

  /** Adds a widget to the UI root and lays out immediately. */
  mount<T extends Widget>(child: T): T {
    return this.root.addWidget(child);
  }

  /** Runs pending reactive updates and then a layout pass. Called automatically each frame. */
  flush(): void {
    flushFrame();
    this.uiRoot?.flushLayout();
  }

  override destroy(): void {
    this.dispose();
    super.destroy();
  }

  private onPreUpdate(): void {
    this.flush();
  }

  private onShutdown(): void {
    this.dispose();
  }

  private dispose(): void {
    const events = this.systems?.events;
    if (events) {
      events.off(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
      events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
      events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
    }
    if (this.uiRoot) {
      this.uiRoot.destroy(true);
      this.uiRoot = null;
    }
  }
}
