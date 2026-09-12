# 08 · 生命周期、性能、常见坑与速查表

本章目标：让页面**跑得久也不出问题**，并且在出问题时能快速定位。最后四节是全套速查表，可以当手册用。

---

## 1. 生命周期：一个页面从生到死

```
场景 create()
  ├─ 用工厂搭出控件树（此时控件已在显示列表，但还没布局）
  ├─ this.mvvm.mount(page)
  │     ├─ root.addWidget(page)   → 立刻布局一次（引擎 measure + arrange）
  │     └─ refreshInteraction()   → 收集指针目标与焦点集合
  └─ 之后每个 PRE_UPDATE：
        flushFrame() → flushLayout() → （结构变了才）refreshInteraction() → 手柄轮询 → 指针悬停推导

场景 shutdown / destroy
  └─ MVVMPlugin.dispose()
        ├─ 摘掉键盘/主题/场景事件监听
        ├─ router.detach()、focusManager.dispose()
        └─ uiRoot.destroy(true)   → 整棵控件树销毁
```

**你几乎不需要手动做清理**，插件会在场景关闭时全拆掉。需要你自己负责的只有两件事：

1. **自己创建的、挂在 `UIRoot` 之外的 Phaser 对象**（比如自己 `new` 的 `Graphics` 又 `container.add` 到了别的显示列表）。
2. **自己在控件之外注册的监听**（`window.addEventListener`、自定义定时器等）。

### 调试期会打印什么（发布期全部静默）

开发模式下框架会往控制台打几类以 `[phaser-mvvm]` 开头的行，发布模式调用 `setDevMode(false)` 后**一行都不打**（调用点先判一次布尔）：

| 日志                                                                               | 何时出现                                       | 怎么读                                                                                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ui(): built N widget(s), D level(s) deep`                                         | 每次 `ui()` / `render()` 建树                  | 页面规模与嵌套深度                                                                                                |
| `render(): mounted the page built by the content lambda`                           | `render()` 挂载后                              | 确认整页入口走到了挂载                                                                                            |
| `mount: page attached and laid out (N widget(s))`                                  | `this.mvvm.mount()`                            | 挂载的子树多大                                                                                                    |
| `layout: measured N node(s) in X ms (skipped K subtree(s), C cache hit(s) so far)` | **仅当**这一趟测量了 ≥ 200 个节点或耗时 ≥ 2 ms | 首帧全量测量会打印；日常增量帧不会。看到它在打字/悬停时反复出现 = 增量重算被破坏（先查 `markDirty`/`invalidate`） |
| `focus: <name>`                                                                    | 焦点控件变化时                                 | 「按键没反应」时先看焦点在谁身上                                                                                  |
| `shutdown: UI tree destroyed …`                                                    | 场景关闭拆树                                   | 与 `#/lifecycle` 门禁配合看                                                                                       |

阈值写在 `packages/phaser/src/UIRoot.ts` 顶部（`LOG_MEASURE_THRESHOLD` / `LOG_PASS_MS`），要临时看每一趟就把它们调成 0 / 0。

### 重启（`scene.restart()`）也要能用

`MVVMPlugin` 的拆解挂在场景事件上，而**订阅本身在重开后依然有效**：`boot()` 每个场景只调用一次，插件不会因为一次 SHUTDOWN 就与场景脱钩。重启后 `create()` 重新挂载 UI 即可；`#/lifecycle` 门禁会同时检查「不泄漏」与「重启后仍可点击/输入」两件事（历史上这里出过一次 HIGH 缺陷：插件在 `dispose()` 里退订了全部场景事件，重启后的 UI 既泄漏又是死的）。

### 挂载的三种粒度

| 需求              | 做法                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 挂整个页面        | `this.mvvm.mount(page)`                                                                                                                |
| 之后往页面里加/删 | `parent.addWidget(child)` / `parent.removeWidget(child, true)`，引擎会自动重算；新控件会在下一帧被纳入输入路由（结构版本变化触发刷新） |
| 清空并重建        | `parent.removeAllWidgets(true)` 后重新挂                                                                                               |
| 整棵 UI 树销毁    | `this.mvvm.root.destroy(true)`（通常只在场景关闭时由插件做）                                                                           |

### 手动加控件后为什么还能点

`Widget.addWidget` 会把「结构监听器」沿树传下去，并在增删时通知 `UIRoot`，`structureVersion` 随之变化；插件在下一帧的 `PRE_UPDATE` 里发现版本变了就 `refreshInteraction()`。所以**同一帧内新建的控件，下一帧就可以被点击/Tab 到**。

---

## 2. 销毁、泄漏与自检

### 销毁链

