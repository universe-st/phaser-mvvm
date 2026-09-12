# 01 · 快速开始：从零到第一个页面

本章目标：**跑起来**。你会配好一个 Phaser 4 游戏、注册框架的工厂、搭出第一个页面（标题 + 两张卡片 + 一个按钮），并搞清「一帧里框架到底做了什么」。

> 前置：Node 24、pnpm 10。仓库根目录执行 `pnpm install`（依赖已装过就不用重复装）。
> 本章代码对应示例场景 [`apps/examples/src/scenes/gallery.ts`](../../apps/examples/src/scenes/gallery.ts) 的简化版，可直接对照阅读。

---

## 1. 先看清四个包的分工

| 包                     | 你什么时候会 import 它                                | 里面有什么                                                                                       |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@phaser-mvvm/widgets` | 几乎总是                                              | `Panel`/`Label`/`Button`/`Image`/`Spacer`/`Divider`/`TextField`/`TextArea`/`ScrollView`/`Repeat` |
| `@phaser-mvvm/phaser`  | 配插件、`vbox/hbox/grid`、绑定、主题                  | `MVVMPlugin`、`Widget`、`UIRoot`、`vbox`/`hbox`/`grid`/`stack`/`absolute`、`bind*` 系列          |
| `@phaser-mvvm/layout`  | 写自定义控件或做纯布局测试时才直接 import             | `LayoutEngine`、`LayoutParams` 类型、arranger 算法                                               |
| `@phaser-mvvm/core`    | 写 ViewModel、用 `ref`/`computed`/`BindingContext` 时 | 响应式内核、调度器、路径表达式编译                                                               |

**硬约束**：只有 `packages/phaser` 能 `import phaser`。你在业务代码里当然可以照常 `import Phaser from 'phaser'`（写场景必须），但框架自身的 `core`/`layout` 与渲染无关，这也是它们能在 Node 里单测的原因。

---

## 2. 配置游戏

框架通过 **场景插件** 挂进 Phaser，键名是 `mvvm`：

```ts
import Phaser from 'phaser';
import { MVVMPlugin, installFactories } from '@phaser-mvvm/phaser';
import { installWidgetFactories } from '@phaser-mvvm/widgets';

