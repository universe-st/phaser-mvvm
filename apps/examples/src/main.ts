import Phaser from 'phaser';
import { isDevMode, setDevMode } from '@phaser-mvvm/core';
import { MVVMPlugin, installFactories } from '@phaser-mvvm/phaser';
import { installWidgetFactories } from '@phaser-mvvm/widgets';
import { A11yScene } from './scenes/a11y';
import { BindingsScene } from './scenes/bindings';
import { ComposeScene } from './scenes/compose';
import { ConfigScene } from './scenes/config';
import { DashboardScene } from './scenes/dashboard';
import { EventsScene } from './scenes/events';
import { FormScene } from './scenes/form';
import { GalleryScene } from './scenes/gallery';
import { HudScene } from './scenes/hud';
import { LifecycleScene } from './scenes/lifecycle';
import { ListScene } from './scenes/list';
import { M0Scene } from './scenes/m0';
import { ModalScene } from './scenes/modal';
import { PagesScene } from './scenes/pages';
import { RouterScene } from './scenes/router';
import { KeyboardScene } from './scenes/keyboard';
import { ProbeScene } from './scenes/probe';
import { ScrollScene } from './scenes/scroll';
import { StatesScene } from './scenes/states';
import { OptionsScene } from './scenes/options';
import { UiSceneScene } from './scenes/uiscene';
import { ShowcaseScene } from './scenes/showcase';
import { StackScene } from './scenes/stack';
import { installFakePad } from './fake-pad';
import { appendStatus, installErrorReporting, setStatus } from './status';

// Registers `this.add.vbox/hbox/uiGrid/uiStack/uiAbsolute/uiRect` …
installFactories();
// … and the widget library's `this.add.uiLabel/uiPanel/uiButton/uiImage/uiSpacer/uiDivider`.
installWidgetFactories();

installErrorReporting();
// A fake gamepad any acceptance run can drive (`window.fakePad`); see `fake-pad.ts` for why this is
// the only way to test the gamepad path from outside the browser.
installFakePad();
setStatus('boot');

// Lets an acceptance run prove the "release mode prints nothing" half of the logging contract from
// the browser: `window.mvvmDev.setDevMode(false)`, interact, and expect zero `[phaser-mvvm]` lines.
(window as unknown as { mvvmDev?: unknown }).mvvmDev = {
  setDevMode: (enabled: boolean): boolean => {
    setDevMode(enabled === true);
    return isDevMode();
  },
  isDevMode: (): boolean => isDevMode(),
};

const SCENES = {
  m0: M0Scene,
  a11y: A11yScene,
  config: ConfigScene,
  modal: ModalScene,
  pages: PagesScene,
  probe: ProbeScene,
  stack: StackScene,
  gallery: GalleryScene,
  dashboard: DashboardScene,
  bindings: BindingsScene,
  form: FormScene,
  list: ListScene,
  scroll: ScrollScene,
  showcase: ShowcaseScene,
  compose: ComposeScene,
  lifecycle: LifecycleScene,
  states: StatesScene,
  options: OptionsScene,
  uiscene: UiSceneScene,
  hud: HudScene,
  router: RouterScene,
  keyboard: KeyboardScene,
  events: EventsScene,
} as const;

