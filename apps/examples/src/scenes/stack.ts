import Phaser from 'phaser';
import { appendStatus, reportCanvas, reportWidget } from '../status';

/**
 * Layered scene: a stack container with an absolutely positioned overlay.
 *
 * It exercises the parts of the pipeline that `box`/`grid` do not: stack alignment, absolute
 * offsets resolved against the parent's content box, and z-order inside a widget. It is also the
 * preview of the `Modal`/`Page` layering that lands at M8.
 */
export class StackScene extends Phaser.Scene {
  constructor() {
    super('stack');
  }

  create(): void {
    const ui = this.mvvm.root;

    const backdrop = this.add.uiRect({ width: 420, height: 240, color: 0x161b22 });
    const card = this.add.uiRect({ width: 320, height: 160, color: 0x1f6feb });
    const badge = this.add.uiRect({
      width: 36,
      height: 36,
      color: 0x3fb950,
      position: 'absolute',
      right: -12,
      top: -12,
    });
    const footer = this.add.uiRect({
      width: 120,
      height: 8,
      color: 0xf2a33c,
      position: 'absolute',
      left: 20,
      bottom: 20,
    });

    const layers = this.add.uiStack({ align: 'center' }, [backdrop, card, badge, footer]);

    ui.addWidget(layers);

    appendStatus('--- stack layout ---');
    reportWidget('layers', layers);
    reportWidget('backdrop', backdrop);
    reportWidget('card', card);
    reportWidget('badge', badge);
    reportWidget('footer', footer);
    reportCanvas(this.game);
  }
}
