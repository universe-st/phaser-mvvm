/**
 * `Slider` geometry: the pure maths behind the widget.
 *
 * Kept in its own Phaser-free module so it can be unit-tested in Node (the same split as
 * `button-state.ts` / `scroll-plan.ts`) — this is the code that decides whether a drag reports `42` or
 * `41.999999`, and whether a bound `ref` can ever see a value outside `[min, max]`.
 */

/**
 * Snaps `value` to the `step` grid and clamps it into `[min, max]`.
 *
 * `step <= 0` (or non-finite) means continuous. The grid is anchored at `min`, so a slider with
 * `min: 5, step: 10` produces 5, 15, 25… rather than 0, 10, 20… — the values a caller asked for.
 */
export function clampSliderValue(value: number, min: number, max: number, step = 0): number {
  const low = Number.isFinite(min) ? min : 0;
  const high = Number.isFinite(max) ? Math.max(low, max) : low + 100;
  const raw = Number.isFinite(value) ? value : low;
  let next = Math.min(high, Math.max(low, raw));
  if (Number.isFinite(step) && step > 0) {
    next = low + Math.round((next - low) / step) * step;
    next = Math.min(high, Math.max(low, Number(next.toFixed(6))));
  }
  return next;
}

/** Where the knob sits inside `[0, 1]` for a value; a zero-width range reports `0`. */
export function sliderFraction(value: number, min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, (value - min) / span));
}

/**
 * The value for a knob position, given the pixel span of the track.
 *
 * `position` is measured from the centre of the knob's start position (see `Slider#valueAtLocalX`), so
 * the knob's own radius is already accounted for by the caller.
 */
export function sliderValueFromPosition(
  position: number,
  length: number,
  min: number,
  max: number,
  step = 0,
): number {
  if (!Number.isFinite(length) || length <= 0) {
    return clampSliderValue(min, min, max, step);
  }
  const fraction = Math.min(1, Math.max(0, position / length));
  return clampSliderValue(min + fraction * (max - min), min, max, step);
}
