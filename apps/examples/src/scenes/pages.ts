/**
 * `#/pages` — the standing acceptance page for `this.mvvm.pages` (the page stack).
 *
 * What a page stack has to get right is not "a page appeared" but **what happens to the page you left**:
 * its widgets must survive (a scrolled list stays scrolled, a half-typed field keeps its text), it must
 * stop receiving input and focus, and `back` must walk the stack in the right order. So the page
 * publishes probes for all of it:
 *
 * - `depth` / `names` / `top` — the stack itself;
 * - `list.offset` / `clicks` / `field` — state of the *base* page, sampled while another page is on top
 *   (`pt.*` for the base page goes stale on purpose: it is hidden, so the check reads the API instead);
 * - `resumes` / `disposes` / `events` — the lifecycle hooks, in order (`resume:detail,pause:list,…`);
 * - `appBacks` — how often `back` fell all the way through to `mvvm.onBack` (only true on the base page);
 * - `counts.*` — the leak gate (`widgets`/`themeListeners`/`pointerTargets`/`focusables`);
 * - `pt.*` / `st.*` — per frame, for whatever is currently visible.
 *
 * `window.pages` drives it: `open(i)` / `deeper()` / `pop()` / `popToRoot()` / `openDialog()` /
 * `scrollList(y)` / `listOffset()` / `state()` / `names()` / `counts()` / `churn(n)`.
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import { themeListenerCount, type Widget } from '@phaser-mvvm/phaser';
import { Button, List, Panel, Row, Scroll, Text, TextField } from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

interface Row {
  id: number;
  name: string;
}

const ROWS: readonly Row[] = Array.from({ length: 14 }, (_, index) => ({
  id: index + 1,
  name: `条目 ${index + 1}`,
}));

export class PagesScene extends Phaser.Scene {
  private readonly clicks = ref(0);
  private readonly field = ref('');
  private readonly note = ref('');

  /** How often `back` fell through every layer to `mvvm.onBack` (only true on the base page). */
  private appBacks = 0;
  private resumeCount = 0;
  private disposeCount = 0;

  private basePage: Widget | null = null;

  /** Lifecycle trace; not `events`, which is `Phaser.Scene`'s own EventEmitter. */
  private readonly log: string[] = [];
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('pages');
  }

  create(): void {
    // The app-level handler: reached only when no modal and no page claimed the key. This is the field
    // the guide points at — `focus.onBack` belongs to the plugin's router (see V20).
    this.mvvm.onBack = () => {
      this.appBacks += 1;
    };

    this.openBasePage();
    this.exposeApi();

    setDemoState('scene', 'pages');
    appendStatus('--- pages ---');
    reportCanvas(this.game);
  }

  /** The base page: a scrolled list plus a form, so "state survives a page push" is observable. */
  private openBasePage(): void {
    const handle = this.mvvm.pages.push(
      () => {
        Panel(
          {
            direction: 'vertical',
            gap: 12,
            padding: 20,
            variant: 'surface',
            radius: 12,
            width: 560,
            name: 'list.page',
          },
          () => {
            this.track('title', Text('页面栈 · pages.push()', { size: 'lg', name: 'list.title' }));
            this.track(
              'hint',
              Text('点一行进入详情页；Esc 或“返回”回到这里 —— 滚动位置、计数与输入都不丢。', {
                tone: 'muted',
                name: 'list.hint',
                maxLines: 2,
              }),
            );

            this.track(
              'clicks',
              Button(() => `点我 ${this.clicks.value} 次`, {
                variant: 'secondary',
                name: 'list.counter',
                onClick: () => {
                  this.clicks.value += 1;
                },
              }),
            );

            this.track(
              'field',
              TextField({ name: 'list.field', value: this.field, placeholder: '随便打点字' }),
            );
            this.track('field2', TextField({ name: 'list.field2', placeholder: '第二个输入框' }));

            this.track(
              'list',
              Scroll({ height: 168, name: 'list.scroll' }, () => {
                List({ items: () => ROWS, key: (row: Row) => row.id, gap: 6 }, (row: Row) => {
                  // Rows are tracked too: a row scrolled out of the port is *clipped*, and the probes
                  // are what make "a clipped row must not hover or click" observable.
                  this.track(
                    `row.${row.id}`,
                    Button(`${row.name} ›`, {
                      name: `row.${row.id}`,
                      variant: 'ghost',
                      onClick: () => this.pushDetail(row),
                    }),
                  );
                });
              }),
            );

            this.track(
              'events',
              Text(() => this.note.value, { tone: 'muted', name: 'list.events', maxLines: 2 }),
            );
          },
        );
      },
      {
        name: 'list',
        onResume: () => this.record(`resume:list`),
        onPause: () => this.record(`pause:list`),
        onDispose: () => this.record(`dispose:list`),
      },
    );

    this.basePage = handle.widget;
    this.reportBasePage(handle.widget);
  }

  /** Pushes the detail page for a row; also the `window.pages.open(i)` entry point. */
  pushDetail(row: Row): void {
    this.mvvm.pages.push(
      () => {
        Panel(
          {
            direction: 'vertical',
            gap: 12,
            padding: 20,
            variant: 'surface',
            radius: 12,
            width: 460,
            name: 'detail.page',
          },
          () => {
            this.track('title', Text(`详情 · ${row.name}`, { size: 'lg', name: 'detail.title' }));
            this.track(
              'back',
              Button('返回列表', {
                variant: 'secondary',
                name: 'detail.back',
                onClick: () => this.mvvm.pages.pop(),
              }),
            );
            this.track(
              'deeper',
              Button('再进一层', {
                variant: 'primary',
                name: 'detail.deeper',
                onClick: () => this.pushDeeper(row.name),
              }),
            );
            this.track(
              'dialog',
              Button('打开对话框', {
                variant: 'ghost',
                name: 'detail.dialog',
                onClick: () => this.openDialog(),
              }),
            );
            this.track(
              'events',
              Text(() => this.note.value, { tone: 'muted', name: 'detail.events', maxLines: 2 }),
            );
          },
        );
      },
      {
        name: `detail:${row.id}`,
        onResume: () => this.record(`resume:detail`),
        onPause: () => this.record(`pause:detail`),
        onDispose: () => this.record(`dispose:detail`),
      },
    );
  }

  /** A third level, to prove the stack is a stack (Esc closes one layer at a time). */
  private pushDeeper(from: string): void {
    this.mvvm.pages.push(
      () => {
        Panel(
          {
            direction: 'vertical',
            gap: 12,
            padding: 20,
            variant: 'surfaceAlt',
            radius: 12,
            width: 400,
            name: 'deeper.page',
          },
          () => {
            this.track('title', Text(`第三层 · ${from}`, { size: 'lg', name: 'deeper.title' }));
            this.track(
              'back',
              Button('返回上一层', {
                variant: 'secondary',
                name: 'deeper.back',
                onClick: () => this.mvvm.pages.pop(),
              }),
            );
            this.track(
              'root',
              Button('回列表', {
                variant: 'ghost',
                name: 'deeper.root',
                onClick: () => this.mvvm.pages.popToRoot(),
              }),
            );
          },
        );
      },
      {
        name: 'deeper',
        onResume: () => this.record('resume:deeper'),
        onPause: () => this.record('pause:deeper'),
        onDispose: () => this.record('dispose:deeper'),
      },
    );
  }

  /** A dialog on top of the current page: `Escape` must close the dialog first, the page second. */
  private openDialog(): void {
    const dialog = this.mvvm.modal.open(
      () => {
        Panel(
          {
            direction: 'vertical',
            gap: 12,
            padding: 18,
            variant: 'surface',
            radius: 10,
            width: 360,
          },
          () => {
            Text('对话框叠在页面上', { size: 'lg', name: 'dialog.title' });
            Text('第一次 Esc 关掉这里，第二次才返回上一层。', { tone: 'muted', maxLines: 2 });
            Row({ gap: 8, justifyContent: 'end' }, () => {
              this.track(
                'dialog.close',
                Button('知道了', {
                  variant: 'primary',
                  name: 'dialog.close',
                  onClick: () => dialog.close(),
                }),
              );
            });
          },
        );
      },
      { name: 'pages.dialog' },
    );
  }

  /** Per-frame probe publish — the layout moves whenever the stack changes. */
  override update(): void {
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed) {
        // Say so instead of leaving the last value behind: a check that reads `st.confirm.ok` right
        // after the dialog closed used to see a stale `pressed`, which reads like a stuck state.
        this.publish(`st.${key}`, 'gone');
        continue;
      }
      this.publish(`st.${key}`, widget.visualState);
      // Only the visible page has usable coordinates; a hidden page's rect is stale by design.
      if (!widget.visible || widget.appliedRect.width <= 0 || widget.appliedRect.height <= 0) {
        continue;
      }
      this.publish(
        `pt.${key}`,
        `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
          pagePoint(this.game, widget).y,
        )}`,
      );
    }

    const counts = this.counts();
    this.publish('depth', this.mvvm.pages.depth);
    this.publish('top', this.mvvm.pages.top?.name ?? 'none');
    this.publish('focus', this.mvvm.focus.focusedWidget?.name || 'none');
    this.publish('clicks', this.clicks.value);
    this.publish('field.length', this.field.value.length);
    this.publish('list.offset', this.listOffsetNow());
    this.publish('appBacks', this.appBacks);
    this.publish('resumes', this.resumeCount);
    this.publish('disposes', this.disposeCount);
    this.publish('counts.widgets', counts.widgets);
    this.publish('counts.themeListeners', counts.themeListeners);
    this.publish('counts.pointerTargets', counts.pointerTargets);
    this.publish('counts.focusables', counts.focusables);
    this.publish(
      'focusables',
      this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed').join('+'),
    );
  }

  /** Live-object counters used as the leak gate. */
  counts(): {
    widgets: number;
    themeListeners: number;
    pointerTargets: number;
    focusables: number;
  } {
    let widgets = 0;
    for (const handle of this.mvvm.pages.handles) {
      if (!handle.widget.isDestroyed) {
        widgets += countWidgets(handle.widget);
      }
    }
    return {
      widgets,
      themeListeners: themeListenerCount(),
      pointerTargets: this.mvvm.input.widgets.length,
      focusables: this.mvvm.focus.focusables.length,
    };
  }

  /** The base page's scroll view; `null` before the page exists (or after it was destroyed). */
  private scrollView(): {
    scrollTo(target: number | 'top' | 'bottom'): unknown;
    offset: number;
  } | null {
    if (!this.basePage || this.basePage.isDestroyed) {
      return null;
    }
    const found = findByName(this.basePage, 'list.scroll');
    return (
      (found as unknown as {
        scrollTo(target: number | 'top' | 'bottom'): unknown;
        offset: number;
      } | null) ?? null
    );
  }

  private listOffsetNow(): number {
    const scroll = this.scrollView();
    return scroll && typeof scroll.offset === 'number' ? Math.round(scroll.offset) : 0;
  }

  private record(event: string): void {
    this.log.push(event);
    if (event.startsWith('resume')) {
      this.resumeCount += 1;
    } else if (event.startsWith('dispose')) {
      this.disposeCount += 1;
    }
    this.note.value = this.log.slice(-4).join(' · ');
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

  /** Appends the base page's geometry once: it is the page the pixel gate looks at. */
  private reportBasePage(root: Widget): void {
    for (const name of ['list.page', 'list.counter', 'list.field']) {
      const widget = findByName(root, name);
      if (widget) {
        reportWidget(name, widget);
      }
    }
  }

  private exposeApi(): void {
    const api = {
      rows: (): number => ROWS.length,
      /** Pushes the detail page for row `index` (1-based, like the row ids). */
      open: (index: number): string => {
        const row = ROWS[index - 1];
        if (!row) {
          return 'unknown';
        }
        this.pushDetail(row);
        return this.mvvm.pages.top?.name ?? 'none';
      },
      deeper: (): string => {
        const top = this.mvvm.pages.top;
        this.pushDeeper(top?.name ?? 'list');
        return this.mvvm.pages.top?.name ?? 'none';
      },
      dialog: (): string => {
        this.openDialog();
        return this.mvvm.modal.top?.widget.name ?? 'none';
      },
      pop: (): boolean => this.mvvm.pages.pop(),
      popToRoot: (): void => this.mvvm.pages.popToRoot(),
      depth: (): number => this.mvvm.pages.depth,
      names: (): string[] => this.mvvm.pages.names(),
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      events: (): string[] => [...this.log],
      appBacks: (): number => this.appBacks,
      clicks: (): number => this.clicks.value,
      field: (): string => this.field.value,
      listOffset: (): number => this.listOffsetNow(),
      /**
       * Page coordinates of a named widget **of the page on top**, computed on demand.
       *
       * `pt.*` is published per frame only for widgets that are currently visible, and a page that is
       * covered by another one is hidden on purpose — so a check that wants to click something on the
       * page underneath right after a `pop()` reads the point here instead of trusting a stale probe.
       */
      point: (name: string): string => {
        const top = this.mvvm.pages.top;
        const widget = top ? findByName(top.widget, name) : null;
        if (!widget || widget.appliedRect.width <= 0) {
          return 'none';
        }
        return `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
          pagePoint(this.game, widget).y,
        )}`;
      },
      /** Scrolls the base page's list — the state a push/pop round trip has to preserve. */
      scrollList: (y: number): number => {
        const scroll = this.scrollView();
        scroll?.scrollTo(y);
        return this.listOffsetNow();
      },
      counts: () => this.counts(),
      /**
       * Exercises the shared "what may a view lambda produce" rule on the page path.
       *
       * `ui()`, `modal.open()` and `pages.push()` all go through `buildUiPage()`: zero roots is a
       * loud error, one root is the normal case, several roots are wrapped in a Column with a
       * development warning. The rule is asserted here because it is the one thing the three callers
       * share, and it used to exist three times.
       */
      viewLambdaRule: (): { multi: Record<string, unknown>; empty: string } => {
        const pushed = this.mvvm.pages.push(
          () => {
            Text('第一个根');
            Text('第二个根');
          },
          { name: 'multi-root' },
        );
        const multi = {
          container: pushed.widget.constructor.name,
          children: pushed.widget.getWidgetChildren().length,
          name: pushed.name,
        };
        this.mvvm.pages.pop();

        let empty = 'no error';
        try {
          this.mvvm.pages.push(() => {
            // deliberately builds nothing
          });
        } catch (error) {
          empty = error instanceof Error ? error.message : String(error);
        }
        return { multi, empty };
      },
      /** Push/pop `n` pages: every counter must come back to where it started. */
      churn: (n: number) => {
        const before = this.counts();
        for (let i = 0; i < n; i++) {
          this.pushDetail(ROWS[i % ROWS.length] as Row);
          this.mvvm.pages.pop();
        }
        return { before, after: this.counts(), events: this.log.length };
      },
      state: (): Record<string, unknown> => ({
        depth: this.mvvm.pages.depth,
        names: this.mvvm.pages.names(),
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
        clicks: this.clicks.value,
        field: this.field.value,
        listOffset: this.listOffsetNow(),
        appBacks: this.appBacks,
        resumes: this.resumeCount,
        disposes: this.disposeCount,
        events: [...this.log],
      }),
    };
    (window as unknown as { pages?: unknown }).pages = api;
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

/** Depth-first search for a named widget. */
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
