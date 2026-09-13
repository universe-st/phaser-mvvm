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
| 场景插件可用配置注入 | `src/core/Config.js:604-640`：`plugins.scene = [{ key, plugin, systemKey, sceneKey }]` | 框架用 `{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm' }` 注册，于是 `this.mvvm` 可用（**插件配置对象仍由 Phaser 丢弃**：第 66 轮起改用 `MVVMPlugin.configure()` 设游戏级默认值），生命周期挂 `SHUTDOWN/DESTROY` |
| 工厂可注册自定义 Game Object | `src/gameobjects/GameObjectFactory.js:197` `register(factoryType, fn)`（参考 `ContainerFactory.js:31`） | 已实现：`this.add.vbox/hbox/uiGrid/uiStack/uiAbsolute/uiRect`（`packages/phaser`）+ `uiLabel/uiPanel/uiButton/uiImage/uiSpacer/uiDivider/uiSlider/uiTextField/uiTextArea/uiRepeat/uiScroll`（`packages/widgets`）。**没有** `GameObjectCreator` 版本（配置式创建未实现） |
| 输入默认 `topOnly = true` | `src/input/InputPlugin.js:185`、`setTopOnly()` | UI 遮挡关系天然生效，但需要框架显式管理「输入拦截层」防止点击穿透到游戏 |
| 文本度量存在公开工具 | `src/gameobjects/text/MeasureText.js`、`TextStyle#metrics` | 适配层可封装测量器并做 LRU 缓存 |
| `NineSlice` 可拉伸描边贴图 | `src/gameobjects/nineslice/NineSlice.js` | 九宫格皮肤是**可选增强、尚未使用**：当前所有皮肤都由 `Graphics` 程序化绘制（`packages/widgets/src/appearance.ts`、`packages/phaser/src/skin.ts`），仓库里没有任何 `NineSlice` 调用 |
| 本地 dist 体积大 | `dist/phaser.esm.js` ≈ 8.5 MB | 依赖走 npm `phaser@4.2.1`（见 §10 决策 2）；本地源码**只作为只读参考**用于核对 API 与 v4 变更，不链接进构建 |

---

## 3. 总体架构

### 3.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ apps/examples (Vite)                                         │  示例与验收场
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/template         JSON/模板 → builder 编译（P2）  │  可选层
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/widgets          Label/Panel/Button/Image/      │  控件库
│                               Slider/Spacer/Divider/TextField/│  （与 phaser 一样
│                               TextArea/ScrollView/Repeat/     │   直接 import
│                               VirtualKeyboard/Branch + DSL    │   phaser）
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/phaser           Widget 基类(Container 适配)、   │  Phaser 适配层
│                               UIRoot、测量器、输入/焦点/导航、│  （与 widgets 都直接
│                               ScenePlugin、工厂注册、主题、   │   依赖 Phaser）
│                               模态/页面栈/Router/UIScene      │
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/layout           纯布局引擎：约束、测量、排布、   │  零 Phaser 依赖
│                               脏标记、缓存、像素对齐          │  → 可单测
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/core             响应式(reactive/ref/computed/   │  零 Phaser 依赖
│                               watch/effect/scope)、集合、     │
│                               绑定上下文、表达式编译、调度器  │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向：** `core` 与 `layout` **互不依赖**（两者都没有任何运行时依赖，可独立使用与单测）；`phaser` 依赖 `core` + `layout`；`widgets` 依赖前三者。分层图自上而下是「谁依赖谁」，不是「数据流向」。**Phaser 只允许出现在 `phaser` 与 `widgets` 两个包**：`core`/`layout` 连类型都不引 Phaser；`widgets` 的每个控件都在 `new Phaser.GameObjects.…`，所以它把 `phaser` 当 peer dependency 直接 import（构建 `--external phaser`）。`widgets` 里另有若干**纯逻辑模块**（`text-edit`/`text-truncate`/`scroll-plan`/`repeat-plan`/`branch-plan`/`keyboard-plan`/`slider-geometry`/`zoom-plan`/`fit`/`color`）必须零 Phaser，因为它们要在 Node 里单测。

**关键架构决策：布局引擎不依赖 Phaser。** 测量通过节点自己的 `LayoutNode.measureContent(constraint)` 注入（适配层与控件层各自实现：`packages/phaser/src/measurer.ts` 的 `TextMeasurer`，以及控件层按场景复用的 `packages/widgets/src/text-metrics.ts`；测试用等宽假测量器）。这样布局算法 100% 可单元测试、可在 Node 中跑回归快照，也让未来支持其他渲染后端成为可能。

### 3.2 包结构

```
phaser-mvvm/
├─ pnpm-workspace.yaml
├─ tsconfig.base.json                  # strict: true, noUncheckedIndexedAccess
├─ packages/
│  ├─ core/          src/{reactivity,binding,utils}/ + index.ts
│  │                 （表达式编译在 binding/expression.ts、调度器在 reactivity/scheduler.ts）
│  ├─ layout/        src/{engine,constraint,params,box,grid,stack,scroll,geom,types,internal}.ts
│  ├─ phaser/        src/{Widget,LayoutWidget,UIRoot,UIScene,measurer,input,focus,nav,a11y,
│  │                        theme,skin,plugin,plugin-config,factory,binding,uiscope,ui-build,
│  │                        container-options,option-keys,widget-state,require-plugin,
│  │                        pages,modal,router,back-plan,page-motion,transition,reveal,
│  │                        pointer-chain,pointer-claim}.ts
│  │                 （对象池在 layout 引擎里，适配层没有 pool 模块）
│  ├─ widgets/       src/{Label,Panel,Button,Image,Slider,Spacer,Divider,TextField,TextArea,TextInputBase,ScrollView,Repeat,VirtualKeyboard,Branch}.ts + {compose,factories,options,appearance,…}.ts
│  │                 （**模态不在本包**：模态层是 phaser 的 `modal.ts`/`ModalHost`）
│  └─ template/      src/{parser,compiler,renderer}            # Phase 2（尚未创建）
├─ apps/
│  ├─ examples/      # 23 个场景（控件画廊 + 各验收页）+ `#status`/`#demo-state` 读数
│  └─ form-demo/     # 完整 MVVM 表单：规划中，尚未创建（现有表单示例在 `#/form`）
└─ docs/             # PLAN.md、adr/（10 篇）、guide/、ACCEPTANCE-*.md、PITFALLS.md、DEFECT-BACKLOG.md、HANDOVER.md
                     # api/（TypeDoc）、widget-spec/ 均未创建
