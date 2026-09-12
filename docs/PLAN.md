# phaser-mvvm 开发计划

> 基于 Phaser 4（`phaser@4.2.1 "Giedi"`；本地源码 `/Users/kuangshensheng/codes/phaser` 作为只读参考）的 MVVM UI 框架
> 目标：在 Phaser 4 渲染管线上提供「响应式数据 + 声明式视图 + 自动布局 + 基础控件」的完整 UI 方案
> 文档版本：v1.1（决策已冻结：§10.1 + §10.2 + §10.3，可直接执行）｜工作目录：`/Users/kuangshensheng/codes/phaser-mvvm`

---

## 1. 目标与非目标

### 1.1 目标

| # | 目标 | 可验证结果 |
|---|------|-----------|
| G1 | 响应式数据层 | `ref/reactive/computed/watch`，变更后 UI 在同一帧内批量刷新，无重复布局 |
| G2 | 自动布局 | 纵向 / 横向 / 网格 / 层叠 / 绝对定位；尺寸支持固定、百分比、内容自适应、填充、伸缩权重、间距、内边距、对齐 |
| G3 | MVVM 绑定 | 单向绑定、双向绑定（表单）、命令绑定、列表 `repeat`（键控复用 + 可选虚拟化）、格式化器 / 校验器 |
| G4 | 基础控件 | `Panel`、`Label`、`TextField`、`TextArea`、`Button`、`Image`、`Spacer`、`Divider`、`ScrollView` |
| G5 | 与 Phaser 4 正交 | 不 fork Phaser，只用公开 API + 插件 / 工厂注册；游戏逻辑照常使用原生 Phaser |
| G6 | 可测试 | 响应式与布局引擎零渲染依赖，可在 Node 中单元测试（含布局快照测试） |

### 1.2 非目标（明确排除，避免范围失控）

- 不做 HTML/CSS 引擎或浏览器兼容层：不支持 CSS 选择器、层叠、伪类、动画曲线之外的样式表。
- 不做可视化 UI 编辑器 / 设计稿导入（后续可基于 JSON 模板另立项目）。
- 不做 3D、物理、粒子相关控件。
- 不兼容 Phaser 3 API（可只吸收 rexUI 的设计经验，见 §4.7）。
- 不承诺无障碍（a11y）完整方案：范围限定为 **键盘全可达 + 手柄导航 + 隐藏 DOM 镜像**（供屏幕阅读器读取与 `aria-live` 播报），不做 WCAG 全量合规认证，也不复刻浏览器原生语义。

---

## 2. 技术基线与源码调研结论

以下结论均依据本机 Phaser 4.2.1 源码核对，是后续设计的硬约束：

| 结论 | 依据（源码路径） | 对设计的影响 |
|------|------------------|--------------|
| `Text` 样式能力足够做控件文本 | `src/gameobjects/text/TextStyle.js`：`letterSpacing`、`lineSpacing`、`wordWrap / wordWrapWidth / wordWrapCallback`、`align`、`fixedWidth/fixedHeight`、`padding`、`backgroundColor`、`maxLines`、`resolution` | 无需自绘文本；`Label`/`TextField` 直接包装 `Text`，测量走同一套字体度量 |
| `Container` 是布局容器的天然宿主 | `src/gameobjects/container/Container.js`：混入 `ComputedSize`(`setSize`)、`Transform`、`Mask`、`AlphaSingle`、`Visible`、`Depth`；`getBounds()` 逐子节点递归 | `Widget` 继承 `Container`；父容器自己维护子节点矩形，不依赖 `getBounds`（性能） |
| 所有 GameObject 都混入了 `Filters` | `src/gameobjects/GameObject.js:49` 混入 `Components.Filters`；`components/FilterList.js#addMask` | **WebGL 下裁剪必须用 Mask filter**（`enableFilters().filters.internal.addMask(...)`），这是 `ScrollView` 裁剪的官方路径 |
| `GeometryMask` 在 v4 仅 Canvas 可用 | `src/display/mask/GeometryMask.js` 文档 + `MIGRATION-GUIDE.md` 第 3 节 | 不能用 v3 的 `setMask(graphics)` 思路做滚动裁剪，必须走 filter mask 或相机视口方案 |
| Canvas 渲染器已弃用 | `changelog/v4/4.0/MIGRATION-GUIDE.md` 第 2 节 | 框架只保证 WebGL 路径正确；Canvas 仅做降级不崩溃 |
| 场景插件可用配置注入 | `src/core/Config.js:604-640`：`plugins.scene = [{ key, plugin, systemKey, sceneKey }]` | 框架以 `sceneKey: 'mvvm'` 暴露 `this.mvvm`，生命周期挂 `SHUTDOWN/DESTROY` |
| 工厂可注册自定义 Game Object | `src/gameobjects/GameObjectFactory.js:197` `register(factoryType, fn)`（参考 `ContainerFactory.js:31`） | 支持 `this.add.vbox/hbox/grid/label/textField/...` 与 `GameObjectCreator` 配置式创建 |
| 输入默认 `topOnly = true` | `src/input/InputPlugin.js:185`、`setTopOnly()` | UI 遮挡关系天然生效，但需要框架显式管理「输入拦截层」防止点击穿透到游戏 |
| 文本度量存在公开工具 | `src/gameobjects/text/MeasureText.js`、`TextStyle#metrics` | 适配层可封装测量器并做 LRU 缓存 |
| `NineSlice` 可拉伸描边贴图 | `src/gameobjects/nineslice/NineSlice.js` | `Panel`/`Button` 皮肤走九宫格；无贴图时用 `Graphics` 画圆角矩形兜底 |
| 本地 dist 体积大 | `dist/phaser.esm.js` ≈ 8.5 MB | 依赖走 npm `phaser@4.2.1`（见 §10 决策 2）；本地源码**只作为只读参考**用于核对 API 与 v4 变更，不链接进构建 |

---

## 3. 总体架构

