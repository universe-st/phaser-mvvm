/**
 * `VirtualKeyboard` — an on-screen keyboard for players who have no keyboard (PLAN M9's 手柄文本输入).
 *
 * A gamepad can move focus, activate buttons and press `back`, but it cannot type. Every console UI
 * answers that with a keyboard drawn on the screen, and this is that: a panel of ordinary `Button`s
 * arranged in rows, writing into a `TextInputBase` through the **same** path a keystroke takes
 * (`insertText`/`deleteText`), so `maxLength`, numeric filtering, sanitising and the change event all
 * behave exactly as they do when the player types on a real keyboard.
 *
 * ```ts
 * const field = TextField({ label: '玩家名', width: 260 });
 * VirtualKeyboard({ target: () => field, onSubmit: () => this.submit() });
 * ```
 *
 * Why buttons and not a custom widget: everything a text entry needs is already in the framework once
 * the keys are focusable controls — `Tab`/D-Pad/arrow navigation walks them, the gamepad's `A`
 * activates them, the pointer hovers and clicks them, the accessibility mirror announces them (each
 * key carries a `label`, so the reader says "delete" rather than "key.backspace"), and the focus ring
 * and pressed states come from the theme. The keyboard itself therefore has almost no behaviour: it
 * maps a key name to an action.
 *
 * Deliberately **not** an IME: a player who needs Chinese/Japanese input uses the real keyboard path
 * (the DOM bridge, ADR-0004). This widget exists for the case where there is no real keyboard at all.
 */

import Phaser from 'phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import { Panel, type PanelOptions } from './Panel';
import type { TextInputBase } from './TextInputBase';
import {
  afterTyping,
  CASE_OFF,
  describeSlot,
  type CaseState,
  type KeySlot,
  type KeyboardPage,
  keyboardRows,
  labelFor,
  pageOf,
  pressShift,
  type VirtualKeyboardKind,
} from './keyboard-plan';

export type { KeySlot, KeyboardPage, VirtualKeyboardKind };

export interface VirtualKeyboardOptions extends PanelOptions {
  /**
   * The field the keys write into.
   *
   * A getter rather than the field itself, because a keyboard is usually written before the field it
   * serves (and because a page may swap fields under one keyboard). `null` means "nothing focused
   * yet": keys then do nothing, which is also what happens when the field is disabled or read-only.
   */
  target: () => TextInputBase | null;
  /** Which page(s) to offer. `'text'` (default) starts on letters and can switch to digits/symbols. */
  kind?: VirtualKeyboardKind;
  /** Called when the Enter key is pressed. */
  onSubmit?: () => void;
  /** Called after every edit the keys produced (so a page can refresh its own readouts). */
  onChange?: () => void;
  /** Debug name prefix for the keys. Defaults to `keyboard`. */
  name?: string;
}

export class VirtualKeyboardWidget extends Panel {
  private readonly targetOf: () => TextInputBase | null;
  private readonly kind: VirtualKeyboardKind;
  private readonly onSubmitCallback: (() => void) | undefined;
  private readonly onChangeCallback: (() => void) | undefined;
  private readonly keyWidgets = new Map<string, { widget: Widget; slot: KeySlot }>();

  /** Shift state: one press is a one-shot, two presses lock the case (`keyboard-plan.ts`). */
  private caseState: CaseState = CASE_OFF;
  /** Which character page the text keyboard shows. */
  private symbols = false;

  constructor(scene: Phaser.Scene, options: VirtualKeyboardOptions) {
    const { target, kind, onSubmit, onChange, name, ...panel } = options;
    super(scene, {
      direction: 'vertical',
      gap: 6,
      padding: 10,
      variant: 'surfaceAlt',
      radius: 12,
      ...panel,
      name: name ?? 'keyboard',
    });
    this.targetOf = target;
    this.kind = kind ?? 'text';
    this.onSubmitCallback = onSubmit;
    this.onChangeCallback = onChange;

    // The keys themselves are drawn by the DSL (`VirtualKeyboard()` in `compose.ts`), because a key is a
    // `Button` and building one outside a UI scope would bypass the DSL's parenting rules — the same
    // reason `List` lives in `compose.ts`. This class owns what the keys *mean*: the slot layout, the
    // page/case state, and the actions, which is the part worth testing without a renderer.
  }

  /**
   * The key layout for the current page: rows of slots.
   *
   * Public because the DSL builder (and a check that wants to know what is on screen) needs it; the
   * slots never change identity afterwards — a page or case switch only re-labels them, because
   * destroying and rebuilding the keys would drop focus on the key the player was about to press.
   */
  slots(): readonly (readonly KeySlot[])[] {
    return keyboardRows(this.kind, this.page);
  }

