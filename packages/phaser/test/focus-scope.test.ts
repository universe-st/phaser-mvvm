/**
 * Focus-scope tests: the stack `FocusManager` now keeps, which is what lets a modal dialog trap
 * focus without a second manager.
 *
 * `FocusManager` talks to widgets through a handful of members (`focusable`/`focusOrder`/`children`
 * for collection, `setFocusedInternal` for the ring, `appliedRect` for directional navigation), so
 * these tests build a small fake with exactly those members and run the real class. No Phaser scene,
 * no renderer — the behaviour under test is "which widget holds focus after this key", which is pure
 * bookkeeping and belongs in CI.
 */

import { describe, expect, it } from 'vitest';
import { FocusManager } from '../src/focus';
import type { Widget } from '../src/Widget';

/* ------------------------------------------------------------------ fakes */

class FakeWidget {
  readonly children: FakeWidget[] = [];
  inFlow = true;
  visible = true;
  enabled = true;
  focusable = true;
  focusOrder = 0;
  /** Mirrors `Widget#focusRingOnPointer`: a press asks for no ring unless the control opts in. */
  focusRingOnPointer = false;
  focusManager: unknown = null;
  isDestroyed = false;
  focused = false;
  /** Mirrors `Widget#focusVisible`: what the ring paints behind, as opposed to `focused`. */
  focusVisible = false;
  appliedRect = { x: 0, y: 0, width: 100, height: 20 };
  x = 0;
  y = 0;
  parentContainer: FakeWidget | null = null;

  constructor(readonly name: string) {}

  setFocusedInternal(value: boolean, focusVisible = true): void {
    this.focused = value;
    this.focusVisible = value && focusVisible;
  }

  /** Adds a child that takes part in layout and focus collection. */
  add(child: FakeWidget): FakeWidget {
    child.parentContainer = this;
    this.children.push(child);
    return child;
  }

  /** Places the widget (and everything below it) at a stage position. */
  at(x: number, y: number): FakeWidget {
    this.x = x;
    this.y = y;
    this.appliedRect = { ...this.appliedRect, x, y };
    return this;
  }
}

function widget(name: string): FakeWidget {
  return new FakeWidget(name);
}

/** `FocusManager` is typed against `Widget`; the fakes satisfy everything it actually touches. */
function asWidget(value: FakeWidget): Widget {
  return value as unknown as Widget;
}

function names(widgets: readonly Widget[]): string[] {
  return widgets.map((entry) => (entry as unknown as FakeWidget).name);
}

function manager(root: FakeWidget, options: { trap?: boolean; wrap?: boolean } = {}): FocusManager {
  return new FocusManager({
    root: asWidget(root),
    ...(options.trap === undefined ? {} : { trapFocus: options.trap }),
    ...(options.wrap === undefined ? {} : { wrap: options.wrap }),
  });
}

/* ------------------------------------------------------------------ tests */

describe('FocusManager · the base scope behaves as before', () => {
  it('collects the page and walks it with Tab', () => {
    const first = widget('first');
    const second = widget('second');
    const page = widget('page');
    page.focusable = false;
    page.add(first).add(second);

    const focus = manager(page);

    expect(names(focus.focusables)).toEqual(['first', 'second']);
    expect(focus.scopeDepth).toBe(1);

    focus.next();
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('first');
    focus.next();
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('second');
    focus.next();
    // `wrap` defaults to true, so Tab comes back around.
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('first');
  });

  it('stops at the end when `wrap` is false and nothing is trapped', () => {
    const first = widget('first');
    const second = widget('second');
    const page = widget('page');
    page.focusable = false;
    page.add(first).add(second);

    const focus = manager(page, { wrap: false });
    focus.next();
    focus.next();
    expect(focus.next()).toBe(false);
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('second');
  });
});

describe('FocusManager · pushScope traps focus', () => {
  it('walks the modal only, and ignores a page widget asked to focus itself', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const cancel = widget('cancel');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok).add(cancel);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));

    focus.pushScope(asWidget(dialog), { trap: true });

    expect(focus.scopeDepth).toBe(2);
    expect(focus.root).toBe(asWidget(dialog));
    expect(names(focus.focusables)).toEqual(['ok', 'cancel']);

    // The page's button is not in the live collection, so nothing happens — the trap.
    focus.focus(asWidget(pageButton));
    expect(focus.focusedWidget).toBeNull();

    focus.next();
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('ok');
    focus.next();
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('cancel');
    focus.next();
    // `trap` implies wrapping: Tab cannot leave the dialog.
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('ok');
  });

  it('drops the ring of the page but remembers what it was', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));
    expect(pageButton.focused).toBe(true);

    focus.pushScope(asWidget(dialog), { trap: true });

    // Exactly one widget in the tree looks focused: the dialog's, once it takes focus.
    expect(pageButton.focused).toBe(false);
    expect(ok.focused).toBe(false);

    focus.next();
    expect(ok.focused).toBe(true);
    expect(pageButton.focused).toBe(false);
  });

  it('`focusFirst` enters the dialog immediately, the way a dialog should', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    expect(ok.focused).toBe(true);
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('ok');
  });

  it('geometric navigation stays inside the modal', () => {
    const pageButton = widget('pageButton').at(0, 400);
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const top = widget('top').at(0, 100);
    const bottom = widget('bottom').at(0, 200);
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(top).add(bottom);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    expect(focus.move('down')).toBe(true);
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('bottom');
    // Nothing below the dialog to reach, even though the page has a widget further down.
    expect(focus.move('down')).toBe(false);
  });

  it('refuses `blur()` while trapped, allows it on an untrapped scope', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.next();
    focus.blur(asWidget(pageButton));
    expect(focus.focusedWidget).toBeNull();

    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });
    focus.blur(asWidget(ok));
    expect(focus.focusedWidget).toBe(asWidget(ok));

    focus.popScope();
    focus.pushScope(asWidget(dialog), { focusFirst: true });
    focus.blur(asWidget(ok));
    expect(focus.focusedWidget).toBeNull();
  });
});