`widget.destroy()` 会依次：

1. 解除所有 widget 子节点的 `parent` / `engine` 引用并清空 `children`；
2. `scope.stop()` —— **所有绑定、watch、effect 一起停止**（这是不泄漏的核心）；
3. 退订主题变化（`unsubscribeTheme()`）；
4. 清掉 `focusManager` 反引用；
5. 从引擎摘出并标脏；
6. 交给 Phaser 的 `destroy`。

各控件还额外做了自己的清理，例如 `ScrollView` 注销画布 wheel 监听与场景指针监听、`TextInputBase` 移除键盘监听并 `bridge.dispose()`、`Repeat` 停掉 items 绑定。

### 自检手段

| 想验证什么                | 怎么验证                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主题订阅是否泄漏          | `themeListenerCount()`（导出）在场景销毁后应回到基线                                                                                                                                                                                                                                                                    |
| 焦集合是否残留            | `this.mvvm.focus.focusables.length`、`focusedWidget === null`                                                                                                                                                                                                                                                           |
| 有没有残留的指针目标      | `this.mvvm.input.widgets.length`                                                                                                                                                                                                                                                                                        |
| 布局是否还在无谓重算      | `layoutEngine.stats.passes` 在静止时不再增长                                                                                                                                                                                                                                                                            |
| 场景反复创建/销毁是否泄漏 | 打开 `#/lifecycle`，控制台执行 `await window.lifecycle.churn(100)`，再比对 `window.lifecycle.samples()`：`themeListeners`、`displayList`、`focusables`、`pointerTargets`、`textures`、`tweens`、`timers`、`widgets` 必须**每项只有一个取值**，`pages()` 只剩当前一页（仓库硬门禁：创建→销毁 100 次后计数归零，PLAN §7） |

> 硬约束（[ADR-0008](../adr/0008-reactivity-and-scheduler.md)）：**响应式副作用必须归入 `EffectScope`**。写自定义控件时，任何 `effect`/`watch`/绑定都应挂到 `this.scope` 上（用 `bind*` 系列会自动这样），否则控件销毁后订阅还在。

---

## 3. 性能：预算与实测

PLAN §8 的性能预算（PR 评审依据）：

| 指标                          | 预算                                                    |
| ----------------------------- | ------------------------------------------------------- |
| 1000 节点全量 measure+arrange | < 1.5 ms（M 系列 Mac，Node 基准）                       |
| 无变化帧的布局耗时            | **0**（`hasDirtyNodes` 为假直接返回）                   |
| 单节点内容变化                | 只重算 relayout boundary 子树                           |
| 文本度量缓存命中率            | > 95%（表单类界面）                                     |
| 排布热路径分配                | 零新增对象/闭包（对象池 + 复用数组）                    |
| 体积（gzip，不含 Phaser）     | `core` + `layout` < 25 KB；`phaser` + `widgets` < 45 KB |

自查方式：

```ts
// 1) 一帧内多次改数据，只会触发一次布局
count.value = 1;
count.value = 2;
count.value = 3; // 同一帧
console.log(this.mvvm.root.layoutEngine.stats.passes); // 只 +1
```

```bash
# 2) 布局基准与单测（含黄金快照：零漂移是门禁）
pnpm --filter @phaser-mvvm/layout run test
UPDATE_GOLDEN=1 pnpm --filter @phaser-mvvm/layout run test   # 有意变更后重生成快照
```

### 让界面「帧内只重排一次」的三条纪律

1. **不要用 `flush: 'sync'`**，保持 UI 绑定的默认 `'frame'`。
2. **表单控件写固定宽度**：只有 `width: 'auto'` 的输入框才会因为每次击键而 `markDirty`（框架刻意如此，避免输入进入布局热路径）。
3. **大列表用虚拟化**（`virtualize: true` + 正确的 `itemExtent`），不要靠「挂载全部行再裁剪」。

---

### 3.1 开发模式会打印什么

打开控制台，框架用 `[phaser-mvvm]` 前缀打印这些轨迹（发布模式调用 `setDevMode(false)`，**一行都不打**）：