### 3.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ apps/examples (Vite)          apps/form-demo                 │  示例与验收场
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/template         JSON/模板 → builder 编译（P2）  │  可选层
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/widgets          Panel/Label/TextField/Button/  │  控件库
│                               TextArea/Image/Spacer/Divider/  │
│                               ScrollView/Repeat/Modal(P2)     │
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/phaser           Widget 基类(Container 适配)、   │  Phaser 适配层
│                               UIRoot、测量器、输入/焦点路由、 │  （唯一允许
│                               ScenePlugin、工厂注册、主题绑定 │    依赖 Phaser）
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/layout           纯布局引擎：约束、测量、排布、   │  零 Phaser 依赖
│                               脏标记、缓存、像素对齐          │  → 可单测
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/core             响应式(reactive/ref/computed/   │  零 Phaser 依赖
│                               watch/effect/scope)、集合、     │
│                               绑定上下文、表达式编译、调度器  │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向：** `core` 与 `layout` **互不依赖**（两者都没有任何运行时依赖，可独立使用与单测）；`phaser` 依赖 `core` + `layout`；`widgets` 依赖前三者。分层图自上而下是「谁依赖谁」，不是「数据流向」。

**关键架构决策：布局引擎不依赖 Phaser。** 测量通过 `TextMeasurer` 接口注入（Phaser 适配层用真实 `Text` 度量，测试用等宽假测量器）。这样布局算法 100% 可单元测试、可在 Node 中跑回归快照，也让未来支持其他渲染后端成为可能。

### 3.2 包结构

```
phaser-mvvm/
├─ pnpm-workspace.yaml
├─ tsconfig.base.json                  # strict: true, noUncheckedIndexedAccess
├─ packages/
│  ├─ core/          src/{reactivity,collections,binding,expression,scheduler,util}
│  ├─ layout/        src/{constraint,params,measure,arrange,arrangers,nodepool,snap}
│  ├─ phaser/        src/{Widget,UIRoot,measurer,input,focus,nav,a11y,plugin,factory,theme,pool}
│  │                 src/scene/{UIScene,Page,PageStack,ModalStack,Router}   # M8
│  ├─ widgets/       src/{panel,label,textfield,textarea,button,image,spacer,divider,scrollview,repeat,modal}
│  └─ template/      src/{parser,compiler,renderer}            # Phase 2
├─ apps/
│  ├─ examples/      # 控件画廊（每个控件一页）+ 性能基准页
│  └─ form-demo/     # 完整 MVVM 表单：校验、列表、对话框、主题切换
└─ docs/             # PLAN.md、ADR/、api/、widget-spec/
```

构建：`tsup`（ESM + CJS + `.d.ts`）；测试：`vitest`（core/layout 纯 Node）+ 无头 Chrome 截图/几何断言（`scripts/visual-check.mjs`，Playwright 于 M4 起接入）；文档：`typedoc`；版本：`changesets`。

**CI 实际门禁（M0 起）**：`prettier --check .` + `pnpm -r typecheck` + `pnpm -r test` + `pnpm -r build` + `pnpm build:examples`。**ESLint 与体积门禁（size-limit）推迟到 M4**（M0–M2 由 `tsc --strict` + Prettier 覆盖，避免在没有可复用代码前引入配置负担），**覆盖率门禁（core ≥90%）在 M4 随 `@vitest/coverage-v8` 接入**。

---

## 4. 核心设计

### 4.1 响应式内核（`@phaser-mvvm/core`）

- **API**：`ref(v)`、`reactive(obj)`（深度 Proxy）、`computed(fn)`（惰性 + 缓存 + 自动依赖收集）、`watch(source, cb, { immediate, deep, flush })`、`effect(fn)`、`effectScope()`、`ObservableArray/Map/Set`、`makeObservable(instance)`（把类字段转为访问器，供 ViewModel 使用）。
- **依赖算法**：`activeEffect` 栈 + 每 effect 的 `deps: Set<Dep>`，每次执行前清理失效依赖（避免条件分支残留订阅导致的「幽灵更新」）。
- **调度器**：三类刷新时机 —— `sync`（立即，仅内部）、`pre`（微任务批量，ViewModel 变更后用）、`frame`（**默认给 UI 用**，在 Phaser 帧循环的固定点统一 flush，保证一帧内多次改数据只布局一次）。
- **ViewModel 约定**：普通类 + `makeObservable`，可选 `onMount/onUnmount`、`dispose()`；框架不强制继承任何基类。
- **防环**：绑定写回时值相等短路；`trigger` 深度上限 + 开发模式警告（渲染/布局期间写状态）。
- **生命周期安全**：所有 effect 归入 `EffectScope`，控件销毁时 `scope.stop()`，从根上杜绝订阅泄漏。

### 4.2 布局引擎（`@phaser-mvvm/layout`）

**模型**：两阶段 `measure → arrange`（Flutter/WPF 思路），单向下行传约束、上行回尺寸。

```
LayoutConstraint { minW, maxW, minH, maxH, mode: 'unbounded'|'atMost'|'exactly' }
LayoutParams {
  width, height,            // number | 'auto' | '50%' | 'fill' | { min?, max? }
  grow, shrink, basis,      // 主轴伸缩（flex 语义，可选实现）
  margin { t, r, b, l }, padding { t, r, b, l },
  alignSelf: 'auto'|'start'|'center'|'end'|'stretch',
  aspectRatio, position: 'flow'|'absolute', ignoreLayout,
  gridColumn, gridRow, gridColumnSpan, gridRowSpan,
  order
}
```

- **测量**：叶节点（`Label`/`Image`）用注入的 `Measurer` 求内容尺寸；容器按自身策略（box/grid）组合子尺寸；百分比基于父内容盒解析，`fill`/`grow` 在排布阶段分配剩余空间。
- **排布策略（Arranger）**：
  - `BoxArranger`：`direction: 'vertical' | 'horizontal'`；`justifyContent: start|center|end|space-between|space-around|space-evenly`；`alignItems: start|center|end|stretch`；`gap/rowGap/columnGap`；`wrap: boolean` + `lineAlign`（流式换行）。
  - `GridArranger`：`columns: number | 'auto'`、`rows`、`columnGap/rowGap`、`cellAlign/cellVAlign`、跨列/跨行、`autoFlow: row|column`；auto 列数由 `minColumnWidth` 推导。
  - `StackArranger`：子节点层叠（z 由 depth 决定），用于对话框/遮罩/角标。
  - `AbsoluteArranger`：`position: 'absolute'` 子节点按 `x/y/right/bottom/anchor` 定位，脱离文档流。
  - `FitArranger`：等比缩放适配（把设计尺寸的子树塞进目标框）。
