import Phaser from 'phaser';
import {
  WIDGET_EVENTS,
  type NavAction,
  type NavDirection,
  type NavSource,
  type Widget,
} from '@phaser-mvvm/phaser';
import { setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget } from '../status';

/**
 * Widget gallery: every M4 widget in every state, laid out with the layout engine only.
 *
 * The point of the scene is coverage, not beauty: variants, sizes, disabled/loading/toggle buttons,
 * label truncation, dividers, spacers and a `fit: 'contain'` image, all inside nested grid/box
 * containers.
 *
 * Round 110 added the **third input device**: the page registers its own `NavSource` (a synthetic
 * d-pad the acceptance run drives from `window.gallery`) next to the built-in keyboard and pad 0, which
 * is what makes the named abstraction observable — `nav.sources`, the focus it moves, the
 * `ActivationSource` its activations carry, and the attach/detach counters that prove registration is
 * reversible.
 */
export class GalleryScene extends Phaser.Scene {
  constructor() {
    super('gallery');
  }

  /** Widgets whose `pt.*`/`st.*` are published every frame. */
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  /**
   * The synthetic source: a device the framework has never heard of.
   *
   * It is a plain object implementing `NavSource` and nothing else — no Phaser, no listener, no
   * timer — which is the point: a source is *data* plus three optional hooks. `held` is what the
   * acceptance run presses, `edges` what it fires once, and `attachments` counts how many times the
   * framework attached the device (so a register/unregister round trip is provably neutral).
   */
  private readonly synthetic: {
    attachments: number;
    detachments: number;
    held: NavDirection[];
    edges: NavAction[];
    source: NavSource;
  } = {
    attachments: 0,
    detachments: 0,
    held: [],
    edges: [],
    source: {
      name: 'gallery-dpad',
      source: 'touch',
      attach: () => {
        this.synthetic.attachments += 1;
        return () => {
          this.synthetic.detachments += 1;
          this.synthetic.held.length = 0;
          this.synthetic.edges.length = 0;
        };
      },
      poll: (host) => {
        for (const action of this.synthetic.edges.splice(0)) {
          host.dispatch(action, 'touch');
        }
      },
      heldDirections: () => this.synthetic.held,
    },
  };

  /** Activations seen through the per-widget event, with the device they came from. */
  private readonly activations: Array<{ name: string; source: string }> = [];

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
      this.publish(
        `pt.${key}`,
        `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
          pagePoint(this.game, widget).y,
        )}`,
      );
    }
    this.publish(
      'focusables',
      this.mvvm.focus.focusables.map((w) => w.name || 'unnamed').join('+'),
    );
    this.publish('nav.sources', this.mvvm.navSources.join('+'));
    const last = this.activations[this.activations.length - 1];
    this.publish('nav.lastActivation', last ? `${last.name}:${last.source}` : 'none');
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
        this.add.uiLabel({ text: 'Heading · xl', size: 'xl' }),
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
          size: 'lg',
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

    this.exposeGalleryApi();

    appendStatus('--- gallery layout ---');
    reportWidget('page', page);
    reportWidget('grid', columns);
    reportWidget('buttons', buttonColumn);
    reportWidget('labels', labelColumn);
    reportWidget('images', imageColumn);
    reportCanvas(this.game);
    appendStatus(`nav.sources=${this.mvvm.navSources.join('+')}`);
    setDemoState('scene', 'gallery');
  }

  /**
   * The acceptance surface for the navigation-source abstraction.
   *
   * `press('right')` is a *held* direction (the framework's `NavRepeat` turns it into one action and
   * then auto-repeat), `fire('activate')` is a one-shot — the two halves of `NavSource`. Nothing here
   * touches focus directly: every action goes through `host.dispatch()`, exactly like the keyboard and
   * the pad, so the readouts below describe the framework's own routing.
   */
  private exposeGalleryApi(): void {
    for (const widget of this.tracked.values()) {
      widget.on(WIDGET_EVENTS.ACTIVATE, (source: string) => {
        this.activations.push({ name: widget.name || 'unnamed', source });
        if (this.activations.length > 20) {
          this.activations.shift();
        }
      });
    }

    (window as unknown as { gallery?: unknown }).gallery = {
      /** Which sources this scene accepts navigation from, in registration order. */
      sources: (): readonly string[] => this.mvvm.navSources,
      /** Registers the synthetic device; throws if it is already registered. */
      registerSource: (): readonly string[] => {
        this.mvvm.registerNavSource(this.synthetic.source);
        return this.mvvm.navSources;
      },
      /** Detaches and forgets it. Returns whether it was registered. */
      unregisterSource: (): boolean => this.mvvm.unregisterNavSource('gallery-dpad'),
      /** Holds a direction on the synthetic device (`[]` releases everything). */
      press: (...directions: NavDirection[]): void => {
        this.synthetic.held.length = 0;
        this.synthetic.held.push(...directions);
      },
      /** Fires a one-shot action from the synthetic device. */
      fire: (action: NavAction): void => {
        this.synthetic.edges.push(action);
      },
      /** Everything a check reads in one call. */
      state: (): Record<string, unknown> => ({
        sources: [...this.mvvm.navSources],
        attached: this.synthetic.attachments,
        detached: this.synthetic.detachments,
        held: [...this.synthetic.held],
        focus: this.mvvm.focus.focusedWidget?.name || 'none',
        activations: this.activations.map((entry) => ({ ...entry })),
      }),
      /** Drops the recorded activations, so a measurement starts from a known place. */
      clearActivations: (): void => {
        this.activations.length = 0;
      },
    };
  }
}
