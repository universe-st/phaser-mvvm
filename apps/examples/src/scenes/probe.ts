import Phaser from 'phaser';
import { appendStatus, reportCanvas, reportWidget } from '../status';

/**
 * Layout probe scene.
 *
 * A small, screenshot-friendly page used to check the layout engine end to end:
 * - a `stack` container (flow children stacked from the top-left, absolute children offset),
 * - an `absolute` container whose children all position themselves,
 * - percentage sizing and nested boxes.
 *
 * It intentionally avoids data binding so it can validate the geometry pipeline on its own, and it
 * reports every assigned rect into the page status block for headless assertions.
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

    const backdrop = this.add.uiRect({ width: 320, height: 200, color: 0x161b22 });
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

    // Mixed container: flow children are stacked (align: start), absolute children are offset.
    const card = this.add.uiStack({ align: 'start', width: 320, height: 200 }, [
      backdrop,
      topLeft,
      bottomRight,
    ]);

    // An `absolute` container arranges only its `position: 'absolute'` children (HUD-style).
    const hudLeft = this.add.uiRect({
      width: 72,
      height: 24,
      color: 0x8b949e,
      position: 'absolute',
      left: 0,
      top: 0,
    });
    const hudCenter = this.add.uiRect({
      width: 72,
      height: 24,
      color: 0xd29922,
      position: 'absolute',
      left: 124,
      top: 18,
    });
    const hudRight = this.add.uiRect({
      width: 72,
      height: 24,
      color: 0xa371f7,
      position: 'absolute',
      right: 0,
      bottom: 0,
    });
    const hud = this.add.uiAbsolute({ width: 320, height: 60 }, [hudLeft, hudCenter, hudRight]);

    const bar = this.add.uiRect({ width: '100%', height: 8, color: 0x2f6feb });

    const column = this.add.vbox({ gap: 16, width: 320, alignItems: 'stretch' }, [
      title,
      card,
      hud,
      bar,
    ]);

    ui.addWidget(column);

    appendStatus('--- probe layout ---');
    reportWidget('column', column);
    reportWidget('card', card);
    reportWidget('backdrop', backdrop);
    reportWidget('abs.topleft', topLeft);
    reportWidget('abs.bottomright', bottomRight);
    reportWidget('hud', hud);
    reportWidget('hud.left', hudLeft);
    reportWidget('hud.center', hudCenter);
    reportWidget('hud.right', hudRight);
    reportWidget('bar', bar);
    reportCanvas(this.game);
  }
}
