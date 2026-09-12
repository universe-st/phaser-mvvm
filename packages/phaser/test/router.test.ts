/**
 * Router tests: the bookkeeping a route table adds on top of the page stack.
 *
 * `Router` takes a structural host (`RouterHost`), so the whole thing runs in Node against a fake stack
 * — no Phaser, no scene, no widgets. That matters because the interesting cases are the ones a browser
 * run makes hard to see: a page popped by someone *else* (`Esc`, a button, `popToRoot()`), a visit that
 * has to be forgotten, `replace()` on a one-page stack. The scene half (a real push, real focus, real
 * key presses) is the `#/router` acceptance run.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setDevMode } from '@phaser-mvvm/core';
import { Router, type RouterPageStack } from '../src/router';
import { UnknownRouteError } from '../src/route-plan';
import type { PageHandle, PageOptions } from '../src/pages';

/** The smallest thing that behaves like `PageHost`: a stack of ids, built on demand. */
function fakeStack() {
  const entries: Array<{ id: number; name: string; options: PageOptions; content: () => void }> =
    [];
  let counter = 0;
  const handleOf = (entry: (typeof entries)[number], depth: number): PageHandle => ({
    id: entry.id,
    widget: { name: entry.name, isDestroyed: false } as unknown as PageHandle['widget'],
    name: entry.name,
    depth,
    active: entry.id === entries[entries.length - 1]?.id,
    open: true,
    pop: () => false,
  });

  const stack: RouterPageStack = {
    get depth() {
      return entries.length;
    },
    get top() {
      const entry = entries[entries.length - 1];
      return entry ? handleOf(entry, entries.length) : null;
    },
    get handles() {
      return entries.map((entry, index) => handleOf(entry, index + 1));
    },
    push(content: () => void, options: PageOptions = {}): PageHandle {
      const id = ++counter;
      const entry = { id, name: options.name ?? `page#${id}`, options, content };
      entries.push(entry);
      return handleOf(entry, entries.length);
    },
    pop(): boolean {
      if (entries.length <= 1) {
        return false;
      }
      entries.pop();
      return true;
    },
  };
  return { stack, entries };
}

// The router traces every navigation in development mode; the trace itself is covered by
// `#/router` + `ACCEPTANCE-devtrace.md`, and here it would only bury the assertions in stdout.
beforeAll(() => setDevMode(false));
afterAll(() => setDevMode(true));

