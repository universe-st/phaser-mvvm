/**
 * `#/uiscene` — the acceptance page for `UIScene`, the `setContent { … }` of this framework.
 *
 * A `UIScene` subclass writes one method (`content()`) and gets a built+mounted page; `setContent()`
 * replaces it. Both halves need proof that cannot be read off the source:
 *
 * | claim                                          | how the page proves it                                                               |
 * | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
 * | `content()` is built **and mounted**           | the page appears on load, with no `render()`/`mount()` call anywhere in the scene     |
 * | the view is one tree (no implicit wrapper)     | `roots=1` and `container=Panel` for views A/B, published every frame                  |
 * | `setContent()` really **destroys** the old view | `prev.destroyed=1` right after a swap, and every leak counter returns to baseline     |
 * | several roots are wrapped, not rejected        | the `Multi-root` view reports `roots=3` and `container=BoxWidget`                     |
 * | the view is rebuilt, the scene survives        | `built`/`focusables` follow the view while `swaps`/`a.clicks` keep counting            |
 * | a swap leaks nothing                           | `swap(n)` returns the counters before/after (`themeListeners`, `displayList`, …)       |
 * | the new view is interactive immediately        | a button that swaps the page is itself destroyed by the swap — it still works, once   |
 * | `onBack()` is first refusal, then the app      | Escape with the hook on/off moves `hookBacks` or `appBacks`, never both               |
 * | a modal still owns Escape first                | with a dialog open, Escape closes it and **neither** counter moves                    |
 *
 * `window.uiscene` drives all of it: `show(name)`/`swap(n)`/`state()`/`counts()`/`back()`/`setHook(on)`
 * /`dialog()`. The leak counters are the same set `#/lifecycle` samples.
 */

import { ref } from '@phaser-mvvm/core';
import { themeListenerCount, UIScene, type Widget } from '@phaser-mvvm/phaser';
import {
  Button,
  Divider,
  Panel,
  Row,
  Slider,
  Spacer,
  Text,
  TextField,
} from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { reportCanvas, reportWidget, setStatus, stagePosition } from '../status';

type ViewName = 'a' | 'b' | 'multi';

interface Counts {
  widgets: number;
  themeListeners: number;
  displayList: number;
  focusables: number;
  pointerTargets: number;
  a11yNodes: number;
}

export class UiSceneScene extends UIScene {
  // ------------------------------------------------------- view model (survives a swap)

  private readonly view = ref<ViewName>('a');
  private readonly swaps = ref(0);
  private readonly hookConsumes = ref(true);
  private readonly aClicks = ref(0);
  private readonly bVolume = ref(40);
  private readonly bResets = ref(0);
  private readonly name = ref('张三');

  // ------------------------------------------------------- scene state (not rebuilt)

  private hookBacks = 0;
  private appBacks = 0;
  private closes = 0;
  /** Controls whose page coordinates are republished every frame, rebuilt with each `content()`. */
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();
  /** The page the last `setContent()` replaced, kept only to publish whether it really died. */
  private previousPage: Widget | null = null;

  constructor() {
    super('uiscene');
  }

  /**
   * The whole view. `create()` below is what mounts it.
   *
   * Two rules that only show up in practice:
   * - the app-level `back` handler is assigned here, on a *scene* field (`mvvm.onBack`), so it survives
   *   every swap — a handler assigned to a widget would go away with the widget;
   * - `tracked` is cleared, because the widgets of the previous view are about to be destroyed and a
   *   stale entry would only ever publish `gone`.
   */
  content(): void {
    this.mvvm.onBack = () => {
      this.appBacks += 1;
    };
    this.tracked.clear();
    this.buildView(this.view.value);
  }

  /** `super.create()` is what builds and mounts {@link content}; the rest is this page's own wiring. */
  override create(): void {
    super.create();
    this.install();
  }

  // ------------------------------------------------------- the three views

  /** One of the three views, plus the shared control row and readout. */
  private buildView(name: ViewName): void {
    if (name === 'multi') {
      // Three roots on purpose: `buildUiPage()` warns and wraps them in a vertical container, which is
      // what `roots=3`/`container=BoxWidget` in the readout is about.
      Text('第一个根', { name: 'multi.one' });
      Button('第二个根', {
        name: 'multi.two',
        variant: 'secondary',
        onClick: () => {
          this.aClicks.value += 1;
        },
      });
      Text('第三个根', { tone: 'muted', name: 'multi.three' });
      return;
    }

    // One root for the whole page: the control row, the view body and the readout are nested inside it.
    Panel(
      {
        direction: 'vertical',
        gap: 12,
        padding: 16,
        variant: 'plain',
        width: 700,
        alignItems: 'stretch',
      },
      () => {
        this.controls();
        if (name === 'a') {
          this.viewA();
        } else {
          this.viewB();
        }
        this.readout();
      },
    );
  }

