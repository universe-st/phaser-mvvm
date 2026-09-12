/**
 * The plugin's option surface and the merge rule behind `MVVMPlugin.configure()`.
 *
 * This module is deliberately **Phaser-free** (`import type` only): merging two option bags is pure
 * logic, and it is the one function every new sub-option bag has to be added to — a bag that is
 * missing here is not a type error, it is a silent "one patch wipes its siblings" bug. Keeping it out
 * of `plugin.ts` is what lets `test/plugin-config.test.ts` cover it in Node, without a renderer.
 */

import type { A11yOptions } from './a11y';
import type { FocusManagerOptions } from './focus';
import type { InputRouterOptions } from './input';
import type { TransitionOptions } from './transition';
import type { UIRootOptions } from './UIRoot';

export interface MVVMPluginConfig extends UIRootOptions {
  /** Focus behaviour overrides (the root is supplied by the plugin). */
  focus?: Omit<FocusManagerOptions, 'root'>;
  /** Pointer routing overrides (the root is supplied by the plugin). */
  input?: Omit<InputRouterOptions, 'root'>;
  /** Keyboard/gamepad navigation. Defaults to `true`. */
  navigation?: boolean;
  /**
   * Hidden DOM mirror for screen readers. Defaults to `true`; `false` (or
   * `this.mvvm.a11y.enabled = false`) keeps the layer out of the DOM entirely.
   */
  a11y?: A11yOptions | false;
  /** Callback for the `back` action (Escape / gamepad B) when no widget handles it. */
  onBack?: () => void;
  /**
   * Paint the scene's main camera with `theme.colors.background` (and keep it in sync on theme
   * changes). Defaults to `true`; set to `false` for a UI scene that must stay transparent over a
   * running game scene.
   */
  themeBackground?: boolean;
  /**
   * Open/close motion for overlay layers (PLAN M8's 开闭动效). Defaults to a 160 ms fade-in and a
   * 120 ms fade-out; `false` makes every layer appear and disappear on the spot.
   *
   * ```ts
   * MVVMPlugin.configure({ transition: { exit: 0 } });          // fade in, vanish on close
   * MVVMPlugin.configure({ transition: false });                // no motion at all
   * ```
   */
  transition?: TransitionOptions | false;
}

/**
 * Merges two plugin configs one level deep.
 *
 * `input`, `focus`, `a11y`, `layout` and `transition` are option bags of their own, so a later
 * `configure()` that only mentions `focus.wrap` must not wipe `input.dragThreshold` — a shallow spread
 * would. `false` in a patch means "turn this feature off" and wins over the base bag; a bag patch merges
 * into it (so `configure({ a11y: { politeness: 'assertive' } })` after `a11y: false` switches the mirror
 * back on with that one option set).
 */
export function mergePluginConfig(
  base: MVVMPluginConfig,
  patch: MVVMPluginConfig,
): MVVMPluginConfig {
  const merged: MVVMPluginConfig = { ...base, ...patch };
  if (base.input || patch.input) {
    merged.input = { ...base.input, ...patch.input };
  }
  if (base.focus || patch.focus) {
    merged.focus = { ...base.focus, ...patch.focus };
  }
  if (base.a11y !== undefined || patch.a11y !== undefined) {
    merged.a11y =
      patch.a11y === false
        ? false
        : patch.a11y === undefined
          ? base.a11y
          : { ...(base.a11y === false ? {} : (base.a11y ?? {})), ...patch.a11y };
  }
  if (base.layout || patch.layout) {
    merged.layout = { ...base.layout, ...patch.layout };
  }
  // `transition` is a sub-option bag like the ones above: a patch that only sets `transition.exit`
  // must not wipe the configured `enter`.
  if (base.transition !== undefined || patch.transition !== undefined) {
    merged.transition =
      patch.transition === false
        ? false
        : patch.transition === undefined
          ? base.transition
          : {
              ...(base.transition === false || base.transition === undefined
                ? {}
                : base.transition),
              ...patch.transition,
            };
  }
  return merged;
}
