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
import { devLog, isDevMode } from '@phaser-mvvm/core';
import { LayoutEngine, tight } from '@phaser-mvvm/layout';
import type { ContainerLayout, Size } from '@phaser-mvvm/layout';
import { Widget, type WidgetOptions } from './Widget';
import {
  clampSafeArea,
  isZeroSafeArea,
  readSafeAreaInsets,
  type SafeAreaInsets,
} from './safe-area';

/** A layout pass is logged once it measures this many nodes (development only). */
const LOG_MEASURE_THRESHOLD = 200;
/** …or once it takes at least this long, in milliseconds. */
const LOG_PASS_MS = 2;

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
  /**
   * Keep the UI inside the device's safe area (notch, camera cutout, home indicator). Defaults to
   * `true`; on any device without insets (a desktop window, a phone that did not ask for
   * `viewport-fit=cover`) the measured values are `0` and nothing changes.
   *
   * Set `false` when the game *wants* the canvas to reach the cutout — a full-bleed background, or an
   * application that applies the insets itself.
   *
   * Read when the root is created (like the other build-time options): `mvvm.configure({ safeArea })`
   * on a live scene does not move an existing root.
   */
  safeArea?: boolean;
}

export class UIRoot extends Widget {
  readonly layoutEngine: LayoutEngine;

  /** Whether the root reserves the device's safe area (see `UIRootOptions.safeArea`). */
  readonly safeAreaEnabled: boolean;

  private laidOut = false;
  private structureCounter = 0;
  private insets: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

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

    this.safeAreaEnabled = options.safeArea !== false;
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
    this.applySafeArea({ width: w, height: h });
    this.markDirty();
    this.flushLayout();
  }

  /**
   * The safe-area insets currently reserved, in design pixels.
   *
   * Zero on any device without them, and zero for every root built with `safeArea: false`.
   */
  get safeAreaInsets(): SafeAreaInsets {
    return { ...this.insets };
  }

  /**
   * Re-reads the insets and writes them into the root's own padding.
   *
   * Padding rather than a child offset on purpose: the arranger already resolves padding, so a page with
   * `width: 'fill'` lands inside the safe area with no extra layout pass, and the root's own box still
   * covers the whole viewport (so the theme background and any camera-pinned layer stay full-bleed).
   *
   * The read happens on every resize — rotating a phone moves the cutout from the top edge to a side —
   * and the clamp keeps a short viewport from losing its whole UI to a fixed-size strip (`safe-area.ts`).
   */
  private applySafeArea(size: Size): void {
    const next = this.safeAreaEnabled
      ? clampSafeArea(readSafeAreaInsets(this.scene?.game?.canvas?.ownerDocument ?? null), size)
      : { top: 0, right: 0, bottom: 0, left: 0 };
    const current = this.insets;
    const changed =
      current.top !== next.top ||
      current.right !== next.right ||
      current.bottom !== next.bottom ||
      current.left !== next.left;
    this.insets = next;
    if (changed || !isZeroSafeArea(next)) {
      this.layoutParams.padding = { ...next };
    }
    if (changed && !isZeroSafeArea(next) && isDevMode()) {
      devLog(
        `safeArea: top ${next.top} / right ${next.right} / bottom ${next.bottom} / left ${next.left} ` +
          `(${size.width}x${size.height})`,
      );
    }
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
    const { measureCalls, skippedSubtrees } = engine.stats;
    const startedAt = performance.now();
    engine.layout(this, tight(width, height), { width, height });

    // Development trace, and only for the passes worth looking at: an unchanged frame skips the pass
    // entirely, and a healthy incremental pass measures a handful of nodes. A pass that measures a large
    // part of the tree (or takes milliseconds) is the signal you want when asking "why is this frame
    // slow" - printing every pass would only bury it.
    const measured = engine.stats.measureCalls - measureCalls;
    const elapsed = performance.now() - startedAt;
    if (measured >= LOG_MEASURE_THRESHOLD || elapsed >= LOG_PASS_MS) {
      devLog(
        `layout: measured ${measured} node(s) in ${elapsed.toFixed(2)} ms ` +
          `(skipped ${engine.stats.skippedSubtrees - skippedSubtrees} subtree(s), ` +
          `${engine.stats.cacheHits} cache hit(s) so far)`,
      );
    }
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
