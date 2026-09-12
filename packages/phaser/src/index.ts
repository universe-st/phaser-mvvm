/**
 * `@phaser-mvvm/phaser` — the Phaser 4 adapter.
 *
 * This is the only package in the monorepo allowed to import Phaser (ADR-0005): everything that
 * touches the renderer, the scene lifecycle or the input system lives here, so a Phaser 4.x API
 * change is contained to one package.
 */

import './augment';

export { Widget, type WidgetOptions } from './Widget';
export {
  AbsoluteWidget,
  type AbsoluteWidgetOptions,
  BoxWidget,
  type BoxWidgetOptions,
  GridWidget,
  type GridWidgetOptions,
  hbox,
  grid,
  absolute,
  splitOptions,
  stack,
  StackWidget,
  type StackWidgetOptions,
  vbox,
} from './LayoutWidget';
export { UIRoot, type UIRootOptions } from './UIRoot';
export { MVVMPlugin, type MVVMPluginConfig } from './plugin';
export { factoriesInstalled, FACTORY_KEYS, installFactories } from './factory';
export {
  LabelWidget,
  type LabelWidgetOptions,
  RectWidget,
  type RectWidgetOptions,
} from './widgets';
export {
  DARK_THEME,
  LIGHT_THEME,
  BUILT_IN_THEMES,
  getTheme,
  setTheme,
  onThemeChange,
  themeListenerCount,
  type Theme,
  type ThemeColorName,
  type ThemeName,
  type ThemeSizeName,
} from './theme';
export {
  ProceduralSkin,
  DEFAULT_PRIMARY_SKIN,
  DEFAULT_SURFACE_SKIN,
  colorOf,
  type BackgroundStyle,
  type Skin,
  type SkinStyles,
} from './skin';
export { resolveWidgetState, type WidgetState, type WidgetStateFlags } from './widget-state';
export {
  LruCache,
  PhaserTextMeasurer,
  textMeasureKey,
  type MeasuredText,
  type TextMeasureRequest,
  type TextMeasurer,
} from './measurer';
export {
  FocusManager,
  collectFocusable,
  directionalTolerance,
  isFocusNodeLike,
  pickDirectional,
  stageRectOf,
  stageRectsOf,
  type AnchorLike,
  type FocusManagerOptions,
  type FocusNodeLike,
  type RectSourceLike,
} from './focus';
export {
  InputRouter,
  DEFAULT_DRAG_THRESHOLD,
  collectInteractive,
  diffInteractionState,
  isClickGesture,
  isWithinTree,
  type ContainerLike,
  type InputRouterOptions,
  type PointLike,
} from './input';
export {
  NAV_DIRECTIONS,
  NAV_REPEAT_DEFAULTS,
  NavRepeat,
  gamepadActionsOf,
  gamepadStateOf,
  heldDirectionsOf,
  keyboardActionOf,
  GAMEPAD_AXIS_THRESHOLD,
  GAMEPAD_BUTTON_ACTIVATE,
  GAMEPAD_BUTTON_BACK,
  type NavAction,
  type NavDirection,
  type NavInputState,
  type NavRepeatOptions,
} from './nav';
export {
  MODEL_CHANGE_EVENT,
  bindCommand,
  bindEnabled,
  bindError,
  bindModel,
  bindPath,
  bindTemplate,
  bindTemplateText,
  bindText,
  bindValue,
  bindVisible,
  bindingScopeOf,
  templateScopeOf,
  type BindingFlush,
  type BindingOptions,
  type BindingTarget,
  type CommandBindingOptions,
  type CommandGetter,
  type ModelBindingHost,
  type PathCommandBindingOptions,
  type StopBinding,
} from './binding';

// Re-exported so application code only needs one import for layout params and types.
export * from '@phaser-mvvm/layout';