- **缓存的正确性**：测量结果以 **(约束, 百分比基准, 内容修订号)** 为键缓存。内容（文本、子节点、样式、主题）变化时递增修订号；约束或基准变化自动失效（基准即 `layout(root, constraint, percentBase)` 的 `percentBase` 与容器 `contentSize`，百分比/`fill` 依赖它，缺了它就会读到别的包含块下的旧答案）。排布**增量重算**：干净且矩形未变的子树会被跳过（`stats.skippedSubtrees`），被标脏或位于 `dirtyPath` 上的子树一定重排。
- **脏标记的消费时机**：每趟 pass 开始时消费上一轮累积的脏标记；pass 运行期间（`measureContent`/`applyRect`/同步 watcher 中）新产生的 `invalidate()` 保留到下一趟，不会被本趟清掉。
- **脏传播与重布局边界**：`markNeedsLayout()` 向上冒泡时，遇到「尺寸不受父约束影响的节点」（固定尺寸 / 内容自适应且约束未变）即停止 —— 形成 relayout boundary（Flutter 同款思路），这是万级节点也能保持 O(变化量) 的关键。
- **像素对齐**：内部保留亚像素位置；在 `arrange` 末尾对**文本与细线**做 DPR 感知的取整（可配置 `snapTextToPixel`、`roundPixels`），兼顾清晰度与整体齐整。
- **零分配目标**：`Rect/Constraint` 用对象池；排布路径不产生临时闭包/数组。

### 4.3 Phaser 4 适配层（`@phaser-mvvm/phaser`）

- **`Widget` 基类**：`extends Phaser.GameObjects.Container`，同时实现布局节点接口。
  - 拥有 `layoutParams`、`measuredSize`、`onMeasureContent(constraint)`、`onArrange(rect)`（子类在此把矩形落到实际 GameObject 上，如 `Text.setWordWrapWidth`、`NineSlice.setSize`、遮罩矩形）。
  - 拥有 `scope: EffectScope`，`destroy()` 时 `scope.stop()` + 注销输入 + 归还对象池 + 断开主题订阅。
  - 统一状态机：`normal | hover | pressed | disabled | focused | error`，`skin` 决定每状态的视觉（九宫格 / Graphics）。
- **`UIRoot`**：每个 UI 页面一个根容器（设计分辨率 + 安全区），监听 `scale.on('resize')` 重新计算约束并触发一次布局；处理 DPR、`scrollFactor(0)`、depth 分层、可选的独立 UI 相机。
- **测量器 `PhaserTextMeasurer`**：包装 `Text` 度量 + LRU 缓存（键：文本 + 字体 + 字号 + 字距 + 换行宽度 + 行距），命中率高时可显著降低 `measureText` 调用。
- **输入与焦点**：
  - `InputRouter`：统一把 pointer/keyboard 事件分发给控件；面板级「拦截层」（透明矩形，命中即吞掉事件）阻止点击穿透到游戏世界；支持 `topOnly` + 捕获阶段拦截。
  - `FocusManager`：Tab/Shift+Tab 焦点链、方向键导航、焦点环（filter glow 或九宫格描边）、Enter/Space 激活、焦点丢失清理。
  - 长按、双击、拖拽阈值等手势语义统一在 `InputRouter` 内实现，控件只订阅语义事件。
- **场幕集成**：
  - `MVVMPlugin extends Phaser.Plugins.ScenePlugin`，`sceneKey: 'mvvm'`，暴露 `this.mvvm.mount(vm, view)`、`this.mvvm.theme`、`this.mvvm.layout()`；在 `SHUTDOWN/DESTROY` 自动卸载全部页面与绑定。
  - 工厂注册：`this.add.vbox/hbox/grid/stack/label/textField/button/image/spacer/divider/scrollView`，以及 `GameObjectCreator` 版本支持配置式创建。
  - 推荐用法：`UIScene`（UI 场景，常驻）叠加在游戏场景之上（`scene.launch`）。
- **场景与页面体系（Phase 1 交付）**：
  - `UIScene` 基类：自动挂载 `MVVMPlugin`、创建 `UIRoot`、处理设计分辨率与安全区、提供 `ui.show(page)` / `ui.back()`。
  - `Page`：一个页面 = 一个 ViewModel + 一个视图工厂 + 生命周期（`onEnter/onLeave/onPause/onResume`），页面间可传参；页面栈支持返回与缓存策略（`keepAlive`）。
  - `ModalStack`：对话框/弹窗层（`StackArranger` + 遮罩），支持焦点陷阱（焦点不逃逸到下层）、ESC/返回键关闭、遮罩点击策略（`closable`）、多弹窗层级、打开/关闭动效钩子。
  - 路由（可选轻量）：`Router` 把「路由名 → Page 类 + 参数」映射，供需要多页面导航的项目使用；不引入 URL 路由。
- **手柄导航（Phase 1 交付）**：`NavSource` 抽象把「方向键 / Tab / 手柄 D-Pad+摇杆 / 鼠标悬停」统一为焦点移动语义；手柄按键映射到 `activate / back / next / prev`，由 `FocusManager` 消费，控件无需感知输入设备。
- **无障碍（Phase 1 交付，范围见 §1.2）**：`A11yBridge` 为每个可交互控件维护隐藏 DOM 镜像节点（`role`/`aria-label`/`aria-valuenow` 等），焦点变化与状态播报走 `aria-live` 区域；镜像层与 DOM 输入桥共用同一个 overlay 容器，并受 `UIScene` 生命周期统一开关。

### 4.4 绑定与 MVVM（`core/binding` + `widgets`）

- **`BindingContext`**：`vm` + 作用域链（`$root`、`$item`、`$index`、`$parent`）；路径表达式 `user.address.city`、`items[0].name` 编译为 getter/setter 闭包（**不使用 `eval`/`new Function`**，兼容 CSP）。
- **绑定类型**：
  | 绑定 | 方向 | 示例 |
  |------|------|------|
  | `text` / `visible` / `enabled` / `src` | 单向 | `bind(vm, 'title')` |
  | `model` | 双向 | `model(vm, 'form.name')` |
  | `command` | 事件 → VM | `on: { click: cmd(vm, 'save') }`，含 `canExecute` 自动禁用 |
  | `repeat` | 集合 → 子视图 | 键控复用、视图池、可选虚拟化 |
  | `style` / `class` | 主题令牌 | `style: ['h2', { error: bind(vm,'hasError') }]` |
  | `convert` | 值转换 | `convert(vm, 'price', { format: 'money(2)' })` |