  /** Buttons that drive the page with real clicks — including the one that replaces its own view. */
  private controls(): void {
    Panel(
      {
        direction: 'vertical',
        gap: 8,
        padding: 12,
        variant: 'surface',
        radius: 10,
        alignItems: 'stretch',
      },
      () => {
        Row({ gap: 8, alignItems: 'center', wrap: true }, () => {
          for (const name of ['a', 'b', 'multi'] as const) {
            this.track(
              `show.${name}`,
              Button(`视图 ${name.toUpperCase()}`, {
                variant: this.view.value === name ? 'primary' : 'secondary',
                size: 'sm',
                name: `show.${name}`,
                // The button is destroyed by the very call it makes. It works exactly once, which is
                // the point: this is the realistic "nav button switches the page" case, and the router's
                // cleanup must survive a target disappearing inside its own click handler.
                onClick: () => this.show(name),
              }),
            );
          }
          Spacer({ flex: true });
          this.track(
            'hook.toggle',
            Button(() => `onBack: ${this.hookConsumes.value ? '接管' : '放行'}`, {
              toggle: true,
              value: this.hookConsumes,
              size: 'sm',
              name: 'hook.toggle',
              label: 'onBack 是否接管 Esc',
            }),
          );
          this.track(
            'dialog.open',
            Button('打开对话框', {
              variant: 'ghost',
              size: 'sm',
              name: 'dialog.open',
              onClick: () => this.openDialog(),
            }),
          );
        });
        Text(
          '切视图 = 销毁整页再建一页：控件数、焦点集合、prev.destroyed 都会跟着变；场景上的计数继续累加。',
          {
            tone: 'muted',
            maxLines: 2,
            name: 'controls.hint',
          },
        );
      },
    );
  }

  private viewA(): void {
    Panel(
      {
        direction: 'vertical',
        gap: 10,
        padding: 14,
        variant: 'surface',
        radius: 10,
        alignItems: 'stretch',
      },
      () => {
        Text('视图 A · 计数按钮 + 输入框', { tone: 'primary', name: 'a.title' });
        Row({ gap: 10, alignItems: 'center' }, () => {
          this.track(
            'a.click',
            Button(() => `点我 ${this.aClicks.value} 次`, {
              variant: 'primary',
              name: 'a.click',
              onClick: () => {
                this.aClicks.value += 1;
              },
            }),
          );
          this.track(
            'a.name',
            TextField({
              label: '名字',
              value: this.name,
              placeholder: '输入一点字',
              width: 240,
              name: 'a.name',
            }),
          );
          Text(() => `name.length=${this.name.value.length}`, {
            tone: 'muted',
            name: 'a.name.length',
          });
        });
      },
    );
  }

  private viewB(): void {
    Panel(
      {
        direction: 'vertical',
        gap: 10,
        padding: 14,
        variant: 'surfaceAlt',
        radius: 10,
        alignItems: 'stretch',
      },
      () => {
        Text('视图 B · 滑杆 + 归零按钮', { tone: 'primary', name: 'b.title' });
        Row({ gap: 10, alignItems: 'center' }, () => {
          this.track(
            'b.volume',
            Slider({
              label: '音量',
              min: 0,
              max: 100,
              step: 5,
              value: this.bVolume,
              width: 240,
              name: 'b.volume',
            }),
          );
          this.track(
            'b.reset',
            Button('归零', {
              variant: 'secondary',
              name: 'b.reset',
              onClick: () => {
                this.bVolume.value = 0;
                this.bResets.value += 1;
              },
            }),
          );
          // One widget more than view A, so `built` in the readout *differs* between the two views:
          // "the page was rebuilt" is then visible in `#demo-state`, not just inferred.
          this.track(
            'b.full',
            Button('加到 100', {
              variant: 'primary',
              name: 'b.full',
              onClick: () => {
                this.bVolume.value = 100;
              },
            }),
          );
        });
        Text(() => `volume=${this.bVolume.value} resets=${this.bResets.value}`, {
          tone: 'muted',
          name: 'b.readout',
        });
      },
    );
  }

