# phaser-mvvm 使用指南

这套指南教你怎么用 phaser-mvvm **做界面**：从跑起第一个页面，到搭出布局、控件、表单、长列表，并把它们接到响应式数据上。

- **风格**：教程式。每一章都围绕一个「要做的界面」推进，边做边讲，而不是把选项表堆在一起。
- **事实来源**：本指南以**当前源码**为准（`packages/*/src`）。`docs/PLAN.md` 是架构事实来源，但它同时包含**目标形态**；两者不一致时，指南按已实现的代码写，并在 [08-lifecycle-and-pitfalls.md](./08-lifecycle-and-pitfalls.md) §5 列出差异清单。
- **状态**：M0–M7 已完成（响应式内核、布局引擎、适配层、基础控件、文本框、绑定与列表、滚动与裁剪）。**M8/M9 未开始**：`UIScene`、`Page`、`ModalStack`、`Router`、`A11yBridge` 尚不存在，指南不会假装它们可用。

---

## 1. 阅读路线

| 你是谁 / 要做什么                           | 按这个顺序读                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 第一次接触，想先看到画面                    | [01 快速开始](./01-quick-start.md)（已按 DSL 写）→ [09 Compose 风格 DSL](./09-compose-dsl.md) → [02 布局](./02-layout.md) → [03 控件](./03-widgets.md) |
| 只想看「像 Jetpack Compose 那样写」长什么样 | [09 Compose 风格 DSL](./09-compose-dsl.md)（可运行示例：`#/compose`）                                                                                  |
| 要做表单 / 工具型界面                       | 01 → 02 → 03 → [04 文本框与表单](./04-text-inputs.md) → [06 数据绑定与主题](./06-data-and-theme.md)                                                    |
| 要做长列表 / 游戏内滚动菜单                 | 01 → 02 → [05 列表与滚动](./05-lists-and-scroll.md) → [07 交互：指针、焦点与导航](./07-input-focus-nav.md)                                             |
| 已经在用，想查某个选项/方法/事件的准确含义  | [03 控件](./03-widgets.md)，以及 [08 附录 §7–§10](./08-lifecycle-and-pitfalls.md) 速查表                                                               |
| 页面跑起来了但「改了数据不更新 / 布局不对」 | [02 §13–14](./02-layout.md) → [08 §4 排查手册](./08-lifecycle-and-pitfalls.md)                                                                         |

---

## 2. 章节一览

| 章节                                                        | 你会做出什么                                      | 涉及的核心概念                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [01 快速开始](./01-quick-start.md)                          | 一个能跑的页面：标题 + 两张卡片 + 一个按钮        | 游戏配置、`MVVMPlugin`、`render()`、帧对齐刷新（工厂注册仅在用 `this.add.*` 时需要） |
| [02 布局](./02-layout.md)                                   | 卡片页 → 仪表盘 → 网格画廊 → 角标/对话框          | 两阶段 `measure/arrange`、四种容器、`LayoutParams`、脏标记与测量缓存                 |
| [03 控件](./03-widgets.md)                                  | 控件画廊：每个控件的所有形态                      | `Label`/`Panel`/`Button`/`Image`/`Spacer`/`Divider`、状态机、主题令牌                |
| [04 文本框与表单](./04-text-inputs.md)                      | 一个带校验的登录表单（含中文 IME）                | `TextField`/`TextArea`、DOM 输入桥、校验与错误态、编辑快捷键                         |
| [05 列表与滚动](./05-lists-and-scroll.md)                   | 220 行虚拟化列表 + 横向滚动条 + 嵌套滚动          | `Repeat` 键控复用/虚拟化、`ScrollView` 手势与裁剪、滚轮链                            |
| [06 数据绑定与主题](./06-data-and-theme.md)                 | 把画廊/仪表盘接到 `ref`/`computed` 上，并支持换肤 | `ref`/`computed`、`bind*` 系列、`BindingContext`、主题令牌                           |
| [07 交互：指针、焦点与导航](./07-input-focus-nav.md)        | 纯键盘 / 手柄可完成的页面                         | `InputRouter`、`FocusManager`、键盘与手柄映射、`NavRepeat`                           |
| [08 生命周期、性能与常见坑](./08-lifecycle-and-pitfalls.md) | —（排查与速查）                                   | 挂载/销毁、`EffectScope`、性能预算、坑清单、全部选项/事件/常量速查表                 |
| [09 Compose 风格 DSL](./09-compose-dsl.md)                  | 把同一批界面写成嵌套调用（`#/compose`）           | `ui()`、`Column`/`Row`/`Panel`/`Scroll`/`List`、反应式参数、双向绑定、`uiscope`      |

