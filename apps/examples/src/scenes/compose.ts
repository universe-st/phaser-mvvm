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
import { computed, ref } from '@phaser-mvvm/core';
import { setTheme, type Widget } from '@phaser-mvvm/phaser';
import type { PanelOptions, Repeat, ScrollView } from '@phaser-mvvm/widgets';
import {
  Absolute,
  Button,
  Column,
  Divider,
  Grid,
  Image,
  List,
  Panel,
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
import { makeTexture, makeTileTexture, setDemoState } from '../demo';
import { appendStatus, reportCanvas, reportWidget, stagePosition } from '../status';

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
  { id: 'parity', title: 'Parity', caption: 'DSL 与工厂 API 几何一致' },
];

const NAV_WIDTH = 236;
const PAGE_MARGIN = 12;
const TILE_TEXTURE = 'compose.tile';
const ICON_TEXTURE = 'compose.icon';

interface SampleRow {
  id: string;
  label: string;
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

  private readonly emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.value));

  // ------------------------------------------------------------------ scene state

  private page: Widget | null = null;
  private nav: Widget | null = null;
  private stage: ScrollView | null = null;
  private sectionHost: Widget | null = null;
  private listWidget: Repeat<SampleRow> | null = null;
  private scrollWidget: ScrollView | null = null;

  /** Controls whose page coordinates are republished every frame (`pt.<key>`). */
  private readonly tracked = new Map<string, Widget>();
  private readonly published = new Map<string, string>();

  /** Section whose geometry still has to be reported, once the next frame has arranged it. */
  private pendingReport: SectionId | null = null;

  constructor() {
    super('compose');
  }

  create(): void {
    makeTileTexture(this, TILE_TEXTURE);
    // A control-sized icon: the 64px tile overflows a 36px button, which looks like a layout bug.
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
    this.publish('rows', this.rows.value.length);
    if (this.listWidget) {
      this.publish('rows.rendered', this.listWidget.renderedCount);
      this.publish('rows.total', this.listWidget.totalCount);
    }
    if (this.scrollWidget) {
      this.publish('list.offset', Math.round(this.scrollWidget.offset));
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
        Text(title, { style: { fontSize: `${this.mvvm.theme.fontSize.lg}px` } });
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
        Divider({ name: 'flow.after' });
      });

      // Switch on state: the branch that runs at build time is the branch that exists.
      switch (this.section.value) {
        case 'flow':
          Text('当前就是 Flow 分区（switch 也照常写）', { tone: 'muted' });
          break;
        default:
          Text('其他分区', { tone: 'muted' });
          break;
      }
    });
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
        Text('Danger', { tone: 'danger' });
        Text('Success', { tone: 'success' });
        Text('Warning', { tone: 'warning' });
        Text('居中', { align: 'center', width: 120, tone: 'muted' });
        Text('右对齐', { align: 'right', width: 120, tone: 'muted' });
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
        for (const justify of [
          'start',
          'center',
          'end',
          'space-between',
          'space-around',
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
              Text('角标', { style: { fontSize: `${this.mvvm.theme.fontSize.sm}px` } });
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
        Text(() => `共 ${this.rows.value.length} 行`, { tone: 'muted' });
      });

      // A virtualised list needs a scroll driver: `Scroll` owns the offset and tells the list which
      // window to mount, so the list's own box is `fill` (exactly the port's viewport, which is what
      // makes the port's scroll range equal the list's real length).
      this.scrollWidget = Scroll(
        { direction: 'vertical', height: 260, width: 'fill', name: 'listScroll' },
        () => {
          this.listWidget = List(
            {
              items: () => this.rows.value,
              key: (row) => row.id,
              name: 'list',
              width: 'fill',
              height: 'fill',
              container: { gap: 4 },
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
    const canvas = this.game.canvas.getBoundingClientRect();
    const origin = stagePosition(widget);
    this.publish(
      `pt.${key}`,
      `@${Math.round(canvas.left + origin.x + widget.appliedRect.width / 2)},${Math.round(
        canvas.top + origin.y + widget.appliedRect.height / 2,
      )}`,
    );
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
      geometry: () => ({
        page: rectOf(this.page),
        nav: rectOf(this.nav),
        stage: rectOf(this.stage),
        section: rectOf(this.sectionHost),
      }),
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
