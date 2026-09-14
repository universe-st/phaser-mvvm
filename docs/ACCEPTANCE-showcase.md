# 验收记录 · 控件与布局全家福（`#/showcase`）

- **验收场**：[`#/showcase`](../../apps/examples/src/scenes/showcase.ts)（`window.showcase` 暴露全部读数）
- **被测实现**：十一个分区里的每一个控件、每一个布局容器与每一组布局参数（本页**只用公开 API**，没有自造绘制）
- **本轮（第 79 轮）新增**：`st.<key>` 逐帧视觉状态、`controlStates()`（含 `interactive` / `inBand`）、`counts()`、`churnSections(n)`、`paramsBlocks()`、`scrollStage(y)`、`stageRect()`
- **验收方式**：Playwright MCP，**全部用真实鼠标**（`mouse.move`/`down`/`up`/`click`）驱动，配合 CDP 读可访问性树；每次断言前先 `bringToFront()`
- **门禁**（第 79 轮复跑）：`pnpm -r run test` **1241 passed**、`typecheck` 5/5、`prettier --check .`、`docs:check`、`build:examples`、`node scripts/visual-check.mjs`（7 场景 + 像素 + AX 树）、20 个示例场景逐一加载无 ERROR

---

## 1. 为什么需要这一页的第二套读数

`#/showcase` 一直有 `pt.*`（每个控件的页面坐标，逐帧刷新）与 `#status` 的几何，所以它能证明"每个控件**存在**且**摆在哪里**"。它证明不了"每个控件**在各种状态下的样子**"——而后者正是"每个控件都要有 demo 并逐一验证"这句话的后半截。

第 79 轮补上的是 **`st.<key> = <visualState>`**（每帧，取值见 `widget-state.ts`：`normal`/`hover`/`pressed`/`disabled`/`focused`/`error`），以及三条让检查不必猜的读数：

| 读数                         | 回答的问题                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `controlStates()`            | 这个分区里每个被跟踪控件的状态、页面坐标、**是否可交互**（容器只提供几何）、**是否落在舞台可见带内**、可访问名 |
| `counts()`                   | `widgets`/`stageWidgets`/`themeListeners`/`pointerTargets`/`focusables`/`a11yNodes`，切分区前后的泄漏门禁      |
| `paramsBlocks()`             | `params` 分区那条**布局**断言的数字（三个块的 x/宽度/可见性）                                                  |
| `rects(names?)`              | 分区里每个**具名**控件的 `appliedRect` 与页面坐标/尺寸（第 89 轮加，见 §7）                                    |
| `showAndReport(id, frames?)` | `show()` + 等两帧 + 把该分区的门禁控件写进 `#status`（第 89 轮加，见 §7.4：构建趟里读到的是 `0×0`）            |

`inBand` 是这一轮的教训之一：`pt.*` 只知道控件被排布在哪里，不知道它**是否被舞台裁掉**。`params` 分区高 1513px、舞台只有 672px，`pt.params.visibility` 报的是 `@621,1538`——在画布（720px 高）之外，照着点等于点到页面上（实测：什么也没发生，而"没反应"很容易被误读成控件坏了）。

---

## 2. 覆盖矩阵（十个分区，逐区切换；第 89 轮加了第十一个 `sizing`，见 §7）

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

汇总（逐区审计，第 60 轮那 10 个分区）：**175 个被跟踪控件、165 个可交互**，其中分区自带的可交互控件 25 个，加上页头 3 个与侧栏导航 11 个 = **页面上共 39 个可交互控件**。两条硬判据 **0 例外**：

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

> 第 113 轮起：**状态是 `focused` 不等于画了焦点环**——鼠标点来的焦点不再画环（`Widget#focusVisible`，见 [ADR-0012](./adr/0012-focus-visible-ring.md) 与 [`PITFALLS.md`](./PITFALLS.md) §8.74）。上表读的是 `visualState`，语义未变，因此这一页的读数照旧成立。

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