---

## 3. 三分钟建立全局印象

四个包，职责单向依赖（`apps → widgets → phaser → { core, layout }`）：

```
@phaser-mvvm/widgets   控件库：Panel/Label/Button/Image/Spacer/Divider/TextField/TextArea/ScrollView/Repeat
@phaser-mvvm/phaser    Phaser 适配层：Widget 基类、UIRoot、输入/焦点路由、场景插件、主题、绑定
@phaser-mvvm/layout    渲染无关的布局引擎（零 Phaser 依赖，可在 Node 单测）
@phaser-mvvm/core      响应式内核与绑定上下文（零 Phaser 依赖）
```

用起来就是三步：

1. **配好游戏**：`plugins.scene` 里注册 `MVVMPlugin`，`mapping: 'mvvm'`；需要中文输入再加 `dom: { createContainer: true }`。
2. **注册工厂**：`installFactories()` + `installWidgetFactories()`，之后就写 `this.add.uiPanel(...)`、`this.add.uiButton(...)`（用 DSL 时这一步同样需要：DSL 复用同一批控件类）。
3. **搭树并挂载**：用 `vbox/hbox/grid/...` 和控件拼出一棵树，`this.mvvm.mount(page)` 交给框架布局与路由输入。

```ts
// 视图就是代码：一棵由容器和控件组成的树
const page = this.add.uiPanel({ direction: 'vertical', gap: 12, padding: 16 }, [
  this.add.uiLabel({ text: 'Hello phaser-mvvm' }),
  this.add.uiButton({ text: '确定', variant: 'primary', onClick: () => console.log('clicked') }),
]);

this.mvvm.mount(page);
```

数据变化不需要你手动重画：绑定的 effect 在每帧固定点批量 flush，然后布局一次（见 [01 §6](./01-quick-start.md)）。

---

## 4. 常见入口

| 我想…                    | 去哪里                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| 跑示例                   | `pnpm dev` → <http://localhost:5173/#/showcase>（场景列表见 [01 §8](./01-quick-start.md)） |
| 查某个控件有哪些选项     | [03](./03-widgets.md)、[04](./04-text-inputs.md)、[05](./05-lists-and-scroll.md)           |
| 查某个布局参数怎么生效   | [02 §3](./02-layout.md)、[08 附录 B §8](./08-lifecycle-and-pitfalls.md)                    |
| 查事件名 / 工厂键 / 常量 | [08 附录 C §9](./08-lifecycle-and-pitfalls.md)                                             |
| 理解「为什么这样设计」   | [`../PLAN.md`](../PLAN.md) 与 [`../adr/`](../adr/README.md)                                |

---

## 5. 术语约定

| 术语              | 含义                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **控件 / Widget** | `Widget` 的子类：既是一个 `Phaser.GameObjects.Container`，又是布局引擎的 `LayoutNode`             |
| **容器**          | 决定子节点排布算法的控件：`box`(vbox/hbox)、`grid`、`stack`、`absolute`、`scroll`                 |
| **节点参数**      | `LayoutParams`：`width`/`padding`/`grow`/`gridColumn`… 每个控件都能写                             |
| **控件选项**      | 控件自己的选项（如 `variant`、`placeholder`）。它和节点参数写在**同一个扁平对象**里，框架负责拆分 |
| **树**            | 用 `addWidget`/工厂的 `children` 参数建立父子关系；只有这棵树参与布局                             |
| **rect**          | 布局引擎分配给节点的矩形（父容器局部坐标）；`widget.appliedRect` 可读                             |
| **flush**         | 把挂起的响应式更新跑一遍；UI 默认 `flush: 'frame'`，每帧一次，与布局同帧完成                      |
| **mount**         | `this.mvvm.mount(widget)`：把子树挂到 `UIRoot` 上、接好输入路由，并立刻布局一次                   |
