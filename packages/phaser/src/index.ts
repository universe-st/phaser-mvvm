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

// Re-exported so application code only needs one import for layout params and types.
export * from '@phaser-mvvm/layout';