- **双向绑定回环防护**：写回前比较当前值；输入法 `compositionstart/end` 期间暂停写回（中文输入必需）；`TextField` 内部状态与 VM 状态单向权威（VM 为真相源）。
- **列表 `Repeat`**：`items` 变更 → 键控 diff（新增/删除/移动/更新）→ 复用控件 + `container.moveTo` 最小化重排；`virtualize: true` 时按等高行（或均匀行高）只挂载可见区间，用于长列表/网格。
- **命令与异步状态**：`command(async fn, { canExecute })`，内置 `pending/error` 可选暴露，方便按钮禁用 + loading 态。
- **模板层（Phase 2）**：JSON/HTML-like 模板（`{ type: 'textField', model: 'form.name', ... }`）编译为 builder 调用，供非程序员配置界面；表达式仅支持路径 + 过滤器子集。

### 4.5 控件规格（Phase 1 交付集）

| 控件 | 关键能力 | 依赖的 Phaser 能力 |
|------|----------|--------------------|
| `Panel` | 背景（九宫格 / 圆角矩形 / 纯色 / 渐变）、边框、圆角、内边距、可滚动（可选）、点击拦截层 | `NineSlice`、`Graphics` |
| `Label` | 文本、富样式令牌、自动换行、单行省略号、行高、对齐、阴影/描边、可测量 | `Text`（`wordWrap`、`maxLines`、`letterSpacing`） |
| `TextField` | 单行输入：光标闪烁、选区、键盘导航、剪贴板、`maxLength`、占位符、密码掩码、数字/正则过滤、`readOnly`、校验错误态、`onChange/onCommit/onFocus/onBlur`；**DOM 输入桥**支持 IME 与移动端软键盘 | `Text` + `Graphics`（光标/选区）+ `InputPlugin.keyboard` + 隐藏 `<input>` 桥 |
| `TextArea` | 多行、自动换行、内部滚动、Enter 换行 / Ctrl+Enter 提交 | 同上 + `FilterList#addMask` |
| `Button` | 状态机、皮肤、图标 + 文本、键盘激活、长按/连击、`toggle` 模式、禁用 | `NineSlice`/`Graphics` + `InputPlugin` |
| `Image` / `Icon` | 贴图、等比/拉伸模式、九宫格切图、`Fit` 适配 | `Image`、`NineSlice` |
| `Spacer` / `Divider` | 撑开空间 / 分割线（横竖） | 无（纯布局） |
| `Rect` | 纯色块（DSL 的 `Rect()`，对应适配层 `RectWidget`） | 无（纯绘制） |
| `ScrollView` | 拖拽 + 滚轮（含横向）+ 惯性 + 边界回弹（可选）+ 滚动条 + 内容裁剪 + 键盘滚动 | `FilterList#addMask`（WebGL 裁剪），备选相机视口方案 |
| `Repeat` | 列表/网格数据渲染、键控复用、虚拟化 | `Container` + 布局引擎 |
| `Modal` | 遮罩 + 对话框布局 + 焦点陷阱 + ESC 关闭 + 多层级（Phase 1） | `StackArranger` + `FocusManager` + `ModalStack` |

**TextField 输入桥设计（重点）**：Canvas 文本输入无法获得输入法候选与移动端软键盘，因此 `TextField` 采用「隐藏 DOM `<input>` 镜像」：
- 在画布上方按控件位置放置 `opacity: 0` 的 `<input>`（`domelement` 或自建 overlay div，需 `dom.createContainer: true` 与 `parent` 配置）；
- 监听 `input`/`compositionstart`/`compositionupdate`/`compositionend`/`keydown`/`paste`，把值同步到 VM 与显示文本，光标/选区由框架在 Canvas 内绘制（保证视觉一致与 z-order 可控）；
- 焦点同步：点击控件 → `input.focus()`；失焦 → 提交 + 关闭软键盘；
- 局限写入文档：DOM 桥在极端 DPR/缩放场景需校准，且不能与 `DOMElement` 控件同层混用；无桥的纯 Canvas 模式保留（英文/数字表单场景）。

### 4.6 主题与资源

- 令牌：颜色（语义色 `primary/surface/onSurface/danger`…）、字体族/字号阶梯、间距梯度、圆角、描边、动效时长。
- `Theme` 可切换（亮/暗/自定义），切换时对订阅了 `style` 的控件做定向刷新；控件不缓存颜色字面量。
- 皮肤：程序化（`Graphics`）皮肤默认可用（零资源依赖，便于先跑通），九宫格贴图皮肤作为可选增强。

### 4.7 先例参考（不做重复发明）

