/**
 * The plugin-presence guard.
 *
 * `Phaser.Scene.mvvm` is declared non-optional on purpose (it is what makes `this.mvvm` usable in every
 * scene), so the one case TypeScript cannot catch — a game whose `plugins.scene` entry is missing — has
 * to be caught at runtime by something that names the fix. This is that something, and it lives in its
 * own module (no runtime Phaser import) so the message itself can be pinned in CI: it is the first
 * thing a new project sees when the plugin entry is wrong.
 */

import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { requireMVVMPlugin } from '../src/require-plugin';
import type { MVVMPlugin } from '../src/plugin';

/** A scene with (or without) a plugin, only as far as this guard looks. */
function scene(options: { plugin?: unknown; key?: string }): Phaser.Scene {
  return {
    mvvm: options.plugin,
    sys: options.key === undefined ? undefined : { settings: { key: options.key } },
  } as unknown as Phaser.Scene;
}

describe('requireMVVMPlugin', () => {
  it('returns the plugin when the scene has one', () => {
    const plugin = { marker: 'plugin' } as unknown as MVVMPlugin;
    expect(requireMVVMPlugin(scene({ plugin, key: 'hello' }))).toBe(plugin);
  });

  it('names the scene and the Game Config entry when it does not', () => {
    let message = '';
    try {
      requireMVVMPlugin(scene({ key: 'hello' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"hello"');
    expect(message).toContain('MVVMPlugin');
    expect(message).toContain("mapping: 'mvvm'");
  });

  it('still produces a usable message for a scene with no settings at all', () => {
    // A hand-made object (or a scene probed before `Systems` exists): the key is optional, the fix is not.
    expect(() => requireMVVMPlugin(scene({}))).toThrow(/no MVVMPlugin/);
  });

  it('rejects a plugin-shaped falsy value', () => {
    // `mapping: 'mvvm'` on a plugin that never booted leaves `undefined`; `null` is the same story.
    expect(() => requireMVVMPlugin(scene({ plugin: null }))).toThrow(/no MVVMPlugin/);
  });
});
