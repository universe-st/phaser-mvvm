/**
 * `#/router` — the standing acceptance page for `this.mvvm.router` (the M8 route table).
 *
 * The router adds no navigation model of its own: navigating *is* `pages.push()`. So this page asserts
 * what the table adds on top, and nothing about what `#/pages` already covers:
 *
 * - **the table is data** — `navigate('user/42')` is a string; `current`/`history` report which route
 *   each page came from, and they stay correct when a page is popped *without* the router (`Esc`, a
 *   button, `popToRoot()`);
 * - **params are per visit** — `user/1` and `user/2` are two pages, each with its own `id`, and each
 *   page keeps its own state (a text field per visit is what proves it);
 * - **a typo is loud** — an unknown path throws with the table in the message, in every build;
 * - **`replace()` swaps** the top page instead of stacking another one.
 *
 * `window.routerDemo` drives it: `navigate(path, params)` / `replace(path)` / `back()` / `popToRoot()` /
 * `unknown(path)` (returns the error message instead of throwing) / `state()` / `point(name)` /
 * `counts()` / `churn(n)` / `focusables()`.
 *
 * Per-frame `#demo-state`: `route.path` / `route.key` / `route.params` / `route.depth` / `route.names` /
 * `route.history` / `route.resumes` / `route.disposes` / `route.appBacks` / `counts.*` / `pt.*` / `st.*`.
 */

import Phaser from 'phaser';
import { ref } from '@phaser-mvvm/core';
import {
  themeListenerCount,
  routeParams,
  type RouteParams,
  type Widget,
} from '@phaser-mvvm/phaser';
import { Button, Divider, Panel, Row, Text, TextField } from '@phaser-mvvm/widgets/compose';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

/** An item the home route lists; the id doubles as the `:id` param of the user route. */
interface Item {
  id: string;
  name: string;
}

const ITEMS: readonly Item[] = Array.from({ length: 4 }, (_, index) => ({
  id: String(index + 1),
  name: `用户 ${index + 1}`,
}));

export class RouterScene extends Phaser.Scene {
  /** Per-visit page state: the point of two `user/:id` pages coexisting is that neither overwrites it. */
  private readonly notes = new Map<string, ReturnType<typeof ref<string>>>();
  /** Home page state, which a navigation round trip has to preserve (the page is hidden, not rebuilt). */
  private readonly counter = ref(0);

  private resumes = 0;
  private disposes = 0;
  /** Navigations performed from this scene (every `go()` call, buttons included). */
  private visited = 0;
  /** How often `back` fell through every layer to `mvvm.onBack` (true on the base route only). */
  private appBacks = 0;

  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  constructor() {
    super('router');
  }

  create(): void {
    this.mvvm.onBack = () => {
      this.appBacks += 1;
    };

    // The whole navigation model of this page, in one object literal. Nothing here looks at
    // `location`: a route is a name plus params.
    this.mvvm.router.routes = {
      home: () => this.buildHome(),
      'user/:id': (params) => this.buildUser(params),
      'user/:id/posts': (params) => this.buildPosts(params),
      settings: (params) => this.buildSettings(params),
      // A pattern and a literal that would overlap: `settings` wins for `settings`, the pattern for
      // `settings/advanced` — the precedence rule from `route-plan.ts`, visible on the page.
      'settings/advanced': () => this.buildAdvanced(),
    };
    this.mvvm.router.navigate('home');

    this.exposeApi();
    setDemoState('scene', 'router');
    appendStatus('--- router ---');
    reportCanvas(this.game);
  }

