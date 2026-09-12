/**
 * `@phaser-mvvm/widgets` — the M4 control library: `Panel`, `Label`, `Button`, `Image`, `Spacer` and
 * `Divider` (M5–M7 add `TextField`, `TextArea`, `ScrollView`, `Repeat` and `Modal`).
 *
 * Everything is drawn procedurally from the active theme (PLAN §4.6, §10.3), so the library needs no
 * art assets: panels and buttons paint with `Graphics` skins, the focus ring is a stroked rounded
 * rect, and texture images are the only widget that reads from the texture manager.
 *
 * Widgets never listen to Phaser input themselves. The input router drives them through
 * `setHovered`/`setPressed` (pointer) and `activate(source)` (pointer, keyboard, gamepad); they repaint
 * whenever a flag changes because `Widget.appearanceChanged()` calls `refreshAppearance()`.
 */

import './augment';

export { Label, type LabelAlign, type LabelOptions, type LabelTone } from './Label';
export { Panel, type PanelOptions, type PanelVariant } from './Panel';
export {
  Button,
  BUTTON_EVENTS,
  type ButtonOptions,
  type ButtonSize,
  type ButtonVariant,
} from './Button';
export { Image, Image as UIImage, type ImageOptions } from './Image';
export { Spacer, type SpacerOptions } from './Spacer';
export { Divider, type DividerOptions, type DividerOrientation } from './Divider';

export {
  button,
  divider,
  installWidgetFactories,
  label,
  panel,
  spacer,
  uiImage,
  widgetFactoriesInstalled,
  WIDGET_FACTORY_KEYS,
} from './factories';

// Pure helpers: they never import Phaser, so they are reusable (and tested) outside a renderer.
export { computeFit, type FitResult, type ImageFit } from './fit';
export {
  applyLineLimit,
  ELLIPSIS,
  ellipsizeLine,
  truncateLines,
  type LineLimitOptions,
  type MeasureWidth,
  type TruncateResult,
} from './text-truncate';
export {
  buttonLabel,
  resolveButtonActivation,
  resolveButtonState,
  type ButtonActivationDecision,
  type ButtonActivationInput,
  type ButtonVisualStateInput,
} from './button-state';
export { BLACK, shadeColor, toCssColor, WHITE } from './color';
export { centeredOffset, centeredOffsetOverflow, contentBox } from './geometry';
export {
  buttonSkinStyles,
  buttonTextColor,
  fillBox,
  paintElevation,
  paintFocusRing,
  panelSkinStyles,
} from './appearance';
export { BOX_CONTAINER_KEYS, boxOptionsOf, optionBag, splitWidgetOptions } from './options';
