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
 *   layout, so N data changes in a frame cost one layout pass (ADR-0008),
 * - route input: pointer via `InputRouter`, keyboard/gamepad navigation via `FocusManager`
 *   (+ `NavRepeat` for held directions),
 * - tear the UI down on scene `shutdown`/`destroy` so widgets, listeners and bindings cannot leak.
 */

import Phaser from 'phaser';
import { flushFrame } from '@phaser-mvvm/core';
import { FocusManager, type FocusManagerOptions } from './focus';
import { InputRouter, type InputRouterOptions } from './input';
import {
  NavRepeat,
  gamepadActionsOf,
  gamepadStateOf,
  heldDirectionsOf,
  keyboardActionOf,
  type NavInputState,
} from './nav';
import { getTheme, onThemeChange, setTheme, type Theme, type ThemeName } from './theme';
import { UIRoot, type UIRootOptions } from './UIRoot';
import { Widget } from './Widget';

type GamepadLike = Parameters<typeof gamepadActionsOf>[0];

/** Empty snapshot used until a pad is seen for the first time. */
const EMPTY_NAV_STATE: NavInputState = { axes: [], buttons: [] };

export interface MVVMPluginConfig extends UIRootOptions {
  /** Focus behaviour overrides (the root is supplied by the plugin). */
  focus?: Omit<FocusManagerOptions, 'root'>;
  /** Pointer routing overrides (the root is supplied by the plugin). */
  input?: Omit<InputRouterOptions, 'root'>;
  /** Keyboard/gamepad navigation. Defaults to `true`. */
  navigation?: boolean;
  /** Callback for the `back` action (Escape / gamepad B) when no widget handles it. */
  onBack?: () => void;
  /**
   * Paint the scene's main camera with `theme.colors.background` (and keep it in sync on theme
   * changes). Defaults to `true`; set to `false` for a UI scene that must stay transparent over a
   * running game scene.
   */
  themeBackground?: boolean;
}

