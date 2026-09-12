/**
 * Widget interaction state, shared by the adapter, the input router and the widget library.
 *
 * The state machine is deliberately tiny (`normal`/`hover`/`pressed`/`disabled`/`focused`/`error`)
 * because every widget paints from it: `Skin#paint()` receives exactly this value.
 */

export type WidgetState = 'normal' | 'hover' | 'pressed' | 'disabled' | 'focused' | 'error';

export interface WidgetStateFlags {
  enabled?: boolean;
  hovered?: boolean;
  pressed?: boolean;
  focused?: boolean;
  error?: boolean;
}

/**
 * Resolves the visual state from the interaction flags.
 *
 * Priority: `disabled` wins, then `error`, then the pointer states, then keyboard focus. `error`
 * outranks focus so a focused invalid field still looks invalid.
 */
export function resolveWidgetState(flags: WidgetStateFlags): WidgetState {
  if (flags.enabled === false) {
    return 'disabled';
  }
  if (flags.error) {
    return 'error';
  }
  if (flags.pressed) {
    return 'pressed';
  }
  if (flags.hovered) {
    return 'hover';
  }
  if (flags.focused) {
    return 'focused';
  }
  return 'normal';
}
