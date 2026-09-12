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
import { devLog, warn } from '@phaser-mvvm/core';
import {
  AbsoluteWidget,
  type AbsoluteWidgetOptions,
  bindModel,
  bindText,
  BoxWidget,
  type BoxWidgetOptions,
  buildUiSubtree,
  currentUiScene,
  emitWidget,
  GridWidget,
  type GridWidgetOptions,
  runInUiScope,
  StackWidget,
  type StackWidgetOptions,
  type Widget,
  withUiParent,
} from '@phaser-mvvm/phaser';
import { Button as ButtonWidget, type ButtonOptions } from './Button';
import { Divider as DividerWidget, type DividerOptions } from './Divider';
import { Image as ImageWidget, type ImageOptions } from './Image';
import { Label, type LabelOptions } from './Label';
import { Panel as PanelWidget, type PanelOptions } from './Panel';
import { Repeat, type RepeatOptions } from './Repeat';
import { ScrollView, type ScrollViewOptions } from './ScrollView';
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

// --------------------------------------------------------------------- containers

/** Options of `Column`/`Row`: the box widget's own bag, unchanged. */
export type ColumnOptions = BoxWidgetOptions;
export type RowOptions = BoxWidgetOptions;

/** A vertical box: `Column({ gap: 8 }, () => { … })` or `Column(() => { … })`. */
export function Column(options?: BoxWidgetOptions | (() => void), content?: () => void): BoxWidget {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new BoxWidget(scene, { ...args.options, direction: 'vertical' });
  scene.add.existing(widget);
  return withUiParent(widget, args.content);
}

/** A horizontal box. */
export function Row(options?: BoxWidgetOptions | (() => void), content?: () => void): BoxWidget {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new BoxWidget(scene, { ...args.options, direction: 'horizontal' });
  scene.add.existing(widget);
  return withUiParent(widget, args.content);
}

/** A grid of equally sized tracks. */
export function Grid(options?: GridWidgetOptions | (() => void), content?: () => void): GridWidget {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new GridWidget(scene, args.options);
  scene.add.existing(widget);
  return withUiParent(widget, args.content);
}

/** A stack: children overlap and are aligned inside the same box. */
export function Stack(
  options?: StackWidgetOptions | (() => void),
  content?: () => void,
): StackWidget {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new StackWidget(scene, args.options);
  scene.add.existing(widget);
  return withUiParent(widget, args.content);
}

/** An absolutely positioned container: children carry `position: 'absolute'` plus their offsets. */
export function Absolute(
  options?: AbsoluteWidgetOptions | (() => void),
  content?: () => void,
): AbsoluteWidget {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new AbsoluteWidget(scene, args.options);
  scene.add.existing(widget);
  return withUiParent(widget, args.content);
}

/**
 * A themed, painted container — the Compose `Surface`/`Card` of this framework.
 *
 * `Column`/`Row` are transparent layout boxes; `Panel` is the one that paints a background, so it is
 * what a card, a dialog or a page root is made of.
 */
export function Panel(options?: PanelOptions | (() => void), content?: () => void): PanelWidget {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new PanelWidget(scene, args.options);
  scene.add.existing(widget);
  return withUiParent(widget, args.content);
}

/** Alias of `Panel`, for readers coming from Compose. */
export const Surface = Panel;

/**
 * A clipped viewport: `Scroll({ height: 240 }, () => { … })`.
 *
 * The content lambda builds exactly one widget, which becomes the scroll content. A `Scroll` whose
 * content is itself a `List` also gets virtualisation, because `ScrollView` finds the list it wraps.
 */
export function Scroll(
  options?: Omit<ScrollViewOptions, 'content'> | (() => void),
  content?: () => void,
): ScrollView {
  const args = normalizeContent(options, content);
  const scene = currentUiScene();
  const widget = new ScrollView(scene, args.options);
  scene.add.existing(widget);
  emitWidget(widget);
  if (args.content) {
    widget.setContent(buildUiSubtree(scene, args.content, 'Scroll()'));
  }
  return widget;
}

