/**
 * `runtimeOptionTarget()` — the classifier behind every layout slot.
 *
 * It is the one place that answers "can this option be changed at runtime, and which half of the option
 * bag does it patch?", and both sides depend on it: `Widget#setContainerOptions()` validates keys with the
 * same table, and the DSL asks it **before** turning a `Ref`/getter into a binding. If it ever answered
 * `null` for a key a widget does accept, the slot would silently never fire; if it answered a target for a
 * key nothing reads, the binding would write into a bag nobody looks at.
 */

import { describe, expect, it } from 'vitest';
import { CONTAINER_OPTION_KEYS, runtimeOptionTarget } from '../src/container-options';

describe('runtimeOptionTarget', () => {
  it('classifies layout params for every widget, container or not', () => {
    for (const key of ['width', 'height', 'padding', 'margin', 'grow', 'shrink', 'alignSelf']) {
      expect(runtimeOptionTarget(null, key), key).toBe('layout');
      expect(runtimeOptionTarget('box', key), key).toBe('layout');
      expect(runtimeOptionTarget('scroll', key), key).toBe('layout');
    }
  });

  it('classifies container options by the container the widget actually has', () => {
    expect(runtimeOptionTarget('box', 'gap')).toBe('container');
    expect(runtimeOptionTarget('box', 'justifyContent')).toBe('container');
    expect(runtimeOptionTarget('grid', 'columns')).toBe('container');
    expect(runtimeOptionTarget('grid', 'rowGap')).toBe('container');
    expect(runtimeOptionTarget('stack', 'align')).toBe('container');

    // A key belongs to *one* container kind: a grid has no `gap` (it would be a silently ignored write),
    // and a box has no `columns`.
    expect(runtimeOptionTarget('box', 'columns')).toBeNull();
    expect(runtimeOptionTarget('grid', 'gap')).toBeNull();
    expect(runtimeOptionTarget('stack', 'gap')).toBeNull();
  });

  it('refuses container options where there is no container to patch', () => {
    // A leaf widget (`TextField`, `Label`) has `container === null`: `gap` on it is not an option.
    expect(runtimeOptionTarget(null, 'gap')).toBeNull();
    // `absolute` positions children with per-node offsets, and the `scroll` container carries no options.
    expect(runtimeOptionTarget('absolute', 'gap')).toBeNull();
    expect(runtimeOptionTarget('scroll', 'gap')).toBeNull();
    expect(runtimeOptionTarget(undefined, 'gap')).toBeNull();
  });

  it('never mistakes a callback option for a slot', () => {
    // The DSL decides from this answer instead of from the value's shape, because `onClick`, `validate`
    // and `items` are callbacks — textually indistinguishable from a getter.
    for (const key of ['onClick', 'onChange', 'validate', 'items', 'key', 'template', 'update']) {
      expect(runtimeOptionTarget('box', key), key).toBeNull();
      expect(runtimeOptionTarget(null, key), key).toBeNull();
    }
  });

  it('keeps the container key table and the classifier in step', () => {
    for (const [type, keys] of Object.entries(CONTAINER_OPTION_KEYS)) {
      for (const key of keys) {
        expect(runtimeOptionTarget(type, key), `${type}.${key}`).toBe('container');
      }
    }
    // The keys with a runtime path are exactly the ones in the table (plus the layout params).
    expect(Object.keys(CONTAINER_OPTION_KEYS).sort()).toEqual([
      'absolute',
      'box',
      'grid',
      'scroll',
      'stack',
    ]);
  });
});
