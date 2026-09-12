/**
 * `Widget` — the base class of every phaser-mvvm widget.
 *
 * A widget is a `Phaser.GameObjects.Container` that also implements the layout engine's
 * `LayoutNode` contract:
 *
 * - the engine measures it through `measureContent` and writes geometry back through `applyRect`,
 * - it keeps its own list of *widget* children (`children`), which may be a subset of `list`
 *   (a Label, for example, owns a plain `Phaser.GameObjects.Text` that must not participate in
 *   layout),
 * - `markDirty()` bumps `revision` and invalidates the node in the engine, which propagates
 *   upwards so that only the affected subtree is re-measured.
 */

import Phaser from 'phaser';
import {
  type BoxConstraints,
  type ContainerLayout,
  type LayoutEngine,
  type LayoutNode,
  type LayoutParams,
  type Rect,
  type ResolvedParams,
  type Size,
  normalizeParams,
} from '@phaser-mvvm/layout';

export interface WidgetOptions {
  /** Declarative sizing/placement parameters, see `LayoutParams`. */
  layout?: LayoutParams;
  /** Debug name; also used by `scene.children.getByName`. */
  name?: string;
  visible?: boolean;
}

export class Widget extends Phaser.GameObjects.Container implements LayoutNode {
  /** Normalised layout params. Mutate through `setLayoutParams`, not directly. */
  readonly layoutParams: ResolvedParams;

  /** Container algorithm used for this widget's children; `null` means "leaf". */
  container: ContainerLayout | null = null;

  /** Content revision: bumped by `markDirty()`. */
  revision = 0;

  /** Parent layout node; maintained by `addWidget`/`removeWidget`. */
  parent: LayoutNode | null = null;

  /** Layout engine this widget belongs to; propagated down the widget tree. */
  engine: LayoutEngine | null = null;

  /** Rect assigned by the engine, in the parent's local coordinates. */
  protected readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  private readonly widgetChildren: Widget[] = [];

  constructor(scene: Phaser.Scene, options: WidgetOptions = {}) {
    super(scene, 0, 0);

    this.layoutParams = normalizeParams(options.layout);

    if (options.name !== undefined) {
      this.name = options.name;
    }
    if (options.visible !== undefined) {
      super.setVisible(options.visible);
    }

    this.setSize(0, 0);
  }

  // ------------------------------------------------------------------ LayoutNode

  /** Widget children that take part in layout. */
  get children(): readonly LayoutNode[] {
    return this.widgetChildren;
  }

  /** A hidden widget drops out of the flow (it is measured as 0×0 and not placed). */
  get inFlow(): boolean {
    return this.visible;
  }

  /**
   * A widget whose width and height are both fixed cannot change size because of its content, so
   * dirty propagation may stop here instead of walking all the way to the root.
   */
  get isRelayoutBoundary(): boolean {
    const params = this.layoutParams;
    return (
      typeof params.width === 'number' &&
      typeof params.height === 'number' &&
      params.aspectRatio === null
    );
  }

  /** Intrinsic content size. Subclasses override; containers fall back to the arranger. */
  measureContent(_constraint: BoxConstraints): Size {
    return { width: 0, height: 0 };
  }

  /** Called by the engine with the final, snapped rect (parent-local coordinates). */
  applyRect(rect: Rect): void {
    this.rect.x = rect.x;
    this.rect.y = rect.y;
    this.rect.width = rect.width;
    this.rect.height = rect.height;

    this.setPosition(rect.x, rect.y);
    this.setSize(rect.width, rect.height);

    this.onRectChanged(this.rect);
  }

  /** Hook for subclasses that position/size their internal (non-widget) Game Objects. */
  protected onRectChanged(_rect: Rect): void {}

  /** Last rect assigned by the engine. */
  get appliedRect(): Readonly<Rect> {
    return this.rect;
  }

  // ------------------------------------------------------------------ tree

  /** Adds a widget child (re-parenting it if needed) and marks the tree dirty. */
  addWidget<T extends Widget>(child: T): T {
    if ((child as unknown as Widget) === this) {
      throw new Error('Widget.addWidget: a widget cannot be added to itself');
    }

    const previous = child.parent as Widget | null;
    if (previous === (this as unknown as Widget)) {
      return child;
    }
    if (previous && typeof previous.removeWidget === 'function') {
      previous.removeWidget(child, false);
    }

    child.parent = this;
    child.setEngineRecursive(this.engine);
    this.widgetChildren.push(child);
    this.add(child);
    child.once(Phaser.GameObjects.Events.DESTROY, this.handleChildDestroyed, this);

    this.markDirty();
    return child;
  }

  removeWidget<T extends Widget>(child: T, destroy = false): T {
    const index = this.widgetChildren.indexOf(child);
    if (index === -1) {
      if (destroy) {
        child.destroy();
      }
      return child;
    }

    this.widgetChildren.splice(index, 1);
    child.parent = null;
    child.setEngineRecursive(null);
    child.off(Phaser.GameObjects.Events.DESTROY, this.handleChildDestroyed, this);
    this.remove(child, destroy);

    this.markDirty();
    return child;
  }

  removeAllWidgets(destroy = false): this {
    for (let i = this.widgetChildren.length - 1; i >= 0; i--) {
      const child = this.widgetChildren[i];
      if (child) {
        this.removeWidget(child, destroy);
      }
    }
    return this;
  }

  /** Widget children as a mutable-safe copy. */
  getWidgetChildren(): Widget[] {
    return this.widgetChildren.slice();
  }

  // ------------------------------------------------------------------ dirty state

  /** Bumps the content revision and invalidates this node upwards. */
  markDirty(): void {
    this.revision++;
    if (this.engine) {
      this.engine.invalidate(this);
    }
  }

  /** Applies a partial params patch (normalised) and marks the widget dirty. */
  setLayoutParams(patch: LayoutParams): this {
    Object.assign(this.layoutParams, normalizeParams(patch));
    this.markDirty();
    return this;
  }

  override setVisible(value: boolean): this {
    super.setVisible(value);
    this.markDirty();
    return this;
  }

  override destroy(fromScene?: boolean): void {
    for (let i = this.widgetChildren.length - 1; i >= 0; i--) {
      const child = this.widgetChildren[i];
      if (child) {
        child.parent = null;
        child.setEngineRecursive(null);
      }
    }
    this.widgetChildren.length = 0;

    const engine = this.engine;
    this.engine = null;
    this.parent = null;
    if (engine) {
      engine.invalidate(this);
    }

    super.destroy(fromScene);
  }

  // ------------------------------------------------------------------ internals

  /** Propagates the engine reference down the widget tree. */
  protected setEngineRecursive(engine: LayoutEngine | null): void {
    this.engine = engine;
    for (let i = 0; i < this.widgetChildren.length; i++) {
      this.widgetChildren[i]?.setEngineRecursive(engine);
    }
  }

  private handleChildDestroyed(child: Phaser.GameObjects.GameObject): void {
    const index = this.widgetChildren.indexOf(child as Widget);
    if (index !== -1) {
      this.widgetChildren.splice(index, 1);
      this.markDirty();
    }
  }
}
