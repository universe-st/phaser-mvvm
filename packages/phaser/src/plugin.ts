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
import { devLog, isDevMode, warn } from '@phaser-mvvm/core';
import { flushFrame } from '@phaser-mvvm/core';
import { FocusManager, type FocusManagerOptions } from './focus';
import { InputRouter, type InputRouterOptions } from './input';
import { ModalHost } from './modal';
import { planBack } from './back-plan';
import { PageHost } from './pages';
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
  /** Last widget reported by the development focus trace. */
  private lastFocused: Widget | null = null;
  /**
   * Key events already acted on in this frame; see `onKeyDown`.
   *
   * A *set* and not "the previous event", because one frame can deliver several keydowns (Shift and
   * then Tab) and Phaser re-emits the whole queue in order, so the event that repeats is not the one
   * that came before it.
   */
  private readonly handledKeyEvents = new Set<KeyboardEvent>();
  private unsubscribeTheme: (() => void) | null = null;
  private modalHost: ModalHost | null = null;
  private pageHost: PageHost | null = null;
  /** Dev-only: whether the "something replaced the back router" warning was already printed. */
  private warnedBackOverride = false;
  /**
   * The plugin's own back router, kept as a stable reference so the dev guard below can tell whether
   * anything replaced it.
   */
  private readonly backRouter = (): void => this.handleBack();

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

  /**
   * App-level `back` handler (Escape, gamepad B/○), called when neither a modal nor a page wanted the
   * action.
   *
   * This is the supported place to put it. `FocusManager.onBack` is the *low-level* hook the plugin
   * installs for routing (`modal → page → app`), so assigning it directly takes the modal stack and the
   * page stack out of the loop — the guide used to suggest exactly that, and the failure was silent.
   */
  onBack: (() => void) | null = null;

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

  /**
   * Overlay layers of this scene: `this.mvvm.modal.open(() => { … })`.
   *
   * Created on first use, so a scene that never shows a dialog pays nothing for the feature.
   */
  get modal(): ModalHost {
    if (!this.modalHost) {
      this.modalHost = new ModalHost(this);
    }
    return this.modalHost;
  }

  /**
   * The page stack of this scene: `this.mvvm.pages.push(() => { … })`.
   *
   * Created on first use, like `modal`. Pop it with `pop()`, or let `Escape`/gamepad B do it — the
   * plugin routes `back` to the modals first, then to the pages, then to `config.onBack`.
   */
  get pages(): PageHost {
    if (!this.pageHost) {
      this.pageHost = new PageHost(this);
    }
    return this.pageHost;
  }

  /** Switches the theme used by every widget in every scene. */
  setTheme(theme: ThemeName | Theme): Theme {
    return setTheme(theme);
  }

  /** Adds a widget to the UI root, wires it for input and lays out immediately. */
  mount<T extends Widget>(child: T): T {
    const mounted = this.root.addWidget(child);
    // A page appended to the root would paint over an open dialog; the layers go back on top.
    this.modalHost?.raiseLayers();
    this.refreshInteraction();
    if (isDevMode()) {
      devLog(`mount: page attached and laid out (${countWidgets(child)} widget(s))`);
    }
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
    // Pointer presses move focus (the router only reports them; the manager owns the order).
    this.router.onPointerFocus = (widget) => {
      this.focusManager?.focus(widget);
    };
    this.router.attach(root, scene);

    this.focusManager = new FocusManager({
      root,
      ...this.config.focus,
      // `back` is routed, never handled here: `handleBack()` asks the modal stack, then the page stack,
      // then the app (see `back-plan.ts`).
      onBack: this.backRouter,
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

  /**
   * `back` action routing (Escape / gamepad B).
   *
   * The order lives in `planBack()` (a pure function with Node tests): a modal owns the action first,
   * then the page stack, and only an app with nowhere left to go sees its own `onBack`.
   */
  private handleBack(): void {
    const target = planBack({
      modalDepth: this.modalHost?.depth ?? 0,
      pageDepth: this.pageHost?.depth ?? 0,
    });

    if (target === 'modal') {
      // `handleBack()` also covers the non-dismissible dialog, which swallows the action on purpose.
      this.modalHost?.handleBack();
      return;
    }
    if (target === 'page' && this.pageHost?.handleBack() === true) {
      return;
    }
    // `config.onBack` can never arrive (Phaser instantiates scene plugins with three arguments), so
    // `mvvm.onBack` is the usable field; `config.focus.onBack` stays supported as the legacy spelling.
    (this.onBack ?? this.config.onBack ?? this.config.focus?.onBack)?.();
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Phaser reaches this listener through `KeyboardPlugin.update()`, which walks the manager's whole
    // input queue on *every* input event of the frame and only skips **consecutive** duplicates
    // (`prevCode`/`prevTime`/`prevType`). Two keydowns in one frame therefore deliver the first one
    // twice - and `Shift+Tab` is two keydowns (Shift, then Tab), so one press navigated two steps
    // (measured: `prev` arrived twice, `form.ok -> form.cancel -> form.field`). Key repeat and fast
    // typing do the same thing. Re-emission hands us the *same* event object, so identity is an exact
    // test; a fresh press always carries a new one.
    if (this.handledKeyEvents.has(event)) {
      return;
    }
    this.handledKeyEvents.add(event);

    const action = keyboardActionOf(event);
    // Never swallow browser shortcuts (copy/paste/reload/devtools).
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    // The focused widget gets first refusal: a `Slider` moves its own value with the arrows, and every
    // other widget declines so the keys keep navigating (`Widget#onKeyDown`).
    const focused = this.focusManager?.focusedWidget ?? null;
    if (focused && focused.onKeyDown?.(event, action) === true) {
      event.preventDefault();
      return;
    }
    if (!action) {
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
    // One frame's worth of key events is plenty: Phaser clears its own queue in `postUpdate`, so a
    // re-emission cannot outlive the frame, and a fresh press always brings a fresh event object.
    this.handledKeyEvents.clear();
    flushFrame();
    this.uiRoot?.flushLayout();

    // Development trace for focus: knowing *what* holds focus explains most "my key press went nowhere"
    // reports. One comparison per frame, and nothing at all once `setDevMode(false)` ran (the log call
    // itself is gated, and the comparison is cheap).
    const focused = this.focusManager?.focusedWidget ?? null;
    if (focused !== this.lastFocused) {
      this.lastFocused = focused;
      devLog(`focus: ${focused ? focused.name || focused.constructor.name : 'none'}`);
    }

    // Re-collect only when the tree actually changed: visibility or state changes do not need it, and
    // the layout dirty flag cannot be used for this because `UIRoot.addWidget()` lays out eagerly.
    const root = this.uiRoot;
    if (root && root.structureVersion !== this.lastStructureVersion) {
      this.lastStructureVersion = root.structureVersion;
      this.refreshInteraction();
    }

    this.guardBackRouter();

    this.pollGamepad(time);
    this.router?.update(time);
  }

  /**
   * Development guard for the `back` hook.
   *
   * `FocusManager.onBack` is where the plugin installs its router, and the guide used to tell readers to
   * overwrite it (`this.mvvm.focus.onBack = …`). Doing that silently disables modal-close and page-pop
   * on Escape — the key simply stops working, with nothing in the console. One identity comparison per
   * frame in development (zero in release) turns that into a named warning.
   */
  private guardBackRouter(): void {
    const manager = this.focusManager;
    if (!isDevMode() || !manager) {
      return;
    }
    if (manager.onBack === this.backRouter) {
      this.warnedBackOverride = false;
      return;
    }
    if (this.warnedBackOverride) {
      return;
    }
    this.warnedBackOverride = true;
    warn(
      'focus.onBack was replaced: the plugin routes `back` through this hook (modal stack, then page ' +
        'stack, then the app), so Escape/B no longer closes dialogs or pops pages. Use ' +
        '`this.mvvm.onBack = …` for an app-level handler.',
    );
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
    // Before the focus manager, so the app's `onClose`/`onDispose` callbacks run while the scopes
    // still exist. Overlays first (they sit above the pages), then the pages themselves.
    this.modalHost?.dispose();
    this.modalHost = null;
    this.pageHost?.dispose();
    this.pageHost = null;
    this.focusManager?.dispose();
    this.focusManager = null;
    this.handledKeyEvents.clear();
    this.navRepeat.reset();
    this.padState = EMPTY_NAV_STATE;
    if (this.uiRoot) {
      devLog('shutdown: UI tree destroyed (widgets, bindings and listeners released)');
      this.uiRoot.destroy(true);
      this.uiRoot = null;
    }
  }
}

/** Widget count of a subtree, for the development mount trace only. */
function countWidgets(root: Widget): number {
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
