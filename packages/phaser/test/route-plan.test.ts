/**
 * Route matching tests: which table key a path resolves to, what params come out, and how the two
 * ambiguous cases (a literal that shadows a pattern, two patterns that both match) are decided.
 *
 * Pure, so it runs in CI without a renderer — the browser acceptance (`#/router`) covers the half that
 * needs a page stack (`navigate` pushes, `Esc` pops, `current`/`history` follow).
 */

import { describe, expect, it } from 'vitest';
import {
  UnknownRouteError,
  matchRoute,
  normalizeRoutePath,
  routeNames,
  routeParams,
  type RouteTable,
} from '../src/route-plan';

const noop = (): void => undefined;

describe('normalizeRoutePath', () => {
  it('makes one spelling of the same path', () => {
    expect(normalizeRoutePath('user/42')).toBe('user/42');
    expect(normalizeRoutePath('/user/42/')).toBe('user/42');
    expect(normalizeRoutePath('#/user/42')).toBe('user/42');
    expect(normalizeRoutePath('  user//42  ')).toBe('user/42');
    expect(normalizeRoutePath('')).toBe('');
  });
});

describe('matchRoute', () => {
  const table: RouteTable = {
    home: noop,
    settings: noop,
    'user/:id': noop,
    'user/:id/posts': noop,
  };

  it('finds a literal key', () => {
    expect(matchRoute(table, 'home')).toEqual({ key: 'home', params: {} });
    expect(matchRoute(table, '/home/')).toEqual({ key: 'home', params: {} });
  });

  it('captures path params', () => {
    expect(matchRoute(table, 'user/42')).toEqual({ key: 'user/:id', params: { id: '42' } });
    expect(matchRoute(table, 'user/42/posts')).toEqual({
      key: 'user/:id/posts',
      params: { id: '42' },
    });
  });

  it('decodes captured segments', () => {
    expect(matchRoute(table, 'user/a%20b')).toEqual({ key: 'user/:id', params: { id: 'a b' } });
  });

  it('prefers the literal key over a pattern that would also match', () => {
    const mixed: RouteTable = { 'user/me': noop, 'user/:id': noop };
    expect(matchRoute(mixed, 'user/me')?.key).toBe('user/me');
    expect(matchRoute(mixed, 'user/42')?.key).toBe('user/:id');
  });

  it('takes the first declared pattern when two match', () => {
    const ambiguous: RouteTable = { ':area/:id': noop, 'user/:id': noop };
    expect(matchRoute(ambiguous, 'user/42')?.key).toBe(':area/:id');
    const reversed: RouteTable = { 'user/:id': noop, ':area/:id': noop };
    expect(matchRoute(reversed, 'user/42')?.key).toBe('user/:id');
  });

  it('refuses a mismatch in length or in a literal segment', () => {
    expect(matchRoute(table, 'user')).toBeNull();
    expect(matchRoute(table, 'user/42/posts/7')).toBeNull();
    expect(matchRoute(table, 'users/42')).toBeNull();
  });

  it('does not match an empty segment to a param', () => {
    // `user//posts` normalises to `user/posts`, which is not a route; `':id'` must not swallow `''`.
    expect(matchRoute({ ':id': noop }, '//')).toBeNull();
  });

  it('never walks into Object.prototype', () => {
    const empty: RouteTable = {};
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(matchRoute(empty, key), key).toBeNull();
    }
    // And a table that *does* declare one serves its own entry.
    const explicit: RouteTable = { constructor: noop };
    expect(matchRoute(explicit, 'constructor')).toEqual({ key: 'constructor', params: {} });
  });

  it('merges explicitly passed params over the path captures', () => {
    expect(matchRoute(table, 'user/42', { tab: 'posts' })).toEqual({
      key: 'user/:id',
      params: { id: '42', tab: 'posts' },
    });
    expect(matchRoute(table, 'user/42', { id: 'override' })?.params['id']).toBe('override');
    expect(matchRoute(table, 'home', { from: 'deep-link' })?.params).toEqual({ from: 'deep-link' });
  });

  it('hands out frozen params, so a view cannot corrupt the visit it was given', () => {
    const params = matchRoute(table, 'user/42')?.params ?? {};
    expect(Object.isFrozen(params)).toBe(true);
  });

  it('answers null for an empty path', () => {
    expect(matchRoute(table, '')).toBeNull();
  });
});

describe('routeNames', () => {
  it('lists the keys in declaration order', () => {
    expect(routeNames({ b: noop, a: noop })).toEqual(['b', 'a']);
    expect(routeNames({})).toEqual([]);
  });
});

describe('routeParams', () => {
  it('is a cast, not a check: what the matcher captured is what comes back', () => {
    const params = matchRoute({ 'user/:id': noop }, 'user/7')?.params ?? {};
    const { id } = routeParams<{ id: string }>(params);
    expect(id).toBe('7');
  });
});

describe('UnknownRouteError', () => {
  it('names the path and lists the table, so the message is the fix', () => {
    const error = new UnknownRouteError('user/9', ['home', 'user/:id']);
    expect(error.name).toBe('UnknownRouteError');
    expect(error.path).toBe('user/9');
    expect(error.known).toEqual(['home', 'user/:id']);
    expect(error.message).toContain('Unknown route "user/9"');
    expect(error.message).toContain('home, user/:id');
    expect(error).toBeInstanceOf(Error);
  });

  it('says so when the table is empty', () => {
    expect(new UnknownRouteError('home', []).message).toContain('(empty)');
  });
});