describe('FocusManager · popScope restores the page', () => {
  it('hands focus back to the widget that had it, ring included', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    expect(focus.popScope()).toBe(true);
    expect(focus.scopeDepth).toBe(1);
    expect((focus.focusedWidget as unknown as FakeWidget).name).toBe('pageButton');
    expect(pageButton.focused).toBe(true);
    expect(ok.focused).toBe(false);
  });

  it('releases focus when the remembered widget is gone', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    const seen: Array<string | null> = [];
    focus.onFocusChange = (entry) =>
      seen.push(entry ? (entry as unknown as FakeWidget).name : null);

    focus.focus(asWidget(pageButton));
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    // The page rebuilt itself while the dialog was open.
    pageButton.isDestroyed = true;
    page.children.length = 0;

    focus.popScope();
    expect(focus.focusedWidget).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });

  it('nests: two dialogs deep unwinds one level at a time', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const firstOk = widget('firstOk');
    const first = widget('first');
    first.focusable = false;
    first.add(firstOk);

    const secondOk = widget('secondOk');
    const second = widget('second');
    second.focusable = false;
    second.add(secondOk);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));
    focus.pushScope(asWidget(first), { trap: true, focusFirst: true });
    focus.pushScope(asWidget(second), { trap: true, focusFirst: true });

    expect(focus.scopeDepth).toBe(3);
    expect(focus.focusedWidget).toBe(asWidget(secondOk));

    focus.popScope();
    expect(focus.scopeDepth).toBe(2);
    expect(focus.focusedWidget).toBe(asWidget(firstOk));
    expect(firstOk.focused).toBe(true);
    expect(secondOk.focused).toBe(false);

    focus.popScope();
    expect(focus.scopeDepth).toBe(1);
    expect(focus.focusedWidget).toBe(asWidget(pageButton));
    expect(pageButton.focused).toBe(true);
    expect(firstOk.focused).toBe(false);
  });

  it('returns false when there is nothing to pop', () => {
    const page = widget('page');
    const focus = new FocusManager();
    expect(focus.popScope()).toBe(false);
    expect(focus.scopeDepth).toBe(0);

    focus.attach(asWidget(page));
    focus.popScope();
    expect(focus.scopeDepth).toBe(0);
    expect(focus.root).toBeNull();
    expect(focus.focusables).toEqual([]);
  });
});

describe('FocusManager · refresh and detach across scopes', () => {
  it('refresh() only touches the scope in play', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.focus(asWidget(pageButton));
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    const late = widget('late');
    dialog.add(late);
    focus.refresh();

    expect(names(focus.focusables)).toEqual(['ok', 'late']);
    expect(focus.focusedWidget).toBe(asWidget(ok));

    // A widget added to the page waits for the page to become live again.
    const laterPageButton = widget('laterPageButton');
    page.add(laterPageButton);
    focus.refresh();
    expect(names(focus.focusables)).toEqual(['ok', 'late']);

    focus.popScope();
    expect(names(focus.focusables)).toEqual(['pageButton', 'laterPageButton']);
  });

  it('refresh() releases focus when the focused widget became unfocusable', () => {
    const button = widget('button');
    const page = widget('page');
    page.focusable = false;
    page.add(button);

    const focus = manager(page);
    const seen: Array<string | null> = [];
    focus.onFocusChange = (entry) =>
      seen.push(entry ? (entry as unknown as FakeWidget).name : null);

    focus.next();
    button.focusable = false;
    focus.refresh();

    expect(focus.focusedWidget).toBeNull();
    expect(button.focused).toBe(false);
    expect(seen.at(-1)).toBeNull();
  });

  it('detach() clears every scope and every ring', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.next();
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    focus.detach();

    expect(focus.scopeDepth).toBe(0);
    expect(focus.root).toBeNull();
    expect(focus.focusedWidget).toBeNull();
    expect(ok.focused).toBe(false);
    expect(pageButton.focused).toBe(false);
    expect(ok.focusManager).toBeNull();
    expect(pageButton.focusManager).toBeNull();
  });

  it('attach() drops a transient overlay scope on top of the page', () => {
    const pageButton = widget('pageButton');
    const page = widget('page');
    page.focusable = false;
    page.add(pageButton);

    const ok = widget('ok');
    const dialog = widget('dialog');
    dialog.focusable = false;
    dialog.add(ok);

    const focus = manager(page);
    focus.pushScope(asWidget(dialog), { trap: true, focusFirst: true });

    focus.attach(asWidget(page));
    expect(focus.scopeDepth).toBe(1);
    expect(focus.root).toBe(asWidget(page));
    expect(ok.focusManager).toBeNull();
    expect(pageButton.focusManager).toBe(focus);
  });
});
