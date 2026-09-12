/**
 * Geometry helpers shared by the widgets.
 *
 * A widget's own rect (from the layout engine) is expressed in the parent's coordinates, while its
 * internal Game Objects live in the container's local space, where `(0, 0)` is the widget's
 * top-left corner. These helpers turn a rect plus the node's padding into that local content box.
 * No Phaser import, so the maths stays unit-testable in Node.
 */

import type { Insets, Rect } from '@phaser-mvvm/layout';

/** The widget's content box in its own local space (the rect deflated by `layoutParams.padding`). */
export function contentBox(width: number, height: number, insets: Insets): Rect {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, width - insets.left - insets.right),
    height: Math.max(0, height - insets.top - insets.bottom),
  };
}

/** Offset that centres `inner` inside `outer`; never negative (the caller decides about overflow). */
export function centeredOffset(inner: number, outer: number): number {
  return Math.max(0, (outer - inner) / 2);
}

/** Offset that centres `inner` inside `outer`, allowing negative values (for `cover` overflow). */
export function centeredOffsetOverflow(inner: number, outer: number): number {
  return (outer - inner) / 2;
}
