/**
 * `A11yBridge` — a hidden DOM mirror of the interactive widgets, for screen readers (PLAN §1.2, §4.3).
 *
 * Canvas has no accessibility tree: a screen reader sees one opaque `<canvas>`. The Phase 1 scope is
 * therefore deliberately small and honest — **not** a WCAG claim, and not a second UI:
 *
 * - every widget that can be *acted on* (the focus manager's collection, which is exactly the set a
 *   keyboard user can reach) gets exactly **one** node in the computed accessibility tree, with
 *   `role`/name/state on it,
 * - **DOM focus follows framework focus** so the reader lands on the control that is focused, and app
 *   messages are announced through one `aria-live` region (which is also the fallback when DOM focus
 *   cannot be moved),
 * - the mirror lives in Phaser's DOM container (`dom.createContainer: true`), the same overlay the
 *   text-input bridge uses, and it is created and torn down with the plugin,
 * - the nodes carry `tabindex="-1"`: reachable for a screen reader, but **not** in the `Tab` order, so
 *   keyboard control still belongs to the framework (arrow keys, `Tab`, gamepad).
 *
 * Widgets describe themselves (`Widget#describeA11y`), because the adapter cannot know what a
 * `Button` or a `Slider` is — `packages/phaser` must not depend on the widget library. The descriptor is
 * re-read on every refresh (structure change), on every focus change, **and once per frame for the
 * focused widget** — a control whose value or validity changes without a focus move (a slider dragged
 * with the arrow keys, an error that appears on submit) must not be read as its old self. Writing is
 * change-checked, so an unchanged control costs no DOM work.
 *
 * A widget that already owns a DOM element (a text field's hidden `<input>`, see
 * `Widget#getA11yDomElement`) is **not** mirrored as a node: that element is the surface, and mirroring
 * it too exposed every field twice (round 76, V42).
 */

import { devLog, isDevMode, warn } from '@phaser-mvvm/core';
import type { MVVMPlugin } from './plugin';
import type { Widget } from './Widget';

/** The mirror node of one widget carries this attribute, plus `data-mvvm-a11y-name`. */
export const A11Y_ATTRIBUTE = 'data-mvvm-a11y';
/** The single live region (`aria-live`) the bridge announces through. */
export const A11Y_LIVE_ATTRIBUTE = 'data-mvvm-a11y-live';

/** What a widget tells the mirror about itself. */
export interface A11yDescriptor {
  /**
   * ARIA role: `button`, `checkbox`, `slider`, `textbox`, `region`, … (`string` so an app can use a
   * role the framework never produces).
   */
  role: string;
  /** Accessible name; falls back to the widget's `name` when omitted. */
  label?: string;
  /** Current value: the text of a field, the number of a slider, `'on'`/`'off'` for anything else. */
  value?: string | number;
  /** Slider range, when the role has one. */
  min?: number;
  max?: number;
  /** Toggle state (`aria-checked`), for `checkbox`-like roles. */
  checked?: boolean;
  /** `aria-disabled`; defaults to the widget's own `enabled` flag. */
  disabled?: boolean;
  /** `aria-invalid`, for a field whose validation failed. */
  invalid?: boolean;
  /** Extra sentence read after the label (`aria-description`). */
  hint?: string;
}

export interface A11yOptions {
  /** Whether the mirror is created and kept in sync. Defaults to `true`. */
  enabled?: boolean;
  /** Live-region politeness. Defaults to `'polite'` (queue, never interrupt). */
  politeness?: 'polite' | 'assertive';
  /** Overlay element to mount into; defaults to Phaser's `game.domContainer`. */
  container?: HTMLElement | null;
}

/** Nothing to mirror for this widget. */
export type A11yDescription = A11yDescriptor | null;

interface MirrorNode {
  readonly widget: Widget;
  readonly node: HTMLElement;
}

/** The "visually hidden, still in the accessibility tree" recipe (no `display: none`, no `opacity: 0`). */
const HIDDEN_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  border: '0',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

export class A11yBridge {
  private readonly plugin: MVVMPlugin;
  private readonly options: A11yOptions;
  private readonly nodes: MirrorNode[] = [];

  private root: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  private on = false;
  /** The widget whose surface currently holds DOM focus (see `focusChanged`). */
  private domFocused: Widget | null = null;
  /** Last applied signature per widget, so an unchanged control costs no DOM writes. */
  private readonly lastApplied = new Map<Widget, string>();

  constructor(plugin: MVVMPlugin, options: A11yOptions = {}) {
    this.plugin = plugin;
    this.options = options;
    this.on = options.enabled !== false;
  }

