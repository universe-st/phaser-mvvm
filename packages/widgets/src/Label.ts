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
import { optionBag, splitWidgetOptions } from './options';
import { applyLineLimit } from './text-truncate';

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
  private wrapWidth: number | null = null;
  private styleKey = '';

  constructor(scene: Phaser.Scene, options: LabelOptions = {}) {
    const { layout, widget } = splitWidgetOptions<LabelWidgetOptions>(
      optionBag(options),
      LABEL_KEYS,
    );
    super(scene, { layout, name: options.name });

    this.rawText = widget.text ?? '';
    this.wrap = widget.wrap !== false;
    this.align = widget.align ?? 'left';
    this.maxLines = widget.maxLines ?? Number.POSITIVE_INFINITY;
    this.ellipsis = widget.ellipsis === true;
    this.tone = widget.tone ?? 'default';
    this.userStyle = widget.style ?? {};

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
    const styleKey = `${theme.name}|${theme.fontFamily}|${theme.fontSize.md}|${color}|${this.align}`;
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
  }

  private setWrapWidth(width: number | null): void {
    const next = width !== null && Number.isFinite(width) && width > 0 ? width : null;
    if (next === this.wrapWidth) {
      return;
    }
    this.wrapWidth = next;
    this.textObject.setWordWrapWidth(next);
  }

  private updateDisplayedText(): void {
    const lines = this.textObject.getWrappedText(this.rawText);
    const result = applyLineLimit(lines, {
      maxLines: this.maxLines,
      ellipsis: this.ellipsis,
      maxWidth: this.wrapWidth ?? Number.POSITIVE_INFINITY,
      measureWidth: (value) => this.measureTextWidth(value),
    });
    const joined = result.lines.join('\n');
    this.clipped = result.truncated;
    if (joined !== this.displayedText) {
      this.displayedText = joined;
      this.textObject.setText(joined);
    }
  }

  /** Width of a candidate string with the current font, straight from the text's own canvas. */
  private measureTextWidth(value: string): number {
    const context = this.textObject.context;
    this.textObject.style.syncFont(this.textObject.canvas, context);
    return context.measureText(value).width;
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
