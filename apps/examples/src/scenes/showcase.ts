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
import { bindTemplateText, currentUiScene, emitWidget, RectWidget } from '@phaser-mvvm/phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import type { PanelOptions, PanelVariant, Repeat, ScrollView } from '@phaser-mvvm/widgets';
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

  /** The size the page asks for: the window minus the outer margin, with a floor. */
  private pageSize(): { width: number; height: number } {
    const size = this.scale.gameSize;
    return {
      width: Math.max(320, size.width - 2 * PAGE_MARGIN),
      height: Math.max(240, size.height - 2 * PAGE_MARGIN),
    };
  }

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
  private frame(options: PanelOptions, content: () => void): void {
    Panel({ variant: 'surface', radius: 6, padding: 6, alignSelf: 'start', ...options }, content);
  }

  // ------------------------------------------------------------------ sections

  private buildSection(id: SectionId): void {
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
 * A labelled colour block: a `RectWidget` for the fill plus a `Text` for the name.
 *
 * The DSL has no `Rect` composable — `RectWidget` is the M0 probe widget of the adapter — so this is
 * the "custom widget joins the tree" case the DSL guide describes: build the instance, add it to the
 * scene and `emitWidget()` it, which attaches it to whatever container is currently open. The rest of
 * the block (the positioning container and the name label) is composed as usual.
 *
 * `params` are applied to the *block* (so `grow`, `order`, `alignSelf`, `width`, `visible` … behave
 * exactly as declared), while the rect inside is absolutely positioned to cover it.
 */
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
      const scene = currentUiScene();
      const rect = new RectWidget(scene, { color, width, height, name: `rect.${text}` });
      scene.add.existing(rect);
      rect.setLayoutParams({ position: 'absolute', left: 0, top: 0 });
      emitWidget(rect);

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
