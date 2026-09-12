/**
 * `#/keyboard` — the standing acceptance page for `VirtualKeyboard` (PLAN M9's 手柄文本输入).
 *
 * A gamepad can move focus and activate buttons but cannot type, so a console UI draws a keyboard. The
 * interesting question is not "does it render" but "is it *usable with a pad*": the D-Pad has to reach
 * every key, `A` has to type, `⌫` has to delete, `Enter` has to submit, and the field has to receive
 * exactly what a real keyboard would have produced (the same `maxLength`/numeric filtering/sanitising).
 *
 * Hence four families of probes, all per frame:
 *
 * - `kb.value` / `kb.length` / `kb.caret` — what the field holds, and where the caret is;
 * - `kb.page` / `kb.upper` — what the keyboard is showing (letters / digits / shift);
 * - `kb.upperFirst` — the label of one letter key, so a case switch is visible as data;
 * - `pt.kb.<id>` / `st.kb.<id>` — every key's page coordinate and visual state (mouse and focus paths).
 *
 * `window.keyboard` drives it: `type(text)` / `press(id)` / `keyFor(char)` / `point(idOrName)` /
 * `keys()` / `appearance()` / `value()` / `focus(name)` / `submits()` / `counts()` / `churn(n)` /
 * `swapChurn(n)` (swaps the keyboard kind n times and compares the counts around it).
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { themeListenerCount, type ModalHandle, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Column,
  Divider,
  Panel,
  Row,
  Text,
  TextField,
  VirtualKeyboard,
  ui,
} from '@phaser-mvvm/widgets/compose';
import type {
  VirtualKeyboardKind,
  VirtualKeyboardOptions,
  VirtualKeyboardWidget,
} from '@phaser-mvvm/widgets';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

export class KeyboardScene extends Phaser.Scene {
  private readonly note = ref('用方向键走到按键上，按 A 输入；Enter 提交。');
  private readonly nameValue = ref('');
  /** Which key set the keyboard shows. A plain `ref` — the widget rebuilds its own keys when it flips. */
  private readonly kind = ref<VirtualKeyboardKind>('text');

  private field: ReturnType<typeof TextField> | null = null;
  private keyboard: VirtualKeyboardWidget | null = null;
  private submits = 0;
  /** The dialog's own field + keyboard (round 101): a second instance, inside a modal layer. */
  private readonly dialogValue = ref('');
  private readonly dialogNote = ref('用键盘输入，Enter 提交，Esc 取消');
  private dialogHandle: ModalHandle | null = null;
  private dialogField: ReturnType<typeof TextField> | null = null;
  private dialogKeyboard: VirtualKeyboardWidget | null = null;
  private dialogSubmits = 0;
  /** Key widgets are rebuilt when the page or the kind changes; this is the generation they belong to. */
  private keysRevision = -1;

  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('keyboard');
  }

  create(): void {
    const page = ui(this, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 12,
          padding: 20,
          variant: 'surface',
          radius: 12,
          width: 560,
          name: 'kb.page',
        },
        () => {
          this.track('title', Text('虚拟键盘 · VirtualKeyboard', { size: 'lg', name: 'kb.title' }));
          this.track(
            'hint',
            Text('手柄：方向键移动焦点、A 输入、B 返回；鼠标/触摸：直接点按键。', {
              tone: 'muted',
              name: 'kb.hint',
              maxLines: 2,
            }),
          );
          const field = TextField({
            name: 'kb.field',
            label: '玩家名',
            value: this.nameValue,
            placeholder: '点这里或直接用下面的键盘',
            maxLength: 12,
            width: 'fill',
          });
          this.field = field;
          this.track('field', field);

          // One construction for the whole page: `kind` is a reactive slot, so the "切到数字键盘" button
          // only flips the ref — the keyboard rebuilds its keys itself (and keeps `onSubmit`/`onChange`,
          // which belong to the keyboard rather than to a particular key set).
          const keyboard = VirtualKeyboard({ ...this.keyboardOptions(), kind: this.kind });
          this.keyboard = keyboard;
          this.track('keyboard', keyboard);
          this.syncKeys();

          Divider({});
          this.track(
            'note',
            Text(() => this.note.value, { tone: 'muted', name: 'kb.note' }),
          );
          Row({ gap: 8 }, () => {
            this.track(
              'clear',
              Button('清空', {
                variant: 'ghost',
                name: 'kb.clear',
                onClick: () => {
                  this.field?.setValue('');
                  this.note.value = '已清空';
                },
              }),
            );
            this.track(
              'numeric',
              Button('切到数字键盘', {
                variant: 'secondary',
                name: 'kb.numeric',
                onClick: () => {
                  this.kind.value = 'numeric';
                },
              }),
            );
            this.track(
              'text',
              Button('切回文字键盘', {
                variant: 'secondary',
                name: 'kb.text',
                onClick: () => {
                  this.kind.value = 'text';
                },
              }),
            );
            this.track(
              'dialog',
              Button('对话框里输入', {
                variant: 'primary',
                name: 'kb.dialog',
                onClick: () => {
                  this.openDialog();
                },
              }),
            );
          });
        },
      );
    });

    this.mvvm.mount(page);
    this.exposeApi();

    setDemoState('scene', 'keyboard');
    appendStatus('--- keyboard ---');
    reportCanvas(this.game);
  }

  /**
   * Opens a dialog that asks for a name **with its own keyboard** — the console flow (PLAN M9).
   *
   * The page already has a field and a keyboard, so this layer is also a test of what a modal has to
   * do to the widgets underneath: the pad's focus must be trapped inside, the page's field must stop
   * receiving input, and closing the dialog must leave the counts exactly where they were.
   *
   * The keyboard is a *second* instance (its own `target`), because a `VirtualKeyboard` drives one field
   * and the dialog's value must not be the page's value.
   */
  private openDialog(): void {
    if (this.dialogHandle) {
      return;
    }
    this.dialogNote.value = '用键盘输入，Enter 提交，Esc 取消';
    const handle = this.mvvm.modal.open(
      () => {
        Column({ gap: 10, padding: 16, width: 520, name: 'kb.dlg.body' }, () => {
          Text('手柄输入：对话框', { size: 'lg', name: 'kb.dlg.title' });
          const field = TextField({
            name: 'kb.dlg.field',
            label: '角色名',
            value: this.dialogValue,
            placeholder: '用下面的键盘输入',
            maxLength: 10,
            width: 'fill',
          });
          this.dialogField = field;
          const keyboard = VirtualKeyboard({
            target: () => this.dialogField,
            onSubmit: () => {
              this.dialogSubmits += 1;
              this.dialogNote.value = `提交：${this.dialogValue.value || '(空)'}`;
              this.closeDialog('submit');
            },
            onChange: () => {
              this.dialogNote.value = `已输入 ${this.dialogValue.value.length} 个字符`;
            },
          });
          this.dialogKeyboard = keyboard;
          Text(() => this.dialogNote.value, { tone: 'muted', name: 'kb.dlg.note' });
          Row({ gap: 8 }, () => {
            Button('取消', {
              variant: 'ghost',
              name: 'kb.dlg.cancel',
              onClick: () => {
                this.closeDialog('cancel');
              },
            });
          });
        });
      },
      { name: 'kb.dlg' },
    );
    this.dialogHandle = handle;
  }

  /** Closes the dialog's layer; the widgets inside are destroyed with it. */
  private closeDialog(reason = 'api'): void {
    if (!this.dialogHandle) {
      return;
    }
    this.dialogNote.value = `已关闭（${reason}）`;
    this.dialogHandle.close();
    this.dialogHandle = null;
    // The layer's widgets are destroyed with it, so the references must go with them: a stale
    // reference would let `dialogState()` keep reporting a dead field as if the dialog were open.
    this.dialogField = null;
    this.dialogKeyboard = null;
  }

  /**
   * The keyboard's options.
   *
   * No `kind` here: the kind is state (`this.kind`), not part of the keyboard's identity, which is what
   * makes switching it a one-line change instead of a rebuild the caller has to get right.
   */
  private keyboardOptions(): Omit<VirtualKeyboardOptions, 'kind'> {
    return {
      target: () => this.field,
      onSubmit: () => {
        this.submits += 1;
        this.note.value = `提交：${this.nameValue.value || '(空)'}`;
      },
      onChange: () => {
        this.note.value = `已输入 ${this.nameValue.value.length} 个字符`;
      },
    };
  }

  /**
   * Re-points the per-key probes at the current key widgets.
   *
   * A page or kind switch destroys the old keys, so the tracked widgets — and every `pt.kb.<id>` /
   * `st.kb.<id>` line published from them — would otherwise keep pointing at destroyed objects. Keys
   * that no longer exist publish `gone` for one frame and then stop publishing (the `#demo-state` line
   * is shared by every scene, so a stale probe would aim a later check at the wrong place).
   */
  private syncKeys(): void {
    const keyboard = this.keyboard;
    if (!keyboard || keyboard.keyRevision === this.keysRevision) {
      return;
    }
    this.keysRevision = keyboard.keyRevision;

    const live = new Set<string>();
    for (const row of keyboard.slots()) {
      for (const slot of row) {
        const key = keyboard.keyOf(slot.id);
        if (key) {
          live.add(slot.id);
          this.tracked.set(`k.${slot.id}`, key);
        }
      }
    }
    for (const key of [...this.tracked.keys()]) {
      if (key.startsWith('k.') && !live.has(key.slice(2))) {
        this.tracked.delete(key);
        this.publish(`pt.kb.${key.slice(2)}`, 'gone');
        this.publish(`st.kb.${key.slice(2)}`, 'gone');
      }
    }
  }

  private frame(): Promise<void> {
    return new Promise((resolve) => {
      this.game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve());
    });
  }

  private track(key: string, widget: Widget): Widget {
    this.tracked.set(key, widget);
    return widget;
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  /**
   * Appends the geometry to `#status` **after the first layout**.
   *
   * `reportWidget` samples the rect once, at call time: doing it inside `create()` recorded a keyboard
   * panel of 520×20 (before it had been arranged), which is exactly the trap AGENTS §6 warns about.
   * The keys themselves are published per frame as `pt.*`/`st.*`, so only the three coarse rects need a
   * one-shot report — and one frame in, they are real.
   */
  private reportKeys(): void {
    if (this.reported) {
      return;
    }
    this.reported = true;
    // The three coarse rects plus two keys: the pixel gate in `scripts/visual-check.mjs` samples these,
    // and it needs a *key's* box (not the keys' centres from `pt.*`, which sit under the label glyphs).
    const reported: Record<string, string> = {
      keyboard: 'kb.keyboard',
      field: 'kb.field',
      'k.q': 'kb.key.q',
      'k.enter': 'kb.key.enter',
    };
    for (const [key, label] of Object.entries(reported)) {
      const widget = this.tracked.get(key);
      if (widget) {
        reportWidget(label, widget);
      }
    }
  }

  private reported = false;

  /** Per-frame probes. */
  override update(): void {
    this.reportKeys();
    // A page or kind switch rebuilt the keys: re-point the probes before they are published.
    this.syncKeys();
    const appearance = this.keyboard?.appearance ?? {
      page: 'letters',
      upper: false,
      capsLock: false,
      kind: 'text',
    };
    this.publish('kb.value', this.nameValue.value);
    this.publish('kb.length', this.nameValue.value.length);
    this.publish('kb.caret', this.field?.caretIndex ?? -1);
    this.publish('kb.page', appearance.page);
    this.publish('kb.kind', appearance.kind);
    // `upper` and `caps` are separate probes on purpose: one shift press upper-cases exactly one
    // character (`upper=on` then off again), two presses lock it (`caps=on` stays) — and a check that
    // only saw `upper` could not tell a lock from a one-shot.
    this.publish('kb.upper', appearance.upper ? 'on' : 'off');
    this.publish('kb.caps', appearance.capsLock ? 'on' : 'off');
    this.publish('kb.upperFirst', this.keyboard?.labelOf('q') ?? 'none');
    this.publish('kb.submits', this.submits);
    this.publish('focus', this.mvvm.focus.focusedWidget?.name || 'none');
    this.publish('kb.focusables', this.mvvm.focus.focusables.length);

    // The dialog's own readings. `dlg.open` is the layer's presence; the value/caret come from the
    // dialog's field *and* from the `ref` behind it, so "the keys reached the model" is visible as data.
    const dialogOpen = this.dialogHandle !== null;
    this.publish('dlg.open', dialogOpen ? 'yes' : 'no');
    this.publish('dlg.value', this.dialogField ? this.dialogValue.value : 'gone');
    this.publish('dlg.length', this.dialogField ? this.dialogValue.value.length : 'gone');
    this.publish('dlg.caret', this.dialogField?.caretIndex ?? -1);
    this.publish('dlg.kind', this.dialogKeyboard?.appearance.kind ?? 'gone');
    this.publish('dlg.submits', this.dialogSubmits);

    const counts = this.counts();
    this.publish('counts.widgets', counts.widgets);
    this.publish('counts.themeListeners', counts.themeListeners);
    this.publish('counts.pointerTargets', counts.pointerTargets);

    // Per-frame `pt.*`/`st.*` for every key: the layout does not move, but the *states* do, and the
    // acceptance walks them with a real pointer and a fake pad.
    for (const [key, widget] of this.tracked) {
      if (!key.startsWith('k.')) {
        continue;
      }
      const id = key.slice(2);
      const laidOut = !widget.isDestroyed && widget.appliedRect.width > 0;
      this.publish(
        `pt.kb.${id}`,
        laidOut
          ? `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
              pagePoint(this.game, widget).y,
            )}`
          : 'gone',
      );
      this.publish(`st.kb.${id}`, laidOut && widget.visible ? widget.visualState : 'gone');
    }
    this.publish(
      'pt.kb.field',
      this.field
        ? `@${Math.round(pagePoint(this.game, this.field).x)},${Math.round(pagePoint(this.game, this.field).y)}`
        : 'none',
    );
  }

  counts(): {
    widgets: number;
    themeListeners: number;
    pointerTargets: number;
    focusables: number;
    displayList: number;
  } {
    return {
      widgets: countWidgets(this.mvvm.root),
      themeListeners: themeListenerCount(),
      pointerTargets: this.mvvm.input.widgets.length,
      focusables: this.mvvm.focus.focusables.length,
      // Swapping a keyboard adds and destroys a whole subtree; a widget that was only *detached* would
      // stay in the scene's display list with its own theme subscription (V27's shape).
      displayList: this.children.list.length,
    };
  }

  /** The in-page API an acceptance run drives the page with. */
  private exposeApi(): void {
    const api = {
      /** Types a string through the keys (the same code path as a pad press). */
      type: (text: string): string => {
        for (const char of text) {
          if (!this.keyboard?.typeChar(char)) {
            return `stopped at "${char}" (page=${this.keyboard?.appearance.page})`;
          }
        }
        return this.nameValue.value;
      },
      /** Presses one key by id, e.g. `q`, `space`, `backspace`, `enter`, `shift`, `page`. */
      press: (id: string): boolean => this.keyboard?.press(id) ?? false,
      /** The key id that currently shows `char`, or `none`. */
      keyFor: (char: string): string => this.keyboard?.keyFor(char) ?? 'none',
      keys: (): readonly string[] => this.keyboard?.keys ?? [],
      appearance: (): Record<string, unknown> => this.keyboard?.appearance ?? {},
      value: (): string => this.nameValue.value,
      length: (): number => this.nameValue.value.length,
      caret: (): number => this.field?.caretIndex ?? -1,
      submits: (): number => this.submits,
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      /**
       * Page coordinates of a key id (`q`, `space`, …) or of any widget by name.
       *
       * Computed on demand rather than read from the per-frame `pt.*` line, so a check can aim at the
       * action buttons (`kb.numeric`) too — they are not keys, and clicking them means the pointer path
       * for "swap the keyboard" is exercised for real.
       */
      point: (idOrName: string): string => {
        const key = this.keyboard?.keyOf(idOrName) ?? this.byName(idOrName);
        if (!key || key.appliedRect.width <= 0) {
          return 'none';
        }
        return `@${Math.round(pagePoint(this.game, key).x)},${Math.round(pagePoint(this.game, key).y)}`;
      },
      /** Flipping the kind ref is the whole API for switching keyboards. */
      setKind: (next: VirtualKeyboardKind): string => {
        this.kind.value = next;
        return this.kind.value;
      },
      kind: (): VirtualKeyboardKind => this.kind.value,
      /** Focuses a widget by name (a shortcut for the acceptance's D-Pad walk). */
      focus: (name: string): string => {
        const widget = this.byName(name);
        if (!widget) {
          return 'not-found';
        }
        this.mvvm.focus.focus(widget);
        return this.mvvm.focus.focusedWidget?.name ?? 'none';
      },
      counts: () => this.counts(),
      /** Opens the dialog that asks for a name with its own keyboard (round 101). */
      openDialog: (): string => {
        this.openDialog();
        return this.dialogHandle ? 'open' : 'none';
      },
      closeDialog: (): string => {
        this.closeDialog('api');
        return 'closed';
      },
      /**
       * The dialog's own readings, or `null` while it is closed.
       *
       * `focusables` is the trap's evidence: while the layer is up it must list **only** the dialog's
       * widgets, never the page's field, keys or buttons underneath.
       */
      dialogState: (): Record<string, unknown> | null =>
        this.dialogHandle === null
          ? null
          : {
              value: this.dialogValue.value,
              caret: this.dialogField?.caretIndex ?? -1,
              kind: this.dialogKeyboard?.appearance.kind ?? 'none',
              keys: this.dialogKeyboard?.keys.length ?? 0,
              submits: this.dialogSubmits,
              focus: this.mvvm.focus.focusedWidget?.name || 'none',
              focusables: this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
              depth: this.mvvm.modal.depth,
              top: this.mvvm.modal.top ? `modal#${this.mvvm.modal.top.id}` : 'none',
            },
      /** Types through the **dialog's** keyboard (the same code path as a pad press). */
      dialogType: (text: string): string => {
        for (const char of text) {
          if (!this.dialogKeyboard?.typeChar(char)) {
            return `stopped at "${char}"`;
          }
        }
        return this.dialogValue.value;
      },
      /** Presses one key of the dialog's keyboard by id. */
      dialogPress: (id: string): boolean => this.dialogKeyboard?.press(id) ?? false,
      /** Page coordinates of a key id (or widget name) **inside** the dialog. */
      dialogPoint: (idOrName: string): string => {
        const key = this.dialogKeyboard?.keyOf(idOrName) ?? this.dialogByKeyboardKey(idOrName);
        if (!key || key.appliedRect.width <= 0) {
          return 'none';
        }
        return `@${Math.round(pagePoint(this.game, key).x)},${Math.round(pagePoint(this.game, key).y)}`;
      },
      /**
       * Opens and closes the dialog `n` times, reporting the counts around it.
       *
       * Each round waits for the transitions to finish: a closed layer is destroyed only after its exit
       * animation, so sampling right after `close()` counts a layer that is still fading (measured: five
       * rounds with a two-frame wait reported 96 widgets instead of 50 — a phantom leak made entirely of
       * layers still on their way out, the same shape as the `#/modal` gate's `await settle()`).
       */
      dialogChurn: async (n: number): Promise<{ before: unknown; after: unknown }> => {
        await this.frame();
        const before = this.counts();
        for (let i = 0; i < n; i++) {
          this.openDialog();
          await this.settle();
          this.closeDialog('churn');
          await this.settle();
        }
        return { before, after: this.counts() };
      },
      /**
       * Swaps the keyboard `n` times (text → numeric → text …) and reports the counts around it.
       *
       * Async because the router collects its pointer targets on the next frame after a structural
       * change: reading `pointerTargets` immediately would compare a list that has not been rebuilt yet.
       */
      swapChurn: async (n: number): Promise<{ before: unknown; after: unknown; kind: string }> => {
        await this.frame();
        const before = this.counts();
        for (let i = 0; i < n; i++) {
          // A `ref` write is frame-aligned like every other data slot, so each round waits for the frame
          // the rebuild lands on before the next one.
          this.kind.value = i % 2 === 0 ? 'numeric' : 'text';
          await this.frame();
        }
        return { before, after: this.counts(), kind: this.keyboard?.appearance.kind ?? 'none' };
      },
      /** Types a word, clears it and types it again — the leak gate for key/field churn. */
      churn: (
        n: number,
      ): {
        before: ReturnType<KeyboardScene['counts']>;
        after: ReturnType<KeyboardScene['counts']>;
      } => {
        const before = this.counts();
        for (let i = 0; i < n; i++) {
          this.field?.setValue('');
          this.keyboard?.typeChar('a');
          this.keyboard?.press('backspace');
        }
        return { before, after: this.counts() };
      },
      state: (): Record<string, unknown> => ({
        value: this.nameValue.value,
        caret: this.field?.caretIndex ?? -1,
        appearance: this.keyboard?.appearance ?? null,
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
        focusables: this.mvvm.focus.focusables.length,
        submits: this.submits,
      }),
    };
    (window as unknown as { keyboard?: unknown }).keyboard = api;
  }

  /** Resolves once nothing is animating (the modal layer is destroyed after its exit animation). */
  private settle(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.mvvm.transitions.pending === 0) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  /** A widget inside the **dialog** by debug name (the page's lookup does not see the layer). */
  private dialogByKeyboardKey(name: string): Widget | null {
    if (!this.dialogHandle) {
      return null;
    }
    let found: Widget | null = null;
    const visit = (widget: Widget): void => {
      if (widget.name === name) {
        found = widget;
      }
      for (const child of widget.getWidgetChildren()) {
        visit(child);
      }
    };
    visit(this.dialogHandle.content);
    return found;
  }

  /** A widget by debug name, or `null` — the lookup both `point(name)` and `focus(name)` use. */
  private byName(name: string): Widget | null {
    return this.allWidgets().find((candidate) => candidate.name === name) ?? null;
  }

  /** Every widget under the UI root (for `focus(name)`). */
  private allWidgets(): Widget[] {
    const found: Widget[] = [];
    const visit = (widget: Widget): void => {
      found.push(widget);
      for (const child of widget.getWidgetChildren()) {
        visit(child);
      }
    };
    visit(this.mvvm.root);
    return found;
  }
}

/** Number of widgets in a subtree, the root included. */
function countWidgets(root: Widget): number {
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
