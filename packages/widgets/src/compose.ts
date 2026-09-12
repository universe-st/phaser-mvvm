/**
 * The Compose-style DSL: write a view as nested calls instead of option bags plus children arrays.
 *
 * ```ts
 * import { ui, Column, Row, Text, Button } from '@phaser-mvvm/widgets/compose';
 *
 * const page = ui(this, () => {
 *   Column({ gap: 12, padding: 20, width: 520 }, () => {
 *     Text('Hello phaser-mvvm', { size: 'xl' });          // or Text(() => vm.title.value)
 *     Row({ gap: 8, justifyContent: 'end' }, () => {
 *       Button('取消', { variant: 'ghost' });
 *       Button('确定', { variant: 'primary', onClick: save });
 *     });
 *   });
 * });
 * this.mvvm.mount(page);
 * ```
 *
 * What the DSL adds over the `this.add.ui*` factories is *structure*: the trailing content lambda
 * opens a scope, so nesting mirrors the source instead of an array literal, sibling order is the
 * source order, and no call has to name its scene. What it does *not* do is invent a second option
 * vocabulary — every composable takes the same options object as the widget class it wraps, so the
 * guide's option tables stay valid.
 *
 * Data slots (`Text`'s string, a field's `value`) also accept a `ref` or a getter and are bound
 * automatically — see `reactive-source.ts`. Everything else (geometry, callbacks) is passed as-is.
 *
 * The scope mechanics live in `@phaser-mvvm/phaser` (`uiscope.ts`), so a custom widget can join a DSL
 * tree with `emitWidget()`/`withUiParent()` without importing this module.
 */

import type Phaser from 'phaser';
import type { BindingContext } from '@phaser-mvvm/core';
import type { MVVMPlugin } from '@phaser-mvvm/phaser';
import { devLog, warn } from '@phaser-mvvm/core';
import {
  AbsoluteWidget,
  type AbsoluteWidgetOptions,
  bindBooleanModel,
  bindModel,
  bindNumberModel,
  bindText,
  bindValue,
  BoxWidget,
  type BoxLayoutOptions,
  type BoxWidgetOptions,
  buildUiSubtree,
  currentUiScene,
  emitWidget,
  GridWidget,
  type GridLayoutOptions,
  type GridWidgetOptions,
  RectWidget,
  type RectWidgetOptions,
  runInUiScope,
  StackWidget,
  type StackWidgetOptions,
  type Widget,
  withUiParent,
} from '@phaser-mvvm/phaser';
import {
  Button as ButtonWidget,
  BUTTON_EVENTS,
  type ButtonOptions,
  type ButtonVariant,
} from './Button';
import { Divider as DividerWidget, type DividerOptions } from './Divider';
import { Image as ImageWidget, type ImageOptions } from './Image';
import { Label, type LabelOptions, type LabelTone } from './Label';
import { Panel as PanelWidget, type PanelOptions } from './Panel';
import { Repeat, type RepeatOptions } from './Repeat';
import { ScrollView, type ScrollViewOptions } from './ScrollView';
import { withListFlow, type ListFlowShorthands } from './list-flow';
import { Slider as SliderWidget, SLIDER_EVENTS, type SliderOptions } from './Slider';
import { Spacer as SpacerWidget, type SpacerOptions } from './Spacer';
import { TextArea as TextAreaWidget, type TextAreaOptions } from './TextArea';
import { TextField as TextFieldWidget, type TextFieldOptions } from './TextField';
import { TEXT_INPUT_EVENTS } from './TextInputBase';
import {
  isReactiveSource,
  isWritableSource,
  type ReactiveSource,
  readReactive,
  sourceGetter,
  writeReactive,
} from './reactive-source';

// --------------------------------------------------------------------- the entry point

/**
 * Builds a view and returns its root widget.
 *
 * Exactly one root is the normal case. Zero roots is an error (an empty page is always a mistake);
 * more than one is wrapped in a transparent vertical container — the same forgiveness Compose shows
 * for a multi-child `setContent` — with a development warning, because the implicit container still
 * decides the flow direction.
 *
 * The result is *not* mounted: hand it to `this.mvvm.mount(page)` (which also lays it out) or to
 * `new UIRoot(scene)`.
 */