  /**
   * Live-region politeness; writing it updates the region in place.
   *
   * A game-wide `MVVMPlugin.configure({ a11y: { politeness: 'assertive' } })` has to reach a bridge that
   * was already created, so this is a property and not just a constructor option.
   */
  get politeness(): 'polite' | 'assertive' {
    return this.options.politeness ?? 'polite';
  }

  set politeness(value: 'polite' | 'assertive') {
    this.options.politeness = value;
    this.live?.setAttribute('aria-live', value);
  }

  /** Whether the mirror is currently in the DOM. */
  get enabled(): boolean {
    return this.on;
  }

  /** Turning it off removes the mirror from the DOM; turning it on rebuilds it from the tree. */
  set enabled(value: boolean) {
    if (value === this.on) {
      return;
    }
    this.on = value;
    if (value) {
      this.attach();
      // `attach()` only creates the container and the live region; the nodes come from `refresh()`,
      // which the plugin calls on a structure change. Without this call, turning the mirror back on left
      // it *mounted but empty* until something else changed the tree — a screen reader would find no
      // controls at all, while `container` and the `aria-live` region both looked right (V44).
      this.refresh();
    } else {
      this.detach();
    }
  }

  /** The mirror container (`null` while disabled or when the game has no DOM container). */
  get container(): HTMLElement | null {
    return this.root;
  }

  /** Number of mirrored widgets. */
  get count(): number {
    return this.nodes.length;
  }

  /**
   * Rebuilds the mirror from the widgets the input router knows about.
   *
   * That set is "everything the user can act on", which is what a screen reader should hear — and it
   * deliberately includes **disabled** controls (they exist on screen and are announced as
   * `aria-disabled`) while a `Label` or a decorative panel is skipped because it has no descriptor.
   * Call it after a structural change (the plugin does, from its own `refreshInteraction()`), after
   * enabling, or by hand.
   */
  refresh(): void {
    if (!this.on || !this.attach()) {
      return;
    }
    const wanted = new Set<Widget>();
    // `input.widgets` is in tree order, which is the order a screen reader should read them in.
    for (const widget of this.plugin.input.widgets) {
      if (widget.describeA11y() !== null) {
        wanted.add(widget);
      }
    }
    // A focusable widget whose descriptor appears late (a `Repeat` template that sets one) still has to
    // be mirrored, so the focus collection is unioned in rather than replaced.
    for (const widget of this.plugin.focus.focusables) {
      if (widget.describeA11y() !== null) {
        wanted.add(widget);
      }
    }

    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const entry = this.nodes[i];
      if (!entry || !wanted.has(entry.widget) || entry.widget.isDestroyed === true) {
        if (entry) {
          entry.node.remove();
        }
        this.nodes.splice(i, 1);
      }
    }

    for (const widget of wanted) {
      let entry = this.nodes.find((candidate) => candidate.widget === widget);
      if (!entry) {
        const node = document.createElement('div');
        node.setAttribute(A11Y_ATTRIBUTE, '');
        // `-1` (not `0`): programmatically focusable so a screen reader can land on the control, but out
        // of the Tab order — navigation stays with the framework (`Tab`, arrows, gamepad).
        node.setAttribute('tabindex', '-1');
        const element = this.root;
        element?.appendChild(node);
        entry = { widget, node };
        this.nodes.push(entry);
      }
      this.applyDescriptor(entry, widget.describeA11y());
    }