  /** How a key should be drawn right now (the DSL calls this once per slot when it builds the row). */
  describeKey(slot: KeySlot): {
    label: string;
    a11yLabel?: string;
    weight: number;
    primary: boolean;
  } {
    return describeSlot(slot, this.page, this.caseState.upper);
  }

  /** Called by the DSL builder for each key it creates. */
  registerKey(slot: KeySlot, widget: Widget): void {
    this.keyWidgets.set(slot.id, { widget, slot });
  }

  /** The action of one slot (the DSL's `onClick`). */
  activateSlot(slot: KeySlot): boolean {
    return this.runSlot(slot);
  }

  /** The key ids this keyboard exposes, in reading order (a check walks this list). */
  get keys(): readonly string[] {
    return [...this.keyWidgets.keys()];
  }

  /** The widget behind one key id, or `null`. */
  keyOf(id: string): Widget | null {
    return this.keyWidgets.get(id)?.widget ?? null;
  }

  /** What the keyboard is showing: the page and the case (one-shot upper vs. locked upper). */
  get appearance(): {
    kind: VirtualKeyboardKind;
    page: KeyboardPage;
    upper: boolean;
    capsLock: boolean;
  } {
    return {
      kind: this.kind,
      page: this.page,
      upper: this.caseState.upper,
      capsLock: this.caseState.capsLock,
    };
  }

  /** The page the text keyboard is on; `'numeric'` for the numpad kind. */
  private get page(): KeyboardPage {
    return pageOf(this.kind, this.symbols);
  }

  /** The label a key shows right now (what the player sees, and what `keyFor` matches on). */
  labelOf(id: string): string {
    const entry = this.keyWidgets.get(id);
    return entry ? labelFor(entry.slot, this.page, this.caseState.upper) : '';
  }

  /** The key id whose current label is `char` — the way a check or a macro finds a letter to press. */
  keyFor(char: string): string | null {
    for (const [id, entry] of this.keyWidgets) {
      if (labelFor(entry.slot, this.page, this.caseState.upper) === char) {
        return id;
      }
    }
    return null;
  }

  /**
   * Runs a key's action, exactly as activating it would.
   *
   * Public because a check (and a "type this word" macro) wants to send one key without hunting for its
   * widget — but it is the same code path as the button's own `onClick`, including the sanitising the
   * field applies to every insert.
   */
  press(id: string): boolean {
    const entry = this.keyWidgets.get(id);
    return entry ? this.runSlot(entry.slot) : false;
  }

  /** Types one character by finding the key that shows it (returns `false` when it is on another page). */
  typeChar(char: string): boolean {
    const id = this.keyFor(char);
    return id === null ? false : this.press(id);
  }

  /** Runs one slot's action against the target field. */
  private runSlot(slot: KeySlot): boolean {
    const field = this.targetOf();
    switch (slot.command) {
      case 'case':
        this.caseState = pressShift(this.caseState);
        this.relabel();
        return true;
      case 'page':
        this.symbols = !this.symbols;
        this.relabel();
        return true;
      case 'enter':
        this.onSubmitCallback?.();
        return true;
      case 'backspace':
        if (!field) {
          return false;
        }
        field.deleteText('backward');
        this.onChangeCallback?.();
        return true;
      case 'space':
        if (!field) {
          return false;
        }
        field.insertText(' ');
        this.typed();
        return true;
      default: {
        if (!field) {
          return false;
        }
        const char = labelFor(slot, this.page, this.caseState.upper);
        if (char.length === 0) {
          return false;
        }
        field.insertText(char);
        this.typed();
        return true;
      }
    }
  }

  /**
   * A character went into the field: release a one-shot shift, keep a locked one.
   *
   * Both insert paths (a character key and space) go through here, because shift applies to the *next
   * character* however it is produced; a backspace or Enter does not consume it.
   */
  private typed(): void {
    const next = afterTyping(this.caseState);
    if (next !== this.caseState) {
      this.caseState = next;
      this.relabel();
    }
    this.onChangeCallback?.();
  }

  /** Re-labels every key in place (see the note where the keys are built). */
  private relabel(): void {
    for (const entry of this.keyWidgets.values()) {
      const button = entry.widget as { setText?: (text: string) => void };
      button.setText?.(labelFor(entry.slot, this.page, this.caseState.upper));
    }
  }
}