describe('Router', () => {
  it('pushes a page per navigation, named after the route', () => {
    const { stack, entries } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined };

    router.navigate('home');

    expect(stack.depth).toBe(1);
    expect(entries[0]?.name).toBe('route:home');
    expect(router.current).toEqual({ key: 'home', path: 'home', params: {} });
  });

  it('hands the view its params and runs it with them', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    const seen: unknown[] = [];
    router.routes = {
      'user/:id': (params) => {
        seen.push(params);
      },
    };

    router.navigate('user/42', { tab: 'posts' });
    // The builder runs when the page is built, not when `navigate` returns: a page is a lambda.
    expect(seen).toEqual([]);
    router.navigate('user/7');

    expect(router.history.map((visit) => visit.path)).toEqual(['user/42', 'user/7']);
    expect(router.history[0]?.params).toEqual({ id: '42', tab: 'posts' });
    expect(router.history[0]?.key).toBe('user/:id');
  });

  it('throws a named error, with the table, and pushes nothing', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, 'user/:id': () => undefined };

    expect(() => router.navigate('nope/1')).toThrow(UnknownRouteError);
    expect(() => router.navigate('nope/1')).toThrow(/home, user\/:id/);
    expect(stack.depth).toBe(0);
    expect(router.current).toBeNull();
  });

  it('follows the stack when a page is popped without the router', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, detail: () => undefined };
    router.navigate('home');
    router.navigate('detail');

    // `Esc`, a page's own button, `popToRoot()` — all of them end up here, and none of them tells the
    // router anything.
    stack.pop();

    expect(router.current).toEqual({ key: 'home', path: 'home', params: {} });
    expect(router.history).toHaveLength(1);
  });

  it('reports `current` as null for a page the router did not open', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined };
    stack.push(() => undefined, { name: 'direct' });

    expect(router.current).toBeNull();
    expect(router.history).toEqual([]);
  });

  it('skips unrouted pages in the history without losing the routed ones around them', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, detail: () => undefined };
    router.navigate('home');
    stack.push(() => undefined, { name: 'direct' });
    router.navigate('detail');

    expect(router.history.map((visit) => visit.path)).toEqual(['home', 'detail']);
    expect(router.depth).toBe(3);
  });

  it('swaps the top page on `replace` instead of stacking', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, settings: () => undefined };
    router.navigate('home');
    router.navigate('settings');

    router.replace('home');

    expect(stack.depth).toBe(2);
    expect(router.history.map((visit) => visit.path)).toEqual(['home', 'home']);
  });

  it('pushes on `replace` when only the base page is left (the base cannot be popped)', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, settings: () => undefined };
    router.navigate('home');

    router.replace('settings');

    expect(stack.depth).toBe(2);
    expect(router.history.map((visit) => visit.path)).toEqual(['home', 'settings']);
  });

  it('forgets visits for pages that are gone, however often it is churned', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, 'user/:id': () => undefined };
    router.navigate('home');

    for (let i = 0; i < 500; i++) {
      router.navigate(`user/${i}`);
      router.back();
    }

    // The private map is what would grow; `history` is its only public read, and it must stay at one.
    expect(router.history).toHaveLength(1);
    expect(router.current?.path).toBe('home');
    expect(stack.depth).toBe(1);
  });

  it('prunes even when nothing ever reads `history`', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined, 'user/:id': () => undefined };
    router.navigate('home');
    for (let i = 0; i < 50; i++) {
      router.navigate(`user/${i}`);
      router.back();
    }
    // `current` is the read that has to prune on its own: an app that only ever navigates and reads
    // `current` must not accumulate entries (the round-75 finding).
    const internals = router as unknown as { visits: Map<number, unknown> };
    expect(internals.visits.size).toBe(1);
    expect(router.current?.path).toBe('home');
  });

  it('forwards route options to the page (`onResume`/`onDispose`/`onBack`)', () => {
    const { stack, entries } = fakeStack();
    const router = new Router({ pages: stack });
    const onResume = vi.fn();
    const onBack = (): boolean => true;
    router.routes = { home: () => undefined };

    router.navigate('home', undefined, { onResume, onBack });

    expect(entries[0]?.options.onResume).toBe(onResume);
    expect(entries[0]?.options.onBack).toBe(onBack);
    // The name stays the router's: `pages.names()` is how a trace says which route a page is.
    expect(entries[0]?.options.name).toBe('route:home');
  });

  it('registers routes incrementally, over whatever the table already had', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined };
    router.route('about', () => undefined).route('late', () => undefined);

    expect(Object.keys(router.routes)).toEqual(['home', 'about', 'late']);
    router.navigate('late');
    expect(router.current?.key).toBe('late');
  });

  it('replaces the whole table when `routes` is assigned again', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.route('gone', () => undefined);
    router.routes = { home: () => undefined };

    expect(Object.keys(router.routes)).toEqual(['home']);
    expect(() => router.navigate('gone')).toThrow(UnknownRouteError);
  });

  it('normalises the path it reports and matches', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { 'user/:id': () => undefined };

    router.navigate('/user/42/');

    expect(router.current?.path).toBe('user/42');
  });

  it('drops everything on `dispose` (scene teardown)', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    router.routes = { home: () => undefined };
    router.navigate('home');

    router.dispose();

    expect(router.history).toEqual([]);
    expect(router.current).toBeNull();
    // The page is still there — the UI root owns it, not the router.
    expect(stack.depth).toBe(1);
  });

  it('an empty table is an unknown route, not a crash', () => {
    const { stack } = fakeStack();
    const router = new Router({ pages: stack });
    expect(() => router.navigate('anything')).toThrow(/\(empty\)/);
  });
});