| 轨迹        | 例子                                                                                              | 什么时候看它                                              |
| ----------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 建树 / 挂载 | `ui(): built 107 widget(s), 8 level(s) deep`、`mount: page attached and laid out (111 widget(s))` | 页面规模不对、以为建了却没挂上                            |
| 焦点        | `focus: button.default`                                                                           | Tab/点击之后焦点去哪了                                    |
| 激活        | `activate: button.default (pointer)` / `(keyboard)`                                               | "点了没反应"：先确认到底有没有激活成功                    |
| 虚拟化窗口  | `repeat: window [0, 8) of 30 - mounted 2`                                                         | 行"不见了"、`itemExtent` 算错                             |
| 滚动被钳制  | `scroll: clamped (0, 771) -> (0, 529.5)`                                                          | "滚不到底"：请求值被上限纠正（多半是内容尺寸/视口没算对） |
| 慢布局趟    | `layout: measured 440 node(s) in 15.00 ms (…)`                                                    | 掉帧：哪一帧、多少节点、缓存命中多少                      |
| 生命周期    | `shutdown: UI tree destroyed (…)`                                                                 | 场景重启后是否真的清干净                                  |

想在某次会话里关掉它们：控制台 `window.mvvmDev.setDevMode(false)`（示例应用暴露的开关）。

---

## 4. 排查手册：症状 → 原因 → 修法

### 4.1 「界面不更新」

| 检查项                                             | 结论 / 修法                                            |
| -------------------------------------------------- | ------------------------------------------------------ |
| 数据是 `ref`/`reactive`/`makeObservable` 吗？      | 不是的话绑定收集不到依赖 → 改用响应式数据（06 章）     |
| 直接改了 `widget.layoutParams.x = v`？             | 改成 `widget.setLayoutParams({ x: v })`                |
| 自定义控件里改了影响尺寸的东西但没 `markDirty()`？ | 在改动处调用 `this.markDirty()`                        |
| 改了文本/贴图但没走控件的 setter？                 | 用 `setText`/`setTexture`（内部会标脏）                |
| `stats.passes` 在涨但画面没变？                    | 说明重排了但属性写错对象（检查是不是改到了非显示对象） |
| `stats.passes` 不涨？                              | 没有任何节点变脏 → 回到上面几条                        |

### 4.2 「布局不对 / 尺寸是 0」

| 检查项                                                 | 结论 / 修法                                   |
| ------------------------------------------------------ | --------------------------------------------- |
| 控件是不是 `visible: false` 或被 `setVisible(false)`？ | 隐藏 = 退出布局流，尺寸按 0 处理              |
| 父容器尺寸是 `auto` 却写了百分比/`fill`？              | 百分比与 `fill` 需要确定基准 → 给父级明确尺寸 |
| `ScrollView` 没写宽高？                                | 视口必须有确定尺寸（02 §11、05 §1）           |
| `minWidth`/`maxWidth` 写了百分比？                     | 上下限只接受数字（否则按基准 0 解析成 0）     |
| 空的 `Panel` 没写尺寸？                                | `Panel` 没有内容尺寸，空的且不写宽高就是 0×0  |
| `absolute` 容器里的子节点忘了 `position: 'absolute'`？ | 补上（`absolute` 容器只排绝对子节点）         |

### 4.3 「点了没反应 / 输入不了」

| 检查项                                            | 结论 / 修法                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| 控件是不是 `disabled`（或 `enabled === false`）？ | 被禁用的控件不会悬停/按下/激活                                                  |
| 控件有命中区吗？                                  | 交互控件会自动开；自定义控件请调 `enablePointerInput()`                         |
| 是不是被上层 `Panel` 的 `blockPointer` 拦了？     | 关掉那层的 `blockPointer`，或调整层级                                           |
| 新建的控件在同帧内点不动？                        | 输入目标在下一帧刷新；`mount` 过的立即可用                                      |
| 文本框打不出中文？                                | 没开 `dom.createContainer`，或 `dom: false`（04 §2）                            |
| 键盘按了没动？                                    | 焦点集合是空的，或用 `Escape` 后没有焦点 → 调 `focus.next()` / `widget.focus()` |

### 4.4 「列表/滚动不对」

| 检查项                | 结论 / 修法                                                   |
| --------------------- | ------------------------------------------------------------- |
| `virtualize` 没生效？ | 需要正的 `itemExtent` **且** 纵向 box 容器（控制台有 `warn`） |
| 行位置逐渐错位？      | `itemExtent` 必须等于「行高 + 行间距」                        |
| 列表滚不动？          | 滚动由 `ScrollView` 负责；`Repeat` 只决定挂载窗口（05 §8）    |
| 内外层一起滚？        | 只在「最内层视口」处理手势；自定义滚动要照抄这个判定          |

### 4.6 「触摸（移动端）不对」

