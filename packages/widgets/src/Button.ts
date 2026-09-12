/**
 * `Button` — a themed, focusable, activatable control.
 *
 * Visual state comes from the `Widget` state machine (`normal`/`hover`/`pressed`/`disabled`/
 * `focused`) and is painted with a `ProceduralSkin`; the keyboard-focus ring is a `Graphics` outline
 * (PLAN §10.3), so no art asset is involved. The button never listens to Phaser input itself: the
 * input router calls `setHovered`/`setPressed` and `activate()`, which keeps pointer, keyboard and
 * gamepad handling in one place.
 */

import Phaser from 'phaser';
import type { BoxConstraints, LayoutParams, Rect, Size } from '@phaser-mvvm/layout';
import type { Theme, WidgetState } from '@phaser-mvvm/phaser';
import { ProceduralSkin, Widget } from '@phaser-mvvm/phaser';
import { buttonSkinStyles, buttonTextColor, paintFocusRing } from './appearance';
import { buttonLabel, resolveButtonActivation, resolveButtonState } from './button-state';
import { toCssColor } from './color';
import { centeredOffset, contentBox } from './geometry';
import { optionBag, splitWidgetOptions } from './options';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOptions extends LayoutParams {
  /** Label text. */
  text?: string;
  /** Texture key of an icon, or a ready-made Game Object (which must expose `width`/`height`). */
  icon?: string | Phaser.GameObjects.GameObject;
  /** Visual flavour. Defaults to `'secondary'`. */
  variant?: ButtonVariant;
  /** Size step, used for the default height and the horizontal padding. Defaults to `'md'`. */
  size?: ButtonSize;
  /** Starts disabled; `setDisabled` toggles the same flag. */
  disabled?: boolean;
  /** Toggle mode: activation flips `value` and emits `change` instead of running `onClick`. */
  toggle?: boolean;
  /** Initial toggle value. */
  value?: boolean;
  /** Starts in the loading state: activation is ignored and the label gains an ellipsis. */
  loading?: boolean;
  /** Runs on activation of a non-toggle button. */
  onClick?: (button: Button) => void;
  name?: string;
}

type ButtonWidgetOptions = Omit<ButtonOptions, keyof LayoutParams | 'name'>;

const BUTTON_KEYS = [
  'text',
  'icon',
  'variant',
  'size',
  'disabled',
  'toggle',
  'value',
  'loading',
  'onClick',
] as const;

/** Events emitted by a button. */
export const BUTTON_EVENTS = {
  /** Fired by a `toggle` button with the new value. */
  CHANGE: 'change',
} as const;

/**
 * The part of a Game Object an icon must expose to be placeable.
 *
 * `Phaser.GameObjects.GameObject` itself carries no size and no transform (those come from optional
 * components), so the button asks for them structurally. A texture-key icon always satisfies it; a
 * hand-made icon should be an `Image`/`Sprite` with a top-left origin.
 */
interface IconLike extends Phaser.GameObjects.GameObject {
  width?: number;
  height?: number;
  setPosition?(x: number, y: number): unknown;
}

export class Button extends Widget {
  /** Label text as configured; the displayed text may carry a loading ellipsis. */
  readonly label: Phaser.GameObjects.Text;

  /** Visual flavour. */
  variant: ButtonVariant;
  /** Size step (drives the default height and padding). */
  size: ButtonSize;
  toggle: boolean;
  loading: boolean;
  /** Runs on activation of a non-toggle button. */
  onClick: ((button: Button) => void) | null;

  private readonly bodyGraphics: Phaser.GameObjects.Graphics;
  private iconObject: IconLike | null = null;
  private value: boolean;
  private labelText: string;
  private explicitHeight: boolean;
  private styleKey = '';
  private skinCache: { theme: Theme; variant: ButtonVariant; skin: ProceduralSkin } | null = null;