```

构建：`tsup`（ESM + CJS + `.d.ts`，`phaser` 一律 `--external`）；测试：`vitest`（四个包都在纯 Node 下跑，`phaser`/`widgets` 带 `--passWithNoTests`）+ 无头 Chrome 的几何/像素/无障碍树断言（`scripts/visual-check.mjs`，**零依赖 CDP 脚本，不引入 Playwright 或任何浏览器测试框架**）；文档门禁：`pnpm docs:check`（`check-doc-snippets.mjs` + `check-doc-options.mjs`）；**公开 API 门禁：`pnpm api:check`（`scripts/check-api-surface.mjs`，第 110 轮起接进 CI，见 [ADR-0011](./adr/0011-public-api-freeze.md)）**；体积门禁：`pnpm size`（`scripts/size-check.mjs`，本地跑，未接进 CI）。`typedoc` 与 `changesets` **尚未接入**（1.0 的版本号与冻结由 ADR-0011 的门禁承担，而不是 changesets）。

**CI 实际门禁（M0 起）**：`prettier --check .` + `pnpm -r typecheck` + `pnpm -r test` + `pnpm -r build` + `pnpm build:examples`。**ESLint 与覆盖率门禁至今没有接入**（`@vitest/coverage-v8` 未安装、没有 vitest 配置文件、ci.yml 里也没有对应步骤）；体积门禁由 `pnpm size` 承担且只在本地跑。guide 的 [`08-lifecycle-and-pitfalls.md` §5](./guide/08-lifecycle-and-pitfalls.md) 维护了一份「PLAN 草案 vs 已实现代码」的差异清单。

---

## 4. 核心设计

### 4.1 响应式内核（`@phaser-mvvm/core`）

- **API**：`ref(v)`、`shallowRef(v)`、`reactive(obj)`（深度 Proxy，**集合也走它**：`reactive(new Map())`/`reactive(new Set())`，没有单独的 `ObservableArray/Map/Set` 类）、`computed(fn)`（惰性 + 缓存 + 自动依赖收集）、`watch(source, cb, { immediate, deep, flush })`、`effect(fn)`、`effectScope()`、`makeObservable(instance)`（把类字段转为访问器，供 ViewModel 使用）。
- **依赖算法**：`activeEffect` 栈 + 每 effect 的 `deps: Set<Dep>`，每次执行前清理失效依赖（避免条件分支残留订阅导致的「幽灵更新」）。
- **调度器**：**四类**刷新时机 —— `sync`（立即，仅内部）、`pre`（微任务批量，ViewModel 变更后用）、`post`（在 `pre` 之后、与 Phaser 的 `POST_UPDATE` 对齐，`watchPostEffect()` 用它）、`frame`（**默认给 UI 用**，在 Phaser 帧循环的固定点统一 flush，保证一帧内多次改数据只布局一次）。绑定层的 `flush` 同样是这四档（`packages/phaser/src/binding.ts` 的 `BindingFlush`，默认 `frame`）。
- **ViewModel 约定**：普通类 + `makeObservable`；框架不强制继承任何基类。**没有** `onMount`/`onUnmount` 这类 ViewModel 生命周期钩子（`mount()` 收的是控件，不是 ViewModel）。
- **防环**：绑定写回时值相等短路；`trigger` 深度上限 + 开发模式警告（渲染/布局期间写状态）。
- **生命周期安全**：所有 effect 归入 `EffectScope`，控件销毁时 `scope.stop()`，从根上杜绝订阅泄漏。

### 4.2 布局引擎（`@phaser-mvvm/layout`）

**模型**：两阶段 `measure → arrange`（Flutter/WPF 思路），单向下行传约束、上行回尺寸。

```
BoxConstraints { minWidth, maxWidth, minHeight, maxHeight }   // 由 tight()/loose()/atMost()/unbounded() 构造
LayoutParams {
  width, height,            // number | 'auto' | '50%' | 'fill' | { value, min?, max? }
  minWidth, maxWidth, minHeight, maxHeight,
  grow, shrink, basis,      // 主轴伸缩（flex 语义）
  margin, padding,          // number | [t,r] | [t,r,b,l] | { top, right, bottom, left }
  alignSelf: 'auto'|'start'|'center'|'end'|'stretch',
  aspectRatio, position: 'flow'|'absolute', hideMode: 'collapse'|'keep',
  left, top, right, bottom,
  gridColumn, gridRow, gridColumnSpan, gridRowSpan,
  order
}
```

- **测量**：叶节点（`Label`/`Image`）用注入的测量能力求内容尺寸（节点自己的 `measureContent(constraint)`，文本则走 `packages/phaser/src/measurer.ts` 的 `TextMeasurer` 或控件层的 `text-metrics.ts`）；容器按自身策略（box/grid/stack/**scroll**/absolute）组合子尺寸；百分比基于父内容盒解析，`fill`/`grow` 在排布阶段分配剩余空间。
- **排布策略**（纯函数 `measureBox`/`arrangeBox`、`measureGrid`/`arrangeGrid`、`measureStack`/`arrangeStack`、`measureAbsolute`/`arrangeAbsolute`、`measureScroll`/`arrangeScroll`，没有 `*Arranger` 类）：
  - box：`direction: 'vertical' | 'horizontal'`；`justifyContent: start|center|end|space-between|space-around|space-evenly`；`alignItems: start|center|end|stretch`；`gap/rowGap/columnGap`；`wrap: boolean` + `alignContent`（流式换行时行与行之间的分布）。
  - grid：`columns: number | 'auto'`、`rows`、`columnGap/rowGap`、`justifyItems`（横向）/`alignItems`（纵向）、跨列/跨行、`autoFlow: row|column`；auto 列数由 `minColumnWidth` 推导，`minRowHeight` 只在 `rows` 固定时参与。
  - stack：子节点层叠（**z 序由容器子节点顺序决定**，`StackLayoutOptions` 只有一个 `align`；`depth` 只用来把 UI 根/图层抬到游戏之上）。
  - absolute：`position: 'absolute'` 的子节点按 `left/top/right/bottom` 定位，脱离文档流（没有 `x`/`y`/`anchor` 键）。
  - `FitArranger`（把设计尺寸的子树等比缩进目标框）**未实现**；今天只有 `Image` 的 `fit` 选项（`packages/widgets/src/fit.ts`）。
- **缓存的正确性**：测量结果以 **(约束, 百分比基准, 内容修订号)** 为键缓存。内容（文本、子节点、样式、主题）变化时递增修订号；约束或基准变化自动失效（基准即 `layout(root, constraint, percentBase)` 的 `percentBase` 与容器 `contentSize`，百分比/`fill` 依赖它，缺了它就会读到别的包含块下的旧答案）。排布**增量重算**：干净且矩形未变的子树会被跳过（`stats.skippedSubtrees`），被标脏或位于 `dirtyPath` 上的子树一定重排。
- **脏标记的消费时机**：每趟 pass 开始时消费上一轮累积的脏标记；pass 运行期间（`measureContent`/`applyRect`/同步 watcher 中）新产生的 `invalidate()` 保留到下一趟，不会被本趟清掉。
- **脏传播与重布局边界**：`Widget.markDirty()` 递增修订号并交给 `LayoutEngine.invalidate()` 向上冒泡，遇到「尺寸不受父约束影响的节点」（固定尺寸 / 内容自适应且约束未变）即停止 —— 形成 relayout boundary（Flutter 同款思路，判据是 `isRelayoutBoundary`），这是万级节点也能保持 O(变化量) 的关键。
- **像素对齐**：内部保留亚像素位置；在 `arrange` 末尾对**整个矩形**做 DPR 感知的取整（`LayoutEngineOptions.snapMode: 'none'|'round'|'floor'|'ceil'` 默认 `'round'` + `dpr`；`UIRoot` 把同样的选项暴露给页面）。
- **零分配目标**：复用 `EngineContext` 池与每节点的子记录，排布路径不产生临时闭包/数组（`Rect`/`Size`/`BoxConstraints` 是普通对象，**没有对象池**；`perf.test.ts` 断言的是池长度稳定）。

### 4.3 Phaser 4 适配层（`@phaser-mvvm/phaser`）

- **`Widget` 基类**：`extends Phaser.GameObjects.Container`，同时实现布局节点接口。
  - 拥有 `layoutParams`、`measureContent(constraint): Size`、`applyRect(rect): void`（子类在此把矩形落到实际 GameObject 上，如 `Text.setWordWrapWidth`、遮罩矩形），以及只读的 `appliedRect`；**没有** `on…` 前缀的同名方法，也没有 `measuredSize`。
  - 拥有 `scope: EffectScope`，`destroy()` 时 `scope.stop()` + 注销输入 + 归还复用的记录 + 断开主题订阅。
  - 统一状态机：`normal | hover | pressed | disabled | focused | error`，外观由主题令牌 + 控件选项（`variant`/`tone`/`size`）决定，笔画由 `Graphics` 程序化绘制（九宫格皮肤未实现）。
- **`UIRoot`**：每个 UI 页面一个根容器（设计分辨率 + 安全区），监听 `scale.on('resize')` 重新计算约束并触发一次布局；选项是 `align`/`depth`/`dpr`/`snapMode`/`container`/`safeArea` —— **它不设置 `scrollFactor`**（钉住 UI 由调用方 `page.setScrollFactor(0)` 决定，见 [ADR-0009](./adr/0009-camera-pinned-ui-and-input.md)），也没有「独立 UI 相机」选项。
- **测量器 `PhaserTextMeasurer`**：包装 `Text` 度量 + LRU 缓存（键：文本 + 字体 + 字号 + 字距 + 换行宽度 + 行距），命中率高时可显著降低 `measureText` 调用。
- **输入与焦点**：
  - `InputRouter`：统一把 pointer/keyboard 事件分发给控件；面板级「拦截层」（透明矩形，命中即吞掉事件）阻止点击穿透到游戏世界；支持 `topOnly` + 捕获阶段拦截。
  - **指针事件链（第 107 轮，见 [ADR-0010](./adr/0010-pointer-event-chain.md)）**：命中测试之上补一条 Android 风格的有序链（`pointer-chain.ts`，纯逻辑、Node 单测）。`down` 自根向下逐个询问 `onPointerIntercept`（第一个 `true` 拿走事件、更深节点完全收不到），最深节点用 `onPointerEvent` 决定**消费**（`true`）还是**向上冒泡**；消费即拥有整次手势，之后的 `move`/`up` 只沿**保留的路径**投递、**从不重新命中测试**（指针离开控件/嵌套口/画布照样送达，`event.inside` 说明还在不在里面）；手势进行中祖先仍可拦截，被夺走的一方收到带原因的 `cancel`；子控件用 `requestDisallowInterceptPointer()`（复用 `pointer-claim.ts` 的认领表）禁止祖先拦截。两个钩子同时是基类选项。**与既有点击机器是相加关系**：无人消费时按下/悬停/激活/阈值判定原样执行；消费则抑制 `activate()`；被拦截的按下连「按下」都不算（不留状态、不抢焦点、抬手不点击）。每次分发产出 `PointerChainTrace`（`InputRouter#lastChain`/`#chains()`/`onPointerChain`），常驻验收场 `#/events`。
  - `FocusManager`：Tab/Shift+Tab 焦点链、方向键导航、焦点环（filter glow 或九宫格描边）、Enter/Space 激活、焦点丢失清理。
  - 手势语义：**只有拖拽阈值**（`InputRouterOptions.dragThreshold`，默认 8px）在 `InputRouter` 里实现；**长按与双击没有实现**（双击/三击只存在于纯 Canvas 文本字段的选词里，见 `TextInputBase`），控件只订阅语义事件。