| 检查项                                           | 结论 / 修法                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触摸点了没反应，鼠标却正常？                     | Phaser 的触摸指针是 `pointers[1]`，需要 `activePointers ≥ 1`（默认值就是 1）；只有真机/模拟出的 `TouchEvent` 才会驱动它，鼠标事件不会                                              |
| 触摸抬起后控件一直亮着（像 hover）？             | 这是本轮修掉的缺陷 V11：`handleUp` 曾无条件恢复 hover。框架现在只在**鼠标**按压后恢复；自定义控件不要自己在 `pointerup` 里 `setHovered(true)`                                      |
| 想区分鼠标与触摸（例如只在鼠标下显示悬停提示）？ | 读 `pointer.wasTouch`（框架内部用的就是这个标记：`isHoverPointer`）。`wasTouch === true` 的指针不参与轮询式 hover                                                                  |
| 多指会不会互相干扰？                             | 不会：`InputRouter` 的按压按**指针**记账，`ScrollView`/`Slider` 的拖动只认抓住它的那根手指。多指要在游戏配置里开 `input: { activePointers: 2 }`（默认 1 时第二根手指没有指针可用） |
| 需要双指手势（缩放、旋转）？                     | 目前**未实现**：框架没有 pinch/rotate 语义，也没有「双指滚动」；多指输入本身是通的，手势要自行在 Phaser 层实现（实测见 `docs/ACCEPTANCE-touch.md` §3.5）                           |
| 字母下伸部（`g`/`y` 的尾巴）被切掉一小条？       | Phaser 文本画布高度取自字体度量并会被截断（见 03 章 `Text` 的坑）；框架已用 `glyphPadding()` 补上，自定义控件直接 `new Phaser.GameObjects.Text()` 时需要自己 `setPadding()`        |
| 真机上列表滚动会和页面滚动打架？                 | `ScrollView` 会 `preventDefault`（backlog V3 记录了"最内层不可滚动时也拦截"的取舍）；真机验收前先确认这一条是否符合预期                                                            |
| 软键盘弹出后布局错位？                           | `Scale.RESIZE` 下视口变化会触发重新布局，但**尚未在移动端模拟器里验收过**（见 `docs/ACCEPTANCE-touch.md` §5）                                                                      |

> 触摸的完整状态矩阵与驱动方式（CDP `Input.dispatchTouchEvent` 配方）见 [`ACCEPTANCE-touch.md`](../ACCEPTANCE-touch.md)。

### 4.5 「内存涨 / 越跑越卡」

| 检查项                                | 结论 / 修法                                             |
| ------------------------------------- | ------------------------------------------------------- |
| 有没有在控件外写裸 `effect`/`watch`？ | 挂到 `widget.scope`，或用 `bind*`                       |
| 有没有反复 `new` 控件却不销毁？       | `removeWidget(child, true)` 或 `removeAllWidgets(true)` |
| `ScrollView.setContent` 的旧内容？    | 会自动销毁；自己额外保存的引用要清掉                    |
| 每次数据更新都在建大对象？            | 让 `computed` 的依赖引用稳定，避免每帧重建整棵子树      |

---

## 5. 与 `PLAN.md` 的差异清单

`docs/PLAN.md` 同时描述**已实现**与**目标形态**。以下是当前代码与它的差异，写代码时以本节为准。

### 5.1 尚未实现（不要照着 PLAN 写）