  /** The base route: a counter that must survive a round trip, and one button per route shape. */
  private buildHome(): void {
    Panel(
      {
        direction: 'vertical',
        gap: 12,
        padding: 20,
        variant: 'surface',
        radius: 12,
        width: 560,
        name: 'home.page',
      },
      () => {
        this.track(
          'home.title',
          Text('路由表 · this.mvvm.router', { size: 'lg', name: 'home.title' }),
        );
        this.track(
          'home.hint',
          Text('点一个用户进入 user/:id；Esc 或“返回”回到这里 —— 计数与输入都不丢。', {
            tone: 'muted',
            name: 'home.hint',
            maxLines: 2,
          }),
        );
        this.track(
          'home.counter',
          Button(() => `点我 ${this.counter.value} 次`, {
            variant: 'secondary',
            name: 'home.counter',
            onClick: () => {
              this.counter.value += 1;
            },
          }),
        );
        this.track(
          'home.field',
          TextField({
            name: 'home.field',
            value: this.notesFor('home'),
            placeholder: '首页的输入框',
          }),
        );
        Divider({});
        Row({ gap: 8, wrap: true }, () => {
          for (const item of ITEMS) {
            this.track(
              `home.user.${item.id}`,
              Button(item.name, {
                variant: 'ghost',
                name: `home.user.${item.id}`,
                onClick: () => this.go(`user/${item.id}`),
              }),
            );
          }
        });
        Row({ gap: 8 }, () => {
          // An explicit param merged over the path: `settings?tab=…` without URL syntax.
          this.track(
            'home.settings',
            Button('设置（profile）', {
              name: 'home.settings',
              onClick: () => this.go('settings', { tab: 'profile' }),
            }),
          );
          this.track(
            'home.settingsAdvanced',
            Button('设置 · 高级', {
              variant: 'secondary',
              name: 'home.settingsAdvanced',
              onClick: () => this.go('settings/advanced'),
            }),
          );
        });
      },
    );
  }

  /** `user/:id` — the id comes from the path, and the page owns a field of its own. */
  private buildUser(params: RouteParams): void {
    const { id } = routeParams<{ id: string }>(params);
    Panel(
      {
        direction: 'vertical',
        gap: 12,
        padding: 20,
        variant: 'surfaceAlt',
        radius: 12,
        width: 520,
        name: 'user.page',
      },
      () => {
        this.track('user.title', Text(`用户 ${id}`, { size: 'lg', name: 'user.title' }));
        this.track(
          'user.params',
          Text(`params: id=${id}${params['tab'] ? ` tab=${params['tab']}` : ''}`, {
            tone: 'muted',
            name: 'user.params',
          }),
        );
        this.track(
          'user.field',
          TextField({
            name: 'user.field',
            value: this.notesFor(`user/${id}`),
            placeholder: `用户 ${id} 的备注`,
          }),
        );
        Row({ gap: 8 }, () => {
          this.track(
            'user.posts',
            Button('他的帖子', {
              name: 'user.posts',
              onClick: () => this.go(`user/${id}/posts`),
            }),
          );
          this.track(
            'user.next',
            Button('下一个用户', {
              variant: 'secondary',
              name: 'user.next',
              onClick: () => this.go(`user/${Number(id) + 1}`),
            }),
          );
          this.track(
            'user.back',
            Button('返回', {
              variant: 'ghost',
              name: 'user.back',
              onClick: () => this.mvvm.router.back(),
            }),
          );
        });
      },
    );
  }

  /** `user/:id/posts` — one level deeper, so `history` has three entries to report. */
  private buildPosts(params: RouteParams): void {
    const { id } = routeParams<{ id: string }>(params);
    Panel(
      { direction: 'vertical', gap: 10, padding: 20, variant: 'surface', radius: 12, width: 460 },
      () => {
        this.track('posts.title', Text(`用户 ${id} 的帖子`, { size: 'lg', name: 'posts.title' }));
        this.track(
          'posts.body',
          Text('这一页由 `user/:id/posts` 打开：同一个 id 捕获自路径。', {
            tone: 'muted',
            name: 'posts.body',
            maxLines: 2,
          }),
        );
        Row({ gap: 8 }, () => {
          this.track(
            'posts.back',
            Button('返回', {
              variant: 'ghost',
              name: 'posts.back',
              onClick: () => this.mvvm.router.back(),
            }),
          );
          this.track(
            'posts.home',
            Button('回到首页', {
              name: 'posts.home',
              onClick: () => this.go('home'),
            }),
          );
        });
      },
    );
  }

