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
import { FocusManager } from './focus';
import { InputRouter } from './input';
import { A11yBridge } from './a11y';
import { ModalHost } from './modal';
import { planBack } from './back-plan';
import { revealInViewports } from './reveal';
import { PageHost } from './pages';
import { Router } from './router';
import { mergePluginConfig, type MVVMPluginConfig } from './plugin-config';
import {
  TransitionRunner,
  prefersReducedMotion,
  resolveTransitions,
  type ResolvedTransitions,
  type TransitionOverride,
} from './transition';
import {
  NavRepeat,
  gamepadActionsOf,
  gamepadStateOf,
  heldDirectionsOf,
  keyboardActionOf,
  type NavAction,
  type NavInputState,
} from './nav';
import { getTheme, onThemeChange, setTheme, type Theme, type ThemeName } from './theme';
import { UIRoot } from './UIRoot';
import type { UISceneBackHook } from './UIScene';
import { Widget, type ActivationSource } from './Widget';

type GamepadLike = Parameters<typeof gamepadActionsOf>[0];

/** Empty snapshot used until a pad is seen for the first time. */
const EMPTY_NAV_STATE: NavInputState = { axes: [], buttons: [] };

export class MVVMPlugin extends Phaser.Plugins.ScenePlugin {
  /**
   * Game-wide defaults, applied to every plugin created after {@link MVVMPlugin.configure}.
   *
   * Phaser instantiates scene plugins as `new Plugin(scene, pluginManager, mapKey)` — the fourth
   * (config) argument of the Game Config entry is never passed — so before this existed, plugin options
   * could only be set at runtime, one scene at a time. The guide documented the limitation in four
   * places; `MVVMPlugin.configure({ … })` next to the Game Config is the supported way now.
   */
  private static shared: MVVMPluginConfig = {};

  /** Merges `config` into the defaults every later plugin instance starts from. */
  static configure(config: MVVMPluginConfig): void {
    MVVMPlugin.shared = mergePluginConfig(MVVMPlugin.shared, config);
  }

  /** The current game-wide defaults (read-only copy). */
  static get defaults(): Readonly<MVVMPluginConfig> {
    return MVVMPlugin.shared;
  }

  /** Forgets the game-wide defaults (tests, and a "reconfigure from scratch" in dev tools). */
  static resetDefaults(): void {
    MVVMPlugin.shared = {};
  }

  private config: MVVMPluginConfig;
  private uiRoot: UIRoot | null = null;
  private inputRouter: InputRouter | null = null;
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
  private routeHost: Router | null = null;
  /**
   * Frame-stepped transitions. One runner for the scene: the frame delta it needs is already available
   * here, and a scene-wide runner is what lets `pending` answer "is any teardown still deferred?".
   */
  private readonly transitionRunner = new TransitionRunner();
  /** Last `PRE_UPDATE` timestamp, to turn Phaser's clock into a per-frame delta (ms). */
  private lastFrameTime = -1;
  private a11yBridge: A11yBridge | null = null;
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
    // A per-scene config (never delivered by Phaser, but usable from tests and from `configure()`)
    // wins over the game-wide defaults.
    this.config = mergePluginConfig(MVVMPlugin.shared, config);
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

  /**
   * Applies options **at runtime**, to this scene's plugin.
   *
   * Options that describe how the UI is *built* (align, depth, `input.dragThreshold`, …) can only take
   * effect when the root is created, so they are stored and used then; the ones that describe a
   * *subscription* (`navigation`, `themeBackground`, `a11y`, `focus.wrap`, `focus.trapFocus`,
   * `input.dragThreshold` on a live router) are applied immediately, because a caller that changes them
   * mid-session means it.
   *
   * ```ts
   * MVVMPlugin.configure({ themeBackground: false });   // game-wide, before `new Phaser.Game(...)`
   * this.mvvm.configure({ navigation: false });         // just this scene, right now
   * ```
   */
  configure(patch: MVVMPluginConfig): this {
    this.config = mergePluginConfig(this.config, patch);
    if (!this.uiRoot) {
      return this;
    }

    if (patch.navigation !== undefined) {
      this.applyNavigation();
    }
    if (patch.themeBackground !== undefined) {
      this.applyThemeBackground();
    }
    if (patch.input?.dragThreshold !== undefined && this.inputRouter) {
      this.inputRouter.dragThreshold = patch.input.dragThreshold;
    }
    if (patch.focus && this.focusManager) {
      if (patch.focus.wrap !== undefined) {
        this.focusManager.wrap = patch.focus.wrap;
      }
      if (patch.focus.trapFocus !== undefined) {
        this.focusManager.trapFocus = patch.focus.trapFocus;
      }
      if (patch.focus.ring !== undefined) {
        this.focusManager.ring = patch.focus.ring;
      }
    }
    if (patch.a11y !== undefined) {
      this.applyA11yOptions();
    }
    if (isDevMode()) {
      devLog(`configure: applied ${Object.keys(patch).join(', ')}`);
    }
    return this;
  }

