import Phaser from 'phaser';
import { MVVMPlugin, installFactories } from '@phaser-mvvm/phaser';
import { M0Scene } from './scenes/m0';
import { ProbeScene } from './scenes/probe';
import { appendStatus, installErrorReporting, setStatus } from './status';

// Registers `this.add.vbox/hbox/uiGrid/uiStack/uiRect/uiLabel`.
installFactories();

installErrorReporting();
setStatus('boot');

const requested = window.location.hash.replace(/^#\/?/, '');
const initial = requested === 'probe' ? 'probe' : 'm0';
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

game.scene.add('m0', M0Scene, initial === 'm0');
game.scene.add('probe', ProbeScene, initial === 'probe');

const renderer = game.renderer?.type === Phaser.WEBGL ? 'webgl' : 'canvas';
appendStatus(
  `scene=${initial} renderer=${renderer} size=${game.scale.gameSize.width}x${game.scale.gameSize.height}`,
);

// Exposed for screenshots and E2E assertions.
(window as unknown as { game: Phaser.Game }).game = game;
