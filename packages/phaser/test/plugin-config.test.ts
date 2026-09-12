/**
 * `mergePluginConfig` tests — the one function every new sub-option bag has to be added to.
 *
 * The rule it enforces is not enforced by the type system: forgetting a bag here still compiles, and
 * the symptom is a `configure()` call that silently wipes its siblings (a patch that only sets
 * `focus.wrap` resetting `input.dragThreshold`). `plugin-config.ts` is Phaser-free precisely so this
 * file can pin one case per bag, in Node, without a renderer.
 */

import { describe, expect, it } from 'vitest';
import { mergePluginConfig, type MVVMPluginConfig } from '../src/plugin-config';

describe('mergePluginConfig', () => {
  it('replaces flat options and keeps the untouched ones', () => {
    const merged = mergePluginConfig(
      { navigation: false, themeBackground: true },
      { navigation: true },
    );
    expect(merged.navigation).toBe(true);
    expect(merged.themeBackground).toBe(true);
  });

  it('merges every sub-option bag instead of replacing it', () => {
    const base: MVVMPluginConfig = {
      input: { dragThreshold: 12 },
      focus: { wrap: false },
      a11y: { politeness: 'polite' },
      layout: { grow: 1 },
      transition: { enter: 300 },
    };
    const merged = mergePluginConfig(base, {
      input: { onActivate: undefined },
      focus: { wrap: true },
      a11y: { container: null },
      layout: { padding: 8 },
      transition: { exit: 40 },
    });

    expect(merged.input).toEqual({ dragThreshold: 12, onActivate: undefined });
    expect(merged.focus).toEqual({ wrap: true });
    expect(merged.a11y).toEqual({ politeness: 'polite', container: null });
    expect(merged.layout).toEqual({ grow: 1, padding: 8 });
    // The transition bag is the newest one, and the one a per-dialog default is most likely to patch.
    expect(merged.transition).toEqual({ enter: 300, exit: 40 });
  });

  it('turns a bag off with `false` and back on with a bag patch', () => {
    const off = mergePluginConfig({ a11y: { politeness: 'polite' } }, { a11y: false });
    expect(off.a11y).toBe(false);
    // `false` wins over the base bag, and a later bag patch starts from empty rather than from the
    // pre-`false` options.
    expect(mergePluginConfig(off, { a11y: { politeness: 'assertive' } }).a11y).toEqual({
      politeness: 'assertive',
    });
  });

  it('turns the motion policy off with `false`, per the documented contract', () => {
    const off = mergePluginConfig({ transition: { enter: 300, exit: 40 } }, { transition: false });
    expect(off.transition).toBe(false);
    const back = mergePluginConfig(off, { transition: { enter: 120 } });
    expect(back.transition).toEqual({ enter: 120 });
  });

  it('does not invent a bag that neither side mentions', () => {
    const merged = mergePluginConfig({ navigation: true }, { themeBackground: false });
    expect(merged.transition).toBeUndefined();
    expect(merged.input).toBeUndefined();
    expect(merged.a11y).toBeUndefined();
  });

  it('never mutates either argument', () => {
    const base: MVVMPluginConfig = { input: { dragThreshold: 12 }, transition: { enter: 300 } };
    const patch: MVVMPluginConfig = { input: { dragThreshold: 20 }, transition: { exit: 40 } };
    mergePluginConfig(base, patch);
    expect(base.input).toEqual({ dragThreshold: 12 });
    expect(base.transition).toEqual({ enter: 300 });
    expect(patch.input).toEqual({ dragThreshold: 20 });
    expect(patch.transition).toEqual({ exit: 40 });
  });

  it('is associative enough for repeated configure() calls to be order-free', () => {
    const a: MVVMPluginConfig = { transition: { enter: 300 } };
    const b: MVVMPluginConfig = { transition: { exit: 40 } };
    const c: MVVMPluginConfig = { transition: { respectReducedMotion: false } };
    expect(mergePluginConfig(mergePluginConfig(a, b), c)).toEqual(
      mergePluginConfig(a, mergePluginConfig(b, c)),
    );
  });
});