- **场幕集成**：
  - `MVVMPlugin extends Phaser.Plugins.ScenePlugin`，在 Game Config 里以 `mapping: 'mvvm'` 注册，暴露 `this.mvvm.mount(widget)`（**一个控件参数**，不是 `mount(vm, view)`）、`this.mvvm.theme`、`this.mvvm.flush()`（**没有 `layout()`**：立即布局是 `UIRoot.flushLayout()`）；在 `SHUTDOWN/DESTROY` 自动卸载全部页面与绑定。
  - 工厂注册：`this.add.vbox/hbox/uiGrid/uiStack/uiAbsolute/uiRect` 与 `uiLabel/uiPanel/uiButton/uiImage/uiSpacer/uiDivider/uiSlider/uiTextField/uiTextArea/uiRepeat/uiScroll`；**没有 `GameObjectCreator` 版本**。
  - 推荐用法：`UIScene`（UI 场景，常驻）叠加在游戏场景之上（`scene.launch`）。
- **场景与页面体系（Phase 1 交付）**：
  - `UIScene` 基类（**已交付，第 68 轮**）：`content()` 建树 + 自动挂载（规则与 `ui()`/`render()` 相同）、`setContent()` 整页替换、`onBack()` 在 `back` 路由中先于应用层、`page`/`contentInfo` 读数、缺插件时的指名错误（`requireMVVMPlugin()`）。**与本节早期草案的差异**：不解 `MVVMPlugin`（插件仍由 Game Config 注册，缺了就在 `create()` 里报出修法）、也没有 `ui.show(page)`/`ui.back()`——多页面用 `this.mvvm.pages`，整页替换用 `setContent()`。**设计分辨率与安全区**由 `UIRoot` 负责：第 72 轮起 `safeArea`（默认开启）读取 `env(safe-area-inset-*)` 并把它设成根的内边距，见 [`ACCEPTANCE-mobile.md`](./ACCEPTANCE-mobile.md)。
  - 页面（**已交付，第 62 轮**）：`packages/phaser/src/pages.ts` 的 `PageHost` + `PageHandle`，选项 `PageOptions`（`name`/`onResume`/`onPause`/`onDispose`/`onBack`/`transition`），经 `this.mvvm.pages` 使用；页面间可传参。**没有 `Page` 类、没有 `keepAlive`**（被盖住的页由构造方式保持存活，不是选项），也没有 `onEnter`/`onLeave`。
  - `ModalHost`（**已交付**，`packages/phaser/src/modal.ts`，经 `this.mvvm.modal` 使用；PLAN 早期叫 `ModalStack`）：对话框/弹窗层（`stack` 容器 + 遮罩），支持焦点陷阱（焦点不逃逸到下层）、ESC/返回键关闭、遮罩点击策略、多弹窗层级、打开/关闭动效（**已交付，第 74 轮**）：动效不在 `ModalHost` 内部写死，而是 `transition.ts` 的 `TransitionRunner`（逐帧、成组、目标抢占）——遮罩只淡 alpha、主体淡 alpha + 轻微缩放，时长/缓动由 `MVVMPluginConfig.transition` 定策略、`ModalOptions.transition` 逐对话框覆盖；**关闭当帧完成所有交互语义（弹栈、焦点归还、指针捕获），只有图层的销毁被推迟到出场动画结束**，`this.mvvm.transitions.pending` 是"还有多少目标在动"。见 [`ACCEPTANCE-transition.md`](./ACCEPTANCE-transition.md)。
  - 路由（可选轻量，**已交付，第 75 轮**）：`Router` 把「路径 → 视图」映射成一张表（`path` 可含 `:参数`，也可在 `navigate()` 时附带显式参数），供需要多页面导航的项目使用；**不引入 URL 路由**（从不读 `location`），导航仍然只是 `pages.push()`——所以 `Esc`、页面生命周期、焦点与输入桥的行为与直接用 `pages` 完全一致。`current`/`history` 按页面 id 簿记，页面被 `Esc` 或 `pages.pop()` 拿走时会自动忘记。路径匹配规则（字面量优先、声明顺序、原型链守卫）在 `route-plan.ts` 里是纯函数并配 Node 单测。见 [`ACCEPTANCE-router.md`](./ACCEPTANCE-router.md)。
- **手柄导航（Phase 1 交付）**：`NavSource` 抽象把「方向键 / Tab / 手柄 D-Pad+摇杆 / 鼠标悬停」统一为焦点移动语义；手柄按键映射到 `activate / back / next / prev`，由 `FocusManager` 消费，控件无需感知输入设备。
- **无障碍（Phase 1 交付，范围见 §1.2）**：`A11yBridge` 为每个可交互控件维护隐藏 DOM 镜像节点（`role`/`aria-label`/`aria-valuenow` 等），焦点变化与状态播报走 `aria-live` 区域；镜像层与 DOM 输入桥共用同一个 overlay 容器，并受 `UIScene` 生命周期统一开关。**镜像 DOM 与控件树同构**（第 103 轮）：每个节点挂在最近的、有镜像节点的祖先控件之下，于是容器角色能表达包含关系——模态的 content 根是 `role="dialog"` + `aria-modal`（名字取 content 根的 `label`）、带 `label` 的容器是具名 `group`、`ScrollView` 的 `region` 真的装着它的控件；自带 DOM 元素的控件（文本框的 `<input>`）用 `aria-owns` 挂进它本该属于的那个节点，只改无障碍树里的父子关系，不动 DOM 位置与焦点。被盖住的内容（模态之外 / 栈里 `active === false` 的页）一律 `aria-hidden`，持有 DOM 焦点的控件及其祖先链例外。见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md) §11。

### 4.4 绑定与 MVVM（`core/binding` + `widgets`）

- **`BindingContext`**：`vm` + 作用域链（`$root`、`$item`、`$index`、`$parent`）；路径表达式 `user.address.city`、`items[0].name` 编译为 getter/setter 闭包（**不使用 `eval`/`new Function`**，兼容 CSP）。
- **绑定类型**（`packages/phaser/src/binding.ts` 的具名函数，**没有**通用的 `bind()`/`model()`/`cmd()`/`convert()`）：
  | 绑定 | 方向 | 真实 API |
  |------|------|------|
  | 文本 / 可见 / 可用 / 校验错误 | 单向 | `bindText`、`bindTemplateText`、`bindVisible`、`bindEnabled`、`bindError`（通用入口是 `bindValue`/`bindPath`/`bindTemplate`） |
  | 双向 | 双向 | `bindModel`（按源类型分派）、`bindValueModel`、`bindNumberModel`、`bindBooleanModel` |
  | 命令（含 `canExecute` 自动禁用） | 事件 → VM | `bindCommand(widget, fn, { canExecute, onError })` |
  | 列表 | 集合 → 子视图 | `Repeat`/DSL 的 `List()`：键控复用 + 可选虚拟化（**没有视图池**：离开窗口的行会被销毁，回来的行是新建的） |
  | 外观 | 主题令牌 | **没有 `style`/`class` 绑定**：外观由选项驱动（`tone`/`variant`/`size` + 主题令牌），状态槽位接受 `ref`/getter |
  | 值转换 | 值转换 | 转换器是模板里的过滤器（`{{ path \| converter }}`，`registerConverter()`/`BUILT_IN_CONVERTERS`），没有 `convert()` 函数 |
- **双向绑定回环防护**：写回前比较当前值；输入法 `compositionstart/end` 期间暂停写回（中文输入必需）；`TextField` 内部状态与 VM 状态单向权威（VM 为真相源）。
- **列表 `Repeat`**：`items` 变更 → 键控 diff（新增/删除/移动/更新）→ 复用控件 + `container.moveTo` 最小化重排；`virtualize: true` 时按等高行（或均匀行高）只挂载可见区间，用于长列表/网格。
- **命令与异步状态**：命令就是 ViewModel 上的普通方法（`bindCommand(widget, fn, { canExecute })`）；`canExecute` 为假时按钮自动禁用，异步命令的 pending 可自己写进 `disabled`/`loading` 槽位。
- **模板层（Phase 2）**：JSON/HTML-like 模板（`{ type: 'textField', model: 'form.name', ... }`）编译为 builder 调用，供非程序员配置界面；表达式仅支持路径 + 过滤器子集。

### 4.5 控件规格（Phase 1 交付集）

