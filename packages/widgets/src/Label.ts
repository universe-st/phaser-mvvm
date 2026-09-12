/**
 * `Label` — a single block of theme-styled text.
 *
 * The widget owns one `Phaser.GameObjects.Text` which is *not* a layout child: the label measures it
 * itself and positions it inside its own content box. Everything visual comes from the theme, and a
 * theme switch re-applies the style and re-truncates the lines (PLAN §4.6).
 *
 * `maxLines` + `ellipsis` are implemented on top of `text-truncate.ts`: Phaser wraps text but has no
 * line limit, so the widget asks for the wrapped lines, trims them, and writes the visible text back.
 */

import Phaser from 'phaser';
import type { BoxConstraints, LayoutParams, Rect, Size } from '@phaser-mvvm/layout';
import type { ThemeColorName } from '@phaser-mvvm/phaser';
import { Widget } from '@phaser-mvvm/phaser';
import { toCssColor } from './color';
import { contentBox } from './geometry';
import { optionBag, splitWidgetOptions, baseWidgetOptions } from './options';
import { fontSizeOf, glyphPadding } from './text-padding';
import { textMetricsOf, type SceneTextMetrics } from './text-metrics';
import { applyLineLimit, rewrapOverflowingLines } from './text-truncate';

export type LabelAlign = 'left' | 'center' | 'right';

/** Semantic text colours; every tone maps to a theme token, never to a literal. */
export type LabelTone = 'default' | 'muted' | 'danger' | 'success' | 'warning' | 'primary';

export interface LabelOptions extends LayoutParams {
  /** Initial text. `\n` starts a new line even when wrapping is off. */
  text?: string;
  /** Overrides merged on top of the theme style (font, colour, stroke, shadow, …). */
  style?: Phaser.Types.GameObjects.Text.TextStyle;
  /** Wrap at the available width. Defaults to `true`. */
  wrap?: boolean;
  /** Alignment inside the content box, applied to the text style and to the object's position. */
  align?: LabelAlign;
  /** Lines shown before the rest is dropped. Defaults to no limit. */
  maxLines?: number;
  /** Append `…` to the last visible line when lines are dropped. Defaults to `false`. */
  ellipsis?: boolean;
  /**
   * Canvas text cannot be selected, so only `false` is accepted. The option exists so that form
   * templates can pass `selectable: false` to every control without special-casing labels.
   */
  selectable?: false;
  /** Semantic colour of the text. Defaults to `'default'` (`theme.colors.text`). */
  tone?: LabelTone;
  name?: string;
  /** Tab order hint for the focus manager (lower first). */
  focusOrder?: number;
}

type LabelWidgetOptions = Omit<LabelOptions, keyof LayoutParams | 'name'>;

const LABEL_KEYS = [
  'text',
  'style',
  'wrap',
  'align',
  'maxLines',
  'ellipsis',
  'selectable',
  'tone',
] as const;

const TONE_COLORS: Record<LabelTone, ThemeColorName> = {
  default: 'text',
  muted: 'textMuted',
  danger: 'danger',
  success: 'success',
  warning: 'warning',
  primary: 'primary',
};

export class Label extends Widget {
  /** The underlying Phaser text object; exposed for advanced styling, not for layout. */
  readonly textObject: Phaser.GameObjects.Text;

  private rawText: string;
  private displayedText = '';
  private clipped = false;
  private wrap: boolean;
  private align: LabelAlign;
  private maxLines: number;
  private ellipsis: boolean;
  private tone: LabelTone;
  private readonly userStyle: Phaser.Types.GameObjects.Text.TextStyle;
  /** Serialised once: it is part of both the style key and the text-metrics key. */
  private readonly userStyleKey: string;
  private wrapWidth: number | null = null;
  private styleKey = '';
  /** Last glyph padding applied, so the canvas is only re-sized when it changes. */
  private glyphPad = -1;

  constructor(scene: Phaser.Scene, options: LabelOptions = {}) {
    const { layout, widget } = splitWidgetOptions<LabelWidgetOptions>(
      optionBag(options),
      LABEL_KEYS,
    );
    super(scene, { layout, ...baseWidgetOptions(options) });

    this.rawText = widget.text ?? '';
    this.wrap = widget.wrap !== false;
    this.align = widget.align ?? 'left';
    this.maxLines = widget.maxLines ?? Number.POSITIVE_INFINITY;
    this.ellipsis = widget.ellipsis === true;
    this.tone = widget.tone ?? 'default';
    this.userStyle = widget.style ?? {};
    this.userStyleKey = JSON.stringify(this.userStyle);

    this.textObject = new Phaser.GameObjects.Text(scene, 0, 0, this.rawText, {});
    this.textObject.setOrigin(0, 0);
    this.add(this.textObject);

    this.applyThemeStyle();
    this.updateDisplayedText();
  }

  // ------------------------------------------------------------------ content

  /** The logical text (never the truncated display text). */
  getText(): string {
    return this.rawText;
  }

  setText(value: string): this {
    if (this.rawText === value) {
      return this;
    }
    this.rawText = value;
    this.updateDisplayedText();
    this.markDirty();
    return this;
  }

  /** Switches the semantic colour of the text. */
  setTone(tone: LabelTone): this {
    if (this.tone === tone) {
      return this;
    }
    this.tone = tone;
    this.applyThemeStyle();
    return this;
  }

  /** True when the display text had to be clipped to satisfy `maxLines`/`ellipsis`. */
  get truncated(): boolean {
    return this.clipped;
  }