- rexUI 的 Sizer / GridSizer / FixWidthSizer / TextBox / TextEdit 是被验证过的 Phaser UI 组合方式（[Grid Sizer 文档](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/ui-gridsizer/)、[TextBox 文档](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/ui-textbox/)、[rexUI 插件介绍](https://phaser.io/news/2019/01/rexui-plugins)）：我们采纳其「Sizer 作为独立布局节点」「网格/流式两种排布」的经验，但把布局从命令式 API 升级为声明式 + 响应式 + 可缓存的两阶段引擎。
- 布局语义对齐 Flutter（约束下行、尺寸上行、relayout boundary）与 WPF（`Measure/Arrange`），降低学习与迁移成本。

---

## 5. API 草案（目标形态）

```ts
// 1) ViewModel：纯 TS 类 + 可选装饰性 API
export class UserFormVM {
  name = ref('');
  age = ref(0);
  users = reactive<User[]>([]);
  errors = computed(() => ({
    name: this.name.value.trim().length >= 2 ? undefined : '姓名至少 2 个字符',
  }));
  save = command(async () => { await api.save({ name: this.name.value }); }, {
    canExecute: () => !this.errors.value.name,
  });
}

// 2) 视图：类型安全的 builder（推荐默认）
export function UserForm(vm: UserFormVM) {
  return vbox({ gap: 12, padding: 16, fill: 'both' }, [
    label({ text: '用户信息', style: 'h2' }),

    textField({
      label: '姓名',
      model: model(vm, 'name'),          // 双向绑定
      placeholder: '请输入姓名',
      error: bind(() => vm.errors.value.name),
    }),

    textField({ label: '年龄', model: model(vm, 'age'), inputType: 'number', width: 120 }),

    grid({ columns: 3, gap: 12, fill: 'x' }, [
      ...vm.users.map((u) => card(u)),   // 或下面这种响应式写法
    ]),

    repeat({
      items: bind(() => vm.users),
      key: (u) => u.id,
      virtualize: true,
      template: (u) => card(u),
    }),

    hbox({ gap: 8, justifyContent: 'end' }, [
      button({ text: '重置', onClick: () => vm.reset() }),
      button({ text: '保存', command: vm.save, variant: 'primary' }),
    ]),
  ]);
}

// 3) 挂载：场景插件
export class DemoScene extends Phaser.Scene {
  create() {
    const vm = new UserFormVM();
    this.mvvm.mount(vm, UserForm, { root: 'center', width: 480 });
  }
}

// 4) 或配置式创建（工厂注册）
this.add.textField({ x: 0, y: 0, model: 'form.name', maxLength: 20 });
```

### 5.1 Compose 风格 DSL（已实现，推荐默认写法）

上面第 2 条的目标形态（`vbox({...}, [children])` builder）已由 **Compose 风格 DSL** 取代为默认写法：视图写成嵌套调用，容器的最后一个参数是内容 lambda，父子关系由作用域隐式建立，不再有 children 数组、不再需要 `this.add` 前缀。

```ts
import { ui, Column, Row, Text, Button, TextField, List, Scroll } from '@phaser-mvvm/widgets/compose';

const page = ui(this, () => {
  Column({ gap: 12, padding: 16, width: 520 }, () => {
    Text(() => `你好，${vm.name.value}`);          // ref / getter 自动绑定
    TextField({ value: vm.name, label: '姓名' });  // ref → 双向
    Scroll({ height: 240, direction: 'vertical' }, () => {
      List({ items: () => vm.users.value, key: (u) => u.id, virtualize: true, itemExtent: 34 },
        (user) => Text(() => user.name));
    });
    Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
      Button('重置', { variant: 'ghost', onClick: () => vm.reset() });
      Button('保存', { variant: 'primary', onClick: vm.save });
    });
  });
});
this.mvvm.mount(page);
```

要点（细节与选项表见 [`docs/guide/09-compose-dsl.md`](./guide/09-compose-dsl.md)）：

- **入口**：`@phaser-mvvm/widgets/compose` 子路径导出，与包根的同名控件类（`Panel`/`Button`/…）分开，避免符号覆盖；`ui(scene, content)` 返回根控件，仍需 `this.mvvm.mount()` 挂载。
- **选项词汇不变**：每个 composable 收的就是对应控件的选项对象，DSL 只改结构、不新增一层配置；工厂 API（`this.add.ui*`、`vbox/hbox/…`）继续可用且不被弃用。
- **作用域机制**：`packages/phaser/src/uiscope.ts`（纯逻辑、无 Phaser 运行时依赖、可在 Node 单测）提供 `runInUiScope`/`withUiParent`/`emitWidget`/`buildUiSubtree`；自定义控件可据此加入 DSL 树。
- **反应式参数**：数据槽位（文本、输入框 value）接受常量 / `Ref` / getter；`Ref` 在可写控件上是双向绑定（IME 组合期暂停写回，沿用 M5 语义）。外观槽位 `tone`（Label）、`variant`/`disabled`/`loading`（Button）同样接受 `Ref`/getter（按帧重绘，不重建节点）；所有 composable 还支持 `visible`（常量 / `Ref` / getter），隐藏即退出布局流，等价于 Compose 的 `if`。
- **验收**：`#/compose` 场景用 DSL 搭建全部控件与容器，并含 **parity 演示**（同一卡片用工厂 API 与 DSL 各搭一次，逐节点比对 `appliedRect`），实测 `parity=ok`（见 [`docs/ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md)）。
- **里程碑**：不新增里程碑编号，属于 M4/M6 之后的使用层演进（M8 起仍未开始）。

---

## 6. 里程碑计划

单人全职估算；标 ★ 的里程碑可与前一项局部并行。

**执行状态（2026-09）**：**M0 / M1 / M2 / M3 / M4 / M5 / M6 / M7 已完成并通过验收**，验收记录见 [`ACCEPTANCE-M0-M2.md`](./ACCEPTANCE-M0-M2.md)（含实测命令输出、端到端几何+像素校验、集成期发现并修复的 5 个真实缺陷、已知边界）。M3（适配层：文本测量器、主题、状态机、输入/焦点/导航、绑定切片）与 M4（基础控件库 `@phaser-mvvm/widgets`：Label/Panel/Button/Image/Spacer/Divider）已完成，并在 `#/gallery`、`#/dashboard`、`#/bindings` 三个 demo 上用 Playwright 实测交互通过。M5（`TextField`/`TextArea` + 隐藏 DOM 输入桥，中文 IME 已实测）已完成，其后按需增补了 **`Slider`**（拖动取值，鼠标+触摸均验收，见 [`ACCEPTANCE-slider.md`](./ACCEPTANCE-slider.md)）；M6（绑定上下文 + 路径编译 + 转换器 + `Repeat` 键控复用与虚拟化）已完成；M7（`ScrollView` + WebGL 滤镜裁剪 + 手势/惯性/滚动条，并与 `Repeat` 虚拟化协同）已完成；**M8 已交付两切片**：① `ModalStack`（`this.mvvm.modal.open()`：图层置顶 + 遮罩拦截 + 焦点陷阱 + `Esc`/遮罩关闭 + 叠层 + 泄漏门禁，见 [`ACCEPTANCE-modal.md`](./ACCEPTANCE-modal.md) 与指南 07 §6）；② **页面栈**（`this.mvvm.pages.push/pop/popToRoot` + `Page` 生命周期钩子 `onResume`/`onPause`/`onDispose`/`onBack` + `back` 逐层路由 `planBack()`，见 [`ACCEPTANCE-pages.md`](./ACCEPTANCE-pages.md) 与指南 07 §7）。两轮顺带修掉了它们暴露的 5 个缺陷（V17 键盘被输入框吞掉、V18 一次按键被重复派发、V20 覆盖 `focus.onBack` 拆掉路由、V21 页面 pop 后焦点丢失、V22 输入框里的 `Esc` 到不了应用，见 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.4/§3.5）。`UIScene` 基类、轻量 `Router`（路径/路由表）与开闭动效钩子**仍未开始**。**M9 也开始了一部分**：手柄导航（D-Pad/左摇杆/`A`/`B`、连发节流、`back` 逐层路由）已用假手柄跑通并写成常驻验收，见 [`ACCEPTANCE-gamepad.md`](./ACCEPTANCE-gamepad.md)；同轮修掉了"手柄操作不了值控件"的 V28。`NavSource` 抽象与 `A11yBridge`（无障碍）仍未开始。

| 里程碑 | 内容 | 交付物 | 验收标准 | 估算 |
|--------|------|--------|----------|------|
| **M0 骨架与基线** | pnpm workspace、TS strict、vite 示例、vitest、Prettier、CI 工作流（ESLint/size-limit/覆盖率门禁推迟到 M4）；Phaser 依赖策略落地（`peerDependencies: phaser ^4.2` + devDependency `phaser@4.2.1`，本地源码仅作参考）；ADR 记录关键决策（§10） | 可运行的空框架 + 一个用 `this.add.hbox()` 渲染出两个矩形的示例（`apps/examples` 的 `#/m0` 与 `#/probe`） | `pnpm install`、`pnpm -r typecheck`、`pnpm -r test`、`pnpm run build:examples` 全绿；`pnpm run visual-check` 截图成功且 `#status` 无错误行；`phaser.d.ts` 类型可解析 | 1–2 天 |
| **M1 响应式内核** ★ | `ref/reactive/computed/watch/effect/scope`、调度器（`sync/pre/frame`）、`ObservableArray/Map/Set`、`makeObservable` | `@phaser-mvvm/core` + 单测 | 依赖收集/清理、条件分支切换、嵌套 effect、批量 flush 语义、无泄漏（GC 断言）等 ≥40 用例通过 | 3–4 天 |
| **M2 布局引擎** ★ | 约束模型、`LayoutParams`、`BoxArranger`(纵/横/换行)、`GridArranger`、`Stack`、`Absolute`、测量缓存、脏传播 + relayout boundary、像素对齐 | `@phaser-mvvm/layout` + 布局快照测试 + 基准 | 40+ 布局用例（百分比/填充/伸缩/对齐/跨行列/auto 列数/边界）与黄金快照一致；1000 节点全量排布 < 1.5 ms；仅改一个子节点时排布工作量与其子树同阶 | 5–6 天 |
| **M3 Phaser 适配层** | `Widget` 基类、`UIRoot`、`PhaserTextMeasurer`(+LRU)、`InputRouter`、`FocusManager`、`MVVMPlugin`、工厂注册、主题基础 | `@phaser-mvvm/phaser` + 示例页 | 窗口缩放/DPR 变化布局正确；`this.mvvm.mount()` 可用；场景 shutdown 后控件/监听/绑定计数归零（泄漏测试） | 4–5 天 |
| **M4 基础控件** | `Panel`、`Label`、`Button`、`Image`、`Spacer`、`Divider` | `@phaser-mvvm/widgets`（第一批）+ 画廊页 | 每个控件有交互示例页与截图回归；按钮状态机、键盘激活、禁用、长按均通过 | 5–6 天 |
| **M5 文本框** | `TextField`、`TextArea`、DOM 输入桥、光标/选区/快捷键/剪贴板/掩码/校验/IME | widgets 第二批 + 表单页 | 中文输入法可用（含候选期不写回 VM）、软键盘可唤起（移动端手测）、剪贴板/快捷键矩阵测试通过 | 5–7 天 |
| **M6 绑定与列表** | `BindingContext`、路径编译、单向/双向/命令/转换器、`repeat` 键控复用与虚拟化 | `core/binding` 编译产物 + `Repeat` 控件 | 1000 行列表增删改移后仅挂载可见项；绑定无回环、无泄漏；CSP 环境下无 `eval` | 4–6 天 |
| **M7 滚动与裁剪** | `ScrollView`（拖拽/滚轮/惯性/滚动条/键盘）、WebGL 遮罩裁剪、与虚拟化协同 | `ScrollView` + 长列表页 | 滚动裁剪无溢出；滚动 + 虚拟化在 5000 项下稳定 60 fps；相机视口降级方案可用 | 4–6 天 |
| **M8 场景与页面体系**（**ModalStack + 页面栈已完成**，其余未开始） | `UIScene` 基类、`Page` 生命周期与页面栈、`ModalStack`（焦点陷阱 / ESC / 遮罩策略 / 开闭动效钩子）、轻量 `Router` | `packages/phaser/src/{modal,pages,back-plan,ui-build}.ts` + 多页示例 | ✅ 弹窗打开时焦点不逃逸、下层不可点、反复开关 100 次无泄漏（[`ACCEPTANCE-modal.md`](./ACCEPTANCE-modal.md)）；✅ 多页导航（列表→详情→对话框）可返回且状态正确、`churn(50)` 无泄漏（[`ACCEPTANCE-pages.md`](./ACCEPTANCE-pages.md)）；⬜ `UIScene` 基类与路径路由；⬜ 开闭动效钩子 | 4–6 天 |
| **M9 导航与无障碍**（**手柄已验收**，其余未开始） | `NavSource` 抽象（方向键 / Tab / 手柄 D-Pad + 摇杆 / 鼠标悬停）、手柄按键映射、`A11yBridge` DOM 镜像 + `aria-live` 播报 | `packages/phaser/src/{input,a11y}/*` + 手柄示例 | ✅ 手柄能导航/激活/返回，且能操作滑杆与滚动容器（[`ACCEPTANCE-gamepad.md`](./ACCEPTANCE-gamepad.md)）；⬜ 纯手柄完成**文本输入**表单（仍需要键盘）；⬜ VoiceOver 播报 | 3–5 天 |
| **M10 主题、文档、1.0** | 主题切换、皮肤、typedoc API 文档、控件规格文档、迁移/使用指南、1.0 发布与 changesets | 全量文档 + `form-demo` 完整示例 | 新同学按文档 1 小时内搭出带校验表单；包体积达标（见 §8） | 4–6 天 |

**总计约 42–59 个工作日（8–12 周）**；M1/M2 可并行、M9 可与 M7/M8 局部并行，压缩后约 8 周。

---

## 7. 测试与质量策略

| 层 | 手段 | 门禁 |
|----|------|------|
| `core` | vitest 单测（依赖收集、调度时序、边界：循环依赖、销毁后写入、同名路径） | M1 起先保证用例覆盖上述行为；覆盖率 ≥ 90% 的硬门禁在 M4 接入 coverage 提供者后启用 |
| `layout` | vitest 用例 + JSON 黄金快照（约束树 → 矩形树）；含 RTL、极端窄容器、`auto` 列数、跨行列冲突 | 用例 ≥ 40，快照零漂移 |
| `phaser` / `widgets` | Playwright + headless Chrome（WebGL）截图回归 + 交互脚本（点击/输入/Tab/滚动）；Canvas 降级冒烟 | 关键控件截图差异 < 0.5% |
| 泄漏 | 场景创建→销毁循环 100 次后断言 GameObject / 监听器 / effect 数量回到基线 | 必须归零 |
| 性能 | 基准页跑：1000 节点布局、1000 行虚拟列表、连续输入 10 s | 无掉帧、无内存增长趋势 |
| 类型 | `tsc --noEmit` 严格模式 + 示例工程类型检查（验证 `phaser.d.ts` 兼容） | 零错误 |
| 格式 | `prettier --check .`（`docs/PLAN.md`、`pnpm-lock.yaml` 在忽略列表内） | 零差异 |
| 端到端几何 | `node scripts/visual-check.mjs`：构建示例 → `vite preview` → 无头 Chrome 截图 + `--dump-dom` 断言 `#status` 中的真实 rect | 无 `ERROR:`/`REJECTION:` 行且几何符合预期 |

---

## 8. 性能预算与体积目标

预算与**测量方式**（第一次实测见 [`ACCEPTANCE-performance.md`](./ACCEPTANCE-performance.md)）：

- 布局：1000 节点全量 `measure+arrange` < 1.5 ms（M 系列 Mac，Node 基准）——由 `packages/layout/test/perf.test.ts` 断言（取预热后多次运行的最小值，避免 CI 抖动误报），实测 **0.06 ms**；无变化帧布局耗时 = 0——同一文件用**结构性**断言（一次无变化 pass 的 `measureCalls` 增量 = 0、`arrangeCalls` 增量 = 1、`skippedSubtrees` > 100；实测 0.02 ms，另有 1 ms 的粗略时间上界），因为在这个量级上计时无法区分「零工作」与「重测 922 个节点」；单节点内容变更仅重算 relayout boundary 子树——同一文件用逐节点 `measureCount` 证明「编辑 1 个节点只重测 1 个节点（共 922）」。
- 度量缓存：布局引擎的约束缓存命中率 > 95%（表单类界面）——`perf.test.ts` 实测键盘编辑 100 次为 **95.6%**，断言下限取 90% 以免随页面规模抖动，另用「编辑一次只重测一个节点」承担回归权重。
- 文本度量缓存：**已实现**（`packages/widgets/src/text-metrics.ts`，按场景的 `WeakMap` + LRU，缓存 `Label` 的换行结果与省略号搜索用的候选串宽度、`TextInputBase` 的逐串宽度）。测量口径与实测：**每一次不同的 (文本, 样式, 换行宽度) 恰好只度量一次（一次 miss），此后全部命中**——`#/states` 上连续 4 轮悬停扫描每轮 36 次命中、**0 次未命中**（稳态命中率 100%）；首屏 124 个不同字符串各付一次 miss，因此整段会话的累计命中率为 72%–89%（随会话变长收敛到 100%），"排布重算时不再重复度量同一文本"这条要求已满足。与关掉缓存的前后逐像素比对为 **0 像素差异**。
- 分配：排布热路径零新增对象/闭包——`perf.test.ts` 断言对象池（按深度索引的 `EngineContext`）在 200 次 pass 后长度不变、且这些 pass 不产生任何测量。
- 输入：连续输入（含 IME）不引发整树布局——浏览器实测：在 786 个控件的页面上输入 43 个字符，`passes` 增量为 **0**（输入框尺寸不随文本变化，连一次布局都不需要）；在 119 个控件的页面上输入 43 个字符为 4 次 pass、约 5 次测量/字符（只重测输入框自身子树）。
- 体积（gzip，不含 Phaser）：`core` + `layout` < 25 KB；`phaser` + `widgets` < 45 KB——由 `pnpm size`（`scripts/size-check.mjs`）在 **minify 后**的 gzip 上判定（库产物故意不 minify，便于堆栈可读；消费方打包时一定会 minify），实测 **18.3 KB** / **14.7 KB**，脚本同时打印未压缩 gzip 值（27.7 KB / 22.3 KB）以便对照。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Phaser 4 仍在演进（4.x API 漂移，如 filter 控制器重构） | 适配层反复返工 | 只有 `packages/phaser` 允许 import Phaser；版本范围收紧到 `^4.2`；升级时以截图回归兜底 |
| WebGL Mask filter 裁剪的开销与精度（`addMask` 需校准 `viewTransform/scaleFactor`） | 滚动列表性能/视觉问题 | M7 先做最小验证（10 项滚动列表 + 性能采样），必要时降级为「独立相机视口裁剪」并文档化取舍 |
| IME / 移动端软键盘 | 中文表单不可用（对本案是硬需求） | M5 直接用 DOM 输入桥；保留纯 Canvas 模式作为可选项；两种模式共用同一状态机 |
| DOM 输入桥与画布缩放/DPR 对齐 | 光标位置偏差、候选框错位 | 桥的位置每帧或每次布局后由控件矩形推导；提供校准用例与文档；不与 `DOMElement` 控件混层 |
| 响应式高频写入导致布局抖动 | 掉帧 | `flush: 'frame'` 默认帧对齐 + 微任务去重 + 布局脏标记合并；开发模式对「每帧多次布局」告警 |
| 文本清晰度（亚像素 vs 取整） | 字发虚或错位 1px | 内部亚像素 + 末尾 DPR 感知取整；`Text.setResolution` 策略可配置；截图回归锁定 |
| 输入穿透（UI 之下游戏仍在响应） | 交互串扰 | `Panel` 默认带拦截层 + `InputRouter` 捕获阶段处理 + `topOnly` 校验用例 |
| 绑定/effect 泄漏 | 长时间运行内存增长 | `EffectScope` + 场景事件自动卸载 + 泄漏回归测试（§7） |
| 范围蔓延（想做成 HTML/CSS） | 延期 | §1.2 非目标写入 ADR；里程碑控件预算固定，新增控件需替换或后移 |
| 团队学习成本（两阶段布局） | 使用/扩展门槛 | 布局算法配有图解 + 快照测试可当规范；控件模板示例齐全 |

---

## 10. 已确认决策（v1.1 冻结）

### 10.1 已确认（v1 评审通过，作为 M0 ADR 输入）

| # | 决策项 | 结论 | 落地方式 |
|---|--------|------|----------|
| 1 | 语言与视图写法 | **TypeScript + 代码优先 builder** | 视图即函数（`vbox/hbox/grid/label/textField/...`），返回类型化节点描述；类型安全 + 可断点调试；JSON/模板层延后到 Phase 2（模板层只做「路径 + 过滤器」的受限表达式子集，不使用 `eval`/`new Function`；Phase 2 立项时补一篇专题 ADR） |
| 2 | Phaser 依赖方式 | **npm `phaser@4.2.1`** | `peerDependencies: "phaser": "^4.2.0"` + devDependency 固定 `4.2.1`；本地源码 `/Users/kuangshensheng/codes/phaser` 仅作只读参考（核对 API 与 v4 变更），不参与构建与链接；`packages/phaser` 是唯一允许 import Phaser 的包 |
| 3 | 文本框能力范围 | **需要中文 IME + 移动端软键盘 → DOM 输入桥** | M5 直接实现隐藏 `<input>` 镜像桥（§4.5），光标/选区仍在 Canvas 绘制；需游戏配置开启 `dom.createContainer: true` 并提供 `parent`；同页不混用 `DOMElement` 控件；保留纯 Canvas 输入模式作为降级开关 |
| 4 | 主要场景 | **工具型表单界面与游戏内 HUD/菜单并重** | 按里程碑顺序推进：M4 基础控件（Panel/Label/Button/Image 等）先行，M5 补表单控件（TextField/TextArea）；M6 `Repeat`、M7 `ScrollView` 同时服务长列表与游戏内滚动菜单；主题系统需同时满足游戏风与工具风的换肤需求 |

### 10.2 已确认：Phase 1 全做（2026-09 二次评审）

| # | 决策项 | 结论 | 落地位置 |
|---|--------|------|----------|
| 5 | 独立 UI 场景与页面路由 | **Phase 1 交付**：`UIScene` 基类 + `Page` 生命周期 + 页面栈 + `ModalStack`（焦点陷阱 / ESC / 遮罩策略）+ 轻量 `Router`（不做 URL 路由） | M8；设计见 §4.3 |
| 6 | 无障碍（a11y）投入 | **Phase 1 交付受限范围**：每个可交互控件维护隐藏 DOM 镜像节点 + `aria-live` 状态播报 + 键盘全可达；不做 WCAG 全量合规认证 | M9；设计见 §4.3；范围见 §1.2 |
| 7 | 手柄（Gamepad）导航 | **Phase 1 交付**：`NavSource` 抽象统一方向键 / Tab / 手柄 D-Pad+摇杆 / 鼠标悬停，手柄按键映射为 `activate/back/next/prev` | M9；控件无需感知输入设备 |

### 10.3 由实施方自行决定（已定，随 M0 写入 ADR）

| 事项 | 决定 | 理由 |
|------|------|------|
| 包名与目录 | 根 workspace `phaser-mvvm`（private）；发布包 `@phaser-mvvm/{core,layout,phaser,widgets}`，`template` 延后 | scope 与项目同名，避免后续改名成本 |
| 工具链 | Node 24 / pnpm 10；构建 `tsup`（ESM+CJS+d.ts）；测试 `vitest`（core/layout 纯 Node）+ Playwright（控件截图，M4 起）；lint ESLint flat + Prettier；文档 TypeDoc；版本 Changesets | 全部为当前环境已具备或轻量可加 |
| 许可证 | MIT（与 Phaser 一致），`packages/*` 各自带 LICENSE 引用 | 便于他人复用 |
| 主题默认 | 内置 `dark` / `light` 两套语义令牌，默认 `dark`；控件不缓存颜色字面量 | 游戏内 UI 与工具界面都能直接换肤 |
| 焦点可视 | 用 `Graphics` 描边画焦点环（零资源依赖），九宫格贴图皮肤可选 | 无美术资源也能先跑通与测试 |
| 坐标与清晰度 | 布局内部亚像素；文本/细线在 `arrange` 末尾做 DPR 感知取整；`UIRoot` 负责 DPR 与安全区 | 兼顾排版精度与文字清晰 |
| 池化策略 | 列表项池 + `Rect/Constraint` 对象池；热路径不新建闭包/数组 | 满足 §8 的分配预算 |
| i18n | Phase 1 只提供 `formatter/validator` 扩展点，不内置多语言资源系统 | 避免与业务侧 i18n 方案冲突 |
| 输入桥与 a11y 层 | 二者共用同一个 overlay DOM 容器，由 `UIScene` 统一创建/销毁；同页不与 `DOMElement` 控件混层 | 一处管理 z-order 与生命周期 |

---

## 附：第一批实施的任务清单（M0–M1 可立即开跑）

1. 初始化 pnpm workspace、`tsconfig.base.json`、eslint/prettier、vitest、CI。
2. 写入 ADR-0001…0008（包划分、布局两阶段、零 Phaser 依赖的 layout、DOM 输入桥、依赖策略=`phaser@4.2.1`、Phase 1 含 UIScene/Page/Modal、a11y 受限范围、手柄导航抽象）。
3. `@phaser-mvvm/core`：`Dep/effect/ref/reactive/computed/watch/scope/scheduler` + 单测。
4. `apps/examples`：最小 Phaser 4 场景（WebGL）+ 框架 `hbox/vbox` 渲染出彩色矩形，作为 M0 验收。
5. 建立基准脚本（布局基准 + 文本度量缓存命中统计）与泄漏检测脚手架。