| 控件 | 关键能力 | 依赖的 Phaser 能力 |
|------|----------|--------------------|
| `Panel` | 变体（`surface`/`surfaceAlt`/`overlay`/`primary`/`danger`/`plain`）、边框、圆角、内边距、阴影层级、点击拦截层（`interactive`/`blockPointer`）。**没有渐变、没有"可滚动"选项**（要滚动就套 `ScrollView`） | `Graphics`（程序化皮肤；九宫格未实现） |
| `Label` | 文本、`tone` 语义色、`size` 字号档、自动换行、`maxLines` + `ellipsis`、对齐、`style` 覆盖（字体/描边/阴影）、可测量 | `Text`（`wordWrap`、`letterSpacing`） |
| `TextField` | 单行输入：光标闪烁、选区、键盘导航、剪贴板、`maxLength`、占位符、密码掩码、`inputType: text\|number\|password\|email\|search`、`readOnly`、校验错误态、`onChange/onSubmit/onFocus/onBlur`；**DOM 输入桥**支持 IME 与移动端软键盘（`dom: false` 走纯 Canvas 路径）；拖动选择 / 双击选词 / 三击选行 | `Text` + `Graphics`（光标/选区）+ `InputPlugin.keyboard` + 隐藏 `<input>` 桥 |
| `TextArea` | 多行、自动换行、内部滚动、Enter 换行 / Ctrl+Enter 提交（`submitOnEnter` 可互换） | 同上（纯 Canvas 路径靠自己滚动，不建 mask） |
| `Button` | 状态机、皮肤、图标 + 文本、键盘激活、`toggle` 模式（`value` 槽位）、`loading`、禁用。**没有长按/连击**（重复激活是刻意不做的） | `Graphics` + `InputPlugin` |
| `Image` | 贴图 + 帧（都是数据槽位）、`fit: 'contain'\|'cover'\|'fill'\|'none'` | `Image`（没有九宫格切图、没有 `Fit` 布局） |
| `Spacer` / `Divider` | 撑开空间 / 分割线（横竖） | 无（纯布局） |
| `Rect` | 纯色块（DSL 的 `Rect()`，对应适配层 `RectWidget`） | 无（纯绘制） |
| `Slider` | 拖动取值、键盘操作、`min`/`max` 数据槽、禁用态（第 42/99 轮补入交付集） | `Graphics` + `InputPlugin` |
| `ScrollView` | 拖拽 + 滚轮（含横向）+ 惯性 + 边界回弹（`bounce`）+ 滚动条 + 内容裁剪 + 键盘滚动 + 双指缩放（`zoom`）+ **嵌套链式传递**（内层到头后剩余增量交给外层；滚轮与拖拽同规则，第 70 轮统一） | `FilterList#addMask`（WebGL 裁剪；非 WebGL 回退 `GeometryMask`） |
| `Repeat` | 列表/网格数据渲染、键控复用、虚拟化（等高行 + `overscan`） | `Container` + 布局引擎 |
| `VirtualKeyboard` | 屏幕键盘（文字/数字两套键集，`kind` 是数据槽）、D-Pad 走查 + `A` 打字、`⇧` 一次性/锁定（第 81 轮补入交付集） | `Button` × N + `FocusManager` |
| `Branch` | 结构性切换（按 key 建一个分支、切 key 销毁旧分支），页面级入口规则 | `Container` + `Widget.destroy()` |
| `Modal` | 遮罩 + 对话框布局 + 焦点陷阱 + ESC 关闭 + 多层级（Phase 1，**不是控件**：`this.mvvm.modal.open()` / `ModalHost`） | `stack` 容器 + `FocusManager` + `ModalHost` |

**TextField 输入桥设计（重点）**：Canvas 文本输入无法获得输入法候选与移动端软键盘，因此 `TextField` 采用「隐藏 DOM `<input>` 镜像」：
- 在画布上方按控件位置放置 `opacity: 0` 的 `<input>`（`domelement` 或自建 overlay div，需 `dom.createContainer: true` 与 `parent` 配置）；
- 监听 `input`/`compositionstart`/`compositionupdate`/`compositionend`/`keydown`/`paste`，把值同步到 VM 与显示文本，光标/选区由框架在 Canvas 内绘制（保证视觉一致与 z-order 可控）；
- 焦点同步：点击控件 → `input.focus()`；失焦 → 提交 + 关闭软键盘；
- 局限写入文档：DOM 桥在极端 DPR/缩放场景需校准，且不能与 `DOMElement` 控件同层混用；无桥的纯 Canvas 模式保留（英文/数字表单场景）。

### 4.6 主题与资源

- 令牌：颜色（语义色 `primary/surface/onSurface/danger`…）、字体族/字号阶梯、间距梯度、圆角、描边、**动效时长**（`theme.motion`：在场/离场毫秒数，转场系统直接读它，见指南 06 §6.2；第 80 轮交付）。
- `Theme` 可切换（亮/暗/自定义），切换时对订阅了 `style` 的控件做定向刷新；控件不缓存颜色字面量。
- 皮肤：程序化（`Graphics`）皮肤默认可用（零资源依赖，便于先跑通），九宫格贴图皮肤作为可选增强。

### 4.7 先例参考（不做重复发明）