// 注册 this.add.vbox / hbox / uiGrid / uiStack / uiAbsolute / uiRect
installFactories();
// 注册 this.add.uiLabel / uiPanel / uiButton / uiImage / uiSpacer / uiDivider /
//        uiTextField / uiTextArea / uiRepeat / uiScroll
installWidgetFactories();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d1117',
  scale: {
    // RESIZE 让画布跟着窗口走；UIRoot 监听 scale 的 resize 事件重新布局
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  // 中文 IME / 移动端软键盘需要 DOM 容器（见 04 章）
  dom: { createContainer: true },
  plugins: {
    // 只读 key / plugin / mapping 三个字段（插件选项目前传不进去，见第 3 点）
    scene: [{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm' }],
  },
});
```

三个要点：

1. **`mapping: 'mvvm'`** 决定场景里的字段名：之后写 `this.mvvm`。插件在每个场景启动时创建，场景 `SHUTDOWN`/`DESTROY` 时自动把 UI、监听器、绑定全部拆掉。
2. **两个 install 函数都要调**，而且要在创建 UI 之前调。它们只是「把方法注册到 `Phaser.GameObjects.GameObjectFactory` 上」，是幂等的，模块顶层调一次即可。少调一个，对应的 `this.add.xxx` 就是 `undefined`。
3. **`dom.createContainer: true`** 是中文输入法与移动端软键盘（DOM 输入桥）的前提；纯 Canvas 场景可以不开（[04 章 §2](./04-text-inputs.md)）。
4. **插件条目里只写 `key`/`plugin`/`mapping`**：Phaser 用 `new Plugin(scene, pluginManager, mapKey)` 实例化场景插件，`MVVMPluginConfig`（`themeBackground`/`input`/`focus`/`navigation`/`onBack`/`safeArea`）目前**传不进去**，写了也不会生效；这些选项的正确写法是：**游戏级**在 `new Phaser.Game(...)` 之前调一次 `MVVMPlugin.configure({ … })`，**单个场景**用 `this.mvvm.configure({ … })`（`back` 用 `this.mvvm.onBack`，不是 `focus.onBack`）（[06 §6.1](./06-data-and-theme.md)、[07 §2](./07-input-focus-nav.md)）。
5. **手机上自动避开刘海**：`UIRoot` 默认开启安全区（`safeArea: true`），它把 `env(safe-area-inset-*)` 读出来当作根的内边距——桌面上量到的是 0，行为与从前完全一致；有挖孔或手势条时按钮不会被压在下面。**前提是页面声明了 `viewport-fit=cover`**，否则浏览器对所有 inset 都报 0：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

要让画布铺到挖孔里（全屏背景，或自己处理 inset），用 `MVVMPlugin.configure({ safeArea: false })`。手机形态（视口 / DPR / 旋转 / 刘海 / 软键盘）的实测矩阵见 [`ACCEPTANCE-mobile.md`](../ACCEPTANCE-mobile.md)。

> 也可以不用插件：直接 `new UIRoot(scene)` + `root.addWidget(...)` + `root.flushLayout()`。插件提供的额外能力是「每帧自动 flush + 自动输入/焦点路由 + 主题背景」，见本章 §7。

---

## 3. 第一个页面

最省事的入口是继承 **`UIScene`**：它替你建树并挂载，你只写视图。

```ts
import { UIScene } from '@phaser-mvvm/phaser';
import { Panel, Row, Text, Button, Divider } from '@phaser-mvvm/widgets/compose';

export class HelloScene extends UIScene {
  constructor() {
    super('hello');
  }

  content(): void {
    const theme = this.mvvm.theme; // 当前主题（默认 dark）

    // 一个返回控件的普通函数就是「一个组件」
    const card = (title: string, body: string): void =>
      Panel({ gap: 6, padding: 14, variant: 'surfaceAlt', radius: 10, grow: 1 }, () => {
        Text(title, { size: 'lg' });
        Text(body, { tone: 'muted', maxLines: 3, ellipsis: true });
      });

    Panel({ gap: 12, padding: 20, variant: 'surface', radius: 12, width: 520 }, () => {
      Text('Hello phaser-mvvm', { size: 'xl' });
      Text('一条声明式的 UI 树，引擎负责测量与排布', { tone: 'muted' });

      Row({ gap: 12, alignItems: 'stretch', width: 'fill' }, () => {
        card('布局', '两阶段 measure/arrange，自动处理百分比、填充与伸缩');
        card('控件', '主题驱动的外观，零美术资源也能跑通');
      });

      Divider({});

      Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
        Button('取消', { variant: 'ghost' });
        Button('确定', { variant: 'primary', onClick: () => console.log('clicked') });
      });
    });
  }
}
```

UI 只是场景工作的一部分时（钉在世界上的 HUD、两棵互不相干的根、要交给对话框的子树），照常写 `Phaser.Scene` 并在 `create()` 里 `render()`：

```ts
import Phaser from 'phaser';
import { render, Panel, Row, Text, Button } from '@phaser-mvvm/widgets/compose';

export class HudOverlayScene extends Phaser.Scene {
  constructor() {
    super('hud');
  }