export function ui(scene: Phaser.Scene, content: () => void): Widget {
  const { roots, widgets, depth } = runInUiScope(scene, content);

  if (roots.length === 0) {
    throw new Error(
      'ui(): the content built no widget. A view needs exactly one root — wrap the content in ' +
        'Column()/Row()/Panel(), or check for an early return inside the lambda.',
    );
  }

  if (roots.length === 1) {
    devLog(`ui(): built ${widgets} widget(s), ${depth} level(s) deep`);
    return roots[0] as Widget;
  }

  warn(
    `ui(): the content built ${roots.length} root widgets; they were wrapped in a vertical Column. ` +
      'Build an explicit Column()/Row()/Panel() to choose the flow yourself.',
  );
  const wrapper = new BoxWidget(scene, { direction: 'vertical', alignItems: 'stretch' }, roots);
  scene.add.existing(wrapper);
  devLog(`ui(): built ${widgets} widget(s), ${depth} level(s) deep, wrapped ${roots.length} roots`);
  return wrapper;
}

/**
 * Builds a view **and mounts it** — the `setContent { … }` of this framework.
 *
 * `ui()` returns the root so a caller can decide what to do with it (a dialog, a section that is
 * swapped in later); `render()` is the one-call form for the common case of a whole page:
 *
 * ```ts
 * render(this.mvvm, () => {
 *   Column({ padding: 16, gap: 12 }, () => {
 *     Text('Hello');
 *     Button('确定', { variant: 'primary', onClick: save });
 *   });
 * });
 * ```
 *
 * A page built this way does not need `installFactories()`/`installWidgetFactories()`: the DSL
 * constructs the widget classes directly, so the `this.add.*` registrations are irrelevant to it.
 */
export function render(plugin: MVVMPlugin, content: () => void): Widget {
  // `ScenePlugin#scene` is protected, so the scene comes from the UI root — which is the object the page
  // is mounted into anyway, and reading it creates and wires that root on first use.
  const root = plugin.root;
  const page = ui(root.scene, content);
  plugin.mount(page);
  devLog('render(): mounted the page built by the content lambda');
  return page;
}

// --------------------------------------------------------------------- containers

/** Options of `Column`/`Row`: the box widget's own bag plus the DSL slots. */
export type ColumnOptions = BoxWidgetOptions & DslOptions;
export type RowOptions = BoxWidgetOptions & DslOptions;

/** A vertical box: `Column({ gap: 8 }, () => { … })` or `Column(() => { … })`. */
export function Column(options?: ColumnOptions | (() => void), content?: () => void): BoxWidget {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new BoxWidget(scene, { ...rest, direction: 'vertical' });
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return withUiParent(widget, args.content);
}

/** A horizontal box. */
export function Row(options?: RowOptions | (() => void), content?: () => void): BoxWidget {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new BoxWidget(scene, { ...rest, direction: 'horizontal' });
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return withUiParent(widget, args.content);
}

/** A grid of equally sized tracks. */
export function Grid(
  options?: (GridWidgetOptions & DslOptions) | (() => void),
  content?: () => void,
): GridWidget {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new GridWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return withUiParent(widget, args.content);
}

/** A stack: children overlap and are aligned inside the same box. */
export function Stack(
  options?: (StackWidgetOptions & DslOptions) | (() => void),
  content?: () => void,
): StackWidget {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new StackWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return withUiParent(widget, args.content);
}

/** An absolutely positioned container: children carry `position: 'absolute'` plus their offsets. */
export function Absolute(
  options?: (AbsoluteWidgetOptions & DslOptions) | (() => void),
  content?: () => void,
): AbsoluteWidget {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new AbsoluteWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return withUiParent(widget, args.content);
}

/**
 * A themed, painted container — the Compose `Surface`/`Card` of this framework.
 *
 * `Column`/`Row` are transparent layout boxes; `Panel` is the one that paints a background, so it is
 * what a card, a dialog or a page root is made of.
 */
export function Panel(
  options?: (PanelOptions & DslOptions) | (() => void),
  content?: () => void,
): PanelWidget {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new PanelWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return withUiParent(widget, args.content);
}

/** Alias of `Panel`, for readers coming from Compose. */
export const Surface = Panel;

/**
 * A solid colour block - the adapter's `RectWidget`.
 *
 * The DSL has no shape vocabulary of its own (panels, dividers and skins draw their own rectangles), so
 * this is the primitive for a plain swatch, a colour chip, or a spacer that needs a fill. It takes the
 * widget's own options plus the usual DSL slots, exactly like every other leaf.
 */
export function Rect(options: RectWidgetOptions & DslOptions = {}): RectWidget {
  const { visible, rest } = splitDsl(options);
  const scene = currentUiScene();
  const widget = new RectWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return emitWidget(widget);
}

