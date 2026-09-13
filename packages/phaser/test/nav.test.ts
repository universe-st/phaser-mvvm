/**
 * Tests for `nav.ts`: the hold-to-repeat state machine, the keyboard mapper and the gamepad mapper.
 *
 * Time is injected (`NavRepeat.update(held, now)`), the gamepad is a plain fake exposing
 * `axes[i].getValue()` / `buttons[i].pressed`, and the keyboard event is a two-field object literal
 * — so none of these tests need a Phaser runtime, a DOM or a controller.
 */

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import type { NavAction, NavDirection, NavInputState, NavSourceHost } from '../src/nav';
import {
  GAMEPAD_BUTTON_ACTIVATE,
  GAMEPAD_BUTTON_BACK,
  NavRepeat,
  NavSourceRegistry,
  gamepadActionsOf,
  gamepadStateOf,
  heldDirectionsOf,
  keyboardActionOf,
} from '../src/nav';

/* ------------------------------------------------------------------ fakes */

function fakePad(axes: number[] = [], buttons: boolean[] = []): Phaser.Input.Gamepad.Gamepad {
  return {
    axes: axes.map((value) => ({ getValue: () => value })),
    buttons: buttons.map((pressed) => ({ pressed })),
  } as unknown as Phaser.Input.Gamepad.Gamepad;
}

/** A button list of `length` entries with the given indices pressed. */
function buttonsWith(length: number, ...pressed: number[]): boolean[] {
  const buttons = new Array<boolean>(length).fill(false);
  for (const index of pressed) {
    buttons[index] = true;
  }
  return buttons;
}

function key(key: string, shiftKey = false): KeyboardEvent {
  return { key, shiftKey } as KeyboardEvent;
}

const NOTHING_HELD: NavInputState = { axes: [], buttons: [] };

/* ------------------------------------------------------------------ NavRepeat */

describe('NavRepeat', () => {
  it('fires immediately on the first frame an action is held', () => {
    const repeat = new NavRepeat();

    expect(repeat.update(['down'], 0)).toEqual(['down']);
  });

  it('does not repeat before initialDelay has elapsed', () => {
    const repeat = new NavRepeat({ initialDelay: 350, repeatDelay: 90 });
    repeat.update(['down'], 0);

    expect(repeat.update(['down'], 100)).toEqual([]);
    expect(repeat.update(['down'], 349)).toEqual([]);
  });

  it('repeats at initialDelay and then every repeatDelay', () => {
    const repeat = new NavRepeat({ initialDelay: 350, repeatDelay: 90 });
    repeat.update(['down'], 0);

    expect(repeat.update(['down'], 350)).toEqual(['down']);
    expect(repeat.update(['down'], 439)).toEqual([]);
    expect(repeat.update(['down'], 440)).toEqual(['down']);
    expect(repeat.update(['down'], 530)).toEqual(['down']);
  });

  it('does not burst after a long pause', () => {
    const repeat = new NavRepeat({ initialDelay: 350, repeatDelay: 90 });
    repeat.update(['down'], 0);
    repeat.update(['down'], 350);

    // 10 seconds later the machine fires once and re-arms, instead of catching up 100 times.
    expect(repeat.update(['down'], 10_350)).toEqual(['down']);
    expect(repeat.update(['down'], 10_350)).toEqual([]);
  });

  it('resets on release, so the next press fires immediately', () => {
    const repeat = new NavRepeat();
    repeat.update(['down'], 0);
    repeat.update([], 100);

    expect(repeat.isHeld('down')).toBe(false);
    expect(repeat.update(['down'], 120)).toEqual(['down']);
  });

  it('treats a release and re-press in the same call as a fresh press', () => {
    const repeat = new NavRepeat();
    repeat.update(['down'], 0);
    repeat.update(['right'], 10);

    expect(repeat.update(['down'], 20)).toEqual(['down']);
  });

  it('tracks several held actions independently, in input order', () => {
    const repeat = new NavRepeat({ initialDelay: 50, repeatDelay: 50 });

    expect(repeat.update(['up', 'right'], 0)).toEqual(['up', 'right']);
    expect(repeat.update(['up', 'right'], 25)).toEqual([]);
    expect(repeat.update(['right'], 50)).toEqual(['right']);
    expect(repeat.heldActions).toEqual(['right']);
  });

  it('ignores duplicate entries in the held list', () => {
    const repeat = new NavRepeat();

    expect(repeat.update(['down', 'down'], 0)).toEqual(['down']);
    expect(repeat.update(['down', 'down'], 0)).toEqual([]);
  });

  it('supports a zero repeat delay', () => {
    const repeat = new NavRepeat({ initialDelay: 0, repeatDelay: 0 });

    expect(repeat.update(['activate'], 0)).toEqual(['activate']);
    expect(repeat.update(['activate'], 0)).toEqual(['activate']);
  });

  it('defaults to 350/90 and clamps bad input', () => {
    const defaults = new NavRepeat();
    const clamped = new NavRepeat({ initialDelay: -10, repeatDelay: Number.NaN });

    expect([defaults.initialDelay, defaults.repeatDelay]).toEqual([350, 90]);
    expect(clamped.initialDelay).toBe(0);
    expect(clamped.repeatDelay).toBe(90);
  });

  it('forgets everything on reset', () => {
    const repeat = new NavRepeat();
    repeat.update(['down'], 0);
    repeat.reset();

    expect(repeat.heldActions).toEqual([]);
    expect(repeat.update(['down'], 5)).toEqual(['down']);
  });
});