  /** Counters that have to survive a swap, plus the live build info of the page you are looking at. */
  private readout(): void {
    Panel(
      {
        direction: 'vertical',
        gap: 6,
        padding: 12,
        variant: 'surface',
        radius: 10,
        alignItems: 'stretch',
      },
      () => {
        Text('读数（逐帧写入 #demo-state；`window.uiscene.state()` 读同样的东西）', {
          tone: 'muted',
          name: 'readout.title',
        });
        Divider({});
        Text(
          () =>
            `view=${this.view.value} swaps=${this.swaps.value} a.clicks=${this.aClicks.value} ` +
            `b.volume=${this.bVolume.value}`,
          { name: 'readout.view' },
        );
        Text(
          () =>
            `onBack=${this.hookConsumes.value ? '接管' : '放行'} hook=${this.hookBacks} app=${this.appBacks} ` +
            `dialog=${this.mvvm.modal.depth}/${this.closes}`,
          { name: 'readout.back' },
        );
        Text(
          () => {
            const info = this.contentInfo;
            const root = this.page;
            return (
              `built=${info?.widgets ?? 0} roots=${info?.roots ?? 0} depth=${info?.depth ?? 0} ` +
              `container=${root ? root.constructor.name : 'none'} ` +
              `focusables=${this.mvvm.focus.focusables.length}`
            );
          },
          { tone: 'muted', name: 'readout.build' },
        );
      },
    );
  }

  // ------------------------------------------------------- actions

  /** `setContent()` with a view name: the whole page is replaced; the counters live on the scene. */
  private show(name: ViewName): void {
    this.previousPage = this.page;
    this.view.value = name;
    this.swaps.value += 1;
    this.published.clear();
    this.setContent(() => this.buildView(name));
    this.reportGeometry();
  }

  /**
   * Rewrites `#status` for the page that now exists.
   *
   * `setStatus()` replaces the block instead of appending: the previous page's rects are gone, and a
   * check that reads `#status` must never be able to see geometry from a view that was destroyed
   * (that is how a pixel assertion ends up sampling whatever happens to be there now).
   */
  private reportGeometry(): void {
    setStatus('--- uiscene ---');
    if (this.page) {
      reportWidget('page', this.page);
    }
    const probe = this.page ? findWidget(this.page, 'show.a') : null;
    if (probe) {
      reportWidget('show.a', probe);
    }
    reportCanvas(this.game);
  }

  private openDialog(): void {
    const handle = this.mvvm.modal.open(
      () => {
        Panel(
          { direction: 'vertical', gap: 10, padding: 16, variant: 'surface', radius: 10 },
          () => {
            Text('对话框在 UIScene 之上', { name: 'dialog.title' });
            Text('Esc 先关掉它：这一下既不算 scene 的 onBack，也不算应用层的。', {
              tone: 'muted',
              maxLines: 2,
            });
            Button('知道了', {
              variant: 'primary',
              name: 'dialog.close',
              onClick: () => handle.close('api'),
            });
          },
        );
      },
      {
        name: 'uiscene.dialog',
        onClose: () => {
          this.closes += 1;
        },
      },
    );
  }

  /** First refusal on Escape / gamepad B: `true` consumes it, `false` lets the app handler run. */
  protected override onBack(): boolean {
    this.hookBacks += 1;
    return this.hookConsumes.value;
  }

  // ------------------------------------------------------- bookkeeping

  private track(key: string, widget: Widget): Widget {
    this.tracked.set(key, widget);
    return widget;
  }

  private counts(): Counts {
    return {
      widgets: countWidgets(this.page),
      themeListeners: themeListenerCount(),
      displayList: this.children.length,
      focusables: this.mvvm.hasRoot ? this.mvvm.focus.focusables.length : 0,
      pointerTargets: this.mvvm.hasRoot ? this.mvvm.input.widgets.length : 0,
      a11yNodes: this.mvvm.hasRoot ? this.mvvm.a11y.count : 0,
    };
  }

