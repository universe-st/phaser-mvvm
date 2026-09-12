/**
 * Theme-driven appearance: the skin styles, the text colours and the `Graphics` focus ring.
 *
 * The theme is a plain fixture object, the module under test only type-imports Phaser, and the
 * graphics object is a call-recording stub — so all of this runs in Node and pins down "widgets never
 * hard-code a colour" as well as the zero-asset focus ring of PLAN §10.3.
 */

import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import {
  buttonSkinStyles,
  buttonTextColor,
  paintElevation,
  paintFocusRing,
  panelSkinStyles,
} from '../src/appearance';
import { TEST_THEME } from './fixture-theme';

/** Records the drawing calls a widget would make, so the geometry can be asserted. */
interface GraphicsStub {
  graphics: Phaser.GameObjects.Graphics;
  scans: {
    clearCount: number;
    lineStyle: [number, number, number] | null;
    strokeRoundedRect: [number, number, number, number, number] | null;
    strokeRect: [number, number, number, number] | null;
    fills: [number, number][];
  };
}

function stubGraphics(): GraphicsStub {
  const scans: GraphicsStub['scans'] = {
    clearCount: 0,
    lineStyle: null,
    strokeRoundedRect: null,
    strokeRect: null,
    fills: [],
  };

  const graphics = {
    clear() {
      scans.clearCount++;
      return graphics;
    },
    lineStyle(width: number, color: number, alpha: number) {
      scans.lineStyle = [width, color, alpha];
      return graphics;
    },
    fillStyle() {
      return graphics;
    },
    strokeRoundedRect(x: number, y: number, w: number, h: number, radius: number) {
      scans.strokeRoundedRect = [x, y, w, h, radius];
      return graphics;
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      scans.strokeRect = [x, y, w, h];
      return graphics;
    },
    fillRoundedRect(x: number, y: number) {
      scans.fills.push([x, y]);
      return graphics;
    },
    fillRect(x: number, y: number) {
      scans.fills.push([x, y]);
      return graphics;
    },
  } as unknown as Phaser.GameObjects.Graphics;

  return { graphics, scans };
}

describe('buttonSkinStyles', () => {
  it('uses the primary tokens for the primary variant', () => {
    const styles = buttonSkinStyles(TEST_THEME, 'primary');
    expect(styles.normal?.fill).toBe(TEST_THEME.colors.primary);
    expect(styles.hover?.fill).toBe(TEST_THEME.colors.primaryHover);
    expect(styles.pressed?.fill).toBe(TEST_THEME.colors.primaryPressed);
    expect(styles.disabled?.fill).toBe(TEST_THEME.colors.surfaceAlt);
  });

  it('draws a border for the secondary variant and none for the primary one', () => {
    expect(buttonSkinStyles(TEST_THEME, 'secondary').normal?.border).toBe(TEST_THEME.colors.border);
    expect(buttonSkinStyles(TEST_THEME, 'primary').normal?.border).toBeNull();
  });

  it('keeps the ghost variant transparent until it is hovered', () => {
    const styles = buttonSkinStyles(TEST_THEME, 'ghost');
    expect(styles.normal?.fillAlpha).toBe(0);
    expect(styles.hover?.fill).toBe(TEST_THEME.colors.surfaceHover);
    expect(styles.pressed?.fill).toBe(TEST_THEME.colors.surfaceAlt);
  });

  it('derives the danger hover shade from the danger token', () => {
    const styles = buttonSkinStyles(TEST_THEME, 'danger');
    expect(styles.normal?.fill).toBe(TEST_THEME.colors.danger);
    expect(styles.hover?.fill).not.toBe(TEST_THEME.colors.danger);
    expect(styles.pressed?.fill).not.toBe(styles.hover?.fill);
  });

  it('leaves the focused state to the explicit focus ring', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      expect(buttonSkinStyles(TEST_THEME, variant).focused).toBeUndefined();
    }
  });
});