/* ------------------------------------------------------------------ keyboard */

describe('keyboardActionOf', () => {
  it('maps Tab to next and Shift+Tab to prev', () => {
    expect(keyboardActionOf(key('Tab'))).toBe('next');
    expect(keyboardActionOf(key('Tab', true))).toBe('prev');
  });

  it('maps the arrow keys', () => {
    expect(keyboardActionOf(key('ArrowUp'))).toBe('up');
    expect(keyboardActionOf(key('ArrowDown'))).toBe('down');
    expect(keyboardActionOf(key('ArrowLeft'))).toBe('left');
    expect(keyboardActionOf(key('ArrowRight'))).toBe('right');
  });

  it('maps Enter, Space and the legacy Spacebar value to activate', () => {
    expect(keyboardActionOf(key('Enter'))).toBe('activate');
    expect(keyboardActionOf(key(' '))).toBe('activate');
    expect(keyboardActionOf(key('Spacebar'))).toBe('activate');
  });

  it('maps Escape (and the legacy Esc) to back', () => {
    expect(keyboardActionOf(key('Escape'))).toBe('back');
    expect(keyboardActionOf(key('Esc'))).toBe('back');
  });

  it('returns null for keys the UI does not consume', () => {
    expect(keyboardActionOf(key('a'))).toBeNull();
    expect(keyboardActionOf(key('F5'))).toBeNull();
    expect(keyboardActionOf(key('Shift'))).toBeNull();
  });
});

/* ------------------------------------------------------------------ gamepad */

describe('gamepadStateOf / heldDirectionsOf', () => {
  it('reads axes and buttons into a plain snapshot', () => {
    const state = gamepadStateOf(fakePad([0.25, -0.75], buttonsWith(3, 1)));

    expect(state).toEqual({ axes: [0.25, -0.75], buttons: [false, true, false] });
  });

  it('treats the D-Pad buttons and the left stick as held directions', () => {
    expect(heldDirectionsOf({ axes: [], buttons: buttonsWith(16, 15) })).toEqual(['right']);
    expect(heldDirectionsOf({ axes: [0, 0], buttons: [] })).toEqual([]);
    expect(heldDirectionsOf({ axes: [-1, 0], buttons: [] })).toEqual(['left']);
    expect(heldDirectionsOf({ axes: [0, 1], buttons: [] })).toEqual(['down']);
    expect(heldDirectionsOf({ axes: [0, -1], buttons: [] })).toEqual(['up']);
  });

  it('applies the 0.5 dead zone to the stick', () => {
    expect(heldDirectionsOf({ axes: [0.4, -0.49], buttons: [] })).toEqual([]);
    expect(heldDirectionsOf({ axes: [0.5, -0.5], buttons: [] })).toEqual(['up', 'right']);
  });

  it('reports a diagonal push in a fixed order', () => {
    expect(heldDirectionsOf({ axes: [1, 1], buttons: [] })).toEqual(['down', 'right']);
  });
});