  constructor(scene: Phaser.Scene, options: ButtonOptions = {}) {
    const { layout, widget } = splitWidgetOptions<ButtonWidgetOptions>(
      optionBag(options),
      BUTTON_KEYS,
    );
    super(scene, { layout, name: options.name });

    this.variant = widget.variant ?? 'secondary';
    this.size = widget.size ?? 'md';
    this.toggle = widget.toggle === true;
    this.loading = widget.loading === true;
    this.value = widget.value === true;
    this.labelText = widget.text ?? '';
    this.onClick = widget.onClick ?? null;
    this.explicitHeight = options.height !== undefined;

    if (!this.explicitHeight) {
      this.layoutParams.height = this.theme.controlHeight[this.size];
    }

    this.focusable = true;
    this.onActivate = () => {
      this.handleActivation();
    };

    this.bodyGraphics = new Phaser.GameObjects.Graphics(scene);
    this.add(this.bodyGraphics);

    if (widget.icon !== undefined) {
      this.setIcon(widget.icon);
    }

    this.label = new Phaser.GameObjects.Text(scene, 0, 0, this.labelText, {});
    this.label.setOrigin(0, 0);
    this.add(this.label);

    this.applyThemeStyle();
    this.enablePointerInput();

    if (widget.disabled === true) {
      this.setEnabled(false);
    }
    this.refreshAppearance();
  }

  // ------------------------------------------------------------------ value & flags

  /**
   * A loading button ignores activation completely — and says so, so that the input router does not
   * treat the press as handled.
   */
  override activate(source: Parameters<Widget['activate']>[0] = 'pointer'): boolean {
    if (this.loading) {
      return false;
    }
    return super.activate(source);
  }

  getValue(): boolean {
    return this.value;
  }

  /** Sets the toggle value without emitting `change`. */
  setValue(value: boolean): this {
    if (this.value === value) {
      return this;
    }
    this.value = value;
    this.appearanceChanged();
    return this;
  }

  setText(value: string): this {
    if (this.labelText === value) {
      return this;
    }
    this.labelText = value;
    this.applyThemeStyle();
    this.markDirty();
    return this;
  }

  getText(): string {
    return this.labelText;
  }

  setVariant(variant: ButtonVariant): this {
    if (this.variant === variant) {
      return this;
    }
    this.variant = variant;
    this.applyThemeStyle();
    this.appearanceChanged();
    return this;
  }

  setLoading(value: boolean): this {
    if (this.loading === value) {
      return this;
    }
    this.loading = value;
    this.applyThemeStyle();
    this.appearanceChanged();
    // The loading ellipsis changes the measured width of an auto-width button.
    this.markDirty();
    return this;
  }

  /** Convenience inverse of `setEnabled`. */
  setDisabled(value: boolean): this {
    return this.setEnabled(!value);
  }

  /**
   * Swaps the icon; a string is a texture key and is turned into an `Image` with a top-left origin,
   * a Game Object is used as-is (its own origin is respected, so it should be top-left for the
   * centring maths to line up).
   */
  setIcon(icon: string | Phaser.GameObjects.GameObject): this {
    let next: IconLike;
    if (typeof icon === 'string') {
      const image = new Phaser.GameObjects.Image(this.scene, 0, 0, icon);
      image.setOrigin(0, 0);
      next = image;
    } else {
      next = icon;
    }
    if (next === this.iconObject) {
      return this;
    }
    if (this.iconObject) {
      this.remove(this.iconObject, true);
    }
    this.iconObject = next;
    // Behind the label but in front of the background graphics.
    this.addAt(next, Math.min(1, this.length));
    this.markDirty();
    return this;
  }

  /** Drops the icon (no-op when there is none). */
  clearIcon(): this {
    if (!this.iconObject) {
      return this;
    }
    this.remove(this.iconObject, true);
    this.iconObject = null;
    this.markDirty();
    return this;
  }

  /** The Game Object used as the icon, if any. */
  get icon(): Phaser.GameObjects.GameObject | null {
    return this.iconObject;
  }

  // ------------------------------------------------------------------ layout

