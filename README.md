# phaser-mvvm

[![CI](https://github.com/universe-st/phaser-mvvm/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/universe-st/phaser-mvvm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)
[![Phaser 4](https://img.shields.io/badge/Phaser-4.2.1-blueviolet.svg)](https://github.com/phaserjs/phaser)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Node 24 (CI)](https://img.shields.io/badge/Node-24-339933.svg)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10.34.5-f69220.svg)](https://pnpm.io/)

基于 **[Phaser 4](https://github.com/phaserjs/phaser)**（`phaser@4.2.1 "Giedi"`）的 **MVVM UI 框架**：在 Phaser 4 的渲染管线上提供「响应式数据 + 声明式视图 + 自动布局 + 基础控件」的完整方案 —— **不 fork Phaser**，只用公开 API 与插件/工厂注册，游戏逻辑照常使用原生 Phaser。

> 上游引擎：**[phaserjs/phaser](https://github.com/phaserjs/phaser)**（官网 [phaser.io](https://phaser.io)）。本项目是**独立第三方框架**，与 Phaser 官方无隶属关系；`phaser` 是 **peer dependency**（`^4.2.0`），安装本项目时请自行安装 Phaser（见 §3）。

> **当前状态：M0–M9 全部条目已交付（只剩真实屏幕阅读器与真实手柄硬件的人工验证）；四个包已升到 `1.0.0`，公开 API 自第 110 轮起**冻结**并由 `pnpm api:check` 守住（[ADR-0011](./docs/adr/0011-public-api-freeze.md)）。**
> 已交付：workspace 骨架与 CI、响应式内核 `@phaser-mvvm/core`（281 个单测）、渲染无关的两阶段布局引擎 `@phaser-mvvm/layout`（314 个单测，含黄金快照与 `perf.test.ts` 性能门禁）、Phaser 4 适配层（`Widget`/`UIRoot`/`MVVMPlugin`/输入与焦点路由/`NavSource` 导航来源/主题令牌/绑定/模态与页面栈/`Router`/动效，386 个单测）、控件库 `@phaser-mvvm/widgets`（Label/Panel/Button/Image/Slider/Spacer/Divider/TextField/TextArea/ScrollView/Repeat/VirtualKeyboard/Branch + DOM 输入桥，396 个单测）与 **Compose 风格 DSL**（`@phaser-mvvm/widgets/compose`，推荐写视图的方式）。**合计 1377 个单测**，另有可执行的性能/体积门禁（`pnpm --filter @phaser-mvvm/layout run test`、`pnpm size`）。
> 验收场：**23 个场景**（完整清单与每个场景的判据见 §2.4），其中常驻门禁是 `#/compose`（DSL，含工厂 API 与 DSL 的逐节点 parity 校验）、`#/showcase`（全部控件与布局形态，已迁移到 DSL，含像素门禁）、`#/states`（交互状态矩阵）、`#/lifecycle`（创建→销毁 100 次泄漏门禁）、`#/list`（虚拟化：一行一步只建一行、键控复用、视口裁剪）、`#/scroll`、`#/modal`（模态：焦点陷阱 / 遮罩拦截 / `Esc` / 叠层 / 100 次开关无泄漏）、`#/pages`（页面栈：返回时状态与焦点复原、`Esc` 逐层路由）、`#/options`（没有 demo 的选项的 A/B 卡）、`#/keyboard`（手柄文本输入）、`#/hud`（相机钉住的 HUD）、`#/events`（指针事件链）、`#/a11y`（无障碍镜像与 `aria-live`）、`#/config`（插件选项）、`#/uiscene`（`UIScene` 基类）。鼠标、触摸、手柄（D-Pad/摇杆）三条输入路径与无障碍镜像都有常驻验收。
> 各轮验收证据与已知边界见 [`docs/ACCEPTANCE-compose-dsl.md`](./docs/ACCEPTANCE-compose-dsl.md)、[`ACCEPTANCE-layout-defects.md`](./docs/ACCEPTANCE-layout-defects.md)、[`ACCEPTANCE-lifecycle.md`](./docs/ACCEPTANCE-lifecycle.md)、[`ACCEPTANCE-states.md`](./docs/ACCEPTANCE-states.md)、[`ACCEPTANCE-performance.md`](./docs/ACCEPTANCE-performance.md)、[`ACCEPTANCE-dsl-entry.md`](./docs/ACCEPTANCE-dsl-entry.md)、[`ACCEPTANCE-round8.md`](./docs/ACCEPTANCE-round8.md)；未修/待验证项见 [`docs/DEFECT-BACKLOG.md`](./docs/DEFECT-BACKLOG.md)。
> **公开 API 已冻结（1.0）**：五个入口点（四个包 + `widgets/compose`）的 **817 个导出名**记在 [`docs/API-SURFACE.json`](./docs/API-SURFACE.json)，`pnpm api:check` 在 CI 里守它（见 [ADR-0011](./docs/adr/0011-public-api-freeze.md)）。冻结的是**名字集合**：新增、改名、删除导出都仍然允许，但必须新开一篇 ADR 并在同一次提交里重新冻结快照（`UPDATE_API=1 node scripts/check-api-surface.mjs`）。行为契约由 `pnpm -r run test`、`pnpm docs:check`、`node scripts/visual-check.mjs`、`pnpm size` 与各验收页矩阵承担。

### 特性速览

| 特性               | 说明                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **响应式数据**     | `ref`/`reactive`/`computed`/`watch`/`effectScope` + 四档调度器（`sync`/`pre`/`post`/`frame`）：默认帧对齐，同一帧里的多次写入只触发一次布局（[ADR-0008](./docs/adr/0008-reactivity-and-scheduler.md)） |
| **声明式视图**     | Compose 风格 DSL（`@phaser-mvvm/widgets/compose`）：嵌套调用 + 内容 lambda，没有 `this.add` 前缀、没有 children 数组；工厂 API（`this.add.uiButton(...)`）建的是同一批控件，可混用                     |
| **两阶段自动布局** | 测量 → 排布，五种形态 `box`/`grid`/`stack`/`scroll`/`absolute`；固定、百分比、内容自适应、填充、伸缩、间距、对齐；脏传播 + relayout boundary + 约束缓存 + 对象池                                       |
| **渲染无关的基座** | `core` 与 `layout` **零 Phaser 依赖**（连类型都不引），因此能在纯 Node 下单测，并带黄金快照与性能门禁                                                                                                  |
| **数据槽位**       | 选项接受「常量 / `ref` / getter」：`value`、`disabled`、`error`、`variant`、`texture`/`frame`、`min`/`max`、`maxLines`… 翻值即重绘，不必绕到命令式绑定                                                 |
| **控件库**         | `Panel`/`Label`/`Button`/`Image`/`Slider`/`Spacer`/`Divider`/`TextField`/`TextArea`/`ScrollView`（含嵌套与双轴）/`Repeat`（含虚拟化）/`VirtualKeyboard`/`Branch`                                       |
| **页面体系**       | `ModalHost`/`PageHost`/`Router`/`UIScene` + 转场动效；返回键逐层路由：模态 → 页面 → 场景（`Esc` / 手柄 B）                                                                                             |
| **输入与无障碍**   | 鼠标 / 触摸 / 键盘 / 手柄（D-Pad + 摇杆）四条路径；指针事件链支持传递、拦截、消费（[ADR-0010](./docs/adr/0010-pointer-event-chain.md)）；隐藏 DOM 镜像供屏幕阅读器与 `aria-live` 播报                  |
| **可验证**         | 1377 个单测 + 23 个示例验收场景 + 无头 Chrome 的几何/像素/可访问性树门禁 + 性能与体积预算，CI 全绿（见 §7）                                                                                            |

---

## 1. 目标与非目标（摘要）

完整清单见 [`docs/PLAN.md` §1](./docs/PLAN.md)。

**目标（Phase 1）**

| #   | 目标                                                                                                      | 里程碑       |
| --- | --------------------------------------------------------------------------------------------------------- | ------------ |
| G1  | 响应式数据层：`ref/reactive/computed/watch`，变更后同帧批量刷新、无重复布局                               | M1           |
| G2  | 自动布局：纵向/横向/网格/层叠/绝对定位；固定、百分比、内容自适应、填充、伸缩、间距、内边距、对齐          | M2           |
| G3  | MVVM 绑定：单向、双向（表单）、命令、列表 `repeat`（键控复用 + 可选虚拟化）、格式化器/校验器              | M6           |
| G4  | 基础控件：`Panel`、`Label`、`TextField`、`TextArea`、`Button`、`Image`、`Spacer`、`Divider`、`ScrollView` | M4 / M5 / M7 |
| G5  | 与 Phaser 4 正交：不 fork、只用公开 API；游戏逻辑照常用原生 Phaser                                        | M3           |
| G6  | 可测试：响应式与布局引擎零渲染依赖，可在 Node 中单测（含布局黄金快照）                                    | M1 / M2      |

**非目标（明确排除，避免范围失控，见 PLAN §1.2）**

- 不做 HTML/CSS 引擎或浏览器兼容层（无 CSS 选择器、层叠、伪类）。
- 不做可视化 UI 编辑器 / 设计稿导入。
- 不做 3D、物理、粒子相关控件。
- **不兼容 Phaser 3 API**（只吸收 rexUI 的设计经验）。
- 不做 WCAG 全量合规认证：a11y 限定为「键盘全可达 + 手柄导航 + 隐藏 DOM 镜像（供屏幕阅读器与 `aria-live` 播报）」，**M9**。
- Phase 1 不做 URL 路由（只做轻量 `Router`：路由名 → Page，**M8**）；模板层 `@phaser-mvvm/template` 延后到 **Phase 2**。

---

## 2. 架构

### 2.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ apps/examples (Vite)                                         │  示例与验收场
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/template   JSON/模板 → builder 编译（Phase 2）   │  可选层（延后）
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/widgets    Panel/Label/Button/Image/Slider/     │  控件库
│                         Spacer/Divider/TextField/TextArea/   │  （与 phaser 一样
│                         ScrollView/Repeat/VirtualKeyboard/   │   直接 import phaser）
│                         Branch                               │
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/phaser     Widget 基类(Container 适配)、UIRoot、 │  Phaser 适配层
│                         测量器、输入/焦点/导航路由、          │  （与 widgets 都直接
│                         ScenePlugin、工厂注册、主题、页面体系  │   import phaser）
│                         (Modal/Pages/Router/UIScene/动效)     │
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/layout     纯布局引擎：约束、测量、排布、        │  零 Phaser 依赖
│                         脏标记、缓存、像素对齐                │  → 可在 Node 单测
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/core       响应式(reactive/ref/computed/watch/  │  零 Phaser 依赖
│                         effect/scope)、集合、绑定上下文、     │
│                         表达式编译、调度器                    │
└──────────────────────────────────────────────────────────────┘
```

依赖方向严格单向（禁止反向与环）：`apps → widgets → phaser → { core, layout }`；`core` 与 `layout` 互不依赖，是两个独立的零渲染基座。详见 [`docs/adr/0001-package-layout.md`](./docs/adr/0001-package-layout.md)。

**最底下那一层是上游引擎**：整张图都跑在 **[Phaser 4](https://github.com/phaserjs/phaser)**（`phaser@4.2.1`，peer dependency）的公开 API 之上 —— `phaser` 适配层与 `widgets` 控件层直接 `import phaser`，`core`/`layout` 则完全不知道 Phaser 的存在。仓库不含 Phaser 源码，也不修改它（[ADR-0005](./docs/adr/0005-phaser-dependency.md)）。

### 2.2 包职责

| 包                      | 职责                                                                                                                                                                                                                                                        | 状态                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `@phaser-mvvm/core`     | 响应式、调度器（`sync/pre/post/frame`）、集合、绑定上下文、路径表达式编译（不使用 `eval`/`new Function`）                                                                                                                                                   | **已完成**（M1；M6 补绑定）                                   |
| `@phaser-mvvm/layout`   | 约束、`LayoutParams`、测量、排布（box/grid/stack/scroll/absolute）、脏传播与 relayout boundary、测量缓存、像素对齐、对象池                                                                                                                                  | **已完成**（M2）                                              |
| `@phaser-mvvm/phaser`   | `Widget` 基类、`UIRoot`、`PhaserTextMeasurer`(+LRU)、`InputRouter`、`FocusManager`、`nav.ts`/`nav-sources.ts`（`NavSource` 抽象 + 键盘/手柄来源）、`A11yBridge`、`MVVMPlugin`、工厂注册、主题、`UIScene`/`PageHost`/`ModalHost`/`Router`/`TransitionRunner` | **已完成**（M3 适配层，M8 场景与页面，M9 导航与 a11y）        |
| `@phaser-mvvm/widgets`  | 控件库：`Panel`/`Label`/`Button`/`Image`/`Slider`/`Spacer`/`Divider`（**M4**）、`TextField`/`TextArea`（**M5**）、`Repeat`（**M6**）、`ScrollView`（**M7**）、`VirtualKeyboard`/`Branch` 与 `compose` DSL                                                   | **已完成**（M4 起；模态不在本包，见 `phaser` 的 `ModalHost`） |
| `@phaser-mvvm/template` | JSON/模板 → builder 编译                                                                                                                                                                                                                                    | **未创建，Phase 2**                                           |

> 计划中但**代码里没有**这个名字：`Page`/`PageStack`/`ModalStack`（实际是 `PageHost`/`ModalHost`）、`Modal` 控件（模态是 `this.mvvm.modal`，不是 widgets 的控件）。~~`NavSource`~~ **第 110 轮落地了**：`@phaser-mvvm/phaser` 导出 `NavSource`/`NavSourceHost`/`NavSourceRegistry` 与内置的 `KeyboardNavSource`/`GamepadNavSource`，插件侧是 `registerNavSource()`/`unregisterNavSource()`/`navSources`（见 [guide 07 §4.1](./docs/guide/07-input-focus-nav.md)）。

### 2.3 当前进度（M0–M9 已交付，只剩真机人工验证；公开 API 已冻结为 1.0）

里程碑级事实（M0–M2 的证据见 [`docs/ACCEPTANCE-M0-M2.md`](./docs/ACCEPTANCE-M0-M2.md)，其余见各轮 `ACCEPTANCE-*.md`）：

| 位置                   | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src`    | **M1 完成**：`ref/reactive/computed/watch/watchEffect/effect/effectScope/makeObservable`、`sync`/`pre`/`post`/`frame` **四档**调度器（`nextTick`/`flushSync`/`flushFrame`/`configureScheduler`）、绑定（路径编译/模板/转换器/`BindingContext`）、循环更新保护；**281 个单测**                                                                                                                                                                                           |
| `packages/layout/src`  | **M2 完成**：`BoxConstraints`、`LayoutParams` 归一化、`LayoutEngine`（测量缓存 + 脏传播 + relayout boundary + 像素对齐）、`box`/`grid`/`stack`/`scroll`/`absolute` **五种**排布、`measureContent`/`applyRect` 节点契约；**314 个单测**（含 4 个黄金快照与 `perf.test.ts` 性能门禁）                                                                                                                                                                                     |
| `packages/phaser/src`  | **M3 完成**：`Widget`（`Container` + `LayoutNode`）、`UIRoot`（含安全区）、`MVVMPlugin`（`this.mvvm`，帧对齐 flush）、`input`/`focus`/`nav`/`a11y`/`theme`/`skin`/`binding`；**M8/M9**：`modal`/`pages`/`router`/`UIScene`/`transition`/`page-motion`/`back-plan`/`reveal`/`pointer-chain`；工厂注册、选项审计（`option-keys`）、容器选项槽位（`container-options`）；`nav-sources`（内置导航来源）、`plugin-config`（选项合并与 Game Config 条目通道）；**386 个单测** |
| `packages/widgets/src` | **M4–M8 已完成**：`Label`/`Panel`/`Button`/`Image`/`Slider`/`Spacer`/`Divider`/`TextField`/`TextArea`/`ScrollView`/`Repeat`/`VirtualKeyboard`/`Branch` + DOM 输入桥 + `compose.ts`（DSL）+ 一批零 Phaser 的纯逻辑模块（`text-edit`/`text-truncate`/`scroll-plan`/`repeat-plan`/`keyboard-plan`/`slider-geometry`/`zoom-plan`…）；**396 个单测**                                                                                                                         |
| `apps/examples/src`    | **23 个场景**（`main.ts` 的 `SCENES` 注册表，hash 即场景名）：`#/m0`、`#/probe`、`#/stack`、`#/gallery`、`#/dashboard`、`#/bindings`、`#/form`、`#/list`、`#/scroll`、`#/showcase`、`#/compose`、`#/lifecycle`、`#/states`、`#/options`、`#/modal`、`#/pages`、`#/router`、`#/uiscene`、`#/hud`、`#/a11y`、`#/config`、`#/keyboard`、`#/events`；页面底部 `#status` 输出引擎实际分配的 rect，`#demo-state` 逐帧发布状态，供无头校验断言                                 |
| `scripts/`             | `visual-check.mjs`（CDP 驱动单个无头 Chrome：读 `#status` 几何 + 截图 + 像素比对 + `Accessibility.getFullAXTree` 树断言）、`check-doc-snippets.mjs` / `check-doc-options.mjs`（指南门禁 `pnpm docs:check`）、**`check-api-surface.mjs`（公开 API 冻结门禁 `pnpm api:check`，ADR-0011）**、`size-check.mjs`（`pnpm size`）、`png-sample.py`                                                                                                                              |
| `docs/`                | `PLAN.md`、`adr/`（**11 篇**，ADR-0001…0011）、**34 篇** `ACCEPTANCE-*.md`、**`API-SURFACE.json`（817 个冻结导出名）**、`PITFALLS.md`、`DEFECT-BACKLOG.md`、`HANDOVER.md`、`guide/`（9 章 + 索引）；`api/`、`widget-spec/` 属 **M10**，尚未创建                                                                                                                                                                                                                         |

仓库级门禁目前全绿：`pnpm -r run typecheck`（**5/5**）、`pnpm -r run test`（**1377**：core 281 / layout 314 / phaser 386 / widgets 396）、`pnpm -r run build`、`pnpm exec prettier --check .`、`pnpm docs:check`、`pnpm api:check`、`pnpm size`、`pnpm run build:examples`、`node scripts/visual-check.mjs`（**96 个像素检查 + 4 张可访问性树断言全部 OK**）。四个包的版本已从 `0.0.0` 升到 **`1.0.0`**，公开名字集合由 [ADR-0011](./docs/adr/0011-public-api-freeze.md) 冻结。

### 2.4 示例场景一览（23 个）

`pnpm dev` 后按 **hash** 切换场景（`http://localhost:5173/#/showcase`）；hash 即场景名，页面底部 `#status` 打印引擎实际分配的矩形，`#demo-state` 逐帧发布可断言的键值。**这些场景不只是 demo，它们就是验收场**：`scripts/visual-check.mjs` 会在其中 13 个里做几何、像素与可访问性树断言。

| 场景          | 验收内容（核心判据）                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `#/m0`        | M0 骨架与最小场景（插件挂载、工厂可用）                                                                                                     |
| `#/probe`     | 几何探针：把布局实际分配的 rect 写进 `#status`                                                                                              |
| `#/stack`     | `stack` 排布与层叠定位面                                                                                                                    |
| `#/gallery`   | 控件画廊（工厂 API）：每个控件每种状态；禁用控件拒绝悬停与激活且不在焦点集合、Tab 顺序与环绕                                                |
| `#/dashboard` | 仪表盘式页面：多容器组合的常规布局                                                                                                          |
| `#/bindings`  | 绑定层状态机：派生值随点击重算、`bindEnabled` 在两个边界自禁用、`bindVisible` 折叠后行位移、`Replace view` 后绑定重挂                       |
| `#/form`      | 表单状态机：校验失败→修正、`maxLength`、`Enter`/`Ctrl+Enter` 提交、**纯 Canvas 输入路径**（拖动选择、双击选词、三击选行、拖到框外自动滚动） |
| `#/list`      | `Repeat` 虚拟化：一行一行滚时 `created` 每步恰好 +1、窗口内交换两行不重建、overscan 行点了没反应、`churn(20)` 计数回基线                    |
| `#/scroll`    | 滚动与焦点：口套口 + pinch zoom、橡皮筋、焦点从不落在可见带外、拖动 300px 不激活 chip、拖拽与滚轮用完传给外层                               |
| `#/showcase`  | **控件与布局全家福**（11 个分区，已迁到 DSL）：每个控件、每个布局容器、每组布局参数；`sizing` 分区是像素门禁                                |
| `#/compose`   | **DSL 验收场**：工厂 API 与 DSL 的逐节点 parity、静态/响应式控制流、`Branch`、State slots 分区（像素门禁）                                  |
| `#/lifecycle` | **泄漏门禁**：重启场景 n 次，10 项计数（含 `frameListeners`）每项只有一个取值，重启后仍可点可输入                                           |
| `#/states`    | 交互状态矩阵：真实鼠标/键盘/触摸驱动 hover/pressed/focus/error/disabled 的迁移，并订阅 `widget:*` 事件                                      |
| `#/options`   | **没有 demo 的选项**的 A/B 卡（键表反查）：`Repeat.update`、`ScrollView.inertia`、`Grid.autoFlow`、双轴口、响应式布局槽位（像素门禁）       |
| `#/modal`     | 模态：焦点陷阱、遮罩拦截（A/B：有/无对话框时同一个点击的去向）、`Esc`、嵌套叠层、100 次开关无泄漏；**同时是可访问性树门禁**                 |
| `#/pages`     | 页面栈：被盖住的页不可点不可输入、`pop()` 后状态与焦点逐字保留、`Esc` 顺序（模态 → 页面 → 应用返回）；**同时是可访问性层级门禁**            |
| `#/router`    | 路由表：`user/:id` 两次访问各有一份状态、`replace`/`back`/`popToRoot`、真实栈与 `current` 一致                                              |
| `#/uiscene`   | `UIScene` 基类：`content()` 自动建树、换页销毁前一页、`swap(20)` 不泄漏、`onBack()` 的两个分支                                              |
| `#/hud`       | 相机钉住的 HUD（`setScrollFactor(0)`）：HUD 钉住不动而世界真的滚动、世界区域点击穿透到游戏对象                                              |
| `#/a11y`      | 无障碍镜像与 `aria-live`：逐属性读真实 DOM 而非控件树；不该被镜像的 `Label` 必须缺席                                                        |
| `#/config`    | 插件选项：`MVVMPlugin.configure` 的默认值真的到达场景、运行期补丁与子选项包深合并、安全区预留                                               |
| `#/keyboard`  | 手柄文本输入：D-Pad 走查 + `A` 打字 + `Enter` 提交；`⇧` 一次性 vs 锁定、换键集是数据槽；**38 个控制节点的 AX 树断言**                       |
| `#/events`    | 指针事件链：传递/拦截/消费的投递台账（「某层一次都没被问过」正是拦截的判据）；像素门禁                                                      |

每个场景的完整矩阵（含阳性对照与实测数字）见 `docs/ACCEPTANCE-<场景>.md`，索引见 §7。

---

## 3. 快速开始

前置：**Node 24**（CI 固定 24，`engines` 声明 `>=20`）、**pnpm 10**（仓库 `packageManager` 固定为 `pnpm@10.34.5`）。

```bash
# 0) 获取源码（四个包尚未发布到 npm，当前请从源码使用）
git clone https://github.com/universe-st/phaser-mvvm.git
cd phaser-mvvm

# 1) 安装依赖（workspace 链接；phaser 由各包作为 peer dependency 从外部引入）
pnpm install

# 2) 启动示例（Vite dev server，端口固定 5173）
pnpm dev
#   → http://localhost:5173
#   注意：端口写死为 5173 且 strictPort: true，被占用时会直接报错而不是换端口；
#   请先释放 5173，或先停止其它 dev server。

# 3) 其它常用命令
pnpm test          # pnpm -r run test（core/layout 为纯 Node vitest）
pnpm typecheck     # pnpm -r run typecheck（tsc --noEmit，strict）
pnpm build         # pnpm -r run build（tsup：ESM + CJS + d.ts）
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
pnpm build:examples # 构建示例（vite build）
pnpm preview       # 预览构建产物（端口 4173）
pnpm docs:check    # 指南门禁（片段标识符 / 惯用法 / 词汇 / 选项键）
pnpm api:check     # 公开 API 冻结门禁（5 个入口点的导出名 vs docs/API-SURFACE.json）
pnpm size          # 体积预算（core+layout、phaser+widgets 的 min+gzip）

# 4) 只验证自己负责的包（并行开发期推荐）
pnpm --filter @phaser-mvvm/layout run typecheck
pnpm --filter @phaser-mvvm/layout run test

# 5) 几何 + 像素 + 可访问性树验收（需要一个无头 Chrome，仅 macOS/Linux）
node scripts/visual-check.mjs
```

> 示例自 **M0** 起逐步补齐：入口 `apps/examples/src/main.ts` 与场景目录已存在（含 M0 验收场景与 probe 场景），但能否跑通取决于当前检出时各包 `src/` 的完成度（见 §2.3）。控件画廊页自 **M4** 起，表单示例自 **M5** 起。
>
> **在游戏里使用**：`packages/*` 已配好 `exports`/`publishConfig`（ESM + CJS + `d.ts`），四个包的版本是 **`1.0.0`**（公开 API 已冻结，见 [ADR-0011](./docs/adr/0011-public-api-freeze.md)），但**尚未发布到 npm**。在发布之前，请在 monorepo 内以 workspace 协议引用（`"@phaser-mvvm/widgets": "workspace:*"`），或直接使用本仓库的示例工程。`@phaser-mvvm/phaser` 与 `@phaser-mvvm/widgets` 把 `phaser@^4.2.0` 声明为 **peer dependency**，需要由你的工程提供。

---

## 4. 最小代码示例（已实现）

视图用 **Compose 风格 DSL** 写：嵌套调用 + 内容 lambda，没有 `this.add` 前缀、没有 children 数组。

```ts
import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { MVVMPlugin } from '@phaser-mvvm/phaser';
import {
  Button,
  Divider,
  List,
  Panel,
  render,
  Row,
  Scroll,
  Spacer,
  Text,
  TextField,
} from '@phaser-mvvm/widgets/compose';
// 用 DSL 不需要 installFactories()/installWidgetFactories()：那两个只注册 this.add.* 工厂方法。

// ViewModel：普通 TS 类 + ref/computed
class UserFormVM {
  name = ref('');
  users = ref<User[]>([]);
  valid = computed(() => this.name.value.trim().length >= 2);
  save(): void {
    /* … */
  }
}

export class DemoScene extends Phaser.Scene {
  create(): void {
    const vm = new UserFormVM();

    render(this.mvvm, () => {
      Panel({ variant: 'surface', radius: 12, padding: 16, width: 480, gap: 12 }, () => {
        Text('用户信息', { size: 'lg' });
        TextField({ value: vm.name, label: '姓名', placeholder: '请输入姓名', clearable: true });
        Text(() => (vm.valid.value ? '姓名有效' : '姓名至少 2 个字符'), { tone: 'muted' });
        Divider({});

        Scroll({ direction: 'vertical', height: 200, width: 'fill' }, () => {
          List(
            {
              items: () => vm.users.value,
              key: (user) => user.id,
              virtualize: true,
              itemExtent: 34,
            },
            (user) => {
              Row({ gap: 8, height: 30, alignItems: 'center', width: 'fill' }, () => {
                Text(() => user.name);
                Spacer({ flex: true });
              });
            },
          );
        });

        Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
          Button('取消', { variant: 'ghost' });
          Button('保存', { variant: 'primary', onClick: () => vm.save() });
        });
      });
    });
  }
}

new Phaser.Game({
  // …
  dom: { createContainer: true },
  plugins: { scene: [{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm' }] },
  scene: [DemoScene],
});
```

三件事需要记住：

1. **`render(this.mvvm, () => { … })` 是入口**：建树与挂载一次完成（底层等价形式是 `const page = ui(this, () => { … }); this.mvvm.mount(page);`，需要在挂载前拿到根控件时用后者）。
2. **数据槽位接受常量 / `ref` / getter**：`Text(() => …)` 是单向，`TextField({ value: ref })` 是双向（IME 组合期暂停写回）。
3. **工厂 API 仍然可用**（`this.add.uiButton(...)`、`vbox([...])`）：DSL 只是更顺手的写法，两者建的是同一批控件，可混用。

另外两点容易漏：

- **场景插件必须装**：`plugins: { scene: [{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm' }] }` 是 `this.mvvm` 的来源（`mapping` 决定属性名）。`this.mvvm` 的**类型**来自 `@phaser-mvvm/phaser` 的模块增强（`declare module 'phaser'`），只要从该包 import 过任何东西就生效。
- **输入与无障碍需要 DOM 容器**：`dom: { createContainer: true }` 让隐藏的 `<input>`/`<textarea>` 镜像能挂进页面（文本框的 IME、剪贴板与屏幕阅读器都靠它）；纯 Canvas 输入路径用 `dom: false` 显式选择，不需要这个容器。

完整教程见 [`docs/guide/09-compose-dsl.md`](./docs/guide/09-compose-dsl.md)；可运行示例见 `pnpm dev` → `#/compose`（DSL 逐控件验收，含工厂 API 与 DSL 的逐节点 parity 对照）与 `#/showcase`（全部控件与布局形态的全家福，已迁移到 DSL）。

---

## 5. 开发约定

1. **TypeScript strict**：继承 `tsconfig.base.json`，开启 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`verbatimModuleSyntax` 等；类型检查用 `tsc -p tsconfig.json`（`noEmit`），不做跨包 composite 构建。
2. **Prettier 统一格式**：配置见 `.prettierrc.json`（`singleQuote`、`printWidth: 100`、`trailingComma: all`、`semi`、`arrowParens: always`）。提交前跑 `pnpm format`；CI 跑 `pnpm exec prettier --check .`。`docs/PLAN.md` 已在 `.prettierignore` 中（它是冻结的评审文档，不做格式化）。
3. **相对导入不带扩展名**：`import { ref } from './reactivity/ref'`（`moduleResolution: bundler`）。跨包引用走包名（`@phaser-mvvm/core`），由 workspace 协议解析到源码。
4. **Phaser 只出现在适配层与控件层**：`core`/`layout` 必须零 Phaser 依赖（含类型）；`packages/phaser` 与 `packages/widgets` 都把 `phaser` 当 peer dependency **直接 `import`**（每个控件都在 `new Phaser.GameObjects.…`）。上面的依赖方向说的是**分层**：`apps/examples` 按需依赖四个包（`widgets`/`phaser`/`core`/`layout`），不是「只 import widgets」。构建时 `phaser` 一律 `--external`。见 [ADR-0001](./docs/adr/0001-package-layout.md)、[ADR-0003](./docs/adr/0003-layout-is-renderer-agnostic.md)、[ADR-0005](./docs/adr/0005-phaser-dependency.md)。
5. **布局算法不依赖渲染**：`packages/layout` 里**没有** `Measurer` 接口 —— 节点契约是 `measureContent(constraint)` / `applyRect(rect)`；文本度量由适配层的 `TextMeasurer` 与控件层的 `text-metrics.ts` 在各自那一侧完成，测试用等宽假测量器，保证黄金快照确定。
6. **响应式副作用必须归入 `EffectScope`**：控件/页面的 `destroy()` 要停 scope、注销输入、归还对象池；泄漏回归是硬门禁（场景创建→销毁 100 次后计数归零）。
7. **UI 刷新默认帧对齐**（`flush: 'frame'`）：不要用 `sync` 绕过批量刷新。见 [ADR-0008](./docs/adr/0008-reactivity-and-scheduler.md)。
8. **新增包、引入运行时依赖、改变包间依赖方向 —— 必须新增一篇 ADR**（新编号，不修改历史 ADR）。见 [`docs/adr/README.md`](./docs/adr/README.md)。
9. **不使用 `eval` / `new Function`**：路径表达式编译为 getter/setter 闭包，保证 CSP 环境可用。
10. **提交前自查**：`pnpm format:check`、受影响包的 `typecheck` / `test`；涉及控件的改动需附带示例页（M4 起截图回归）。
11. **CI**：`.github/workflows/ci.yml` 在 `push` 与 `pull_request` 上运行 Prettier 检查、`pnpm api:check`（公开 API 冻结门禁）、逐包 `typecheck`、逐包 `test`、逐包 `build` 与示例构建。四个包当前都有测试（合计 **1377** 个用例：core 281 / layout 314 / phaser 386 / widgets 396）；`packages/phaser`、`packages/widgets` 的 `test` 脚本带 `--passWithNoTests`，只为「暂时没有测试也不至于失败」，不代表可以长期没有断言。

---

## 6. 目录结构

下面是 PLAN §3.2 定义的**目标结构**（根级文件与 `scripts/`、`docs/` 的现状已按实际检出补齐；标 `# 尚未创建` 的目录现在不存在，当前实际快照见 §2.3）：

```
phaser-mvvm/
├─ README.md                           # 本文件
├─ LICENSE                             # MIT
├─ CONTRIBUTING.md / AGENTS.md         # 人读的贡献指南 / AI 代理与自动化协作手册
├─ pnpm-workspace.yaml
├─ tsconfig.base.json                  # strict: true, noUncheckedIndexedAccess
├─ .prettierrc.json / .prettierignore / .gitignore
├─ .github/workflows/ci.yml
├─ packages/
│  ├─ core/          src/{reactivity,collections,binding,expression,scheduler,util}
│  ├─ layout/        src/{constraint,params,measure,arrange,arrangers,nodepool,snap}
│  ├─ phaser/        src/{Widget,UIRoot,measurer,input,focus,nav,a11y,plugin,factory,theme,pool}
│  │                 src/scene/{UIScene,Page,PageStack,ModalStack,Router}   # M8
│  ├─ widgets/       src/{panel,label,textfield,textarea,button,image,spacer,divider,scrollview,repeat,modal}
│  └─ template/      src/{parser,compiler,renderer}            # Phase 2（尚未创建）
├─ apps/
│  └─ examples/      # index.html + vite.config.ts（dev 端口 5173）
│                    # 控件画廊（每个控件一页）+ 性能基准页，自 M4 起
│                    # apps/form-demo 规划中（完整 MVVM 表单），尚未创建
├─ scripts/          # visual-check.mjs（无头 Chrome 几何/像素/AX 树）、docs 门禁、size-check.mjs
└─ docs/             # PLAN.md、adr/、guide/、PITFALLS.md、ACCEPTANCE-*.md、HANDOVER.md
                     # api/（TypeDoc，M10）、widget-spec/（M10）尚未创建
```

---

## 7. 文档索引

| 文档                                                                           | 内容                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/PLAN.md`](./docs/PLAN.md)                                               | **唯一事实来源**：目标/非目标、技术基线与源码调研结论、总体架构、核心设计、API 草案、里程碑 M0–M10、测试与性能预算、风险对策、已冻结决策（§10.1–§10.3）                              |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                         | 贡献指南：环境、提交与 PR 流程、代码风格、必须走 ADR 的改动                                                                                                                          |
| [`AGENTS.md`](./AGENTS.md)                                                     | AI 编码代理与自动化协作者的操作手册：硬约束、验收场与探针用法、逐条踩坑索引（人读入门看本文件与 `CONTRIBUTING.md`）                                                                  |
| [`docs/guide/`](./docs/guide/README.md)                                        | **使用指南（教程式，以已实现代码为准）**：快速开始、布局、全部控件、文本框与表单、列表与滚动、数据绑定与主题、交互与导航、Compose 风格 DSL、生命周期与速查表                         |
| [`docs/ACCEPTANCE-options.md`](./docs/ACCEPTANCE-options.md)                   | 验收记录：选项审计（拼错的选项在开发模式下被指名 + 建议、发布模式零输出、全示例零误报与门禁的阳性对照）                                                                              |
| [`docs/ACCEPTANCE-a11y.md`](./docs/ACCEPTANCE-a11y.md)                         | 验收记录：无障碍镜像与浏览器可访问性树、`aria-live` 播报、**状态变化主动同步（V52）**                                                                                                |
| [`docs/ACCEPTANCE-compose-dsl.md`](./docs/ACCEPTANCE-compose-dsl.md)           | 验收记录：Compose DSL、逐控件／逐布局实测、缺陷修复清单                                                                                                                              |
| [`docs/ACCEPTANCE-layout-defects.md`](./docs/ACCEPTANCE-layout-defects.md)     | 验收记录：布局引擎缺陷批次（缓存键、脏标记时机、`reset`、上下文池、stretch 钳制）与 Playwright 复现证据                                                                              |
| [`docs/ACCEPTANCE-states.md`](./docs/ACCEPTANCE-states.md)                     | 验收记录：交互状态矩阵（hover/press/focus/error/disabled 真实输入扫描）与指针聚焦缺陷                                                                                                |
| [`docs/ACCEPTANCE-options.md`](./docs/ACCEPTANCE-options.md)                   | 验收记录：选项审计（拼错的选项在开发模式下被指名 + 建议、发布模式零输出、全示例零误报与门禁的阳性对照）                                                                              |
| [`docs/ACCEPTANCE-keyboard.md`](./docs/ACCEPTANCE-keyboard.md)                 | 验收记录：`VirtualKeyboard` 屏幕键盘（手柄 `A` 打字 / 鼠标 / 触摸、`⇧` 一次性与锁定、换键盘泄漏门禁、38 个控制节点的可访问性树断言）与三个缺陷（V47/V48/V49）                        |
| [`docs/ACCEPTANCE-performance.md`](./docs/ACCEPTANCE-performance.md)           | 验收记录：PLAN §8 性能与体积预算的实测（首发读数 1000 节点 0.06 ms、无变化帧零测量、缓存 95.6%、体积 18.3/14.7 KB；第 107 轮复测 0.108 ms / 18.6 / 31.3 KB 见该记录 §7）             |
| [`docs/ACCEPTANCE-dsl-entry.md`](./docs/ACCEPTANCE-dsl-entry.md)               | 验收记录：`render()` 入口、控制流演示、DSL 优先的快速开始与文档对齐                                                                                                                  |
| [`docs/ACCEPTANCE-round8.md`](./docs/ACCEPTANCE-round8.md)                     | 验收记录：命令绑定的指针可达性（V4 复现+修复）与 `#/showcase` 迁移到 DSL 的等价性核对                                                                                                |
| [`docs/ACCEPTANCE-v1-camera-pinned.md`](./docs/ACCEPTANCE-v1-camera-pinned.md) | 验收记录：相机钉住的 UI 可点击（V1 的两道闸门、命中测试读数与修复前后对比）                                                                                                          |
| [`docs/PITFALLS.md`](./docs/PITFALLS.md)                                       | 已知易踩的坑的完整版（`AGENTS.md` §8 的展开：每条含现象 → 根因 → 修法 → 实测数字）                                                                                                   |
| [`docs/DEFECT-BACKLOG.md`](./docs/DEFECT-BACKLOG.md)                           | 审计发现的缺陷登记簿（待修／待验证／覆盖率缺口）                                                                                                                                     |
| [`docs/HANDOVER.md`](./docs/HANDOVER.md)                                       | 交接说明：当前状态、已修复清单的证据位置、下一步计划（按建议顺序）与工作约定速记                                                                                                     |
| [`docs/adr/`](./docs/adr/README.md)                                            | 架构决策记录（ADR-0001…0011 及索引）；新决策新增编号                                                                                                                                 |
| [`docs/API-SURFACE.json`](./docs/API-SURFACE.json)                             | **冻结的公开 API**：5 个入口点的 817 个导出名（[ADR-0011](./docs/adr/0011-public-api-freeze.md)）；`pnpm api:check` 校验，`UPDATE_API=1 node scripts/check-api-surface.mjs` 重新冻结 |
| `docs/api/`（**M10**，TypeDoc 生成，尚未创建）                                 | 生成的 API 参考                                                                                                                                                                      |
| `docs/widget-spec/`（**M10**，尚未创建）                                       | 控件规格文档；落地前以 [`docs/guide/`](./docs/guide/README.md) 的控件章节为现行参考                                                                                                  |

关键 ADR 速览：包划分 [0001](./docs/adr/0001-package-layout.md)｜两阶段布局 [0002](./docs/adr/0002-two-pass-layout.md)｜layout 零 Phaser 依赖 [0003](./docs/adr/0003-layout-is-renderer-agnostic.md)｜DOM 输入桥 [0004](./docs/adr/0004-dom-input-bridge.md)｜Phaser 依赖方式 [0005](./docs/adr/0005-phaser-dependency.md)｜Phase 1 范围 [0006](./docs/adr/0006-phase1-scope.md)｜Phaser 4 WebGL 约束 [0007](./docs/adr/0007-phaser4-webgl-constraints.md)｜响应式与调度器 [0008](./docs/adr/0008-reactivity-and-scheduler.md)｜相机钉住的 UI [0009](./docs/adr/0009-camera-pinned-ui-and-input.md)｜指针事件链 [0010](./docs/adr/0010-pointer-event-chain.md)｜公开 API 冻结 [0011](./docs/adr/0011-public-api-freeze.md)。

---

## 8. 相关项目与致谢

| 项目                                                                                                                                                                                       | 关系                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[phaserjs/phaser](https://github.com/phaserjs/phaser)**（[phaser.io](https://phaser.io)）                                                                                                | **上游游戏引擎**（Phaser 4，`phaser@4.2.1 "Giedi"`）。本框架完全跑在它的公开 API 之上：`GameObjects.Container` 适配、场景插件、工厂注册、Mask filter 裁剪（[ADR-0007](./docs/adr/0007-phaser4-webgl-constraints.md)）、相机、输入与缩放系统。**不 fork、不修改、不再分发** Phaser 源码 |
| **[rexUI](https://rexrainbow.github.io/phaser3-rex-notes/)**（`phaser3-rex-notes`）                                                                                                        | Phaser 3 生态里被验证过的 UI 插件。本项目**不兼容 Phaser 3 API、也不依赖它**，但在「UI 插件该提供哪些控件与布局形态」上吸收了它的设计经验（Sizer 作为独立布局节点、网格与流式两种排布；见 [`docs/PLAN.md`](./docs/PLAN.md) §4.7 的源码调研）                                           |
| [vitejs/vite](https://github.com/vitejs/vite) · [vitest](https://github.com/vitest-dev/vitest) · [tsup](https://github.com/egoist/tsup) · [Prettier](https://github.com/prettier/prettier) | 示例构建、单元测试、打包（ESM + CJS + `d.ts`）与格式化工具链                                                                                                                                                                                                                           |

特别感谢 [Phaser](https://github.com/phaserjs/phaser) 社区与所有公开的 Phaser 文档与源码：本框架的每一处适配都建立在这些资料之上 —— **没有 Phaser 就没有 phaser-mvvm**。

---

## 9. 许可证

本项目以 **MIT** 许可证发布，全文见 [`LICENSE`](./LICENSE)（**Copyright © 2026 universe-st**）。四个发布包（`core`/`layout`/`phaser`/`widgets`）的 `package.json` 均声明 `"license": "MIT"`；`apps/examples` 是私有示例工程，不单独声明。

- **与 Phaser 的许可关系**：Phaser 同样以 **MIT** 发布（见 [`phaserjs/phaser` 的 LICENSE.md](https://github.com/phaserjs/phaser/blob/master/LICENSE.md)），两者条款兼容。本项目把 Phaser 当作 **peer dependency** 从外部引入，`packages/*` 构建时一律 `--external phaser`，**产物中不含 Phaser 代码**，因此无需再分发 Phaser 的版权声明。
- **注意示例的构建产物**：`pnpm build:examples` 会把 Phaser 打进 `apps/examples/dist`（`dist/` 已在 `.gitignore` 中，不随仓库分发）。若你对外分发这个 bundle，请一并保留 Phaser 的 MIT 许可与版权声明。
- **发布状态**：四个包的版本是 **`1.0.0`**、`publishConfig.access` 已是 `public`，但**尚未发布到 npm**；在正式发布前，请从源码或 workspace 协议使用（见 §3）。