const requested = window.location.hash.replace(/^#\/?/, '');
const initial = requested in SCENES ? (requested as keyof typeof SCENES) : 'm0';
document.title = `phaser-mvvm examples · ${initial}`;

// The scene is chosen **once**, at boot. Changing the hash afterwards (typing a URL, the browser's
// back button, an in-page link) used to leave the old scene running while the address bar showed the
// new one — a silent trap for anyone navigating by hash, and an acceptance run that reads
// `location.hash` would assert against the wrong scene (round 67 hit exactly that: `#/scroll` was
// requested and `compose` answered). Everything these scenes depend on is wired at module load
// (`installFactories`, the game-wide `MVVMPlugin.configure`, the Game Config), so a reload is the
// honest way to switch.
window.addEventListener('hashchange', () => window.location.reload());

// Game-wide plugin options. Phaser instantiates scene plugins as
// `new Plugin(scene, pluginManager, mapKey)`, so a config object in the Game Config entry is never
// handed to the constructor — but the entry itself is kept verbatim in
// `game.config.installScenePlugins`, and the framework reads options back out of the entry's `data`
// field (round 110, `pluginConfigFromGameConfig`). This app therefore uses **both** channels, which is
// what makes `#/config` able to assert the precedence between them:
//
//   * the Game Config entry below carries a scene-plugin option (`transition.enter`) — declarative,
//     and it travels with the plugin registration rather than with a module-level call;
//   * `MVVMPlugin.configure({ … })` sets the game-wide defaults; here `a11y.politeness`, which
//     `#/a11y` and `#/config` read back from the live region (`aria-live="assertive"`).
//
// The order is: game-wide defaults < Game Config entry < a per-instance config < `mvvm.configure()` at
// runtime. So the `transition.enter` below is overridden by the entry's own value, and `#/config`
// asserts exactly that pair (`defaults()` says 120, `mvvm.config` says 320) — which is how the new
// channel is observable at all.
MVVMPlugin.configure({
  a11y: { politeness: 'assertive' },
  // Deliberately *lower* than the entry's 320 ms: it shows that the two channels merge (rather than one
  // silently replacing the other) and which of them wins.
  transition: { enter: 120 },
});

/**
 * `?fit=980x614` boots the examples in **design-resolution** mode instead of the default responsive
 * one.
 *
 * Both are legitimate ways to fit a phone, and they answer different problems:
 *
 * - `Scale.RESIZE` (the default here) hands the UI the real viewport, so the layout reflows — pages
 *   have to be written fluidly (`width: 'fill'`, wrapping rows);
 * - `Scale.FIT` keeps a **design resolution** and scales the whole canvas to fit, letterboxing the
 *   rest. Nothing reflows, the UI looks identical on every device, and a page written for 980×614 is
 *   simply smaller on a phone. Most Phaser games ship this way.
 *
 * The switch exists so the acceptance run can measure the second one: the framework has to be correct
 * in both modes (the DOM input bridge scales its element into CSS pixels, `UIRoot` sizes itself from
 * `gameSize`, hit testing happens in game coordinates — measured in `ACCEPTANCE-scale.md`).
 */
const fitParam = /^(?:\d+)x(?:\d+)$/.test(
  new URLSearchParams(window.location.search).get('fit') ?? '',
)
  ? (new URLSearchParams(window.location.search).get('fit') as string)
  : null;
const [designWidth, designHeight] = fitParam
  ? (fitParam.split('x').map(Number) as [number, number])
  : [window.innerWidth, window.innerHeight];

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d1117',
  scale: {
    mode: fitParam ? Phaser.Scale.FIT : Phaser.Scale.RESIZE,
    width: designWidth,
    height: designHeight,
    // FIT letterboxes: centre the canvas (`autoCenter` only places it in CSS; design coordinates do
    // not change).
    autoCenter: fitParam ? Phaser.Scale.CENTER_BOTH : Phaser.Scale.NO_CENTER,
  },
  render: {
    antialias: true,
    // Headless screenshots read the canvas outside the rAF paint, so `?capture=1` keeps the
    // drawing buffer around (see scripts/visual-check.mjs).
    preserveDrawingBuffer: new URLSearchParams(window.location.search).has('capture'),
  },
  // Two touch pointers (plus the mouse) so the demos exercise multi-touch: each pointer keeps its own
  // drag/press (see `docs/ACCEPTANCE-touch.md`). Phaser allocates `activePointers` touch pointers.
  //
  // `gamepad: true` was missing until round 64: Phaser defaults it to `false`, so the plugin's gamepad
  // poll never ran in the demos even though `#/gallery` advertised "gamepad supported". Without a real
  // pad, acceptance drives it through the fake pad below.
  input: {
    activePointers: 2,
    gamepad: true,
  },
  // Required by the M5 DOM input bridge / a11y mirror (ADR-0004); harmless before that lands.
  dom: {
    createContainer: true,
  },
  plugins: {
    scene: [
      {
        key: 'MVVMPlugin',
        plugin: MVVMPlugin,
        mapping: 'mvvm',
        start: true,
        // The options travel in the entry's `data` field (Phaser never passes them to the plugin's
        // constructor, but it keeps this entry verbatim in `game.config.installScenePlugins`).
        data: { transition: { enter: 320 } },
      },
    ],
  },
});

for (const [key, scene] of Object.entries(SCENES)) {
  game.scene.add(key, scene, key === initial);
}

const renderer = game.renderer?.type === Phaser.WEBGL ? 'webgl' : 'canvas';
appendStatus(
  `scene=${initial} renderer=${renderer} size=${game.scale.gameSize.width}x${game.scale.gameSize.height} dpr=${window.devicePixelRatio}`,
);

// Exposed for screenshots and E2E assertions.
(window as unknown as { game: Phaser.Game }).game = game;
