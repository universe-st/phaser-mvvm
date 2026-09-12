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
4. **插件条目里只写 `key`/`plugin`/`mapping`**：Phaser 用 `new Plugin(scene, pluginManager, mapKey)` 实例化场景插件，`MVVMPluginConfig`（`themeBackground`/`input`/`focus`/`navigation`/`onBack`）目前**传不进去**，写了也不会生效；这些选项请在拿到 `this.mvvm` 之后运行期设置（[06 §6.1](./06-data-and-theme.md)、[07 §2](./07-input-focus-nav.md)）。

> 也可以不用插件：直接 `new UIRoot(scene)` + `root.addWidget(...)` + `root.flushLayout()`。插件提供的额外能力是「每帧自动 flush + 自动输入/焦点路由 + 主题背景」，见本章 §7。

---

## 3. 第一个页面

在场景的 `create()` 里搭树、挂载。**视图就是代码**：容器函数返回控件，`: children` 参数建立父子关系。

```ts
import Phaser from 'phaser';
import type { Panel } from '@phaser-mvvm/widgets';

export class HelloScene extends Phaser.Scene {
  constructor() {
    super('hello');
  }

  create(): void {
    const theme = this.mvvm.theme; // 当前主题（默认 dark）

    const card = (title: string, body: string): Panel =>
      this.add.uiPanel(
        { direction: 'vertical', gap: 6, padding: 14, variant: 'surfaceAlt', radius: 10, grow: 1 },
        [
          this.add.uiLabel({ text: title, style: { fontSize: `${theme.fontSize.lg}px` } }),
          this.add.uiLabel({ text: body, tone: 'muted', maxLines: 3, ellipsis: true }),
        ],
      );

    const page = this.add.uiPanel(
      { direction: 'vertical', gap: 12, padding: 20, variant: 'surface', radius: 12, width: 520 },
      [
        this.add.uiLabel({
          text: 'Hello phaser-mvvm',
          style: { fontSize: `${theme.fontSize.xl}px` },
        }),
        this.add.uiLabel({ text: '一条声明式的 UI 树，引擎负责测量与排布', tone: 'muted' }),

        // 横向容器：两张卡片 + 一个撑开的 Spacer 不需要，因为卡片是 grow: 1
        this.add.hbox({ gap: 12, alignItems: 'stretch', width: 'fill' }, [
          card('布局', '两阶段 measure/arrange，自动处理百分比、填充与伸缩'),
          card('控件', '主题驱动的外观，零美术资源也能跑通'),
        ]),

        this.add.uiDivider({}),

        this.add.hbox({ gap: 8, justifyContent: 'end', width: 'fill' }, [
          this.add.uiButton({ text: '取消', variant: 'ghost' }),
          this.add.uiButton({
            text: '确定',
            variant: 'primary',
            onClick: () => console.log('clicked'),
          }),
        ]),
      ],
    );

    // 挂到 UIRoot：接上输入路由 + 立刻布局一次
    this.mvvm.mount(page);
  }
}
```

然后照常注册场景：

```ts
new Phaser.Game({ /* … */ scene: [HelloScene] });
```

### 这段代码在发生什么

- `this.add.uiPanel(...)` 构造 `Panel` 并 **`scene.add.existing()`**，所以它已经在显示列表里了；但**还没参与布局**。第二个参数的子控件会被 `addWidget` 挂进这棵「widget 树」。
- `this.mvvm.mount(page)` 才是关键一步：
  1. `root.addWidget(page)`：把页面挂到 `UIRoot` 下，并**立刻布局一次**；
  2. `refreshInteraction()`：重新收集可聚焦控件与指针目标，于是新页面上的按钮马上能点、能 Tab；
  3. 页面在 `UIRoot` 的 `stack`（默认 `align: 'center'`）里居中显示。

> `UIRoot` 构造时按当前游戏尺寸（`scene.scale.gameSize`）把自己撑满，并 `setDepth(1000)` 抬高渲染层级；窗口尺寸变化时它监听 `scale` 的 `resize` 重新布局。页面因此天然居中。想要页面占满整屏就把 `page` 的 `width/height` 设成 `'fill'`。
>
> 另外，`UIRoot` **不会**设置 `scrollFactor`：如果主相机滚动（跟随玩家），整棵 UI 会跟着移动。要把它钉在屏幕上，请自己 `this.mvvm.root.setScrollFactor(0)`。

---

## 4. 工厂 vs 构造函数 vs 具名函数

同一个控件有三种创建方式，选一种风格即可，别混着用同一个控件：

```ts
// A) 场景工厂（推荐，最像 Phaser 原生写法）
const a = this.add.uiButton({ text: 'A' });

// B) 具名函数（适合把视图拆成普通函数、脱离 this 的场景）
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

好处是「任何控件都能用任何布局参数」；代价是**未知键在运行时被静默忽略**（不抛错）。不过选项接口是闭合类型，在字面量里拼错键名 TypeScript 会直接报错 —— 运行时静默只发生在「先存进变量再传」之类的场景。查表时以本指南的选项表为准。

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
