/**
 * `LruCache`: the eviction order the layout/text caches rely on.
 *
 * The class is deliberately tiny, but "least recently *used*" (not "first inserted") is the property
 * that keeps a hot working set resident, so it is worth pinning down.
 */

import { describe, expect, it } from 'vitest';
import { LruCache } from '../src/index';

describe('LruCache', () => {
  it('stores and returns values', () => {
    const cache = new LruCache<string, number>(4);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.has('a')).toBe(true);
  });

  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Reading `a` makes `b` the least recently used one.
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('replaces a value without changing the size and refreshes recency', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 9);
    cache.set('c', 3);

    expect(cache.get('a')).toBe(9);
    expect(cache.has('b')).toBe(false);
  });

  it('clears and deletes', () => {
    const cache = new LruCache<string, number>(4);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