  /** `settings` with an explicit param, plus the two ways to leave it (`back` and `replace`). */
  private buildSettings(params: RouteParams): void {
    Panel(
      { direction: 'vertical', gap: 10, padding: 20, variant: 'surface', radius: 12, width: 460 },
      () => {
        this.track('settings.title', Text('设置', { size: 'lg', name: 'settings.title' }));
        this.track(
          'settings.tab',
          Text(`tab=${params['tab'] ?? 'none'}`, { tone: 'muted', name: 'settings.tab' }),
        );
        Row({ gap: 8 }, () => {
          this.track(
            'settings.back',
            Button('返回', {
              variant: 'ghost',
              name: 'settings.back',
              onClick: () => this.mvvm.router.back(),
            }),
          );
          this.track(
            'settings.replace',
            Button('用“高级”替换本页', {
              name: 'settings.replace',
              onClick: () => this.mvvm.router.replace('settings/advanced'),
            }),
          );
        });
      },
    );
  }

  private buildAdvanced(): void {
    Panel(
      {
        direction: 'vertical',
        gap: 10,
        padding: 20,
        variant: 'surfaceAlt',
        radius: 12,
        width: 460,
      },
      () => {
        this.track('advanced.title', Text('设置 · 高级', { size: 'lg', name: 'advanced.title' }));
        this.track(
          'advanced.hint',
          Text('这一页是 replace() 换进来的：栈深度没有增加。', {
            tone: 'muted',
            name: 'advanced.hint',
            maxLines: 2,
          }),
        );
        this.track(
          'advanced.back',
          Button('返回', {
            variant: 'ghost',
            name: 'advanced.back',
            onClick: () => this.mvvm.router.back(),
          }),
        );
      },
    );
  }

  /**
   * The one place a navigation starts from this scene.
   *
   * Every button and every api entry goes through here so the `visited` counter matches the stack
   * operations exactly — a leak gate that counted only the programmatic calls would be half a gate.
   */
  private go(path: string, params?: RouteParams): void {
    this.visited += 1;
    this.mvvm.router.navigate(path, params);
  }

  /** One text field per visit, so "each `user/:id` page keeps its own state" is observable. */
  private notesFor(key: string): ReturnType<typeof ref<string>> {
    const existing = this.notes.get(key);
    if (existing) {
      return existing;
    }
    const created = ref('');
    this.notes.set(key, created);
    return created;
  }

  /** Per-frame probes: the route the visible page came from, plus the page's own buttons. */
  override update(): void {
    const current = this.mvvm.router.current;
    this.publish('route.path', current?.path ?? 'none');
    this.publish('route.key', current?.key ?? 'none');
    this.publish(
      'route.params',
      current
        ? Object.entries(current.params)
            .map(([k, v]) => `${k}:${v}`)
            .join('|') || 'none'
        : 'none',
    );
    this.publish('route.depth', this.mvvm.router.depth);
    this.publish(
      'route.history',
      this.mvvm.router.history.map((visit) => visit.path).join('>') || 'none',
    );
    this.publish('route.names', this.mvvm.pages.names().join('>'));
    this.publish('route.focus', this.mvvm.focus.focusedWidget?.name || 'none');
    this.publish('route.resumes', this.resumes);
    this.publish('route.disposes', this.disposes);
    this.publish('route.appBacks', this.appBacks);
    this.publish('route.counter', this.counter.value);
    this.publish('route.visited', this.visited);
    this.publish('route.notes', this.notes.size);
    this.publish(
      'focusables',
      this.mvvm.focus.focusables.map((w) => w.name || 'unnamed').join('+'),
    );

    const counts = this.counts();
    this.publish('counts.widgets', counts.widgets);
    this.publish('counts.themeListeners', counts.themeListeners);
    this.publish('counts.pointerTargets', counts.pointerTargets);
    this.publish('counts.focusables', counts.focusables);

    // Per-frame page coordinates for the visible page's controls: the layout moves as pages are pushed
    // and popped, so a probe sampled once at creation would point at nothing (see AGENTS.md §6).
    const top = this.mvvm.pages.top;
    for (const [key, widget] of this.tracked) {
      const alive = widget.isDestroyed !== true && widget.appliedRect.width > 0;
      const visible = alive && top ? containsWidget(top.widget, widget) : false;
      const point = visible ? pagePoint(this.game, widget) : null;
      this.publish(`pt.${key}`, point ? `@${Math.round(point.x)},${Math.round(point.y)}` : 'gone');
      this.publish(`st.${key}`, visible ? widget.visualState : 'gone');
    }

    // The home page is the one the pixel gate samples; report its geometry once, on first build.
    if (!this.reported) {
      this.reported = true;
      const home = this.mvvm.pages.top?.widget;
      if (home) {
        for (const name of ['home.page', 'home.counter', 'home.field']) {
          const widget = findByName(home, name);
          if (widget) {
            reportWidget(name, widget);
          }
        }
      }
    }
  }