- rexUI 的 Sizer / GridSizer / FixWidthSizer / TextBox / TextEdit 是被验证过的 Phaser UI 组合方式（[Grid Sizer 文档](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/ui-gridsizer/)、[TextBox 文档](https://rexrainbow.github.io/phaser3-rex-notes/docs/site/ui-textbox/)、[rexUI 插件介绍](https://phaser.io/news/2019/01/rexui-plugins)）：我们采纳其「Sizer 作为独立布局节点」「网格/流式两种排布」的经验，但把布局从命令式 API 升级为声明式 + 响应式 + 可缓存的两阶段引擎。
- 布局语义对齐 Flutter（约束下行、尺寸上行、relayout boundary）与 WPF（`Measure/Arrange`），降低学习与迁移成本。

---

## 5. API 形态（1.0 已冻结）

> 这一节在 M0 之前写的是**目标形态的草案**（`vbox({...}, [children])` builder、`model()`/`bind()`/`command()`、`this.mvvm.mount(vm, View, options)`）。那些名字**从未实现**，第 110 轮已把它们从本节删掉，换成**真实存在的 API**。草案名与已实现名的完整差异清单见 [`guide/08-lifecycle-and-pitfalls.md`](./guide/08-lifecycle-and-pitfalls.md) §5。
>
> 对外承诺的公开面已冻结为 [`docs/API-SURFACE.json`](./API-SURFACE.json)（第 110 轮，[ADR-0011](./adr/0011-public-api-freeze.md)）：5 个入口点的 817 个导出名，由 `pnpm api:check` 守住。**本节与它不一致时以它和入口文件为准。**

```ts
// 1) ViewModel：纯 TS 类 + 响应式原语（没有装饰器，也没有基类）
import { computed, reactive, ref } from '@phaser-mvvm/core';

export class UserFormVM {
  name = ref('');
  age = ref(0);
  users = reactive<User[]>([]);
  errors = computed(() => ({
    name: this.name.value.trim().length >= 2 ? null : '姓名至少 2 个字符',
  }));
  async save(): Promise<void> {
    await api.save({ name: this.name.value, age: this.age.value });
  }
}

// 2) 视图：Compose 风格 DSL（推荐默认写法，详见 §5.1）
import {
  ui, Column, Row, Scroll, List, Text, TextField, Button,
} from '@phaser-mvvm/widgets/compose';

const page = ui(this, () => {
  Column({ gap: 12, padding: 16, width: 480, alignItems: 'stretch' }, () => {
    Text('用户信息', { size: 'lg' });

    // 数据槽位：传 ref 就是双向绑定，传 getter 是单向
    TextField({ label: '姓名', value: vm.name, placeholder: '请输入姓名' });
    TextField({ label: '年龄', value: vm.age, inputType: 'number', width: 120 });

    Scroll({ height: 240, direction: 'vertical' }, () => {
      List(
        { items: () => vm.users, key: (u) => u.id, virtualize: true, itemExtent: 34 },
        (user) => Text(() => user.name),   // 逐行模板；getter 随数据变化重绘
      );
    });

    Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
      Button('重置', { variant: 'ghost', onClick: () => (vm.name.value = '') });
      Button('保存', { variant: 'primary', onClick: () => void vm.save() });
    });
  });
});
this.mvvm.mount(page);          // `ui()` 只建树，挂载是显式的一步

// 3) `render()` 把「建树 + 挂载」合成一步（UIScene 里用 `content()`，见指南 07）
import { render } from '@phaser-mvvm/widgets/compose';
render(this.mvvm, () => {
  Column({ padding: 16 }, () => Text('你好'));
});

// 4) 工厂 API 继续可用、也不被弃用（直连 Phaser 的 GameObjectFactory）
this.add.uiTextField({ value: '李四', label: '姓名', width: 200 });
this.add.vbox({ gap: 8 }, [this.add.uiLabel({ text: 'a' }), this.add.uiButton({ text: 'b' })]);
```

三条与草案的关键差异，写代码时容易踩：

- **没有 `command()`**。命令式行为用 `bindCommand(widget, execute, options)`（`@phaser-mvvm/phaser`，`options.canExecute` 控制可用性），或者直接给 `Button` 的 `onClick` 传闭包 —— 后者是示例页的常规写法。
- **没有 `bind()` 包一层**。反应式参数收的是**常量 / `Ref` / getter** 本身：`Text(() => `你好，${vm.name.value}`)`、`TextField({ value: vm.name })`。需要独立于控件树的生命周期时用 `bind*` 系列（`bindText`/`bindVisible`/`bindEnabled`/`bindError`/`bindModel`）。
- **没有 `mount(vm, View, options)` 三件套**。挂载只收控件：`this.mvvm.mount(page)`；`root` 的对齐/内边距属于 `UIRoot`/页面自身的布局参数（`ui()` 的根容器选项）。

### 5.1 Compose 风格 DSL（已实现，推荐默认写法）

**Compose 风格 DSL 就是上面第 2 条、也是全框架推荐的默认写法**：视图写成嵌套调用，容器的最后一个参数是内容 lambda，父子关系由作用域隐式建立 —— 没有 children 数组，也不需要 `this.add` 前缀。它取代的是 M0 草案里 `vbox({...}, [children])` 那种 builder 形态（那个形态与工厂 API 仍然可用，只是不再是推荐默认）。

```ts
import { ui, Column, Row, Text, Button, TextField, List, Scroll } from '@phaser-mvvm/widgets/compose';

const page = ui(this, () => {
  Column({ gap: 12, padding: 16, width: 520 }, () => {
    Text(() => `你好，${vm.name.value}`);          // getter → 单向、随数据重绘
    TextField({ value: vm.name, label: '姓名' });  // ref → 双向
    Scroll({ height: 240, direction: 'vertical' }, () => {
      List({ items: () => vm.users, key: (u) => u.id, virtualize: true, itemExtent: 34 },
        (user) => Text(() => user.name));
    });
    Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
      Button('重置', { variant: 'ghost', onClick: () => (vm.name.value = '') });
      Button('保存', { variant: 'primary', onClick: () => void vm.save() });
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
- **结构性切换**：`visible` 保留节点只藏起来；换成**另一棵树**时用 `Branch(select, { key: () => {…} })`（第 69 轮）：按 key 建一个分支，切 key 时销毁旧分支（控件/绑定/订阅/文字纹理）再建新分支，入口规则与页面一致（0 根报错、多根警告后包一层容器），未知 key 清空并警告而不是崩（`branch-plan.ts` 的 `hasOwnProperty` 查询有 Node 单测）。它把 `UIScene.setContent()` 那一套下移到页面内部，见 [`docs/ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md) §3.1。
- **验收**：`#/compose` 场景用 DSL 搭建全部控件与容器，并含 **parity 演示**（同一卡片用工厂 API 与 DSL 各搭一次，逐节点比对 `appliedRect`），实测 `parity=ok`（见 [`docs/ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md)）。
- **里程碑**：不新增里程碑编号，属于 M4/M6 之后的使用层演进（M8/M9 早已交付，见下一节的执行状态）。

---

### 5.2 草案名 → 实际名（写代码别照抄本节的历史草案）

| 草案（M0 之前）                        | 实际交付                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `vbox({…}, [children])` 作为默认写法   | **Compose DSL**：`Column({…}, () => { … })`；`this.add.vbox({…}, [...])` 仍可用但不再是推荐默认（§5.1） |
| `model(vm, 'name')`                    | 直接传 `Ref`：`TextField({ value: vm.name })`（双向）或 `bindModel(field, vm, 'name')`                 |
| `bind(() => vm.errors.value.name)`     | 直接传 getter：`error: () => vm.errors.value.name`（数据槽位），或 `bindError(field, () => …)`          |
| `command(fn, { canExecute })`          | `bindCommand(widget, fn, { canExecute })`（无独立 `command()`）                                        |
| `this.mvvm.mount(vm, UserForm, opts)`  | `this.mvvm.mount(page)`；`render(this.mvvm, () => …)` 一步建树并挂载                                    |
| `Surface`                              | **没有别名**，用 `Panel`（第 95 轮删掉了没人用过的 `Surface`）                                          |
| `PageStack` / `ModalStack`             | `PageHost`（`mvvm.pages`）/ `ModalHost`（`mvvm.modal`）                                                |
| `Page` 类 + `onEnter`/`onLeave`        | `PageOptions` + `onResume`/`onPause`/`onDispose`/`onBack`；`UIScene` 的 `content()` 建页                |
| `NavSource`                            | **已实现**（第 110 轮）：`NavSource`/`NavSourceRegistry` + `mvvm.registerNavSource()`                   |
| `@phaser-mvvm/template`（JSON/模板层） | **Phase 2，未创建**                                                                                    |

## 6. 里程碑计划

单人全职估算；标 ★ 的里程碑可与前一项局部并行。

**执行状态（2026-09）**：**M0 / M1 / M2 / M3 / M4 / M5 / M6 / M7 已完成并通过验收**，验收记录见 [`ACCEPTANCE-M0-M2.md`](./ACCEPTANCE-M0-M2.md)（含实测命令输出、端到端几何+像素校验、集成期发现并修复的 5 个真实缺陷、已知边界）。M3（适配层：文本测量器、主题、状态机、输入/焦点/导航、绑定切片）与 M4（基础控件库 `@phaser-mvvm/widgets`：Label/Panel/Button/Image/Spacer/Divider）已完成，并在 `#/gallery`、`#/dashboard`、`#/bindings` 三个 demo 上用 Playwright 实测交互通过。M5（`TextField`/`TextArea` + 隐藏 DOM 输入桥，中文 IME 已实测）已完成，其后按需增补了 **`Slider`**（拖动取值，鼠标+触摸均验收，见 [`ACCEPTANCE-slider.md`](./ACCEPTANCE-slider.md)）；M6（绑定上下文 + 路径编译 + 转换器 + `Repeat` 键控复用与虚拟化）已完成；M7（`ScrollView` + WebGL 滤镜裁剪 + 手势/惯性/滚动条，并与 `Repeat` 虚拟化协同）已完成；**M8 已交付两切片**：① `ModalStack`（`this.mvvm.modal.open()`：图层置顶 + 遮罩拦截 + 焦点陷阱 + `Esc`/遮罩关闭 + 叠层 + 泄漏门禁，见 [`ACCEPTANCE-modal.md`](./ACCEPTANCE-modal.md) 与指南 07 §6）；② **页面栈**（`this.mvvm.pages.push/pop/popToRoot` + `Page` 生命周期钩子 `onResume`/`onPause`/`onDispose`/`onBack` + `back` 逐层路由 `planBack()`，见 [`ACCEPTANCE-pages.md`](./ACCEPTANCE-pages.md) 与指南 07 §7）。两轮顺带修掉了它们暴露的 5 个缺陷（V17 键盘被输入框吞掉、V18 一次按键被重复派发、V20 覆盖 `focus.onBack` 拆掉路由、V21 页面 pop 后焦点丢失、V22 输入框里的 `Esc` 到不了应用，见 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.4/§3.5）。**`UIScene` 基类已完成**（第 68 轮）：`content()` 建树并自动挂载、`setContent()` 整页替换（销毁旧树 + 重建，不泄漏）、`onBack()` 在 `back` 路由中位于「模态 → 页面」之后、「应用」之前，另有 `page`/`contentInfo` 读数与缺插件时的指名错误；`#/a11y` 一并改写成 `UIScene` 作为回归，见 [`ACCEPTANCE-uiscene.md`](./ACCEPTANCE-uiscene.md)。**轻量 `Router` 已交付**（第 75 轮）：`route-plan.ts`（纯匹配：字面量优先于 `:参数` 模式、声明顺序、`hasOwnProperty` 守卫、`UnknownRouteError` 带全表）+ `router.ts`（`routes`/`route()`/`navigate`/`replace`/`back`/`current`/`history`；**不引入 URL 路由**，`navigate` 就是 `pages.push`，簿记按页面 id 记、页面被别人弹掉就自动忘掉），见 [`ACCEPTANCE-router.md`](./ACCEPTANCE-router.md) 与指南 07 §7.2。**开闭动效已交付**（第 74 轮）：`packages/phaser/src/transition.ts` 的 `TransitionRunner`（逐帧步进、成组回调、目标抢占、不产生 Phaser tween）+ `MVVMPluginConfig.transition`（游戏级默认与运行期策略）与 `ModalOptions.transition`（逐对话框覆盖）；默认进场 160 ms `outCubic`（淡入 + 主体轻微放大）、出场 120 ms `inCubic`，**关闭的语义当帧生效、只有画面延后**（`this.mvvm.transitions.pending` 是"还有多少目标在动"，`#/modal` 的 `churn` 每轮 `await settle()`），默认遵循 `prefers-reduced-motion`。同轮修掉 V40（关闭时进场与出场两批 run 互相覆盖、对话框淡回来），见 [`ACCEPTANCE-transition.md`](./ACCEPTANCE-transition.md) 与 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.18。**页面转场已交付**（第 78 轮）：`page-motion.ts`（纯规划：推进 = 新页淡入、返回 = 离开页淡出）+ `pages.ts` 的交叉淡入淡出，邻居页在转场期间靠 `Widget#routingEnabled = false`（画着但不再是指针目标）挡住点击；`PageOptions.transition` 逐页覆盖，策略沿用 `MVVMPluginConfig.transition`。同轮修掉 V46（被自己 pop 掉的推进动画会隐藏刚露出来的页面，导致焦点作用域空掉），见 [`ACCEPTANCE-pages.md`](./ACCEPTANCE-pages.md) §5。**至此 M8 的全部条目（`ModalStack` / 页面栈 / `UIScene` / 轻量 `Router` / 开闭动效 / 页面转场）均已交付。****插件选项（跨里程碑的小修）**：第 66 轮起 `MVVMPlugin.configure()`（游戏级）与 `mvvm.configure()`（运行期）可用，指南里"插件配置传不进 Game Config"的限制随之取消，见 [`ACCEPTANCE-config.md`](./ACCEPTANCE-config.md)。**布局槽位（第 105 轮）**：`LayoutParams` 与容器选项接进 DSL 的槽位机制——`Column({ gap: () => … })`、`Text('x', { width: ref })`、`Grid({ columns: () => … })` 都成立，翻值由 `setLayoutParams()`/`setContainerOptions()` 落地，**只重跑布局、不重建子树**（焦点、滚动偏移、输入内容因此都留着）；键表只有一份（`phaser/src/container-options.ts` 的 `runtimeOptionTarget()`，DSL 与运行期补丁共用），建树时按当前值解析、之后才建绑定；`packages/phaser/test/container-options.test.ts` 与 `visual-check` 的 `options.slotHost` 采样守着它。**M9 无障碍镜像在第 76 轮做了一次实测升级**：验收从「框架写进 DOM 的属性」改为与**浏览器算出的可访问性树**（CDP `Accessibility.getFullAXTree`）对照，因此查出并修掉两个缺陷（V42 每个文本框被暴露两次 + `aria-valuenow` 写在 `textbox` 上、V43 DOM 焦点从不跟随框架焦点导致状态读不出来），并把断言做成 `scripts/visual-check.mjs` 的常驻门禁（`AX_EXPECTATIONS`：每条期望在树里恰好出现一次）。**真正用屏幕阅读器（VoiceOver/NVDA）人工走一遍仍未做**，见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md) §0。**M9 已交付两个切片**：① **手柄导航**（D-Pad/左摇杆/`A`/`B`、连发节流、`back` 逐层路由）用假手柄跑通并写成常驻验收，见 [`ACCEPTANCE-gamepad.md`](./ACCEPTANCE-gamepad.md)（同轮修掉"手柄操作不了值控件"的 V28）；② **`A11yBridge`**（隐藏 DOM 镜像 + `aria-live` 播报，范围按 §1.2）已实现并验收，见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md)（同轮补上 V29 禁用控件缺席、V30 缺 `label` 可访问名两个缺口）。**焦点 × 滚动（M7/M9 交界处的体验缺陷）**：第 67 轮起**焦点永远落在看得见的地方**——焦点变化后框架沿容器链问每一个滚动口，口用 `Widget#revealDescendant` 把焦点控件滚进可见带（`revealInViewports()` 由内到外遍历、每遍重跑一次布局以收敛嵌套口，边距 `revealMargin`）；同轮修掉"容器抢走里面控件的方向"（V34）与"滚动口滚到尽头吞掉方向键、手柄用户被困"（V35）。见 [`ACCEPTANCE-scroll.md`](./ACCEPTANCE-scroll.md) 与 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.14。**M9 第三个切片（第 81 轮）：纯手柄文本输入**——`VirtualKeyboard`（33 键文字键盘 + 13 键数字键盘，`TextInputBase.insertText/deleteText` 与真实按键同一条写值路径，`⇧` 一次大写/两次锁定，每键一个 `Button` 因而 D-Pad/`Tab`/指针/焦点环/无障碍镜像全部复用），键表与大小写状态机抽成零 Phaser 的 `keyboard-plan.ts`（16 个 Node 单测），**换键集是数据槽**（`kind` 写 `ref` 即换，键盘自己重建键并保住焦点，切页同理——符号页真的没有 `⇧`），`#/keyboard` 是常驻验收页（假手柄走查 + 真实鼠标/触摸按下 + 换键盘泄漏门禁 + 37 个控制节点的 AX 树），见 [`ACCEPTANCE-keyboard.md`](./ACCEPTANCE-keyboard.md)（同轮修掉 V47 键挂错父节点、V48 换键盘这条构建路径从未被验收、V49 程序化写值不与模型同步）。**选项覆盖（第 87 轮）**：把控件键表反查示例应用，找出**没有任何 demo** 的选项并为它们建了 `#/options`（一卡一族、尽量 A/B）：`Repeat.update`、`TextArea.submitOnEnter`、`ScrollView.inertia`/`wheelSpeed`、`Grid.autoFlow`/`minRowHeight`、`Row.alignContent`；同轮修掉 V56（`offset` 槽位每帧写回同一个值，把拖拽动量与惯性清零）。见 [`ACCEPTANCE-options.md`](./ACCEPTANCE-options.md) §7。**橡皮筋回弹修复（第 86 轮）**：`bounce: true` 自诞生起从未真正生效 —— 越界位移被 `onRectChanged()` 里的硬钳制在下一帧擦掉（V55）；现在橡皮筋打开时 `clampToLimits()` 让位给 `step()` 的 `springBack()`，`#/scroll` 新增 `scroll.bounce` 口作常驻验收，见 [`ACCEPTANCE-scroll.md`](./ACCEPTANCE-scroll.md) §7。**滚动位置即状态（第 85 轮）**：`Scroll({ offset })` 与 `value` 同为一等数据槽（`ref` 双向、getter 单向），并把 `ScrollView` 的偏移写入收敛到唯一入口 `commitOffset()`（事件因此不会漏发，V53）与"显式设置位置先停惯性"（V54），见 [`ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md) §3.3。**无障碍状态同步（第 84 轮）**：`Widget#a11yListener` 让控件在**自己的状态**变化时告诉无障碍桥重读（此前只在焦点变化与逐帧聚焦同步时重读，于是「提交后校验失败」这类**没被聚焦**的控件在镜像与桥元素上一直显示旧状态），见 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.25（V52）。**状态槽位（第 84 轮）**：`disabled`/`error`/`variant` 与 `value` 同为一等数据槽（常量 / `ref` / getter），`Panel.setVariant()` 让「变体」也能由状态驱动，见 [`ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md) §3.2。**开发期体验（第 83 轮）**：**选项审计**——控件选项是扁平对象，拼错的键过去被静默忽略（实测：面板的 `padding` 写成 `pading`，只有几何从 520 变 560，什么都不报）。现在 `splitOptions()`（唯一漏斗）在开发模式下指名报出并给出建议（`unknown option "pading" on "kb.page" — it is ignored. Did you mean "padding"?`），发布模式零输出；`LAYOUT_PARAM_KEYS` 与各控件的 `*_KEYS` 是名单，`packages/phaser/test/option-keys.test.ts` 12 条单测钉住匹配规则，`scripts/visual-check.mjs` 每个场景断言零未知键警告并用 `#/compose` 的 `typo()` 做阳性对照，见 [`ACCEPTANCE-options.md`](./ACCEPTANCE-options.md)。**无障碍镜像长成一棵树（第 103 轮）**：第 102 轮末尾登记的增强——镜像从"同一隐藏 div 下的兄弟节点清单"改成**与控件树同构的 DOM 树**（`nest()`：节点挂到最近的、有镜像节点的祖先之下，按控件树顺序重排，且只在结构变化时重排）。于是三层容器角色都到位了：模态的 content 根是 `dialog:删除这一项？`（`aria-modal=true`，名字取 content 根的 `label`，不需要新的模态选项）、`#/a11y` 的 `region: 按钮区域` 真的装着那 6 个按钮、带 `label` 的容器是具名 `group`（`#/a11y` 新增 `group:字段区域`）。文本框自带 `<input>`（在 overlay 里，无法成为 DOM 子节点）改由 `aria-owns` 挂进去：`#/keyboard` 的对话框从 34/35 变成 **35/35**。过程中翻出并修掉 **V74**：`label` 在 `Column`/`Row`/`Grid`/`Stack`/`Absolute` 上是"审计接受、`tsc` 拒绝、构造时静默丢掉"（`splitOptions` 把它当布局参数），于是容器无法成为可命名的分组。`visual-check` 新增 `AX_STRUCTURE_EXPECTATIONS`（断言包含关系而不是数量），两条正对照各验一半：回到平铺 → 3 条全红、只关 `aria-owns` → 1 条红。见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md) §11。**无障碍层级（第 102 轮）**：把"被盖住的内容必须离开无障碍树"从模态推广到**页面栈**——修掉 V73（推入详情页后被盖住的列表页仍完整留在树里：实测 17 → 20 → 22 个控制节点，读屏用户会先穿过被盖住的整页）；判据与模态不同：模态是"层以外一律隐藏"，页面只隐藏栈里 `active === false` 的页（与页面并排的 HUD/底栏必须留下）。`visual-check` 的 AX 门禁因此多了 `pages` 一条（setup 推入详情页），正对照让 `modal` 与 `pages` 同时变红。见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md) §10。**对话框里的键盘 + 无障碍作用域（第 101 轮）**：手柄用户最需要虚拟键盘的场合是模态输入，`#/keyboard` 因此新增「对话框里输入」（模态里的第二套字段 + 键盘；真手柄 `→`/`↓`/`A`、真鼠标、真触摸、屏幕键盘 `Enter` 提交、`Esc` 关闭后焦点回到触发按钮、`dialogChurn(5)` 计数回基线，见 [`ACCEPTANCE-keyboard.md`](./ACCEPTANCE-keyboard.md) §9）。同一轮量出并修掉 **V72**：模态挡住了指针也接管了焦点，但**无障碍树没被挡住** —— 对话框打开时被盖住的整页仍在树里（实测 38 + 35 = 73 个控制节点，读屏用户能走到下面的文本框）；现在桥会把顶层模态之外的控件一律 `aria-hidden`（镜像节点与它自带的 DOM 元素都标，聚焦中的控件例外），并把 `modal` 加进 `visual-check` 的 AX 期望表作为常驻门禁（§8.62）。**开关的程序化写值 + 图集帧槽位（第 100 轮）**：`Button.setValue()` 现在与用户激活走同一条上报路径（值真的变了就 emit `change`，用户专属回调仍是 `onClick`，并删掉激活路径里那次显式 emit，否则一次点击发两次）——修掉 V70：`value: ref` 的开关被程序化写入后 `ref` 永远落后（实测 `#/a11y` 的 `notify`、`#/states` 的 `toggled`）；同时补齐第 98 轮留下的 `Image.frame` 槽位验收（`makeAtlasTexture()` + `#/compose` 里同一图集、不同帧的 A/B，两个采样点进像素门禁），并修掉 V71：`currentFrame` 以前报告**请求**的帧名而不是画出来那一帧（缺帧时 Phaser 会回退到第一帧）。见 [`ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md) §3.2.3、[`ACCEPTANCE-states.md`](./ACCEPTANCE-states.md) §8 与 [`PITFALLS.md`](./PITFALLS.md) §8.60/§8.61。**滑块量程作为数据槽（第 99 轮）**：`Slider({ min, max })` 接受 `ref`/getter（两个槽共用一次 `setRange`），并在这个过程中修掉三个缺陷：V67（改量程不重画——`setRange` 走了 `setValue` 的提前返回，且重画缓存键里没有 `min`/`max`，而填充位置是 `(value - min) / (max - min)`）、V68（量程变化不通知无障碍层，`aria-valuemax` 停在旧上界）、V69（控件自己钳制的值到不了模型：静默写值 + 向下绑定只在源变化时跑 → 控件与 `ref` 永久不一致）。现在「值真的变了就报」统一在 `change` 上，用户专属回调仍是 `onChange` 选项（与文本框同一分工）；`#/compose` 的同值不同量程 A/B 与 `visual-check` 的两个采样点是常驻门禁，见 [`ACCEPTANCE-slider.md`](./ACCEPTANCE-slider.md) §9。**状态槽位第二批（第 98 轮）**：`Text({ maxLines, ellipsis })`、`Image({ texture, frame })`、`TextField`/`TextArea({ readOnly })` 与 `value`/`disabled`/`error`/`variant` 一样成为数据槽（字面量 / `ref` / getter），控件侧补 `Label#setMaxLines/#setEllipsis/#getDisplayText`、`Image#currentTexture/#currentFrame`、`TextInputBase#setReadOnly`；同轮修掉 V64（`ellipsis: true` 在换行正文里从不补 `…`）与 V65（`wrap: false` 的标签拿不到裁剪宽度，长单行直接溢出）、以及 V66（`#/showcase` 的截断卡因 `alignItems: 'stretch'` 从来没裁过任何东西），见 [`ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md) §3.2.1、[`ACCEPTANCE-showcase.md`](./ACCEPTANCE-showcase.md) §8 与 [`PITFALLS.md`](./PITFALLS.md) §8.58。**拖动到边缘自动滚动（第 97 轮）**：纯 Canvas 文本路径的最后一个缺口（V62）——按住不动、指针停在框外时内容不再变化，而浏览器原生输入框是「离框越远滚得越快」。现在 `TextInputBase` 在 `pointerdown` 记下那次拖动的指针，`POST_UPDATE` 每帧按 `dragAutoScrollStep(overflow, frameDelta)`（约 150–900 px/s，单帧积分 ≤50 ms）滚动**字段自己的内容**，光标取**钳进框内**的指针位置（指针说哪条边、滚动说哪个字符），`updateScroll()` 在这期间让位，以免「把光标滚进视野」一步弹到末尾；纯函数 `edgeOverflow`/`dragAutoScrollStep` 与公开读数 `scrollLeft`/`scrollTop` 落地，鼠标/触摸两条路径加 `readOnly`/DOM 桥两个对照见 [`ACCEPTANCE-form.md`](./ACCEPTANCE-form.md) §5.7。**第 110 轮收尾（M9 的最后一项 + 1.0 冻结）**：`NavSource` 具名抽象已交付——`nav.ts` 的 `NavSource`（`name`/`source`/`attach`/`detach`/`heldDirections`/`poll`）与 `NavSourceRegistry`（每个来源一只 `NavRepeat`，动作带自己的 `ActivationSource`），内置 `KeyboardNavSource`/`GamepadNavSource` 在 `nav-sources.ts`，插件侧 `registerNavSource()`/`unregisterNavSource()`/`navSources` 随时可加可撤且跨场景重启有效；`#/gallery` 注册了一台框架从未听说过的设备作常驻验收（[`ACCEPTANCE-gallery.md`](./ACCEPTANCE-gallery.md) §6）。同一轮关掉指南 §5.3 的两条框架缺口（焦点/失焦**事件** `widget:focus`/`widget:blur`、Game Config 条目 `data` 通道；顺带修掉 V78：Phaser 传给场景插件的第三个参数是条目的 `mapping` 而不是 `key`，[`PITFALLS.md`](./PITFALLS.md) §8.71）与 DEFECT-BACKLOG §4 的三条覆盖缺口（Node 假渲染器夹具、聚焦字段后重启的闪烁定时器、多场景 `add→launch→stop→remove`，[`ACCEPTANCE-lifecycle.md`](./ACCEPTANCE-lifecycle.md) §6）。**公开 API 就此冻结**：四个包版本 `1.0.0`，`docs/API-SURFACE.json` 记录 5 个入口点的 817 个导出名，`pnpm api:check` 进 CI（[ADR-0011](./adr/0011-public-api-freeze.md)）。仍未做：真实屏幕阅读器验证、真实手柄硬件验证、M10 的 TypeDoc 与控件规格文档。

| 里程碑 | 内容 | 交付物 | 验收标准 | 估算 |
|--------|------|--------|----------|------|
| **M0 骨架与基线** | pnpm workspace、TS strict、vite 示例、vitest、Prettier、CI 工作流（ESLint/size-limit/覆盖率门禁至今未接入，见 §3.2）；Phaser 依赖策略落地（`peerDependencies: phaser ^4.2` + devDependency `phaser@4.2.1`，本地源码仅作参考）；ADR 记录关键决策（§10） | 可运行的空框架 + 一个用 `this.add.hbox()` 渲染出两个矩形的示例（`apps/examples` 的 `#/m0` 与 `#/probe`） | `pnpm install`、`pnpm -r typecheck`、`pnpm -r test`、`pnpm run build:examples` 全绿；`pnpm run visual-check` 截图成功且 `#status` 无错误行；`phaser.d.ts` 类型可解析 | 1–2 天 |
| **M1 响应式内核** ★ | `ref/reactive/computed/watch/effect/scope`、调度器（`sync/pre/post/frame`）、集合响应式（`reactive(new Map())`/`reactive(new Set())`，**没有** `ObservableArray/Map/Set` 类）、`makeObservable` | `@phaser-mvvm/core` + 单测 | 依赖收集/清理、条件分支切换、嵌套 effect、批量 flush 语义、无泄漏（GC 断言）等 ≥40 用例通过（当前 281 条） | 3–4 天 |
| **M2 布局引擎** ★ | 约束模型（`BoxConstraints`）、`LayoutParams`、box（纵/横/换行）、grid、stack、absolute、**scroll 端口**、测量缓存、脏传播 + relayout boundary、像素对齐 | `@phaser-mvvm/layout` + 布局快照测试 + 基准 | 40+ 布局用例（百分比/填充/伸缩/对齐/跨行列/auto 列数/边界）与黄金快照一致（当前 314 条 + 4 个快照）；1000 节点全量排布 < 1.5 ms；仅改一个子节点时排布工作量与其子树同阶 | 5–6 天 |
| **M3 Phaser 适配层** | `Widget` 基类、`UIRoot`、`PhaserTextMeasurer`(+LRU)、`InputRouter`、`FocusManager`、`MVVMPlugin`、工厂注册、主题基础 | `@phaser-mvvm/phaser` + 示例页 | 窗口缩放/DPR 变化布局正确；`this.mvvm.mount()` 可用；场景 shutdown 后控件/监听/绑定计数归零（泄漏测试） | 4–5 天 |
| **M4 基础控件** | `Panel`、`Label`、`Button`、`Image`、`Spacer`、`Divider`（其后补入 `Slider`） | `@phaser-mvvm/widgets`（第一批）+ 画廊页 | 每个控件有交互示例页与截图回归；按钮状态机、键盘激活、禁用通过（**长按/连击没有实现，也不打算做**） | 5–6 天 |
| **M5 文本框** | `TextField`、`TextArea`、DOM 输入桥、光标/选区/快捷键/剪贴板/掩码/校验/IME | widgets 第二批 + 表单页 | 中文输入法可用（含候选期不写回 VM）、软键盘可唤起（移动端手测）、剪贴板/快捷键矩阵测试通过 | 5–7 天 |
| **M6 绑定与列表** | `BindingContext`、路径编译、单向/双向/命令/转换器、`repeat` 键控复用与虚拟化 | `core/binding` 编译产物 + `Repeat` 控件 | 1000 行列表增删改移后仅挂载可见项；绑定无回环、无泄漏；CSP 环境下无 `eval` | 4–6 天 |
| **M7 滚动与裁剪** | `ScrollView`（拖拽/滚轮/惯性/滚动条/键盘）、WebGL 遮罩裁剪、与虚拟化协同 | `ScrollView` + 长列表页 | 滚动裁剪无溢出；滚动 + 虚拟化在 5000 项下稳定 60 fps（**第 77 轮实测**：脚本驱动 1 行/帧与 4 行/帧、真实滚轮、真实触摸拖动四种驱动方式 median 均 16.7 ms ≈ 59.9 fps，17 行常驻、每帧一趟布局，见 [`ACCEPTANCE-list.md`](./ACCEPTANCE-list.md) §6）；相机视口降级方案可用 | 4–6 天 |
| **M8 场景与页面体系**（**全部条目已完成**，含页面转场） | `UIScene` 基类、`PageHost` 页面栈与生命周期、`ModalHost`（焦点陷阱 / ESC / 遮罩策略 / 开闭动效）、轻量 `Router` | `packages/phaser/src/{UIScene,require-plugin,modal,pages,back-plan,page-motion,ui-build}.ts` + 多页示例 | ✅ 弹窗打开时焦点不逃逸、下层不可点、反复开关 100 次无泄漏（[`ACCEPTANCE-modal.md`](./ACCEPTANCE-modal.md)）；✅ 多页导航（列表→详情→对话框）可返回且状态正确、`churn(50)` 无泄漏（[`ACCEPTANCE-pages.md`](./ACCEPTANCE-pages.md)）；✅ `UIScene`：`content()` 自动挂载、`setContent()` 替换 20 次不泄漏、`onBack()` 先于应用层（[`ACCEPTANCE-uiscene.md`](./ACCEPTANCE-uiscene.md)）；✅ 轻量 `Router`（路由表 + `:参数` + `current`/`history`，[`ACCEPTANCE-router.md`](./ACCEPTANCE-router.md)）；✅ 开闭动效（`TransitionRunner` + `transition` 策略 + 逐对话框/逐页覆盖 + 减少动效，[`ACCEPTANCE-transition.md`](./ACCEPTANCE-transition.md)） | 4–6 天 |
| **M9 导航与无障碍**（**手柄 + 无障碍镜像 + 手柄文本输入 + `NavSource` 具名抽象已交付**；真机阅读器、真手柄未做） | 键盘/手柄导航（`nav.ts` 的按键映射 + 连发，由 `FocusManager` 消费）、`A11yBridge` DOM 镜像 + `aria-live` 播报、`VirtualKeyboard` 屏幕键盘 | `packages/phaser/src/{input,a11y,nav}.ts`、`packages/widgets/src/{VirtualKeyboard,keyboard-plan}.ts` + `#/a11y`/`#/gallery`/`#/keyboard` 示例 | ✅ 手柄能导航/激活/返回，且能操作滑杆与滚动容器（[`ACCEPTANCE-gamepad.md`](./ACCEPTANCE-gamepad.md)）；✅ 每个可交互控件有隐藏 DOM 镜像（role/label/state，镜像与控件树同构）、焦点与消息经 `aria-live` 播报（[`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md)）；✅ 纯手柄完成**文本输入**（D-Pad 走查 + `A` 打字/退格/提交，鼠标与触摸同样验收，[`ACCEPTANCE-keyboard.md`](./ACCEPTANCE-keyboard.md)）；✅ **`NavSource` 具名抽象**（第 110 轮：可注册第三台设备，`#/gallery` 常驻验收，[`ACCEPTANCE-gallery.md`](./ACCEPTANCE-gallery.md) §6）；⬜ 真实屏幕阅读器听过一遍；⬜ 真实手柄硬件 | 3–5 天 |
| **M10 主题、文档、1.0**（主题切换/皮肤/指南/**公开 API 冻结与 1.0 版本号**已交付；TypeDoc 与控件规格文档未创建） | 主题切换、皮肤、typedoc API 文档、控件规格文档、迁移/使用指南、1.0 发布与 changesets | 全量文档 + `form-demo` 完整示例 | 新同学按文档 1 小时内搭出带校验表单；包体积达标（见 §8）；**公开名字集合冻结且由 `pnpm api:check` 守住（[ADR-0011](./adr/0011-public-api-freeze.md)）** | 4–6 天 |

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

- 布局：1000 节点全量 `measure+arrange` < 1.5 ms（M 系列 Mac，Node 基准）——由 `packages/layout/test/perf.test.ts` 断言（取预热后多次运行的最小值，避免 CI 抖动误报），实测 **0.108 ms**（第 107 轮复测，本机 Apple A18 Pro / Node 24.18.1；第 5 轮首发时是 0.059 ms，读数随机型与负载漂移，见 [`ACCEPTANCE-performance.md`](./ACCEPTANCE-performance.md) §7）；无变化帧布局耗时 = 0——同一文件用**结构性**断言（一次无变化 pass 的 `measureCalls` 增量 = 0、`arrangeCalls` 增量 = 1、`skippedSubtrees` > 100；实测 0.044 ms，另有 1 ms 的粗略时间上界），因为在这个量级上计时无法区分「零工作」与「重测 922 个节点」；单节点内容变更仅重算 relayout boundary 子树——同一文件用逐节点 `measureCount` 证明「编辑 1 个节点只重测 1 个节点（共 922）」。
- 度量缓存：布局引擎的约束缓存命中率 > 95%（表单类界面）——`perf.test.ts` 实测键盘编辑 100 次为 **95.59%**（第 5 与第 107 两轮逐字相同），断言下限取 90% 以免随页面规模抖动，另用「编辑一次只重测一个节点」承担回归权重。
- 文本度量缓存：**已实现**（`packages/widgets/src/text-metrics.ts`，按场景的 `WeakMap` + LRU，缓存 `Label` 的换行结果与省略号搜索用的候选串宽度、`TextInputBase` 的逐串宽度）。测量口径与实测：**每一次不同的 (文本, 样式, 换行宽度) 恰好只度量一次（一次 miss），此后全部命中**——`#/states` 上连续 4 轮悬停扫描每轮 36 次命中、**0 次未命中**（稳态命中率 100%）；首屏 124 个不同字符串各付一次 miss，因此整段会话的累计命中率为 72%–89%（随会话变长收敛到 100%），"排布重算时不再重复度量同一文本"这条要求已满足。与关掉缓存的前后逐像素比对为 **0 像素差异**。
- 分配：排布热路径零新增对象/闭包——`perf.test.ts` 断言对象池（按深度索引的 `EngineContext`）在 200 次 pass 后长度不变、且这些 pass 不产生任何测量。
- 输入：连续输入（含 IME）不引发整树布局——浏览器实测：在 786 个控件的页面上输入 43 个字符，`passes` 增量为 **0**（输入框尺寸不随文本变化，连一次布局都不需要）；在 119 个控件的页面上输入 43 个字符为 4 次 pass、约 5 次测量/字符（只重测输入框自身子树）。
- 体积（gzip，不含 Phaser）：`core` + `layout` < 25 KB；`phaser` + `widgets` < 45 KB——由 `pnpm size`（`scripts/size-check.mjs`）在 **minify 后**的 gzip 上判定（库产物故意不 minify，便于堆栈可读；消费方打包时一定会 minify），实测 **18.6 KB** / **31.3 KB**（第 107 轮复测），脚本同时打印未压缩 gzip 值（28.1 KB / 61.5 KB）以便对照。第 5 轮首发时是 18.3 / 14.7 KB：`phaser` + `widgets` 的上涨来自第 5 轮之后 phaser 包长大（页面栈/路由/模态/动效/无障碍镜像/虚拟键盘…陆续进来），不是某一个模块的增量——第 107 轮的指针事件链单独量只有 1.6 KB min+gzip。
- 滚动视口的渲染裁剪（第 109 轮）：`ScrollView` 每帧把它**画不出来**的内容从这一帧里摘掉（`Widget.culled` + `Widget#willRender`），判据是内容的**子树外接矩形**与可见带（`[offset, offset + viewport] / zoomScale`，外扩 48 px）是否相交；它只影响渲染，布局/焦点/指针路由/无障碍镜像/内容长度仍按 `visible` 走。这不是可选项而是约定：Phaser 4 的 `Graphics` 每帧重放命令缓冲并重新三角化，一个 8298 px 高、只看得见 6 % 的页面在裁剪前每帧要 578 个 draw call（11 fps），裁剪后 56–82 个（52–60 fps），遍历本身 0.125 ms/帧。实测与判据见 [`ACCEPTANCE-performance.md`](./docs/ACCEPTANCE-performance.md) §8，两条坑（不能用 `visible`；节点的 `appliedRect` 不是子树的边界）见 [`PITFALLS.md`](./docs/PITFALLS.md) §8.70。

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
