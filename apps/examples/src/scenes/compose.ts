/**
 * `#/compose` — the acceptance page for the Compose-style DSL (`@phaser-mvvm/widgets/compose`).
 *
 * Every widget and every layout container in this scene is built with the DSL — nested calls with a
 * trailing content lambda — so the page doubles as proof that the DSL can express the whole public
 * surface. Sections are switched from the left nav and rebuilt on demand, and the same readouts the
 * factory-based `#/showcase` page publishes are available to an automated check:
 *
 * - `#status`: page/nav/stage/section geometry (`reportWidget`) plus the canvas rect;
 * - `#demo-state`: `section`, `widgets`, `clicks`, `toggled`, `name`, `notes`, `email`, `hoisted`,
 *   `rows`, `rows.rendered`, `parity`, `focus`, and one `pt.<key>=@x,y` page point per control;
 * - `window.compose`: `sections()`, `show(id)`, `state()`, `geometry()`.
 *
 * Section `parity` is the interesting one: it builds the *same* card twice — once with the
 * `this.add.ui*` factories, once with the DSL — and compares the resulting geometry node by node, so
 * a DSL regression cannot hide behind "it looks fine".
 */

import Phaser from 'phaser';
import { computed, onDevWarning, ref } from '@phaser-mvvm/core';
import { buildUiSubtree, setTheme, themeListenerCount, type Widget } from '@phaser-mvvm/phaser';
import type {
  BranchWidget,
  PanelOptions,
  PanelVariant,
  Repeat,
  ScrollView,
} from '@phaser-mvvm/widgets';
import {
  Absolute,
  Branch,
  Button,
  Column,
  Divider,
  Grid,
  Image,
  List,
  Panel,
  Rect,
  Slider,
  render,
  Row,
  Scroll,
  Spacer,
  Stack,
  Text,
  TextArea,
  TextField,
  ui,
} from '@phaser-mvvm/widgets/compose';
import { makeAtlasTexture, makeTexture, makeTileTexture, setDemoState } from '../demo';
import { appendStatus, pagePoint, reportCanvas, reportWidget, stagePosition } from '../status';

type SectionId =
  | 'flow'
  | 'text'
  | 'buttons'
  | 'inputs'
  | 'decor'
  | 'box'
  | 'grid'
  | 'stack'
  | 'params'
  | 'list'
  | 'state'
  | 'parity';

interface SectionDef {
  id: SectionId;
  title: string;
  caption: string;
}

const SECTIONS: readonly SectionDef[] = [
  { id: 'flow', title: 'Flow', caption: 'if · for · visible · render()' },
  { id: 'text', title: 'Text', caption: '常量 · ref · getter · 截断' },
  { id: 'buttons', title: 'Button', caption: '变体 · 状态 · 反应式标签' },
  { id: 'inputs', title: 'Text inputs', caption: 'ref 双向 · onValueChange · 校验' },
  { id: 'decor', title: 'Panel & decor', caption: '变体 · 分隔线 · 间距 · 图片' },
  { id: 'box', title: 'Column & Row', caption: 'gap · justify · align · wrap' },
  { id: 'grid', title: 'Grid', caption: 'columns · gaps · span' },
  { id: 'stack', title: 'Stack & Absolute', caption: '重叠 · 对齐 · 角标' },
  { id: 'params', title: 'Layout params', caption: 'width · grow · min/max · alignSelf' },
  { id: 'list', title: 'List', caption: 'keyed · 虚拟化 · 增删' },
  { id: 'state', title: 'State slots', caption: 'disabled · error · variant 由状态驱动' },
  { id: 'parity', title: 'Parity', caption: 'DSL 与工厂 API 几何一致' },
];

const NAV_WIDTH = 236;
const PAGE_MARGIN = 12;
const TILE_TEXTURE = 'compose.tile';
const ICON_TEXTURE = 'compose.icon';
/** The two solid textures the reactive `Image.texture` slot swaps between (round 98). */
const TEXTURE_A = 'compose.slot.a';
const TEXTURE_B = 'compose.slot.b';
/** One atlas with a `red` and a `green` frame, for the reactive `frame` slot. */
const ATLAS_TEXTURE = 'compose.atlas';
/**
 * The paragraph the reactive `maxLines`/`ellipsis` slot collapses.
 *
 * Long enough that two lines have to drop something at the card's width (420 design px) — a "show more"
 * demo whose text already fits proves nothing.
 */
const STATE_PARAGRAPH =
  '这一段文字由 maxLines 与 ellipsis 两个数据槽控制：折叠时只画两行并在结尾补省略号，展开时整段都在。' +
  '两个槽都接受字面量、ref 或 getter，所以“展开 / 收起”是一行状态，而不是重建一棵子树——重建会丢掉' +
  '滚动位置、焦点和选区，而这些恰恰是长文段落里最贵的东西。';

interface SampleRow {
  id: string;
  label: string;
}

/** Cycles a panel flavour, so the reactive `variant` slot has something to follow. */
function nextPanelVariant(current: PanelVariant): PanelVariant {
  const order: readonly PanelVariant[] = ['surface', 'surfaceAlt', 'primary', 'danger', 'plain'];
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] as PanelVariant;
}

