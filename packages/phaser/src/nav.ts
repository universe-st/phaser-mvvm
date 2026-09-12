/**
 * Navigation sources: the device-independent vocabulary a focus manager consumes.
 *
 * Three layers live here, deliberately separated so that the interesting logic is testable in plain
 * Node (no Phaser runtime, no real timers, no DOM):
 *
 * 1. `NavAction` — the vocabulary (`next`/`prev`, the four directions, `activate`, `back`),
 * 2. mappers — `keyboardActionOf(event)` and `gamepadActionsOf(pad, previous)`, which turn raw
 *    device state into that vocabulary (keyboard events only *read* the native event; gamepad
 *    "previous" state is supplied and returned by the caller, so the module keeps no memory),
 * 3. `NavRepeat` — a hold-to-repeat state machine whose clock is the `now` argument.
 *
 * Wiring a source to a scene is the host's job (`MVVMPlugin` owns the listeners and polls the pad
 * once per frame): this module never touches a `Scene` and never creates a Phaser object at import
 * time, so importing it in a Node test costs nothing.
 */

import type Phaser from 'phaser';

/** Everything a focus manager can be asked to do by a navigation source. */
export type NavAction = 'next' | 'prev' | 'up' | 'down' | 'left' | 'right' | 'activate' | 'back';

/** The four geometric directions, in a fixed order. */
export const NAV_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/** A geometric navigation action. */
export type NavDirection = (typeof NAV_DIRECTIONS)[number];

// ---------------------------------------------------------------------------- hold-to-repeat

export interface NavRepeatOptions {
  /** Delay before the first repeat of a held action, in milliseconds. Defaults to 350. */
  initialDelay?: number;
  /** Delay between repeats once an action repeats, in milliseconds. Defaults to 90. */
  repeatDelay?: number;
}

export const NAV_REPEAT_DEFAULTS = { initialDelay: 350, repeatDelay: 90 } as const;

/**
 * Turns "held down" into a stream of actions.
 *
 * The caller owns the clock: `update(heldActions, now)` is a pure-ish state machine (its only state
 * is per-action timing) that fires a held action immediately, then again every `initialDelay` →
 * `repeatDelay` milliseconds. Releasing an action resets it, so the next press fires immediately
 * again. `now` may be a Phaser clock value, `performance.now()` or a plain counter — tests use a
 * counter.
 */
export class NavRepeat {
  readonly initialDelay: number;
  readonly repeatDelay: number;

  /** Next timestamp at which each currently held action repeats. */
  private readonly nextAt = new Map<NavAction, number>();

  constructor(options: NavRepeatOptions = {}) {
    this.initialDelay = normalizeDelay(options.initialDelay, NAV_REPEAT_DEFAULTS.initialDelay);
    this.repeatDelay = normalizeDelay(options.repeatDelay, NAV_REPEAT_DEFAULTS.repeatDelay);
  }

  /** Actions held on the last `update` call. */
  get heldActions(): NavAction[] {
    return [...this.nextAt.keys()];
  }

  isHeld(action: NavAction): boolean {
    return this.nextAt.has(action);
  }

  /**
   * Feeds the set of actions currently held and returns the actions that should fire now.
   *
   * The returned list keeps the order of `heldActions`, so a diagonal stick push is deterministic.
   */
  update(heldActions: readonly NavAction[], now: number): NavAction[] {
    const fired: NavAction[] = [];
    const stillHeld = new Set<NavAction>();

    for (const action of heldActions) {
      if (stillHeld.has(action)) {
        continue;
      }
      stillHeld.add(action);

      const due = this.nextAt.get(action);
      if (due === undefined) {
        // First frame this action is held: fire once, then wait `initialDelay` for the first repeat.
        this.nextAt.set(action, now + this.initialDelay);
        fired.push(action);
      } else if (now >= due) {
        this.nextAt.set(action, now + this.repeatDelay);
        fired.push(action);
      }
    }

    for (const action of [...this.nextAt.keys()]) {
      if (!stillHeld.has(action)) {
        this.nextAt.delete(action);
      }
    }

    return fired;
  }