  /** True once a UI root exists (used by tests to avoid creating one accidentally). */
  get hasRoot(): boolean {
    return this.uiRoot !== null;
  }

  /** Pointer routing for the UI tree. */
  get input(): InputRouter {
    void this.root;
    return this.inputRouter as InputRouter;
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

  /**
   * The optional router above the page stack (`router.ts`): a table of `path → view`.
   *
   * ```ts
   * this.mvvm.router.routes = { home: () => { … }, 'user/:id': (params) => { … } };
   * this.mvvm.router.navigate('user/42');
   * ```
   *
   * Created on first use, like `modal` and `pages`. It adds no navigation model of its own: navigating
   * is `pages.push()`, so `Esc`, page lifecycle hooks and focus behave exactly as they do without it —
   * the router only remembers which page came from which route (`current`, `history`).
   */
  get router(): Router {
    if (!this.routeHost) {
      this.routeHost = new Router(this);
    }
    return this.routeHost;
  }

  /**
   * The frame-stepped transition runner (PLAN M8's 开闭动效).
   *
   * Exposed for the demo pages, and for a scene that wants to animate a layer of its own with the same
   * timing model: `this.mvvm.transitions.run({ target, transition })`. `pending` is the number of
   * targets still animating — a dialog's exit is the one teardown in the framework that is *deferred*,
   * so "nothing animating any more" is the honest way to know it finished.
   */
  get transitions(): TransitionRunner {
    return this.transitionRunner;
  }

  /**
   * Resolves the motion policy for one layer: the plugin config, an optional per-layer override, and
   * what the OS asks for right now.
   *
   * Resolved per use rather than cached, so `mvvm.configure({ transition: … })` and a
   * `prefers-reduced-motion` change both reach the next dialog; the cost is one `matchMedia` read per
   * open.
   */
  transitionFor(override?: TransitionOverride): ResolvedTransitions {
    const options = this.config.transition;
    const resolved = resolveTransitions(options, override, prefersReducedMotion());
    if (isDevMode() && resolved.reduced && options !== false && override !== false) {
      devLog('transition: collapsed to 0 ms — the page asks for reduced motion');
    }
    return resolved;
  }

  /**
   * The hidden DOM mirror of the interactive widgets (`a11y.ts`).
   *
   * Created on first use; `this.mvvm.a11y.enabled = false` removes it from the DOM and stops all
   * updates, which is what a game that does not want the extra nodes should do.
   */
  get a11y(): A11yBridge {
    if (!this.a11yBridge) {
      const options = this.config.a11y === false ? { enabled: false } : (this.config.a11y ?? {});
      this.a11yBridge = new A11yBridge(this, options);
    }
    return this.a11yBridge;
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
    this.inputRouter?.refresh();
    this.focusManager?.refresh();
    // The mirror follows the interactive set, so it is rebuilt exactly when that set can change.
    // `this.a11y` (not the field) on purpose: the layer is created on the first structural change, so a
    // scene gets a mirror without anyone having to ask for it — `a11y: false` (config) or
    // `enabled = false` (runtime) is how an app opts out.
    if (this.config.a11y !== false) {
      this.a11y.refresh();
    }
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

    this.inputRouter = new InputRouter({ root, ...this.config.input });
    // Pointer presses move focus (the router only reports them; the manager owns the order).
    this.inputRouter.onPointerFocus = (widget) => {
      this.focusManager?.focus(widget);
    };
    this.inputRouter.attach(root, scene);

    this.focusManager = new FocusManager({
      root,
      ...this.config.focus,
      // `back` is routed, never handled here: `handleBack()` asks the modal stack, then the page stack,
      // then the app (see `back-plan.ts`).
      onBack: this.backRouter,
    });

    this.applyThemeBackground();
    this.applyNavigation();
    this.applyA11yOptions();
  }

  /** Subscribes (or not) to theme changes for the camera background; idempotent. */
  private applyThemeBackground(): void {
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
    if (this.config.themeBackground === false) {
      // The app owns the camera colour now: stop following the theme, leave what is there.
      return;
    }
    this.applyThemeToCamera(getTheme());
    this.unsubscribeTheme = onThemeChange((theme) => this.applyThemeToCamera(theme));
  }

  /** Hooks (or unhooks) the keyboard listener; idempotent, so `configure()` can toggle it. */
  private applyNavigation(): void {
    const keyboard = this.scene?.input.keyboard;
    if (!keyboard) {
      return;
    }
    keyboard.off('keydown', this.onKeyDown, this);
    if (this.config.navigation !== false) {
      keyboard.on('keydown', this.onKeyDown, this);
    }
  }

  /** Creates, enables or reconfigures the accessibility mirror; idempotent. */
  private applyA11yOptions(): void {
    const options = this.config.a11y;
    if (!this.a11yBridge) {
      if (options === false || options === undefined) {
        return;
      }
      this.a11yBridge = new A11yBridge(this, options);
      return;
    }
    if (options === false) {
      this.a11yBridge.enabled = false;
      return;
    }
    const next = options ?? {};
    this.a11yBridge.enabled = next.enabled !== false;
    if (next.politeness !== undefined) {
      this.a11yBridge.politeness = next.politeness;
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
   * then the page stack. After that the *scene* gets first refusal (`UIScene.onBack`, when the scene
   * opted in with its `backHook` marker), and only an app with nowhere left to go sees its own
   * `onBack` — so a scene can intercept Escape without taking the app-level handler away.
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
    const scene = this.scene as (Phaser.Scene & UISceneBackHook) | null;
    if (scene?.backHook === true && scene.onBack?.() === true) {
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
    // The focused widget gets first refusal, in two steps: `onKeyDown` for the keys it owns beyond
    // navigation (typing, Home/End, PageUp/PageDown), then `onAction` for the navigation actions
    // themselves — so a direction claimed once works on a gamepad too (`Widget#onAction`).
    const focused = this.focusManager?.focusedWidget ?? null;
    if (focused && focused.onKeyDown?.(event, action) === true) {
      event.preventDefault();
      return;
    }
    if (!action) {
      return;
    }
    if (this.dispatchAction(action, 'keyboard')) {
      event.preventDefault();
    }
  }

  /**
   * Gives the focused widget first refusal on a navigation action, then navigates.
   *
   * Every device goes through here: the keyboard path and the gamepad poll, so "the D-Pad adjusts the
   * slider" and "the arrow key adjusts the slider" cannot drift apart (V28).
   */
  private dispatchAction(action: NavAction, source: ActivationSource): boolean {
    const focused = this.focusManager?.focusedWidget ?? null;
    if (focused?.onAction?.(action, source) === true) {
      return true;
    }
    return this.focusManager?.handleAction(action, source) ?? false;
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
        this.dispatchAction(action, 'gamepad');
      }
    }
    for (const action of repeated) {
      this.dispatchAction(action, 'gamepad');
    }
  }

  private onPreUpdate(time: number): void {
    // One frame's worth of key events is plenty: Phaser clears its own queue in `postUpdate`, so a
    // re-emission cannot outlive the frame, and a fresh press always brings a fresh event object.
    this.handledKeyEvents.clear();
    flushFrame();
    this.uiRoot?.flushLayout();

    // Transitions advance on Phaser's clock, not the wall clock: a paused scene freezes them instead
    // of letting them jump to the end on resume. The per-frame delta is capped at 250 ms so a long
    // stall (a tab switch, a breakpoint) moves the animation forward by one visible step rather than
    // by the whole stall — and the cap only ever applies to a frame nothing was rendered in.
    if (this.transitionRunner.pending > 0) {
      const delta = this.lastFrameTime < 0 ? 0 : Math.min(time - this.lastFrameTime, 250);
      this.transitionRunner.step(delta);
    }
    this.lastFrameTime = time;

    // Development trace for focus: knowing *what* holds focus explains most "my key press went nowhere"
    // reports. One comparison per frame, and nothing at all once `setDevMode(false)` ran (the log call
    // itself is gated, and the comparison is cheap).
    const focused = this.focusManager?.focusedWidget ?? null;
    if (focused !== this.lastFocused) {
      this.lastFocused = focused;
      devLog(`focus: ${focused ? focused.name || focused.constructor.name : 'none'}`);
      // A screen reader has no way to see a focus ring on a canvas, so focus moves are announced.
      this.a11yBridge?.announceFocus(focused);
      if (focused) {
        // Keyboard/gamepad focus can land on a widget the mask has clipped away, and then the ring is
        // painted where nobody can see it (round 67). Asking the ports above it to scroll it into view
        // is the browser's answer, and this is the place it can run: the layout pass above has just
        // arranged every rect, so the ports compute against real geometry rather than last frame's.
        revealInViewports(focused, { flushLayout: () => this.uiRoot?.flushLayout() });
      }
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
    this.inputRouter?.update(time);
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
    // Transition runs hold widget references and deferred teardowns; the root is about to destroy
    // those widgets anyway, so the runs go without calling their `onDone`.
    this.transitionRunner.clear();
    this.lastFrameTime = -1;
    this.inputRouter?.detach();
    this.inputRouter = null;
    // Before the UI root goes away: the mirror holds references to widgets.
    this.a11yBridge?.destroy();
    this.a11yBridge = null;
    // Before the focus manager, so the app's `onClose`/`onDispose` callbacks run while the scopes
    // still exist. Overlays first (they sit above the pages), then the pages themselves.
    this.modalHost?.dispose();
    this.modalHost = null;
    this.pageHost?.dispose();
    this.pageHost = null;
    this.routeHost?.dispose();
    this.routeHost = null;
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
