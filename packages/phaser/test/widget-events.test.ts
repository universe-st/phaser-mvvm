/**
 * `widget:focus` / `widget:blur` — the per-widget focus events added in round 110.
 *
 * This file is also the first consumer of `test/support/fake-renderer.ts`, the Node-side fixture that
 * makes **real** `Widget` instances constructible in CI. Until it existed, everything on the
 * `Widget` side of the Phaser boundary (the event vocabulary, teardown, focus plumbing) could only be
 * checked in a browser: `Widget` extends `Phaser.GameObjects.Container`, and importing Phaser in Node
 * threw `window is not defined` (DEFECT-BACKLOG §4).
 *
 * Order matters and is load-bearing: `installDomStub()` must run **before** Phaser is imported, and
 * ESM hoists static imports — hence the dynamic `await import('../src/Widget')` below. The fixture
 * module itself imports nothing from Phaser.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { asScene, createFakeScene, installDomStub, type FakeScene } from './support/fake-renderer';

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

/** A scene plus the container the focus manager is attached to. */
function stage(): { scene: FakeScene; root: InstanceType<WidgetModule['Widget']> } {
  const scene = createFakeScene();
  return { scene, root: new WidgetClass(asScene(scene)) };
}

/** One focusable leaf, added to `root` as a real widget-tree child. */
function leaf(root: InstanceType<WidgetModule['Widget']>, name: string) {
  const widget = new WidgetClass(asScene(createFakeScene()), { name });
  widget.focusable = true;
  root.addWidget(widget);
  return widget;
}

describe('the focus/blur event vocabulary', () => {
  it('announces focus and blur once each, whatever asks for them', () => {
    const { root } = stage();
    const manager = new FocusManagerClass({ root });
    const first = leaf(root, 'first');
    const second = leaf(root, 'second');
    manager.refresh();

    const log: string[] = [];
    first.on(WIDGET_EVENTS.FOCUS, () => log.push('first:focus'));
    first.on(WIDGET_EVENTS.BLUR, () => log.push('first:blur'));
    second.on(WIDGET_EVENTS.FOCUS, () => log.push('second:focus'));

    first.focus();
    expect(log).toEqual(['first:focus']);
    expect(first.focused).toBe(true);

    second.focus();
    // Moving focus is a pair, and the order is "the old owner is told first": a form that validates on
    // blur may not see the new owner yet, but it always sees its own departure before the arrival.
    expect(log).toEqual(['first:focus', 'first:blur', 'second:focus']);
  });

  it('stays silent when focus is set to the value it already has', () => {
    const { root } = stage();
    const manager = new FocusManagerClass({ root });
    const widget = leaf(root, 'only');
    manager.refresh();

    let events = 0;
    widget.on(WIDGET_EVENTS.FOCUS, () => events++);
    widget.on(WIDGET_EVENTS.BLUR, () => events++);

    widget.focus();
    widget.focus();
    expect(events).toBe(1);

    widget.blur();
    widget.blur();
    expect(events).toBe(2);
  });

  it('does not blur a widget that is destroyed while focused', () => {
    const { root } = stage();
    const manager = new FocusManagerClass({ root });
    const widget = leaf(root, 'doomed');
    manager.refresh();

    let blurred = 0;
    widget.on(WIDGET_EVENTS.BLUR, () => blurred++);
    widget.focus();
    expect(widget.focused).toBe(true);

    widget.destroy();
    // A listener that ran during teardown would be handed a half-dismantled object; `destroy()` clears
    // the flag directly instead of routing through `setFocusedInternal`.
    expect(blurred).toBe(0);
  });

  it('blurs the widget that leaves the focusable set while it holds focus', () => {
    const { root } = stage();
    const manager = new FocusManagerClass({ root });
    const widget = leaf(root, 'vanishing');
    manager.refresh();

    const log: string[] = [];
    widget.on(WIDGET_EVENTS.BLUR, () => log.push('blur'));
    widget.focus();
    expect(widget.focused).toBe(true);

    // `refresh()` re-collects the scope; a widget that is no longer focusable must be released, and
    // "released" has to be observable from outside — that is what the event is for (guide 07 §5).
    widget.setVisible(false);
    manager.refresh();
    expect(log).toEqual(['blur']);
    expect(manager.focusedWidget).toBeNull();
  });
});