| PLAN 提到的东西                                            | 状态                                                                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIScene` / `Page` / `PageStack` / `ModalStack` / `Router` | **M8 未开始**。目前一个场景 = 一个 `UIRoot`（`this.mvvm.root`）                                                                                                              |
| `Modal` 控件（遮罩 + 对话框 + 焦点陷阱 + ESC）             | **M8 未开始**。可用 `stack` + `setCapture` + `trapFocus` 自己拼（07 §6）                                                                                                     |
| `A11yBridge`（隐藏 DOM 镜像 + `aria-live`）                | **M9 未开始**。目前只有文本框的隐藏元素带 `aria-label`                                                                                                                       |
| `@phaser-mvvm/template`（JSON/模板层）                     | **Phase 2 未创建**                                                                                                                                                           |
| ESLint / coverage 门禁                                     | 仍未接入（CI 只跑 Prettier + typecheck + test + build + 示例构建）。**体积门禁已有**：`pnpm size`（`scripts/size-check.mjs`，按 min+gzip 判定），但尚未接进 CI，提交前手动跑 |

### 5.2 名义差异（功能在，但 API 与 PLAN 的草案不同）

| PLAN 草案                                       | 实际实现                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `this.mvvm.mount(vm, ViewFn, { root, width })`  | **`this.mvvm.mount(widget)`** —— 视图函数自己构造控件树并返回根控件                                                                                                                                                                                                                      |
| `command(async fn, { canExecute })` 辅助函数    | 没有这个函数：命令就是 ViewModel 上的普通方法，用 `bindCommand` 绑定                                                                                                                                                                                                                     |
| `bind()` / `model()` / `convert()` 具名绑定函数 | 对应实现是 `bindValue`/`bindPath`/`bindTemplate`、`bindModel`、模板里的 `\| converter`                                                                                                                                                                                                   |
| `style` / `class` 绑定                          | 未实现；样式走主题令牌 + 控件选项（`tone`/`variant`/`style`）                                                                                                                                                                                                                            |
| 布局通过注入的 `Measurer` 度量文本              | `layout` 包本身不度量（`measureContent` 由节点提供）；控件仍用**自身** `Text` 的 canvas 度量，但结果按场景缓存在 `packages/widgets/src/text-metrics.ts`（换行结果 + 省略号候选宽度 + 输入框逐串宽度，稳态命中率 100%）。`PhaserTextMeasurer` + `LruCache` 是适配层的独立工具，控件未使用 |
| `repeat` 的虚拟化按「等高行」自动推导           | 必须显式给 `itemExtent`（含行距）                                                                                                                                                                                                                                                        |

### 5.3 已知的小缺口

- **文本框的聚焦/失焦只有构造选项、没有事件**：`TextField`/`TextArea` 接受 `onFocus`/`onBlur` 选项（[04 §4](./04-text-inputs.md)），但不会 `emit` 对应事件；同理也没有 `text:focus` 之类的常量。今天若要「在任何地方观察焦点变化」，用两个现成的东西：`this.mvvm.focus.onFocusChange = (widget) => …`（框架级焦点变化，覆盖全部可聚焦控件），或轮询 `this.mvvm.focus.focusedWidget`。开发模式下框架本身也会打印 `focus: <name>` 轨迹（见下文「调试期会打印什么」）。
- **`MVVMPluginConfig` 无法从 Game Config 传入**：Phaser 只读取 `plugins.scene` 条目的 `key`/`plugin`/`mapping`，并以 `new Plugin(scene, pluginManager, mapKey)` 实例化，插件的第 4 个 `config` 参数恒为空。因此 `themeBackground`（恒为 `true`）、`navigation`、`onBack`、`input`/`focus` 选项当前都拿不到，需要运行期自行设置（[06 §6.1](./06-data-and-theme.md)、[07 §2](./07-input-focus-nav.md)）。
- **`UIRoot` 不设置 `scrollFactor`**：源码里没有任何 `setScrollFactor(0)`，主相机一旦滚动整棵 UI 会跟着动。要固定在屏幕上请自己调 `this.mvvm.root.setScrollFactor(0)`，或者只钉某一页（`page.setScrollFactor(0)`）——两种都受支持，指针空间是按**每个控件自己的**因子折算的（`#/hud` 是常驻示例）。
- **`hideMode` 尚未生效（`'keep'` 目前等同 `'collapse'`）**：`LayoutParams.hideMode` 会被解析保存，但引擎与 `Widget` 都没有读取它；真正决定「是否退出流」的是 `inFlow`（`Widget.inFlow === visible`）。**想在隐藏时保留占位**，今天可行的做法是外面套一个固定尺寸的容器，只切换里面那个节点的 `visible`：

  ```ts
  // Column 的高度由 slot 自己决定，与孩子是否可见无关
  Column({ width: 'fill', height: 48, alignItems: 'stretch' }, () => {
    Text('可能要隐藏的内容', { visible: () => on.value });
  });
  ```

  等真正实现 `hideMode: 'keep'` 时，注意它只应影响**布局流**：不可见的节点不应该变成可聚焦/可点击的（焦点与指针收集看的是 `visible`，不是 `inFlow`）。

- **`@phaser-mvvm/phaser` 里还留着 M0 的探针控件** `RectWidget`/`LabelWidget` 与 `uiRect`/`uiLabel` 工厂：可用；DSL 侧已把 `RectWidget` 包成 `Rect()`（[09 §4](./09-compose-dsl.md)），正式项目请用 `@phaser-mvvm/widgets` 的控件与 DSL。

---

## 6. 仓库约定（改代码前必读）

1. **只有 `packages/phaser` 可以 `import phaser`**；`core`/`layout` 零 Phaser 依赖（含类型），`widgets` 只能通过 `@phaser-mvvm/phaser` 间接使用。
2. **开发期包入口指向源码**（`types`/`import` → `src/index.ts`），所以改源码在 dev 里立刻生效；CJS 消费方需要先 `build`。**永远不要手改 `dist/`**。
3. **`dist/`、`.tmp/`、`coverage/` 都是生成物**（已 gitignore）：截图、日志、临时脚本放 `.tmp/`。
4. 提交前：`pnpm format` → 受影响包 `typecheck` + `test`；碰到控件外观/几何/交互的改动跑 `node scripts/visual-check.mjs`。
5. 新增发布包、改变包间依赖方向、引入运行时依赖、改动布局模型/响应式语义 → **必须先加一篇 ADR**（`docs/adr/`，新编号）。