describe('gamepadActionsOf', () => {
  it('emits a direction once, on the edge', () => {
    const pad = fakePad([0, 0], buttonsWith(16, 13));

    const first = gamepadActionsOf(pad, NOTHING_HELD);
    expect(first.actions).toEqual(['down']);
    expect(first.state.buttons[13]).toBe(true);

    const second = gamepadActionsOf(pad, first.state);
    expect(second.actions).toEqual([]);

    const released = gamepadActionsOf(fakePad([0, 0], buttonsWith(16)), second.state);
    expect(released.actions).toEqual([]);
    expect(released.state.buttons[13]).toBe(false);
  });

  it('emits a stick direction on the edge only, at both signs', () => {
    const pressed = gamepadActionsOf(fakePad([-0.9, 0]), NOTHING_HELD);
    expect(pressed.actions).toEqual(['left']);

    const held = gamepadActionsOf(fakePad([-0.9, 0]), pressed.state);
    expect(held.actions).toEqual([]);

    const reversed = gamepadActionsOf(fakePad([0.9, 0]), held.state);
    expect(reversed.actions).toEqual(['right']);
  });

  it('emits nothing below the stick threshold', () => {
    const below = gamepadActionsOf(fakePad([0.49, 0.49]), NOTHING_HELD);

    expect(below.actions).toEqual([]);
  });

  it('maps buttons[0] to activate and buttons[1] to back, edge-triggered', () => {
    const both = buttonsWith(2, GAMEPAD_BUTTON_ACTIVATE, GAMEPAD_BUTTON_BACK);
    const pressed = gamepadActionsOf(fakePad([], both), NOTHING_HELD);

    expect(pressed.actions).toEqual(['activate', 'back']);

    const stillPressed = gamepadActionsOf(fakePad([], both), pressed.state);
    expect(stillPressed.actions).toEqual([]);
  });

  it('deduplicates a direction held by both the D-Pad and the stick', () => {
    const pad = fakePad([1, 0], buttonsWith(16, 15));
    const result = gamepadActionsOf(pad, NOTHING_HELD);

    expect(result.actions).toEqual(['right']);
  });

  it('keeps the previous state untouched (the caller owns it)', () => {
    const previous: NavInputState = { axes: [0, 0], buttons: buttonsWith(16) };
    const snapshot = { axes: [...previous.axes], buttons: [...previous.buttons] };

    gamepadActionsOf(fakePad([1, 1], buttonsWith(16, 0)), previous);

    expect(previous).toEqual(snapshot);
  });

  it('returns the state the caller must pass back next frame', () => {
    const result = gamepadActionsOf(fakePad([0.75, -0.25], buttonsWith(1, 0)), NOTHING_HELD);

    expect(result.state.axes).toEqual([0.75, -0.25]);
    expect(result.state.buttons).toEqual([true]);
  });
});

/* ------------------------------------------------------------------ vocabulary sanity */

describe('NavAction usage', () => {
  it('uses plain strings, so hosts can log and compare them', () => {
    const action: NavAction = 'next';

    expect(action).toBe('next');
  });
});

/**
 * `NavSourceRegistry` — the named navigation-source abstraction (PLAN §6, M9's last open item).
 *
 * Before round 110 the plugin hard-coded two devices and no API existed for a third. The registry is
 * where "which devices, attached how, repeating at whose timing" now lives, and it is Phaser-free, so
 * every rule below is pinned in Node against a fake host:
 *
 * - a source is attached on `add` and detached on `remove`/`detachAll`/`clear`,
 * - `poll` reports edge actions before the held directions, and each source keeps its **own** repeat
 *   clock (a pad's 350 ms delay must not be restarted by the keyboard),
 * - the action carries the attribution of the source that produced it.
 */
