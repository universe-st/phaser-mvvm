import Phaser from 'phaser';
import { MVVMPlugin, installFactories } from '@phaser-mvvm/phaser';
import { installWidgetFactories } from '@phaser-mvvm/widgets';
import { BindingsScene } from './scenes/bindings';
import { DashboardScene } from './scenes/dashboard';
import { FormScene } from './scenes/form';
import { GalleryScene } from './scenes/gallery';
import { M0Scene } from './scenes/m0';
import { ProbeScene } from './scenes/probe';
import { StackScene } from './scenes/stack';
import { appendStatus, installErrorReporting, setStatus } from './status';

// Registers `this.add.vbox/hbox/uiGrid/uiStack/uiAbsolute/uiRect` …
installFactories();
// … and the widget library's `this.add.uiLabel/uiPanel/uiButton/uiImage/uiSpacer/uiDivider`.
installWidgetFactories();

installErrorReporting();
setStatus('boot');

const SCENES = {
  m0: M0Scene,
  probe: ProbeScene,
  stack: StackScene,
  gallery: GalleryScene,
  dashboard: DashboardScene,
  bindings: BindingsScene,
  form: FormScene,
} as const;

const requested = window.location.hash.replace(/^#\/?/, '');
const initial = requested in SCENES ? (requested as keyof typeof SCENES) : 'm0';
document.title = `phaser-mvvm examples · ${initial}`;

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