// --------------------------------------------------------------------- leaves

/** Options of `Text`: the label's own bag. */
export type TextOptions = LabelOptions;

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
  const label = new Label(scene, { ...options, text: readReactive(value) });
  scene.add.existing(label);
  emitWidget(label);
  if (isReactiveSource(value)) {
    bindText(label, sourceGetter(value));
  }
  return label;
}

/** A button; its label may be reactive, exactly like `Text`. */
export function Button(label: ReactiveSource<string>, options: ButtonOptions = {}): ButtonWidget {
  const scene = currentUiScene();
  const button = new ButtonWidget(scene, { ...options, text: readReactive(label) });
  scene.add.existing(button);
  emitWidget(button);
  if (isReactiveSource(label)) {
    bindText(button, sourceGetter(label));
  }
  return button;
}

/** A texture image. */
export function Image(options: ImageOptions): ImageWidget {
  const scene = currentUiScene();
  const widget = new ImageWidget(scene, options);
  scene.add.existing(widget);
  return emitWidget(widget);
}

/** Empty space. `Spacer({ flex: true })` is this framework's `Modifier.weight(1f)`. */
export function Spacer(options: SpacerOptions = {}): SpacerWidget {
  const scene = currentUiScene();
  const widget = new SpacerWidget(scene, options);
  scene.add.existing(widget);
  return emitWidget(widget);
}

/** A hairline rule along the cross axis of its parent. */
export function Divider(options: DividerOptions = {}): DividerWidget {
  const scene = currentUiScene();
  const widget = new DividerWidget(scene, options);
  scene.add.existing(widget);
  return emitWidget(widget);
}

/**
 * Field options plus the Compose-style state pair.
 *
 * `value` accepts a `Ref` (two-way: user edits write straight back into it) or a getter (one-way).
 * `onValueChange` is the hoisted alternative: it fires on every *user* edit, so a caller that keeps
 * state in a store rather than a `ref` can still write it back.
 */
export interface TextFieldDslOptions extends Omit<TextFieldOptions, 'value' | 'onChange'> {
  value?: ReactiveSource<string>;
  onValueChange?: (value: string, field: TextFieldWidget) => void;
}

/** {@link TextFieldDslOptions} for the multi-line field. */
export interface TextAreaDslOptions extends Omit<TextAreaOptions, 'value' | 'onChange'> {
  value?: ReactiveSource<string>;
  onValueChange?: (value: string, field: TextAreaWidget) => void;
}

/** A single-line text input. */
export function TextField(options: TextFieldDslOptions = {}): TextFieldWidget {
  const scene = currentUiScene();
  const { value, onValueChange, ...rest } = options;
  const field = new TextFieldWidget(scene, {
    ...rest,
    value: value === undefined ? '' : readReactive(value),
  });
  scene.add.existing(field);
  emitWidget(field);
  wireFieldModel(field, value, onValueChange);
  return field;
}

/** A multi-line text input. */
export function TextArea(options: TextAreaDslOptions = {}): TextAreaWidget {
  const scene = currentUiScene();
  const { value, onValueChange, ...rest } = options;
  const field = new TextAreaWidget(scene, {
    ...rest,
    value: value === undefined ? '' : readReactive(value),
  });
  scene.add.existing(field);
  emitWidget(field);
  wireFieldModel(field, value, onValueChange);
  return field;
}

// --------------------------------------------------------------------- lists

/** Options of `List`: everything `Repeat` takes except the template, which is the content lambda. */
export type ListOptions<Item> = Omit<RepeatOptions<Item>, 'template' | 'empty'> & {
  /** Content lambda for the empty state; omitted shows nothing. */
  empty?: (() => void) | null;
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
  const { empty, ...rest } = options;
  const widget = new Repeat<Item>(scene, {
    ...rest,
    template: (row, index, ctx) => buildUiSubtree(scene, () => item(row, index, ctx), 'List()'),
    empty:
      empty === null || empty === undefined
        ? null
        : () => buildUiSubtree(scene, empty, 'List({ empty })'),
  });
  scene.add.existing(widget);
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
