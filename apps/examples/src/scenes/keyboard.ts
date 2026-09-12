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
import { buildUiSubtree, themeListenerCount, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Divider,
  Panel,
  Row,
  Text,
  TextField,
  VirtualKeyboard,
  ui,
} from '@phaser-mvvm/widgets/compose';
import type { VirtualKeyboardOptions, VirtualKeyboardWidget } from '@phaser-mvvm/widgets';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

export class KeyboardScene extends Phaser.Scene {
  private readonly note = ref('用方向键走到按键上，按 A 输入；Enter 提交。');
  private readonly nameValue = ref('');

  private page: Widget | null = null;
  /** The panel the keyboard lives in (a `Widget`, not a Phaser `Container`, for `addWidget`). */
  private keyboardHost: Widget | null = null;
  private field: ReturnType<typeof TextField> | null = null;
  private keyboard: VirtualKeyboardWidget | null = null;
  private submits = 0;

  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('keyboard');
  }

  create(): void {
    const page = ui(this, () => {
      const panel = Panel(
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

          const keyboard = VirtualKeyboard(this.keyboardOptions('text'));
          this.keyboard = keyboard;
          this.track('keyboard', keyboard);
          for (const row of keyboard.slots()) {
            for (const slot of row) {
              const key = keyboard.keyOf(slot.id);
              if (key) {
                this.track(`k.${slot.id}`, key);
              }
            }
          }

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
                onClick: () => this.swapKeyboard('numeric'),
              }),
            );
            this.track(
              'text',
              Button('切回文字键盘', {
                variant: 'secondary',
                name: 'kb.text',
                onClick: () => this.swapKeyboard('text'),
              }),
            );
          });
        },
      );
      // The panel is the keyboard's host: swapping keyboards adds the new one here and drops the old.
      this.keyboardHost = panel;
    });

    this.page = page;
    this.mvvm.mount(page);
    this.exposeApi();

    setDemoState('scene', 'keyboard');
    appendStatus('--- keyboard ---');
    reportCanvas(this.game);
  }

  /**
   * The options both keyboard constructions share.
   *
   * One factory rather than two literals: the swapped-in keyboard is built by a different code path (a
   * click handler, outside the page's build pass) and must behave identically — the first version of this
   * page rebuilt it without `onSubmit`, so Enter worked until the player switched pages.
   */
  private keyboardOptions(kind: 'text' | 'numeric'): VirtualKeyboardOptions {
    return {
      target: () => this.field,
      kind,
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
   * Replaces the keyboard with the other kind.
   *
   * The two kinds have different key sets (a numpad has no letters), so this is a rebuild rather than a
   * re-label — the same thing a page would do when it switches from "name" to "PIN".
   */
  private swapKeyboard(kind: 'text' | 'numeric'): void {
    const current = this.keyboard;
    if (!current || !this.page) {
      return;
    }
    if (current.appearance.kind === kind) {
      return;
    }
    for (const id of [...this.tracked.keys()]) {
      if (id.startsWith('k.')) {
        this.tracked.delete(id);
        this.published.delete(`pt.kb.${id.slice(2)}`);
        this.published.delete(`st.kb.${id.slice(2)}`);
      }
    }
    // Built outside the page's build pass (a click handler runs later), so it needs its own scope:
    // `buildUiSubtree()` gives the DSL a scene to attach to and returns the one root it built. Without
    // it `currentUiScene()` throws, and the keys would have no container to adopt them.
    //
    // The options come from *one* factory for both paths (`keyboardOptions`): a rebuilt keyboard that
    // silently lost `onSubmit` would look like "Enter stopped working after switching to the numpad".
    const replacement = buildUiSubtree(
      this,
      () => VirtualKeyboard(this.keyboardOptions(kind)),
      'swapKeyboard(): the replacement keyboard',
    ) as VirtualKeyboardWidget;
    // `parentContainer` is a Phaser container; the host is the *widget* the DSL built, which is what
    // knows how to add and remove children (`Widget#addWidget`/`removeWidget`).
    this.keyboardHost?.addWidget(replacement);
    this.keyboardHost?.removeWidget(current, true);
    this.keyboard = replacement;
    this.tracked.set('keyboard', replacement);
    for (const row of replacement.slots()) {
      for (const slot of row) {
        const key = replacement.keyOf(slot.id);
        if (key) {
          this.track(`k.${slot.id}`, key);
        }
      }
    }
    this.note.value = kind === 'numeric' ? '数字键盘' : '文字键盘';
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
          this.swapKeyboard(i % 2 === 0 ? 'numeric' : 'text');
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

  /** Waits for the next frame, so the counts are read after the framework's own per-frame collection. */
  private frame(): Promise<void> {
    return new Promise((resolve) => {
      this.game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve());
    });
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