  override measureContent(constraint: BoxConstraints): Size {
    this.setWrapWidth(this.wrap ? constraint.maxWidth : null);
    this.updateDisplayedText();
    return { width: this.textObject.width, height: this.textObject.height };
  }

  protected override onRectChanged(rect: Rect): void {
    const box = contentBox(rect.width, rect.height, this.layoutParams.padding);
    // The engine re-measures against the final, tight constraint before `applyRect`, so this is a
    // no-op in the normal flow; it keeps the display correct for direct `applyRect` calls in tests.
    this.setWrapWidth(this.wrap && box.width > 0 ? box.width : null);
    this.updateDisplayedText();
    this.positionText(box);
  }

  protected override refreshAppearance(): void {
    this.applyThemeStyle();
    this.updateDisplayedText();
    this.positionText(contentBox(this.rect.width, this.rect.height, this.layoutParams.padding));
  }

  // ------------------------------------------------------------------ internals

  /**
   * Theme defaults first, caller overrides last; nothing here is a literal colour.
   *
   * The style is re-applied only when it actually changes, so a state change that does not affect the
   * text (an error flag, for example) does not force a canvas text re-render.
   */
  private applyThemeStyle(): void {
    const theme = this.theme;
    const color = toCssColor(theme.colors[TONE_COLORS[this.tone]]);
    // The caller's style overrides participate in the key: two labels with the same theme style but a
    // different `userStyle` must not share cached measurements.
    const styleKey = `${theme.name}|${theme.fontFamily}|${theme.fontSize.md}|${color}|${this.align}|${this.userStyleKey}`;
    if (styleKey === this.styleKey) {
      return;
    }
    this.styleKey = styleKey;
    this.textObject.setStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize.md,
      color,
      align: this.align,
      ...this.userStyle,
    });
    this.applyGlyphPadding();
  }

  /**
   * Reserves the fraction of a pixel Phaser's text canvas loses to truncation and glyph overshoot.
   *
   * Without it the descender of a `g` is shaved off, and - worse - the label *measured* one pixel short
   * as well, so the layout under-reserved the space. Symmetric so the optical centre does not move.
   */
  private applyGlyphPadding(): void {
    const size = fontSizeOf(this.textObject.style, this.theme.fontSize.md);
    const pad = glyphPadding(size);
    if (pad === this.glyphPad) {
      return;
    }
    this.glyphPad = pad;
    this.textObject.setPadding(pad, pad, pad, pad);
  }

  private setWrapWidth(width: number | null): void {
    const next = width !== null && Number.isFinite(width) && width > 0 ? width : null;
    if (next === this.wrapWidth) {
      return;
    }
    this.wrapWidth = next;
    this.textObject.setWordWrapWidth(next);
  }

  /** This scene's text-metrics cache, or `null` once the widget lost its scene (destroyed). */
  private get metrics(): SceneTextMetrics | null {
    return this.scene ? textMetricsOf(this.scene) : null;
  }

  private updateDisplayedText(): void {
    const metrics = this.metrics;
    // Wrapping and the ellipsis search are the two canvas-bound steps of a label, and both are pure
    // functions of (text, style, wrap width) - so they are memoised per scene instead of re-run on every
    // measure pass (see `text-metrics.ts`).
    const lines = metrics
      ? metrics.wrappedLines(this.metricsKey(this.rawText), () =>
          this.textObject.getWrappedText(this.rawText),
        )
      : this.textObject.getWrappedText(this.rawText);
    const wrapWidth = this.wrapWidth ?? Number.POSITIVE_INFINITY;
    // Phaser breaks at spaces only, so a line that still overflows is split here (CJK has no spaces at
    // all); this runs before the line limit so `maxLines`/`ellipsis` see the real lines.
    const wrapped =
      this.wrap && Number.isFinite(wrapWidth)
        ? rewrapOverflowingLines(lines, wrapWidth, (value) => this.measureTextWidth(value))
        : lines;
    const result = applyLineLimit(wrapped, {
      maxLines: this.maxLines,
      ellipsis: this.ellipsis,
      maxWidth: wrapWidth,
      measureWidth: (value) => this.measureTextWidth(value),
    });
    const joined = result.lines.join('\n');
    this.clipped = result.truncated;
    if (joined !== this.displayedText) {
      this.displayedText = joined;
      this.textObject.setText(joined);
    }
  }

  /**
   * Width of a candidate string with the current font, straight from the text's own canvas.
   *
   * Cached per (style, wrap width, candidate): the ellipsis search calls this `log2(length)` times per
   * line on *every* measure of a dirty label, always with the same handful of candidates.
   */
  private measureTextWidth(value: string): number {
    const metrics = this.metrics;
    const compute = (): number => {
      const context = this.textObject.context;
      this.textObject.style.syncFont(this.textObject.canvas, context);
      return context.measureText(value).width;
    };
    return metrics ? metrics.width(this.metricsKey(value), compute) : compute();
  }

  /** Identity of a measurement: the effective style, the wrap width, and the string itself. */
  private metricsKey(text: string): string {
    return `${this.styleKey}\u0001${this.wrapWidth ?? 0}\u0001${text}`;
  }

  private positionText(box: Rect): void {
    let x = box.x;
    if (this.align === 'center') {
      x = box.x + Math.max(0, (box.width - this.textObject.width) / 2);
    } else if (this.align === 'right') {
      x = box.x + Math.max(0, box.width - this.textObject.width);
    }
    this.textObject.setPosition(x, box.y);
  }
}