describe('NavSourceRegistry', () => {
  function fakeHost(): {
    host: NavSourceHost;
    dispatched: Array<{ action: NavAction; source: string }>;
  } {
    const dispatched: Array<{ action: NavAction; source: string }> = [];
    const host: NavSourceHost = {
      scene: undefined as unknown as Phaser.Scene,
      now: () => 0,
      handleKeyEvent: () => false,
      dispatch: (action, source) => {
        dispatched.push({ action, source });
        return true;
      },
    };
    return { host, dispatched };
  }

  /** A source whose held directions and edge actions the test drives directly. */
  function scriptedSource(name: string, source: 'keyboard' | 'gamepad' | 'touch') {
    const calls: string[] = [];
    return {
      calls,
      name,
      source,
      held: [] as NavDirection[],
      edges: [] as NavAction[],
      attach: () => {
        calls.push('attach');
        return () => calls.push('detach');
      },
      poll(host: NavSourceHost) {
        for (const action of this.edges.splice(0)) {
          host.dispatch(action, this.source);
        }
      },
      heldDirections() {
        return this.held;
      },
    };
  }

  it('attaches on add and detaches on remove', () => {
    const { host } = fakeHost();
    const registry = new NavSourceRegistry();
    const source = scriptedSource('pad-2', 'gamepad');

    registry.add(source, host);
    expect(source.calls).toEqual(['attach']);
    expect(registry.names).toEqual(['pad-2']);
    expect(registry.has('pad-2')).toBe(true);

    expect(registry.remove('pad-2')).toBe(true);
    expect(source.calls).toEqual(['attach', 'detach']);
    expect(registry.remove('pad-2')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('refuses two sources under one name', () => {
    const { host } = fakeHost();
    const registry = new NavSourceRegistry();
    registry.add(scriptedSource('dup', 'keyboard'), host);
    expect(() => registry.add(scriptedSource('dup', 'gamepad'), host)).toThrow(
      /already registered/,
    );
  });

  it('reports edge actions first, then the held directions, both attributed to their source', () => {
    const { host, dispatched } = fakeHost();
    const registry = new NavSourceRegistry();
    const pad = scriptedSource('pad', 'gamepad') as ReturnType<typeof scriptedSource> & {
      held: NavDirection[];
      edges: NavAction[];
    };
    pad.edges.push('activate');
    pad.held.push('down');
    registry.add(pad, host);

    expect(registry.poll(host, 0)).toEqual([{ action: 'down', source: 'gamepad' }]);
    expect(dispatched).toEqual([{ action: 'activate', source: 'gamepad' }]);
  });

  it('gives every source its own repeat clock', () => {
    const { host } = fakeHost();
    const registry = new NavSourceRegistry();
    const pad = scriptedSource('pad', 'gamepad');
    const stick = scriptedSource('stick', 'touch');
    pad.held.push('down');
    stick.held.push('down');
    registry.add(pad, host);
    registry.add(stick, host);

    // First frame: both fire immediately.
    expect(registry.poll(host, 0).map((entry) => entry.source)).toEqual(['gamepad', 'touch']);
    // Second frame at 400 ms: both repeat (initialDelay 350), each on its own clock.
    expect(registry.poll(host, 400).map((entry) => entry.source)).toEqual(['gamepad', 'touch']);
    // Third frame at 420 ms: neither does.
    expect(registry.poll(host, 420)).toEqual([]);

    // Releasing only the pad resets only the pad: its next press fires immediately again, while the
    // stick is still waiting for its own next repeat (scheduled at 490, so 481 must not fire it).
    pad.held.length = 0;
    registry.poll(host, 480);
    pad.held.push('down');
    expect(registry.poll(host, 481).map((entry) => entry.source)).toEqual(['gamepad']);
    expect(registry.poll(host, 490).map((entry) => entry.source)).toEqual(['touch']);
  });

  it('detachAll stops delivery without forgetting the registrations, and attachAll restores it', () => {
    const { host } = fakeHost();
    const registry = new NavSourceRegistry();
    const source = scriptedSource('pad', 'gamepad');
    source.held.push('down');
    registry.add(source, host);

    registry.detachAll();
    expect(registry.names).toEqual(['pad']);
    expect(source.calls).toEqual(['attach', 'detach']);
    // A detached source is still polled (its device may be gone), but its repeat clock was reset —
    // this is what makes `configure({ navigation: false })` → `true` start from a clean state.
    registry.attachAll(host);
    expect(source.calls).toEqual(['attach', 'detach', 'attach']);
    expect(registry.poll(host, 0).map((entry) => entry.action)).toEqual(['down']);

    registry.clear();
    expect(registry.names).toEqual([]);
    expect(source.calls).toEqual(['attach', 'detach', 'attach', 'detach']);
  });

  it('uses detach() when attach() returns nothing', () => {
    const { host } = fakeHost();
    const registry = new NavSourceRegistry();
    const calls: string[] = [];
    registry.add(
      {
        name: 'timer-driven',
        source: 'touch',
        attach: () => {
          calls.push('attach');
        },
        detach: () => calls.push('detach'),
      },
      host,
    );
    registry.detachAll();
    expect(calls).toEqual(['attach', 'detach']);
  });
});