---

## 7. 附录 A：控件选项速查

### `Label`

| 选项                 | 默认         |
| -------------------- | ------------ |
| `text`               | `''`         |
| `style`（TextStyle） | —            |
| `wrap`               | `true`       |
| `align`              | `'left'`     |
| `maxLines`           | 不限         |
| `ellipsis`           | `false`      |
| `tone`               | `'default'`  |
| `selectable`         | 只能 `false` |

### `Panel`

| 选项                           | 默认                |
| ------------------------------ | ------------------- |
| `direction`                    | `'vertical'`        |
| `gap` / `rowGap` / `columnGap` | `0`                 |
| `justifyContent`               | `'start'`           |
| `alignItems`                   | `'stretch'`         |
| `wrap` / `reverse`             | `false`             |
| `alignContent`                 | `'start'`           |
| `variant`                      | `'surface'`         |
| `radius`                       | `theme.radius.md`   |
| `border`                       | surface 系为 `true` |
| `elevation`                    | `0`                 |
| `interactive` / `blockPointer` | `false` / `true`    |

### `Button`

| 选项                                        | 默认          |
| ------------------------------------------- | ------------- |
| `text`                                      | `''`          |
| `icon`                                      | —             |
| `variant`                                   | `'secondary'` |
| `size`                                      | `'md'`        |
| `disabled` / `toggle` / `value` / `loading` | `false`       |
| `onClick`                                   | —             |

### `Image` / `Spacer` / `Divider`

| 控件      | 选项                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| `Image`   | `texture`（必填）、`frame`、`fit`（默认 `'contain'`）                                   |
| `Spacer`  | `flex`（默认 `false`，等价 `grow: 1`）                                                  |
| `Divider` | `orientation`（`'horizontal'`）、`color`（`border` 令牌）、`thickness`（`borderWidth`） |

### `TextField` / `TextArea`

| 选项                                                        | 默认                   |
| ----------------------------------------------------------- | ---------------------- |
| `label` / `value` / `placeholder`                           | `''`                   |
| `maxLength`                                                 | 不限                   |
| `inputType`                                                 | `'text'`               |
| `align`                                                     | `'left'`               |
| `readOnly` / `disabled` / `clearable`                       | `false`                |
| `dom`                                                       | `true`                 |
| `validate` / `onChange` / `onSubmit` / `onFocus` / `onBlur` | —                      |
| `rows` / `wrap` / `submitOnEnter`（仅 `TextArea`）          | `3` / `true` / `false` |

### `ScrollView`

| 选项               | 默认         |
| ------------------ | ------------ |
| `direction`        | `'vertical'` |
| `content`          | —            |
| `scrollbar`        | `'auto'`     |
| `scrollbarSize`    | `8`          |
| `wheelSpeed`       | `1`          |
| `drag` / `inertia` | `true`       |
| `bounce`           | `false`      |

### `Repeat`

| 选项                         | 默认            |
| ---------------------------- | --------------- |
| `items` / `key` / `template` | **必填**        |
| `update`                     | —（改为重建行） |
| `container`                  | 纵向 box        |
| `virtualize`                 | `false`         |
| `itemExtent`                 | —（虚拟化必填） |
| `overscan`                   | `2`             |
| `empty`                      | `null`          |
| `context`                    | 空根作用域      |

---

## 8. 附录 B：布局参数（`LayoutParams`）全字段

每个控件（以及 `vbox`/`hbox`/`uiGrid`/`uiStack`/`uiAbsolute`）都接受这些字段，与控件自己的选项写在同一层。

