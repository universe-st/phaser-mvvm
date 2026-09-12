/**
 * A **fake gamepad** for acceptance runs.
 *
 * Chromium's DevTools protocol has no gamepad input domain, so a real pad cannot be simulated from the
 * outside. Phaser reads pads through `navigator.getGamepads()` on every frame
 * (`GamepadPlugin#refreshPads`), so replacing that one function with a mutable fake is enough to drive
 * the whole path: Phaser wraps it in its own `Gamepad` (`Gamepad#update` syncs buttons/axes when the
 * fake's `timestamp` grows), and the plugin's poll then maps it like any real pad.
 *
 * Installed once by `main.ts` and exposed as `window.fakePad`, so any scene can be driven without
 * hardware:
 *
 * ```js
 * window.fakePad.button(0, true);   // press A/×
 * window.fakePad.button(0, false);  // release
 * window.fakePad.axis(0, 0.8);      // push the stick half right, and hold it
 * window.fakePad.clear();           // everything back to neutral
 * window.fakePad.pads();            // what Phaser's GamepadPlugin has stored
 * ```
 */

interface FakeButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

interface FakePad {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  timestamp: number;
  axes: number[];
  buttons: FakeButton[];
}

const BUTTON_COUNT = 17;

/** The API installed on `window.fakePad`. */
export interface FakePadApi {
  /** `true` while the fake answers `navigator.getGamepads()`. */
  installed: () => boolean;
  /** How many pads Phaser's `GamepadPlugin` currently holds (0 when gamepad input is off). */
  pads: () => number;
  /** Connected state of the pad Phaser holds, or `null`. */
  pad: () => {
    id: string;
    index: number;
    connected: boolean;
    buttons: number;
    axes: number;
  } | null;
  /** Presses (`true`) or releases (`false`) one button. */
  button: (index: number, down: boolean) => void;
  /** Presses every button in `indexes` and releases the rest (D-Pad chords). */
  buttons: (indexes: readonly number[]) => void;
  /** Sets one axis (`0` = left X, `1` = left Y). */
  axis: (index: number, value: number) => void;
  /** Pushes the left stick in a direction by `value` (default ±0.8). */
  stick: (direction: 'up' | 'down' | 'left' | 'right', value?: number) => void;
  /** Returns every input to neutral. */
  clear: () => void;
}

/** D-Pad indices of the standard mapping, mirrored from `packages/phaser/src/nav.ts`. */
export const FAKE_DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;
/** Face buttons: A/× activates, B/○ goes back (same indices the framework maps). */
export const FAKE_FACE = { activate: 0, back: 1 } as const;

/**
 * The **active** scene's gamepad plugin.
 *
 * `game.scene.scenes` holds every registered scene (all 16 demos are added at boot), so `scenes[0]`
 * is `m0` — a scene that is not running and therefore has no pads. Querying it made `pads()` report 0
 * while the framework was happily reading the pad from the active scene.
 */
function gamepadPlugin(): { getAll(): unknown[]; getPad(index: number): unknown } | null {
  const manager = (window as unknown as { game?: Phaser.Game }).game?.scene;
  const scene = manager?.getScenes(true)[0];
  const plugin = (scene?.input as unknown as { gamepad?: unknown } | undefined)?.gamepad;
  return (plugin as { getAll(): unknown[]; getPad(index: number): unknown } | undefined) ?? null;
}

function createFakePad(): FakePad {
  return {
    id: 'phaser-mvvm fake pad (standard)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: BUTTON_COUNT }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    })),
  };
}

/**
 * Installs the fake pad. Safe to call twice: the same pad object is reused, so a page reload or a
 * scene restart keeps whatever the check set up.
 */
export function installFakePad(): FakePadApi {
  const pad = (existing ?? createFakePad()) as FakePad;
  existing = pad;

  const gamepads = (): FakePad[] => [pad];
  Object.defineProperty(navigator, 'getGamepads', {
    value: gamepads,
    configurable: true,
    writable: true,
  });

  const touch = (): void => {
    // Phaser's `Gamepad#update` ignores a pad whose `timestamp` did not move on.
    pad.timestamp = performance.now();
  };

  const api: FakePadApi = {
    installed: () => (navigator.getGamepads as unknown) === (gamepads as unknown),
    pads: () => gamepadPlugin()?.getAll().length ?? 0,
    pad: () => {
      const live = gamepadPlugin()?.getPad(0) as
        | { id: string; index: number; connected: boolean; buttons: unknown[]; axes: unknown[] }
        | undefined;
      if (!live) {
        return null;
      }
      return {
        id: live.id,
        index: live.index,
        connected: live.connected,
        buttons: live.buttons.length,
        axes: live.axes.length,
      };
    },
    button: (index, down) => {
      const button = pad.buttons[index];
      if (!button) {
        return;
      }
      button.pressed = down;
      button.touched = down;
      button.value = down ? 1 : 0;
      touch();
    },
    buttons: (indexes) => {
      const wanted = new Set(indexes);
      for (let index = 0; index < pad.buttons.length; index++) {
        const down = wanted.has(index);
        const button = pad.buttons[index] as FakeButton;
        button.pressed = down;
        button.touched = down;
        button.value = down ? 1 : 0;
      }
      touch();
    },
    axis: (index, value) => {
      pad.axes[index] = value;
      touch();
    },
    stick: (direction, value = 0.8) => {
      pad.axes[0] = direction === 'left' ? -value : direction === 'right' ? value : 0;
      pad.axes[1] = direction === 'up' ? -value : direction === 'down' ? value : 0;
      touch();
    },
    clear: () => {
      for (const button of pad.buttons) {
        button.pressed = false;
        button.touched = false;
        button.value = 0;
      }
      pad.axes = [0, 0, 0, 0];
      touch();
    },
  };

  (window as unknown as { fakePad?: FakePadApi }).fakePad = api;
  return api;
}

/** The pad object survives repeated `installFakePad()` calls within one page load. */
let existing: FakePad | null = null;
