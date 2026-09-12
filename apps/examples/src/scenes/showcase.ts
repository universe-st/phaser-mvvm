/**
 * `#/showcase` — the acceptance page: every widget, every layout container and every layout
 * parameter in one place, with live readouts.
 *
 * How to use it:
 * - the left column navigates the sections (one button each) and `Show all` stacks them into one
 *   long page, so a reviewer can scroll through the whole surface;
 * - the stage on the right is a `ScrollView`, so a section can be as tall as it needs to be and the
 *   overflow is clipped rather than pushed off screen;
 * - every card has a title and a caption saying what it demonstrates, and every card is built from
 *   the public widget API only (no bespoke drawing);
 * - the header and footer mirror the live state into `#demo-state` (`section`, `widgets`, `clicks`,
 *   `focus`, `repeat.*`, `scroll.offset`, …) and every control a check may click is published as a
 *   `pt.*` point, refreshed every frame;
 * - `window.showcase` exposes `sections()`, `show(id)`, `showAll()`, `state()` and `geometry()`.
 *
 * Sections: text · buttons · inputs · decoration · box · grid · stack · params · repeat · focus.
 */

import Phaser from 'phaser';
import { BindingContext, computed, ref } from '@phaser-mvvm/core';
import { bindTemplateText } from '@phaser-mvvm/phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import type { PanelOptions } from '@phaser-mvvm/widgets';
import { makeTileTexture, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

/** Machine id of a section; also the `pt.nav.<id>` suffix. */
type SectionId =
  | 'text'
  | 'buttons'
  | 'inputs'
  | 'decoration'
  | 'box'
  | 'grid'
  | 'stack'
  | 'params'
  | 'repeat'
  | 'focus';

interface SectionDef {
  id: SectionId;
  group: string;
  title: string;
  caption: string;
}

const SECTIONS: readonly SectionDef[] = [
  {
    id: 'text',
    group: 'widgets',
    title: 'Label',
    caption: 'tones · sizes · alignment · truncation',
  },
  {
    id: 'buttons',
    group: 'widgets',
    title: 'Button',
    caption: 'variants · sizes · states · icons',
  },
  {
    id: 'inputs',
    group: 'widgets',
    title: 'Text inputs',
    caption: 'TextField · TextArea · validation',
  },
  {
    id: 'decoration',
    group: 'widgets',
    title: 'Panel & decor',
    caption: 'variants · radius · elevation · divider · spacer · image',
  },
  {
    id: 'box',
    group: 'layout',
    title: 'Box',
    caption: 'vertical · horizontal · gap · align · wrap',
  },
  { id: 'grid', group: 'layout', title: 'Grid', caption: 'columns · auto columns · spans · gaps' },
  { id: 'stack', group: 'layout', title: 'Stack & absolute', caption: 'overlap · align · corners' },
  {
    id: 'params',
    group: 'layout',
    title: 'Layout params',
    caption: 'width · grow · min/max · aspect · order · alignSelf',
  },
  {
    id: 'repeat',
    group: 'data',
    title: 'Repeat & scroll',
    caption: 'virtualised list in a ScrollView',
  },
  { id: 'focus', group: 'input', title: 'Focus & a11y', caption: 'tab order · readout · disabled' },
];

const NAV_WIDTH = 232;
const PAGE_MARGIN = 12;
const TILE_TEXTURE = 'showcase.tile';

/** Row of the sample list in the `repeat` section. */
interface SampleRow {
  id: string;
  label: string;
}

/** Controls whose page coordinates are republished every frame (`pt.<key>`). */
type TrackedControls = Map<string, Widget>;

export class ShowcaseScene extends Phaser.Scene {
  // ------------------------------------------------------------------ live view model

  private readonly section = ref<SectionId | 'all'>('buttons');
  private readonly showAll = ref(false);
  private readonly clicks = ref(0);
  private readonly toggled = ref(false);
  private readonly fieldValue = ref('');
  private readonly emailValue = ref('');
  private readonly areaLength = ref(0);
  private readonly focusName = ref('none');
  private readonly themeName = ref<'dark' | 'light'>('dark');
  private readonly widgetCount = ref(0);
  private readonly rows = ref<SampleRow[]>(createRows(200));
  private readonly repeatRendered = ref(0);
  private readonly stageOffset = ref(0);

  private readonly validEmail = computed(() =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.emailValue.value),
  );

  private pageContext: BindingContext | null = null;

  // ------------------------------------------------------------------ scene state

  private page: Widget | null = null;
  private nav: Widget | null = null;
  private stage: Widget | null = null;
  private stageContent: Widget | null = null;
  private sectionHost: Widget | null = null;
  private repeatWidget: { renderedCount: number } | null = null;
  private readonly tracked: TrackedControls = new Map();
  private readonly trackedGroups = new Map<string, Set<string>>();
  private readonly reported = new Map<string, string>();

  constructor() {
    super('showcase');
  }

  create(): void {
    const theme = this.mvvm.theme;
    makeTileTexture(this, TILE_TEXTURE, 64);
    const scene = this;
    this.reported.clear();
    this.tracked.clear();

    this.pageContext = new BindingContext({
      get section(): string {
        return scene.section.value;
      },
      get widgets(): number {
        return scene.widgetCount.value;
      },
      get clicks(): number {
        return scene.clicks.value;
      },
      get toggled(): string {
        return scene.toggled.value ? 'on' : 'off';
      },
      get focus(): string {
        return scene.focusName.value;
      },
      get rendered(): number {
        return scene.repeatRendered.value;
      },
      get total(): number {
        return scene.rows.value.length;
      },
      get offset(): number {
        return Math.round(scene.stageOffset.value);
      },
      get theme(): string {
        return scene.themeName.value;
      },
      get emailValid(): string {
        return scene.validEmail.value ? 'valid' : 'invalid';
      },
    });
    const scope = this.pageContext;

    // Header --------------------------------------------------------------------------------------
    const title = this.add.uiLabel({
      text: 'phaser-mvvm · widgets & layout showcase',
      style: { fontSize: `${theme.fontSize.lg}px` },
    });
    const summary = this.add.uiLabel({ text: '', tone: 'muted' });
    bindTemplateText(summary, scope, '{{ section }} · {{ widgets }} widgets · {{ theme }} theme');

    const allButton = this.add.uiButton({
      text: 'Show all',
      variant: 'secondary',
      size: 'sm',
      name: 'showAll',
      onClick: () => this.setShowAll(!this.showAll.value),
    });
    const nextButton = this.add.uiButton({
      text: 'Next section',
      variant: 'primary',
      size: 'sm',
      name: 'next',
      onClick: () => this.nextSection(),
    });
    const themeButton = this.add.uiButton({
      text: 'Theme: dark',
      variant: 'secondary',
      size: 'sm',
      name: 'themeButton',
      onClick: () => {
        this.themeName.value = this.themeName.value === 'dark' ? 'light' : 'dark';
        this.mvvm.setTheme(this.themeName.value);
        themeButton.setText(`Theme: ${this.themeName.value}`);
      },
    });
    this.track('header', 'header.showAll', allButton);
    this.track('header', 'header.next', nextButton);
    this.track('header', 'header.theme', themeButton);

    const header = this.add.uiPanel(
      { direction: 'horizontal', gap: 10, alignItems: 'center', width: 'fill', variant: 'plain' },
      [title, summary, this.add.uiSpacer({ flex: true }), allButton, nextButton, themeButton],
    );

    // Navigator -----------------------------------------------------------------------------------
    this.nav = this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 6,
        padding: 10,
        width: NAV_WIDTH,
        variant: 'surface',
        radius: 10,
      },
      [],
    );

    // Stage ---------------------------------------------------------------------------------------
    this.sectionHost = this.add.uiPanel(
      { direction: 'vertical', gap: 12, width: 'fill', variant: 'plain' },
      [],
    );
    this.stageContent = this.add.uiPanel(
      { direction: 'vertical', gap: 12, width: 'fill', variant: 'plain' },
      [this.sectionHost],
    );
    this.stage = this.add.uiScroll({
      width: 'fill',
      height: 'fill',
      direction: 'vertical',
      scrollbar: 'auto',
      content: this.stageContent,
      name: 'showcase.stage',
    });

    const body = this.add.uiPanel(
      {
        direction: 'horizontal',
        gap: 12,
        alignItems: 'stretch',
        width: 'fill',
        grow: 1,
        variant: 'plain',
      },
      [this.nav, this.stage],
    );

    // Footer --------------------------------------------------------------------------------------
    const focusLabel = this.add.uiLabel({ text: '', tone: 'muted' });
    bindTemplateText(focusLabel, scope, 'focus: {{ focus }}');
    const dataLabel = this.add.uiLabel({ text: '', tone: 'muted' });
    bindTemplateText(dataLabel, scope, 'rows {{ rendered }}/{{ total }} · scroll {{ offset }} px');

    const footer = this.add.uiPanel(
      { direction: 'horizontal', gap: 10, alignItems: 'center', width: 'fill', variant: 'plain' },
      [
        this.add.uiLabel({
          text: 'Tab / Shift+Tab · arrows · Enter or Space activate · wheel or drag scrolls the stage',
          tone: 'muted',
        }),
        this.add.uiSpacer({ flex: true }),
        focusLabel,
        dataLabel,
      ],
    );

    const page = this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 10,
        padding: PAGE_MARGIN,
        variant: 'plain',
        alignItems: 'stretch',
      },
      [header, body, footer],
    );
    this.page = page;

    // Fill the window (the root is a centred stack, so the page sizes itself) and follow resizes.
    this.fitPage();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitPage, this);

    this.mvvm.mount(page);
    this.mvvm.focus.onFocusChange = (widget) => {
      this.focusName.value = widget ? widget.name || 'unnamed' : 'none';
    };

    appendStatus('--- showcase layout ---');
    reportWidget('page', page);
    reportCanvas(this.game);

    setDemoState('scene', 'showcase');
    setDemoState('sections', SECTIONS.length);
    this.rebuildNav();
    this.showSection('buttons');

    (window as unknown as { showcase?: unknown }).showcase = {
      sections: () => SECTIONS.map((def) => def.id),
      show: (id: string) => this.showSection(id as SectionId),
      showAll: () => this.setShowAll(true),
      state: () => ({
        section: this.section.value,
        widgets: this.widgetCount.value,
        clicks: this.clicks.value,
        toggled: this.toggled.value,
        focus: this.focusName.value,
        theme: this.themeName.value,
        repeat: { rendered: this.repeatRendered.value, total: this.rows.value.length },
        scroll: Math.round(this.stageOffset.value),
      }),
      controls: () => [...this.tracked.keys()],
      geometry: () => ({
        page: this.page ? { ...this.page.appliedRect } : null,
        nav: this.nav ? { ...this.nav.appliedRect } : null,
        stage: this.stage ? { ...this.stage.appliedRect } : null,
        content: this.stageContent ? { ...this.stageContent.appliedRect } : null,
        section: this.sectionHost ? { ...this.sectionHost.appliedRect } : null,
      }),
    };
  }

  /** Sizes the page to the window; also the thing `setLayoutParams` has to get right. */
  private fitPage(): void {
    const size = this.scale.gameSize;
    this.page?.setLayoutParams({
      width: Math.max(320, size.width - 2 * PAGE_MARGIN),
      height: Math.max(240, size.height - 2 * PAGE_MARGIN),
    });
  }

  /** Publishes the live state and every tracked control's page coordinates, once per frame. */
  override update(): void {
    const widgets = this.stageContent ? countWidgets(this.stageContent) : 0;
    if (widgets !== this.widgetCount.value) {
      this.widgetCount.value = widgets;
    }
    const stage = this.stage as { offset?: number } | null;
    if (stage && typeof stage.offset === 'number' && this.stageOffset.value !== stage.offset) {
      this.stageOffset.value = stage.offset;
    }
    const rendered = this.repeatWidget?.renderedCount ?? 0;
    if (rendered !== this.repeatRendered.value) {
      this.repeatRendered.value = rendered;
    }

    this.publish('section', this.section.value);
    this.publish('widgets', this.widgetCount.value);
    this.publish('clicks', this.clicks.value);
    this.publish('toggled', this.toggled.value ? 'on' : 'off');
    this.publish('field', this.fieldValue.value);
    this.publish('email', this.emailValue.value);
    this.publish('emailValid', this.validEmail.value ? 'yes' : 'no');
    this.publish('area', this.areaLength.value);
    this.publish('focus', this.focusName.value);
    this.publish('theme', this.themeName.value);
    this.publish('repeat.total', this.rows.value.length);
    this.publish('repeat.rendered', rendered);
    this.publish('scroll.offset', Math.round(this.stageOffset.value));
    this.publishControls();
  }

  // ------------------------------------------------------------------ navigation

  /** Rebuilds the section list; the active entry is a primary button. */
  private rebuildNav(): void {
    const nav = this.nav;
    if (!nav) {
      return;
    }
    nav.removeAllWidgets(true);
    this.clearTrackedGroup('nav');

    let group = '';
    for (const def of SECTIONS) {
      if (def.group !== group) {
        group = def.group;
        nav.addWidget(this.add.uiLabel({ text: group, tone: 'muted', name: `navGroup.${group}` }));
      }
      const active = this.section.value === def.id;
      const button = this.add.uiButton({
        text: def.title,
        variant: active ? 'primary' : 'ghost',
        size: 'sm',
        width: NAV_WIDTH - 20,
        name: `nav.${def.id}`,
        onClick: () => this.showSection(def.id),
      });
      nav.addWidget(button);
      this.track('nav', `nav.${def.id}`, button);
    }

    nav.addWidget(this.add.uiDivider({}));
    const allButton = this.add.uiButton({
      text: this.section.value === 'all' ? 'All sections ●' : 'All sections',
      variant: this.section.value === 'all' ? 'primary' : 'ghost',
      size: 'sm',
      width: NAV_WIDTH - 20,
      name: 'nav.all',
      onClick: () => this.setShowAll(true),
    });
    nav.addWidget(allButton);
    this.track('nav', 'nav.all', allButton);
    nav.addWidget(
      this.add.uiLabel({
        text: 'Every card uses the public widget API. The stage is a ScrollView.',
        tone: 'muted',
        maxLines: 4,
        width: NAV_WIDTH - 20,
      }),
    );
    void appendStatus;
  }

  private showSection(id: SectionId): void {
    this.showAll.value = false;
    this.section.value = id;
    this.replaceSection([id]);
  }

  private setShowAll(on: boolean): void {
    this.showAll.value = on;
    if (!on) {
      this.showSection(this.section.value === 'all' ? 'buttons' : this.section.value);
      return;
    }
    this.section.value = 'all';
    this.replaceSection(SECTIONS.map((def) => def.id));
  }

  private nextSection(): void {
    const index = SECTIONS.findIndex((def) => def.id === this.section.value);
    const next = SECTIONS[(index + 1 + SECTIONS.length) % SECTIONS.length] ?? SECTIONS[0];
    if (next) {
      this.showSection(next.id);
    }
  }

  /** Destroys the previous section (its widgets release their scopes) and builds the new one(s). */
  private replaceSection(ids: readonly SectionId[]): void {
    const host = this.sectionHost;
    if (!host) {
      return;
    }
    host.removeAllWidgets(true);
    this.clearTrackedGroup('section');

    for (const id of ids) {
      const built = this.buildSection(id);
      this.track('section', `section.${id}`, built);
      host.addWidget(built);
    }
    (this.stage as { setScrollOffset?(offset: number): void } | null)?.setScrollOffset?.(0);
    this.rebuildNav();
    this.reportSection(ids.length === 1 ? (ids[0] as SectionId) : 'all');
  }

  private reportSection(id: SectionId | 'all'): void {
    appendStatus(`--- showcase · ${id} ---`);
    if (this.nav) reportWidget('nav', this.nav);
    if (this.stage) reportWidget('stage', this.stage);
    if (this.sectionHost) reportWidget('section', this.sectionHost);
    reportCanvas(this.game);
  }

  // ------------------------------------------------------------------ reporting

  /** Tracks a control under an owner group, so clearing one group cannot drop another. */
  private track(group: string, key: string, widget: Widget): void {
    this.tracked.set(key, widget);
    let keys = this.trackedGroups.get(group);
    if (keys === undefined) {
      keys = new Set();
      this.trackedGroups.set(group, keys);
    }
    keys.add(key);
  }

  private clearTrackedGroup(group: string): void {
    for (const key of this.trackedGroups.get(group) ?? []) {
      this.tracked.delete(key);
      this.reported.delete(`pt.${key}`);
    }
    this.trackedGroups.delete(group);
  }

  /** Repaints `pt.<key>=@x,y` for every tracked control that is laid out. */
  private publishControls(): void {
    const canvas = this.game.canvas.getBoundingClientRect();
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed || widget.appliedRect.width <= 0 || widget.appliedRect.height <= 0) {
        continue;
      }
      if (!widget.visible) {
        continue;
      }
      const origin = stagePosition(widget);
      this.publish(
        `pt.${key}`,
        `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
          canvas.top + origin.y + widget.appliedRect.height / 2,
        )}`,
      );
    }
  }

  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.reported.get(key) === text) {
      return;
    }
    this.reported.set(key, text);
    setDemoState(key, value);
  }

  // ------------------------------------------------------------------ building blocks

  /** One titled card: a surface-alt panel with a caption and the demo body. */
  private card(title: string, caption: string, body: readonly Widget[]): Widget {
    return this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 8,
        padding: 12,
        variant: 'surfaceAlt',
        radius: 8,
        width: 'fill',
      },
      [
        this.add.uiLabel({ text: title }),
        this.add.uiLabel({ text: caption, tone: 'muted', maxLines: 2, width: 560 }),
        this.add.uiDivider({}),
        ...body,
      ],
    );
  }

  private row(children: readonly Widget[], gap = 8, params: Partial<PanelOptions> = {}): Widget {
    return this.add.uiPanel(
      { direction: 'horizontal', gap, alignItems: 'center', variant: 'plain', ...params },
      [...children],
    );
  }

  private column(children: readonly Widget[], gap = 6, params: Partial<PanelOptions> = {}): Widget {
    return this.add.uiPanel({ direction: 'vertical', gap, variant: 'plain', ...params }, [
      ...children,
    ]);
  }

  /** A visible frame: the frame *is* the container whose algorithm is being demonstrated. */
  private frame(params: Partial<PanelOptions>, children: readonly Widget[]): Widget {
    return this.add.uiPanel({ variant: 'surface', radius: 6, padding: 6, ...params }, [
      ...children,
    ]);
  }

  /**
   * A labelled colour block: a `uiRect` for the fill plus a `Label` for the name.
   *
   * `params` are applied to the *block* (so `grow`, `order`, `alignSelf`, `width` … behave exactly as
   * declared), while the rect inside is absolutely positioned to cover it.
   */
  private block(
    color: number,
    text: string,
    width = 44,
    height = 26,
    params: Partial<PanelOptions> = {},
  ): Widget {
    const holder = this.add.uiPanel(
      {
        direction: 'horizontal',
        alignItems: 'center',
        justifyContent: 'center',
        variant: 'plain',
        width,
        height,
        name: `holder.${text}`,
        ...params,
      },
      [],
    );
    const rect = this.add.uiRect({ color, width, height, name: `rect.${text}` });
    rect.setLayoutParams({ position: 'absolute', left: 0, top: 0 });
    holder.addWidget(rect);
    holder.addWidget(
      this.add.uiLabel({
        text,
        align: 'center',
        style: { fontSize: '11px' },
        width,
        height: 16,
        name: `block.${text}`,
      }),
    );
    return holder;
  }

  // ------------------------------------------------------------------ sections

  private buildSection(id: SectionId): Widget {
    switch (id) {
      case 'text':
        return this.buildText();
      case 'buttons':
        return this.buildButtons();
      case 'inputs':
        return this.buildInputs();
      case 'decoration':
        return this.buildDecoration();
      case 'box':
        return this.buildBox();
      case 'grid':
        return this.buildGrid();
      case 'stack':
        return this.buildStack();
      case 'params':
        return this.buildParams();
      case 'repeat':
        return this.buildRepeat();
      case 'focus':
        return this.buildFocus();
      default:
        return this.column([]);
    }
  }

  private buildText(): Widget {
    const theme = this.mvvm.theme;
    const tones = ['default', 'muted', 'primary', 'success', 'warning', 'danger'] as const;
    return this.column(
      [
        this.card('Label · tones', 'each tone is a theme token, never a literal colour', [
          this.row(
            tones.map((tone) => this.add.uiLabel({ text: tone, tone, width: 96 })),
            8,
            { wrap: true },
          ),
        ]),
        this.card('Label · sizes', 'theme.fontSize xs · sm · md · lg · xl', [
          this.row([
            this.add.uiLabel({
              text: 'xs',
              style: { fontSize: `${theme.fontSize.xs}px` },
              width: 56,
            }),
            this.add.uiLabel({
              text: 'sm',
              style: { fontSize: `${theme.fontSize.sm}px` },
              width: 56,
            }),
            this.add.uiLabel({
              text: 'md',
              style: { fontSize: `${theme.fontSize.md}px` },
              width: 56,
            }),
            this.add.uiLabel({
              text: 'lg',
              style: { fontSize: `${theme.fontSize.lg}px` },
              width: 56,
            }),
            this.add.uiLabel({
              text: 'xl',
              style: { fontSize: `${theme.fontSize.xl}px` },
              width: 56,
            }),
          ]),
        ]),
        this.card('Label · alignment', 'align works inside the width the engine assigned', [
          this.column([
            this.add.uiLabel({ text: 'align: left', align: 'left', width: 220 }),
            this.add.uiLabel({ text: 'align: center', align: 'center', width: 220 }),
            this.add.uiLabel({ text: 'align: right', align: 'right', width: 220 }),
          ]),
        ]),
        this.card(
          'Label · truncation',
          'maxLines + ellipsis, and wrap: false for a single clipped line',
          [
            this.column([
              this.add.uiLabel({
                text:
                  'maxLines: 2 with ellipsis — the label asks the text measurer for the wrapped lines and ' +
                  'trims the rest, so truncation is a layout decision rather than a renderer trick.',
                maxLines: 2,
                ellipsis: true,
                width: 340,
              }),
              this.add.uiLabel({
                text: 'wrap: false — a single line, clipped at the assigned width.',
                wrap: false,
                width: 220,
              }),
            ]),
          ],
        ),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildButtons(): Widget {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
    const sizes = ['sm', 'md', 'lg'] as const;
    const matrix: Widget[] = [];
    for (const size of sizes) {
      for (const variant of variants) {
        matrix.push(this.add.uiButton({ text: `${variant} ${size}`, variant, size, width: 132 }));
      }
    }

    const toggle = this.add.uiButton({
      text: 'Toggle: off',
      toggle: true,
      value: false,
      width: 136,
      name: 'toggleButton',
    });
    toggle.on('change', (value: boolean) => {
      this.toggled.value = value;
      toggle.setText(`Toggle: ${value ? 'on' : 'off'}`);
    });
    this.track('section', 'buttons.toggle', toggle);

    const clickLabel = this.add.uiLabel({ text: '', tone: 'muted' });
    bindTemplateText(
      clickLabel,
      this.pageContext as BindingContext,
      'clicks: {{ clicks }} · toggle {{ toggled }}',
    );

    const clickButton = this.add.uiButton({
      text: 'Click me',
      variant: 'primary',
      name: 'clickButton',
      onClick: () => {
        this.clicks.value += 1;
      },
    });
    const resetButton = this.add.uiButton({
      text: 'Reset',
      variant: 'secondary',
      name: 'resetButton',
      onClick: () => {
        this.clicks.value = 0;
      },
    });
    this.track('section', 'buttons.click', clickButton);
    this.track('section', 'buttons.reset', resetButton);

    return this.column(
      [
        this.card(
          'Button · variants × sizes',
          'four flavours and three size steps (controlHeight sm/md/lg)',
          [this.add.uiGrid({ columns: 4, columnGap: 8, rowGap: 8, width: 'fill' }, matrix)],
        ),
        this.card('Button · states', 'disabled, loading (activation ignored) and toggle', [
          this.row([
            this.add.uiButton({ text: 'Disabled', disabled: true, name: 'disabledButton' }),
            this.add.uiButton({ text: 'Loading', loading: true, name: 'loadingButton' }),
            toggle,
            clickLabel,
          ]),
        ]),
        this.card('Button · icon', 'a texture key icon, with or without a label', [
          this.row([
            this.add.uiButton({ text: 'With icon', icon: TILE_TEXTURE, variant: 'secondary' }),
            this.add.uiButton({ icon: TILE_TEXTURE, variant: 'primary', name: 'iconOnlyButton' }),
          ]),
        ]),
        this.card('Button · feedback', 'activation updates the view model; #demo-state shows it', [
          this.row([clickButton, resetButton]),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildInputs(): Widget {
    const field = this.add.uiTextField({
      label: 'Text',
      placeholder: 'type here',
      clearable: true,
      width: 240,
      name: 'fieldText',
    });
    field.on('change', (value: string) => {
      this.fieldValue.value = value;
    });

    const email = this.add.uiTextField({
      label: 'Email',
      placeholder: 'ada@example.com',
      inputType: 'email',
      width: 240,
      name: 'fieldEmail',
      validate: () => (this.validEmail.value ? null : 'enter a valid email address'),
    });
    email.on('change', (value: string) => {
      this.emailValue.value = value;
    });
    this.track('section', 'inputs.text', field);
    this.track('section', 'inputs.email', email);

    const area = this.add.uiTextArea({
      label: 'TextArea',
      placeholder: 'Enter adds a line · Ctrl/Cmd+Enter submits',
      rows: 3,
      maxLength: 200,
      width: 320,
      name: 'fieldArea',
    });
    area.on('change', (value: string) => {
      this.areaLength.value = value.length;
    });
    this.track('section', 'inputs.area', area);

    const values = this.add.uiLabel({ text: '', tone: 'muted', maxLines: 2, width: 420 });
    bindTemplateText(
      values,
      this.pageContext as BindingContext,
      'field "{{ field }}" · email {{ email }} ({{ emailValid }}) · area {{ area }} chars',
    );

    return this.column(
      [
        this.card('TextField flavours', 'text, email, number, password and read-only/disabled', [
          this.row([
            this.column([field, email]),
            this.column([
              this.add.uiTextField({
                label: 'Number',
                inputType: 'number',
                placeholder: '42',
                width: 190,
                name: 'fieldNumber',
              }),
              this.add.uiTextField({
                label: 'Password',
                inputType: 'password',
                placeholder: 'secret',
                width: 190,
                name: 'fieldPassword',
              }),
            ]),
            this.column([
              this.add.uiTextField({
                label: 'Disabled',
                placeholder: 'cannot be focused',
                disabled: true,
                width: 190,
                name: 'fieldDisabled',
              }),
              this.add.uiTextField({
                label: 'Read only',
                value: 'copy me',
                readOnly: true,
                width: 190,
                name: 'fieldReadOnly',
              }),
            ]),
          ]),
        ]),
        this.card(
          'Validation',
          'validate() runs on blur; a string result becomes the error state',
          [
            this.row([
              this.add.uiLabel({
                text: 'Type an invalid email, then press Tab or click elsewhere.',
                tone: 'muted',
                width: 340,
              }),
            ]),
          ],
        ),
        this.card('TextArea', 'rows, wrapping and the submit shortcut', [this.row([area])]),
        this.card(
          'Live values',
          'every input writes into the view model through its change event',
          [this.row([values])],
        ),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildDecoration(): Widget {
    const variants = ['surface', 'surfaceAlt', 'overlay', 'primary', 'danger', 'plain'] as const;
    const fits = ['contain', 'cover', 'fill', 'none'] as const;
    return this.column(
      [
        this.card('Panel · variants', 'six background flavours, all from theme tokens', [
          this.add.uiGrid(
            { columns: 3, columnGap: 8, rowGap: 8, width: 'fill' },
            variants.map((variant) =>
              this.add.uiPanel(
                {
                  direction: 'horizontal',
                  alignItems: 'center',
                  justifyContent: 'center',
                  variant,
                  radius: 6,
                  width: 132,
                  height: 44,
                },
                [this.add.uiLabel({ text: variant, align: 'center' })],
              ),
            ),
          ),
        ]),
        this.card(
          'Panel · radius / elevation / border',
          'radius clamps to half the box, elevation fakes a shadow',
          [
            this.row([
              this.add.uiPanel({ variant: 'surface', radius: 0, width: 88, height: 54 }, [
                this.add.uiLabel({ text: 'r0', align: 'center' }),
              ]),
              this.add.uiPanel({ variant: 'surface', radius: 8, width: 88, height: 54 }, [
                this.add.uiLabel({ text: 'r8', align: 'center' }),
              ]),
              this.add.uiPanel({ variant: 'surface', radius: 20, width: 88, height: 54 }, [
                this.add.uiLabel({ text: 'r20', align: 'center' }),
              ]),
              this.add.uiPanel({ variant: 'surface', elevation: 10, width: 88, height: 54 }, [
                this.add.uiLabel({ text: 'elev 10', align: 'center' }),
              ]),
              this.add.uiPanel({ variant: 'surface', border: false, width: 88, height: 54 }, [
                this.add.uiLabel({ text: 'no border', align: 'center' }),
              ]),
            ]),
          ],
        ),
        this.card('Divider & Spacer', 'rules use the border token; spacers only reserve space', [
          this.column([
            this.add.uiDivider({}),
            this.row(
              [
                this.add.uiLabel({ text: 'left' }),
                this.add.uiSpacer({ flex: true }),
                this.add.uiLabel({ text: 'spacer(flex)' }),
                this.add.uiSpacer({ flex: true }),
                this.add.uiLabel({ text: 'right' }),
              ],
              8,
              { width: 420 },
            ),
            this.add.uiDivider({ thickness: 2 }),
            this.row([
              this.add.uiLabel({ text: 'fixed' }),
              this.add.uiSpacer({ width: 60, height: 8 }),
              this.add.uiLabel({ text: 'spacer(width: 60)' }),
              this.add.uiDivider({ orientation: 'vertical', height: 24 }),
              this.add.uiLabel({ text: 'vertical rule' }),
            ]),
          ]),
        ]),
        this.card('Image · fit', `the only widget that reads a texture (${TILE_TEXTURE})`, [
          this.row(
            fits.map((fit) =>
              this.column([
                this.add.uiImage({
                  texture: TILE_TEXTURE,
                  fit,
                  width: 84,
                  height: 64,
                  name: `image.${fit}`,
                }),
                this.add.uiLabel({ text: fit, tone: 'muted', align: 'center', width: 84 }),
              ]),
            ),
          ),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildBox(): Widget {
    const blue = 0x2f6feb;
    const green = 0x3fb950;
    const amber = 0xf2a33c;
    const purple = 0x8957e5;
    return this.column(
      [
        this.card('Box · justifyContent', 'main-axis distribution inside a fixed frame', [
          this.row(
            (['start', 'center', 'end'] as const).map((justify) =>
              this.column([
                this.add.uiLabel({ text: `justifyContent: ${justify}`, tone: 'muted' }),
                this.frame(
                  {
                    direction: 'vertical',
                    gap: 6,
                    justifyContent: justify,
                    width: 140,
                    height: 120,
                  },
                  [
                    this.block(blue, '1', 100, 22),
                    this.block(green, '2', 100, 22),
                    this.block(amber, '3', 100, 22),
                  ],
                ),
              ]),
            ),
          ),
        ]),
        this.card('Box · alignItems', 'cross-axis alignment: start · center · end · stretch', [
          this.row(
            (['start', 'center', 'end', 'stretch'] as const).map((alignItems) =>
              this.column([
                this.add.uiLabel({ text: `alignItems: ${alignItems}`, tone: 'muted' }),
                this.frame(
                  { direction: 'horizontal', gap: 6, alignItems, width: 150, height: 90 },
                  [
                    this.block(blue, 'a', 30, 22),
                    this.block(green, 'b', 30, 40),
                    this.block(amber, 'c', 30, 30),
                  ],
                ),
              ]),
            ),
          ),
        ]),
        this.card('Box · wrap', 'wrap: true flows into lines inside a narrow frame', [
          this.frame(
            { direction: 'horizontal', gap: 6, wrap: true, width: 260, height: 120 },
            Array.from({ length: 8 }, (_unused, index) =>
              this.block(index % 2 === 0 ? blue : purple, String(index + 1), 56, 26),
            ),
          ),
        ]),
        this.card('Box · reverse', 'reverse flips the visual order without touching the tree', [
          this.row([
            this.column([
              this.add.uiLabel({ text: 'reverse: false', tone: 'muted' }),
              this.frame(
                { direction: 'horizontal', gap: 6, width: 200, height: 46 },
                [1, 2, 3, 4].map((n) => this.block(blue, String(n), 40, 26)),
              ),
            ]),
            this.column([
              this.add.uiLabel({ text: 'reverse: true', tone: 'muted' }),
              this.frame(
                { direction: 'horizontal', gap: 6, reverse: true, width: 200, height: 46 },
                [1, 2, 3, 4].map((n) => this.block(0xf85149, String(n), 40, 26)),
              ),
            ]),
          ]),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildGrid(): Widget {
    const cell = (text: string, variant: PanelOptions['variant'] = 'surface'): Widget =>
      this.add.uiPanel(
        {
          direction: 'horizontal',
          alignItems: 'center',
          justifyContent: 'center',
          variant,
          radius: 6,
          height: 36,
        },
        [this.add.uiLabel({ text, align: 'center' })],
      );

    return this.column(
      [
        this.card('Grid · fixed columns', 'columns: 3 with columnGap / rowGap', [
          this.add.uiGrid(
            { columns: 3, columnGap: 8, rowGap: 8, width: 'fill', name: 'grid.fixed' },
            Array.from({ length: 6 }, (_unused, index) => cell(`cell ${index + 1}`)),
          ),
        ]),
        this.card(
          "Grid · columns: 'auto'",
          'the engine derives the column count from minColumnWidth',
          [
            this.add.uiGrid(
              {
                columns: 'auto',
                minColumnWidth: 90,
                columnGap: 8,
                rowGap: 8,
                width: 320,
                name: 'grid.auto',
              },
              Array.from({ length: 8 }, (_unused, index) =>
                this.block(0x3fb950, String(index + 1), 80, 30),
              ),
            ),
          ],
        ),
        this.card('Grid · spans', 'gridColumnSpan widens a cell; later cells flow around it', [
          this.add.uiGrid(
            { columns: 3, columnGap: 8, rowGap: 8, width: 'fill', name: 'grid.spans' },
            [
              this.add.uiPanel(
                {
                  direction: 'horizontal',
                  variant: 'primary',
                  radius: 6,
                  height: 36,
                  gridColumnSpan: 2,
                },
                [this.add.uiLabel({ text: 'span 2', align: 'center' })],
              ),
              cell('cell'),
              cell('cell'),
              this.add.uiPanel(
                {
                  direction: 'horizontal',
                  variant: 'danger',
                  radius: 6,
                  height: 36,
                  gridColumnSpan: 3,
                },
                [this.add.uiLabel({ text: 'span 3', align: 'center' })],
              ),
            ],
          ),
        ]),
        this.card('Grid · alignment', 'justifyItems / alignItems place the child inside its cell', [
          this.row([
            this.add.uiGrid(
              {
                columns: 2,
                columnGap: 10,
                rowGap: 10,
                justifyItems: 'start',
                alignItems: 'start',
                width: 200,
                name: 'grid.alignStart',
              },
              [this.block(0x2f6feb, 'a', 40, 24), this.block(0x3fb950, 'b', 40, 24)],
            ),
            this.add.uiGrid(
              {
                columns: 2,
                columnGap: 10,
                rowGap: 10,
                justifyItems: 'end',
                alignItems: 'end',
                width: 200,
                name: 'grid.alignEnd',
              },
              [this.block(0xf2a33c, 'c', 40, 24), this.block(0xf85149, 'd', 40, 24)],
            ),
          ]),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildStack(): Widget {
    return this.column(
      [
        this.card('Stack · align', 'children overlap; align picks where they sit', [
          this.row(
            (['start', 'center', 'end'] as const).map((align) =>
              this.column([
                this.add.uiLabel({ text: `uiStack align: ${align}`, tone: 'muted' }),
                this.add.uiStack({ align, width: 150, height: 96, name: `stack.${align}` }, [
                  this.block(0x2f6feb, 'A', 90, 70),
                  this.block(0x3fb950, 'B', 60, 46),
                  this.block(0xf2a33c, 'C', 34, 24),
                ]),
              ]),
            ),
          ),
        ]),
        this.card('Absolute · corners', 'position: absolute with left/top/right/bottom', [
          this.add.uiAbsolute({ width: 300, height: 150, name: 'absolute.corners' }, [
            this.block(0x2f6feb, 'left/top', 76, 28, { position: 'absolute', left: 6, top: 6 }),
            this.block(0x3fb950, 'right/top', 76, 28, { position: 'absolute', right: 6, top: 6 }),
            this.block(0xf2a33c, 'left/bottom', 76, 28, {
              position: 'absolute',
              left: 6,
              bottom: 6,
            }),
            this.block(0xf85149, 'right/bottom', 76, 28, {
              position: 'absolute',
              right: 6,
              bottom: 6,
            }),
            this.block(0x8957e5, 'left/top 50%', 86, 28, {
              position: 'absolute',
              left: '50%',
              top: '50%',
            }),
          ]),
        ]),
        this.card('Absolute · flow interaction', 'an absolute child takes no space in its parent', [
          this.row([
            this.frame({ direction: 'vertical', gap: 6, width: 210, height: 110 }, [
              this.block(0x2f6feb, 'flow 1', 170, 24),
              this.block(0x3fb950, 'flow 2', 170, 24),
              this.block(0xf2a33c, 'flow 3', 170, 24),
              this.block(0xf85149, 'absolute overlay', 170, 24, {
                position: 'absolute',
                left: 20,
                top: 40,
              }),
            ]),
            this.add.uiLabel({
              text: 'The overlay sits at left: 20 / top: 40 and pushes nothing aside.',
              tone: 'muted',
              width: 300,
            }),
          ]),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildParams(): Widget {
    const track = (children: Widget[]): Widget =>
      this.frame(
        { direction: 'horizontal', gap: 8, width: 430, height: 54, alignItems: 'center' },
        children,
      );

    const collapseTarget = this.block(0x3fb950, 'collapse', 60, 30);
    let hidden = false;
    const visibilityButton = this.add.uiButton({
      text: 'Hide B',
      variant: 'secondary',
      size: 'sm',
      name: 'visibilityButton',
      onClick: () => {
        hidden = !hidden;
        collapseTarget.setVisible(!hidden);
        visibilityButton.setText(hidden ? 'Show B' : 'Hide B');
      },
    });
    this.track('section', 'params.visibility', visibilityButton);

    return this.column(
      [
        this.card('width modes', "auto · fixed · percentage · 'fill' inside the same track", [
          this.column([
            track([this.block(0x2f6feb, 'auto', 60, 30)]),
            track([this.block(0x3fb950, '160', 160, 30)]),
            track([this.block(0xf2a33c, '50%', 60, 30, { width: '50%' })]),
            track([this.block(0xf85149, 'fill', 60, 30, { width: 'fill' })]),
          ]),
        ]),
        this.card('grow', 'grow 1 vs grow 2 split the leftover space', [
          this.frame({ direction: 'horizontal', gap: 8, width: 430, height: 50 }, [
            this.block(0x2f6feb, 'grow 1', 60, 30, { grow: 1 }),
            this.block(0x3fb950, 'grow 2', 60, 30, { grow: 2 }),
            this.block(0xf2a33c, 'grow 0', 96, 30),
          ]),
        ]),
        this.card('min / max', 'a clamp wins over the content width', [
          this.column([
            this.add.uiLabel({
              text: 'maxWidth: 200 — this sentence would be much wider than the clamp allows.',
              wrap: true,
              maxWidth: 200,
              width: 'fill',
            }),
            this.add.uiLabel({
              text: 'minWidth: 240 keeps a tiny label wide',
              minWidth: 240,
              tone: 'muted',
            }),
          ]),
        ]),
        this.card('aspectRatio', 'height follows width (2:1)', [
          this.row([
            this.block(0x2f6feb, '2:1', 120, 60, { aspectRatio: 2, height: 'auto' }),
            this.add.uiLabel({
              text: 'width 120 · aspectRatio 2 → height 60',
              tone: 'muted',
              width: 260,
            }),
          ]),
        ]),
        this.card('margin & padding', 'margin pushes from outside, padding reserves space inside', [
          this.frame({ direction: 'horizontal', width: 300, height: 90, padding: 10 }, [
            this.frame({ direction: 'horizontal', width: 120, height: 50, margin: 6 }, [
              this.add.uiLabel({ text: 'padding 10 / margin 6', align: 'center', width: 100 }),
            ]),
          ]),
        ]),
        this.card('order', 'visual order follows `order`, not declaration order', [
          this.row([
            this.frame({ direction: 'horizontal', gap: 6, width: 320, height: 46 }, [
              this.block(0x2f6feb, 'declared 1 · order 2', 100, 26, { order: 2 }),
              this.block(0x3fb950, 'declared 2 · order 0', 100, 26, { order: 0 }),
              this.block(0xf2a33c, 'declared 3 · order 1', 100, 26, { order: 1 }),
            ]),
            this.add.uiLabel({ text: 'painted 2, 3, 1', tone: 'muted', width: 120 }),
          ]),
        ]),
        this.card('alignSelf', 'a child overrides the row alignment', [
          this.frame(
            { direction: 'horizontal', gap: 8, alignItems: 'center', width: 430, height: 96 },
            [
              this.block(0x2f6feb, 'start', 70, 26, { alignSelf: 'start' }),
              this.block(0x3fb950, 'center', 70, 40, { alignSelf: 'center' }),
              this.block(0xf2a33c, 'end', 70, 26, { alignSelf: 'end' }),
              this.block(0x8957e5, 'stretch', 70, 26, { alignSelf: 'stretch' }),
            ],
          ),
        ]),
        this.card('visibility', 'setVisible collapses the node out of the flow', [
          this.row([
            this.frame({ direction: 'horizontal', gap: 8, width: 300, height: 50 }, [
              this.block(0x2f6feb, 'A', 60, 30),
              collapseTarget,
              this.block(0xf2a33c, 'C', 60, 30),
            ]),
            visibilityButton,
          ]),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildRepeat(): Widget {
    const repeat = this.add.uiRepeat<SampleRow>({
      items: () => this.rows.value,
      key: (row) => row.id,
      template: (row, _index, context) => {
        const nameLabel = this.add.uiLabel({ width: 190, height: 18 });
        bindTemplateText(nameLabel, context, '#{{ $index }} · {{ $item.label }}');
        return this.row(
          [nameLabel, this.add.uiLabel({ text: row.id, tone: 'muted', width: 60 })],
          8,
          { height: 24, padding: { left: 8, right: 6, top: 0, bottom: 0 } },
        );
      },
      container: { direction: 'vertical', gap: 2 },
      virtualize: true,
      itemExtent: 26,
      overscan: 2,
      height: 'fill',
      name: 'showcase.repeat',
    });
    this.repeatWidget = repeat;

    const listScroll = this.add.uiScroll({
      width: 'fill',
      height: 200,
      direction: 'vertical',
      scrollbar: 'auto',
      content: this.column([repeat], 0, { width: 'fill', height: 'fill' }),
      name: 'showcase.list',
    });
    this.track('section', 'repeat.list', listScroll);

    const chips: Widget[] = [];
    for (let index = 0; index < 24; index++) {
      chips.push(
        this.add.uiPanel(
          {
            direction: 'horizontal',
            alignItems: 'center',
            justifyContent: 'center',
            variant: index % 3 === 0 ? 'primary' : 'surface',
            radius: 6,
            width: 88,
            height: 44,
          },
          [this.add.uiLabel({ text: `chip ${index}`, align: 'center' })],
        ),
      );
    }
    const chipScroll = this.add.uiScroll({
      width: 'fill',
      height: 60,
      direction: 'horizontal',
      scrollbar: 'auto',
      content: this.row(chips, 8),
      name: 'showcase.chips',
    });
    this.track('section', 'repeat.chips', chipScroll);

    const mounted = this.add.uiLabel({ text: '', tone: 'muted' });
    bindTemplateText(
      mounted,
      this.pageContext as BindingContext,
      'mounted rows: {{ rendered }} / {{ total }}',
    );

    const addRow = this.add.uiButton({
      text: 'Add row',
      variant: 'secondary',
      size: 'sm',
      name: 'addRow',
      onClick: () => {
        const next = this.rows.value.length;
        this.rows.value.push({ id: `r${next}`, label: `row ${next}` });
      },
    });
    const removeRow = this.add.uiButton({
      text: 'Remove row',
      variant: 'secondary',
      size: 'sm',
      name: 'removeRow',
      onClick: () => {
        this.rows.value.pop();
      },
    });
    const shuffleRows = this.add.uiButton({
      text: 'Reverse',
      variant: 'secondary',
      size: 'sm',
      name: 'shuffleRows',
      onClick: () => {
        this.rows.value = this.rows.value.slice().reverse();
      },
    });
    const leftChips = this.add.uiButton({
      text: 'Left',
      variant: 'secondary',
      size: 'sm',
      name: 'chipsLeft',
      onClick: () => chipScroll.scrollBy(-200, 0),
    });
    const rightChips = this.add.uiButton({
      text: 'Right',
      variant: 'secondary',
      size: 'sm',
      name: 'chipsRight',
      onClick: () => chipScroll.scrollBy(200, 0),
    });
    this.track('section', 'repeat.addRow', addRow);
    this.track('section', 'repeat.removeRow', removeRow);
    this.track('section', 'repeat.reverse', shuffleRows);
    this.track('section', 'repeat.left', leftChips);
    this.track('section', 'repeat.right', rightChips);

    return this.column(
      [
        this.card(
          'Repeat · virtualised list',
          'itemExtent + overscan: only the visible window is mounted, fillers keep the full height',
          [this.row([listScroll, this.column([addRow, removeRow, shuffleRows, mounted])])],
        ),
        this.card(
          'ScrollView · horizontal',
          'wheel, drag or the buttons; the clip hides the overflow',
          [this.row([chipScroll, this.column([leftChips, rightChips])])],
        ),
      ],
      12,
      { width: 'fill' },
    );
  }

  private buildFocus(): Widget {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const buttons = names.map((name) => {
      const button = this.add.uiButton({
        text: name,
        variant: 'secondary',
        width: 96,
        name: `focus.${name}`,
        onClick: () => {
          this.clicks.value += 1;
        },
      });
      this.track('section', `focus.${name}`, button);
      return button;
    });

    const readout = this.add.uiLabel({ text: '', tone: 'primary' });
    bindTemplateText(readout, this.pageContext as BindingContext, 'focus: {{ focus }}');

    const navButtons = Array.from({ length: 6 }, (_unused, index) =>
      this.add.uiButton({
        text: `nav ${index + 1}`,
        variant: 'ghost',
        height: 34,
        name: `arrow.${index + 1}`,
      }),
    );
    navButtons.forEach((button, index) => this.track('section', `focus.arrow${index + 1}`, button));

    return this.column(
      [
        this.card('Tab order', 'Tab / Shift+Tab walk the tree in visual order', [
          this.row(
            [
              ...buttons,
              this.add.uiTextField({
                placeholder: 'focusable too',
                width: 160,
                name: 'focus.field',
              }),
            ],
            8,
            { wrap: true },
          ),
        ]),
        this.card('Focus readout', 'every focus change is published to #demo-state', [
          this.row([readout]),
        ]),
        this.card(
          'Arrow navigation',
          'the focus manager picks the nearest neighbour in a direction',
          [this.add.uiGrid({ columns: 3, columnGap: 8, rowGap: 8, width: 'fill' }, navButtons)],
        ),
        this.card('Disabled widgets are skipped', 'disabled controls never take focus or clicks', [
          this.row([
            this.add.uiButton({ text: 'enabled', name: 'skip.enabled1' }),
            this.add.uiButton({ text: 'disabled', disabled: true, name: 'skip.disabled' }),
            this.add.uiButton({ text: 'enabled', name: 'skip.enabled2' }),
          ]),
        ]),
      ],
      12,
      { width: 'fill' },
    );
  }
}

function createRows(count: number): SampleRow[] {
  const rows: SampleRow[] = [];
  for (let index = 0; index < count; index++) {
    rows.push({ id: `r${index}`, label: `row ${index}` });
  }
  return rows;
}

/** Widgets in a subtree: published as `widgets`, a cheap coverage/leak signal. */
function countWidgets(root: Widget): number {
  let total = 1;
  for (const child of root.getWidgetChildren()) {
    total += countWidgets(child);
  }
  return total;
}