    if (isDevMode()) {
      devLog(`a11y: mirrored ${this.nodes.length} widget(s)`);
    }
  }

  /**
   * Re-reads the descriptors.
   *
   * With no argument it syncs every node (structure change, theme switch, app-driven refresh); with a
   * widget it syncs just that one, which is the cheap call for "this control's value changed" — for
   * example after a field wrote back to its model. Either way only the attributes that actually changed
   * are written (`applyDescriptor` compares against the last applied state), so the plugin can afford to
   * call it once per frame for the focused widget.
   */
  sync(widget?: Widget): void {
    if (!this.on) {
      return;
    }
    if (widget) {
      const entry = this.nodes.find((candidate) => candidate.widget === widget);
      if (entry) {
        this.applyDescriptor(entry, widget.describeA11y());
      }
      return;
    }
    for (const entry of this.nodes) {
      this.applyDescriptor(
        entry,
        entry.widget.isDestroyed === true ? null : entry.widget.describeA11y(),
      );
    }
  }

  /**
   * Follows a framework focus change into the DOM, and announces when it cannot.
   *
   * A screen reader follows **DOM** focus. The mirror used to be a list of non-focusable nodes plus a
   * live-region line, which reads the control once but leaves the reader's cursor where it was: ask for
   * "the next item" after focusing a button and you hear whatever comes after the *old* position, and the
   * value of a slider moved with the arrow keys is never spoken again. The nodes therefore carry
   * `tabindex="-1"` and take DOM focus when the framework focus moves — `-1` keeps them out of the Tab
   * order, so navigation still belongs to the framework (`Tab`, arrows, gamepad), while a screen reader
   * lands on the node that describes the control and can be re-read at will.
   *
   * A widget that owns a DOM element (a text field's `<input>`) is focused through that element instead —
   * and if focusing fails (a browser that refuses, a node that is not in the document), the live region
   * still announces, which is what the whole feature did before.
   */
  focusChanged(widget: Widget | null): boolean {
    if (!this.on || !this.attach()) {
      return true;
    }
    const surface = widget ? this.surfaceOf(widget) : null;
    this.blurPrevious(widget);
    this.domFocused = widget;
    if (!widget) {
      return true;
    }
    // The state of the control being read has to be current: a toggle flipped by a `Tab`+`Enter` or a
    // validation error that appeared while it was focused must already be on the node.
    this.sync(widget);
    if (!surface) {
      return false;
    }
    if (document.activeElement !== surface) {
      try {
        surface.focus({ preventScroll: true });
      } catch {
        return false;
      }
    }
    return document.activeElement === surface;
  }

  /**
   * Announces the widget that just took focus, without touching DOM focus.
   *
   * This is the fallback `focusChanged()` uses, and the right call for an app that manages DOM focus
   * itself and only wants the line read aloud.
   */
  announceFocus(widget: Widget | null): void {
    if (!this.on) {
      return;
    }
    if (!widget) {
      return;
    }
    const descriptor = widget.describeA11y();
    if (!descriptor) {
      return;
    }
    this.sync(widget);
    this.announce(describeA11yText(descriptor, widget));
  }

  /**
   * Announces a message through the live region — a validation error, "3 of 12 selected", anything the
   * user cannot see because it is painted on a canvas.
   *
   * The region is cleared first and filled on the next task: a screen reader only announces a *change*,
   * so repeating the same message would otherwise be silent.
   */
  announce(message: string): void {
    if (!this.on || !this.attach()) {
      return;
    }
    const region = this.live;
    if (!region) {
      return;
    }
    const text = message.trim();
    if (text.length === 0) {
      return;
    }
    region.textContent = '';
    const fill = (): void => {
      if (this.live === region) {
        region.textContent = text;
      }
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(fill);
    } else {
      setTimeout(fill, 0);
    }
    if (isDevMode()) {
      devLog(`a11y: announce: ${text}`);
    }
  }

  /** The text currently in the live region (a check reads this through the DOM as well). */
  get announcement(): string {
    return this.live?.textContent ?? '';
  }

  /** Removes the mirror (scene shutdown, or `enabled = false`). Idempotent. */
  destroy(): void {
    this.detach();
  }

  // ------------------------------------------------------------------ internals

  /**
   * The DOM element a screen reader should land on for `widget`: its own element when it has one, else
   * the mirror node.
   */
  private surfaceOf(widget: Widget): HTMLElement | null {
    const own = widget.getA11yDomElement();
    if (own) {
      return own;
    }
    return this.nodes.find((entry) => entry.widget === widget)?.node ?? null;
  }

  /**
   * Releases DOM focus from the surface of the widget that had it, so the tree never keeps a stale
   * `document.activeElement` (a page popped while one of its controls was focused used to leave DOM
   * focus on a removed node).
   */
  private blurPrevious(next: Widget | null): void {
    const previous = this.domFocused;
    if (!previous || previous === next || previous.isDestroyed === true) {
      return;
    }
    const surface = this.surfaceOf(previous);
    if (surface && document.activeElement === surface) {
      surface.blur();
    }
  }

  private attach(): boolean {
    if (this.root && this.root.isConnected) {
      return true;
    }
    if (!this.on) {
      return false;
    }
    const container = this.options.container ?? domContainerOf(this.plugin);
    if (!container) {
      warn(
        'A11yBridge: the game has no DOM container, so the accessibility mirror cannot be created. ' +
          'Set `dom: { createContainer: true }` in the Phaser Game config (see ADR-0004).',
      );
      this.on = false;
      return false;
    }

    const root = document.createElement('div');
    root.setAttribute('data-mvvm-a11y-root', '');
    Object.assign(root.style, HIDDEN_STYLE, { position: 'absolute', left: '0', top: '0' });
    const live = document.createElement('div');
    live.setAttribute(A11Y_LIVE_ATTRIBUTE, '');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', this.options.politeness ?? 'polite');
    live.setAttribute('aria-atomic', 'true');
    Object.assign(live.style, HIDDEN_STYLE);
    root.appendChild(live);
    container.appendChild(root);

    this.root = root;
    this.live = live;
    return true;
  }

  private detach(): void {
    const focused = this.domFocused;
    if (focused) {
      const surface = this.surfaceOf(focused);
      if (surface && document.activeElement === surface) {
        surface.blur();
      }
    }
    this.domFocused = null;
    this.lastApplied.clear();
    this.root?.remove();
    this.root = null;
    this.live = null;
    this.nodes.length = 0;
  }

  /**
   * Writes one descriptor to wherever its surface is, and only when something actually changed.
   *
   * The plugin syncs the focused widget every frame (so a value that changes without a focus move — a
   * slider dragged with the arrow keys, a validation error that appears on submit — is never stale), and
   * the signature check is what makes that affordable: identical attributes are not rewritten, because
   * touching an unchanged attribute would still wake the accessibility tree.
   */
  private applyDescriptor(entry: MirrorNode, descriptor: A11yDescription): void {
    const { node, widget } = entry;
    if (descriptor === null) {
      node.remove();
      this.lastApplied.delete(widget);
      const index = this.nodes.indexOf(entry);
      if (index !== -1) {
        this.nodes.splice(index, 1);
      }
      return;
    }

    // A widget that owns a DOM element (a text field's hidden `<input>`) is *already* in the browser's
    // accessibility tree: it is focusable, it has a name and it holds the text. Mirroring it a second
    // time as a `<div role="textbox">` exposed the same control twice — measured on `#/a11y` with
    // Chrome's own AX tree: four textboxes for two fields, and the `div`'s AX *value* was the
    // description line ("名字") rather than the field's text. So the mirror steps aside: the node stays
    // in the DOM (it is what `count`, the dev trace and the DOM-level checks read) but is `aria-hidden`,
    // and the widget's element carries the role/name/state. When the element cannot be created (no DOM
    // container, `dom: false`), `getA11yDomElement()` answers `null` and the node is the surface again.
    const domElement = widget.getA11yDomElement();
    const attributes = a11yAttributes(descriptor, widget);
    const text = a11yText(descriptor, widget);
    const signature = `${domElement ? 'dom' : 'node'}|${text}|${attributeSignature(attributes)}`;
    if (this.lastApplied.get(widget) === signature) {
      return;
    }
    this.lastApplied.set(widget, signature);

    node.setAttribute('data-mvvm-a11y-name', widget.name || descriptor.role);
    node.textContent = text;
    if (domElement) {
      node.setAttribute('aria-hidden', 'true');
    } else {
      node.removeAttribute('aria-hidden');
    }

    // The node keeps the full attribute set even when it is hidden: it is the surface the DOM-level
    // checks read (`[data-mvvm-a11y]`), and a second copy costs nothing on a hidden 1px div.
    for (const attribute of MANAGED_ATTRIBUTES) {
      const value = attributes[attribute] ?? null;
      setAttribute(node, attribute, value);
      if (domElement && attribute !== 'role') {
        // The element's role comes from the element itself (`<input>` *is* a textbox); only the ARIA
        // state and the name are written, so nothing can turn a real input into something else.
        setAttribute(domElement, attribute, value);
      }
    }
  }
}

