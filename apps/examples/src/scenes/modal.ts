/**
 * `#/modal` — the standing acceptance page for `this.mvvm.modal` (the M8 overlay slice).
 *
 * A modal is tested where it is weakest: not by looking at the dialog, but by checking what the
 * dialog *prevents*. The page therefore publishes four families of probes, and each one is an
 * assertion in `docs/ACCEPTANCE-modal.md`:
 *
 * - `depth` / `top` / `focus` — the stack and the trap: while a dialog is open, the focused widget is
 *   one of the dialog's, and `Tab`/arrows cannot leave it;
 * - `page.clicks` / `world.clicks` — the shield: a click on the scrim must reach neither the page
 *   button underneath (the page publishes `blockPointer: false`, so an unshielded click would also
 *   reach the *game object* behind the UI) nor the world;
 * - `closes` — the close reason, in order (`api` vs `back` vs `backdrop`), which is how Escape and
 *   the backdrop click are told apart from a button that called `close()`;
 * - `pt.<name>` / `st.<name>` — per frame, because the page re-lays out whenever a dialog opens or a
 *   note line is added (see the `reportControl` rule in AGENTS.md §6).
 *
 * `window.modal` drives it: `open(kind)` / `close()` / `closeAll()` / `state()` / `depth()` /
 * `focusName()` / `reasons()` / `worldClicks()` / `point(kind, name)`.
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import {
  themeListenerCount,
  type ModalCloseReason,
  type ModalHandle,
  type Widget,
} from '@phaser-mvvm/phaser';
import { Button, Divider, Panel, Row, Text, TextField, ui } from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

/** The kinds of dialog the page can open; also the `window.modal.open(kind)` argument. */
export type ModalKind = 'confirm' | 'form' | 'stubborn' | 'bare' | 'nested';

const KINDS: readonly ModalKind[] = ['confirm', 'form', 'stubborn', 'bare', 'nested'];

/** Widgets of each dialog that the pixel gate samples (see `scripts/visual-check.mjs`). */
const DIALOG_PROBES: Record<ModalKind, readonly string[]> = {
  confirm: ['confirm.panel', 'confirm.cancel', 'confirm.ok'],
  form: ['form.field', 'form.ok'],
  stubborn: ['stubborn.ok'],
  bare: ['bare.ok'],
  nested: ['nested.close', 'nested.deeper'],
};

/** A game object *behind* the UI: the thing a shielded click must never reach. */
const WORLD = { width: 4000, height: 4000 };

export class ModalScene extends Phaser.Scene {
  private readonly note = ref('Nothing deleted yet.');
  private readonly field = ref('');

  private page: Widget | null = null;
  private world: Phaser.GameObjects.Rectangle | null = null;

  /** Open handles, bottom to top. */
  private readonly open: ModalHandle[] = [];
  /** Close reasons, in the order the dialogs closed. */
  private readonly reasons: ModalCloseReason[] = [];
  /** Clicks that reached the page's own buttons while a dialog was up (must stay 0). */
  private pageClicks = 0;
  private worldClicks = 0;
  private deleteCount = 0;