  create(): void {
    // render() = 建树 + this.mvvm.mount()，一次调用搞定整页
    render(this.mvvm, () => {
      Panel({ gap: 12, padding: 20, variant: 'surface', radius: 12, width: 520 }, () => {
        Text('Hello phaser-mvvm', { size: 22 });
        Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
          Button('确定', { variant: 'primary' });
        });
      });
    });
  }
}
```

> **两种入口怎么选**：场景**就是**那一页 → `UIScene`；UI 是场景的一部分 → `Phaser.Scene` + `render()`。`UIScene` 另外还提供 `setContent()`（整页替换）、`onBack()`（`Esc`/手柄 B 的先否决权）、`page`/`contentInfo`（当前根与建树结果），完整能力与实测读数见 [`ACCEPTANCE-uiscene.md`](../ACCEPTANCE-uiscene.md)。

然后照常注册场景：

```ts
new Phaser.Game({ /* … */ scene: [HelloScene] });
```

> **用 DSL 就不必调用 `installFactories()` / `installWidgetFactories()`**：那两个函数只注册 `this.add.uiButton(...)` 这类工厂方法，而 DSL 直接构造控件类。只有当你（或旧代码）要写 `this.add.*` 时才需要它们。
>
> ⚠️ 反过来说：**`UIScene.content()` 里不能拿工厂方法当根**。`this.add.vbox(...)`/`this.add.uiLabel(...)` 直接进显示列表、**不进 UI 作用域**，于是"内容 lambda 一个根都没建"会直接报错。`content()` 与 `ui()`/`render()` 的 lambda 是同一种东西：里面写 DSL composable，或显式用 `withUiParent()` 把工厂产物交进去。

### 这段代码在发生什么

- 每个 composable（`Panel`/`Row`/`Text`/…）都 **`scene.add.existing()`** 了一个控件，所以它已经在显示列表里；但**还没参与布局**。内容 lambda 里创建的控件会在创建时挂到当前容器上（[09 §7](./09-compose-dsl.md) 讲这套作用域机制）。
- `UIScene` 的 `create()`（或手写的 `render(this.mvvm, () => { … })`）是关键一步，等价于 `const page = ui(this, () => { … }); this.mvvm.mount(page);`：

- 每个 composable（`Panel`/`Row`/`Text`/…）都 **`scene.add.existing()`** 了一个控件，所以它已经在显示列表里；但**还没参与布局**。内容 lambda 里创建的控件会在创建时挂到当前容器上（[09 §7](./09-compose-dsl.md) 讲这套作用域机制）。
- `render(this.mvvm, () => { … })` 是关键一步，等价于 `const page = ui(this, () => { … }); this.mvvm.mount(page);`：
  1. `root.addWidget(page)`：把页面挂到 `UIRoot` 下，并**立刻布局一次**；
  2. `refreshInteraction()`：重新收集可聚焦控件与指针目标，于是新页面上的按钮马上能点、能 Tab；
  3. 页面在 `UIRoot` 的 `stack`（默认 `align: 'center'`）里居中显示。

> 需要自己拿着根控件时（对话框、稍后替换的分区）用 `ui(this, () => { … })`，它只建不挂。

> `UIRoot` 构造时按当前游戏尺寸（`scene.scale.gameSize`）把自己撑满，并 `setDepth(1000)` 抬高渲染层级；窗口尺寸变化时它监听 `scale` 的 `resize` 重新布局。页面因此天然居中。想要页面占满整屏就把 `page` 的 `width/height` 设成 `'fill'`。
>
> 另外，`UIRoot` **不会**设置 `scrollFactor`：如果主相机滚动（跟随玩家），整棵 UI 会跟着移动。要把它钉在屏幕上，自己钉一下即可——**钉根或钉某一页都行**：

```ts
const hud = ui(this, () => {
  /* … */
});
hud.setScrollFactor(0); // 只钉这一页，其它页面仍留在世界坐标里
this.mvvm.mount(hud);
```

`setScrollFactor()` 会**向下传播到整棵子树**（Phaser 的命中测试读的是被点中对象自己的 `scrollFactor`，只钉父节点会导致相机滚动后「看得见但点不到」），而 `addWidget()` 会把父节点的因子带给**挂载之后**新增的子树，所以钉一次就长期有效。路由器的指针坐标也**按每个控件自己的** `scrollFactor` 折算，与 Phaser 的公式一致（[ADR-0009](../adr/0009-camera-pinned-ui-and-input.md)，实测见 [`ACCEPTANCE-hud.md`](../ACCEPTANCE-hud.md)）——这也是为什么「钉一页」不会连累别的页。可运行的完整例子：`#/hud`（滚动的世界 + 钉住的 HUD + 挂载后新增的按钮）。

---

## 4. 创建控件的四种方式（DSL 优先）

**首选 DSL**（上一节），它把「建控件 + 建立父子关系 + 挂载」压成一次 `render()`。下面三种是同一批控件的其它入口，需要时再退回：

```ts
// A) 工厂（要写 this.add.*、或从旧代码迁移时用；需要 install*Factories()）
const a = this.add.uiButton({ text: 'A' });

// B) 具名函数（脱离 this 的普通函数里建控件；需要 install*Factories() 之外的场景也可直接用）
import { button, panel, label } from '@phaser-mvvm/widgets';
const b = button(this, { text: 'B' }); // 内部同样会 scene.add.existing()

// C) 构造函数（完全手动控制注册时机）
import { Button } from '@phaser-mvvm/widgets';
const c = new Button(this, { text: 'C' });
this.add.existing(c); // 别忘了这一句
```

工厂与具名函数签名一致：`(scene, options?, children?)`。两点例外：

- **构造函数**是 `(scene, options?)` —— 控件库里只有 `Panel` 额外接受 `children`（容器类 `vbox`/`hbox`/`uiGrid`/`uiStack`/`uiAbsolute` 也接受）；
- `Repeat` 没有 `children`（行由 `template` 生成）；`Image` 的 `options` 必填（`texture`）。

---

## 5. 选项是「扁平的」

控件的选项对象里**混着两层东西**：节点级 `LayoutParams`（`width`、`padding`、`grow`、`gridColumn`…）和控件自己的选项（`variant`、`placeholder`、`tone`…）。框架在构造时把两者拆开：

```ts
this.add.uiButton({
  text: '保存', // ─┐
  variant: 'primary', //  ├─ 控件选项 → Button
  loading: false, // ─┘
  width: 160, // ─┐
  grow: 0, //  ├─ 节点参数 → 布局引擎
  margin: [0, 8], // ─┘
});
```

