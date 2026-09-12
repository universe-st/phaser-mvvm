/**
 * `Slider` — a draggable value control, the touch-native member of the control library.
 *
 * Compose's `Slider` in spirit: a track, a filled portion and a knob, driven by a **continuous drag**
 * rather than by an activation. A press anywhere on the track jumps the knob there, and a drag keeps
 * tracking — including *outside* the widget's own rect, which is why the drag listens to the scene's
 * pointer stream instead of to the widget's own `pointermove` (Phaser stops emitting that event the
 * moment the pointer leaves the object; a finger sliding off the end of a slider must keep working).
 *
 * Values are **quantised and clamped** by `min`/`max`/`step` before anything is reported, so a bound
 * `ref` never sees an out-of-range or off-grid value. The geometry maths lives in the exported pure
 * functions below (`sliderValueFromPosition` / `sliderPositionOf`) and is unit-tested in Node.
 *
 * Keyboard: not wired yet. Arrow keys are consumed by the focus manager for navigation, so a keyboard
 * slider needs an agreement with it (tracked in `docs/DEFECT-BACKLOG.md`); pointer and touch are the
 * supported inputs today.
 */

import Phaser from 'phaser';
import type { BoxConstraints, LayoutParams, Rect, Size } from '@phaser-mvvm/layout';
import { Widget, colorOf, pointerInWidgetSpace } from '@phaser-mvvm/phaser';
import { paintFocusRing } from './appearance';
import {
  clampSliderValue,
  sliderFraction,
  sliderValueForKey,
  sliderValueFromPosition,
} from './slider-geometry';
import { optionBag, splitWidgetOptions } from './options';

export interface SliderOptions extends LayoutParams {
  /** Initial value; clamped into `[min, max]` and snapped to `step`. Defaults to `min`. */
  value?: number;
  /** Lower bound. Defaults to `0`. */
  min?: number;
  /** Upper bound. Defaults to `100`. */
  max?: number;
  /** Grid the value snaps to; `0` (the default) means continuous. */
  step?: number;
  disabled?: boolean;
  /** Track thickness in design pixels. Defaults to `6`. */
  trackThickness?: number;
  /** Knob radius in design pixels. Defaults to `9`. */
  knobRadius?: number;
  /** Called with the new value on every *user* change (not on `setValue`). */
  onChange?: (value: number, slider: Slider) => void;
  name?: string;
}

type SliderWidgetOptions = Omit<SliderOptions, keyof LayoutParams | 'name'>;

const SLIDER_KEYS = [
  'value',
  'min',
  'max',
  'step',
  'disabled',
  'trackThickness',
  'knobRadius',
  'onChange',
] as const;

/** Events emitted by a slider. */
export const SLIDER_EVENTS = {
  /** Fired with the new value when the user drags or taps the track. */
  CHANGE: 'change',
} as const;

/** Default track length when the caller does not set one. */
const DEFAULT_WIDTH = 180;

export class Slider extends Widget {
  min: number;
  max: number;
  step: number;
  /** Track thickness in design pixels. */
  trackThickness: number;
  /** Knob radius in design pixels. */
  knobRadius: number;
  onChange: ((value: number, slider: Slider) => void) | null;

  private readonly trackGraphics: Phaser.GameObjects.Graphics;
  private current: number;
  private dragging = false;
  /** The pointer that owns the drag: a second finger must not steer this slider (touch ids are 1..n). */
  private dragPointerId: number | null = null;
  private styleKey = '';

