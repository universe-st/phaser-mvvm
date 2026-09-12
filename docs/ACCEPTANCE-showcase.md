# 验收记录 · 控件与布局全家福（`#/showcase`）

- **验收场**：[`#/showcase`](../../apps/examples/src/scenes/showcase.ts)（`window.showcase` 暴露全部读数）
- **被测实现**：十个分区里的每一个控件、每一个布局容器与每一组布局参数（本页**只用公开 API**，没有自造绘制）
- **本轮（第 79 轮）新增**：`st.<key>` 逐帧视觉状态、`controlStates()`（含 `interactive` / `inBand`）、`counts()`、`churnSections(n)`、`paramsBlocks()`、`scrollStage(y)`、`stageRect()`
- **验收方式**：Playwright MCP，**全部用真实鼠标**（`mouse.move`/`down`/`up`/`click`）驱动，配合 CDP 读可访问性树；每次断言前先 `bringToFront()`
- **门禁**（第 79 轮复跑）：`pnpm -r run test` **1241 passed**、`typecheck` 5/5、`prettier --check .`、`docs:check`、`build:examples`、`node scripts/visual-check.mjs`（7 场景 + 像素 + AX 树）、20 个示例场景逐一加载无 ERROR

---

## 1. 为什么需要这一页的第二套读数

`#/showcase` 一直有 `pt.*`（每个控件的页面坐标，逐帧刷新）与 `#status` 的几何，所以它能证明"每个控件**存在**且**摆在哪里**"。它证明不了"每个控件**在各种状态下的样子**"——而后者正是"每个控件都要有 demo 并逐一验证"这句话的后半截。

第 79 轮补上的是 **`st.<key> = <visualState>`**（每帧，取值见 `widget-state.ts`：`normal`/`hover`/`pressed`/`disabled`/`focused`/`error`），以及三条让检查不必猜的读数：

| 读数              | 回答的问题                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `controlStates()` | 这个分区里每个被跟踪控件的状态、页面坐标、**是否可交互**（容器只提供几何）、**是否落在舞台可见带内**、可访问名 |
| `counts()`        | `widgets`/`stageWidgets`/`themeListeners`/`pointerTargets`/`focusables`/`a11yNodes`，切分区前后的泄漏门禁      |
| `paramsBlocks()`  | `params` 分区那条**布局**断言的数字（三个块的 x/宽度/可见性）                                                  |

`inBand` 是这一轮的教训之一：`pt.*` 只知道控件被排布在哪里，不知道它**是否被舞台裁掉**。`params` 分区高 1513px、舞台只有 672px，`pt.params.visibility` 报的是 `@621,1538`——在画布（720px 高）之外，照着点等于点到页面上（实测：什么也没发生，而"没反应"很容易被误读成控件坏了）。

---

## 2. 覆盖矩阵（十个分区，逐区切换）

| 分区         | 舞台控件数 | 内容高度 | 分区自带的可交互控件 | 说明                                                    |
| ------------ | ---------- | -------- | -------------------- | ------------------------------------------------------- |
| `text`       | 39         | 573      | 0                    | 文本与截断/换行，纯几何                                 |
| `buttons`    | 43         | 621      | 3                    | 开关、计数、重置                                        |
| `inputs`     | 35         | 599      | 3                    | 单行 / 邮箱（带校验）/ 多行                             |
| `decoration` | 71         | 693      | 0                    | `Rect`/`Image`/`Divider`/`Spacer`，纯绘制               |
| `box`        | 161        | 841      | 0                    | 纵向 / 横向 / 换行 / 伸缩                               |
| `grid`       | 81         | 723      | 0                    | 固定列 / auto 列 / 跨列                                 |
| `stack`      | 83         | 670      | 0                    | 叠放与对齐                                              |
| `params`     | 110        | 1513     | 1                    | 可见性折叠（布局断言见 §3）                             |
| `repeat`     | 107        | 468      | 7                    | 虚拟化列表 + 横向 chips + Add/Remove/Reverse/Left/Right |
| `focus`      | 39         | 556      | 11                   | 五个字母按钮 + 六个方向按钮                             |

汇总（逐区审计，10 个分区）：**175 个被跟踪控件、165 个可交互**，其中分区自带的可交互控件 25 个，加上页头 3 个与侧栏导航 11 个 = **页面上共 39 个可交互控件**。两条硬判据 **0 例外**：

- 每个**可交互**控件都有可访问名（`a11y` 非空）——容器（`section.*`）不要求，它们只是几何探针，镜像按设计跳过装饰面板；
- 没有"可见但没被排布"的控件（`visible && !laidOut` = 0），即不存在 0×0 的幽灵。

---

## 3. 状态机与布局断言（真实鼠标）

**每个可交互控件的状态迁移**（26 个控件逐个走一遍：移到控件中心 → 按下 → 抬起 → 移开）：

