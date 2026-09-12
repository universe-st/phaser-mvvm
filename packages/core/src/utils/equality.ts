/**
 * Structural comparison used by deep watchers and `deep: true` change checks. Comparison follows
 * `Object.is` semantics (so `NaN` equals `NaN`) and tolerates cyclic references.
 */

import { isArray, isDate, isMap, isPlainObject, isSet } from './shared';

const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Deeply compares two values.
 *
 * Plain objects, arrays, `Map`, `Set` and `Date` are compared structurally; anything else (class
 * instances, functions, symbols) is only equal by identity.
 */
export function deepEqual(a: unknown, b: unknown, seen?: Map<object, object>): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;

  // Guards against cyclic structures: a pair already being compared is assumed equal.
  const visited = seen ?? new Map<object, object>();
  const previous = visited.get(a);
  if (previous !== undefined) return previous === b;
  visited.set(a, b);

  if (isArray(a)) {
    if (!isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], visited)) return false;
    }
    return true;
  }

  if (isDate(a)) return isDate(b) && Object.is(a.getTime(), b.getTime());

  if (isMap(a)) {
    if (!isMap(b) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key), visited)) return false;
    }
    return true;
  }

  if (isSet(a)) {
    if (!isSet(b) || a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (!hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key], visited)) return false;
    }
    return true;
  }

  return false;
}