describe('buttonTextColor', () => {
  it('uses onPrimary on the filled variants', () => {
    expect(buttonTextColor(TEST_THEME, 'primary', 'normal')).toBe(TEST_THEME.colors.onPrimary);
    expect(buttonTextColor(TEST_THEME, 'danger', 'hover')).toBe(TEST_THEME.colors.onPrimary);
  });

  it('uses the body text colour on the quiet variants', () => {
    expect(buttonTextColor(TEST_THEME, 'secondary', 'normal')).toBe(TEST_THEME.colors.text);
    expect(buttonTextColor(TEST_THEME, 'ghost', 'focused')).toBe(TEST_THEME.colors.text);
  });

  it('uses textDisabled whenever the painted state is disabled', () => {
    expect(buttonTextColor(TEST_THEME, 'primary', 'disabled')).toBe(TEST_THEME.colors.textDisabled);
    expect(buttonTextColor(TEST_THEME, 'ghost', 'disabled')).toBe(TEST_THEME.colors.textDisabled);
  });
});

describe('panelSkinStyles', () => {
  it('paints the surface variant with the surface token and a border', () => {
    const styles = panelSkinStyles(TEST_THEME, 'surface', 8, true);
    expect(styles.normal?.fill).toBe(TEST_THEME.colors.surface);
    expect(styles.normal?.border).toBe(TEST_THEME.colors.border);
    expect(styles.hover?.fill).toBe(TEST_THEME.colors.surfaceHover);
    expect(styles.normal?.radius).toBe(8);
  });

  it('omits the border when the panel asks for none', () => {
    const styles = panelSkinStyles(TEST_THEME, 'surface', 8, false);
    expect(styles.normal?.border).toBeNull();
    expect(styles.normal?.border).not.toBe(TEST_THEME.colors.border);
  });

  it('makes the plain variant invisible', () => {
    const styles = panelSkinStyles(TEST_THEME, 'plain', 0, false);
    expect(styles.normal?.fillAlpha).toBe(0);
    expect(styles.normal?.border).toBeNull();
  });

  it('uses the overlay token with alpha for the overlay variant', () => {
    const styles = panelSkinStyles(TEST_THEME, 'overlay', 12, false);
    expect(styles.normal?.fill).toBe(TEST_THEME.colors.overlay);
    expect(styles.normal?.fillAlpha).toBe(0.8);
  });

  it('uses the primary and danger tokens for the emphasised variants', () => {
    expect(panelSkinStyles(TEST_THEME, 'primary', 8, false).normal?.fill).toBe(
      TEST_THEME.colors.primary,
    );
    expect(panelSkinStyles(TEST_THEME, 'danger', 8, false).normal?.fill).toBe(
      TEST_THEME.colors.danger,
    );
  });
});

describe('paintFocusRing', () => {
  it('strokes a rounded rect inset by half the ring width in the focusRing token', () => {
    const { graphics, scans } = stubGraphics();
    paintFocusRing(graphics, TEST_THEME, 100, 40, 8);

    expect(scans.lineStyle).toEqual([TEST_THEME.focusRingWidth, TEST_THEME.colors.focusRing, 1]);
    expect(scans.strokeRoundedRect).toEqual([1, 1, 98, 38, 7]);
    expect(scans.strokeRect).toBeNull();
  });

  it('falls back to a square stroke for a zero radius', () => {
    const { graphics, scans } = stubGraphics();
    paintFocusRing(graphics, TEST_THEME, 60, 20, 0);

    expect(scans.strokeRect).toEqual([1, 1, 58, 18]);
    expect(scans.strokeRoundedRect).toBeNull();
  });

  it('draws nothing for a degenerate rect', () => {
    const { graphics, scans } = stubGraphics();
    paintFocusRing(graphics, TEST_THEME, 0, 0, 4);

    expect(scans.lineStyle).toBeNull();
    expect(scans.strokeRoundedRect).toBeNull();
    expect(scans.strokeRect).toBeNull();
  });
});

describe('paintElevation', () => {
  it('clears the layer when there is no elevation', () => {
    const { graphics, scans } = stubGraphics();
    paintElevation(graphics, TEST_THEME, 100, 50, 8, 0);

    expect(scans.clearCount).toBe(1);
    expect(scans.fills).toEqual([]);
  });

  it('stacks translucent rounded rects behind the panel', () => {
    const { graphics, scans } = stubGraphics();
    paintElevation(graphics, TEST_THEME, 100, 50, 8, 4);

    expect(scans.clearCount).toBe(1);
    expect(scans.fills.length).toBeGreaterThan(1);
    // Every layer starts left of the panel, so the halo is visible on all sides, not only below.
    for (const [x] of scans.fills) {
      expect(x).toBeLessThanOrEqual(0);
    }
  });
});