function createRows(count: number): SampleRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index + 1}`,
    label: `第 ${index + 1} 行 · DSL 列表`,
  }));
}

export class ComposeScene extends Phaser.Scene {
  // ------------------------------------------------------------------ live view model

  private readonly section = ref<SectionId>('text');
  private readonly clicks = ref(0);
  private readonly toggled = ref(false);
  private readonly counter = ref(0);
  private readonly name = ref('张三');
  private readonly notes = ref('');
  private readonly email = ref('');
  private readonly hoisted = ref('');
  private readonly rows = ref<SampleRow[]>(createRows(200));
  private readonly parity = ref('pending');
  private readonly highlighted = ref(false);
  /** Drives the `hideMode: 'keep'` demo: hidden, but its slot stays. */
  private readonly keepShown = ref(true);
  /** Reactive state slots: `disabled`, `error` and a panel's `variant` all read these. */
  private readonly locked = ref(false);
  private readonly stateError = ref<string | boolean | null>(null);
  private readonly stateVariant = ref<PanelVariant>('surface');
  private readonly stateName = ref('张三');
  private readonly stateVolume = ref(40);
  /** Round 98's slots: `readOnly`, `maxLines`/`ellipsis` and a reactive `Image.texture`. */
  private readonly frozen = ref(false);
  private readonly expanded = ref(false);
  private readonly altTexture = ref(false);
  private readonly stateNote = ref('这段文字可以选中、可以复制，但改不了');
  /** Round 99: the slider's upper bound as state (the A/B pair and the button share it). */
  private readonly rangeMax = ref(100);
  /** Round 100: the atlas frame as state — the second half of the `texture`/`frame` slot pair. */
  private readonly altFrame = ref(false);
  /** The `Scroll` slot of the `list` section: the scroll position as state (two-way). */
  private readonly listOffset = ref(0);
  /** Which branch the `Branch()` demo shows ('a' | 'b' | 'missing'). */
  private readonly branchKey = ref('a');
  private readonly branchClicks = ref(0);

  private readonly emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.value));

  // ------------------------------------------------------------------ scene state

  private page: Widget | null = null;
  private nav: Widget | null = null;
  private stage: ScrollView | null = null;
  private sectionHost: Widget | null = null;
  private listWidget: Repeat<SampleRow> | null = null;
  private scrollWidget: ScrollView | null = null;
  /** The `Branch()` widget of the flow section, rebuilt with the section. */
  private branchWidget: BranchWidget | null = null;

  /** Controls whose page coordinates are republished every frame (`pt.<key>`). */
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  /** Section whose geometry still has to be reported, once the next frame has arranged it. */
  private pendingReport: SectionId | null = null;

  /**
   * Labels reported as `<key>=@x,y wxh` once the Text section is arranged.
   *
   * The boxes are what an ink-vs-box check needs: text is drawn by Phaser into its own canvas, so the
   * only way to see a clipped or overflowing glyph is to compare the rendered ink with the box the
   * layout assigned (rounds 53 and 56 use this).
   */
  private readonly reportTextProbes = new Map<string, Widget>();
  /** Rects the pixel gate samples for the reactive-slot section (`state.panel` & co). */
  private readonly reportStateProbes = new Map<string, Widget>();

  constructor() {
    super('compose');
  }

  create(): void {
    makeTileTexture(this, TILE_TEXTURE);
    // Two flat textures for the reactive `texture` slot: literals, so the pixel gate reads the swap
    // itself rather than a theme token (the light half of the matrix must show the same colours).
    makeTexture(this, TEXTURE_A, 44, 44, (graphics) => {
      graphics.fillStyle(0x2f6feb, 1);
      graphics.fillRect(0, 0, 44, 44);
    });
    makeTexture(this, TEXTURE_B, 44, 44, (graphics) => {
      graphics.fillStyle(0x3fb950, 1);
      graphics.fillRect(0, 0, 44, 44);
    });
    // A two-frame atlas for the reactive `frame` slot: one texture, two flat frames, so a check can
    // tell "the frame changed" from "the texture changed" (round 100 closes the gap left by round 98,
    // where only the `texture` half of the pair was exercised).
    makeAtlasTexture(this, ATLAS_TEXTURE, { red: 0xf85149, green: 0x3fb950 });
    // A control-sized icon, on purpose: an icon that already fits its button is left exactly as it is
    // (`Button` caps a too-large one, `#/showcase`'s icon card shows that half).
    makeTexture(this, ICON_TEXTURE, 16, 16, (graphics) => {
      graphics.fillStyle(0x2f6feb, 1);
      graphics.fillCircle(8, 8, 7);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(8, 8, 3);
    });

    const page = render(this.mvvm, () => {
      Panel(
        {
          direction: 'horizontal',
          gap: PAGE_MARGIN,
          padding: PAGE_MARGIN,
          variant: 'plain',
          width: 'fill',
          height: 'fill',
          alignItems: 'stretch',
        },
        () => {
          this.nav = Panel(
            {
              direction: 'vertical',
              gap: 6,
              padding: 12,
              variant: 'surface',
              radius: 10,
              width: NAV_WIDTH,
              alignItems: 'stretch',
              name: 'nav',
            },
            () => {
              this.navItems();
            },
          );

          this.stage = Scroll(
            { direction: 'vertical', width: 'fill', height: 'fill', name: 'stage' },
            () => {
              this.sectionHost = Column({ gap: 12, width: 'fill', name: 'sections' });
            },
          );
        },
      );
    });

    this.page = page;

    this.mvvm.focus.onFocusChange = (widget) => {
      this.publish('focus', widget ? widget.name || 'unnamed' : 'none');
    };

    this.showSection('text');
    this.publish('scene', 'compose');
    this.exposeGlobals();
  }

  override update(): void {
    this.publishControls();
    this.publishBranch();
    this.publish('state.locked', this.locked.value);
    this.publish(
      'state.error',
      this.stateError.value === null ? 'none' : String(this.stateError.value),
    );
    this.publish('state.variant', this.stateVariant.value);
    this.publish('state.volume', Math.round(this.stateVolume.value));
    // The round-98 slots. `state.lines`/`state.ellipsis`/`state.truncated` come from the painted text,
    // so a `maxLines` slot that fires but never repaints shows up as "painted lines still 2".
    if (this.section.value === 'state') {
      const slots = this.slotReadings();
      this.publish('state.expanded', slots.expanded);
      this.publish('state.lines', slots.paintedLines);
      this.publish('state.truncated', slots.truncated === true);
      this.publish('state.ellipsis', slots.ellipsis);
      this.publish('state.texture', slots.texture);
      this.publish('state.frozen', slots.frozen === true);
      this.publish('state.rangeMax', slots.rangeMax);
      this.publish('state.rangeBMax', slots.rangeBMax);
      this.publish('state.rangeBValue', slots.rangeBValue);
      this.publish('state.frameAlt', slots.frameAlt);
    }
    this.publish('rows', this.rows.value.length);
    if (this.listWidget) {
      this.publish('rows.rendered', this.listWidget.renderedCount);
      this.publish('rows.total', this.listWidget.totalCount);
    }
    if (this.scrollWidget) {
      // Two readings of the same thing: the widget's own offset and the `ref` the slot writes. A check
      // compares them, so "the state followed the view" is a fact rather than an assumption.
      this.publish('list.offset', Math.round(this.scrollWidget.offset));
      this.publish('list.offsetState', Math.round(this.listOffset.value));
      this.publish('list.maxOffset', Math.round(this.scrollWidget.maxOffset));
    }
    // The geometry is reported here rather than at click time: a freshly added section is only
    // arranged by the plugin's PRE_UPDATE flush, so reading `appliedRect` right after `addWidget()`
    // would publish the *previous* section's rect (or a zero one).
    const pending = this.pendingReport;
    if (pending) {
      this.pendingReport = null;
      this.publish('widgets', countWidgets(this.sectionHost));
      this.reportSection(pending);
      if (pending === 'text') {
        for (const [key, widget] of this.reportTextProbes) {
          reportWidget(key, widget);
        }
      }
      if (pending === 'state') {
        for (const [key, widget] of this.reportStateProbes) {
          reportWidget(key, widget);
        }
      }
    }
  }

  // ------------------------------------------------------------------ navigation

  /**
   * The nav's content, as composables.
   *
   * It runs inside the nav panel's content lambda on the first build and inside a fresh `ui()` scope
   * on every rebuild, which is the same trick the rest of the scene uses for dynamic content: build
   * a subtree where you need it, then attach it with `addWidget`.
   */
  private navItems(): void {
    Column({ gap: 6, width: 'fill', alignItems: 'stretch' }, () => {
      Text('Compose DSL', { tone: 'muted' });
      Text('每个控件／布局一个演示', { maxLines: 2, width: NAV_WIDTH - 24 });
      Divider({});
      for (const def of SECTIONS) {
        const active = this.section.value === def.id;
        this.track(
          `nav.${def.id}`,
          Button(def.title, {
            variant: active ? 'primary' : 'ghost',
            size: 'sm',
            name: `nav.${def.id}`,
            width: 'fill',
            onClick: () => this.showSection(def.id),
          }),
        );
      }
      Divider({});
      this.track(
        'nav.theme',
        Button('切换主题', {
          variant: 'secondary',
          size: 'sm',
          name: 'nav.theme',
          width: 'fill',
          onClick: () => {
            setTheme(this.mvvm.theme.name === 'dark' ? 'light' : 'dark');
            this.publish('theme', this.mvvm.theme.name);
          },
        }),
      );
    });
  }

  private showSection(id: SectionId): void {
    this.section.value = id;
    const host = this.sectionHost;
    if (!host) {
      return;
    }
    host.removeAllWidgets(true);
    this.clearTracked('section.');
    this.listWidget = null;
    this.scrollWidget = null;

    const built = ui(this, () => this.buildSection(id));
    host.addWidget(built);
    this.track(`section.${id}`, built);

    this.rebuildNav();
    this.stage?.setScrollOffset(0);
    this.publish('section', id);
    this.publish('reactive.tone', 'n/a');
    this.pendingReport = id;
  }

  private rebuildNav(): void {
    const nav = this.nav;
    if (!nav) {
      return;
    }
    nav.removeAllWidgets(true);
    this.clearTracked('nav.');
    nav.addWidget(ui(this, () => this.navItems()));
  }

  private reportSection(id: SectionId): void {
    appendStatus(`--- compose · ${id} ---`);
    if (this.nav) {
      reportWidget('nav', this.nav);
    }
    if (this.stage) {
      reportWidget('stage', this.stage);
    }
    if (this.sectionHost) {
      reportWidget('section', this.sectionHost);
    }
    reportCanvas(this.game);
  }

  // ------------------------------------------------------------------ sections

  private buildSection(id: SectionId): void {
    switch (id) {
      case 'flow':
        this.buildFlow();
        break;
      case 'text':
        this.buildText();
        break;
      case 'buttons':
        this.buildButtons();
        break;
      case 'inputs':
        this.buildInputs();
        break;
      case 'decor':
        this.buildDecor();
        break;
      case 'box':
        this.buildBox();
        break;
      case 'grid':
        this.buildGrid();
        break;
      case 'stack':
        this.buildStack();
        break;
      case 'params':
        this.buildParams();
        break;
      case 'list':
        this.buildList();
        break;
      case 'state':
        this.buildState();
        break;
      case 'parity':
        this.buildParity();
        break;
      default:
        break;
    }
  }

  /** A titled card — the shape every section is built from. */
  private card(title: string, caption: string, content: () => void): void {
    Panel(
      { variant: 'surface', radius: 10, padding: 14, gap: 8, width: 'fill', alignItems: 'stretch' },
      () => {
        Text(title, { size: 'lg' });
        Text(caption, { tone: 'muted', maxLines: 2 });
        Divider({});
        content();
      },
    );
  }

  /**
   * Control flow, written the way Compose writes it — except that here it is just TypeScript.
   *
   * Building a view is synchronous, so a plain `if`/`for`/`switch` inside a content lambda composes
   * statically: the branch that runs is the branch that exists. A *reactive* condition uses the
   * `visible` slot instead, which collapses the node without rebuilding the subtree.
   */
  private buildFlow(): void {
    this.card('Flow', 'if / for 直接写；反应式条件用 visible；页面用 render() 一次挂载', () => {
      // Static condition: the tree is built once, so `if` decides what exists.
      if (this.rows.value.length > 0) {
        Text('这一行只在列表非空时被创建（静态 if）', { tone: 'muted' });
      }

      // Static loop: each iteration emits one node, exactly like Compose's `for`.
      Row({ gap: 6, wrap: true, alignItems: 'center' }, () => {
        for (const label of ['for', 'each', '自己', '写', '循环']) {
          Panel(
            {
              variant: 'surfaceAlt',
              radius: 6,
              padding: { top: 4, bottom: 4, left: 8, right: 8 },
            },
            () => {
              Text(label, { tone: 'muted' });
            },
          );
        }
      });

      // Reactive condition: `visible` takes the node out of the flow when it flips.
      Row({ gap: 8, alignItems: 'center' }, () => {
        this.track(
          'flow.toggle',
          Button(() => (this.highlighted.value ? '隐藏通知' : '显示通知'), {
            size: 'sm',
            name: 'flow.toggle',
            onClick: () => (this.highlighted.value = !this.highlighted.value),
          }),
        );
        Text('通知：布局已更新', {
          visible: () => this.highlighted.value,
          tone: 'success',
          name: 'flow.notice',
        });
        // Tracked so a check can see this divider move when the notice above collapses.
        this.track('flow.after', Divider({ name: 'flow.after' }));
      });

      // The same condition, but with `hideMode: 'keep'`: the hidden node keeps its slot, so the
      // sibling after it must not move (CSS `visibility: hidden`, not `display: none`).
      Row({ gap: 8, alignItems: 'center' }, () => {
        this.track(
          'flow.keepToggle',
          Button(() => (this.keepShown.value ? '隐藏占位块' : '显示占位块'), {
            size: 'sm',
            name: 'flow.keepToggle',
            onClick: () => (this.keepShown.value = !this.keepShown.value),
          }),
        );
        Text('前', { tone: 'muted' });
        Panel(
          {
            width: 56,
            height: 18,
            variant: 'primary',
            radius: 4,
            visible: () => this.keepShown.value,
            hideMode: 'keep',
            name: 'flow.keepSlot',
          },
          () => {
            // the kept block itself draws nothing
          },
        );
        this.track('flow.afterKeep', Text('后（位置不应变化）', { tone: 'muted' }));
      });

      // Switch on state at *build* time: the branch that runs is the branch that exists, and the
      // other one is never constructed. Good for "this page is built one way or the other"; for a
      // switch that has to happen *while the page is alive*, see `Branch()` below.
      switch (this.section.value) {
        case 'flow':
          Text('当前就是 Flow 分区（build 期的 switch 也照常写）', { tone: 'muted' });
          break;
        default:
          Text('其他分区', { tone: 'muted' });
          break;
      }

      this.card(
        'Branch · 结构切换',
        'key 一变就销毁旧分支、建新分支（不是改 visible）；未知 key 清空并警告，不崩',
        () => {
          this.buildBranchDemo();
        },
      );
    });
  }

  /**
   * The `Branch()` demo: three keys, two of which have a branch.
   *
   * The interesting one is `missing`: it selects a key the map does not have, which must clear the
   * branch and print one warning rather than call `Object.prototype.constructor` (see
   * `branch-plan.ts`).
   */
  private buildBranchDemo(): void {
    Row({ gap: 8, alignItems: 'center', wrap: true }, () => {
      for (const [key, label] of [
        ['a', '分支 A'],
        ['b', '分支 B'],
        ['multi', '三个根'],
        ['missing', '未知 key'],
      ] as const) {
        this.track(
          `branch.${key}`,
          Button(label, {
            variant: this.branchKey.value === key ? 'primary' : 'secondary',
            size: 'sm',
            name: `branch.${key}`,
            onClick: () => {
              this.branchKey.value = key;
            },
          }),
        );
      }
      this.track(
        'branch.after',
        Text(() => `branch=${this.branchKey.value}`, { tone: 'muted', name: 'branch.after' }),
      );
    });

    this.branchWidget = Branch(
      () => this.branchKey.value,
      {
        // Structurally different on purpose: different container, different widget count, and one
        // child of each that is *tracked* so `st.branch.a.inner=gone` proves the old branch died.
        a: () => {
          Panel(
            { direction: 'vertical', gap: 6, padding: 10, variant: 'surfaceAlt', radius: 8 },
            () => {
              this.track(
                'branch.a.inner',
                Button(() => `分支 A 的按钮 · ${this.branchClicks.value}`, {
                  variant: 'primary',
                  size: 'sm',
                  name: 'branch.a.inner',
                  onClick: () => {
                    this.branchClicks.value += 1;
                  },
                }),
              );
              Text('分支 A 只有一个按钮。', { tone: 'muted', name: 'branch.a.note' });
            },
          );
        },
        b: () => {
          // One root, like a page: a grid of tiles plus a field inside a panel.
          Panel(
            { direction: 'vertical', gap: 8, padding: 10, variant: 'surfaceAlt', radius: 8 },
            () => {
              Grid({ columns: 4, columnGap: 6, rowGap: 6, width: 'fill' }, () => {
                for (let index = 0; index < 4; index += 1) {
                  Rect({
                    height: 24,
                    color: this.mvvm.theme.colors.primary,
                    name: `branch.b.tile${index}`,
                  });
                }
              });
              this.track(
                'branch.b.inner',
                TextField({ placeholder: '分支 B 里的输入框', width: 240, name: 'branch.b.inner' }),
              );
            },
          );
        },
        // Three roots on purpose: `Branch` uses the same entry rule as a page, so they are wrapped in
        // a vertical container with one development warning instead of being rejected.
        multi: () => {
          Text('第一个根', { name: 'branch.multi.one' });
          Divider({});
          Text('第三个根', { tone: 'muted', name: 'branch.multi.three' });
        },
      },
      { name: 'branch' },
    );
  }

  private buildText(): void {
    this.card('Text', '常量、ref、getter、色调、对齐与行数截断', () => {
      Text('常量文本：这一行没有任何绑定');
      Text(() => `ref 文本：当前演示 = ${this.section.value}`, { tone: 'muted' });
      Text(() => `getter 文本：counter = ${this.counter.value}`, { tone: 'primary' });
      Text(
        '截断演示：这段文字超过两行时应该在最后一行结尾加上省略号，剩下的内容不会画出来，' +
          '也不会把卡片撑高。',
        // `alignItems: 'stretch'` on the card hands every child the full line width (the layout SPEC
        // lets stretch win over a declared cross length), so the label opts out with alignSelf.
        { maxLines: 2, ellipsis: true, width: 320, alignSelf: 'start' },
      );
      Row({ gap: 12, alignItems: 'center', wrap: true }, () => {
        // Tracked (and reported in `#status`) so a check can measure the rendered ink against the
        // label's own box: the descender of the `g` used to be shaved off by Phaser's text canvas
        // (see `text-padding.ts`).
        const danger = Text('Danger', { tone: 'danger' });
        this.track('text.danger', danger);
        this.reportTextProbes.set('text.danger', danger);
        this.track('text.success', Text('Success', { tone: 'success' }));
        this.track('text.warning', Text('Warning', { tone: 'warning' }));
        Text('居中', { align: 'center', width: 120, tone: 'muted' });
        Text('右对齐', { align: 'right', width: 120, tone: 'muted' });
      });
      // Wrapping and truncation edge cases, reported so a check can measure the ink against the box:
      // a long CJK sentence (worth testing because Chinese has no spaces to break at) and a long
      // unbreakable ASCII token, each inside a narrow 140px box.
      Row({ gap: 12, alignItems: 'start', wrap: true }, () => {
        this.textEdge(
          'textwrap.cjk',
          '这一段中文没有任何空格用来断行所以它必须逐字换行否则就会横着溢出容器',
          {
            width: 140,
            wrap: true,
          },
        );
        this.textEdge('textwrap.word', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
          width: 140,
          wrap: true,
        });
        this.textEdge('textwrap.ellipsis', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
          width: 140,
          wrap: true,
          maxLines: 1,
          ellipsis: true,
        });
      });

      // Reactive appearance: `tone`, `variant` and `visible` are data slots too, so they follow the ref
      // instead of being fixed at build time. `visible: false` collapses the node out of the flow
      // (`inFlow === visible`), which is why the divider below moves up when the label disappears.
      Column({ gap: 6, alignItems: 'start' }, () => {
        Row({ gap: 8, alignItems: 'center' }, () => {
          this.track(
            'reactive.toggle',
            Button(() => (this.highlighted.value ? '关闭高亮' : '开启高亮'), {
              size: 'sm',
              variant: () => (this.highlighted.value ? 'primary' : 'ghost'),
              name: 'reactive.toggle',
              onClick: () => (this.highlighted.value = !this.highlighted.value),
            }),
          );
          Text('这行文字的 tone 随开关变化', {
            tone: () => (this.highlighted.value ? 'success' : 'muted'),
            name: 'reactive.tone',
          });
        });
        Text('开关关闭时我会从布局里消失', {
          visible: () => this.highlighted.value,
          tone: 'danger',
          name: 'reactive.hidden',
        });
        Divider({ name: 'reactive.after' });
      });

      Row({ gap: 8 }, () => {
        Button('counter -1', { size: 'sm', onClick: () => this.counter.value-- });
        this.track(
          'counter.inc',
          Button('counter +1', {
            size: 'sm',
            variant: 'primary',
            name: 'counter.inc',
            onClick: () => this.counter.value++,
          }),
        );
        Text(() => `counter = ${this.counter.value}`, { tone: 'muted' });
      });
    });
  }

  /** One text edge-case probe: tracked, and reported in `#status` for the ink-vs-box check. */
  private textEdge(key: string, value: string, options: Parameters<typeof Text>[1]): void {
    const label = Text(value, { tone: 'muted', ...options });
    this.track(key, label);
    this.reportTextProbes.set(key, label);
  }

  private buildButtons(): void {
    this.card('Button', '变体、尺寸、禁用／加载、开关与反应式标签', () => {
      Row({ gap: 8, wrap: true, alignItems: 'center' }, () => {
        Button('Primary', { variant: 'primary' });
        Button('Secondary', { variant: 'secondary' });
        Button('Ghost', { variant: 'ghost' });
        Button('Danger', { variant: 'danger' });
        Button('sm', { size: 'sm' });
        Button('md', { size: 'md' });
        Button('lg', { size: 'lg' });
        Button('Disabled', { disabled: true });
        Button('Loading', { loading: true });
        Button('带图标', { icon: ICON_TEXTURE, variant: 'secondary', name: 'iconBtn' });
        Button('', { icon: ICON_TEXTURE, variant: 'primary', name: 'iconOnly' });
      });

      Row({ gap: 8, alignItems: 'center' }, () => {
        this.track(
          'clicks',
          Button(() => `点击次数：${this.clicks.value}`, {
            variant: 'primary',
            name: 'clicks',
            onClick: () => this.clicks.value++,
          }),
        );
        const toggle = Button(() => (this.toggled.value ? '开关：开' : '开关：关'), {
          toggle: true,
          value: false,
          name: 'toggle',
        });
        toggle.on('change', (value: boolean) => {
          this.toggled.value = value;
        });
        this.track('toggle', toggle);
        Text(() => (this.toggled.value ? '开关处于打开状态' : '开关处于关闭状态'), {
          tone: 'muted',
        });
      });
    });
  }

  private buildInputs(): void {
    this.card('TextField & TextArea', 'ref 双向绑定、getter + onValueChange、校验与密码', () => {
      Column({ gap: 10, width: 420, alignItems: 'stretch' }, () => {
        this.track(
          'name',
          TextField({
            value: this.name,
            label: '姓名（ref 双向）',
            placeholder: '请输入姓名',
            name: 'name',
            clearable: true,
          }),
        );
        Text(() => `双向绑定读出：${this.name.value || '(空)'}`, { tone: 'muted' });

        this.track(
          'email',
          TextField({
            value: this.email,
            label: '邮箱（失焦校验）',
            placeholder: 'name@example.com',
            name: 'email',
            validate: (value) =>
              value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
                ? '邮箱格式不正确'
                : null,
          }),
        );
        Text(() => (this.emailValid.value ? 'computed：邮箱格式有效' : 'computed：邮箱格式无效'), {
          tone: 'muted',
        });

        TextField({
          value: () => this.hoisted.value,
          label: '单向 getter + onValueChange（转大写）',
          placeholder: '输入会转成大写写进 ref',
          name: 'hoisted',
          onValueChange: (value) => {
            this.hoisted.value = value.toUpperCase();
          },
        });
        Text(() => `hoisted = ${this.hoisted.value || '(空)'}`, { tone: 'muted' });

        Row({ gap: 8, alignItems: 'center' }, () => {
          TextField({ inputType: 'number', value: '', label: '数字', name: 'number', width: 180 });
          TextField({
            inputType: 'password',
            value: 'secret',
            label: '密码',
            name: 'password',
            width: 180,
          });
        });

        this.track(
          'notes',
          TextArea({
            value: this.notes,
            label: '备注（TextArea）',
            placeholder: '多行文本…',
            rows: 3,
            name: 'notes',
            width: 'fill',
          }),
        );
        Text(() => `备注长度：${this.notes.value.length}`, { tone: 'muted' });
      });
    });
  }

  private buildDecor(): void {
    this.card('Panel / Divider / Spacer / Image', '外观变体、圆角、阴影、分隔线与图片适配', () => {
      Row({ gap: 10, wrap: true, alignItems: 'stretch' }, () => {
        for (const variant of [
          'surface',
          'surfaceAlt',
          'overlay',
          'primary',
          'danger',
          'plain',
        ] as const) {
          Panel(
            {
              variant,
              radius: 8,
              padding: 10,
              width: 132,
              height: 64,
              alignItems: 'center',
              justifyContent: 'center',
            },
            () => {
              Text(variant, {
                tone: variant === 'primary' || variant === 'danger' ? 'default' : 'muted',
              });
            },
          );
        }
      });

      Row({ gap: 10, alignItems: 'center', height: 96 }, () => {
        Panel(
          {
            variant: 'surfaceAlt',
            radius: 8,
            padding: 10,
            elevation: 6,
            width: 160,
            height: 64,
            alignItems: 'center',
            justifyContent: 'center',
          },
          () => {
            Text('elevation: 6');
          },
        );
        Divider({ orientation: 'vertical', height: 'fill' });
        Image({ texture: TILE_TEXTURE, fit: 'contain', width: 72, height: 64 });
        Image({ texture: TILE_TEXTURE, fit: 'cover', width: 72, height: 64 });
        Image({ texture: TILE_TEXTURE, fit: 'fill', width: 72, height: 64 });
      });

      Column({ gap: 6, width: 300, alignItems: 'stretch' }, () => {
        Text('Spacer 把这一行两侧推开', { tone: 'muted' });
        Row({ gap: 6, alignItems: 'center', width: 'fill' }, () => {
          Text('左');
          Spacer({ flex: true });
          Text('右');
        });
        Divider({});
        Row({ gap: 6, alignItems: 'center', width: 'fill' }, () => {
          Text('固定间距', { tone: 'muted' });
          Spacer({ width: 24 });
          Text('Spacer({ width: 24 })');
        });
      });
    });
  }

  private buildBox(): void {
    this.card('Column & Row', 'gap、justifyContent、alignItems、wrap 与嵌套', () => {
      Column({ gap: 10, width: 'fill', alignItems: 'stretch' }, () => {
        // Every member of the `justifyContent` union, so "the value the engine implements" and "the
        // value a demo shows" cannot drift apart (`space-evenly` was missing until round 95).
        for (const justify of [
          'start',
          'center',
          'end',
          'space-between',
          'space-around',
          'space-evenly',
        ] as const) {
          Row({ gap: 6, justifyContent: justify, width: 'fill', height: 42 }, () => {
            Text(`${justify}`, { width: 120, tone: 'muted' });
            tile('A');
            tile('B');
            tile('C');
          });
        }
        Row({ gap: 6, alignItems: 'center', width: 'fill', height: 72 }, () => {
          Text('alignItems: center', { width: 140, tone: 'muted' });
          tile('32', { height: 32 });
          tile('44', { height: 44 });
          tile('56', { height: 56 });
        });
        Row({ gap: 6, wrap: true, width: 420, alignItems: 'center' }, () => {
          Text('wrap: true', { width: 84, tone: 'muted' });
          for (let index = 0; index < 9; index += 1) {
            tile(`#${index + 1}`, { width: 52 });
          }
        });
      });
    });
  }

  private buildGrid(): void {
    this.card('Grid', '固定列、自动列、行列间距与跨列', () => {
      Text('columns: 3', { tone: 'muted' });
      Grid({ columns: 3, columnGap: 10, rowGap: 10, justifyItems: 'stretch' }, () => {
        for (let index = 0; index < 6; index += 1) {
          tile(`cell ${index + 1}`, { height: 48, width: 'fill' });
        }
      });

      Text("columns: 'auto' + minColumnWidth: 96", { tone: 'muted' });
      Grid({ columns: 'auto', minColumnWidth: 96, columnGap: 10, rowGap: 10 }, () => {
        for (let index = 0; index < 5; index += 1) {
          tile(`auto ${index + 1}`, { width: 88 });
        }
      });

      Text('gridColumnSpan', { tone: 'muted' });
      Grid({ columns: 4, columnGap: 10, rowGap: 10 }, () => {
        tile('span 2', { gridColumnSpan: 2, width: 180 });
        tile('span 1', { width: 80 });
        tile('span 1', { width: 80 });
      });
    });
  }

  private buildStack(): void {
    this.card('Stack & Absolute', '重叠、对齐与绝对定位角标', () => {
      Row({ gap: 12, wrap: true, alignItems: 'center' }, () => {
        for (const align of ['start', 'center', 'end'] as const) {
          Stack({ align, width: 140, height: 84 }, () => {
            Panel({ variant: 'surfaceAlt', radius: 8, width: 'fill', height: 'fill' });
            Text(`align: ${align}`, { tone: 'muted' });
          });
        }
      });

      Stack({ align: 'start', width: 240, height: 96 }, () => {
        Panel({ variant: 'surfaceAlt', radius: 10, width: 'fill', height: 'fill' });
        Absolute({ width: 'fill', height: 'fill', name: 'overlay' }, () => {
          Text('绝对定位：left/top', { position: 'absolute', left: 10, top: 8, tone: 'muted' });
          Panel(
            {
              variant: 'danger',
              radius: 8,
              padding: { top: 2, bottom: 2, left: 8, right: 8 },
              position: 'absolute',
              right: 8,
              bottom: 8,
            },
            () => {
              Text('角标', { size: 'sm' });
            },
          );
        });
      });
    });
  }

  private buildParams(): void {
    this.card('Layout params', 'width 关键字、grow、min/max、aspectRatio、alignSelf、order', () => {
      Row({ gap: 8, width: 'fill', height: 44, alignItems: 'stretch' }, () => {
        tile('width: 110', { width: 110 });
        tile('50%', { width: '50%' });
        tile('grow: 1', { grow: 1 });
        tile('grow: 2', { grow: 2 });
      });
      Row({ gap: 8, width: 'fill', height: 44, alignItems: 'stretch' }, () => {
        tile('width: fill', { width: 'fill' });
      });
      Row({ gap: 8, width: 'fill', height: 88, alignItems: 'start' }, () => {
        tile('min 80 / max 140', { width: { value: 'fill', min: 80, max: 140 }, height: 44 });
        tile('aspectRatio 2', { width: 120, aspectRatio: 2 });
        tile('alignSelf: end', { width: 120, height: 36, alignSelf: 'end' });
        tile('order: 2', { width: 90, height: 36, order: 2 });
        tile('order: 1', { width: 90, height: 36, order: 1 });
      });
    });
  }

  private buildList(): void {
    this.card('List', 'keyed 复用、虚拟化窗口与增删', () => {
      Row({ gap: 8, alignItems: 'center', wrap: true }, () => {
        this.track(
          'list.add',
          Button('add', {
            size: 'sm',
            name: 'list.add',
            onClick: () => {
              const next = this.rows.value.length + 1;
              this.rows.value = [
                ...this.rows.value,
                { id: `row-${next}-${this.rows.value.length}`, label: `第 ${next} 行 · 新增` },
              ];
            },
          }),
        );
        this.track(
          'list.remove',
          Button('remove first', {
            size: 'sm',
            name: 'list.remove',
            onClick: () => {
              this.rows.value = this.rows.value.slice(1);
            },
          }),
        );
        this.track(
          'list.shuffle',
          Button('shuffle', {
            size: 'sm',
            name: 'list.shuffle',
            onClick: () => {
              const next = this.rows.value.slice();
              next.sort(() => Math.random() - 0.5);
              this.rows.value = next;
            },
          }),
        );
        this.track(
          'list.top',
          Button('回到顶部', {
            size: 'sm',
            variant: 'secondary',
            name: 'list.top',
            // The whole of "scroll to the top" is a state write — no widget API in sight.
            onClick: () => {
              this.listOffset.value = 0;
            },
          }),
        );
        Text(() => `共 ${this.rows.value.length} 行`, { tone: 'muted' });
      });

      // A virtualised list needs a scroll driver: `Scroll` owns the offset and tells the list which
      // window to mount, so the list's own box is `fill` (exactly the port's viewport, which is what
      // makes the port's scroll range equal the list's real length).
      this.scrollWidget = Scroll(
        {
          direction: 'vertical',
          height: 260,
          width: 'fill',
          name: 'listScroll',
          // Two-way: a drag/fling writes the new position into the ref, and writing the ref scrolls.
          offset: this.listOffset,
        },
        () => {
          this.listWidget = List(
            {
              items: () => this.rows.value,
              key: (row) => row.id,
              name: 'list',
              width: 'fill',
              height: 'fill',
              gap: 4, // List 的简写：等价于 container: { gap: 4 }
              virtualize: true,
              itemExtent: 34,
              overscan: 4,
            },
            (row, index) => {
              Row({ gap: 8, height: 30, alignItems: 'center', width: 'fill' }, () => {
                Text(`${index + 1}`, { width: 44, tone: 'muted' });
                Text(() => row.label);
                Spacer({ flex: true });
                Text('·', { tone: 'muted' });
              });
            },
          );
        },
      );
      this.track('listScroll', this.scrollWidget);
      if (this.listWidget) {
        this.track('list', this.listWidget);
      }
    });
  }

  /**
   * The parity check: one card built with the factory API, one with the DSL.
   *
   * Both cards live in the same `Row` with identical options, so identical geometry is expected node
   * by node. The comparison result is published as `parity=ok` or `parity=mismatch:…`.
   */
  /**
   * The reactive *state* slots: `disabled`, `error`, `variant`, `readOnly`, `maxLines`/`ellipsis` and
   * `Image.texture`.
   *
   * A page's state is not only its data — "is this editable", "is this valid", "is this dangerous",
   * "is this paragraph expanded", "which picture is this" are state too, and Compose writes them as
   * parameters (`enabled = saving`, `isError = error != null`, `containerColor = …`,
   * `maxLines = if (expanded) Int.MAX_VALUE else 2`). Here they are the same reactive slots as `value`:
   * a literal, a `ref` or a getter, and the widget follows.
   */
  private buildState(): void {
    this.card(
      'State slots',
      'disabled / error / variant / readOnly / maxLines / texture 与 value 一样是数据槽：字面量、ref 或 getter',
      () => {
        // No `width` on the column: `alignItems: 'stretch'` (the default) gives every child — and this
        // column itself — the card's content width, so a number here would be ignored and only mislead
        // the reader (guide 02 §199).
        Column({ gap: 12, alignItems: 'stretch' }, () => {
          this.track(
            'state.field',
            TextField({
              value: this.stateName,
              label: '被状态驱动的输入框',
              placeholder: '锁定后点不动，也不会被聚焦',
              name: 'state.field',
              disabled: () => this.locked.value,
              error: () => this.stateError.value,
            }),
          );
          Text(
            () =>
              `locked=${this.locked.value} error=${
                this.stateError.value === null || this.stateError.value === false
                  ? 'none'
                  : String(this.stateError.value)
              } 值=${this.stateName.value || '(空)'}`,
            { tone: 'muted' },
          );

          // `readOnly` is the *other* half of "not editable", and the one a form wants while it saves:
          // the text stays readable and selectable, the box paints a different surface, and the value
          // is still there to submit. The two flags are independent on purpose — a check flips one and
          // asserts the other did not move.
          this.track(
            'state.frozen',
            TextField({
              value: this.stateNote,
              label: 'readOnly 由状态驱动',
              name: 'state.frozen',
              readOnly: () => this.frozen.value,
            }),
          );
          this.track(
            'state.freeze',
            Button(() => (this.frozen.value ? '解锁' : '锁定文本'), {
              variant: 'secondary',
              size: 'sm',
              name: 'state.freeze',
              onClick: () => {
                this.frozen.value = !this.frozen.value;
              },
            }),
          );

          this.track(
            'state.slider',
            Slider({
              value: this.stateVolume,
              min: 0,
              max: 100,
              width: 260,
              name: 'state.slider',
              disabled: () => this.locked.value,
            }),
          );

          // The range as a slot, and as an **A/B in one screenshot**: the two sliders below hold the
          // same value and differ only in `max`, so the painted fill has to be twice as long on the
          // first one (40% vs 20%). A range change that forgets to repaint — the knob sits at
          // `(value - min) / (max - min)` while only `value` is in the paint cache key — reads as two
          // identical tracks (V67).
          const rangeA = Slider({
            value: this.stateVolume,
            min: 0,
            max: 100,
            width: 260,
            alignSelf: 'start',
            name: 'state.rangeA',
          });
          const rangeB = Slider({
            value: this.stateVolume,
            min: 0,
            max: () => this.rangeMax.value,
            width: 260,
            alignSelf: 'start',
            name: 'state.rangeB',
          });
          this.track('state.rangeA', rangeA);
          this.track('state.rangeB', rangeB);
          this.reportStateProbes.set('state.rangeA', rangeA);
          this.reportStateProbes.set('state.rangeB', rangeB);
          this.track(
            'state.range',
            Button(() => `上限 ${this.rangeMax.value}`, {
              variant: 'secondary',
              size: 'sm',
              name: 'state.range',
              onClick: () => {
                this.rangeMax.value = this.rangeMax.value === 100 ? 200 : 100;
              },
            }),
          );

          const statePanel = Panel(
            {
              variant: () => this.stateVariant.value,
              radius: 8,
              padding: 10,
              width: 'fill',
              name: 'state.panel',
            },
            () => {
              // Left-aligned and short, so the pixel gate can sample the right-hand half of the panel
              // and read the *flavour* rather than a glyph.
              Text(() => `variant=${this.stateVariant.value}`, { tone: 'muted' });
            },
          );
          this.reportStateProbes.set('state.panel', statePanel);
          this.reportStateProbes.set('state.field', this.tracked.get('state.field') as Widget);
          this.reportStateProbes.set('state.frozen', this.tracked.get('state.frozen') as Widget);

          // Truncation as a slot: the same paragraph collapsed to two lines and expanded to all of it.
          // `maxLines`/`ellipsis` used to be constructor-only, which made the commonest "show more"
          // pattern require a rebuilt widget — and rebuilding loses the scroll position, the focus and
          // the selection of everything inside the branch.
          this.track(
            'state.text',
            Text(STATE_PARAGRAPH, {
              maxLines: () => (this.expanded.value ? 99 : 2),
              ellipsis: true,
              // `alignSelf: 'start'` is what makes `width` mean anything inside a stretching column:
              // without it the label is handed the full card width (980) and the paragraph fits in two
              // lines, so "collapse to 2 lines" would be a no-op that still looks like it works.
              width: 420,
              alignSelf: 'start',
              name: 'state.text',
            }),
          );
          this.track(
            'state.more',
            Button(() => (this.expanded.value ? '收起' : '展开'), {
              variant: 'secondary',
              size: 'sm',
              name: 'state.more',
              onClick: () => {
                this.expanded.value = !this.expanded.value;
              },
            }),
          );

          // Which picture is on screen is state too, in **both** halves of the pair: `texture` swaps the
          // whole image, `frame` moves between two rects of the *same* atlas. Everything lives in one
          // wrapping row: this card is the tallest on the page, and a widget pushed past the stage band
          // is clipped away *and* unclickable — the first two versions of this demo put the images in
          // the column (measured: the frame image landed at y=658 with the buttons at y=714, past the
          // 616px section; its pixel read `#000000` and the swap buttons did nothing).
          Row({ gap: 10, alignItems: 'center', wrap: true }, () => {
            const stateTex = Image({
              texture: () => (this.altTexture.value ? TEXTURE_B : TEXTURE_A),
              width: 44,
              height: 44,
              name: 'state.tex',
            });
            const frameStatic = Image({
              texture: ATLAS_TEXTURE,
              frame: 'red',
              width: 44,
              height: 44,
              name: 'state.frame',
            });
            const frameSlot = Image({
              texture: ATLAS_TEXTURE,
              frame: () => (this.altFrame.value ? 'green' : 'red'),
              width: 44,
              height: 44,
              name: 'state.frameAlt',
            });
            for (const [key, widget] of [
              ['state.tex', stateTex],
              ['state.frame', frameStatic],
              ['state.frameAlt', frameSlot],
            ] as const) {
              this.track(key, widget);
              this.reportStateProbes.set(key, widget);
            }
            this.track(
              'state.swap',
              Button('换贴图', {
                variant: 'secondary',
                size: 'sm',
                name: 'state.swap',
                onClick: () => {
                  this.altTexture.value = !this.altTexture.value;
                },
              }),
            );
            this.track(
              'state.frameSwap',
              Button(() => `换帧 ${this.altFrame.value ? 'green' : 'red'}`, {
                variant: 'secondary',
                size: 'sm',
                name: 'state.frameSwap',
                onClick: () => {
                  this.altFrame.value = !this.altFrame.value;
                },
              }),
            );
          });
          Row({ gap: 8, alignItems: 'center' }, () => {
            Text(() => `frameAlt=${this.altFrame.value ? 'green' : 'red'}`, { tone: 'muted' });
          });
          this.track(
            'state.frozenPanel',
            Panel({ variant: 'surfaceAlt', radius: 8, padding: 10, width: 'fill' }, () => {
              Text(
                () => `readOnly=${this.frozen.value} texture=${this.altTexture.value ? 'B' : 'A'}`,
                {
                  tone: 'muted',
                },
              );
            }),
          );

          Row({ gap: 8, wrap: true }, () => {
            this.track(
              'state.lock',
              Button(() => (this.locked.value ? '解锁' : '锁定'), {
                variant: 'secondary',
                size: 'sm',
                name: 'state.lock',
                onClick: () => {
                  this.locked.value = !this.locked.value;
                },
              }),
            );
            this.track(
              'state.fail',
              Button('标记错误', {
                variant: 'danger',
                size: 'sm',
                name: 'state.fail',
                onClick: () => {
                  this.stateError.value = '这个值不合法（来自状态）';
                },
              }),
            );
            this.track(
              'state.clear',
              Button('清除错误', {
                variant: 'ghost',
                size: 'sm',
                name: 'state.clear',
                onClick: () => {
                  this.stateError.value = null;
                },
              }),
            );
            this.track(
              'state.variant',
              Button('换变体', {
                variant: 'primary',
                size: 'sm',
                name: 'state.variant',
                onClick: () => {
                  this.stateVariant.value = nextPanelVariant(this.stateVariant.value);
                },
              }),
            );
          });
        });
      },
    );
  }

  private buildParity(): void {
    this.card('Parity', '同一张卡片：工厂 API 与 DSL 的几何必须逐项相同', () => {
      const options = {
        direction: 'vertical',
        gap: 6,
        padding: 12,
        variant: 'surfaceAlt',
        radius: 8,
      } as const;

      const pair = Row({ gap: 12, width: 'fill', alignItems: 'stretch' }, () => {
        Panel({ ...options, grow: 1 }, () => {
          Text('工厂 API', { tone: 'muted' });
          Text('同一份选项');
          Divider({});
          Button('Primary', { variant: 'primary' });
        });
      });

      // The factory card is created outside the DSL scope and appended to the row afterwards, so the
      // two cards stay siblings with identical constraints.
      const factoryCard = this.add.uiPanel({ ...options, grow: 1 }, [
        this.add.uiLabel({ text: '工厂 API', tone: 'muted' }),
        this.add.uiLabel({ text: '同一份选项' }),
        this.add.uiDivider({}),
        this.add.uiButton({ text: 'Primary', variant: 'primary' }),
      ]);
      pair.addWidget(factoryCard);

      this.publish('parity', compareSubtrees(pair.getWidgetChildren()));
    });
  }

  // ------------------------------------------------------------------ reporting

  private track(key: string, widget: Widget): void {
    this.tracked.set(key, widget);
    this.publishControl(key, widget);
  }

  private clearTracked(prefix: string): void {
    for (const key of Array.from(this.tracked.keys())) {
      if (key.startsWith(prefix)) {
        this.tracked.delete(key);
        this.published.delete(`pt.${key}`);
      }
    }
  }

  /** Repaints `pt.<key>=@x,y` for every tracked control. Runs every frame, like `#/showcase`. */
  private publishControls(): void {
    for (const [key, widget] of this.tracked) {
      if (widget.isDestroyed || !widget.visible) {
        continue;
      }
      this.publishControl(key, widget);
    }
  }

  private publishControl(key: string, widget: Widget): void {
    if (widget.isDestroyed || widget.appliedRect.width <= 0 || widget.appliedRect.height <= 0) {
      return;
    }
    this.publish(
      `pt.${key}`,
      `@${Math.round(pagePoint(this.game, widget).x)},${Math.round(
        pagePoint(this.game, widget).y,
      )}`,
    );
    // The visual state as well, like `#/states` and `#/showcase`: a reactive slot has to be observable
    // from the page, not only from `window.compose.slots()`.
    this.publish(`st.${key}`, widget.visualState);
  }

  /**
   * The `Branch()` demo's readouts: which branch is up, how many times it was built, what it produced,
   * and whether the branch that was replaced really died.
   *
   * Published per frame because the switch happens on a frame boundary (the binding is frame-aligned),
   * so a check that clicked the button and read `#demo-state` immediately would otherwise see the
   * *previous* branch.
   */
  private publishBranch(): void {
    const branch = this.branchWidget;
    if (!branch || branch.isDestroyed) {
      return;
    }
    // A destroyed control must say so, for `pt.*` as well as `st.*`: `#demo-state` is one DOM line that
    // keeps the last value of every key, so without this a check that clicks `pt.branch.b.inner` while
    // branch A is on screen would aim at stale coordinates and hit whatever is there now.
    for (const [key, widget] of this.tracked) {
      if (key.startsWith('branch.') && widget.isDestroyed) {
        this.publish(`st.${key}`, 'gone');
        this.publish(`pt.${key}`, 'gone');
      }
    }
    const built = branch.lastBuild;
    this.publish('branch.key', branch.activeKey ?? 'none');
    this.publish('branch.builds', branch.builds);
    this.publish('branch.widgets', built?.widgets ?? 0);
    this.publish('branch.roots', built?.roots ?? 0);
    const replaced = branch.lastReplaced;
    this.publish('branch.destroyed', replaced ? (replaced.isDestroyed ? 1 : 0) : -1);
    this.publish('branch.clicks', this.branchClicks.value);
  }

  /** Writes a value into `#demo-state` only when it changed (keeps the DOM writes cheap). */
  private publish(key: string, value: string | number | boolean): void {
    const text = String(value);
    if (this.published.get(key) === text) {
      return;
    }
    this.published.set(key, text);
    setDemoState(key, value);
  }

  /** The current values of the reactive state slots (what the widgets are following). */
  private slots(): Record<string, unknown> {
    const field = this.tracked.get('state.field') as
      (Widget & { getError?: () => string | null }) | undefined;
    return {
      locked: this.locked.value,
      error: this.stateError.value,
      fieldError: field?.getError?.() ?? null,
      variant: this.stateVariant.value,
      name: this.stateName.value,
      volume: Math.round(this.stateVolume.value),
      fieldState: field?.visualState ?? 'gone',
      ...this.slotReadings(),
    };
  }

  /**
   * The round-98 slots read back from the **widgets**, not from the refs that drive them.
   *
   * A slot that never reaches its setter would look perfectly healthy if the reading came from the ref:
   * what a check needs to know is whether the painted label dropped its lines, whether the image object
   * really swapped its texture, and whether the field is actually read-only.
   */
  private slotReadings(): {
    expanded: boolean;
    paintedLines: number;
    truncated: boolean | null;
    ellipsis: boolean;
    texture: string;
    frozen: boolean | null;
    frozenValue: string;
    rangeMax: number;
    rangeBMax: number;
    rangeBValue: number;
    frameAlt: string;
  } {
    const paragraph = this.tracked.get('state.text') as
      (Widget & { getDisplayText?: () => string; truncated?: boolean }) | undefined;
    const painted = paragraph?.getDisplayText?.() ?? '';
    const image = this.tracked.get('state.tex') as
      (Widget & { currentTexture?: string }) | undefined;
    const frozenField = this.tracked.get('state.frozen') as
      (Widget & { readOnly?: boolean; getValue?: () => string }) | undefined;
    // The slider's own `max`/`min`, not the `ref`: a slot that never reached `setRange` would look
    // healthy if this read the ref back.
    const rangeB = this.tracked.get('state.rangeB') as
      (Widget & { min?: number; max?: number; getValue?: () => number }) | undefined;
    const frameSlot = this.tracked.get('state.frameAlt') as
      (Widget & { currentFrame?: string }) | undefined;
    return {
      expanded: this.expanded.value,
      /** Lines actually painted: the observable half of `maxLines` + `ellipsis`. */
      paintedLines: painted.length === 0 ? 0 : painted.split('\n').length,
      truncated: paragraph?.truncated ?? null,
      ellipsis: painted.includes('…'),
      texture: image?.currentTexture ?? 'none',
      frozen: frozenField?.readOnly ?? null,
      frozenValue: frozenField?.getValue?.() ?? '',
      rangeMax: this.rangeMax.value,
      rangeBMax: rangeB?.max ?? -1,
      rangeBValue: rangeB?.getValue?.() ?? -1,
      frameAlt: frameSlot?.currentFrame ?? 'none',
    };
  }

  /** Exposes the scene controller for interactive checks. */
  private exposeGlobals(): void {
    (window as unknown as { compose?: unknown }).compose = {
      sections: () => SECTIONS.map((def) => def.id),
      show: (id: SectionId) => this.showSection(id),
      state: () => ({
        section: this.section.value,
        theme: this.mvvm.theme.name,
        highlighted: this.highlighted.value,
        counter: this.counter.value,
        clicks: this.clicks.value,
        toggled: this.toggled.value,
        name: this.name.value,
        notes: this.notes.value,
        email: this.email.value,
        hoisted: this.hoisted.value,
        rows: this.rows.value.length,
        parity: this.parity.value,
      }),
      /** `Branch()` state, plus the counters a leak check needs around a switch. */
      branch: () => {
        const branch = this.branchWidget;
        const built = branch?.lastBuild ?? null;
        return {
          key: branch?.activeKey ?? 'none',
          builds: branch?.builds ?? 0,
          widgets: built?.widgets ?? 0,
          roots: built?.roots ?? 0,
          depth: built?.depth ?? 0,
          previousDestroyed: branch?.lastReplaced ? branch.lastReplaced.isDestroyed : null,
          clicks: this.branchClicks.value,
        };
      },
      setBranch: (key: string) => {
        this.branchKey.value = key;
      },
      counts: () => ({
        widgets: countWidgets(this.sectionHost),
        themeListeners: themeListenerCount(),
        focusables: this.mvvm.focus.focusables.length,
        pointerTargets: this.mvvm.input.widgets.length,
        a11yNodes: this.mvvm.a11y.count,
      }),
      /** The `Scroll` offset slot: read it, or write it to scroll the list from state. */
      listOffset: (): number => this.listOffset.value,
      setListOffset: (value: number): number => {
        this.listOffset.value = value;
        return this.listOffset.value;
      },
      /** Reactive state slots: flip them from a check and watch the widgets follow. */
      setState: (patch: {
        locked?: boolean;
        error?: string | boolean | null;
        variant?: PanelVariant;
        frozen?: boolean;
        expanded?: boolean;
        altTexture?: boolean;
        rangeMax?: number;
        volume?: number;
        altFrame?: boolean;
      }): Record<string, unknown> => {
        if (patch.locked !== undefined) {
          this.locked.value = patch.locked;
        }
        if (patch.volume !== undefined) {
          this.stateVolume.value = patch.volume;
        }
        if (patch.rangeMax !== undefined) {
          this.rangeMax.value = patch.rangeMax;
        }
        if (patch.altFrame !== undefined) {
          this.altFrame.value = patch.altFrame;
        }
        if (patch.frozen !== undefined) {
          this.frozen.value = patch.frozen;
        }
        if (patch.expanded !== undefined) {
          this.expanded.value = patch.expanded;
        }
        if (patch.altTexture !== undefined) {
          this.altTexture.value = patch.altTexture;
        }
        if (patch.error !== undefined) {
          this.stateError.value = patch.error;
        }
        if (patch.variant !== undefined) {
          this.stateVariant.value = patch.variant;
        }
        return this.slots();
      },
      slots: () => this.slots(),
      geometry: () => ({
        page: rectOf(this.page),
        nav: rectOf(this.nav),
        stage: rectOf(this.stage),
        section: rectOf(this.sectionHost),
      }),
      /**
       * Builds one panel with a mistyped option and returns the warning it produced.
       *
       * The option audit (round 83) is the framework telling a caller that a key nobody reads is
       * silently ignored — a typo like `pading` used to cost an afternoon ("why is my padding not
       * applied?"). Reading it back from the page is the only way to check the whole path: DSL → flat
       * option bag → `splitOptions` → `warn()`. The panel is destroyed immediately, and the handler is
       * registered only for the duration of the call, so ordinary warnings still reach the console.
       */
      typo: (
        key = 'pading',
        value: number | string = 20,
        kind: 'panel' | 'field' | 'button' = 'panel',
      ): string[] => {
        const captured: string[] = [];
        const stop = onDevWarning((message: string) => captured.push(message));
        try {
          const bag: Record<string, unknown> = { width: 120, height: 40 };
          bag[key] = value;
          // Built through the documented lazy entry: this runs from a page API call, i.e. outside the
          // page's build pass, and a composable cannot find its scene on its own.
          const probe = buildUiSubtree(
            this,
            () => {
              if (kind === 'field') {
                TextField({ ...bag, name: 'typoProbe' });
                return;
              }
              if (kind === 'button') {
                Button('probe', { ...bag, name: 'typoProbe' });
                return;
              }
              Panel(bag);
            },
            'compose.typo()',
          );
          probe.destroy();
        } finally {
          stop();
        }
        return captured;
      },
    };
  }
}