/**
 * A clipped viewport: `Scroll({ height: 240 }, () => { … })`.
 *
 * The content lambda builds exactly one widget, which becomes the scroll content. A `Scroll` whose
 * content is itself a `List` also gets virtualisation, because `ScrollView` finds the list it wraps.
 */
export function Scroll(
  options?: (Omit<ScrollViewOptions, 'content'> & DslOptions) | (() => void),
  content?: () => void,
): ScrollView {
  const args = normalizeContent(options, content);
  const { visible, rest } = splitDsl(args.options);
  const scene = currentUiScene();
  const widget = new ScrollView(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  emitWidget(widget);
  if (args.content) {
    widget.setContent(buildUiSubtree(scene, args.content, 'Scroll()'));
  }
  return widget;
}

// --------------------------------------------------------------------- leaves

/**
 * Options every composable accepts on top of its widget's own bag.
 *
 * `visible` is the DSL's condition: a hidden widget leaves the flow (`hideMode: 'collapse'` is the
 * layout default), so `{ visible: () => open.value }` behaves like wrapping the widget in a Compose
 * `if`. It is a *reactive* slot, so the node is not rebuilt when the value flips.
 */
export interface DslOptions {
  visible?: ReactiveSource<boolean>;
}

/** Splits the DSL-level slots out of a widget's own option bag. */
function splitDsl<O extends DslOptions>(
  options: O,
): {
  visible: ReactiveSource<boolean> | undefined;
  rest: Omit<O, 'visible'>;
} {
  const { visible, ...rest } = options;
  return { visible, rest };
}

/** Applies the DSL-level options (currently just `visible`) to a freshly built widget. */
function applyDslOptions(widget: Widget, options: { visible?: ReactiveSource<boolean> }): void {
  const visible = options.visible;
  if (visible === undefined) {
    return;
  }
  widget.setVisible(readReactive(visible));
  if (isReactiveSource(visible)) {
    bindValue(
      widget,
      () => readReactive(visible) === true,
      (value, host) => {
        host.setVisible(value);
      },
    );
  }
}

/**
 * Binds one reactive option slot to a widget setter.
 *
 * Constants keep the straight-line path (the widget is constructed with them); only a `Ref`/getter
 * creates a frame-aligned binding, exactly like the data slots do.
 */
function bindOption<T, W extends Widget>(
  widget: W,
  value: ReactiveSource<T> | undefined,
  apply: (widget: W, next: T) => void,
): void {
  if (value === undefined || !isReactiveSource(value)) {
    return;
  }
  bindValue(widget, sourceGetter(value), (next, host) => apply(host as W, next));
}

/** Options of `Text`: the label's own bag, plus the DSL's reactive slots. */
export type TextOptions = Omit<LabelOptions, 'tone'> & {
  /** Semantic colour; a `Ref`/getter repaints the label when it flips. */
  tone?: ReactiveSource<LabelTone>;
} & DslOptions;

/**
 * A single- or multi-line label.
 *
 * ```ts
 * Text('静态文本');
 * Text(() => vm.title.value, { maxLines: 2, ellipsis: true });   // re-renders when the ref flips
 * ```
 */
export function Text(value: ReactiveSource<string>, options: TextOptions = {}): Label {
  const scene = currentUiScene();
  const { tone, visible, ...rest } = options;
  const label = new Label(scene, {
    ...rest,
    ...(tone === undefined ? {} : { tone: readReactive(tone) }),
    text: readReactive(value),
  });
  scene.add.existing(label);
  emitWidget(label);
  applyDslOptions(label, { visible });
  if (isReactiveSource(value)) {
    bindText(label, sourceGetter(value));
  }
  bindOption(label, tone, (host, next) => host.setTone(next));
  return label;
}

/**
 * Options of `Button`: the widget's bag plus reactive `variant`/`disabled`/`loading`/`value`/`visible`.
 *
 * `value` is the toggle state as a *data slot*, so it behaves like a text field's value: a `Ref` is
 * two-way (flipping the button writes the ref, changing the ref flips the button), a getter is one-way
 * and routes user changes to `onValueChange`.
 */
export type ButtonDslOptions = Omit<ButtonOptions, 'variant' | 'disabled' | 'loading' | 'value'> & {
  variant?: ReactiveSource<ButtonVariant>;
  disabled?: ReactiveSource<boolean>;
  loading?: ReactiveSource<boolean>;
  value?: ReactiveSource<boolean>;
  onValueChange?: (value: boolean, button: ButtonWidget) => void;
} & DslOptions;

/** A button; its label, variant and state flags may all be reactive. */
export function Button(
  label: ReactiveSource<string>,
  options: ButtonDslOptions = {},
): ButtonWidget {
  const scene = currentUiScene();
  const { variant, disabled, loading, value, onValueChange, visible, ...rest } = options;
  const button = new ButtonWidget(scene, {
    ...rest,
    ...(variant === undefined ? {} : { variant: readReactive(variant) }),
    ...(disabled === undefined ? {} : { disabled: readReactive(disabled) === true }),
    ...(loading === undefined ? {} : { loading: readReactive(loading) === true }),
    ...(value === undefined ? {} : { value: readReactive(value) === true }),
    text: readReactive(label),
  });
  scene.add.existing(button);
  emitWidget(button);
  applyDslOptions(button, { visible });
  if (isReactiveSource(label)) {
    bindText(button, sourceGetter(label));
  }
  bindOption(button, variant, (host, next) => host.setVariant(next));
  bindOption(button, disabled, (host, next) => host.setDisabled(next === true));
  bindOption(button, loading, (host, next) => host.setLoading(next === true));

  if (value !== undefined) {
    const store = isWritableSource(value)
      ? (next: boolean): void => writeReactive(value, next)
      : (next: boolean): void => onValueChange?.(next, button);
    bindBooleanModel(button, () => readReactive(value) === true, store);
  }
  if (onValueChange && (value === undefined || isWritableSource(value))) {
    // A getter source already routes user changes to `onValueChange` through the binding above.
    button.on(BUTTON_EVENTS.CHANGE, (next: boolean) => onValueChange(next, button));
  }
  return button;
}

/** A texture image. */
export function Image(options: ImageOptions & DslOptions): ImageWidget {
  const { visible, rest } = splitDsl(options);
  const scene = currentUiScene();
  const widget = new ImageWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return emitWidget(widget);
}

/** Empty space. `Spacer({ flex: true })` is this framework's `Modifier.weight(1f)`. */
export function Spacer(options: SpacerOptions & DslOptions = {}): SpacerWidget {
  const { visible, rest } = splitDsl(options);
  const scene = currentUiScene();
  const widget = new SpacerWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return emitWidget(widget);
}

/** A hairline rule along the cross axis of its parent. */
export function Divider(options: DividerOptions & DslOptions = {}): DividerWidget {
  const { visible, rest } = splitDsl(options);
  const scene = currentUiScene();
  const widget = new DividerWidget(scene, rest);
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return emitWidget(widget);
}

/**
 * Field options plus the Compose-style state pair.
 *
 * `value` accepts a `Ref` (two-way: user edits write straight back into it) or a getter (one-way).
 * `onValueChange` is the hoisted alternative: it fires on every *user* edit, so a caller that keeps
 * state in a store rather than a `ref` can still write it back.
 */
export interface TextFieldDslOptions
  extends Omit<TextFieldOptions, 'value' | 'onChange'>, DslOptions {
  value?: ReactiveSource<string>;
  onValueChange?: (value: string, field: TextFieldWidget) => void;
}

/** {@link TextFieldDslOptions} for the multi-line field. */
export interface TextAreaDslOptions
  extends Omit<TextAreaOptions, 'value' | 'onChange'>, DslOptions {
  value?: ReactiveSource<string>;
  onValueChange?: (value: string, field: TextAreaWidget) => void;
}

/** A single-line text input. */
export function TextField(options: TextFieldDslOptions = {}): TextFieldWidget {
  const scene = currentUiScene();
  const { value, onValueChange, visible, ...rest } = options;
  const field = new TextFieldWidget(scene, {
    ...rest,
    value: value === undefined ? '' : readReactive(value),
  });
  scene.add.existing(field);
  applyDslOptions(field, { visible });
  emitWidget(field);
  wireFieldModel(field, value, onValueChange);
  return field;
}

/** A multi-line text input. */
export function TextArea(options: TextAreaDslOptions = {}): TextAreaWidget {
  const scene = currentUiScene();
  const { value, onValueChange, visible, ...rest } = options;
  const field = new TextAreaWidget(scene, {
    ...rest,
    value: value === undefined ? '' : readReactive(value),
  });
  scene.add.existing(field);
  applyDslOptions(field, { visible });
  emitWidget(field);
  wireFieldModel(field, value, onValueChange);
  return field;
}

/**
 * Options of `Slider`: the widget's bag with a reactive two-way `value`.
 *
 * `value` accepts a `Ref` (edits write straight back into it, no converter glue) or a getter (one-way);
 * `onValueChange` fires on every user change, so a caller that keeps state in a store can write it back.
 */
export interface SliderDslOptions extends Omit<SliderOptions, 'value' | 'onChange'>, DslOptions {
  value?: ReactiveSource<number>;
  onValueChange?: (value: number, slider: SliderWidget) => void;
}

/**
 * A draggable value control — the touch-native one.
 *
 * ```ts
 * Slider({ value: volume, min: 0, max: 1, step: 0.05, width: 200 });
 * Slider({ value: () => settings.brightness, onValueChange: (next) => save(next) });
 * ```
 */
export function Slider(options: SliderDslOptions = {}): SliderWidget {
  const scene = currentUiScene();
  const { value, onValueChange, visible, ...rest } = options;
  const slider = new SliderWidget(scene, {
    ...rest,
    ...(value === undefined ? {} : { value: readReactive(value) }),
  });
  scene.add.existing(slider);
  applyDslOptions(slider, { visible });
  emitWidget(slider);

  if (value !== undefined) {
    const store = isWritableSource(value)
      ? (next: number): void => writeReactive(value, next)
      : (next: number): void => onValueChange?.(next, slider);
    bindNumberModel(slider, sourceGetter(value) as () => number, store);
  }
  if (onValueChange && (value === undefined || isWritableSource(value))) {
    // A getter source already routes user changes to `onValueChange` through the binding above.
    slider.on(SLIDER_EVENTS.CHANGE, (next: number) => onValueChange(next, slider));
  }
  return slider;
}

// --------------------------------------------------------------------- lists

/** Options of `List`: everything `Repeat` takes except the template, which is the content lambda. */
export type ListOptions<Item> = Omit<RepeatOptions<Item>, 'template' | 'empty' | 'container'> &
  DslOptions &
  ListFlowShorthands & {
    /** Content lambda for the empty state; omitted shows nothing. */
    empty?: (() => void) | null;
    /** Row flow in its full form; the shorthands above are merged into it (explicit fields win). */
    container?: BoxLayoutOptions | GridLayoutOptions;
  };

/**
 * A keyed list, optionally virtualised — the `LazyColumn` of this framework.
 *
 * ```ts
 * List({ items: () => vm.rows, key: (row) => row.id, gap: 6 }, (row, index) => {
 *   Row({ gap: 8 }, () => {
 *     Text(() => row.name);
 *     Spacer({ flex: true });
 *     Text(`${index + 1}`);
 *   });
 * });
 * ```
 *
 * The content lambda runs once per key, so it must build exactly one root widget.
 */
export function List<Item>(
  options: ListOptions<Item>,
  item: (item: Item, index: number, ctx: BindingContext) => void,
): Repeat<Item> {
  const scene = currentUiScene();
  const { empty, visible, gap, rowGap, columnGap, container, ...rest } = options;
  const widget = new Repeat<Item>(scene, {
    ...rest,
    container: withListFlow(container, { gap, rowGap, columnGap }),
    template: (row, index, ctx) => buildUiSubtree(scene, () => item(row, index, ctx), 'List()'),
    empty:
      empty === null || empty === undefined
        ? null
        : () => buildUiSubtree(scene, empty, 'List({ empty })'),
  });
  scene.add.existing(widget);
  applyDslOptions(widget, { visible });
  return emitWidget(widget);
}

// --------------------------------------------------------------------- internals

interface ComposedArgs<O> {
  options: O;
  content: (() => void) | undefined;
}

/**
 * Accepts both call shapes: `Column(() => { … })` (Compose-like, no options) and
 * `Column({ gap: 8 }, () => { … })`.
 */
function normalizeContent<O>(
  options: O | (() => void) | undefined,
  content: (() => void) | undefined,
): ComposedArgs<O> {
  if (typeof options === 'function') {
    return { options: {} as O, content: options as () => void };
  }
  return { options: (options ?? {}) as O, content };
}

/**
 * Connects a text field to its data slot.
 *
 * A `Ref` gets full two-way binding (`bindModel` handles both directions and pauses write-back during
 * IME composition); a getter is read-only, so edits are routed to `onValueChange` instead. With
 * neither, the field simply keeps its own value.
 */
function wireFieldModel<T extends TextFieldWidget | TextAreaWidget>(
  field: T,
  value: ReactiveSource<string> | undefined,
  onValueChange: ((value: string, field: T) => void) | undefined,
): void {
  if (value !== undefined) {
    const store = isWritableSource(value)
      ? (next: string): void => writeReactive(value, next)
      : (next: string): void => onValueChange?.(next, field);
    bindModel(field, sourceGetter(value), store);
  }
  if (onValueChange) {
    field.on(TEXT_INPUT_EVENTS.CHANGE, (next: string) => onValueChange(next, field));
  }
}