- **像素级验收**（第 89 轮起已有，见 §7）：第 60 轮时本页没有进 `scripts/visual-check.mjs` 的场景列表；现在它带着 `sizing` 分区的四个采样点进了那条门禁（明暗两套）。`#/showcase` 早年在 [`ACCEPTANCE-M0-M2.md`](./ACCEPTANCE-M0-M2.md) §"验收入口" 里做过"十个分区像素网格颜色数 21–79、0 个 0×0 节点"的检查。
- **`text`/`decoration`/`box`/`grid`/`stack` 五个分区没有可交互控件**：它们的产品是几何与绘制，本轮只断言"控件数、内容高度、无 0×0、无 ERROR"；更细的布局断言在 `#/probe`/`#/stack`/`layout` 包的黄金快照里。
- **触摸**：本轮全部用鼠标。触摸与鼠标共用命中区与 `onActivate`，触摸矩阵在 [`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md)；本页未逐控件跑触摸。
- **真机**：未做（同其它页面）。**Android 模拟器上本页是 A1/A8 的载体**（启动、WebGL、零错误），像素门禁仍由桌面侧的 `sizing` 分区承担，见 [`ACCEPTANCE-android.md`](./ACCEPTANCE-android.md)。
- **`showAll()`（751 个舞台控件）下的逐控件走查**：本轮只验了"能渲染、能回退、计数不漂"，没有把 39 个可交互控件在 all 模式下再走一遍状态机。

---

## 7. 第 89 轮：`sizing` 分区（`shrink` · `basis` · `min/max height`）与网格显式定位

### 7.1 为什么要加这一节

本页自称覆盖"每一组布局参数"，但把 `LAYOUT_PARAM_KEYS` 的 24 个键逐个拿到 `apps/examples` 里反查，有 **7 个键一次都没被任何 demo 用过**：

| 键                                       | 之前在哪被验证过           |
| ---------------------------------------- | -------------------------- |
| `minHeight` / `maxHeight`                | 只有 `layout` 包的引擎单测 |
| `shrink` / `basis`                       | 只有 `layout` 包的引擎单测 |
| `gridColumn` / `gridRow` / `gridRowSpan` | 只有 `layout` 包的引擎单测 |

而这几个键正好是引擎缺陷历史最集中的地方（L5：`alignItems: 'stretch'` 丢掉子节点的 min/max；L6：min>max 的两套策略）——引擎侧有断言，**控件层把它传丢了没人知道**（选项键表、`splitOptions`、DSL 默认值，任何一处漏了都只会表现为"参数没效果"）。所以本轮补了第十一个分区 `sizing`（`min/max height` 那一张卡同时验"clamp 赢过声明的高度"与"clamp 赢过 stretch"），并在 `grid` 分区加了一张显式定位卡。

### 7.2 新观测能力

| 通道                                     | 内容                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `window.showcase.rects(names?)`          | 分区里每个**具名**控件的 `appliedRect`（父坐标）+ 页面坐标与页面尺寸（`pageX/pageY/pageWidth/pageHeight`，走过 `displayScale`）——`geometry()` 只描述页头，`controlStates()` 只覆盖被跟踪控件且给的是页面**点**；布局参数卡需要的恰恰是"某个具名子节点的盒子" |
| `window.showcase.showAndReport(section)` | `show()` + 等两帧 + 把该分区的门禁控件写进 `#status`（见 §7.4 的坑）                                                                                                                                                                                         |

卡片里的每个盒子都带 `name`（`sizing.*`、`grid.place.*`），所以断言是"名字 → 数字"，不是"看图"。

### 7.3 实测（真实页面，`rects()` 读数）

**`shrink`**（横排 frame 240 宽、padding 6 → 内容盒 228；三个子节点各声明 `width: 120`）：

| 子节点 | 无 `shrink`                            | `shrink: 1`  |
| ------ | -------------------------------------- | ------------ |
| a      | `x=6 w=120`                            | `x=6 w=76`   |
| b      | `x=126 w=120`                          | `x=82 w=76`  |
| c      | `x=246 w=120`（**越出 240 的 frame**） | `x=158 w=76` |

三份权重 × 基准相同 → 缺口 360−228=132 三等分，每个 44 → 76 ✓ 与引擎单测的公式一致；无 `shrink` 时**照画不缩**（`c` 从 246 起，画在 frame 外），并且像素读数确认它真的被画出来了（`[47,111,235]`，不是被裁掉）。

**`basis`**（横排 frame 320 宽；子节点都声明 `width: 40`）：

| 子节点 | 无 `basis` | `basis: 100` / `basis: 150` |
| ------ | ---------- | --------------------------- |
| a      | `w=40`     | `w=100`                     |
| b      | `w=40`     | `w=150`                     |
| c      | `w=40`     | `w=40`（没写 basis）        |

主轴上 `basis` 压过 `width`，与 CSS flex-basis 同义 ✓。

**`minHeight` / `maxHeight`**：

| 场景                                                | 实测                                         |
| --------------------------------------------------- | -------------------------------------------- |
| `alignItems: 'stretch'` 的子节点不声明高度          | `h=84`（= frame 96 − 上下 padding 12）✓      |
| 同一个 frame 里 `maxHeight: 40` 的子节点            | `h=40` ✓（stretch 被 clamp 截住，L5 那一族） |
| `alignItems: 'start'` + `height: 20, minHeight: 60` | `h=60` ✓（clamp 压过声明的高度）             |
| `alignItems: 'start'` + `height: 90, maxHeight: 50` | `h=50` ✓                                     |

**`grid` 显式定位**（`columns: 3`、`columnGap/rowGap: 8`、`width: 'fill'` → 单元格 316 宽；声明顺序 `pin, flow1, flow2, span, flow3, flow4`）：

| 单元格  | 声明                        | 实测（相对 grid）     | 判据                                                               |
| ------- | --------------------------- | --------------------- | ------------------------------------------------------------------ |
| `pin`   | `gridColumn: 3, gridRow: 2` | `x=648 y=44`          | 1-based 第 3 列、第 2 行；**声明在最前却画在最后**，不占 flow 槽位 |
| `flow1` | —                           | `x=0 y=0`             | 自动流从 (1,1) 开始                                                |
| `flow2` | —                           | `x=324 y=0`           | (1,2)                                                              |
| `span`  | `gridRowSpan: 2`            | `x=0 y=44 w=316 h=80` | (2,1) 起跨两行：36+8+36=80 ✓；它**避开了**被 pin 占掉的 (2,3)      |
| `flow3` | —                           | `x=324 y=44`          | (2,2)                                                              |
| `flow4` | —                           | `x=324 y=88`          | 游标一路跳过 (2,3)（pin）与 (3,1)（span 的第二行）→ (3,2) ✓        |

顺带在**引擎层**补了一条此前没有的用例（`grid.test.ts`）：跨行自动项遇到"第二行被显式占掉"的列时必须换列（`isFree` 要查整段 span，只看首行就会重叠）——实测 `pinned=(0,4,100,30)`、`tall=(100,0,100,34)`，两者不重叠 ✓。

### 7.4 坑：在构建 lambda 里 `reportWidget()` 读到的是 `0×0`

第一版把 `reportWidget('sizing.shrink.on', …)` 直接写在建卡的闭包里，于是 `#status` 里出现四行 `@0,0 0x0`，像素门禁老老实实按 (0,0) 采样，读到的是画布角落——**门禁说"期望 #161b22 得到 #0d1117"**，看起来像布局错了，其实是读数早了一帧。`reportWidget()` 读的是 `appliedRect`，而构建趟里还没有第一次布局。修法：把要采样的控件收进 `gateWidgets`，由 `showAndReport()` 在**两帧之后**报告；`scripts/visual-check.mjs` 的 `SCENE_SETUP` 因此支持返回 Promise（`awaitPromise: true`）。这条已记为 [`PITFALLS.md`](./PITFALLS.md) §8.48。

### 7.5 像素门禁（本页第一次进 `scripts/visual-check.mjs`）

`SCENE_SETUP.showcase = 'await window.showcase.showAndReport("sizing")'`（setup 包在一个 async IIFE 里、由脚本 `await`，因为 `showAndReport()` 要等两帧才读得到几何），四个采样点（`PIXEL_EXPECTATIONS` / `LIGHT_EXPECTATIONS` 各一套）：

| 采样点                        | 位置               | 暗色      | 亮色      | 它保护什么                                                                                 |
| ----------------------------- | ------------------ | --------- | --------- | ------------------------------------------------------------------------------------------ |
| `sizing.shrink.on`            | `fx 0.99`          | `#161b22` | `#ffffff` | frame 右侧内边距必须是**面板**色；`shrink` 一失效，第三个盒子就会盖在这里（`#2f6feb`）     |
| `sizing.shrink.on.c`          | `fx 0.1, fy 0.5`   | `#2f6feb` | `#2f6feb` | 缩过的盒子在算出来的位置上真的是它自己的填充（字面量，明暗都不许变）                       |
| `sizing.height.stretch.frame` | `fx 0.43, fy 0.92` | `#161b22` | `#ffffff` | 采样点在 `maxHeight: 40` 盒子**下方**：clamp 一失效，stretch 会把它画成 84 高并盖住这里    |
| `sizing.height.max.box`       | `fx 0.5, fy 0.12`  | `#2f6feb` | `#2f6feb` | 被 clamp 的盒子本身（`fy 0.12` 取在文字上方；`fy 0.5` 会读到字形边缘，第一版就是这么错的） |

**正对照（门禁到底抓不抓得住）**：把参数拿掉再跑一次，两处都如期转红——① 去掉三个 `shrink: 1`：`sizing.shrink.on.c=@932,144 120x44`（而不是 76 宽），`sizing.shrink.on` 采到 `#2f6feb`，明暗两半都 MISMATCH；② 去掉 `maxHeight: 40`：盒子变成 `70x84`，`sizing.height.stretch.frame` 采到 `#2f6feb`，两半都 MISMATCH。恢复后 12 项全绿。（正对照是纪律：一条门禁不能只在"什么都没坏"的时候绿。）

## 8. 第 98 轮：`Label · truncation` 卡原来什么都没裁（V66）

### 8.1 现象

给 `Text` 补 `maxLines`/`ellipsis` 数据槽时顺手把这一页的两张标签读了出来，发现 **两张都 `truncated: false`**：

| 标签                            | 写的宽度 | 实际盒子宽 | 画出来的行数  | `truncated` | 结尾有 `…` |
| ------------------------------- | -------- | ---------- | ------------- | ----------- | ---------- |
| `maxLines: 2 with ellipsis …`   | 340      | **964**    | 2             | false       | 否         |
| `wrap: false — a single line …` | 220      | **964**    | 1（414px 宽） | false       | 否         |

根因是**默认的 `alignItems: 'stretch'` 会覆盖子节点自己的 cross 轴长度**（[指南 02](../guide/02-layout.md) §199 早写明，本轮只是没人照着做）：两张标签被撑到卡片的 964px，段落两行就装下了、单行 414px 也没超，于是这张卡的标题（"maxLines + ellipsis，以及 wrap: false 的单行裁剪"）承诺的行为**在屏幕上根本不存在**。而它"看起来没坏"——两张标签本身画得毫无毛病，只有读 `truncated` 与画出来的文字才看得出来。

### 8.2 修法与新的常驻读数

两处加 `alignSelf: 'start'`（让 `width` 真的生效），`wrap: false` 那张补上 `ellipsis: true`（同时修掉了它背后的 V65：不换行的标签此前拿不到裁剪宽度，长单行只会溢出）。新增 `window.showcase.truncation()`：

```
{ lines:  { rows, truncated, ellipsis, text, width },
  single: { rows, truncated, ellipsis, text, width } }
```

`rows`/`ellipsis`/`text` 读的都是**画出来的文字**（`Label#getDisplayText()`，本轮新增），`width` 是**实际生效的**宽度——这是这条教训的核心读数："我写的是 340"不是证据。`#demo-state` 在 `text` 分区逐帧发布 `trunc.lines.rows` / `trunc.lines.truncated` / `trunc.lines.ellipsis` 与 `trunc.single.*`。

### 8.3 实测（真实页面，`showAndReport('text')` 之后）

| 读数                                     | 修前                     | 修后                                                              |
| ---------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `lines.width`                            | 964                      | **340**                                                           |
| `lines.rows` / `truncated` / `ellipsis`  | 2 / false / false        | 2 / **true** / **true**                                           |
| `lines.text` 结尾                        | `…and trim` 之后还有整段 | `…for the wrapped lines and trim…`                                |
| `single.width`                           | 964                      | **220**                                                           |
| `single.rows` / `truncated` / `ellipsis` | 1 / false / false        | 1 / **true** / **true**                                           |
| `single.text`                            | 整句 414px               | `wrap: false — a single line, el…`                                |
| `rects()`（页面坐标）                    | 340 / 220 都拿不到       | `trunc.lines` `@280,608 340x37`、`trunc.single` `@280,651 220x20` |

两张标签的高度（37 / 20）与卡片其余部分**没有移动**：修的是标签自己的裁剪，不是布局。

## 9. 第 106 轮：四个"看起来像渲染错"的问题（两个控件缺陷 + 两个 demo 问题）

### 9.1 先判归属：引擎 / 控件 / demo，各是谁的错

用户报的四个现象都落在这一页上，但**根因分属三层**，判据如下（顺序即结论）：

| 现象                                                       | 归属            | 判据                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 鼠标在左侧菜单上滑动时菜单底色闪                           | **控件**（V76） | `Panel` 默认带 `blockPointer` 命中区，那是**拦截层**（V9 的语义），但路由把 hover/pressed 也交给了它；侧栏没有写过任何"菜单该亮"的东西，`panelSkinStyles` 里也没有"只有交互面板才画指针状态"的条件——所以是控件把"有命中区"当成了"是控件" |
| 菜单是圆角矩形，但下面两个圆角看不到                       | **demo**（V77） | 菜单面板本身画得对（`radius: 10` + 高度 639）；它的**底边在 y=701**，而画布只有 687——它被主体行挤出了画布。`layout` 包的 `grow` 语义有文档、有单测，`fill`/`basis` 两条正路也都在指南里                                                  |
| `Button · icon` 里图标比按钮还大                           | **控件**（V75） | `Button` 的 icon 尺寸没有任何上限，`measureContent` 与 `onRectChanged` 都直接用它；`#/compose` 的 16px 贴图 + 那句注释证明这个溢出**早就被发现了，只是被 demo 绕开**                                                                     |
| `Panel & decor` 滚到底时最后一张卡片底部（两个圆角）看不到 | **demo**（V77） | 与菜单同一个根因：舞台视口底边 701 > 画布 687。实测把主体行修对之后，**11 个分区逐个滚到底，最后一张卡的底边与舞台底边都落在 634**（页底 675）                                                                                           |

修的东西各就各位：`widgets/src/Button.ts` + `geometry.ts`（V75）、`phaser/src/input.ts`（V76）、`apps/examples/src/scenes/showcase.ts`（V77），两处纯逻辑各带单测。

### 9.2 V76：指针状态属于控件（真实鼠标，三个坐标 A/B）

`#/showcase` 的 `buttons` 分区，指针分别落在"菜单按钮上""两个按钮之间的 6px 缝隙上""菜单面板自己的内边距上"：

| 指针位置           | `nav`（面板，拦截层） | `st.nav.buttons`（真控件） | 同区域截图 sha256（前 12 位） |
| ------------------ | --------------------- | -------------------------- | ----------------------------- |
| 舞台上（移开）     | `normal`              | `normal`                   | `2eb5b2a4a5f6`                |
| 菜单按钮中心       | `normal`              | **`hover`**                | （按钮会变，故不采样）        |
| 两个按钮之间的缝隙 | `normal`              | `normal`                   | `2eb5b2a4a5f6`                |
| 菜单面板内边距     | `normal`              | `normal`                   | `2eb5b2a4a5f6`                |

三张截图的哈希**完全相同**：菜单列一个像素都没重画，而按钮该亮的时候照旧亮。修前同一组读数是「按钮上 `nav=normal`、缝隙上 `nav=hover`、内边距上 `nav=hover`」——正是"抖动"。

**回归（同轮复验）**：`#/states` 的 `panel.interactive`（显式 `interactive: true`）仍是 `normal → hover → pressed → hover`、`st.button.default` 仍是 `normal → hover → pressed → hover`；`#/hud` 点顶栏面板体 `world.clicks=0`（拦截层照样吞按下）而点世界 `world.clicks=1`、点 `score` 得 `clicks=1 focus=hud.scoreButton`；`#/modal` 点遮罩仍然 `reasons=[backdrop]` 且 `page.clicks`/`world.clicks` 不动；`#/lifecycle` 重启 10 次 11 项计数逐轮相同（`themeListeners 59 / widgets 57 / frameListeners 11`）。

### 9.3 V75：图标封顶（`window.showcase.iconFit()`）

`showAndReport('buttons')` 之后，三个具名图标按钮的读数（`glyph` 是图标**实际绘制盒**，`x/y` 是它在按钮自己的坐标系里的位置）：

| 按钮              | 按钮盒   | 图标贴图 | `glyph`   | `x, y`   | `inside` |
| ----------------- | -------- | -------- | --------- | -------- | -------- |
| `iconTextButton`  | `127×36` | 64×64    | **28×28** | `12, 4`  | `true`   |
| `iconOnlyButton`  | `58×36`  | 64×64    | **28×28** | `12, 4`  | `true`   |
| `smallIconButton` | `119×36` | 16×16    | **16×16** | `12, 10` | `true`   |

28 = 36（按钮高）− 2 × `spacing.xs`（4）——图标不贴边，按钮的圆角因此没有被方形的图标盖掉；`smallIconButton` 的 16px 图标**原样不动**（封顶只缩不放）。修前 `iconOnlyButton` 的盒子是 `94×36` 而图标是 64 见方、从 `y=0` 画到 `y=64`，四边都在外面。

卡片本身也扩成了行为矩阵（`sm`/`md`/`lg` 三档、显式 `height: 20` 的按钮、16px 图标），所以"封顶按控件高度走""更大的按钮不放大图标"这两件事在页面上看得见。单测：`packages/widgets/test/color-geometry.test.ts` 的 `fitIcon`（保持比例、永不放大、没位置返回 0）。

### 9.4 V77：主体行溢出的几何（修前 / 修后，同一个窗口 1408×687）

| 读数                                                  | 修前                                      | 修后                                                                               |
| ----------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `page`                                                | `@12,12 1384×663`                         | 不变（页底 675）                                                                   |
| `nav` / `stage` 高度                                  | **639**（底边 701，画布 687）             | **571.5**（底边 633.5）                                                            |
| 页脚行                                                | 在 `y=699`，**画布之外**                  | `y=687-…`，可见（`rows 0/200 · scroll 0 px`）                                      |
| 菜单列表                                              | 直接放在面板里（572 > 551.5，**不裁剪**） | `Panel → Scroll(showcase.navScroll) → Column`，`maxOffset=3`（720 高的窗口下为 0） |
| 11 个分区逐个 `scrollStage(1e6)` 后：最后一张卡的底边 | 全部 701（画布之外）                      | 全部 **634** = 舞台底边 < 页底 675 < 画布 687                                      |

### 9.5 `churnSections` 与分区计数（第 106 轮复测）

| 判据                                                             | 实测                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `churnSections(3)`（十一个分区各走三遍再回起点）                 | before == after `{widgets 86, stageWidgets 47, themeListeners 87, pointerTargets 46, focusables 39, a11yNodes 40}` |
| A/B：`repeat` 直接进入 vs 先 `showAll()`（853 个舞台控件）再进入 | 两者完全相同 `{146, 107, 147, 52, 24, 24}`；`showAll()` 时 `{892, 853, 893, 195, 67, 70}`、`repeat.rendered=10`    |
| `Tab` 走查（真实按键，前 8 步）                                  | `showAll → next → themeButton → showcase.navScroll → nav.text → nav.buttons → nav.inputs → nav.decoration`         |

计数比第 79 轮（`{79, 43, 80, 40, 33, 34}`）大，来自两处新增：菜单的滚动口（`ScrollView` + 持有者 + 内容列）与 `Button · icon` 卡的四个新按钮。

各分区舞台控件数 / 内容高度（第 106 轮复测；第 79 轮的十区表见 §2）：

| 分区         | 舞台控件数 | 内容高度 |
| ------------ | ---------- | -------- |
| `text`       | 43         | 621      |
| `buttons`    | 47         | 646      |
| `inputs`     | 35         | 600      |
| `decoration` | 71         | 693      |
| `box`        | 161        | 842      |
| `grid`       | 98         | 947      |
| `stack`      | 83         | 670      |
| `params`     | 110        | 1513     |
| `sizing`     | 79         | 625      |
| `repeat`     | 107        | 468      |
| `focus`      | 39         | 556      |

### 9.6 本轮**未运行**的门禁

`node scripts/visual-check.mjs` **没有跑成**：本机沙箱下 Chrome 的默认 profile 目录不可写（`touch ~/Library/Application Support/Google/Chrome/...` → `Operation not permitted`），脚本报 `timed out waiting for chrome devtools endpoint`（脚本不传 `--user-data-dir`，这是它既有的约定；见 AGENTS §6 与 [`PITFALLS.md`](./PITFALLS.md) §8.9）。因此本轮的几何/像素断言全部由 **Playwright MCP**（真实鼠标 + `#status`/`#demo-state`/`window.showcase.*`）完成，像素证据是上面那三张同区域截图的哈希比对与 §9.3 的 `iconFit()` 数字。`pnpm typecheck`（5/5）、`pnpm -r run test`（1321 passed）、`prettier --check .`、`pnpm docs:check` 均通过；`visual-check` 需要在能启动 Chrome 的机器上补跑一次（它对本页的门禁是 `sizing` 分区的四个采样点，本轮没有改动 `sizing` 的几何）。
