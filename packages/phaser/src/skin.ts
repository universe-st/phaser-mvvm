/**
 * Skins: how a widget paints its own background for a given state.
 *
 * The default skin is procedural (`Graphics`), so the whole widget library is usable without a
 * single art asset — which is what the examples and the verification pass rely on. A nine-slice
 * texture skin can be plugged in later through the same interface (PLAN §4.6).
 */

import type Phaser from 'phaser';
import type { Theme, ThemeColorName } from './theme';
import { getTheme } from './theme';
import type { WidgetState } from './widget-state';

export interface BackgroundStyle {
  fill?: ThemeColorName | number;
  fillAlpha?: number;
  border?: ThemeColorName | number | null;
  borderWidth?: number;
  radius?: number;
}

export type SkinStyles = Partial<Record<WidgetState, BackgroundStyle>>;

export interface Skin {
  /** Paints the background of `rect` (in the widget's local space) for the given state. */
  paint(
    graphics: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    state: WidgetState,
  ): void;
}

export function colorOf(
  theme: Theme,
  value: ThemeColorName | number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  return typeof value === 'number' ? value : theme.colors[value];
}

/**
 * A skin built from per-state styles.
 *
 * Fill, border and radius are resolved against the active theme every time `paint` runs, so a theme
 * switch needs no extra bookkeeping: the widget simply repaints.
 */
export class ProceduralSkin implements Skin {
  constructor(private readonly styles: SkinStyles) {}

  paint(
    graphics: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
    state: WidgetState,
  ): void {
    const theme = getTheme();
    const style = this.styles[state] ?? this.styles.normal ?? {};
    const radius = Math.min(style.radius ?? 0, Math.min(width, height) / 2);
    const fill = colorOf(theme, style.fill, theme.colors.surface);
    const border = style.border === null ? null : colorOf(theme, style.border, theme.colors.border);
    const borderWidth = style.borderWidth ?? (border === null ? 0 : theme.borderWidth);

    graphics.clear();
    if (style.fillAlpha !== undefined || fill !== undefined) {
      graphics.fillStyle(fill, style.fillAlpha ?? 1);
      drawRoundedRect(graphics, 0, 0, width, height, radius);
      graphics.fillPath();
    }
    if (border !== null && borderWidth > 0) {
      graphics.lineStyle(borderWidth, border, 1);
      drawRoundedRect(
        graphics,
        borderWidth / 2,
        borderWidth / 2,
        width - borderWidth,
        height - borderWidth,
        Math.max(0, radius - borderWidth / 2),
      );
      graphics.strokePath();
    }
  }
}

/** Convenience helpers for the widget library's default looks. */
export const DEFAULT_SURFACE_SKIN: SkinStyles = {
  normal: { fill: 'surface', border: 'border' },
  hover: { fill: 'surfaceHover', border: 'borderStrong' },
  pressed: { fill: 'surfaceAlt', border: 'borderStrong' },
  disabled: { fill: 'surfaceAlt', border: 'border' },
  focused: { fill: 'surface', border: 'focusRing' },
};

export const DEFAULT_PRIMARY_SKIN: SkinStyles = {
  normal: { fill: 'primary', border: null },
  hover: { fill: 'primaryHover', border: null },
  pressed: { fill: 'primaryPressed', border: null },
  disabled: { fill: 'surfaceAlt', border: null },
  focused: { fill: 'primary', border: 'focusRing' },
};

function drawRoundedRect(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (width <= 0 || height <= 0) {
    return;
  }
  if (radius <= 0) {
    graphics.fillRect(x, y, width, height);
    return;
  }
  graphics.fillRoundedRect(x, y, width, height, radius);
}

/** Extends `Graphics` usage for stroked rounded rects (`fillRoundedRect` has no stroke variant). */
function strokeRoundedRect(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  graphics.strokeRoundedRect(x, y, width, height, radius);
}

export { strokeRoundedRect };
