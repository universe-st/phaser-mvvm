import Phaser from 'phaser';
import { appendStatus, reportWidget } from '../status';

/**
 * Layout probe scene.
 *
 * A small, screenshot-friendly page used to check the layout engine end to end: absolute
 * positioning inside a container, a nested box, and percentage sizing. It intentionally avoids
 * data binding so it can validate the geometry pipeline on its own.
 */
export class ProbeScene extends Phaser.Scene {
  constructor() {
    super('probe');
  }

  create(): void {
    const ui = this.mvvm.root;

    const title = this.add.uiLabel({
      text: 'layout probe',
      style: { fontSize: '18px', color: '#8b949e' },
    });

    const topLeft = this.add.uiRect({
      width: 60,
      height: 60,
      color: 0x3fb950,
      position: 'absolute',
      left: 16,
      top: 16,
    });

    const bottomRight = this.add.uiRect({
      width: 60,
      height: 60,
      color: 0xf85149,
      position: 'absolute',
      right: 16,
      bottom: 16,
    });

    const backdrop = this.add.uiRect({ width: 320, height: 200, color: 0x161b22 });

    const overlay = this.add.uiAbsolute({ width: 320, height: 200, margin: { bottom: 16 } }, [
      backdrop,
      topLeft,
      bottomRight,
    ]);

    const bar = this.add.uiRect({ width: '100%', height: 8, color: 0x2f6feb });

    const column = this.add.vbox({ gap: 16, width: 320, alignItems: 'stretch' }, [
      title,
      overlay,
      bar,
    ]);

    ui.addWidget(column);

    appendStatus('--- probe layout ---');
    reportWidget('column', column);
    reportWidget('overlay', overlay);
    reportWidget('abs.topleft', topLeft);
    reportWidget('abs.bottomright', bottomRight);
    reportWidget('bar', bar);
  }
}
