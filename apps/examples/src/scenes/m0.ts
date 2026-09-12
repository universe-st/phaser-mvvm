import Phaser from 'phaser';
import { appendStatus, reportCanvas, reportWidget } from '../status';

/**
 * M0 acceptance scene.
 *
 * Verifies the whole pipeline with nothing but public API: the scene plugin exposes `this.mvvm`,
 * `this.add.vbox/hbox` create layout widgets, `UIRoot` sizes itself to the game size, and the
 * layout engine measures + arranges the rectangles before the first render.
 *
 * The status block at the bottom of the page reports the rects the engine assigned, so a headless
 * run can assert on real geometry (`chrome --headless --dump-dom`).
 */
export class M0Scene extends Phaser.Scene {
  constructor() {
    super('m0');
  }

  create(): void {
    const ui = this.mvvm.root;

    const caption = this.add.uiLabel({
      text: 'phaser-mvvm · M0',
      size: 22,
    });

    const hint = this.add.uiLabel({
      text: 'this.add.vbox → this.add.hbox → two this.add.uiRect children',
      size: 'sm',
      tone: 'muted',
    });

    const blue = this.add.uiRect({ width: 200, height: 120, color: 0x2f6feb });
    const amber = this.add.uiRect({ width: 120, height: 120, color: 0xf2a33c });

    const row = this.add.hbox(
      {
        gap: 24,
        padding: 24,
        alignItems: 'center',
        justifyContent: 'center',
      },
      [blue, amber],
    );

    const page = this.add.vbox(
      {
        gap: 16,
        alignItems: 'center',
        justifyContent: 'center',
      },
      [caption, hint, row],
    );

    ui.addWidget(page);

    appendStatus('--- M0 layout ---');
    reportWidget('ui', ui);
    reportWidget('page', page);
    reportWidget('row', row);
    reportWidget('rect.blue', blue);
    reportWidget('rect.amber', amber);
    reportCanvas(this.game);
  }
}