export class MVVMPlugin extends Phaser.Plugins.ScenePlugin {
  private readonly config: MVVMPluginConfig;
  private uiRoot: UIRoot | null = null;
  private router: InputRouter | null = null;
  private focusManager: FocusManager | null = null;
  private navRepeat = new NavRepeat();
  private padState: NavInputState = EMPTY_NAV_STATE;
  private lastStructureVersion = -1;
  private unsubscribeTheme: (() => void) | null = null;

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
    // `on`, not `once`, and the subscriptions survive a shutdown. Phaser runs `boot()` exactly once
    // per scene, so a handler consumed by the first SHUTDOWN left a *restarted* scene with no
    // PRE_UPDATE pump (no frame flush, no layout, no input routing) and no teardown on later
    // shutdowns — every restart then leaked a complete UI tree (theme listeners, pointer targets and
    // one text texture per label). Only the plugin's own `destroy()` unsubscribes.
    events.on(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    events.on(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    events.on(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
  }

  /** The UI root of this scene; created on first access (and wired for input). */
  get root(): UIRoot {
    if (!this.uiRoot) {
      const scene = this.scene;
      if (!scene) {
        throw new Error('MVVMPlugin.root: the plugin is not attached to a Scene yet');
      }
      this.uiRoot = new UIRoot(scene, this.config);
      this.attachUi();
    }
    return this.uiRoot;
  }

  /** True once a UI root exists (used by tests to avoid creating one accidentally). */
  get hasRoot(): boolean {
    return this.uiRoot !== null;
  }

  /** Pointer routing for the UI tree. */
  get input(): InputRouter {
    void this.root;
    return this.router as InputRouter;
  }

  /** Keyboard/gamepad focus management for the UI tree. */
  get focus(): FocusManager {
    void this.root;
    return this.focusManager as FocusManager;
  }

  /** Current theme (widgets repaint themselves when it changes). */
  get theme(): Theme {
    return getTheme();
  }

  /** Switches the theme used by every widget in every scene. */
  setTheme(theme: ThemeName | Theme): Theme {
    return setTheme(theme);
  }

  /** Adds a widget to the UI root, wires it for input and lays out immediately. */
  mount<T extends Widget>(child: T): T {
    const mounted = this.root.addWidget(child);
    this.refreshInteraction();
    return mounted;
  }

  /** Re-collects focusable widgets and pointer targets (call after structural changes). */
  refreshInteraction(): void {
    if (!this.uiRoot) {
      return;
    }
    // `refresh()` (not `attach()`) — attaching detaches first, which would silently drop a capture
    // widget set for a modal overlay.
    this.router?.refresh();
    this.focusManager?.refresh();
  }

  /** Runs pending reactive updates, then a layout pass. Called automatically each frame. */
  flush(): void {
    flushFrame();
    this.uiRoot?.flushLayout();
  }

  override destroy(): void {
    this.dispose();
    this.detachEvents();
    super.destroy();
  }

  private attachUi(): void {
    const scene = this.scene;
    const root = this.uiRoot;
    if (!scene || !root) {
      return;
    }
    this.lastStructureVersion = root.structureVersion;

    this.router = new InputRouter({ root, ...this.config.input });
    this.router.attach(root, scene);

    this.focusManager = new FocusManager({
      root,
      onBack: this.config.onBack,
      ...this.config.focus,
    });

    if (this.config.themeBackground !== false) {
      this.applyThemeToCamera(getTheme());
      this.unsubscribeTheme = onThemeChange((theme) => this.applyThemeToCamera(theme));
    }

    if (this.config.navigation !== false) {
      const keyboard = scene.input.keyboard;
      keyboard?.on('keydown', this.onKeyDown, this);
    }
  }

  /** Keeps the canvas clear colour in step with the theme so a switch repaints the whole page. */
  private applyThemeToCamera(theme: Theme): void {
    this.scene?.cameras?.main?.setBackgroundColor(theme.colors.background);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const action = keyboardActionOf(event);
    if (!action) {
      return;
    }
    // Never swallow browser shortcuts (copy/paste/reload/devtools).
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (this.focusManager?.handleAction(action, 'keyboard')) {
      event.preventDefault();
    }
  }

  private pollGamepad(time: number): void {
    const pads = (this.scene?.input as { gamepad?: { getPad(index: number): GamepadLike | null } })
      ?.gamepad;
    const pad = pads?.getPad(0) ?? null;
    if (!pad) {
      this.padState = EMPTY_NAV_STATE;
      this.navRepeat.reset();
      return;
    }

    // Directions are throttled by `NavRepeat` from the *held* state, while activate/back are edge
    // triggered inside `gamepadActionsOf` (holding a D-Pad direction must produce one action).
    const snapshot = gamepadActionsOf(pad, this.padState);
    this.padState = snapshot.state;

    const repeated = this.navRepeat.update(heldDirectionsOf(gamepadStateOf(pad)), time);

    for (const action of snapshot.actions) {
      if (action === 'activate' || action === 'back') {
        this.focusManager?.handleAction(action, 'gamepad');
      }
    }
    for (const action of repeated) {
      this.focusManager?.handleAction(action, 'gamepad');
    }
  }

  private onPreUpdate(time: number): void {
    flushFrame();
    this.uiRoot?.flushLayout();

    // Re-collect only when the tree actually changed: visibility or state changes do not need it, and
    // the layout dirty flag cannot be used for this because `UIRoot.addWidget()` lays out eagerly.
    const root = this.uiRoot;
    if (root && root.structureVersion !== this.lastStructureVersion) {
      this.lastStructureVersion = root.structureVersion;
      this.refreshInteraction();
    }

    this.pollGamepad(time);
    this.router?.update(time);
  }

  /** Tears the UI down; the scene-event subscriptions stay so a restart works (see `boot()`). */
  private onShutdown(): void {
    this.dispose();
  }

  /** Unsubscribes from the scene's events; only the plugin's own teardown does this. */
  private detachEvents(): void {
    const events = this.systems?.events;
    if (!events) {
      return;
    }
    events.off(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
  }

  private dispose(): void {
    this.scene?.input.keyboard?.off('keydown', this.onKeyDown, this);
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    this.router?.detach();
    this.router = null;
    this.focusManager?.dispose();
    this.focusManager = null;
    this.navRepeat.reset();
    this.padState = EMPTY_NAV_STATE;
    if (this.uiRoot) {
      this.uiRoot.destroy(true);
      this.uiRoot = null;
    }
  }
}
