import Phaser from 'phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import { setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

/**
 * Widget gallery: every M4 widget in every state, laid out with the layout engine only.
 *
 * The point of the scene is coverage, not beauty: variants, sizes, disabled/loading/toggle buttons,
 * label truncation, dividers, spacers and a `fit: 'contain'` image, all inside nested grid/box
 * containers.
 */
export class GalleryScene extends Phaser.Scene {
  constructor() {
    super('gallery');
  }

  /** Widgets whose `pt.*`/`st.*` are published every frame. */
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  private track(key: string, widget: Widget): void {
    this.tracked.set(key, widget);
  }

  /** Per-frame probe publish: coordinates plus `visualState` for every named control. */
  override update(): void {
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed) {
        continue;
      }
      this.publish(`st.${key}`, widget.visualState);
      if (!widget.visible || widget.appliedRect.width <= 0 || widget.appliedRect.height <= 0) {
        continue;
      }
      const canvas = this.game.canvas.getBoundingClientRect();
      const origin = stagePosition(widget);
      this.publish(
        `pt.${key}`,
        `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
          canvas.top + origin.y + widget.appliedRect.height / 2,
        )}`,
      );
    }
    this.publish(
      'focusables',
      this.mvvm.focus.focusables.map((w) => w.name || 'unnamed').join('+'),
    );
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  create(): void {
    const theme = this.mvvm.theme;

    const buttonColumn = this.add.uiPanel(
      { direction: 'vertical', gap: 10, padding: 16, variant: 'surfaceAlt', radius: 10 },
      [
        this.add.uiLabel({ text: 'Buttons', tone: 'muted' }),
        this.add.uiButton({ text: 'Primary', variant: 'primary', name: 'primary' }),
        this.add.uiButton({ text: 'Secondary', variant: 'secondary', name: 'secondary' }),
        this.add.uiButton({ text: 'Ghost', variant: 'ghost', name: 'ghost' }),
        this.add.uiButton({ text: 'Danger', variant: 'danger', name: 'danger' }),
        this.add.uiDivider({}),
        this.add.uiButton({ text: 'Small', size: 'sm', name: 'small' }),
        this.add.uiButton({ text: 'Large', size: 'lg', name: 'large' }),
        this.add.uiButton({ text: 'Disabled', disabled: true, name: 'disabled' }),
        this.add.uiButton({ text: 'Loading', loading: true, name: 'loading' }),
        this.add.uiButton({
          text: 'Toggle: off',
          name: 'toggle',
          toggle: true,
          value: false,
        }),
      ],
    );

    const labelColumn = this.add.uiPanel(
      { direction: 'vertical', gap: 8, padding: 16, variant: 'surface', radius: 10 },
      [
        this.add.uiLabel({ text: 'Typography', tone: 'muted' }),
        this.add.uiLabel({ text: 'Heading · xl', style: { fontSize: `${theme.fontSize.xl}px` } }),
        this.add.uiLabel({ text: 'Body · md' }),
        this.add.uiLabel({ text: 'Muted body text', tone: 'muted' }),
        this.add.uiLabel({ text: 'Danger tone', tone: 'danger' }),
        this.add.uiLabel({ text: 'Success tone', tone: 'success' }),
        this.add.uiDivider({}),
        this.add.uiLabel({
          text:
            'Long text that must be truncated to the configured number of lines with an ellipsis: ' +
            'layout, measurement and truncation all happen in the engine, not in the renderer.',
          maxLines: 2,
          ellipsis: true,
          width: 260,
        }),
      ],
    );

    const imageColumn = this.add.uiPanel(
      { direction: 'vertical', gap: 12, padding: 16, variant: 'surfaceAlt', radius: 10 },
      [
        this.add.uiLabel({ text: 'Image fit', tone: 'muted' }),
        this.add.uiImage({ texture: 'demo-tile', fit: 'contain', width: 120, height: 64 }),
        this.add.uiImage({ texture: 'demo-tile', fit: 'cover', width: 120, height: 64 }),
        this.add.uiImage({ texture: 'demo-tile', fit: 'fill', width: 120, height: 64 }),
        this.add.uiSpacer({ height: 4 }),
        this.add.uiLabel({ text: 'Spacer + divider', tone: 'muted' }),
        this.add.uiDivider({}),
        this.add.uiSpacer({ flex: true }),
      ],
    );

    const columns = this.add.uiGrid(
      { columns: 3, columnGap: 16, rowGap: 16, alignItems: 'start', justifyItems: 'stretch' },
      [buttonColumn, labelColumn, imageColumn],
    );

    const page = this.add.uiPanel(
      { direction: 'vertical', gap: 16, padding: 24, variant: 'plain', alignItems: 'stretch' },
      [
        this.add.uiLabel({
          text: 'Widget gallery · M4',
          style: { fontSize: `${theme.fontSize.lg}px` },
        }),
        this.add.uiLabel({
          text: 'Tab / arrows to move focus · Enter or Space to activate · gamepad supported',
          tone: 'muted',
        }),
        columns,
      ],
    );

    this.mvvm.mount(page);

    const primaryButton = buttonColumn
      .getWidgetChildren()
      .find((child) => child.name === 'primary');
    const toggleButton = buttonColumn.getWidgetChildren().find((child) => child.name === 'toggle');

    // A toggle button reports its state through the `change` event rather than `onClick`.
    toggleButton?.once('change', () => undefined);
    toggleButton?.on('change', (value: boolean) => {
      (toggleButton as unknown as { setText(text: string): void }).setText(
        `Toggle: ${value ? 'on' : 'off'}`,
      );
      setDemoState('toggle', value);
    });
    // Every control is named and tracked: this page's job is "every widget in every state", so those
    // states have to be readable from outside (a focus readout of `unnamed` proves nothing).
    for (const key of [
      'primary',
      'secondary',
      'ghost',
      'danger',
      'small',
      'large',
      'disabled',
      'loading',
      'toggle',
    ]) {
      const widget = buttonColumn.getWidgetChildren().find((child) => child.name === key);
      if (widget) {
        this.track(key, widget);
      }
    }
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };
    // Start with a visible focus ring so the keyboard-navigation behaviour is observable.
    if (primaryButton) {
      this.mvvm.focus.focus(primaryButton as never);
    }

    appendStatus('--- gallery layout ---');
    reportWidget('page', page);
    reportWidget('grid', columns);
    reportWidget('buttons', buttonColumn);
    reportWidget('labels', labelColumn);
    reportWidget('images', imageColumn);
    reportCanvas(this.game);
    setDemoState('scene', 'gallery');
  }
}