  override measureContent(_constraint: BoxConstraints): Size {
    const theme = this.theme;
    const padding = theme.spacing[this.size];
    const iconSize = this.iconSize();
    const gap = iconSize.width > 0 && this.label.width > 0 ? theme.spacing.xs : 0;

    return {
      width: padding * 2 + iconSize.width + gap + this.label.width,
      height: Math.max(iconSize.height, this.label.height),
    };
  }

  protected override onRectChanged(rect: Rect): void {
    const box = contentBox(rect.width, rect.height, this.layoutParams.padding);
    const theme = this.theme;
    const iconSize = this.iconSize();
    const gap = iconSize.width > 0 && this.label.width > 0 ? theme.spacing.xs : 0;
    const total = iconSize.width + gap + this.label.width;

    let x = box.x + centeredOffset(total, box.width);
    if (this.iconObject && iconSize.width > 0) {
      this.iconObject.setPosition?.(x, box.y + centeredOffset(iconSize.height, box.height));
      x += iconSize.width + gap;
    }
    this.label.setPosition(x, box.y + centeredOffset(this.label.height, box.height));

    this.refreshAppearance();
  }

  protected override refreshAppearance(): void {
    const theme = this.theme;
    if (!this.explicitHeight) {
      this.layoutParams.height = theme.controlHeight[this.size];
    }

    const width = Math.max(0, this.rect.width);
    const height = Math.max(0, this.rect.height);
    const state = resolveButtonState({
      state: this.visualState,
      loading: this.loading,
      toggle: this.toggle,
      value: this.value,
    });

    this.bodyGraphics.clear();
    this.skinFor(theme).paint(this.bodyGraphics, width, height, state);

    const radius = Math.max(0, Math.min(theme.radius.md, Math.min(width, height) / 2));
    if (this.focused) {
      paintFocusRing(this.bodyGraphics, theme, width, height, radius);
    }

    this.applyThemeStyle();
  }

  // ------------------------------------------------------------------ internals

  private handleActivation(): void {
    const decision = resolveButtonActivation({
      enabled: this.enabled,
      loading: this.loading,
      toggle: this.toggle,
      value: this.value,
    });
    if (decision.ignored) {
      return;
    }
    if (decision.toggles) {
      this.setValue(decision.value);
      this.emit(BUTTON_EVENTS.CHANGE, decision.value);
      return;
    }
    if (decision.invokesClick) {
      this.onClick?.(this);
    }
  }

  /**
   * A loading button keeps its label and gains an ellipsis; colours come from the theme.
   *
   * Both the style and the text are written only when they actually change: a hover or press repaints
   * the background but must not force a canvas text re-render.
   */
  private applyThemeStyle(): void {
    const theme = this.theme;
    const state: WidgetState = resolveButtonState({
      state: this.visualState,
      loading: this.loading,
      toggle: this.toggle,
      value: this.value,
    });
    const color = toCssColor(buttonTextColor(theme, this.variant, state));
    const styleKey = `${theme.fontFamily}|${theme.fontSize.md}|${color}`;
    if (styleKey !== this.styleKey) {
      this.styleKey = styleKey;
      this.label.setStyle({
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize.md,
        color,
        align: 'center',
      });
    }

    const text = buttonLabel(this.labelText, this.loading);
    if (this.label.text !== text) {
      this.label.setText(text);
    }
  }

  private iconSize(): Size {
    if (!this.iconObject) {
      return { width: 0, height: 0 };
    }
    return { width: this.iconObject.width ?? 0, height: this.iconObject.height ?? 0 };
  }

  private skinFor(theme: Theme): ProceduralSkin {
    const cached = this.skinCache;
    if (cached && cached.theme === theme && cached.variant === this.variant) {
      return cached.skin;
    }
    const skin = new ProceduralSkin(buttonSkinStyles(theme, this.variant));
    this.skinCache = { theme, variant: this.variant, skin };
    return skin;
  }
}