  constructor(scene: Phaser.Scene, options: SliderOptions = {}) {
    const { layout, widget } = splitWidgetOptions<SliderWidgetOptions>(
      optionBag(options),
      SLIDER_KEYS,
    );
    super(scene, { layout, name: options.name });

    this.min = Number.isFinite(widget.min) ? (widget.min as number) : 0;
    this.max = Number.isFinite(widget.max) ? (widget.max as number) : 100;
    if (this.max < this.min) {
      this.max = this.min;
    }
    this.step =
      Number.isFinite(widget.step) && (widget.step as number) > 0 ? (widget.step as number) : 0;
    this.trackThickness = Math.max(2, Math.round(widget.trackThickness ?? 6));
    this.knobRadius = Math.max(4, Math.round(widget.knobRadius ?? 9));
    this.onChange = widget.onChange ?? null;
    this.current = clampSliderValue(widget.value ?? this.min, this.min, this.max, this.step);

    if (options.width === undefined) {
      this.layoutParams.width = DEFAULT_WIDTH;
    }
    if (options.height === undefined) {
      this.layoutParams.height = this.knobRadius * 2 + 4;
    }

    this.focusable = true;
    this.trackGraphics = new Phaser.GameObjects.Graphics(scene);
    this.add(this.trackGraphics);

    this.enablePointerInput();
    // The pointer is read from its own coordinates rather than from Phaser's `localX`: that value is
    // offset by `displayOrigin` (half of the container's size - see `Widget#enablePointerInput`), so a
    // press in the middle of a 200px slider reports 200 and maps to the wrong end. `localXOf` uses the
    // same space helper the input router uses, so a click on a camera-pinned slider lands correctly too.
    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.beginDrag(pointer);
    });
    // First refusal on the arrows/Home/End/PageUp/PageDown while focused; everything else (Tab, Enter,
    // Escape) is declined so navigation keeps working (`Widget#onKeyDown`).
    this.onKeyDown = (_event, _action) => this.handleKey(_event);

    if (widget.disabled === true) {
      this.setEnabled(false);
    }
    this.refreshAppearance();
  }

  // ------------------------------------------------------------------ value

  /** The current value, already clamped and snapped. */
  get value(): number {
    return this.current;
  }

  set value(next: number) {
    this.setValue(next);
  }

  getValue(): number {
    return this.current;
  }

  /** Sets the value programmatically; clamps/snaps it and never emits `change`. */
  setValue(next: number): this {
    const resolved = clampSliderValue(next, this.min, this.max, this.step);
    if (resolved === this.current) {
      return this;
    }
    this.current = resolved;
    this.refreshAppearance();
    return this;
  }

  /** Changes the range; the current value is re-clamped (and re-snapped) against it. */
  setRange(min: number, max: number): this {
    this.min = Number.isFinite(min) ? min : 0;
    this.max = Number.isFinite(max) ? Math.max(this.min, max) : this.min;
    return this.setValue(this.current);
  }

  /** Sets the snapping grid; `0` means continuous. */
  setStep(step: number): this {
    this.step = Number.isFinite(step) && step > 0 ? step : 0;
    return this.setValue(this.current);
  }

  // ------------------------------------------------------------------ pointer

  /**
   * Starts a drag, or jumps the knob for a plain tap.
   *
   * The router sends `pointerdown` only to the resolved target, so a press that belongs to a panel
   * above the slider never starts a drag here.
   */
  private beginDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled) {
      return;
    }
    if (this.dragging) {
      return;
    }
    this.dragging = true;
    this.dragPointerId = pointer.id;
    this.applyLocalX(this.localXOf(pointer));
    // The scene stream keeps the drag alive once the pointer leaves the widget's rect, and it is the
    // same stream a touch produces, so one implementation covers mouse and finger.
    const input = this.scene?.input;
    input?.on('pointermove', this.onScenePointerMove);
    input?.on('pointerup', this.onScenePointerUp);
    input?.on('pointerupoutside', this.onScenePointerUp);
  }

  private readonly onScenePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dragging || this.isDestroyed || pointer.id !== this.dragPointerId) {
      return;
    }
    this.applyLocalX(this.localXOf(pointer));
  };

  private readonly onScenePointerUp = (pointer?: Phaser.Input.Pointer): void => {
    // Only the finger that grabbed the slider may let go of it.
    if (pointer && this.dragPointerId !== pointer.id) {
      return;
    }
    this.endDrag();
  };

  private endDrag(): void {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.dragPointerId = null;
    const input = this.scene?.input;
    input?.off('pointermove', this.onScenePointerMove);
    input?.off('pointerup', this.onScenePointerUp);
    input?.off('pointerupoutside', this.onScenePointerUp);
  }

  /**
   * Pointer position in this widget's local space: the router's coordinate space minus the container
   * chain's offsets (the same sum the layout engine uses when it places the widget).
   */
  private localXOf(pointer: Phaser.Input.Pointer): number {
    const point = pointerInWidgetSpace(pointer, this, this.scene?.cameras.main ?? null);
    let offset = 0;
    let node: Phaser.GameObjects.Container | null = this.parentContainer;
    while (node) {
      offset += node.x;
      node = node.parentContainer;
    }
    return point.x - offset;
  }

  /** Maps a local x onto the track and reports the resulting value. */
  private applyLocalX(localX: number): void {
    const width = Math.max(0, this.rect.width);
    const length = Math.max(0, width - this.knobRadius * 2);
    const next = sliderValueFromPosition(
      localX - this.knobRadius,
      length,
      this.min,
      this.max,
      this.step,
    );
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.refreshAppearance();
    this.onChange?.(next, this);
    this.emit(SLIDER_EVENTS.CHANGE, next);
  }

  /** Moves the value by one step, one page or to an end; reports it exactly like a drag would. */
  private handleKey(event: KeyboardEvent): boolean {
    if (!this.enabled) {
      return false;
    }
    const next = sliderValueForKey(this.current, event.key, this.min, this.max, this.step);
    if (next === null) {
      return false;
    }
    if (next !== this.current) {
      this.current = next;
      this.refreshAppearance();
      this.onChange?.(next, this);
      this.emit(SLIDER_EVENTS.CHANGE, next);
    }
    return true;
  }

  // ------------------------------------------------------------------ lifecycle

  override destroy(fromScene?: boolean): void {
    this.endDrag();
    super.destroy(fromScene);
  }

  // ------------------------------------------------------------------ layout & paint

  override measureContent(_constraint: BoxConstraints): Size {
    return { width: DEFAULT_WIDTH, height: this.knobRadius * 2 + 4 };
  }

  protected override onRectChanged(_rect: Rect): void {
    this.refreshAppearance();
  }

  protected override refreshAppearance(): void {
    const theme = this.theme;
    const width = Math.max(0, this.rect.width);
    const height = Math.max(0, this.rect.height);
    const disabled = !this.enabled;

    const key = [width, height, this.current, this.visualState, disabled, theme.name].join('|');
    if (key === this.styleKey) {
      return;
    }
    this.styleKey = key;

    const graphics = this.trackGraphics;
    graphics.clear();
    if (width <= 0 || height <= 0) {
      return;
    }

    const centerY = height / 2;
    const radius = this.knobRadius;
    const start = radius;
    const length = Math.max(0, width - radius * 2);
    const knobX = start + sliderFraction(this.current, this.min, this.max) * length;

    // Track (full length, then the filled part on top of it).
    const trackColor = colorOf(theme, undefined, theme.colors.border);
    const fillColor = disabled
      ? theme.colors.textDisabled
      : this.pressed || this.dragging
        ? theme.colors.primaryPressed
        : this.hovered
          ? theme.colors.primaryHover
          : theme.colors.primary;

    graphics.fillStyle(trackColor, disabled ? 0.5 : 1);
    graphics.fillRoundedRect(
      start,
      centerY - this.trackThickness / 2,
      length,
      this.trackThickness,
      this.trackThickness / 2,
    );
    if (knobX > start) {
      graphics.fillStyle(fillColor, 1);
      graphics.fillRoundedRect(
        start,
        centerY - this.trackThickness / 2,
        knobX - start,
        this.trackThickness,
        this.trackThickness / 2,
      );
    }

    // Knob: a solid disc with a rim; it grows a little while dragged, the standard touch affordance
    // that tells a finger "you are holding this".
    const active = this.dragging || this.pressed;
    const knobRadius = radius + (active ? 1 : 0);
    graphics.fillStyle(disabled ? theme.colors.surfaceAlt : theme.colors.surface, 1);
    graphics.fillCircle(knobX, centerY, knobRadius);
    graphics.lineStyle(theme.borderWidth * 2, disabled ? theme.colors.textDisabled : fillColor, 1);
    graphics.strokeCircle(knobX, centerY, knobRadius);

    if (this.focused) {
      paintFocusRing(graphics, theme, width, height, Math.min(theme.radius.md, height / 2));
    }
  }
}