| 字段                                                | 类型                                                      | 默认         | 说明                                                                      |
| --------------------------------------------------- | --------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `width` / `height`                                  | `Length`                                                  | `'auto'`     | 主轴/交叉轴尺寸                                                           |
| `minWidth` / `maxWidth` / `minHeight` / `maxHeight` | `Length`（实际**只写数字**）                              | `0` / 无限   | 该轴的硬性上下限；百分比/`fill` 会按基准 0 解析成 0                       |
| `grow`                                              | `number`                                                  | `0`          | 主轴剩余空间权重                                                          |
| `shrink`                                            | `number`                                                  | `0`          | 主轴溢出时的收缩权重（默认不收缩，允许溢出）                              |
| `basis`                                             | `Length`                                                  | —            | grow/shrink 之前的初始主轴尺寸                                            |
| `margin`                                            | `number \| [v,h] \| [t,r,b,l] \| {top,right,bottom,left}` | 0            | 外边距（在父容器流里占位）                                                |
| `padding`                                           | 同上                                                      | 0            | 内边距（容器自己的内容盒内缩）                                            |
| `alignSelf`                                         | `'auto' \| 'start' \| 'center' \| 'end' \| 'stretch'`     | `'auto'`     | 覆盖父容器的 `alignItems`                                                 |
| `aspectRatio`                                       | `number`                                                  | —            | `宽/高`，给定一边推另一边                                                 |
| `position`                                          | `'flow' \| 'absolute'`                                    | `'flow'`     | 绝对定位则脱离文档流                                                      |
| `left` / `top` / `right` / `bottom`                 | `Length`                                                  | —            | 绝对定位偏移（水平优先 `left`，垂直优先 `top`）                           |
| `order`                                             | `number`                                                  | `0`          | box/grid 内的排序提示（稳定排序）                                         |
| `hideMode`                                          | `'collapse' \| 'keep'`                                    | `'collapse'` | **当前未被读取**；是否退出流取决于 `inFlow`（见 [02 §3](./02-layout.md)） |
| `gridColumn` / `gridRow`                            | `number`                                                  | —            | 网格坐标（**1 起始**）                                                    |
| `gridColumnSpan` / `gridRowSpan`                    | `number`                                                  | `1`          | 跨列 / 跨行                                                               |
| `name`                                              | `string`                                                  | —            | 调试名（不是布局字段，但可以写在同一个对象里）                            |

容器选项（写在同一个对象里给容器用）：

| 容器     | 选项                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| box      | `direction`、`gap`、`rowGap`、`columnGap`、`justifyContent`、`alignItems`、`wrap`、`alignContent`、`reverse`         |
| grid     | `columns`、`rows`、`minColumnWidth`、`minRowHeight`、`columnGap`、`rowGap`、`justifyItems`、`alignItems`、`autoFlow` |
| stack    | `align`（`'start' \| 'center' \| 'end'`，默认 `'center'`）                                                           |
| absolute | （无；只排 `position: 'absolute'` 的子节点）                                                                         |
| scroll   | `axis`（`'vertical' \| 'horizontal' \| 'both'`，由 `ScrollView` 内部使用）                                           |

---

## 9. 附录 C：事件、常量与工厂键

### 事件名

| 常量 / 事件                  | 值                  | 触发者                                                                   |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `WIDGET_EVENTS.ACTIVATE`     | `'widget:activate'` | 任何控件（载荷 `source`）；⚠️ 常量本身**未从包入口导出**，请直接写字面量 |
| `WIDGET_EVENTS.STATE_CHANGE` | `'widget:state'`    | 任何控件（载荷 `WidgetState`）；同上                                     |
| `BUTTON_EVENTS.CHANGE`       | `'change'`          | `Button` 开关模式（载荷 `boolean`）                                      |
| `TEXT_INPUT_EVENTS.CHANGE`   | `'change'`          | `TextField`/`TextArea`（载荷 `string`）                                  |
| `TEXT_INPUT_EVENTS.SUBMIT`   | `'submit'`          | `TextField`/`TextArea`（载荷 `string`）                                  |
| `MODEL_CHANGE_EVENT`         | `'change'`          | `bindModel` 监听的用户编辑事件                                           |
| `'scroll'` / `'content'`     | —                   | `ScrollView`                                                             |

> ⚠️ 文本框**没有** `focus`/`blur` 事件（用构造选项 `onFocus`/`onBlur`）。

### 常量

| 常量                                                                           | 值 / 含义                                                |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `DEFAULT_DRAG_THRESHOLD`                                                       | `8` —— 点击判定最大位移（px）                            |
| `SCROLL_DRAG_THRESHOLD` / `FLING_MIN_VELOCITY` / `KEY_LINE_STEP` / `MIN_THUMB` | `10` / `0.08` / `40` / `28`                              |
| `DEFAULT_OVERSCAN`                                                             | `2` —— 虚拟列表上下多挂的行数                            |
| `NAV_REPEAT_DEFAULTS`                                                          | `{ initialDelay: 350, repeatDelay: 90 }`                 |
| `GAMEPAD_AXIS_THRESHOLD` / `GAMEPAD_BUTTON_ACTIVATE` / `GAMEPAD_BUTTON_BACK`   | `0.5` / `0` / `1`                                        |
| `CARET_BLINK_MS` / `MIN_CONTENT_WIDTH` / `LINE_SPACING` / `PASSWORD_MASK`      | `500` / `96` / `1.25` / `'•'`                            |
| `DOM_CONTAINER_WARNING`                                                        | 缺少 DOM 容器时的控制台提示文本                          |
| `NAV_DIRECTIONS`                                                               | `['up','down','left','right']`                           |
| `BUILT_IN_CONVERTERS`                                                          | `upper, lower, trim, number, money, join, default, date` |