/** Every ARIA attribute the mirror owns; the ones a descriptor stops mentioning are removed. */
const MANAGED_ATTRIBUTES = [
  'role',
  'aria-label',
  'aria-description',
  'aria-disabled',
  'aria-invalid',
  'aria-checked',
  'aria-valuenow',
  'aria-valuemin',
  'aria-valuemax',
] as const;

/** A stable string for "did anything change?" — sorted, so key order cannot fake a difference. */
function attributeSignature(attributes: Record<string, string>): string {
  return Object.keys(attributes)
    .sort()
    .map((key) => `${key}=${attributes[key] ?? ''}`)
    .join(';');
}

function labelOf(descriptor: A11yDescriptor, widget?: { name?: string }): string | null {
  const label = descriptor.label ?? widget?.name ?? '';
  return label.length > 0 ? label : null;
}

/**
 * The ARIA attributes a descriptor maps to — pure, so the mapping is unit-tested in Node without a DOM
 * (`test/a11y.test.ts`).
 *
 * Two rules worth naming:
 *
 * - **`aria-valuenow`/`min`/`max` only exist on roles that support a value range.** Writing them on a
 *   `textbox` is invalid ARIA (that role takes its value from its content), and invalid attributes are
 *   the kind of thing a validator complains about while a screen reader silently ignores them.
 * - **`aria-label` is always written when there is one**, even if the element also has visible text:
 *   the framework already decided the accessible name (`Widget.a11yLabel` wins over the widget's own
 *   text), and a field's hidden `<input>` would otherwise fall back to whatever the placeholder says.
 */