  override update(): void {
    const canvas = this.game.canvas.getBoundingClientRect();
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed) {
        this.publish(`st.${key}`, 'gone');
        continue;
      }
      this.publish(`st.${key}`, widget.visualState);
      if (!widget.visible || widget.appliedRect.width <= 0) {
        continue;
      }
      const origin = stagePosition(widget);
      this.publish(
        `pt.${key}`,
        `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
          canvas.top + origin.y + widget.appliedRect.height / 2,
        )}`,
      );
    }

    const focused = this.mvvm.focus.focusedWidget;
    const info = this.contentInfo;
    this.publish('view', this.view.value);
    this.publish('swaps', this.swaps.value);
    this.publish('hook', this.hookConsumes.value ? 'on' : 'off');
    this.publish('hookBacks', this.hookBacks);
    this.publish('appBacks', this.appBacks);
    this.publish('dialog.depth', this.mvvm.modal.depth);
    this.publish('closes', this.closes);
    this.publish('focus', focused ? focused.name || 'unnamed' : 'none');
    this.publish(
      'focusables',
      this.mvvm.focus.focusables.map((w) => w.name || 'unnamed').join('+'),
    );
    this.publish('a.clicks', this.aClicks.value);
    this.publish('b.volume', this.bVolume.value);
    this.publish('b.resets', this.bResets.value);
    this.publish('roots', info?.roots ?? 0);
    this.publish('built', info?.widgets ?? 0);
    this.publish('depth', info?.depth ?? 0);
    this.publish('container', this.page ? this.page.constructor.name : 'none');
    // Direct evidence that the previous view is gone, rather than "the counters look stable".
    this.publish(
      'prev.destroyed',
      this.previousPage ? (this.previousPage.isDestroyed ? 1 : 0) : -1,
    );
    const counts = this.counts();
    this.publish('counts.widgets', counts.widgets);
    this.publish('counts.themeListeners', counts.themeListeners);
    this.publish('counts.displayList', counts.displayList);
    this.publish('counts.focusables', counts.focusables);
    this.publish('counts.pointerTargets', counts.pointerTargets);
    this.publish('counts.a11yNodes', counts.a11yNodes);
  }

  private publish(key: string, value: string | number): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  private install(): void {
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    this.reportGeometry();
    setDemoState('scene', 'uiscene');

    (window as unknown as { uiscene?: unknown }).uiscene = {
      views: (): ViewName[] => ['a', 'b', 'multi'],
      show: (name: ViewName): ViewName => {
        this.show(name);
        return this.view.value;
      },
      /** Replaces the view `count` times; the counters must come back to where they started. */
      swap: (count: number): { before: Counts; after: Counts } => {
        const before = this.counts();
        for (let index = 0; index < count; index += 1) {
          this.show(index % 2 === 0 ? 'b' : 'a');
        }
        return { before, after: this.counts() };
      },
      /** Runs the `back` path exactly the way Escape does (modal → page → scene → app). */
      back: (): void => {
        this.mvvm.focus.back();
      },
      setHook: (on: boolean): boolean => {
        this.hookConsumes.value = on === true;
        return this.hookConsumes.value;
      },
      dialog: (): string => {
        this.openDialog();
        return this.mvvm.modal.top?.widget.name ?? 'uiscene.dialog';
      },
      counts: (): Counts => this.counts(),
      themeListeners: (): number => themeListenerCount(),
      state: () => ({
        view: this.view.value,
        swaps: this.swaps.value,
        hookConsumes: this.hookConsumes.value,
        hookBacks: this.hookBacks,
        appBacks: this.appBacks,
        closes: this.closes,
        dialogDepth: this.mvvm.modal.depth,
        aClicks: this.aClicks.value,
        bVolume: this.bVolume.value,
        bResets: this.bResets.value,
        name: this.name.value,
        focus: this.mvvm.focus.focusedWidget?.name ?? 'none',
        focusables: this.mvvm.focus.focusables.map((w) => w.name || 'unnamed'),
        roots: this.contentInfo?.roots ?? 0,
        depth: this.contentInfo?.depth ?? 0,
        built: this.contentInfo?.widgets ?? 0,
        container: this.page ? this.page.constructor.name : 'none',
        previousDestroyed: this.previousPage ? this.previousPage.isDestroyed : null,
      }),
    };
  }
}

/** First widget with this name, or `null` (the status probe needs one by name, like `#/modal` does). */
function findWidget(root: Widget, name: string): Widget | null {
  if (root.name === name) {
    return root;
  }
  for (const child of root.getWidgetChildren()) {
    const found = findWidget(child, name);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Widget count of a subtree (the `#/lifecycle` helper, kept local to this page). */
function countWidgets(root: Widget | null): number {
  if (!root) {
    return 0;
  }
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