  private reported = false;

  /**
   * Resolves once no page transition is running.
   *
   * Since round 78 a popped page is destroyed one exit animation after it leaves the stack, so anything
   * that compares counters has to wait for this first (the gate below, and `#/modal`'s).
   */
  settle(): Promise<void> {
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

  counts(): {
    widgets: number;
    themeListeners: number;
    pointerTargets: number;
    focusables: number;
  } {
    // From the **UI root**: a popped page is still painted for one exit animation and has already left
    // the stack, so counting the stack would call a tree clean while a page was still attached.
    return {
      widgets: countWidgets(this.mvvm.root),
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

  /** Page coordinates of a named widget of the visible page (`none` when it is not on it). */
  private pointOf(name: string): string {
    const top = this.mvvm.pages.top;
    const widget = top ? findByName(top.widget, name) : null;
    if (!widget || widget.appliedRect.width <= 0) {
      return 'none';
    }
    return `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
      pagePoint(this.game, widget).y,
    )}`;
  }

  /** The in-page API an acceptance run drives the page with. */
  private exposeApi(): void {
    const api = {
      /** Navigates and reports where it landed (the route, the params, the depth). */
      navigate: (path: string, params?: RouteParams): Record<string, unknown> => {
        this.go(path, params);
        return { path: this.mvvm.router.current?.path ?? 'none', depth: this.mvvm.router.depth };
      },
      replace: (path: string): Record<string, unknown> => {
        this.visited += 1;
        this.mvvm.router.replace(path);
        return { path: this.mvvm.router.current?.path ?? 'none', depth: this.mvvm.router.depth };
      },
      back: (): boolean => this.mvvm.router.back(),
      popToRoot: (): void => this.mvvm.pages.popToRoot(),
      /** Pops without telling the router — the case that proves `current` follows the stack. */
      popDirectly: (): boolean => this.mvvm.pages.pop(),
      /** Returns the error message instead of throwing, so a check can assert it. */
      unknown: (path: string): string => {
        try {
          this.mvvm.router.navigate(path);
          return 'no-error';
        } catch (error) {
          return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
      },
      /** Same navigation, but with the lifecycle hooks attached (asserts options are forwarded). */
      navigateWithLifecycle: (path: string): Record<string, unknown> => {
        this.visited += 1;
        this.mvvm.router.navigate(path, undefined, this.lifecycle);
        return { path: this.mvvm.router.current?.path ?? 'none', depth: this.mvvm.router.depth };
      },
      /** Registers one more route at runtime (`router.route()`). */
      addRoute: (path: string): void => {
        this.mvvm.router.route(path, () => {
          Panel(
            { direction: 'vertical', gap: 8, padding: 20, variant: 'surface', radius: 12 },
            () => {
              this.track('late.title', Text(`晚注册的路由：${path}`, { name: 'late.title' }));
            },
          );
        });
      },
      history: (): string[] => this.mvvm.router.history.map((visit) => visit.path),
      keys: (): string[] => this.mvvm.router.history.map((visit) => visit.key),
      tables: (): string[] => Object.keys(this.mvvm.router.routes),
      depth: (): number => this.mvvm.router.depth,
      names: (): string[] => this.mvvm.pages.names(),
      focusName: (): string => this.mvvm.focus.focusedWidget?.name || 'none',
      focusables: (): string[] =>
        this.mvvm.focus.focusables.map((widget) => widget.name || 'unnamed'),
      note: (key: string): string => this.notes.get(key)?.value ?? 'none',
      setNote: (key: string, value: string): string => {
        const note = this.notes.get(key);
        if (!note) {
          return 'none';
        }
        note.value = value;
        return note.value;
      },
      counter: (): number => this.counter.value,
      appBacks: (): number => this.appBacks,
      point: (name: string): string => this.pointOf(name),
      state: (): Record<string, unknown> => ({
        path: this.mvvm.router.current?.path ?? 'none',
        key: this.mvvm.router.current?.key ?? 'none',
        params: this.mvvm.router.current?.params ?? {},
        depth: this.mvvm.router.depth,
        history: this.mvvm.router.history.map((visit) => visit.path),
        names: this.mvvm.pages.names(),
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
      }),
      counts: () => this.counts(),
      /** Navigates and pops `n` times — the leak gate for pages created through the table. */
      // Async, and settled after every pass: since round 78 a popped page stays painted for one exit
      // animation before it is destroyed, so sampling immediately compared a tree with a fading page in
      // it against one without (measured: `themeListeners` 16 → 22 on the first run after page
      // transitions landed). Every pass still has to land on the same numbers.
      churn: async (
        n: number,
      ): Promise<{
        before: ReturnType<RouterScene['counts']>;
        after: ReturnType<RouterScene['counts']>;
      }> => {
        const before = this.counts();
        for (let i = 0; i < n; i++) {
          this.go(`user/${(i % ITEMS.length) + 1}/posts`);
          this.mvvm.router.back();
          await this.settle();
        }
        return { before, after: this.counts() };
      },
      /** Resolves once no page transition is running (the leak gate samples after this). */
      settle: (): Promise<void> => this.settle(),
      /** Opens a route and resolves after its transition — the "what does the user see" case. */
      openAndSettle: async (path: string): Promise<Record<string, unknown>> => {
        this.go(path);
        await this.settle();
        return {
          path: this.mvvm.router.current?.path ?? 'none',
          key: this.mvvm.router.current?.key ?? 'none',
          depth: this.mvvm.router.depth,
        };
      },
      /** How many navigations this scene has performed (paired with `route.disposes` in the gate). */
      visited: (): number => this.visited,
    };
    (window as unknown as { routerDemo?: unknown }).routerDemo = api;
  }

  /**
   * Route options that count the page lifecycle.
   *
   * `navigate(path, params, options)` forwards them to `pages.push()`, which is the point: the router
   * adds a table, not a second navigation model.
   */
  private readonly lifecycle: {
    onResume: () => void;
    onDispose: () => void;
  } = {
    onResume: () => {
      this.resumes += 1;
    },
    onDispose: () => {
      this.disposes += 1;
    },
  };
}

/** Number of widgets in a subtree, the root included. */
function countWidgets(root: Widget): number {
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}

/** Depth-first search for a named widget inside a page. */
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

/**
 * Whether `widget` is inside `root`'s subtree — i.e. on the visible page.
 *
 * A covered page is hidden, not destroyed, so a widget of the page *below* is still in `tracked` and
 * still has a rect: without this walk its `pt.*` probe would keep pointing at where it used to be
 * (AGENTS.md §6, the `#/bindings` lesson).
 */
function containsWidget(root: Widget, widget: Widget): boolean {
  let node: Widget | null = widget;
  while (node) {
    if (node === root) {
      return true;
    }
    node = (node.parentContainer as Widget | null) ?? null;
  }
  return false;
}