  /** Forgets all timing state; the next `update` treats every held action as a fresh press. */
  reset(): void {
    this.nextAt.clear();
  }
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

// ---------------------------------------------------------------------------- keyboard

/**
 * The arrow key a navigation direction stands for.
 *
 * A widget that handles navigation *actions* (see `Widget#onAction`) still has to run its key-based
 * logic for the keyboard, and this is the one place that translation lives — the `Slider` and the
 * `ScrollView` both use it, so "D-Pad right" and "ArrowRight" can never drift apart.
 */
export const ARROW_KEY_OF_DIRECTION: Record<NavDirection, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/**
 * Maps a native keyboard event onto a navigation action.
 *
 * Phaser hands the *native* `KeyboardEvent` to `scene.input.keyboard.on('keydown', …)` listeners,
 * so this function takes exactly that object. `preventDefault()` is intentionally *not* called
 * here: only the host knows whether a key (Tab, arrows, space) should keep its browser meaning.
 */
export function keyboardActionOf(event: KeyboardEvent): NavAction | null {
  switch (event.key) {
    case 'Tab':
      return event.shiftKey ? 'prev' : 'next';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    // ' ' is the modern value; 'Spacebar' is what very old browsers report.
    case ' ':
    case 'Spacebar':
      return 'activate';
    case 'Escape':
    case 'Esc':
      return 'back';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------- gamepad

/** Left-stick dead zone: an axis counts as held once `|value| >= threshold`. */
export const GAMEPAD_AXIS_THRESHOLD = 0.5;

/** Face buttons of the standard mapping: `buttons[0]` = A/×, `buttons[1]` = B/○. */
export const GAMEPAD_BUTTON_ACTIVATE = 0;
export const GAMEPAD_BUTTON_BACK = 1;

/** D-Pad button indices of the standard (W3C) mapping, which Phaser applies by default. */
const DPAD_BUTTONS: ReadonlyArray<readonly [number, NavDirection]> = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];

/**
 * A plain snapshot of a pad's axes and buttons.
 *
 * It is deliberately made of numbers and booleans (not Phaser objects) so that edge detection can
 * be unit-tested and so the caller can store it as ordinary state between frames.
 */
export interface NavInputState {
  /** Axis values, index 0 = left stick X, index 1 = left stick Y. */
  axes: number[];
  /** Button pressed flags by index. */
  buttons: boolean[];
}

/** Reads the current axes/buttons of a pad into a plain snapshot. */
export function gamepadStateOf(pad: Phaser.Input.Gamepad.Gamepad): NavInputState {
  const axes: number[] = [];
  for (let i = 0; i < pad.axes.length; i++) {
    const axis = pad.axes[i];
    // `Axis#getValue()` applies the axis' own threshold; fall back to the raw value defensively.
    axes.push(typeof axis?.getValue === 'function' ? axis.getValue() : Number(axis?.value ?? 0));
  }

  const buttons: boolean[] = [];
  for (let i = 0; i < pad.buttons.length; i++) {
    buttons.push(pad.buttons[i]?.pressed === true);
  }

  return { axes, buttons };
}

/**
 * Directions currently held, derived from a state snapshot: D-Pad buttons plus the left stick.
 *
 * Both the current and the previous snapshot go through this function, which is what makes edge
 * detection work for stick input (whose "held" flag is a level, not an event).
 */
export function heldDirectionsOf(state: NavInputState): NavDirection[] {
  const held = new Set<NavDirection>();

  for (const [index, direction] of DPAD_BUTTONS) {
    if (state.buttons[index] === true) {
      held.add(direction);
    }
  }

  const x = state.axes[0] ?? 0;
  const y = state.axes[1] ?? 0;
  if (y <= -GAMEPAD_AXIS_THRESHOLD) {
    held.add('up');
  }
  if (y >= GAMEPAD_AXIS_THRESHOLD) {
    held.add('down');
  }
  if (x <= -GAMEPAD_AXIS_THRESHOLD) {
    held.add('left');
  }
  if (x >= GAMEPAD_AXIS_THRESHOLD) {
    held.add('right');
  }

  return NAV_DIRECTIONS.filter((direction) => held.has(direction));
}

/**
 * Maps a pad onto navigation actions, edge-triggered.
 *
 * Only transitions from "not pressed" to "pressed" produce an action, so holding a D-Pad direction
 * yields exactly one action and auto-repeat is left to `NavRepeat` (feed it
 * `heldDirectionsOf(state)`). `previous` is the state returned by the previous call — the caller
 * stores it, this function keeps no memory of its own.
 */
export function gamepadActionsOf(
  pad: Phaser.Input.Gamepad.Gamepad,
  previous: NavInputState,
): { actions: NavAction[]; state: NavInputState } {
  const state = gamepadStateOf(pad);
  const held = heldDirectionsOf(state);
  const wasHeld = heldDirectionsOf(previous);

  const actions: NavAction[] = [];
  for (const direction of held) {
    if (!wasHeld.includes(direction)) {
      actions.push(direction);
    }
  }

  if (state.buttons[GAMEPAD_BUTTON_ACTIVATE] === true) {
    if (previous.buttons[GAMEPAD_BUTTON_ACTIVATE] !== true) {
      actions.push('activate');
    }
  }
  if (state.buttons[GAMEPAD_BUTTON_BACK] === true) {
    if (previous.buttons[GAMEPAD_BUTTON_BACK] !== true) {
      actions.push('back');
    }
  }

  return { actions, state };
}
