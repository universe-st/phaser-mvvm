/**
 * Focus is not the same thing as *visible* focus.
 *
 * The framework follows CSS `:focus-visible`: a pointer press focuses the control it landed on (round
 * 68 fixed the opposite — DEFECT-BACKLOG P2, "the next `Tab` restarted from the first focusable"), but
 * it must not leave a ring around it, because the click already told the user what happened. A `Tab`,
 * D-Pad or programmatic focus draws the ring, which is the only clue about where `Enter` will land.
 *
 * `Widget#focused` is deliberately weakened by none of this: traversal, activation, the accessibility
 * mirror and `visualState` all still report the widget as focused. The split shows up in exactly two
 * readings — `Widget#focusVisible` (does it paint the ring) and `FocusManager#ring` (may anyone) — and
 * this file pins both, on **real** `Widget`/`FocusManager` instances via `test/support/fake-renderer.ts`
 * (see the header of `widget-events.test.ts` for why the stubs have to be installed before Phaser is
 * imported).
 */

import { beforeAll, describe, expect, it } from 'vitest';
// Type-only, so it is erased before the stubs matter (see the header of `widget-events.test.ts`).
import type { FocusManagerOptions } from '../src/focus';
import { asScene, createFakeScene, installDomStub } from './support/fake-renderer';

installDomStub();

type WidgetModule = typeof import('../src/Widget');
type FocusModule = typeof import('../src/focus');

let WIDGET_EVENTS: WidgetModule['WIDGET_EVENTS'];
let WidgetClass: WidgetModule['Widget'];
let FocusManagerClass: FocusModule['FocusManager'];

beforeAll(async () => {
  const widgetModule = await import('../src/Widget');
  const focusModule = await import('../src/focus');
  WIDGET_EVENTS = widgetModule.WIDGET_EVENTS;
  WidgetClass = widgetModule.Widget;
  FocusManagerClass = focusModule.FocusManager;
});

/** A scene, a root, and a manager attached to it — the shape every case below starts from. */
function stage(options: FocusManagerOptions = {}) {
  const scene = createFakeScene();
  const root = new WidgetClass(asScene(scene));
  const manager = new FocusManagerClass({ root, ...options });
  return { scene, root, manager };
}

/** One focusable leaf under `root`; `name` shows up in failures, nothing else uses it. */
function leaf(root: InstanceType<WidgetModule['Widget']>, name: string) {
  const widget = new WidgetClass(asScene(createFakeScene()), { name });
  widget.focusable = true;
  root.addWidget(widget);
  return widget;
}

describe('a pointer press focuses without lighting the control up', () => {
  it('reports focused=true with the ring off', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    manager.focus(button, { pointer: true });

    // Both halves matter: a press that did not focus at all would be the P2 regression, and a press
    // that focused *and* rang would be the frame the user complained about.
    expect(button.focused).toBe(true);
    expect(button.focusVisible).toBe(false);
    expect(manager.focusedWidget).toBe(button);
  });

  it('lights up widgets that opt in, which is the text-field rule', () => {
    const { root, manager } = stage();
    const field = leaf(root, 'field');
    field.focusRingOnPointer = true;
    manager.refresh();

    manager.focus(field, { pointer: true });

    expect(field.focused).toBe(true);
    expect(field.focusVisible).toBe(true);
  });

  it('still lights up for a Tab walk and for programmatic focus', () => {
    const { root, manager } = stage();
    const first = leaf(root, 'first');
    const second = leaf(root, 'second');
    manager.refresh();

    manager.next();
    expect([first.focused, first.focusVisible]).toEqual([true, true]);

    second.focus();
    expect([second.focused, second.focusVisible]).toEqual([true, true]);
  });

  it('drops both on blur', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    button.focus();
    button.blur();

    expect(button.focused).toBe(false);
    expect(button.focusVisible).toBe(false);
  });
});

describe('the global ring gate', () => {
  it('suppresses the ring without touching focus', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    button.focus();
    expect(button.focusVisible).toBe(true);

    manager.ring = false;

    // The widget that is focused right now is re-applied, not just the next one: V79 was exactly the
    // opposite (`focus.ring` was stored and never read by anything).
    expect(button.focused).toBe(true);
    expect(button.focusVisible).toBe(false);
    expect(manager.focusedWidget).toBe(button);
  });

  it('gives the ring back when the gate is switched on again', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    manager.ring = false;
    button.focus();
    expect(button.focusVisible).toBe(false);

    manager.ring = true;
    expect(button.focusVisible).toBe(true);
  });

  it('does not invent a ring for a press when it is switched back on', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    manager.ring = false;
    manager.focus(button, { pointer: true });

    manager.ring = true;

    // The press asked for a plain focus and the manager remembers that, so flipping the global flag
    // cannot resurrect a ring the user never earned.
    expect(button.focused).toBe(true);
    expect(button.focusVisible).toBe(false);
  });

  it('accepts the option at construction', () => {
    const { root, manager } = stage({ ring: false });
    const button = leaf(root, 'button');
    manager.refresh();

    button.focus();

    expect(manager.ring).toBe(false);
    expect(button.focusVisible).toBe(false);
  });
});

describe('a visibility change is not a focus change', () => {
  it('repaints without re-announcing focus', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    const log: string[] = [];
    button.on(WIDGET_EVENTS.FOCUS, () => log.push('focus'));
    button.on(WIDGET_EVENTS.BLUR, () => log.push('blur'));

    button.focus();
    manager.ring = false;
    manager.ring = true;

    // Round 110's lesson (`widget:state` fired twice per click) applies to every event that promises a
    // *change*: the ring flickered off and on, and the widget never stopped being focused.
    expect(log).toEqual(['focus']);
    expect(button.focusVisible).toBe(true);
  });

  it('emits nothing when focus is re-set with the same visibility', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();

    let events = 0;
    button.on(WIDGET_EVENTS.FOCUS, () => events++);
    button.on(WIDGET_EVENTS.BLUR, () => events++);

    button.focus();
    manager.ring = false;
    // `ring` was already `false` twice over: the setter's own equality guard has to hold, or every
    // `configure()` patch would repaint the whole focused subtree.
    manager.ring = false;

    expect(events).toBe(1);
  });

  it('leaves a destroyed widget with neither flag set', () => {
    const { root, manager } = stage();
    const button = leaf(root, 'button');
    manager.refresh();
    button.focus();

    button.destroy();

    // `destroy()` clears the flags directly; leaving `_focusVisible` behind would make a later poke from
    // the router look like a real transition and repaint released `Graphics` (the same trap the
    // `_focused`/`_hovered` clears were added for).
    expect(button.focused).toBe(false);
    expect(button.focusVisible).toBe(false);
  });
});
