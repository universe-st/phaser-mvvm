/**
 * Scroll & clip demo (M7): three independent `ScrollView`s.
 *
 * 1. **Vertical** — a virtualised `Repeat` (220 rows of Label + Delete) inside a `ScrollView`. The
 *    list owns its own window (`itemExtent` + fillers) and the scroll view only clips it and drives
 *    it through `setScrollOffset`, so the rows never travel twice.
 * 2. **Horizontal** — 30 chips: nothing is virtualised here, so the scroll view moves its content
 *    holder itself (the layout engine places it at the negated offset).
 * 3. **Nested** — a `ScrollView` inside a fixed-size `Panel`, i.e. a change *below* a relayout
 *    boundary: the shape the M6 arrange fix had to handle.
 *
 * Everything a check needs is published into `#demo-state`: `v.offset/v.maxOffset/v.rows/v.deleted`,
 * `h.offset/h.maxOffset`, `nested.offset/nested.maxOffset` and `focus`, plus the click points
 * `pt.vup`/`pt.vdown`/`pt.vbottom`/`pt.hleft`/`pt.hright`/`pt.nup`/`pt.ndown` and
 * `pt.vrowdelete` (the first rendered row's Delete button, refreshed every frame).
 */

import Phaser from 'phaser';
import { BindingContext, ref } from '@phaser-mvvm/core';
import { bindTemplate, bindTemplateText } from '@phaser-mvvm/phaser';
import type { Widget } from '@phaser-mvvm/phaser';
import type { Label, Repeat, ScrollView } from '@phaser-mvvm/widgets';
import { reportControl, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

interface ScrollRow {
  id: string;
  name: string;
  score: number;
}

const LIST_ROWS = 220;
const ROW_HEIGHT = 34;
const ROW_GAP = 4;
const ROW_EXTENT = ROW_HEIGHT + ROW_GAP;
const CHIP_COUNT = 30;
const CHIP_WIDTH = 96;
const CHIP_GAP = 8;
/** Labels before the inner port inside the nested port's content. */
const NESTED_LEAD = 30;
/** …and after it, so the nested content is longer than its viewport at both ends of the inner port. */
const NESTED_TAIL = 8;
/** Height of the inner port: taller than a third of the nested band, so revealing a target inside it
 * makes the *outer* port's answer depend on the inner offset (the fixed-point case). */
const INNER_HEIGHT = 260;
/** Focusable buttons inside the inner port (12 × 30px pitch = 360 > 260, so it scrolls). */
const INNER_BUTTONS = 12;
const STEP = 120;
const PAGE_WIDTH = 980;
const PAGE_PADDING = 16;
const BODY_GAP = 12;
const LEFT_WIDTH = 604;
const SIDE_WIDTH = PAGE_WIDTH - 2 * PAGE_PADDING - LEFT_WIDTH - BODY_GAP;

function createRows(count: number): ScrollRow[] {
  const rows: ScrollRow[] = [];
  for (let index = 0; index < count; index++) {
    rows.push({
      id: `r${String(index).padStart(3, '0')}`,
      name: `Row ${String(index).padStart(3, '0')}`,
      score: ((index * 7919) % 500) + 25 * (index % 4),
    });
  }
  return rows;
}

export class ScrollScene extends Phaser.Scene {
  // ------------------------------------------------------------------ view model

  private readonly rows = ref<ScrollRow[]>(createRows(LIST_ROWS));
  private readonly deleted = ref(0);
  private readonly vOffset = ref(0);
  private readonly vMax = ref(0);
  private readonly vRendered = ref(0);
  private readonly hOffset = ref(0);
  private readonly hMax = ref(0);
  private readonly nestedOffset = ref(0);
  private readonly nestedMax = ref(0);
  /** Last chip activated in the horizontal strip (`CHIP_COUNT` chips, all in one port). */
  private readonly selectedChip = ref(-1);

  private pageContext: BindingContext | null = null;

  // ------------------------------------------------------------------ scene state

  private vScroll: ScrollView | null = null;
  private hScroll: ScrollView | null = null;
  private nestedScroll: ScrollView | null = null;
  private innerScroll: ScrollView | null = null;
  private repeat: Repeat<ScrollRow> | null = null;
  private readonly reported = new Map<string, string>();

  constructor() {
    super('scroll');
  }

  create(): void {
    const theme = this.mvvm.theme;
    const scene = this;
    this.reported.clear();

    // The page scope exposes the live scroll numbers to the readout labels through templates.
    this.pageContext = new BindingContext({
      get v(): number {
        return scene.vOffset.value;
      },
      get vMax(): number {
        return scene.vMax.value;
      },
      get rows(): number {
        return scene.vRendered.value;
      },
      get h(): number {
        return scene.hOffset.value;
      },
      get hMax(): number {
        return scene.hMax.value;
      },
      get nested(): number {
        return scene.nestedOffset.value;
      },
      get nestedMax(): number {
        return scene.nestedMax.value;
      },
      get deleted(): number {
        return scene.deleted.value;
      },
    });

    // 1. Vertical: a virtualised list inside the scroll view --------------------------------------
    const repeat = this.add.uiRepeat<ScrollRow>({
      items: () => this.rows.value,
      key: (row) => row.id,
      template: (row, index, context) => this.createRow(row, index, context),
      container: { direction: 'vertical', gap: ROW_GAP },
      virtualize: true,
      itemExtent: ROW_EXTENT,
      overscan: 3,
      height: 'fill',
      name: 'scroll.repeat',
    });
    this.repeat = repeat;

    const listContent = this.add.uiPanel(
      { direction: 'vertical', width: 'fill', height: 'fill', variant: 'plain' },
      [repeat],
    );
    const vScroll = this.add.uiScroll({
      width: 'fill',
      height: 'fill',
      direction: 'vertical',
      scrollbar: 'auto',
      content: listContent,
      name: 'scroll.v',
    });
    this.vScroll = vScroll;

    const vPanel = this.add.uiPanel(
      {
        direction: 'vertical',
        padding: 8,
        width: LEFT_WIDTH,
        height: 372,
        variant: 'surface',
        radius: 10,
      },
      [vScroll],
    );

    const vUp = this.add.uiButton({
      text: 'Scroll up',
      variant: 'secondary',
      size: 'sm',
      name: 'vup',
      onClick: () => vScroll.scrollBy(0, -STEP),
    });
    const vDown = this.add.uiButton({
      text: 'Scroll down',
      variant: 'secondary',
      size: 'sm',
      name: 'vdown',
      onClick: () => vScroll.scrollBy(0, STEP),
    });
    const vBottom = this.add.uiButton({
      text: 'To end',
      variant: 'secondary',
      size: 'sm',
      name: 'vbottom',
      onClick: () => vScroll.scrollTo('bottom'),
    });
    const vRows = this.add.uiLabel({ text: '', tone: 'muted' });
    bindTemplateText(vRows, this.pageContext, '{{ rows }} rows mounted');

    const vButtons = this.add.uiPanel(
      { direction: 'horizontal', gap: 8, alignItems: 'center', variant: 'plain' },
      [vUp, vDown, vBottom, this.add.uiSpacer({ flex: true }), vRows],
    );

    // 2. Horizontal: 30 chips, moved by the scroll view itself ------------------------------------
    const chips: Widget[] = [];
    for (let index = 0; index < CHIP_COUNT; index++) {
      chips.push(
        // Chips are *buttons*, which is what makes the horizontal port's own bring-into-view reachable:
        // `Tab` walks the strip and the port has to scroll sideways to keep up (round 67). They were
        // decorative panels before, so the horizontal axis had no focusable content at all and its
        // reveal path was unreachable — and a drag across a strip of labels also had nothing to
        // accidentally activate, which is the gesture bug this demo is supposed to catch.
        this.add.uiButton({
          text: `chip ${index}`,
          variant: index % 2 === 0 ? 'secondary' : 'primary',
          size: 'sm',
          width: CHIP_WIDTH,
          height: 56,
          name: `chip.${index}`,
          // The strip is a secondary region, so it leads the tab order instead of coming after the 220
          // rows — which is also what makes its horizontal bring-into-view reachable in a handful of
          // `Tab` presses rather than a few hundred.
          focusOrder: -1,
          onClick: () => {
            this.selectedChip.value = index;
          },
        }),
      );
    }
    const chipRow = this.add.uiPanel(
      { direction: 'horizontal', gap: CHIP_GAP, alignItems: 'center', variant: 'plain' },
      chips,
    );
    const hScroll = this.add.uiScroll({
      width: 'fill',
      height: 76,
      direction: 'horizontal',
      content: chipRow,
      // A wider breathing space than the default 8: the option is per port, and this is the port that
      // proves it (`#demo-state`'s `h.offset` steps by 104+16 instead of 104+8 when `Tab` walks the
      // chips past the right edge).
      revealMargin: 24,
      name: 'scroll.h',
    });
    this.hScroll = hScroll;

    const hPanel = this.add.uiPanel(
      {
        direction: 'vertical',
        padding: 8,
        width: LEFT_WIDTH,
        height: 92,
        variant: 'surface',
        radius: 10,
      },
      [hScroll],
    );

    const hLeft = this.add.uiButton({
      text: 'Left',
      variant: 'secondary',
      size: 'sm',
      name: 'hleft',
      onClick: () => hScroll.scrollBy(-200, 0),
    });
    const hRight = this.add.uiButton({
      text: 'Right',
      variant: 'secondary',
      size: 'sm',
      name: 'hright',
      onClick: () => hScroll.scrollBy(200, 0),
    });
    const hButtons = this.add.uiPanel(
      { direction: 'horizontal', gap: 8, alignItems: 'center', variant: 'plain' },
      [
        hLeft,
        hRight,
        this.add.uiSpacer({ flex: true }),
        this.add.uiLabel({ text: `${CHIP_COUNT} chips · horizontal`, tone: 'muted' }),
      ],
    );

    const left = this.add.uiPanel(
      { direction: 'vertical', gap: 10, width: LEFT_WIDTH, variant: 'plain' },
      [vPanel, vButtons, hPanel, hButtons],
    );

    // 3. Nested: a port inside a port, inside a fixed-size (relayout boundary) panel ---------------
    //
    // The inner port has **focusable** content on purpose. Two things only exist once a port is inside
    // another port and something inside it can take focus:
    //   * the bring-into-view walk has to converge through two levels (the inner port scrolls, which
    //     changes where the target sits inside the outer one), and
    //   * the outer port carries pinch zoom, so the reveal has to work in a *scaled* port — the case
    //     `revealOffset` handles by multiplying the content rect by `zoomScale` and which had no
    //     end-to-end coverage before (see `ACCEPTANCE-scroll.md`).
    const innerButtons: Widget[] = [];
    for (let index = 0; index < INNER_BUTTONS; index += 1) {
      innerButtons.push(
        this.add.uiButton({
          text: `inner b${index}`,
          variant: index % 3 === 0 ? 'primary' : 'secondary',
          size: 'sm',
          width: 'fill',
          height: 26,
          name: `inner.b${index}`,
          // Same reason as the chip strip: without a hint these 12 buttons sit *after* the 220 rows in
          // the tab order, which makes the port-inside-a-port case (and its acceptance walk) reachable
          // only after a few hundred presses.
          focusOrder: -1,
        }),
      );
    }
    const innerContent = this.add.uiPanel(
      { direction: 'vertical', gap: 4, width: 'fill', variant: 'plain' },
      innerButtons,
    );
    const innerScroll = this.add.uiScroll({
      width: 'fill',
      height: INNER_HEIGHT,
      direction: 'vertical',
      content: innerContent,
      focusOrder: -1,
      name: 'scroll.inner',
    });
    this.innerScroll = innerScroll;

    const nestedContent = this.add.uiPanel(
      { direction: 'vertical', gap: 4, width: 'fill', variant: 'plain' },
      [
        ...Array.from({ length: NESTED_LEAD }, (_unused, index) =>
          this.add.uiLabel({
            text: `nested line ${String(index).padStart(2, '0')}`,
            height: 28,
            tone: index % 5 === 0 ? 'primary' : 'default',
          }),
        ),
        innerScroll,
        ...Array.from({ length: NESTED_TAIL }, (_unused, index) =>
          this.add.uiLabel({
            text: `nested tail ${String(index).padStart(2, '0')}`,
            height: 28,
            tone: 'muted',
          }),
        ),
      ],
    );
    const nestedScroll = this.add.uiScroll({
      width: 'fill',
      height: 'fill',
      direction: 'vertical',
      content: nestedContent,
      // Pinch zoom on the nested view (mouse users can call `scrollDemo.setZoom(scale)`), so the
      // gesture has a home in the demos and `zoom.scale` is published for the acceptance run.
      zoom: { min: 0.5, max: 2.5 },
      name: 'scroll.nested',
    });
    this.nestedScroll = nestedScroll;

    const nestedPanel = this.add.uiPanel(
      {
        direction: 'vertical',
        padding: 10,
        width: SIDE_WIDTH,
        height: 320,
        variant: 'surfaceAlt',
        radius: 10,
      },
      [nestedScroll],
    );

    const nUp = this.add.uiButton({
      text: 'Nested up',
      variant: 'secondary',
      size: 'sm',
      name: 'nup',
      onClick: () => nestedScroll.scrollBy(0, -STEP),
    });
    const nDown = this.add.uiButton({
      text: 'Nested down',
      variant: 'secondary',
      size: 'sm',
      name: 'ndown',
      onClick: () => nestedScroll.scrollBy(0, STEP),
    });
    const nButtons = this.add.uiPanel(
      { direction: 'horizontal', gap: 8, alignItems: 'center', variant: 'plain' },
      [nUp, nDown],
    );

    const readout = this.add.uiGrid(
      { columns: 2, columnGap: 10, rowGap: 6, width: 'fill', alignItems: 'center' },
      [
        this.add.uiLabel({ text: 'vertical', tone: 'muted' }),
        this.statLabel('{{ v }} / {{ vMax }}'),
        this.add.uiLabel({ text: 'rows', tone: 'muted' }),
        this.statLabel('{{ rows }} mounted'),
        this.add.uiLabel({ text: 'horizontal', tone: 'muted' }),
        this.statLabel('{{ h }} / {{ hMax }}'),
        this.add.uiLabel({ text: 'nested', tone: 'muted' }),
        this.statLabel('{{ nested }} / {{ nestedMax }}'),
        this.add.uiLabel({ text: 'deleted', tone: 'muted' }),
        this.statLabel('{{ deleted }}'),
      ],
    );

    const side = this.add.uiPanel(
      { direction: 'vertical', gap: 10, width: SIDE_WIDTH, variant: 'plain' },
      [
        this.add.uiLabel({
          text: 'M7 · scroll & clip',
          style: { fontSize: `${theme.fontSize.lg}px` },
        }),
        nestedPanel,
        nButtons,
        this.add.uiDivider({}),
        readout,
      ],
    );

    const body = this.add.uiPanel(
      {
        direction: 'horizontal',
        gap: BODY_GAP,
        alignItems: 'start',
        width: 'fill',
        variant: 'plain',
      },
      [left, side],
    );

    const header = this.add.uiPanel(
      { direction: 'horizontal', gap: 8, alignItems: 'center', width: 'fill', variant: 'plain' },
      [
        this.add.uiLabel({
          text: 'Wheel, drag or the buttons — the clip keeps the content inside the frame',
        }),
        this.add.uiSpacer({ flex: true }),
        this.add.uiLabel({ text: `${LIST_ROWS} rows · virtualised`, tone: 'muted' }),
      ],
    );

    const page = this.add.uiPanel(
      {
        direction: 'vertical',
        gap: 12,
        padding: PAGE_PADDING,
        width: PAGE_WIDTH,
        variant: 'plain',
        alignItems: 'stretch',
      },
      [header, body],
    );

    this.mvvm.mount(page);

    for (const [key, widget] of [
      ['vup', vUp],
      ['vdown', vDown],
      ['vbottom', vBottom],
      ['hleft', hLeft],
      ['hright', hRight],
      ['nup', nUp],
      ['ndown', nDown],
    ] as const) {
      reportControl(this, key, widget);
    }
    this.mvvm.focus.onFocusChange = (widget) => {
      setDemoState('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    appendStatus('--- scroll layout ---');
    reportWidget('v', vPanel);
    reportWidget('h', hPanel);
    reportWidget('nested', nestedPanel);
    reportWidget('page', page);
    reportCanvas(this.game);

    setDemoState('scene', 'scroll');
    this.publishState();

    (window as unknown as { scrollDemo?: unknown }).scrollDemo = {
      offsets: () => ({
        v: this.vScroll?.offset ?? 0,
        vMax: this.vScroll?.maxOffset ?? 0,
        vRows: this.repeat?.renderedCount ?? 0,
        h: this.hScroll?.offset ?? 0,
        hMax: this.hScroll?.maxOffset ?? 0,
        nested: this.nestedScroll?.offset ?? 0,
        nestedMax: this.nestedScroll?.maxOffset ?? 0,
        inner: this.innerScroll?.offset ?? 0,
        innerMax: this.innerScroll?.maxOffset ?? 0,
        deleted: this.deleted.value,
      }),
      visibleRowKey: (): string | null => this.visibleRowKey(),
      /**
       * Drag/scrollbar ownership of the vertical port, or `null` when it is free.
       *
       * A view that keeps an owner while nothing is pressed refuses every later press (the ownership
       * guard in `onPointerDown`), which is V24: a single click inside the port used to disable
       * dragging it permanently. Publishing the owner makes that state assertable instead of a mystery.
       */
      owners: (): { drag: number | null; bar: number | null } => ({
        drag: (this.vScroll as unknown as { dragPointerId: number | null })?.dragPointerId ?? null,
        bar: (this.vScroll as unknown as { barPointerId: number | null })?.barPointerId ?? null,
      }),
      /** Scale of the nested view's pinch zoom (1 = natural size). */
      zoom: (): number => Math.round((this.nestedScroll?.zoom ?? 1) * 100) / 100,
      setZoom: (scale: number): number => {
        this.nestedScroll?.setZoom(scale);
        return this.nestedScroll?.zoom ?? 1;
      },
      viewports: () => ({
        v: this.viewportInfo(this.vScroll),
        h: this.viewportInfo(this.hScroll),
        nested: this.viewportInfo(this.nestedScroll),
        inner: this.viewportInfo(this.innerScroll),
      }),
    };
  }

  /** Viewport size *and* stage origin, so a check can aim a gesture at the middle of a view. */
  private viewportInfo(view: ScrollView | null): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const size = view?.viewport ?? { width: 0, height: 0 };
    if (!view) {
      return { x: 0, y: 0, ...size };
    }
    const origin = stagePosition(view);
    return { x: origin.x, y: origin.y, ...size };
  }

  /** Publishes the scroll numbers once per frame (only what changed). */
  override update(): void {
    this.publishState();
  }

  private createRow(row: ScrollRow, index: number, context: BindingContext): Widget {
    const view = this.add.uiPanel({
      direction: 'horizontal',
      gap: 6,
      padding: { left: 10, right: 6, top: 0, bottom: 0 },
      alignItems: 'center',
      height: ROW_HEIGHT,
      variant: index % 2 === 0 ? 'surfaceAlt' : 'surface',
      radius: 6,
      blockPointer: false,
      name: `row.${row.id}`,
    });

    const name = view.addWidget(this.add.uiLabel({ width: 240, height: 20 }));
    bindTemplateText(name, context, '#{{ $index }} · {{ $item.name }}');

    const score = view.addWidget(
      this.add.uiLabel({ width: 90, height: 20, tone: 'muted', align: 'right' }),
    );
    bindTemplateText(score, context, '{{ $item.score }} pts');

    view.addWidget(
      this.add.uiButton({
        text: 'Delete',
        variant: 'danger',
        size: 'sm',
        width: 74,
        height: 24,
        name: `row.delete.${row.id}`,
        onClick: () => this.deleteRow(row.id),
      }),
    );
    return view;
  }

  private statLabel(template: string): Label {
    const label = this.add.uiLabel({ text: '', width: 140 });
    bindTemplate(label, this.pageContext as BindingContext, template, (text, widget) => {
      (widget as Label).setText(text);
    });
    return label;
  }

  private deleteRow(id: string): void {
    const rows = this.rows.value;
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) {
      return;
    }
    rows.splice(index, 1);
    this.deleted.value += 1;
    this.publishState();
  }

  private publishState(): void {
    const vScroll = this.vScroll;
    const hScroll = this.hScroll;
    const nested = this.nestedScroll;
    const inner = this.innerScroll;
    if (!vScroll || !hScroll || !nested || !inner) {
      return;
    }
    const rendered = this.repeat?.renderedCount ?? 0;
    if (this.vOffset.value !== vScroll.offset) this.vOffset.value = vScroll.offset;
    if (this.vMax.value !== vScroll.maxOffset) this.vMax.value = vScroll.maxOffset;
    if (this.vRendered.value !== rendered) this.vRendered.value = rendered;
    if (this.hOffset.value !== hScroll.offset) this.hOffset.value = hScroll.offset;
    if (this.hMax.value !== hScroll.maxOffset) this.hMax.value = hScroll.maxOffset;
    if (this.nestedOffset.value !== nested.offset) this.nestedOffset.value = nested.offset;
    if (this.nestedMax.value !== nested.maxOffset) this.nestedMax.value = nested.maxOffset;

    this.publish('v.offset', Math.round(vScroll.offset));
    this.publish('v.maxOffset', Math.round(vScroll.maxOffset));
    this.publish('v.rows', rendered);
    this.publish('v.deleted', this.deleted.value);
    // Drag ownership must be `none` whenever nothing is pressed (see `scrollDemo.owners()`).
    const owners = {
      drag: (vScroll as unknown as { dragPointerId: number | null }).dragPointerId,
      bar: (vScroll as unknown as { barPointerId: number | null }).barPointerId,
    };
    this.publish(
      'v.owner',
      owners.drag === null || owners.drag === undefined ? 'none' : owners.drag,
    );
    this.publish(
      'v.barOwner',
      owners.bar === null || owners.bar === undefined ? 'none' : owners.bar,
    );
    this.publish('h.offset', Math.round(hScroll.offset));
    this.publish('h.maxOffset', Math.round(hScroll.maxOffset));
    this.publish('chip', this.selectedChip.value < 0 ? 'none' : this.selectedChip.value);
    this.publish('nested.offset', Math.round(nested.offset));
    this.publish('nested.zoom', Math.round(nested.zoom * 100) / 100);
    this.publish('nested.maxOffset', Math.round(nested.maxOffset));
    this.publish('inner.offset', Math.round(inner.offset));
    this.publish('inner.maxOffset', Math.round(inner.maxOffset));

    // Where the focused widget *is*, and where each port's visible band is. Two raw numbers instead of
    // a verdict, because the verdict is the point of the acceptance run: "keyboard focus never sits
    // outside the band" is an invariant over a whole Tab walk, and the run that walks it owns the
    // comparison (round 67 added the walk — before it, focus could sit under the clip with the offset
    // still at 0 and nothing in the page said so).
    const focused = this.mvvm.focus.focusedWidget;
    if (focused) {
      const origin = stagePosition(focused);
      this.publish('focus.x', Math.round(origin.x));
      this.publish('focus.y', Math.round(origin.y));
      this.publish('focus.w', Math.round(focused.appliedRect.width));
      this.publish('focus.h', Math.round(focused.appliedRect.height));
      // …and the same rect as the renderer sees it: `stagePosition()` sums container positions and
      // ignores scale, so inside a *zoomed* port it is not where the widget is drawn. The transform
      // matrix is the honest answer (and `getBounds()` is not: for a Container it unions the children's
      // ink, so a Button comes back as its label's box rather than the box the layout assigned).
      const matrix = focused.getWorldTransformMatrix();
      const topLeft = matrix.transformPoint(0, 0);
      const worldWidth = focused.appliedRect.width * matrix.scaleX;
      const worldHeight = focused.appliedRect.height * matrix.scaleY;
      this.publish('focus.wx', Math.round(topLeft.x));
      this.publish('focus.wy', Math.round(topLeft.y));
      this.publish('focus.ww', Math.round(worldWidth));
      this.publish('focus.wh', Math.round(worldHeight));
    }
    this.publishBand('v', vScroll);
    this.publishBand('h', hScroll);
    this.publishBand('nested', nested);
    this.publishBand('inner', inner);

    const point = this.rowDeletePoint();
    if (point) {
      this.publish('pt.vrowdelete', `@${point.x},${point.y}`);
    }
  }

  /** Key of the first row whose centre sits inside the viewport (the first *visible* row). */
  private visibleRowKey(): string | null {
    const repeat = this.repeat;
    const view = this.vScroll;
    if (!repeat || !view) {
      return null;
    }
    const viewport = stagePosition(view);
    const viewportBottom = viewport.y + view.appliedRect.height;
    for (const key of repeat.getRenderedKeys()) {
      const row = repeat.getWidgetForKey(key);
      if (!row) {
        continue;
      }
      const centre = stagePosition(row).y + row.appliedRect.height / 2;
      if (centre >= viewport.y && centre <= viewportBottom) {
        return key;
      }
    }
    return null;
  }

  /**
   * Page coordinates of the *visible* first row's Delete button (refreshed every frame).
   *
   * The first mounted key is not the first visible row: a virtualised list also mounts `overscan`
   * rows above the viewport, and those live outside the clip rectangle, where a click would land on
   * whatever is behind the list. The row whose centre is inside the viewport is used instead.
   */
  private rowDeletePoint(): { x: number; y: number } | null {
    const repeat = this.repeat;
    const view = this.vScroll;
    if (!repeat || !view) {
      return null;
    }
    const viewport = stagePosition(view);
    const viewportBottom = viewport.y + view.appliedRect.height;

    for (const key of repeat.getRenderedKeys()) {
      const row = repeat.getWidgetForKey(key);
      if (!row) {
        continue;
      }
      const rowOrigin = stagePosition(row);
      const centre = rowOrigin.y + row.appliedRect.height / 2;
      if (centre < viewport.y || centre > viewportBottom) {
        continue;
      }
      const button = row.getWidgetChildren().find((child) => child.name.startsWith('row.delete.'));
      if (!button || button.appliedRect.width <= 0) {
        continue;
      }
      const canvas = this.game.canvas.getBoundingClientRect();
      const origin = stagePosition(button);
      return {
        x: Math.round(canvas.left + origin.x + button.appliedRect.width / 2),
        y: Math.round(canvas.top + origin.y + button.appliedRect.height / 2),
      };
    }
    return null;
  }

  /** Publishes one port's visible band in stage coordinates (`<key>.top`/`.left`/`.width`/`.height`). */
  private publishBand(key: string, view: ScrollView): void {
    const origin = stagePosition(view);
    this.publish(`${key}.left`, Math.round(origin.x));
    this.publish(`${key}.top`, Math.round(origin.y));
    this.publish(`${key}.width`, Math.round(view.appliedRect.width));
    this.publish(`${key}.height`, Math.round(view.appliedRect.height));
  }

  private publish(key: string, value: string | number): void {
    const text = String(value);
    if (this.reported.get(key) === text) {
      return;
    }
    this.reported.set(key, text);
    setDemoState(key, value);
  }
}