| 阶段                 | 期望                                    | 实测                                           |
| -------------------- | --------------------------------------- | ---------------------------------------------- |
| 静止                 | `normal`                                | 26/26 `normal`                                 |
| 悬停                 | `hover`                                 | 26/26 `hover`                                  |
| 按下                 | `pressed`                               | 26/26 `pressed`                                |
| 抬起（指针仍在上面） | `hover`                                 | 26/26 `hover`                                  |
| 移开                 | `focused`（指针按下即把框架焦点交给它） | 26/26 `focused`，且 `state().focus` 正是该控件 |

例：`buttons.toggle` → `normal/hover/pressed/hover/focused`（`focus=toggleButton`）、`inputs.area` → 同理（`focus=fieldArea`）、`focus.arrow6` → `focus=arrow.6`。开关的按钮文案与可访问名都是反应式的：`Toggle: off` → 点击后变成 `Toggle: on`。

**例外（不是缺陷）**：`repeat.chips`（横向 chips 滚动口）悬停/按下都停在 `normal`。用框架自己的命中走查查过：那个点下面是一个 **88×44 的 chip 控件**（无名，是 chips 的行内容），所以路由正确地指向了 chip 而不是它的容器。**教训**：容器的 `st.*` 只在指针落在**容器自己**（而不是它的子控件）上时才会变——写检查时要按这条来读，别把"容器没高亮"当成缺陷。

**布局断言（`params` 分区的折叠）**：三个块 60×30、间距 8，初始 `A.x=6`、`collapse.x=74`、`C.x=142`；点一次 "Hide B"：

```
holder.A       x=6   width=60  visible=true
holder.collapse x=74  width=60  visible=false   ← 退出布局流（hideMode: collapse）
holder.C       x=74   width=60  visible=true    ← 左移 142-74 = 68 = 60 + 8 ✓
```

按钮文案同时变成 "Show B"；再点一次完全复原（`C.x=142`、`collapse.visible=true`、文案回到 "Hide B"）。

---

## 4. 泄漏与压力（切换分区会销毁并重建整棵子树）

| 判据                                                             | 实测                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `churnSections(3)`（十区各走三遍再回到起点）                     | before == after `{widgets 79, stageWidgets 43, themeListeners 80, pointerTargets 40, focusables 33, a11yNodes 34}` |
| A/B：`repeat` 直接进入 vs 先 `showAll()`（751 个舞台控件）再进入 | 两者完全相同 `{143, 107, 144, 50, 22, 22}`                                                                         |
| 压力：一个 tick 内把十个分区全切一遍再回 `buttons`               | 与初始状态逐项相同 `{79, 43, 80, 40, 33, 34}`，`section=buttons widgets=43`                                        |
| `showAll()` → 单区                                               | 751 → 107 个舞台控件，`repeat.rendered=10`（虚拟化仍在工作）                                                       |

**顺带修掉的门禁缺陷**：`churnSections()` 第一版在**采样之后**才发现两处会骗人——① 路由器的目标集合在结构变化后**下一帧**才重收集（实测同一 tick 里 `pointerTargets` 36 → 6，下一帧回到 36，看着像漏了 30 个），所以要像 `#/list` 那样先 `refreshInteraction()`；② 它结束时回到的是"循环最后停下的那个分区"，于是拿 `repeat` 的计数和 `focus` 的计数比。两处都改对了才有上表这些"前后一致"。

---

## 5. `#/dashboard`（复合示例，本轮顺带验收，未做成常驻矩阵）

`#/dashboard` 的既有测试点是"主题切换 + 刷新"。本轮用真实鼠标复验：`pt.theme` 点击 → `theme=dark → light`；`pt.refresh` 点击两次 → `refreshClicks` 0→1→2 且 `revenue` 128872 → 132096，几何（`page/header/grid/card0/footer`）写在 `#status` 里。它的 `pt.*` 是 `reportControl`（创建时采样一次），只适合布局不动的页面——本页正合适，但如果以后让卡片随数据变高，必须改成逐帧发布（AGENTS §6 的那条规矩）。

---

## 6. 未覆盖 / 有意不做

- **像素级验收**：本页没有进 `scripts/visual-check.mjs` 的场景列表（它已经覆盖 7 个场景的像素与 AX 树）。`#/showcase` 早年在 [`ACCEPTANCE-M0-M2.md`](./ACCEPTANCE-M0-M2.md) §"验收入口" 里做过"十个分区像素网格颜色数 21–79、0 个 0×0 节点"的检查；本轮补的是状态与布局，不是像素。
- **`text`/`decoration`/`box`/`grid`/`stack` 五个分区没有可交互控件**：它们的产品是几何与绘制，本轮只断言"控件数、内容高度、无 0×0、无 ERROR"；更细的布局断言在 `#/probe`/`#/stack`/`layout` 包的黄金快照里。
- **触摸**：本轮全部用鼠标。触摸与鼠标共用命中区与 `onActivate`，触摸矩阵在 [`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md)；本页未逐控件跑触摸。
- **真机**：未做（同其它页面）。
- **`showAll()`（751 个舞台控件）下的逐控件走查**：本轮只验了"能渲染、能回退、计数不漂"，没有把 39 个可交互控件在 all 模式下再走一遍状态机。
