/**
 * Declarative layout containers.
 *
 * These are thin widgets: they own a `ContainerLayout` (box / grid / stack / absolute) and let the
 * engine's arranger algorithms position their children. The option objects mix node-level
 * `LayoutParams` (width, height, margin, padding, grow, …) with container-level options
 * (gap, justifyContent, columns, …); the two sets are split at construction time, so the same
 * object can be handed to any of them.
 */

import type {
  Align,
  Axis,
  GridLayoutOptions,
  Justify,
  LayoutParams,
  StackLayoutOptions,
} from '@phaser-mvvm/layout';
import { Widget } from './Widget';

export interface BoxWidgetOptions extends LayoutParams {
  direction?: Axis;
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  justifyContent?: Justify;
  alignItems?: Align;
  wrap?: boolean;
  alignContent?: Justify;
  reverse?: boolean;
  name?: string;
}

export interface GridWidgetOptions extends LayoutParams {
  columns?: number | 'auto';
  rows?: number | 'auto';
  minColumnWidth?: number;
  minRowHeight?: number;
  columnGap?: number;
  rowGap?: number;
  justifyItems?: Align;
  alignItems?: Align;
  autoFlow?: 'row' | 'column';
  name?: string;
}

export interface StackWidgetOptions extends LayoutParams {
  align?: StackLayoutOptions['align'];
  name?: string;
}

export type AbsoluteWidgetOptions = LayoutParams & { name?: string };

const BOX_KEYS = [
  'direction',
  'gap',
  'rowGap',
  'columnGap',
  'justifyContent',
  'alignItems',
  'wrap',
  'alignContent',
  'reverse',
] as const;

const GRID_KEYS = [
  'columns',
  'rows',
  'minColumnWidth',
  'minRowHeight',
  'columnGap',
  'rowGap',
  'justifyItems',
  'alignItems',
  'autoFlow',
] as const;

const STACK_KEYS = ['align'] as const;

/** Splits a mixed option bag into `LayoutParams` and container options. */
export function splitOptions<C extends Record<string, unknown>>(
  options: Record<string, unknown>,
  containerKeys: readonly string[],
): { layout: LayoutParams; container: C } {
  const layout: Record<string, unknown> = {};
  const container: Record<string, unknown> = {};

  for (const key of Object.keys(options)) {
    const value = options[key];
    if (value === undefined || key === 'name') {
      continue;
    }
    if (containerKeys.includes(key)) {
      container[key] = value;
    } else {
      layout[key] = value;
    }
  }

  return { layout: layout as LayoutParams, container: container as C };
}

export class BoxWidget extends Widget {
  constructor(scene: Phaser.Scene, options: BoxWidgetOptions = {}, children: Widget[] = []) {
    const { layout, container } = splitOptions<Omit<BoxWidgetOptions, keyof LayoutParams>>(
      options as Record<string, unknown>,
      BOX_KEYS,
    );
    const direction: Axis = (container.direction as Axis | undefined) ?? 'vertical';
    super(scene, { layout, name: options.name });
    this.container = {
      type: 'box',
      options: { ...container, direction },
    };
    for (const child of children) {
      this.addWidget(child);
    }
  }
}

export class GridWidget extends Widget {
  constructor(scene: Phaser.Scene, options: GridWidgetOptions = {}, children: Widget[] = []) {
    const { layout, container } = splitOptions<Omit<GridWidgetOptions, keyof LayoutParams>>(
      options as Record<string, unknown>,
      GRID_KEYS,
    );
    super(scene, { layout, name: options.name });
    this.container = { type: 'grid', options: container as GridLayoutOptions };
    for (const child of children) {
      this.addWidget(child);
    }
  }
}

export class StackWidget extends Widget {
  constructor(scene: Phaser.Scene, options: StackWidgetOptions = {}, children: Widget[] = []) {
    const { layout, container } = splitOptions<Omit<StackWidgetOptions, keyof LayoutParams>>(
      options as Record<string, unknown>,
      STACK_KEYS,
    );
    super(scene, { layout, name: options.name });
    this.container = { type: 'stack', options: container as StackLayoutOptions };
    for (const child of children) {
      this.addWidget(child);
    }
  }
}

/** A container whose children position themselves with `position: 'absolute'` + offsets. */
export class AbsoluteWidget extends Widget {
  constructor(scene: Phaser.Scene, options: AbsoluteWidgetOptions = {}, children: Widget[] = []) {
    const { layout } = splitOptions<Record<string, unknown>>(
      options as Record<string, unknown>,
      [],
    );
    super(scene, { layout, name: options.name });
    this.container = { type: 'absolute' };
    for (const child of children) {
      this.addWidget(child);
    }
  }
}

/** Creates a vertical box and registers it with the scene. */
export function vbox(
  scene: Phaser.Scene,
  options: BoxWidgetOptions = {},
  children: Widget[] = [],
): BoxWidget {
  const widget = new BoxWidget(scene, { ...options, direction: 'vertical' }, children);
  scene.add.existing(widget);
  return widget;
}

/** Creates a horizontal box and registers it with the scene. */
export function hbox(
  scene: Phaser.Scene,
  options: BoxWidgetOptions = {},
  children: Widget[] = [],
): BoxWidget {
  const widget = new BoxWidget(scene, { ...options, direction: 'horizontal' }, children);
  scene.add.existing(widget);
  return widget;
}

export function grid(
  scene: Phaser.Scene,
  options: GridWidgetOptions = {},
  children: Widget[] = [],
): GridWidget {
  const widget = new GridWidget(scene, options, children);
  scene.add.existing(widget);
  return widget;
}

export function stack(
  scene: Phaser.Scene,
  options: StackWidgetOptions = {},
  children: Widget[] = [],
): StackWidget {
  const widget = new StackWidget(scene, options, children);
  scene.add.existing(widget);
  return widget;
}

export function absolute(
  scene: Phaser.Scene,
  options: AbsoluteWidgetOptions = {},
  children: Widget[] = [],
): AbsoluteWidget {
  const widget = new AbsoluteWidget(scene, options, children);
  scene.add.existing(widget);
  return widget;
}
