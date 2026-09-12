/**
 * `#/showcase` — the acceptance page: every widget, every layout container and every layout
 * parameter in one place, with live readouts.
 *
 * Every widget and container on the page is written with the Compose-style DSL
 * (`@phaser-mvvm/widgets/compose`): nested calls with a trailing content lambda instead of the
 * `this.add.ui*` factories and their option bag plus children array. The DSL constructs the very
 * same widget classes and takes the identical option objects, so every demo, every published readout
 * and the geometry a check asserts on are the ones the factory version produced.
 *
 * How to use it:
 * - the left column navigates the sections (one button each) and `Show all` stacks them into one
 *   long page, so a reviewer can scroll through the whole surface;
 * - the stage on the right is a `Scroll` (`ScrollView`), so a section can be as tall as it needs to
 *   be and the overflow is clipped rather than pushed off screen;
 * - every card has a title and a caption saying what it demonstrates, and every card is built from
 *   the public widget API only (no bespoke drawing);
 * - the header and footer mirror the live state into `#demo-state` (`section`, `widgets`, `clicks`,
 *   `focus`, `repeat.*`, `scroll.offset`, …) and every control a check may click is published as a
 *   `pt.*` point, refreshed every frame;
 * - `window.showcase` exposes `sections()`, `show(id)`, `showAll()`, `state()` and `geometry()`.
 *
 * `render()` builds *and mounts* the page; the nav and the sections are built by `ui()`, which
 * returns one unmounted root, and are attached to (or swapped inside) the mounted page with
 * `addWidget()`. Replacing a section therefore destroys the previous subtree — and with it every
 * binding and effect its widgets own.
 *
 * Sections: text · buttons · inputs · decoration · box · grid · stack · params · repeat · focus.
 */