export function a11yAttributes(
  descriptor: A11yDescriptor,
  widget?: { name?: string },
): Record<string, string> {
  const attributes: Record<string, string> = { role: descriptor.role };
  setIf(attributes, 'aria-label', labelOf(descriptor, widget));
  setIf(attributes, 'aria-description', descriptor.hint ?? null);
  setIf(attributes, 'aria-disabled', descriptor.disabled === true ? 'true' : null);
  setIf(attributes, 'aria-invalid', descriptor.invalid === true ? 'true' : null);
  setIf(
    attributes,
    'aria-checked',
    descriptor.checked === undefined ? null : String(descriptor.checked),
  );
  if (VALUE_RANGE_ROLES.has(descriptor.role)) {
    setIf(
      attributes,
      'aria-valuenow',
      descriptor.value === undefined ? null : String(descriptor.value),
    );
    setIf(
      attributes,
      'aria-valuemin',
      descriptor.min === undefined ? null : String(descriptor.min),
    );
    setIf(
      attributes,
      'aria-valuemax',
      descriptor.max === undefined ? null : String(descriptor.max),
    );
  }
  return attributes;
}

/**
 * Roles whose accessible value comes from a range (or a number), and which therefore accept
 * `aria-valuenow`/`aria-valuemin`/`aria-valuemax` (ARIA 1.2 — `textbox` and `checkbox` are not among
 * them: a textbox's value is its content, a checkbox's is `aria-checked`).
 */
export const VALUE_RANGE_ROLES: ReadonlySet<string> = new Set([
  'slider',
  'spinbutton',
  'scrollbar',
  'progressbar',
  'meter',
  'separator',
]);

/**
 * Roles whose accessible *value* is read from the element's text content.
 *
 * For those the node's content has to be the value alone — `describeA11yText()` starts with the label,
 * and Chrome reports a `div role="textbox"`'s value as its content, so writing the description line
 * there made every field announce its own label as its value.
 */
const CONTENT_VALUE_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox']);

/** The text content a mirrored node gets: the value for a text-like role, else the readable line. */
export function a11yText(descriptor: A11yDescriptor, widget?: { name?: string }): string {
  if (CONTENT_VALUE_ROLES.has(descriptor.role)) {
    return descriptor.value === undefined ? '' : String(descriptor.value);
  }
  return describeA11yText(descriptor, widget);
}

function setIf(target: Record<string, string>, name: string, value: string | null): void {
  if (value !== null) {
    target[name] = value;
  }
}

/** One line a screen reader can read aloud for a descriptor. */
export function describeA11yText(descriptor: A11yDescriptor, widget?: { name?: string }): string {
  const parts: string[] = [];
  const label = descriptor.label ?? widget?.name ?? '';
  if (label.length > 0) {
    parts.push(label);
  }
  if (descriptor.checked !== undefined) {
    parts.push(descriptor.checked ? 'checked' : 'not checked');
  }
  if (descriptor.value !== undefined && descriptor.checked === undefined) {
    // An empty string is a real value for a text field, but reading ", , invalid" aloud is noise.
    const value = String(descriptor.value);
    if (value.length > 0) {
      parts.push(value);
    }
  }
  if (descriptor.disabled === true) {
    parts.push('disabled');
  }
  if (descriptor.invalid === true) {
    parts.push('invalid');
  }
  if (descriptor.hint) {
    parts.push(descriptor.hint);
  }
  return parts.join(', ');
}

function setAttribute(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    node.removeAttribute(name);
  } else {
    node.setAttribute(name, value);
  }
}

/** Phaser's DOM overlay container (created by `dom: { createContainer: true }`). */
function domContainerOf(plugin: MVVMPlugin): HTMLElement | null {
  const scene = (
    plugin as unknown as { scene?: { sys?: { game?: { domContainer?: HTMLElement } } } }
  ).scene;
  return scene?.sys?.game?.domContainer ?? null;
}
