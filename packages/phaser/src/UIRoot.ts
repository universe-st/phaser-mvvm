/**
 * `UIRoot` — the layout root of a UI page.
 *
 * It owns the `LayoutEngine`, is sized to the camera/game size (updated on `scale` resize), and
 * drives one layout pass on demand. Everything else in the UI hangs below it; widgets find the
 * engine through the tree, so a single root per UI scene is all that is needed.
 *
 * Default container is a `stack` with `align: 'center'`, which is what a single full-screen page
 * usually wants. Pass a different container type when the root itself should flow its children.
 */

import type Phaser from 'phaser';
import { LayoutEngine, tight } from '@phaser-mvvm/layout';
import type { ContainerLayout, Size } from '@phaser-mvvm/layout';
import { Widget, type WidgetOptions } from './Widget';

export interface UIRootOptions extends WidgetOptions {
  /** Alignment used when the root container is a `stack`. Defaults to `'center'`. */
  align?: 'start' | 'center' | 'end';
  /** Render depth of the UI layer. Defaults to 1000. */
  depth?: number;
  /** Device pixel ratio used for snapping. Defaults to `window.devicePixelRatio`. */
  dpr?: number;
  /** Snapping mode. Defaults to `'round'`. */
  snapMode?: 'none' | 'round' | 'floor' | 'ceil';
  /** Which arranger the root uses for its children. Defaults to `{ type: 'stack' }`. */
  container?: ContainerLayout;
}

export class UIRoot extends Widget {
  readonly layoutEngine: LayoutEngine;

  private laidOut = false;
  private structureCounter = 0;

  constructor(scene: Phaser.Scene, options: UIRootOptions = {}) {
    super(scene, { layout: { width: 0, height: 0, ...options.layout }, name: options.name });

    this.container = options.container ?? {
      type: 'stack',
      options: { align: options.align ?? 'center' },
    };

    this.structureListener = () => {
      this.structureCounter++;
    };

    this.layoutEngine = new LayoutEngine({
      dpr: options.dpr ?? defaultDpr(),
      snapMode: options.snapMode ?? 'round',
    });
    this.setEngineRecursive(this.layoutEngine);

    this.setDepth(options.depth ?? 1000);
    scene.add.existing(this);
    scene.scale.on('resize', this.handleResize, this);

    this.resize();
  }

  /**
   * Bumped whenever the widget tree gains or loses a widget; the scene plugin compares it to know
   * when input targets have to be re-collected.
   */
  get structureVersion(): number {
    return this.structureCounter;
  }

  override addWidget<T extends Widget>(child: T): T {
    const added = super.addWidget(child);
    this.flushLayout();
    return added;
  }

  /** Re-reads the game size, marks the root dirty and lays out immediately. */
  resize(): void {
    const gameSize = this.scene.scale.gameSize;
    this.resizeTo(gameSize.width, gameSize.height);
  }

  /** Sizes the root to an explicit size (design-resolution overrides, tests, embedded UI). */
  resizeTo(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.layoutParams.width = w;
    this.layoutParams.height = h;
    this.markDirty();
    this.flushLayout();
  }

  /**
   * Runs a layout pass if anything in the widget tree is dirty.
   *
   * The check is `hasDirtyNodes`, not `isDirty(this)`: a change inside a fixed-size widget does not
   * propagate dirty state to the root (relayout boundary), so testing the root alone would skip the
   * pass and leave the UI stale.
   */
  flushLayout(): void {
    const engine = this.layoutEngine;
    if (this.laidOut && !engine.hasDirtyNodes) {
      return;
    }
    const width = typeof this.layoutParams.width === 'number' ? this.layoutParams.width : 0;
    const height = typeof this.layoutParams.height === 'number' ? this.layoutParams.height : 0;
    if (width <= 0 || height <= 0) {
      return;
    }
    this.laidOut = true;
    engine.layout(this, tight(width, height), { width, height });
  }

  /** Current UI size in design pixels. */
  get uiSize(): Size {
    const width = typeof this.layoutParams.width === 'number' ? this.layoutParams.width : 0;
    const height = typeof this.layoutParams.height === 'number' ? this.layoutParams.height : 0;
    return { width, height };
  }

  override destroy(fromScene?: boolean): void {
    this.scene?.scale.off('resize', this.handleResize, this);
    super.destroy(fromScene);
  }

  private handleResize(): void {
    this.resize();
  }
}

function defaultDpr(): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof dpr === 'number' && dpr > 0 ? dpr : 1;
}
