/**
 * `A11yBridge` — a hidden DOM mirror of the interactive widgets, for screen readers (PLAN §1.2, §4.3).
 *
 * Canvas has no accessibility tree: a screen reader sees one opaque `<canvas>`. The Phase 1 scope is
 * therefore deliberately small and honest — **not** a WCAG claim, and not a second UI:
 *
 * - every widget that can be *acted on* (the focus manager's collection, which is exactly the set a
 *   keyboard user can reach) gets a visually hidden `<div>` with `role`/`aria-label`/state attributes,
 * - focus changes and app messages are announced through one `aria-live` region,
 * - the mirror lives in Phaser's DOM container (`dom.createContainer: true`), the same overlay the
 *   text-input bridge uses, and it is created and torn down with the plugin,
 * - the nodes are **not** keyboard-focusable: keyboard control stays with the framework (arrow keys,
 *   `Tab`, gamepad), so a screen-reader user browses the mirror while the game keeps the keys.
 *
 * Widgets describe themselves (`Widget#describeA11y`), because the adapter cannot know what a
 * `Button` or a `Slider` is — `packages/phaser` must not depend on the widget library. The descriptor
 * is re-read whenever the mirror is refreshed (structure change, focus change) or asked to
 * (`sync()`), so a value that changed while a control was not focused is picked up by the next sync.
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
   * example after a field wrote back to its model.
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

  /** Announces the widget that just took focus, the way a screen reader needs it. */
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

  /** Removes the mirror (scene shutdown, or `enabled = false`). Idempotent. */
  destroy(): void {
    this.detach();
  }

  // ------------------------------------------------------------------ internals

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
    this.root?.remove();
    this.root = null;
    this.live = null;
    this.nodes.length = 0;
  }

  private applyDescriptor(entry: MirrorNode, descriptor: A11yDescription): void {
    const { node, widget } = entry;
    if (descriptor === null) {
      node.remove();
      const index = this.nodes.indexOf(entry);
      if (index !== -1) {
        this.nodes.splice(index, 1);
      }
      return;
    }

    const label = descriptor.label ?? widget.name ?? '';
    node.setAttribute('role', descriptor.role);
    node.setAttribute('data-mvvm-a11y-name', widget.name || descriptor.role);
    setAttribute(node, 'aria-label', label.length > 0 ? label : null);
    setAttribute(node, 'aria-description', descriptor.hint ?? null);
    setAttribute(node, 'aria-disabled', descriptor.disabled === true ? 'true' : null);
    setAttribute(node, 'aria-invalid', descriptor.invalid === true ? 'true' : null);
    setAttribute(
      node,
      'aria-checked',
      descriptor.checked === undefined ? null : String(descriptor.checked),
    );
    setAttribute(
      node,
      'aria-valuenow',
      descriptor.value === undefined ? null : String(descriptor.value),
    );
    setAttribute(
      node,
      'aria-valuemin',
      descriptor.min === undefined ? null : String(descriptor.min),
    );
    setAttribute(
      node,
      'aria-valuemax',
      descriptor.max === undefined ? null : String(descriptor.max),
    );
    // The text node is what a screen reader reads in browse mode; the attributes carry the detail.
    node.textContent = describeA11yText(descriptor, widget);
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