  /** Dialog kinds whose geometry was already appended to `#status`. */
  private readonly reported = new Set<ModalKind>();
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('modal');
  }

  create(): void {
    this.buildWorld();
    this.buildPage();
    this.exposeApi();

    setDemoState('scene', 'modal');
    appendStatus('--- modal ---');
    reportCanvas(this.game);
    this.reportGeometry();
  }

  /** A big tiled field with a click counter: proof that the shield also stops the game behind the UI. */
  private buildWorld(): void {
    const world = this.add.rectangle(0, 0, WORLD.width, WORLD.height, 0x161b22);
    world.setOrigin(0, 0);
    world.setInteractive();
    world.on('pointerdown', () => {
      this.worldClicks += 1;
    });
    this.world = world;

    for (let x = 0; x < WORLD.width; x += 200) {
      for (let y = 0; y < WORLD.height; y += 200) {
        this.add.rectangle(x + 100, y + 100, 198, 198, x % 400 === 0 ? 0x1f2630 : 0x222b36);
      }
    }
  }

  private buildPage(): void {
    const page = ui(this, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 12,
          padding: 20,
          variant: 'plain',
          width: 'fill',
          height: 'fill',
          alignItems: 'stretch',
          name: 'modal.page',
          // The world behind the page keeps its clicks, so "the modal shielded it" is observable.
          blockPointer: false,
        },
        () => {
          this.track(
            'title',
            Text('模态对话框 · modal.open()', { size: 'lg', name: 'modal.title' }),
          );

          this.track(
            'hint',
            Text('Tab/Esc 都被对话框接管；对话框打开时下面的按钮与世界都收不到点击。', {
              tone: 'muted',
              name: 'modal.hint',
            }),
          );

          Panel(
            { direction: 'vertical', gap: 10, padding: 16, variant: 'surface', radius: 10 },
            () => {
              this.track(
                'section',
                Text('打开一个对话框', { tone: 'muted', name: 'modal.section' }),
              );
              Row({ gap: 10, alignItems: 'center' }, () => {
                this.track(
                  'openConfirm',
                  Button('确认删除', {
                    variant: 'primary',
                    name: 'modal.openConfirm',
                    onClick: () => this.openDialog('confirm'),
                  }),
                );
                this.track(
                  'openForm',
                  Button('带输入框', {
                    variant: 'secondary',
                    name: 'modal.openForm',
                    onClick: () => this.openDialog('form'),
                  }),
                );
                this.track(
                  'openStubborn',
                  Button('不可关闭', {
                    variant: 'danger',
                    name: 'modal.openStubborn',
                    onClick: () => this.openDialog('stubborn'),
                  }),
                );
                this.track(
                  'openBare',
                  Button('无遮罩', {
                    variant: 'ghost',
                    name: 'modal.openBare',
                    onClick: () => this.openDialog('bare'),
                  }),
                );
                this.track(
                  'openNested',
                  Button('嵌套两层', {
                    variant: 'ghost',
                    name: 'modal.openNested',
                    onClick: () => this.openDialog('nested'),
                  }),
                );
              });
            },
          );

          Panel(
            { direction: 'vertical', gap: 8, padding: 16, variant: 'surfaceAlt', radius: 10 },
            () => {
              this.track('under', Text('对话框下面的按钮', { tone: 'muted', name: 'modal.under' }));
              Row({ gap: 10 }, () => {
                this.track(
                  'page.a',
                  Button('下面的 A', {
                    variant: 'secondary',
                    name: 'modal.pageA',
                    onClick: () => {
                      this.pageClicks += 1;
                    },
                  }),
                );
                this.track(
                  'page.b',
                  Button('下面的 B', {
                    variant: 'secondary',
                    name: 'modal.pageB',
                    onClick: () => {
                      this.pageClicks += 1;
                    },
                  }),
                );
              });
            },
          );

          Panel(
            {
              direction: 'vertical',
              gap: 8,
              padding: 16,
              variant: 'surface',
              radius: 10,
              width: 520,
            },
            () => {
              this.track('log', Text('关闭记录', { tone: 'muted', name: 'modal.log' }));
              Divider({});
              this.track(
                'note',
                Text(() => this.note.value, { name: 'modal.note', maxLines: 3, ellipsis: true }),
              );
              this.track(
                'logLine',
                Text(() => this.logText(), { tone: 'muted', name: 'modal.logLine' }),
              );
            },
          );
        },
      );
    });

    this.page = page;
    // `render()`-style mount: the page is the whole scene UI, appended to the plugin's UI root.
    this.mvvm.mount(page);
  }

  /** Opens one of the demo dialogs; also the `window.modal.open(kind)` entry point. */
  openDialog(kind: ModalKind): ModalHandle {
    const handle = this.buildDialog(kind);
    this.reportDialog(kind, handle);
    return this.remember(handle);
  }

  /**
   * Appends one dialog's own geometry to `#status`, **once per kind**.
   *
   * `scripts/visual-check.mjs` samples pixels inside an open dialog (the danger fill of `confirm.ok`
   * and the dialog surface showing through the transparent ghost `confirm.cancel`), and it can only
   * do that from `#status`. Reporting on every open would grow the block without adding a sample, so
   * only the first open of each kind reports.
   */
  private reportDialog(kind: ModalKind, handle: ModalHandle): void {
    if (this.reported.has(kind)) {
      return;
    }
    this.reported.add(kind);
    for (const name of DIALOG_PROBES[kind]) {
      const widget = findByName(handle.widget, name);
      if (widget) {
        reportWidget(name, widget);
      }
    }
  }

  private buildDialog(kind: ModalKind): ModalHandle {
    const base = { onClose: (reason: ModalCloseReason) => this.recordClose(reason) };

    switch (kind) {
      case 'confirm':
        return this.remember(
          this.mvvm.modal.open(
            () => {
              Panel(
                {
                  direction: 'vertical',
                  gap: 14,
                  padding: 20,
                  variant: 'surface',
                  radius: 12,
                  width: 420,
                  name: 'confirm.panel',
                },
                () => {
                  Text('删除这一项？', { size: 'lg', name: 'confirm.title' });
                  Text('删除后无法恢复。按 Esc 或点遮罩可以取消。', {
                    tone: 'muted',
                    name: 'confirm.body',
                    maxLines: 2,
                  });
                  Row({ gap: 8, justifyContent: 'end' }, () => {
                    this.track(
                      'confirm.cancel',
                      Button('取消', {
                        variant: 'ghost',
                        name: 'confirm.cancel',
                        onClick: () => this.mvvm.modal.closeTop('api'),
                      }),
                    );
                    this.track(
                      'confirm.ok',
                      Button('删除', {
                        variant: 'danger',
                        name: 'confirm.ok',
                        onClick: () => {
                          this.deleteCount += 1;
                          this.note.value = `Deleted ${this.deleteCount} item(s).`;
                          this.mvvm.modal.closeTop('api');
                        },
                      }),
                    );
                  });
                },
              );
            },
            { name: 'modal.confirm', ...base },
          ),
        );

      case 'form':
        return this.remember(
          this.mvvm.modal.open(
            () => {
              Panel(
                {
                  direction: 'vertical',
                  gap: 12,
                  padding: 20,
                  variant: 'surface',
                  radius: 12,
                  width: 460,
                },
                () => {
                  Text('重命名', { size: 'lg', name: 'form.title' });
                  this.track(
                    'form.field',
                    TextField({ name: 'form.field', value: this.field, placeholder: '新的名字' }),
                  );
                  Row({ gap: 8, justifyContent: 'end' }, () => {
                    this.track(
                      'form.cancel',
                      Button('取消', {
                        variant: 'ghost',
                        name: 'form.cancel',
                        onClick: () => this.mvvm.modal.closeTop('api'),
                      }),
                    );
                    this.track(
                      'form.ok',
                      Button('保存', {
                        variant: 'primary',
                        name: 'form.ok',
                        onClick: () => {
                          this.note.value = `Renamed to "${this.field.value || '(empty)'}".`;
                          this.mvvm.modal.closeTop('api');
                        },
                      }),
                    );
                  });
                },
              );
            },
            { name: 'modal.form', ...base },
          ),
        );

      case 'stubborn':
        return this.remember(
          this.mvvm.modal.open(
            () => {
              Panel(
                {
                  direction: 'vertical',
                  gap: 14,
                  padding: 20,
                  variant: 'surface',
                  radius: 12,
                  width: 400,
                },
                () => {
                  Text('必须回答', { size: 'lg', name: 'stubborn.title' });
                  Text('Esc 与遮罩都关不掉它；只有“知道了”可以。', { tone: 'muted' });
                  Row({ gap: 8, justifyContent: 'end' }, () => {
                    this.track(
                      'stubborn.ok',
                      Button('知道了', {
                        variant: 'primary',
                        name: 'stubborn.ok',
                        onClick: () => this.mvvm.modal.closeTop('api'),
                      }),
                    );
                  });
                },
              );
            },
            { name: 'modal.stubborn', dismissible: false, ...base },
          ),
        );

      case 'bare':
        return this.remember(
          this.mvvm.modal.open(
            () => {
              Panel(
                {
                  direction: 'vertical',
                  gap: 10,
                  padding: 20,
                  variant: 'surfaceAlt',
                  radius: 12,
                  width: 360,
                },
                () => {
                  Text('没有遮罩', { size: 'lg', name: 'bare.title' });
                  Text('点击对话框外面依然会关闭，但页面与世界仍然收不到这次点击。', {
                    tone: 'muted',
                    maxLines: 3,
                  });
                  Row({ gap: 8, justifyContent: 'end' }, () => {
                    this.track(
                      'bare.ok',
                      Button('关闭', {
                        variant: 'secondary',
                        name: 'bare.ok',
                        onClick: () => this.mvvm.modal.closeTop('api'),
                      }),
                    );
                  });
                },
              );
            },
            { name: 'modal.bare', scrim: 0, ...base },
          ),
        );

      case 'nested':
      default:
        return this.remember(
          this.mvvm.modal.open(
            () => {
              Panel(
                {
                  direction: 'vertical',
                  gap: 14,
                  padding: 20,
                  variant: 'surface',
                  radius: 12,
                  width: 420,
                },
                () => {
                  Text('第一层', { size: 'lg', name: 'nested.title' });
                  Text('再打开一层，Esc 只会关掉最上面那层。', { tone: 'muted', maxLines: 2 });
                  Row({ gap: 8, justifyContent: 'end' }, () => {
                    this.track(
                      'nested.close',
                      Button('关闭', {
                        variant: 'ghost',
                        name: 'nested.close',
                        onClick: () => this.mvvm.modal.closeTop('api'),
                      }),
                    );
                    this.track(
                      'nested.deeper',
                      Button('再开一层', {
                        variant: 'primary',
                        name: 'nested.deeper',
                        onClick: () => this.openSecondLayer(),
                      }),
                    );
                  });
                },
              );
            },
            { name: 'modal.nested', ...base },
          ),
        );
    }
  }

  /** The dialog the nested case opens on top of the first one. */
  private openSecondLayer(): ModalHandle {
    return this.remember(
      this.mvvm.modal.open(
        () => {
          Panel(
            {
              direction: 'vertical',
              gap: 14,
              padding: 20,
              variant: 'surfaceAlt',
              radius: 12,
              width: 380,
            },
            () => {
              Text('第二层', { size: 'lg', name: 'second.title' });
              Text('最上面这层能点到；下面那层既点不到，也不在焦点集合里。', {
                tone: 'muted',
                maxLines: 3,
              });
              Row({ gap: 8, justifyContent: 'end' }, () => {
                this.track(
                  'second.ok',
                  Button('返回', {
                    variant: 'primary',
                    name: 'second.ok',
                    onClick: () => this.mvvm.modal.closeTop('api'),
                  }),
                );
              });
            },
          );
        },
        { name: 'modal.second', onClose: (reason) => this.recordClose(reason) },
      ),
    );
  }

  private remember(handle: ModalHandle): ModalHandle {
    this.open.push(handle);
    return handle;
  }

  private recordClose(reason: ModalCloseReason): void {
    this.reasons.push(reason);
    // Handles are closed in stack order, so the list only has to drop the ones that are gone.
    for (let i = this.open.length - 1; i >= 0; i--) {
      if (this.open[i]?.open !== true) {
        this.open.splice(i, 1);
      }
    }
  }

  private logText(): string {
    if (this.reasons.length === 0) {
      return 'no dialog closed yet';
    }
    return `closed: ${this.reasons.join(', ')}`;
  }

  /** Per-frame probes: `pt.*`/`st.*` for every named control, and the stack/click counters. */
  override update(): void {
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed) {
        // Say so instead of leaving the last value behind: a check that reads `st.confirm.ok` right
        // after the dialog closed used to see a stale `pressed`, which reads like a stuck state.
        this.publish(`st.${key}`, 'gone');
        continue;
      }
      this.publish(`st.${key}`, widget.visualState);
      if (!widget.visible || widget.appliedRect.width <= 0 || widget.appliedRect.height <= 0) {
        continue;
      }
      const canvas = this.game.canvas.getBoundingClientRect();
      const origin = stagePosition(widget);
      this.publish(
        `pt.${key}`,
        `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
          canvas.top + origin.y + widget.appliedRect.height / 2,
        )}`,
      );
    }

    this.publish('depth', this.mvvm.modal.depth);
    this.publish('top', this.mvvm.modal.top?.widget.name ?? 'none');
    this.publish('focus', this.mvvm.focus.focusedWidget?.name || 'none');
    this.publish('page.clicks', this.pageClicks);
    this.publish('world.clicks', this.worldClicks);
    this.publish('deletes', this.deleteCount);
    this.publish('closes', this.reasons.length === 0 ? 'none' : this.reasons.join(','));
    this.publish(
      'focusables',
      this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed').join('+'),
    );

    // Leak probes: opening and closing a dialog must give every one of them back. `themeListeners`
    // is the sharpest of the four - every `Widget` subscribes on construction - and `widgets` counts
    // the whole live tree below the UI root.
    const counts = this.counts();
    this.publish('counts.widgets', counts.widgets);
    this.publish('counts.themeListeners', counts.themeListeners);
    this.publish('counts.pointerTargets', counts.pointerTargets);
    this.publish('counts.focusables', counts.focusables);
  }

  /** Live-object counters used as the leak gate of `docs/ACCEPTANCE-modal.md` §6. */
  counts(): {
    widgets: number;
    themeListeners: number;
    pointerTargets: number;
    focusables: number;
  } {
    return {
      widgets: this.page ? countWidgets(this.page) + this.mvvm.modal.depth : 0,
      themeListeners: themeListenerCount(),
      pointerTargets: this.mvvm.input.widgets.length,
      focusables: this.mvvm.focus.focusables.length,
    };
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  private track(key: string, widget: Widget): Widget {
    this.tracked.set(key, widget);
    return widget;
  }

  private reportGeometry(): void {
    if (this.page) {
      reportWidget('modal.page', this.page);
    }
    if (this.world) {
      appendStatus(`modal.world=${WORLD.width}x${WORLD.height}`);
    }
  }

  /** The in-page API an acceptance run drives the page with. */
  private exposeApi(): void {
    const api = {
      kinds: (): readonly ModalKind[] => KINDS,
      open: (kind: ModalKind): number => this.openDialog(kind).id,
      /** Opens a dialog and returns the page coordinates of one of its controls. */
      point: (kind: ModalKind, name: string): string => {
        const handle = this.openDialog(kind);
        const widget = findByName(handle.widget, name);
        if (!widget) {
          return 'none';
        }
        const canvas = this.game.canvas.getBoundingClientRect();
        const origin = stagePosition(widget);
        return `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
          canvas.top + origin.y + widget.appliedRect.height / 2,
        )}`;
      },
      close: (): boolean => this.mvvm.modal.closeTop('api'),
      closeAll: (): void => this.mvvm.modal.closeAll('api'),
      depth: (): number => this.mvvm.modal.depth,
      names: (): string[] => this.mvvm.modal.handles.map((handle) => handle.widget.name ?? ''),
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      reasons: (): ModalCloseReason[] => [...this.reasons],
      pageClicks: (): number => this.pageClicks,
      worldClicks: (): number => this.worldClicks,
      deletes: (): number => this.deleteCount,
      note: (): string => this.note.value,
      field: (): string => this.field.value,
      counts: () => this.counts(),
      /** Opens and closes `n` dialogs, returning the counters before/after (the leak gate). */
      churn: (
        n: number,
      ): { before: ReturnType<ModalScene['counts']>; after: ReturnType<ModalScene['counts']> } => {
        const before = this.counts();
        for (let i = 0; i < n; i++) {
          this.openDialog(i % 2 === 0 ? 'confirm' : 'form');
          this.mvvm.modal.closeAll('api');
        }
        return { before, after: this.counts() };
      },
      /** Names every widget of the modal stack, for a quick structural read in a check. */
      stack: (): string[] =>
        this.mvvm.modal.handles.map((handle) => names(handle.widget).join('/')),
      state: (): Record<string, unknown> => ({
        depth: this.mvvm.modal.depth,
        top: this.mvvm.modal.top?.widget.name ?? 'none',
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
        focusables: this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
        pageClicks: this.pageClicks,
        worldClicks: this.worldClicks,
        deletes: this.deleteCount,
        reasons: [...this.reasons],
        note: this.note.value,
        field: this.field.value,
      }),
    };
    (window as unknown as { modal?: unknown }).modal = api;
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

/** Depth-first search for a named widget inside a modal layer. */
function findByName(root: Widget, name: string): Widget | null {
  if (root.name === name) {
    return root;
  }
  for (const child of root.getWidgetChildren()) {
    const found = findByName(child, name);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Every name in a subtree, parents before children. */
function names(root: Widget): string[] {
  const found: string[] = [];
  const visit = (widget: Widget): void => {
    found.push(widget.name || 'unnamed');
    for (const child of widget.getWidgetChildren()) {
      visit(child);
    }
  };
  visit(root);
  return found;
}