// --------------------------------------------------------------------- helpers

/** A small themed tile used by the layout sections. */
function tile(label: string, params: PanelOptions = {}): void {
  Panel(
    {
      variant: 'surfaceAlt',
      radius: 8,
      padding: 6,
      height: 36,
      width: 72,
      alignItems: 'center',
      justifyContent: 'center',
      ...params,
    },
    () => {
      Text(label, { tone: 'muted', maxLines: 1 });
    },
  );
}

/** Compares the two parity cards node by node and returns `ok` or a readable mismatch. */
function compareSubtrees(cards: readonly Widget[]): string {
  const [first, second] = cards;
  if (!first || !second) {
    return `mismatch:cards=${cards.length}`;
  }
  const a = flatten(first);
  const b = flatten(second);
  if (a.length !== b.length) {
    return `mismatch:nodes ${a.length}vs${b.length}`;
  }
  for (let index = 0; index < a.length; index += 1) {
    const one = (a[index] as Widget).appliedRect;
    const two = (b[index] as Widget).appliedRect;
    if (
      Math.round(one.width) !== Math.round(two.width) ||
      Math.round(one.height) !== Math.round(two.height) ||
      Math.round(one.x) !== Math.round(two.x) ||
      Math.round(one.y) !== Math.round(two.y)
    ) {
      return `mismatch:node ${index} ${Math.round(one.width)}x${Math.round(one.height)}@${Math.round(one.x)},${Math.round(one.y)} vs ${Math.round(two.width)}x${Math.round(two.height)}@${Math.round(two.x)},${Math.round(two.y)}`;
    }
  }
  return 'ok';
}

/** Depth-first widget list, used by the parity check and the node counter. */
function flatten(widget: Widget): Widget[] {
  const out: Widget[] = [widget];
  for (const child of widget.getWidgetChildren()) {
    out.push(...flatten(child));
  }
  return out;
}

function countWidgets(widget: Widget | null): number {
  return widget ? flatten(widget).length : 0;
}

function rectOf(widget: Widget | null): Record<string, number> | null {
  if (!widget) {
    return null;
  }
  const origin = stagePosition(widget);
  return {
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: Math.round(widget.appliedRect.width),
    height: Math.round(widget.appliedRect.height),
  };
}
