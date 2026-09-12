import Phaser from 'phaser';
import { isDevMode, setDevMode } from '@phaser-mvvm/core';
import { MVVMPlugin, installFactories } from '@phaser-mvvm/phaser';
import { installWidgetFactories } from '@phaser-mvvm/widgets';
import { A11yScene } from './scenes/a11y';
import { BindingsScene } from './scenes/bindings';
import { ComposeScene } from './scenes/compose';
import { ConfigScene } from './scenes/config';
import { DashboardScene } from './scenes/dashboard';
import { FormScene } from './scenes/form';
import { GalleryScene } from './scenes/gallery';
import { HudScene } from './scenes/hud';
import { LifecycleScene } from './scenes/lifecycle';
import { ListScene } from './scenes/list';
import { M0Scene } from './scenes/m0';
import { ModalScene } from './scenes/modal';
import { PagesScene } from './scenes/pages';
import { ProbeScene } from './scenes/probe';
import { ScrollScene } from './scenes/scroll';
import { StatesScene } from './scenes/states';
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
  hud: HudScene,
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
// `new Plugin(scene, pluginManager, mapKey)` — a config object in the Game Config entry is never
// passed — so this static call is *the* way to configure the framework before the first scene boots.
// (Until round 66 the options could only be set at runtime, one scene at a time; the guide said so in
// four places.) `#/a11y` reads the result back: its live region reports `aria-live="assertive"`.
MVVMPlugin.configure({
  a11y: { politeness: 'assertive' },
});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d1117',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
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