import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { bindTemplateText, themeListenerCount } from '@phaser-mvvm/phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import type { LayoutParams } from '@phaser-mvvm/layout';
import type { BoxWidget } from '@phaser-mvvm/phaser';
import type {
  Panel as PanelWidget,
  PanelOptions,
  PanelVariant,
  Repeat,
  ScrollView,
} from '@phaser-mvvm/widgets';
import {
  Absolute,
  Button,
  Column,
  type ColumnOptions,
  Divider,
  Grid,
  Image,
  List,
  Panel,
  Rect,
  render,
  Row,
  type RowOptions,
  Scroll,
  Stack,
  Spacer,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { makeTileTexture, setDemoState } from '../demo';
import {
  appendStatus,
  displayScale,
  pageOrigin,
  pagePoint,
  reportCanvas,
  reportWidget,
} from '../status';

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
  | 'sizing'
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
  {
    id: 'grid',
    group: 'layout',
    title: 'Grid',
    caption: 'columns · auto columns · spans · explicit placement · gaps',
  },
  { id: 'stack', group: 'layout', title: 'Stack & absolute', caption: 'overlap · align · corners' },
  {
    id: 'params',
    group: 'layout',
    title: 'Layout params',
    caption: 'width · grow · min/max · aspect · order · alignSelf',
  },
  {
    id: 'sizing',
    group: 'layout',
    title: 'Sizing & flex',
    caption: 'shrink · basis · min/max height',
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

/** What `window.showcase.counts()` reports (the leak gate). */
interface ShowcaseCounts {
  widgets: number;
  stageWidgets: number;
  themeListeners: number;
  pointerTargets: number;
  focusables: number;
  a11yNodes: number;
}

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

  // ------------------------------------------------------------------ scene state

  private page: Widget | null = null;
  private nav: Widget | null = null;
  private stage: ScrollView | null = null;
  private stageContent: Widget | null = null;
  private sectionHost: Widget | null = null;
  private repeatWidget: Repeat<SampleRow> | null = null;
  private readonly tracked: TrackedControls = new Map();
  private readonly trackedGroups = new Map<string, Set<string>>();
  private readonly reported = new Map<string, string>();

  constructor() {
    super('showcase');
  }

  create(): void {
    makeTileTexture(this, TILE_TEXTURE, 64);
    this.reported.clear();
    this.tracked.clear();

    // The page is mounted the moment `render()` returns, and `UIRoot.addWidget()` lays out eagerly —
    // so the fitted size goes into the root panel's options instead of through `setLayoutParams()`
    // afterwards. Otherwise `#status` would record the very first (unfitted) rect, because a later
    // `setLayoutParams()` only marks the tree dirty for the *next* frame.
    const size = this.pageSize();

    const page = render(this.mvvm, () => {
      Panel(
        {
          direction: 'vertical',
          gap: 10,
          padding: PAGE_MARGIN,
          variant: 'plain',
          alignItems: 'stretch',
          width: size.width,
          height: size.height,
        },
        () => {
          this.buildHeader();
          this.buildBody();
          this.buildFooter();
        },
      );
    });
    this.page = page;

    // Fill the window (the root is a centred stack, so the page sizes itself) and follow resizes.
    this.fitPage();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitPage, this);

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
      /** `show()` plus "and now the geometry is real": see {@link ShowcaseScene.showAndReport}. */
      showAndReport: (id: string, frames?: number) => this.showAndReport(id as SectionId, frames),
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
      /**
       * Every tracked control of the visible section: its laid-out state, its page coordinates and its
       * accessibility name — the three things a per-section matrix asserts.
       */
      controlStates: (): Array<{
        key: string;
        state: string;
        visible: boolean;
        laidOut: boolean;
        interactive: boolean;
        inBand: boolean;
        point: string;
        a11y: string | null;
      }> =>
        [...this.tracked.entries()].map(([key, widget]) => {
          const laidOut =
            !widget.isDestroyed && widget.appliedRect.width > 0 && widget.appliedRect.height > 0;
          const descriptor = widget.isDestroyed ? null : widget.describeA11y();
          const point = laidOut
            ? {
                x: pagePoint(this.game, widget).x,
                y: pagePoint(this.game, widget).y,
              }
            : null;
          const band = this.stageRectOf();
          const interactive =
            widget.focusable === true ||
            (widget as unknown as { onActivate?: unknown }).onActivate !== null ||
            (widget as unknown as { blockPointer?: boolean }).blockPointer === true;
          return {
            key,
            state: laidOut && widget.visible ? widget.visualState : laidOut ? 'hidden' : 'gone',
            visible: !widget.isDestroyed && widget.visible,
            laidOut,
            // The stage is a scroll port: a section can be taller than it (the `params` section is
            // 1513 px against a 672 px stage), so a control can be laid out, have a page point, and still
            // be clipped away — a check that aims there clicks whatever is behind it (round 79 hit
            // exactly that: `pt.params.visibility` at y=1538, below the canvas).
            inBand:
              point !== null &&
              band !== null &&
              point.y >= band.y + 4 &&
              point.y <= band.y + band.height - 4,
            // Containers are tracked for their geometry, not to be hovered: only these should have an
            // accessible name (the mirror skips decorative panels by design).
            interactive,
            point: point ? `@${Math.round(point.x)},${Math.round(point.y)}` : 'none',
            a11y: descriptor ? (descriptor.label ?? widget.name ?? descriptor.role) : null,
          };
        }),
      /**
       * Scrolls the stage to an absolute offset.
       *
       * A section can be taller than the stage (the `params` section is 1513 px against a 672 px stage),
       * so a matrix that aims a real mouse at every control has to bring it into the band first —
       * `controlStates()` reports the current coordinates, this moves them.
       */
      scrollStage: (y: number): number => {
        this.stage?.scrollTo(y);
        return Math.round(this.stage?.offset ?? 0);
      },
      /**
       * The `params` card's layout claim, as numbers: three blocks in a row, and the middle one leaving
       * the flow (`visible: false`) when the button is pressed — `C` must then move left by exactly the
       * collapsed block's width plus the row gap (60 + 8 = 68).
       *
       * Read from the tracked button's own sibling frame, so it describes the card a check is looking at
       * rather than "the widget called `holder.C` somewhere on the page".
       */
      paramsBlocks: (): Array<{
        name: string;
        x: number;
        width: number;
        visible: boolean;
      }> | null => {
        const button = this.tracked.get('params.visibility');
        const row = (button?.parentContainer ?? null) as Widget | null;
        const frame = row?.getWidgetChildren()[0];
        if (!frame) {
          return null;
        }
        const holders: Array<{ name: string; x: number; width: number; visible: boolean }> = [];
        const visit = (widget: Widget): void => {
          if (widget.name.startsWith('holder.')) {
            holders.push({
              name: widget.name,
              x: Math.round(widget.appliedRect.x),
              width: Math.round(widget.appliedRect.width),
              visible: widget.visible,
            });
            return;
          }
          for (const child of widget.getWidgetChildren()) {
            visit(child);
          }
        };
        visit(frame);
        return holders;
      },
      /**
       * Live-object counters, so a check can prove that switching sections (which destroys and rebuilds a
       * whole subtree) gives everything back — the same gate the other scenes expose.
       */
      counts: (): {
        widgets: number;
        stageWidgets: number;
        themeListeners: number;
        pointerTargets: number;
        focusables: number;
        a11yNodes: number;
      } => ({
        widgets: countWidgets(this.mvvm.root),
        stageWidgets: this.stageContent ? countWidgets(this.stageContent) : 0,
        themeListeners: themeListenerCount(),
        pointerTargets: this.mvvm.input.widgets.length,
        focusables: this.mvvm.focus.focusables.length,
        a11yNodes: document.querySelectorAll('[data-mvvm-a11y]').length,
      }),
      /** Shows every section once and comes back — the leak gate for section switching. */
      churnSections: (rounds: number): { before: ShowcaseCounts; after: ShowcaseCounts } => {
        // The router re-collects its target list on the *next frame* after a structural change, so a
        // synchronous read catches it mid-update (measured: `pointerTargets` 36 → 6 in the same tick,
        // back to 36 a frame later — a number that reads like a leak and is not one, the same trap
        // `#/list` documents). Asking for the refresh makes both samples describe the same moment.
        const started = this.section.value;
        const startId: SectionId = started === 'all' ? 'buttons' : started;
        // Back to the starting section *before* sampling: `showSection` replaces a subtree, so the
        // router's collection is only correct after a `refreshInteraction()` that follows it.
        this.showSection(startId);
        this.mvvm.refreshInteraction();
        const before = this.showcaseCounts();
        const ids = SECTIONS.map((def) => def.id);
        for (let round = 0; round < rounds; round++) {
          for (const id of ids) {
            this.showSection(id);
          }
        }
        // Back to where it started, so the two samples describe the same section (the first version
        // restored whatever the loop happened to end on, and compared `repeat` against `focus`).
        this.showSection(startId);
        this.mvvm.refreshInteraction();
        return { before, after: this.showcaseCounts() };
      },
      /** The stage's viewport in page coordinates, so a check knows the band a control must be in. */
      stageRect: (): { x: number; y: number; width: number; height: number } | null =>
        this.stageRectOf(),
      geometry: () => ({
        page: this.page ? { ...this.page.appliedRect } : null,
        nav: this.nav ? { ...this.nav.appliedRect } : null,
        stage: this.stage ? { ...this.stage.appliedRect } : null,
        content: this.stageContent ? { ...this.stageContent.appliedRect } : null,
        section: this.sectionHost ? { ...this.sectionHost.appliedRect } : null,
      }),
      /**
       * The applied box of every named widget in the mounted section (optionally filtered).
       *
       * `geometry()` describes the page chrome and `controlStates()` only covers *tracked controls*, as
       * page points. A layout-parameter card needs the opposite: the exact applied box of a specific
       * child, so `shrink` / `basis` / `minHeight` / `maxHeight` / explicit grid placement can be
       * asserted as numbers instead of judged from the picture (round 89).
       */
      rects: (
        names?: readonly string[],
      ): Array<{
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        /** Top-left in page (CSS) pixels, for a screenshot or a pixel read. */
        pageX: number;
        pageY: number;
        pageWidth: number;
        pageHeight: number;
        visible: boolean;
      }> => {
        const wanted = names ? new Set(names) : null;
        const found: Array<{
          name: string;
          x: number;
          y: number;
          width: number;
          height: number;
          pageX: number;
          pageY: number;
          pageWidth: number;
          pageHeight: number;
          visible: boolean;
        }> = [];
        const scale = displayScale(this.game);
        const visit = (widget: Widget): void => {
          if (widget.name && (wanted === null || wanted.has(widget.name))) {
            const rect = widget.appliedRect;
            const page = pageOrigin(this.game, widget as never);
            found.push({
              name: widget.name,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              pageX: page.x,
              pageY: page.y,
              pageWidth: rect.width * scale.x,
              pageHeight: rect.height * scale.y,
              visible: widget.visible,
            });
          }
          for (const child of widget.getWidgetChildren()) {
            visit(child);
          }
        };
        if (this.sectionHost) {
          visit(this.sectionHost);
        }
        return found;
      },
    };
  }

  /** The size the page asks for: the window minus the outer margin, with a floor. */
  private pageSize(): { width: number; height: number } {
    const size = this.scale.gameSize;
    return {
      width: Math.max(320, size.width - 2 * PAGE_MARGIN),
      height: Math.max(240, size.height - 2 * PAGE_MARGIN),
    };
  }

  /**
   * Widgets the pixel gate samples by name, collected while a section is built and reported **after** the
   * next layout pass.
   *
   * `reportWidget()` reads `appliedRect`, and inside a build lambda that rect is still `0x0` — the first
   * version of this reported four `@0,0 0x0` lines and the gate dutifully sampled the canvas corner
   * (round 89). Reporting on the next frame is the honest reading of "where the layout put it".
   */
  private gateWidgets = new Map<string, Widget>();

  /** Sizes the page to the window; also the thing `setLayoutParams` has to get right. */
  private fitPage(): void {
    this.page?.setLayoutParams(this.pageSize());
  }

  /** Publishes the live state and every tracked control's page coordinates, once per frame. */
  override update(): void {
    const widgets = this.stageContent ? countWidgets(this.stageContent) : 0;
    if (widgets !== this.widgetCount.value) {
      this.widgetCount.value = widgets;
    }
    const stage = this.stage;
    if (stage && this.stageOffset.value !== stage.offset) {
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

  // ------------------------------------------------------------------ header / body / footer

  /** Header: the title, the live summary and the three page-level actions. */
  private buildHeader(): void {
    const theme = this.mvvm.theme;
    Row({ gap: 10, alignItems: 'center', width: 'fill' }, () => {
      // A reactive data slot: `Text(() => …)` re-renders when any ref it reads flips, which is what
      // the factory version did through `bindTemplateText` and a binding context.
      Text('phaser-mvvm · widgets & layout showcase', {
        style: { fontSize: `${theme.fontSize.lg}px` },
      });
      Text(
        () =>
          `${this.section.value} · ${this.widgetCount.value} widgets · ${this.themeName.value} theme`,
        { tone: 'muted' },
      );
      Spacer({ flex: true });

      this.track(
        'header',
        'header.showAll',
        Button('Show all', {
          variant: 'secondary',
          size: 'sm',
          name: 'showAll',
          onClick: () => this.setShowAll(!this.showAll.value),
        }),
      );
      this.track(
        'header',
        'header.next',
        Button('Next section', {
          variant: 'primary',
          size: 'sm',
          name: 'next',
          onClick: () => this.nextSection(),
        }),
      );
      this.track(
        'header',
        'header.theme',
        // The label follows the ref, so the button no longer has to `setText` itself on click.
        Button(() => `Theme: ${this.themeName.value}`, {
          variant: 'secondary',
          size: 'sm',
          name: 'themeButton',
          onClick: () => {
            this.themeName.value = this.themeName.value === 'dark' ? 'light' : 'dark';
            this.mvvm.setTheme(this.themeName.value);
          },
        }),
      );
    });
  }

  /** Body: the navigator on the left, the clipped stage on the right. */
  private buildBody(): void {
    Row({ gap: 12, alignItems: 'stretch', width: 'fill', grow: 1 }, () => {
      // The nav is built empty and filled by `rebuildNav()`, exactly like the factory version: its
      // content is replaced on every section switch, and the panel itself must survive that.
      this.nav = Panel({
        direction: 'vertical',
        gap: 6,
        padding: 10,
        width: NAV_WIDTH,
        variant: 'surface',
        radius: 10,
      });

      this.stage = Scroll(
        {
          width: 'fill',
          height: 'fill',
          direction: 'vertical',
          scrollbar: 'auto',
          name: 'showcase.stage',
        },
        () => {
          // `Scroll`'s content lambda is the scroll content, so the two nested `Column`s are the
          // content wrapper and the host the current section is swapped into.
          this.stageContent = Column({ gap: 12, width: 'fill' }, () => {
            this.sectionHost = Column({ gap: 12, width: 'fill' });
          });
        },
      );
    });
  }

  /** Footer: the interaction hint plus the two live readouts. */
  private buildFooter(): void {
    Row({ gap: 10, alignItems: 'center', width: 'fill' }, () => {
      Text('Tab / Shift+Tab · arrows · Enter or Space activate · wheel or drag scrolls the stage', {
        tone: 'muted',
      });
      Spacer({ flex: true });
      Text(() => `focus: ${this.focusName.value}`, { tone: 'muted' });
      Text(
        () =>
          `rows ${this.repeatRendered.value}/${this.rows.value.length} · scroll ${Math.round(
            this.stageOffset.value,
          )} px`,
        { tone: 'muted' },
      );
    });
  }

  // ------------------------------------------------------------------ navigation

  /**
   * Rebuilds the section list; the active entry is a primary button.
   *
   * `ui()` returns one root, so `navItems()` composes the items into a `Column` that is attached to
   * the (mounted, surviving) nav panel: the nav's own box never changes, only its content does.
   */
  private rebuildNav(): void {
    const nav = this.nav;
    if (!nav) {
      return;
    }
    nav.removeAllWidgets(true);
    this.clearTrackedGroup('nav');
    nav.addWidget(ui(this, () => this.navItems()));
  }

  /** Content of the nav, as composables; runs once per rebuild (and once for the first build). */
  private navItems(): void {
    Column({ gap: 6 }, () => {
      // Plain `if` inside a content lambda composes statically: the group heading only exists when
      // the group changes, which is exactly what the factory version's array building expressed.
      let group = '';
      for (const def of SECTIONS) {
        if (def.group !== group) {
          group = def.group;
          Text(group, { tone: 'muted', name: `navGroup.${group}` });
        }
        const active = this.section.value === def.id;
        this.track(
          'nav',
          `nav.${def.id}`,
          Button(def.title, {
            variant: active ? 'primary' : 'ghost',
            size: 'sm',
            width: NAV_WIDTH - 20,
            name: `nav.${def.id}`,
            onClick: () => this.showSection(def.id),
          }),
        );
      }

      Divider({});

      const all = this.section.value === 'all';
      this.track(
        'nav',
        'nav.all',
        Button(all ? 'All sections ●' : 'All sections', {
          variant: all ? 'primary' : 'ghost',
          size: 'sm',
          width: NAV_WIDTH - 20,
          name: 'nav.all',
          onClick: () => this.setShowAll(true),
        }),
      );
      Text('Every card uses the public widget API. The stage is a ScrollView.', {
        tone: 'muted',
        maxLines: 4,
        width: NAV_WIDTH - 20,
      });
    });
  }

  private showSection(id: SectionId): void {
    this.showAll.value = false;
    this.section.value = id;
    this.replaceSection([id]);
  }

  /**
   * Show a section, wait for it to be laid out, then publish its gate rects into `#status`.
   *
   * The pixel gate needs both halves in that order, and only a scene can know when the second one is
   * true: `show()` alone leaves the freshly built widgets at `0x0`. `await`ing the returned promise from
   * `scripts/visual-check.mjs`'s `SCENE_SETUP` is what makes the order explicit.
   */
  async showAndReport(id: SectionId, frames = 2): Promise<void> {
    this.showSection(id);
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    this.reportGate();
  }

  /** Publishes every collected gate widget's rect into `#status` (last line wins for a repeated name). */
  private reportGate(): void {
    for (const [name, widget] of this.gateWidgets) {
      if (!widget.isDestroyed) {
        reportWidget(name, widget);
      }
    }
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
      // `ui()` builds the section without mounting it; the host owns it from this line on.
      const built = ui(this, () => this.buildSection(id));
      this.track('section', `section.${id}`, built);
      host.addWidget(built);
    }
    this.stage?.setScrollOffset(0);
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

  /**
   * Repaints `pt.<key>=@x,y` and `st.<key>=<state>` for every tracked control that is laid out.
   *
   * `pt.*` is where a control is (so a check can aim a real mouse at it); `st.*` is what it looks like
   * (`normal`/`hovered`/`pressed`/`focused`/`disabled`/`loading`…, see `widget-state.ts`). Without the
   * second one the showcase could prove every widget *exists* and nothing about its states — which is
   * what "every widget in every state has a demo" actually claims (round 79). A control that is laid
   * out but hidden publishes `st.<key>=hidden`, so a stale `normal` cannot be mistaken for a live one.
   */
  private publishControls(): void {
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed || widget.appliedRect.width <= 0 || widget.appliedRect.height <= 0) {
        this.publish(`st.${key}`, 'gone');
        continue;
      }
      if (!widget.visible) {
        this.publish(`st.${key}`, 'hidden');
        continue;
      }
      this.publish(
        `pt.${key}`,
        `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
          pagePoint(this.game, widget).y,
        )}`,
      );
      this.publish(`st.${key}`, widget.visualState);
    }
  }

  /** The stage viewport in page coordinates (`null` before the stage exists). */
  private stageRectOf(): { x: number; y: number; width: number; height: number } | null {
    const stage = this.stage;
    if (!stage) {
      return null;
    }
    const origin = pagePoint(this.game, stage);
    const rect = stage.appliedRect;
    return {
      x: Math.round(origin.x - rect.width / 2),
      y: Math.round(origin.y - rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  /** The counters every leak assertion reads. */
  private showcaseCounts(): ShowcaseCounts {
    return {
      widgets: countWidgets(this.mvvm.root),
      stageWidgets: this.stageContent ? countWidgets(this.stageContent) : 0,
      themeListeners: themeListenerCount(),
      pointerTargets: this.mvvm.input.widgets.length,
      focusables: this.mvvm.focus.focusables.length,
      a11yNodes: document.querySelectorAll('[data-mvvm-a11y]').length,
    };
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
  private card(title: string, caption: string, content: () => void): void {
    Panel(
      {
        direction: 'vertical',
        gap: 8,
        padding: 12,
        variant: 'surfaceAlt',
        radius: 8,
        width: 'fill',
      },
      () => {
        Text(title);
        Text(caption, { tone: 'muted', maxLines: 2, width: 560 });
        Divider({});
        content();
      },
    );
  }

  /** A row of demo children; `alignItems: 'center'` is what every row on this page wants. */
  private row(content: () => void, options: RowOptions = {}): void {
    Row({ gap: 8, alignItems: 'center', ...options }, content);
  }

  /** A column of demo children; 6px is the page's default vertical rhythm inside a card. */
  private column(content: () => void, options: ColumnOptions = {}): void {
    Column({ gap: 6, ...options }, content);
  }

  /**
   * A visible frame: the frame *is* the container whose algorithm is being demonstrated.
   *
   * `alignSelf: 'start'` keeps the width the caller declares: a card is a vertical box, whose default
   * cross-axis `stretch` would otherwise widen every frame to the card (which silently un-wrapped
   * `Box · wrap` and shrank nothing about the point of a fixed-size track).
   */
  private frame(options: PanelOptions, content: () => void): PanelWidget {
    return Panel(
      { variant: 'surface', radius: 6, padding: 6, alignSelf: 'start', ...options },
      content,
    );
  }

  // ------------------------------------------------------------------ sections

  private buildSection(id: SectionId): void {
    this.gateWidgets.clear();
    switch (id) {
      case 'text':
        this.buildText();
        return;
      case 'buttons':
        this.buildButtons();
        return;
      case 'inputs':
        this.buildInputs();
        return;
      case 'decoration':
        this.buildDecoration();
        return;
      case 'box':
        this.buildBox();
        return;
      case 'grid':
        this.buildGrid();
        return;
      case 'stack':
        this.buildStack();
        return;
      case 'params':
        this.buildParams();
        return;
      case 'sizing':
        this.buildSizing();
        return;
      case 'repeat':
        this.buildRepeat();
        return;
      case 'focus':
        this.buildFocus();
        return;
      default:
        // An unknown id still has to produce a root, because `ui()` rejects an empty view.
        this.column(() => {});
        return;
    }
  }

  private buildText(): void {
    const theme = this.mvvm.theme;
    const tones = ['default', 'muted', 'primary', 'success', 'warning', 'danger'] as const;
    this.column(
      () => {
        this.card('Label · tones', 'each tone is a theme token, never a literal colour', () => {
          this.row(
            () => {
              for (const tone of tones) {
                Text(tone, { tone, width: 96 });
              }
            },
            { wrap: true },
          );
        });

        this.card('Label · sizes', 'theme.fontSize xs · sm · md · lg · xl', () => {
          this.row(() => {
            Text('xs', { style: { fontSize: `${theme.fontSize.xs}px` }, width: 56 });
            Text('sm', { style: { fontSize: `${theme.fontSize.sm}px` }, width: 56 });
            Text('md', { style: { fontSize: `${theme.fontSize.md}px` }, width: 56 });
            Text('lg', { style: { fontSize: `${theme.fontSize.lg}px` }, width: 56 });
            Text('xl', { style: { fontSize: `${theme.fontSize.xl}px` }, width: 56 });
          });
        });

        this.card('Label · alignment', 'align works inside the width the engine assigned', () => {
          this.column(() => {
            Text('align: left', { align: 'left', width: 220 });
            Text('align: center', { align: 'center', width: 220 });
            Text('align: right', { align: 'right', width: 220 });
          });
        });

        this.card(
          'Label · truncation',
          'maxLines + ellipsis, and wrap: false for a single clipped line',
          () => {
            this.column(() => {
              Text(
                'maxLines: 2 with ellipsis — the label asks the text measurer for the wrapped lines and ' +
                  'trims the rest, so truncation is a layout decision rather than a renderer trick.',
                { maxLines: 2, ellipsis: true, width: 340 },
              );
              Text('wrap: false — a single line, clipped at the assigned width.', {
                wrap: false,
                width: 220,
              });
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildButtons(): void {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
    const sizes = ['sm', 'md', 'lg'] as const;

    this.column(
      () => {
        this.card(
          'Button · variants × sizes',
          'four flavours and three size steps (controlHeight sm/md/lg)',
          () => {
            Grid({ columns: 4, columnGap: 8, rowGap: 8, width: 'fill' }, () => {
              for (const size of sizes) {
                for (const variant of variants) {
                  Button(`${variant} ${size}`, { variant, size, width: 132 });
                }
              }
            });
          },
        );

        this.card('Button · states', 'disabled, loading (activation ignored) and toggle', () => {
          this.row(() => {
            Button('Disabled', { disabled: true, name: 'disabledButton' });
            Button('Loading', { loading: true, name: 'loadingButton' });

            const toggle = Button(() => `Toggle: ${this.toggled.value ? 'on' : 'off'}`, {
              toggle: true,
              value: false,
              width: 136,
              name: 'toggleButton',
            });
            toggle.on('change', (value: boolean) => {
              this.toggled.value = value;
            });
            this.track('section', 'buttons.toggle', toggle);

            Text(
              () => `clicks: ${this.clicks.value} · toggle ${this.toggled.value ? 'on' : 'off'}`,
              {
                tone: 'muted',
              },
            );
          });
        });

        this.card('Button · icon', 'a texture key icon, with or without a label', () => {
          this.row(() => {
            Button('With icon', { icon: TILE_TEXTURE, variant: 'secondary' });
            Button('', { icon: TILE_TEXTURE, variant: 'primary', name: 'iconOnlyButton' });
          });
        });

        this.card(
          'Button · feedback',
          'activation updates the view model; #demo-state shows it',
          () => {
            this.row(() => {
              this.track(
                'section',
                'buttons.click',
                Button('Click me', {
                  variant: 'primary',
                  name: 'clickButton',
                  onClick: () => {
                    this.clicks.value += 1;
                  },
                }),
              );
              this.track(
                'section',
                'buttons.reset',
                Button('Reset', {
                  variant: 'secondary',
                  name: 'resetButton',
                  onClick: () => {
                    this.clicks.value = 0;
                  },
                }),
              );
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildInputs(): void {
    this.column(
      () => {
        this.card(
          'TextField flavours',
          'text, email, number, password and read-only/disabled',
          () => {
            this.row(() => {
              this.column(() => {
                // `onValueChange` is the DSL's change channel: it fires on *user* edits only, exactly
                // like the `change` listener the factory version attached by hand.
                this.track(
                  'section',
                  'inputs.text',
                  TextField({
                    label: 'Text',
                    placeholder: 'type here',
                    clearable: true,
                    width: 240,
                    name: 'fieldText',
                    onValueChange: (value) => {
                      this.fieldValue.value = value;
                    },
                  }),
                );
                this.track(
                  'section',
                  'inputs.email',
                  TextField({
                    label: 'Email',
                    placeholder: 'ada@example.com',
                    inputType: 'email',
                    width: 240,
                    name: 'fieldEmail',
                    validate: () => (this.validEmail.value ? null : 'enter a valid email address'),
                    onValueChange: (value) => {
                      this.emailValue.value = value;
                    },
                  }),
                );
              });
              this.column(() => {
                TextField({
                  label: 'Number',
                  inputType: 'number',
                  placeholder: '42',
                  width: 190,
                  name: 'fieldNumber',
                });
                TextField({
                  label: 'Password',
                  inputType: 'password',
                  placeholder: 'secret',
                  width: 190,
                  name: 'fieldPassword',
                });
              });
              this.column(() => {
                TextField({
                  label: 'Disabled',
                  placeholder: 'cannot be focused',
                  disabled: true,
                  width: 190,
                  name: 'fieldDisabled',
                });
                TextField({
                  label: 'Read only',
                  value: 'copy me',
                  readOnly: true,
                  width: 190,
                  name: 'fieldReadOnly',
                });
              });
            });
          },
        );

        this.card(
          'Validation',
          'validate() runs on blur; a string result becomes the error state',
          () => {
            this.row(() => {
              Text('Type an invalid email, then press Tab or click elsewhere.', {
                tone: 'muted',
                width: 340,
              });
            });
          },
        );

        this.card('TextArea', 'rows, wrapping and the submit shortcut', () => {
          this.row(() => {
            this.track(
              'section',
              'inputs.area',
              TextArea({
                label: 'TextArea',
                placeholder: 'Enter adds a line · Ctrl/Cmd+Enter submits',
                rows: 3,
                maxLength: 200,
                width: 320,
                name: 'fieldArea',
                onValueChange: (value) => {
                  this.areaLength.value = value.length;
                },
              }),
            );
          });
        });

        this.card(
          'Live values',
          'every input writes into the view model through its change event',
          () => {
            this.row(() => {
              Text(
                () =>
                  `field "${this.fieldValue.value}" · email ${this.emailValue.value} (${
                    this.validEmail.value ? 'valid' : 'invalid'
                  }) · area ${this.areaLength.value} chars`,
                { tone: 'muted', maxLines: 2, width: 420 },
              );
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildDecoration(): void {
    const variants = ['surface', 'surfaceAlt', 'overlay', 'primary', 'danger', 'plain'] as const;
    const fits = ['contain', 'cover', 'fill', 'none'] as const;
    this.column(
      () => {
        this.card('Panel · variants', 'six background flavours, all from theme tokens', () => {
          Grid({ columns: 3, columnGap: 8, rowGap: 8, width: 'fill' }, () => {
            for (const variant of variants) {
              Panel(
                {
                  direction: 'horizontal',
                  alignItems: 'center',
                  justifyContent: 'center',
                  variant,
                  radius: 6,
                  width: 132,
                  height: 44,
                },
                () => {
                  Text(variant, { align: 'center' });
                },
              );
            }
          });
        });

        this.card(
          'Panel · radius / elevation / border',
          'radius clamps to half the box, elevation fakes a shadow',
          () => {
            this.row(() => {
              Panel({ variant: 'surface', radius: 0, width: 88, height: 54 }, () => {
                Text('r0', { align: 'center' });
              });
              Panel({ variant: 'surface', radius: 8, width: 88, height: 54 }, () => {
                Text('r8', { align: 'center' });
              });
              Panel({ variant: 'surface', radius: 20, width: 88, height: 54 }, () => {
                Text('r20', { align: 'center' });
              });
              Panel({ variant: 'surface', elevation: 10, width: 88, height: 54 }, () => {
                Text('elev 10', { align: 'center' });
              });
              Panel({ variant: 'surface', border: false, width: 88, height: 54 }, () => {
                Text('no border', { align: 'center' });
              });
            });
          },
        );

        this.card(
          'Divider & Spacer',
          'rules use the border token; spacers only reserve space',
          () => {
            this.column(() => {
              Divider({});
              this.row(
                () => {
                  Text('left');
                  Spacer({ flex: true });
                  Text('spacer(flex)');
                  Spacer({ flex: true });
                  Text('right');
                },
                { width: 420 },
              );
              Divider({ thickness: 2 });
              this.row(() => {
                Text('fixed');
                Spacer({ width: 60, height: 8 });
                Text('spacer(width: 60)');
                Divider({ orientation: 'vertical', height: 24 });
                Text('vertical rule');
              });
            });
          },
        );

        this.card('Image · fit', `the only widget that reads a texture (${TILE_TEXTURE})`, () => {
          this.row(() => {
            for (const fit of fits) {
              this.column(() => {
                Image({ texture: TILE_TEXTURE, fit, width: 84, height: 64, name: `image.${fit}` });
                Text(fit, { tone: 'muted', align: 'center', width: 84 });
              });
            }
          });
        });
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildBox(): void {
    const blue = 0x2f6feb;
    const green = 0x3fb950;
    const amber = 0xf2a33c;
    const purple = 0x8957e5;
    this.column(
      () => {
        this.card('Box · justifyContent', 'main-axis distribution inside a fixed frame', () => {
          this.row(() => {
            for (const justify of ['start', 'center', 'end'] as const) {
              this.column(() => {
                Text(`justifyContent: ${justify}`, { tone: 'muted' });
                this.frame(
                  {
                    direction: 'vertical',
                    gap: 6,
                    justifyContent: justify,
                    width: 140,
                    height: 120,
                  },
                  () => {
                    Block(blue, '1', 100, 22);
                    Block(green, '2', 100, 22);
                    Block(amber, '3', 100, 22);
                  },
                );
              });
            }
          });
        });

        this.card(
          'Box · alignItems',
          'cross-axis alignment: start · center · end · stretch',
          () => {
            this.row(() => {
              for (const alignItems of ['start', 'center', 'end', 'stretch'] as const) {
                this.column(() => {
                  Text(`alignItems: ${alignItems}`, { tone: 'muted' });
                  this.frame(
                    { direction: 'horizontal', gap: 6, alignItems, width: 150, height: 90 },
                    () => {
                      Block(blue, 'a', 30, 22);
                      Block(green, 'b', 30, 40);
                      Block(amber, 'c', 30, 30);
                    },
                  );
                });
              }
            });
          },
        );

        this.card('Box · wrap', 'wrap: true flows into lines inside a narrow frame', () => {
          this.frame(
            { direction: 'horizontal', gap: 6, wrap: true, width: 260, height: 120 },
            () => {
              for (let index = 0; index < 8; index += 1) {
                Block(index % 2 === 0 ? blue : purple, String(index + 1), 56, 26);
              }
            },
          );
        });

        this.card(
          'Box · reverse',
          'reverse flips the visual order without touching the tree',
          () => {
            this.row(() => {
              this.column(() => {
                Text('reverse: false', { tone: 'muted' });
                this.frame({ direction: 'horizontal', gap: 6, width: 200, height: 46 }, () => {
                  for (const n of [1, 2, 3, 4]) {
                    Block(blue, String(n), 40, 26);
                  }
                });
              });
              this.column(() => {
                Text('reverse: true', { tone: 'muted' });
                this.frame(
                  { direction: 'horizontal', gap: 6, reverse: true, width: 200, height: 46 },
                  () => {
                    for (const n of [1, 2, 3, 4]) {
                      Block(0xf85149, String(n), 40, 26);
                    }
                  },
                );
              });
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildGrid(): void {
    const cell = (text: string, variant: PanelVariant = 'surface'): void => {
      Panel(
        {
          direction: 'horizontal',
          alignItems: 'center',
          justifyContent: 'center',
          variant,
          radius: 6,
          height: 36,
        },
        () => {
          Text(text, { align: 'center' });
        },
      );
    };

    this.column(
      () => {
        this.card('Grid · fixed columns', 'columns: 3 with columnGap / rowGap', () => {
          Grid({ columns: 3, columnGap: 8, rowGap: 8, width: 'fill', name: 'grid.fixed' }, () => {
            for (let index = 0; index < 6; index += 1) {
              cell(`cell ${index + 1}`);
            }
          });
        });

        this.card(
          "Grid · columns: 'auto'",
          'the engine derives the column count from minColumnWidth',
          () => {
            Grid(
              {
                columns: 'auto',
                minColumnWidth: 90,
                columnGap: 8,
                rowGap: 8,
                width: 320,
                name: 'grid.auto',
              },
              () => {
                for (let index = 0; index < 8; index += 1) {
                  Block(0x3fb950, String(index + 1), 80, 30);
                }
              },
            );
          },
        );

        this.card(
          'Grid · spans',
          'gridColumnSpan widens a cell; later cells flow around it',
          () => {
            Grid({ columns: 3, columnGap: 8, rowGap: 8, width: 'fill', name: 'grid.spans' }, () => {
              Panel(
                {
                  direction: 'horizontal',
                  variant: 'primary',
                  radius: 6,
                  height: 36,
                  gridColumnSpan: 2,
                },
                () => {
                  Text('span 2', { align: 'center' });
                },
              );
              cell('cell');
              cell('cell');
              Panel(
                {
                  direction: 'horizontal',
                  variant: 'danger',
                  radius: 6,
                  height: 36,
                  gridColumnSpan: 3,
                },
                () => {
                  Text('span 3', { align: 'center' });
                },
              );
            });
          },
        );

        this.card(
          'Grid · explicit placement',
          'gridColumn / gridRow pin a cell (1-based); auto flow skips the occupied cells',
          () => {
            Grid({ columns: 3, columnGap: 8, rowGap: 8, width: 'fill', name: 'grid.place' }, () => {
              // Declared **first**, painted last: an explicit cell must not consume a flow slot.
              placeCell('pinned', 'grid.place.pin', { gridColumn: 3, gridRow: 2 }, 'primary');
              placeCell('flow 1', 'grid.place.flow1', {}, 'surface');
              placeCell('flow 2', 'grid.place.flow2', {}, 'surface');
              // Spans two rows: its height is both rows plus the gap between them.
              placeCell('row span 2', 'grid.place.span', { gridRowSpan: 2 }, 'danger');
              placeCell('flow 3', 'grid.place.flow3', {}, 'surface');
              placeCell('flow 4', 'grid.place.flow4', {}, 'surface');
            });
          },
        );

        this.card(
          'Grid · alignment',
          'justifyItems / alignItems place the child inside its cell',
          () => {
            this.row(() => {
              Grid(
                {
                  columns: 2,
                  columnGap: 10,
                  rowGap: 10,
                  justifyItems: 'start',
                  alignItems: 'start',
                  width: 200,
                  name: 'grid.alignStart',
                },
                () => {
                  Block(0x2f6feb, 'a', 40, 24);
                  Block(0x3fb950, 'b', 40, 24);
                },
              );
              Grid(
                {
                  columns: 2,
                  columnGap: 10,
                  rowGap: 10,
                  justifyItems: 'end',
                  alignItems: 'end',
                  width: 200,
                  name: 'grid.alignEnd',
                },
                () => {
                  Block(0xf2a33c, 'c', 40, 24);
                  Block(0xf85149, 'd', 40, 24);
                },
              );
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildStack(): void {
    this.column(
      () => {
        this.card('Stack · align', 'children overlap; align picks where they sit', () => {
          this.row(() => {
            for (const align of ['start', 'center', 'end'] as const) {
              this.column(() => {
                Text(`uiStack align: ${align}`, { tone: 'muted' });
                Stack({ align, width: 150, height: 96, name: `stack.${align}` }, () => {
                  Block(0x2f6feb, 'A', 90, 70);
                  Block(0x3fb950, 'B', 60, 46);
                  Block(0xf2a33c, 'C', 34, 24);
                });
              });
            }
          });
        });

        this.card('Absolute · corners', 'position: absolute with left/top/right/bottom', () => {
          Absolute(
            { width: 300, height: 150, alignSelf: 'start', name: 'absolute.corners' },
            () => {
              Block(0x2f6feb, 'left/top', 76, 28, { position: 'absolute', left: 6, top: 6 });
              Block(0x3fb950, 'right/top', 76, 28, { position: 'absolute', right: 6, top: 6 });
              Block(0xf2a33c, 'left/bottom', 76, 28, {
                position: 'absolute',
                left: 6,
                bottom: 6,
              });
              Block(0xf85149, 'right/bottom', 76, 28, {
                position: 'absolute',
                right: 6,
                bottom: 6,
              });
              Block(0x8957e5, 'left/top 50%', 86, 28, {
                position: 'absolute',
                left: '50%',
                top: '50%',
              });
            },
          );
        });

        this.card(
          'Absolute · flow interaction',
          'an absolute child takes no space in its parent',
          () => {
            this.row(() => {
              this.frame({ direction: 'vertical', gap: 6, width: 210, height: 110 }, () => {
                Block(0x2f6feb, 'flow 1', 170, 24);
                Block(0x3fb950, 'flow 2', 170, 24);
                Block(0xf2a33c, 'flow 3', 170, 24);
                Block(0xf85149, 'absolute overlay', 170, 24, {
                  position: 'absolute',
                  left: 20,
                  top: 40,
                });
              });
              Text('The overlay sits at left: 20 / top: 40 and pushes nothing aside.', {
                tone: 'muted',
                width: 300,
              });
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildParams(): void {
    // A reactive condition instead of a manual `setVisible`: `visible` is a data slot on every
    // composable, so the block leaves the flow when the ref flips — no rebuild, no hidden handle.
    const hidden = ref(false);
    const paramTrack = (content: () => void): void => {
      this.frame(
        { direction: 'horizontal', gap: 8, width: 430, height: 54, alignItems: 'center' },
        content,
      );
    };

    this.column(
      () => {
        this.card('width modes', "auto · fixed · percentage · 'fill' inside the same track", () => {
          this.column(() => {
            paramTrack(() => Block(0x2f6feb, 'auto', 60, 30));
            paramTrack(() => Block(0x3fb950, '160', 160, 30));
            paramTrack(() => Block(0xf2a33c, '50%', 60, 30, { width: '50%' }));
            paramTrack(() => Block(0xf85149, 'fill', 60, 30, { width: 'fill' }));
          });
        });

        this.card('grow', 'grow 1 vs grow 2 split the leftover space', () => {
          this.frame({ direction: 'horizontal', gap: 8, width: 430, height: 50 }, () => {
            Block(0x2f6feb, 'grow 1', 60, 30, { grow: 1 });
            Block(0x3fb950, 'grow 2', 60, 30, { grow: 2 });
            Block(0xf2a33c, 'grow 0', 96, 30);
          });
        });

        this.card('min / max', 'a clamp wins over the content width', () => {
          this.column(() => {
            Text('maxWidth: 200 — this sentence would be much wider than the clamp allows.', {
              wrap: true,
              maxWidth: 200,
              width: 'fill',
            });
            Text('minWidth: 240 keeps a tiny label wide', { minWidth: 240, tone: 'muted' });
          });
        });

        this.card('aspectRatio', 'height follows width (2:1)', () => {
          this.row(() => {
            Block(0x2f6feb, '2:1', 120, 60, { aspectRatio: 2, height: 'auto' });
            Text('width 120 · aspectRatio 2 → height 60', { tone: 'muted', width: 260 });
          });
        });

        this.card(
          'margin & padding',
          'margin pushes from outside, padding reserves space inside',
          () => {
            this.frame({ direction: 'horizontal', width: 300, height: 90, padding: 10 }, () => {
              this.frame({ direction: 'horizontal', width: 120, height: 50, margin: 6 }, () => {
                Text('padding 10 / margin 6', { align: 'center', width: 100 });
              });
            });
          },
        );

        this.card('order', 'visual order follows `order`, not declaration order', () => {
          this.row(() => {
            this.frame({ direction: 'horizontal', gap: 6, width: 320, height: 46 }, () => {
              Block(0x2f6feb, 'declared 1 · order 2', 100, 26, { order: 2 });
              Block(0x3fb950, 'declared 2 · order 0', 100, 26, { order: 0 });
              Block(0xf2a33c, 'declared 3 · order 1', 100, 26, { order: 1 });
            });
            Text('painted 2, 3, 1', { tone: 'muted', width: 120 });
          });
        });

        this.card('alignSelf', 'a child overrides the row alignment', () => {
          this.frame(
            { direction: 'horizontal', gap: 8, alignItems: 'center', width: 430, height: 96 },
            () => {
              Block(0x2f6feb, 'start', 70, 26, { alignSelf: 'start' });
              Block(0x3fb950, 'center', 70, 40, { alignSelf: 'center' });
              Block(0xf2a33c, 'end', 70, 26, { alignSelf: 'end' });
              Block(0x8957e5, 'stretch', 70, 26, { alignSelf: 'stretch' });
            },
          );
        });

        this.card('visibility', 'setVisible collapses the node out of the flow', () => {
          this.row(() => {
            this.frame({ direction: 'horizontal', gap: 8, width: 300, height: 50 }, () => {
              Block(0x2f6feb, 'A', 60, 30);
              Block(0x3fb950, 'collapse', 60, 30, { visible: () => !hidden.value });
              Block(0xf2a33c, 'C', 60, 30);
            });
            this.track(
              'section',
              'params.visibility',
              Button(() => (hidden.value ? 'Show B' : 'Hide B'), {
                variant: 'secondary',
                size: 'sm',
                name: 'visibilityButton',
                onClick: () => {
                  hidden.value = !hidden.value;
                },
              }),
            );
          });
        });
      },
      { gap: 12, width: 'fill' },
    );
  }

  /**
   * The size parameters that no page had ever passed: `shrink`, `basis`, `minHeight`, `maxHeight`.
   *
   * Every card here is an **A/B**: the same declaration twice, once with the parameter and once
   * without, so the assertion is a pair of numbers rather than "the picture looks right". The numbers
   * are the ones `packages/layout/test/box.test.ts` pins on the engine side — the point of the card is
   * that the *widget* layer hands the same parameters through (`Row`/`Panel` options are split into
   * widget options and layout params, so a typo in a key table would silently drop them).
   */
  private buildSizing(): void {
    this.column(
      () => {
        this.card('shrink', 'the overflow is given up in proportion to weight × base size', () => {
          this.row(() => {
            this.frame(
              { direction: 'horizontal', width: 240, height: 56, name: 'sizing.shrink.off' },
              () => {
                sizingBox('no shrink', 'sizing.shrink.off.a', 120, 40, {});
                sizingBox('no shrink', 'sizing.shrink.off.b', 120, 40, {});
                sizingBox('no shrink', 'sizing.shrink.off.c', 120, 40, {});
              },
            );
            Text('3 × 120 in a 228 box → the third one paints outside', {
              tone: 'muted',
              width: 150,
            });
            // Reported into `#status` so the *pixel* gate can sample two points that only agree with
            // each other when the shrink really happened: the third box's own fill, and the frame's
            // right padding (which the overflowing box would cover if `shrink` were dropped).
            const shrunk = this.frame(
              { direction: 'horizontal', width: 240, height: 56, name: 'sizing.shrink.on' },
              () => {
                sizingBox('shrink 1', 'sizing.shrink.on.a', 120, 40, { shrink: 1 });
                sizingBox('shrink 1', 'sizing.shrink.on.b', 120, 40, { shrink: 1 });
                const third = sizingBox('shrink 1', 'sizing.shrink.on.c', 120, 40, { shrink: 1 });
                this.gateWidgets.set('sizing.shrink.on.c', third);
              },
            );
            this.gateWidgets.set('sizing.shrink.on', shrunk);
            Text('shrink 1 → 76 each (228 total)', { tone: 'muted', width: 150 });
          });
        });

        this.card(
          'basis',
          'the initial main-axis size, before grow/shrink (CSS flex-basis)',
          () => {
            this.row(() => {
              this.frame(
                { direction: 'horizontal', width: 320, height: 56, name: 'sizing.basis.off' },
                () => {
                  sizingBox('width 40', 'sizing.basis.off.a', 40, 40, {});
                  sizingBox('width 40', 'sizing.basis.off.b', 40, 40, {});
                  sizingBox('width 40', 'sizing.basis.off.c', 40, 40, {});
                },
              );
              Text('3 × 40', { tone: 'muted', width: 60 });
              this.frame(
                { direction: 'horizontal', width: 320, height: 56, name: 'sizing.basis.on' },
                () => {
                  sizingBox('basis 100', 'sizing.basis.on.a', 40, 40, { basis: 100 });
                  sizingBox('basis 150', 'sizing.basis.on.b', 40, 40, { basis: 150 });
                  sizingBox('width 40', 'sizing.basis.on.c', 40, 40, {});
                },
              );
              Text('100 · 150 · 40', { tone: 'muted', width: 90 });
            });
          },
        );

        this.card(
          'min / max height',
          'a height clamp wins over the declared height and over a stretch',
          () => {
            this.row(() => {
              const stretchFrame = this.frame(
                {
                  direction: 'horizontal',
                  width: 260,
                  height: 96,
                  alignItems: 'stretch',
                  name: 'sizing.height.stretch.frame',
                },
                () => {
                  sizingBox('stretch', 'sizing.height.stretch.box', 70, undefined, {});
                  const clamped = sizingBox(
                    'maxHeight 40',
                    'sizing.height.max.box',
                    70,
                    undefined,
                    {
                      maxHeight: 40,
                    },
                  );
                  this.gateWidgets.set('sizing.height.max.box', clamped);
                },
              );
              // The frame is reported too: the pixel gate samples it *below* the clamped box, where a
              // stretch that ignored `maxHeight` would have painted the box instead.
              this.gateWidgets.set('sizing.height.stretch.frame', stretchFrame);
              Text('stretch gives 84; the clamp cuts it to 40', { tone: 'muted', width: 150 });
            });
            this.row(() => {
              this.frame(
                {
                  direction: 'horizontal',
                  width: 320,
                  height: 120,
                  alignItems: 'start',
                  name: 'sizing.height.start.frame',
                },
                () => {
                  sizingBox('height 20 · minHeight 60', 'sizing.height.min.box', 120, 20, {
                    minHeight: 60,
                  });
                  sizingBox('height 90 · maxHeight 50', 'sizing.height.max.box2', 120, 90, {
                    maxHeight: 50,
                  });
                },
              );
              Text('60 and 50 tall', { tone: 'muted', width: 110 });
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildRepeat(): void {
    // `controls()` lists the tracked keys in insertion order, and the factory version tracked the two
    // scroll ports before the row buttons (they are created earlier in code, even though the buttons
    // sit in the earlier card). The DSL creates widgets in tree order, so the buttons the later part
    // of the tree produces are collected here and tracked in that same order afterwards.
    const deferred: Array<readonly [string, Widget]> = [];
    const later = (key: string, widget: Widget): void => {
      deferred.push([key, widget]);
    };

    this.column(
      () => {
        this.card(
          'Repeat · virtualised list',
          'itemExtent + overscan: only the visible window is mounted, fillers keep the full height',
          () => {
            this.row(() => {
              this.track(
                'section',
                'repeat.list',
                Scroll(
                  {
                    width: 'fill',
                    height: 200,
                    direction: 'vertical',
                    scrollbar: 'auto',
                    name: 'showcase.list',
                  },
                  () => {
                    // A virtualised `List` needs a box exactly its own viewport (`fill`), which is what
                    // makes the port's scroll range equal the list's full length.
                    this.column(
                      () => {
                        this.repeatWidget = List<SampleRow>(
                          {
                            items: () => this.rows.value,
                            key: (row) => row.id,
                            container: { gap: 2 },
                            virtualize: true,
                            itemExtent: 26,
                            overscan: 2,
                            height: 'fill',
                            name: 'showcase.repeat',
                          },
                          (row, _index, ctx) => {
                            // Exactly one root per row, so the two labels live in a `Row`. The name
                            // keeps its `{{ $index }}` binding because that index is *live*: a row
                            // that survives a reorder re-renders with its new number.
                            Row(
                              {
                                gap: 8,
                                alignItems: 'center',
                                height: 24,
                                padding: { left: 8, right: 6, top: 0, bottom: 0 },
                              },
                              () => {
                                bindTemplateText(
                                  Text('', { width: 190, height: 18 }),
                                  ctx,
                                  '#{{ $index }} · {{ $item.label }}',
                                );
                                Text(row.id, { tone: 'muted', width: 60 });
                              },
                            );
                          },
                        );
                      },
                      { gap: 0, width: 'fill', height: 'fill' },
                    );
                  },
                ),
              );

              this.column(() => {
                later(
                  'repeat.addRow',
                  Button('Add row', {
                    variant: 'secondary',
                    size: 'sm',
                    name: 'addRow',
                    onClick: () => {
                      const next = this.rows.value.length;
                      this.rows.value.push({ id: `r${next}`, label: `row ${next}` });
                    },
                  }),
                );
                later(
                  'repeat.removeRow',
                  Button('Remove row', {
                    variant: 'secondary',
                    size: 'sm',
                    name: 'removeRow',
                    onClick: () => {
                      this.rows.value.pop();
                    },
                  }),
                );
                later(
                  'repeat.reverse',
                  Button('Reverse', {
                    variant: 'secondary',
                    size: 'sm',
                    name: 'shuffleRows',
                    onClick: () => {
                      this.rows.value = this.rows.value.slice().reverse();
                    },
                  }),
                );
                Text(
                  () => `mounted rows: ${this.repeatRendered.value} / ${this.rows.value.length}`,
                  {
                    tone: 'muted',
                  },
                );
              });
            });
          },
        );

        this.card(
          'ScrollView · horizontal',
          'wheel, drag or the buttons; the clip hides the overflow',
          () => {
            this.row(() => {
              const chipScroll = Scroll(
                {
                  width: 'fill',
                  height: 60,
                  direction: 'horizontal',
                  scrollbar: 'auto',
                  name: 'showcase.chips',
                },
                () => {
                  Row({ gap: 8 }, () => {
                    for (let index = 0; index < 24; index += 1) {
                      Panel(
                        {
                          direction: 'horizontal',
                          alignItems: 'center',
                          justifyContent: 'center',
                          variant: index % 3 === 0 ? 'primary' : 'surface',
                          radius: 6,
                          width: 88,
                          height: 44,
                        },
                        () => {
                          Text(`chip ${index}`, { align: 'center' });
                        },
                      );
                    }
                  });
                },
              );
              this.track('section', 'repeat.chips', chipScroll);

              this.column(() => {
                later(
                  'repeat.left',
                  Button('Left', {
                    variant: 'secondary',
                    size: 'sm',
                    name: 'chipsLeft',
                    onClick: () => chipScroll.scrollBy(-200, 0),
                  }),
                );
                later(
                  'repeat.right',
                  Button('Right', {
                    variant: 'secondary',
                    size: 'sm',
                    name: 'chipsRight',
                    onClick: () => chipScroll.scrollBy(200, 0),
                  }),
                );
              });
            });
          },
        );

        for (const [key, widget] of deferred) {
          this.track('section', key, widget);
        }
      },
      { gap: 12, width: 'fill' },
    );
  }

  private buildFocus(): void {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    this.column(
      () => {
        this.card('Tab order', 'Tab / Shift+Tab walk the tree in visual order', () => {
          this.row(
            () => {
              for (const name of names) {
                this.track(
                  'section',
                  `focus.${name}`,
                  Button(name, {
                    variant: 'secondary',
                    width: 96,
                    name: `focus.${name}`,
                    onClick: () => {
                      this.clicks.value += 1;
                    },
                  }),
                );
              }
              TextField({ placeholder: 'focusable too', width: 160, name: 'focus.field' });
            },
            { wrap: true },
          );
        });

        this.card('Focus readout', 'every focus change is published to #demo-state', () => {
          this.row(() => {
            Text(() => `focus: ${this.focusName.value}`, { tone: 'primary' });
          });
        });

        this.card(
          'Arrow navigation',
          'the focus manager picks the nearest neighbour in a direction',
          () => {
            Grid({ columns: 3, columnGap: 8, rowGap: 8, width: 'fill' }, () => {
              for (let index = 0; index < 6; index += 1) {
                this.track(
                  'section',
                  `focus.arrow${index + 1}`,
                  Button(`nav ${index + 1}`, {
                    variant: 'ghost',
                    height: 34,
                    name: `arrow.${index + 1}`,
                  }),
                );
              }
            });
          },
        );

        this.card(
          'Disabled widgets are skipped',
          'disabled controls never take focus or clicks',
          () => {
            this.row(() => {
              Button('enabled', { name: 'skip.enabled1' });
              Button('disabled', { disabled: true, name: 'skip.disabled' });
              Button('enabled', { name: 'skip.enabled2' });
            });
          },
        );
      },
      { gap: 12, width: 'fill' },
    );
  }
}

// --------------------------------------------------------------------- helpers

/**
 * A labelled colour block: a `Rect` for the fill plus a `Text` for the name.
 *
 * Two nodes inside a positioning container, all three composed with the DSL.
 *
 * `params` are applied to the *block* (so `grow`, `order`, `alignSelf`, `width`, `visible` … behave
 * exactly as declared), while the rect inside is absolutely positioned to cover it.
 */
/** One named grid cell of the explicit-placement card. */
function placeCell(
  text: string,
  name: string,
  params: LayoutParams & { name?: string },
  variant: PanelVariant,
): void {
  Panel(
    {
      direction: 'horizontal',
      alignItems: 'center',
      justifyContent: 'center',
      variant,
      radius: 6,
      height: 36,
      name,
      ...params,
    },
    () => {
      Text(text, { align: 'center', style: { fontSize: '11px' } });
    },
  );
}

/**
 * A box whose *main-axis* width and *cross-axis* height are declared separately, so a sizing card can
 * leave the height to the container (`undefined`) or clamp it.
 *
 * `Block` always passes a height, which is exactly what a stretch card must not do.
 */
function sizingBox(
  text: string,
  name: string,
  width: number,
  height: number | undefined,
  params: RowOptions,
): BoxWidget {
  return Row(
    {
      alignItems: 'center',
      justifyContent: 'center',
      width,
      height,
      name,
      ...params,
    },
    () => {
      Rect({
        color: 0x2f6feb,
        width: 'fill',
        height: 'fill',
        position: 'absolute',
        left: 0,
        top: 0,
      });
      Text(text, {
        align: 'center',
        style: { fontSize: '10px' },
        maxLines: 2,
        width,
        name: `${name}.text`,
      });
    },
  );
}

function Block(
  color: number,
  text: string,
  width = 44,
  height = 26,
  params: RowOptions = {},
): void {
  Row(
    {
      alignItems: 'center',
      justifyContent: 'center',
      width,
      height,
      name: `holder.${text}`,
      ...params,
    },
    () => {
      Rect({ color, width, height, position: 'absolute', left: 0, top: 0, name: `rect.${text}` });

      Text(text, {
        align: 'center',
        style: { fontSize: '11px' },
        width,
        height: 16,
        name: `block.${text}`,
      });
    },
  );
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