### 工厂键

| 来源                                  | 键                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `installFactories()`（phaser）        | `this.add.vbox`、`hbox`、`uiGrid`、`uiStack`、`uiAbsolute`、`uiRect`                                                               |
| `installWidgetFactories()`（widgets） | `this.add.uiLabel`、`uiPanel`、`uiButton`、`uiImage`、`uiSpacer`、`uiDivider`、`uiTextField`、`uiTextArea`、`uiRepeat`、`uiScroll` |
| 便捷查询                              | `FACTORY_KEYS`、`WIDGET_FACTORY_KEYS`、`factoriesInstalled()`、`widgetFactoriesInstalled()`                                        |

---

## 10. 附录 D：主题令牌与常用命令

### 主题令牌（`Theme`）

| 字段                                                                           | 默认（dark）                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `colors.background` / `surface` / `surfaceAlt` / `surfaceHover`                | `0x0d1117` / `0x161b22` / `0x1f2630` / `0x222b36`                 |
| `colors.overlay` / `primary` / `primaryHover` / `primaryPressed` / `onPrimary` | `0x000000` / `0x2f6feb` / `0x3b7cf5` / `0x2559c9` / `0xffffff`    |
| `colors.text` / `textMuted` / `textDisabled`                                   | `0xe6edf3` / `0x8b949e` / `0x5b6470`                              |
| `colors.border` / `borderStrong` / `focusRing`                                 | `0x30363d` / `0x484f58` / `0x58a6ff`                              |
| `colors.danger` / `success` / `warning`                                        | `0xf85149` / `0x3fb950` / `0xd29922`                              |
| `fontSize`                                                                     | `xs 12` / `sm 14` / `md 16` / `lg 20` / `xl 26`                   |
| `spacing`                                                                      | `xs 4` / `sm 8` / `md 12` / `lg 16` / `xl 24`                     |
| `radius`                                                                       | `sm 4` / `md 8` / `lg 12` / `pill 999`                            |
| `controlHeight`                                                                | `sm 28` / `md 36` / `lg 44`                                       |
| `borderWidth` / `focusRingWidth`                                               | `1` / `2`                                                         |
| `fontFamily`                                                                   | `system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif` |

（`light` 主题的字体/字号/间距/圆角/控件高与 dark 相同，只有颜色不同。）

### 常用命令

| 命令                                                         | 用途                                     |
| ------------------------------------------------------------ | ---------------------------------------- |
| `pnpm dev`                                                   | 示例 dev server（5173，`strictPort`）    |
| `pnpm typecheck` / `pnpm test` / `pnpm build`                | 全仓类型检查 / 单测 / 构建               |
| `pnpm format` / `pnpm format:check`                          | Prettier 写入 / 校验                     |
| `pnpm --filter @phaser-mvvm/<pkg> run typecheck\|test`       | 只验证某个包（并行开发期推荐）           |
| `node scripts/visual-check.mjs`                              | 无头 Chrome 几何 + 像素验收（需 Chrome） |
| `UPDATE_GOLDEN=1 pnpm --filter @phaser-mvvm/layout run test` | 重生成布局黄金快照（有意变更后）         |

### 常见任务索引

| 我要…                           | 看这里                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| 让一个元素居中                  | [02 §6](./02-layout.md)（`justifyContent`/`alignItems`/`stack`）      |
| 让内容占满剩余空间              | [02 §3](./02-layout.md)（`fill` / `grow` / `Spacer({flex:true})`）    |
| 做一个自适应卡片矩阵            | [02 §9](./02-layout.md)、[02 §7](./02-layout.md)（`columns: 'auto'`） |
| 做一个角标                      | [02 §10](./02-layout.md)（`stack` + `position: 'absolute'`）          |
| 做一个表单                      | [04 §7](./04-text-inputs.md)                                          |
| 做一个长列表                    | [05 §8](./05-lists-and-scroll.md)                                     |
| 数据驱动界面                    | [06](./06-data-and-theme.md)                                          |
| 换肤 / 自定义主题               | [06 §6](./06-data-and-theme.md)                                       |
| 让页面纯键盘可用                | [07 §3](./07-input-focus-nav.md)                                      |
| 做模态对话框                    | [07 §6](./07-input-focus-nav.md)                                      |
| 查「为什么没更新 / 为什么是 0」 | [08 §4](./08-lifecycle-and-pitfalls.md)                               |