好处是「任何控件都能用任何布局参数」；拼错键名时 TypeScript 通常会在字面量里直接报错，而在绕开类型检查（先存变量、`as` 断言、动态拼键）的场景里**开发模式下框架会指名警告**：`[phaser-mvvm] unknown option "pading" on "panel" — it is ignored. Did you mean "padding"?`（第 83 轮的选项审计；发布模式下不打印）。查表时以本指南的选项表为准。

---

## 6. 一帧里框架做了什么

理解这条链路，90% 的「为什么不刷新」都能自己定位：

```
Phaser 场景 PRE_UPDATE
  └─ MVVMPlugin.onPreUpdate(time)
       ├─ flushFrame()               // ① 把所有挂起的响应式绑定跑一遍（flush: 'frame'）
       ├─ uiRoot.flushLayout()       // ② 有脏节点就重跑 measure/arrange
       ├─ structureVersion 变了？    // ③ 只有树结构变化才重新收集输入/焦点目标
       │    └─ refreshInteraction()
       ├─ pollGamepad(time)          // ④ 轮询手柄，映射成 activate/back/方向
       └─ router.update(time)        // ⑤ 每帧重新计算「指针下最深的控件」→ 悬停状态
```

三条推论：

- **一帧内改 100 次数据 = 一次重绘 + 一次布局**。绑定的 effect 是批量 flush 的，布局又只在 `hasDirtyNodes` 时才跑。
- **`setLayoutParams` / `markDirty` 才是「让布局重算」的信号**。你直接 `widget.layoutParams.width = 100` 而不调 `setLayoutParams`，引擎不知道要重算（[02 §13](./02-layout.md)）。
- **结构变化（增删控件）后需要重新收集输入目标**，插件靠 `UIRoot.structureVersion` 自动完成。手动 `addWidget` 到 `UIRoot` 之外的节点、或者不用插件时，你要自己调 `refreshInteraction()`。

---

## 7. 不用插件时的最小闭环

插件是便利层，不是必须的。手动搭一个 `UIRoot`：

```ts
import { UIRoot } from '@phaser-mvvm/phaser';
import { panel, label, button } from '@phaser-mvvm/widgets';

const root = new UIRoot(this, { depth: 1000, align: 'center' }); // 构造即 scene.add.existing + 撑满
const page = panel(this, { direction: 'vertical', gap: 10, padding: 16 }, [
  label(this, { text: '手动模式' }),
  button(this, { text: '确定' }),
]);
root.addWidget(page); // 立刻布局
root.flushLayout(); // 之后再手动触发（默认 container 是居中 stack）
```

这条路上你**失去**了：每帧自动 flush、指针与焦点路由、键盘/手柄导航、主题背景同步、场景关闭时的自动清理。所以正常项目建议用插件。

---

## 8. 跑起来看看

```bash
pnpm dev          # → http://localhost:5173  （端口写死 5173 + strictPort）
pnpm test         # 全仓单测
pnpm typecheck    # 逐包 tsc --noEmit
pnpm build:examples
node scripts/visual-check.mjs   # 无头 Chrome 几何 + 像素验收（macOS/Linux）
```

示例场景通过 hash 切换，场景注册表在 [`apps/examples/src/main.ts`](../../apps/examples/src/main.ts)：

| hash          | 场景        | 看什么                                                |
| ------------- | ----------- | ----------------------------------------------------- |
| `#/m0`        | `m0`        | 最小闭环：vbox → hbox → 两个矩形                      |
| `#/probe`     | `probe`     | stack + absolute + 百分比 + 嵌套 box                  |
| `#/stack`     | `stack`     | 层叠与负偏移角标                                      |
| `#/gallery`   | `gallery`   | **M4 控件画廊**：每个控件的每个状态（见 03 章）       |
| `#/dashboard` | `dashboard` | box + grid + grow + 百分比组成的仪表盘（见 02 章 §9） |
| `#/bindings`  | `bindings`  | 单向/双向/命令/模板绑定（见 06 章）                   |
| `#/form`      | `form`      | `TextField`/`TextArea` + 校验 + IME（见 04 章）       |
| `#/list`      | `list`      | 220 行虚拟化列表 + 键控复用（见 05 章）               |
| `#/scroll`    | `scroll`    | 纵向/横向/嵌套三种 `ScrollView`（见 05 章）           |
| `#/showcase`  | `showcase`  | **全量验收页**：所有控件与布局的合集                  |

---

## 9. 小结与下一篇

你现在应该能把界面跑起来，并知道：**配插件 → 注册工厂 → 搭树 → `mount`**，以及数据变化走「每帧 flush → 布局一次」这一条链路。

下一篇 [02 布局](./02-layout.md) 讲你刚才用到的 `direction`/`gap`/`padding`/`grow`/`fill`/`width` 到底是怎么被算成矩形的 —— 这是本框架里最值得花时间的一部分。
