# M0–M7 验收记录

> 对应 `docs/PLAN.md` 的 M0（骨架与基线）、M1（响应式内核）、M2（布局引擎）。
> 验收环境：macOS / Node `v24.18.1` / pnpm `10.34.5` / 无头 Chrome `153.0.8010.36`（CDP 驱动，视口固定 1280×720）。

## 1. 验收命令与实际结果

| #   | 命令                            | 结果                                                                                                                                                          |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm install`                  | 完成（workspace 6 个项目）                                                                                                                                    |
| 2   | `pnpm -r run typecheck`         | `packages/{core,layout,phaser,widgets}` + `apps/examples` 全部 Done，0 错误                                                                                   |
| 3   | `pnpm -r run test`              | `packages/core` 175 passed；`packages/layout` 251 passed（其余包暂无测试，脚本带 `--passWithNoTests`）                                                        |
| 4   | `pnpm -r run build`             | core：`dist/index.js` 38.48 KB + `index.cjs` 41.43 KB + d.ts；layout：`index.js` 48.74 KB + `index.cjs` 52.02 KB + d.ts；phaser/widgets 同样产出 ESM/CJS/d.ts |
| 5   | `pnpm exec prettier --check .`  | `All matched files use Prettier code style!`                                                                                                                  |
| 6   | `pnpm run build:examples`       | 构建成功（`apps/examples/dist`）                                                                                                                              |
| 7   | `node scripts/visual-check.mjs` | **ok**：三个场景共 22 个像素采样点全部一致，页面 `#status` 无 `ERROR:`/`REJECTION:`                                                                           |

### 1.1 端到端几何 + 像素校验（`scripts/visual-check.mjs`）

脚本用 **单个** 无头 Chrome（DevTools 协议，`Emulation.setDeviceMetricsOverride` 固定视口）逐场景执行：
读取 `#status`（场景把引擎实际分配的 rect 写进 DOM）→ `Page.captureScreenshot` 截图 → 按 canvas 偏移换算后采样像素并与期望填充色比对。
这样做是因为「两次 Chrome 运行分别 dump-dom 与 screenshot」会得到不同视口（实测差 87px），采样必然错位。

实测输出（节选）：

```
[visual-check] status for m0:
scene=m0 renderer=webgl size=1280x720 dpr=1
page=@443,240 394x240        row=@444,312 392x168
rect.blue=@468,336 200x120   rect.amber=@692,336 120x120
canvas=@0,0 1280x720
OK       canvas.clear: #0d1117 at (4,4)
OK       rect.blue: #2f6feb at (568,396)
OK       rect.amber: #f2a33c at (752,396)

[visual-check] status for probe:
card=@480,228 320x200        abs.topleft=@496,244 60x60
abs.bottomright=@724,352 60x60   hud.center=@604,462 72x24
bar=@480,520 320x8
OK       backdrop / abs.topleft / abs.bottomright / hud.left / hud.center / hud.right / bar

[visual-check] status for stack:
layers=@430,240 420x240      card=@480,280 320x160
badge=@826,228 36x36         footer=@450,452 120x8
OK       backdrop / card / badge / footer
[visual-check] ok
```

覆盖到的布局语义：嵌套 box 居中、`gap`/`padding`、百分比宽度（`bar` 为 `100%`）、`alignItems: 'stretch'`、stack 层叠与居中、`position: 'absolute'` 的 `left/top`、`right/bottom` 与负偏移（`badge` 在容器外的 `right:-12, top:-12`）、以及 Phaser 侧 Canvas 坐标与引擎坐标的一致性。

## 2. 交付内容

### 2.1 `@phaser-mvvm/core`（M1）

- 响应式：`ref`/`shallowRef`/`customRef`/`triggerRef`/`isRef`/`unref`、`reactive`（对象/数组/Map/Set 深度代理，WeakMap 缓存同一性）、`readonly`、`toRaw`/`markRaw`、`computed`（惰性 + 缓存 + `peek`）、`effect`（`stop`/`pause`/`resume`/清理回调）、`effectScope`（嵌套、`detached`、`onScopeDispose`）、`watch`/`watchEffect`（`immediate`/`deep`/多源/`flush` 三模式）、`untrack`/`pauseTracking`。
- ViewModel 支持：`makeObservable(instance, spec?)`（默认普通对象/数组字段 `reactive`、其余 `ref`；兼容 `useDefineForClassFields`）。
- 调度器：`pre`/`post` 合并为一次微任务 flush，`frame` 仅在渲染层调用 `flushFrame()` 时执行（**UI 默认帧对齐**：一帧内多次改数据只布局一次）；`configureScheduler` 允许宿主接管 `pre`/`post`。
- 防护：`RECURSION_LIMIT = 100`，循环更新抛错且调度器保持可用；`setDevMode`/`onDevWarning`。

### 2.2 `@phaser-mvvm/layout`（M2）

- 契约：`BoxConstraints`、`LayoutParams`（`width/height` 支持数值、`'50%'`、`'auto'`、`'fill'` 与 `{value,min,max}`；`grow`/`shrink`/`basis`/`margin`/`padding`/`alignSelf`/`aspectRatio`/`position`/`left|top|right|bottom`/`order`/`gridColumn*`）、`LayoutNode`（`measureContent` / `applyRect` / `children` / `parent` / `revision` / `inFlow` / `isRelayoutBoundary`）。
- 引擎：两阶段 measure/arrange；测量结果按 **(约束, revision)** 缓存；`invalidate()` 沿 parent 链上溯、在 relayout boundary 处停止；未变化且 rect 相同的子树在排布阶段整体跳过；末尾按 DPR 对齐像素；`stats` 暴露 `measureCalls`/`cacheHits`/`placedChildren`/`skippedSubtrees` 等计数器。
- 排布器：`box`（纵/横、`gap`/`rowGap`/`columnGap`、`justifyContent` 五值、`alignItems`/`alignSelf`、`wrap` + `alignContent`、`reverse`、`order`、`grow`/`shrink`/主轴 `fill`）、`grid`（固定/自动列数、行列间距、`justifyItems`/`alignItems`、显式定位与跨行跨列、`autoFlow`）、`stack`、`absolute`。
- 测试：`box.test.ts` 91 / `grid.test.ts` 49 / `engine.test.ts` 38（+1 条本轮补充）/ `params.test.ts` 36 / `stack.test.ts` 32 / `golden.test.ts` 4，共 **251** 条；黄金快照以 `UPDATE_GOLDEN=1 pnpm test` 重生成。

### 2.3 `@phaser-mvvm/phaser`（M3 先行部分）

- `Widget extends Phaser.GameObjects.Container implements LayoutNode`：维护 **widget 子节点**（与 Phaser `list` 分离，`Label` 内部的 `Text` 不参与布局）、`markDirty()` 递增 `revision` 并通知引擎、`applyRect` 写回位置/尺寸、销毁时清理引擎引用与监听。
- `UIRoot`：持有 `LayoutEngine`，随 `scale` resize 调整尺寸，`flushLayout()` 以「引擎是否有脏节点」为入口（不是「根是否脏」——见 §3.1）。
- `MVVMPlugin`（`sceneKey/mapping: 'mvvm'`）：`this.mvvm.root` / `mount()` / `flush()`；每帧 `PRE_UPDATE` 先 `flushFrame()` 再布局；`shutdown`/`destroy` 时销毁 UI 根。
- 工厂注册：`this.add.vbox|hbox|uiGrid|uiStack|uiAbsolute|uiRect|uiLabel`（`grid` 已被 Phaser 自带的调试 Grid 占用，故用 `uiGrid`），并在 `augment.ts` 中做环境声明，使 `scene.mvvm` 与上述工厂方法都有类型。
- 探针控件：`RectWidget`、`LabelWidget`（正式控件库从 M4 起进入 `@phaser-mvvm/widgets`）。

### 2.4 示例与验收工具

- `apps/examples`：三个场景 + 页面底部 `#status`（输出引擎实际 rect 与 canvas 位置/DPR）；`?capture=1` 时开启 `preserveDrawingBuffer` 以便截图能读到 WebGL 帧。
- `scripts/visual-check.mjs` + `scripts/png-sample.py`：见 §1.1。

## 3. 集成过程中发现并修复的真实缺陷

这些都是在把布局引擎接进真实渲染时暴露出来的，不是单元测试能覆盖的：

1. **父级坐标被逐层累加**：`arrangeNode` 曾把「父级本地的 rect」直接当作子节点内容盒使用，于是每嵌套一层坐标就多加一次父偏移（示例中卡片整体偏移了 `(430, 283)`）。修法：子节点一律在**自身本地坐标系**排版（原点 = 自身左上角，偏移只来自自身 `padding`），只有节点自身的 rect 是父级局部坐标。**像素采样是唯一能发现该问题的检查**——DOM 里报告的几何当时「自洽但错」。
2. **紧约束强制撑满**：容器用 tight 约束测量子项，导致 `UIRoot`（1280×720）里的 auto 卡片被撑成整屏。修法：容器用 `loosen(content)` 测量子项；`contentSize`（百分比基准）保持不变；`'fill'` 与 `stretch` 仍在排布阶段生效。
3. **arrange 阶段丢失测量结果**：`ChildRecord.reset()` 在排布阶段也清零 `measured`，导致 arrange 里 `resolveOuterSize` 读到的 auto 子项是 0×0（子代理发现）。修法：仅在测量阶段清零。
4. **box/grid 容器中的绝对定位子项从未被测量**：flow 排布器按契约跳过它们，而 `arrangeAbsolute` 只读 `measured`（子代理发现）。修法：容器测量完成后，对非 `absolute` 容器中的绝对定位子项补一次宽松测量。
5. **relayout boundary 与「是否需要布局」的判断冲突**：脏标记在边界处停止，因此 `UIRoot.flushLayout()` 若以 `isDirty(root)` 为入口，边界内的变更会被静默跳过、界面保持陈旧。修法：引擎新增 `hasDirtyNodes`（宿主用它判断是否需要跑一趟），边界优化得以保留；`LayoutNode.isRelayoutBoundary` 的文档同步改为真实契约，并补测试固定该入口约定。

## 4. 已知边界与延后项

- **`fill` 在 auto 宽容器中的语义**：`width: 'fill'` 的解析基准是父容器 content box，因此「auto 宽的盒子 + fill 子项」会把盒子撑到可用宽度并可能溢出（黄金快照 `dashboard` 场景原先如此）。场景侧写法：给盒子 `width: 'fill'` 或给相邻项 `shrink`。已在 `golden.test.ts` 里以注释说明。
- **grid 中的 `fill`/百分比**按 grid 的 content box 解析（不是单元格）；非 stretch 对齐下 `fill` 子项按单元格尺寸放置。
- **`absolute` 容器类型只排布 `position: 'absolute'` 的子项**；混合内容请用 `stack`（其 flow 子项从内容盒原点层叠，绝对子项按偏移定位），示例 `#/probe` 即此写法。
- **测量阶段的「主轴紧 → 分配 grow」分支**在引擎改为下发 loosen 约束后实际不再触发（保留以对齐规格文字），自由空间全部在排布阶段分配。
- **M3 尚未完成的部分**：文本测量器（LRU）、输入/焦点/导航路由、主题令牌、`UIScene`/`Page`（M8）。**M4 起**才接入 ESLint、size-limit 与覆盖率门禁（当前由 `tsc --strict` + Prettier + 251/175 单测 + 端到端像素校验覆盖）。
- `pnpm -r run test` 依赖各包 `--passWithNoTests`（`phaser`/`widgets` 在 M4 前无测试）。

## 5. 下一步（M3）

1. `PhaserTextMeasurer`（LRU 缓存 + 换行宽度）+ `Label` 的测量与省略号行为；
2. `InputRouter`（pointer/keyboard 语义事件、UI 拦截层防穿透）、`FocusManager`（Tab/方向键/焦点环）；
3. 主题令牌（`dark`/`light` 内置）+ `Widget` 状态机（`normal/hover/pressed/disabled/focused/error`）；
4. 适配层单测补齐：以 `#/probe` 场景为基础扩展为「布局语义对照页」，把本次的像素校验扩展为多视口回归。

---

# M3 / M4 验收记录（2026-09）

## 1. 交付

| 里程碑    | 内容                                                                                                                                                                                                                                                                                      | 结果                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| M3 适配层 | 文本测量器 `PhaserTextMeasurer`（LRU 缓存）、主题令牌 `theme.ts`（dark/light）、皮肤 `skin.ts`、控件状态机 `widget-state.ts`、输入路由 `input.ts`、焦点管理 `focus.ts`、导航源 `nav.ts`、绑定切片 `binding.ts`、插件接线（`this.mvvm.input/focus/theme`、帧对齐 flush、相机背景跟随主题） | 98 个单测（主题 17 + 焦点 32 + 导航 28 + 输入 21） |
| M4 控件库 | `@phaser-mvvm/widgets`：`Label`/`Panel`/`Button`/`Image`/`Spacer`/`Divider` + 工厂 `this.add.uiLabel                                                                                                                                                                                      | uiPanel                                            | uiButton | uiImage | uiSpacer | uiDivider` | 83 个单测 |

仓库门禁：`pnpm -r typecheck` 5 个项目 0 错误；`pnpm -r test` **607 passed**（layout 251 + core 175 + phaser 98 + widgets 83）；`pnpm -r build` 与 `pnpm run build:examples` 通过；`prettier --check .` 通过；`node scripts/visual-check.mjs` 16 个像素采样点全部一致。

## 2. demo（`apps/examples`）与 Playwright 实测

新增三个可交互场景：

| 场景          | 内容                                                                                             | Playwright MCP 实测结果                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#/gallery`   | 全部 M4 控件 × 变体/尺寸/禁用/加载/toggle、标签截断、分隔线、间距、`Image` 的 contain/cover/fill | hover → `visualState=hover`；pointerdown → `pressed`；点击 toggle → `toggle=true`（再点 → `false`）；hover 在点击后保持；Tab 5 次到达 toggle，Enter/Space 各翻转一次                                           |
| `#/dashboard` | header + 4 张指标卡（grid）+ footer 操作栏、主题切换、数据刷新                                   | 点击主题 → `theme=light` 且画布清屏色 `#0d1117 → #f6f8fa`，再点回 `#0d1117`（主题全量重绘）；点击刷新两次 → `refreshClicks=2`、指标值变化                                                                      |
| `#/bindings`  | `ref`/`computed` ViewModel + `bindText`/`bindVisible`/`bindEnabled`/`bindError`/`bindCommand`    | 两次 Add → `count=2 price=39.00`（computed 生效）；Toggle details → `details=true`（bindVisible）；Replace view 后再 Add → `count=4 price=78.00`（**旧订阅已随控件销毁，无重复触发**）；命令绑定运行时禁用自身 |

验证方式：Playwright MCP 驱动无头 Chromium（真实 WebGL），通过页面 `#demo-state` 读取控件页面坐标并 `page.mouse.click()`/`keyboard.press()` 操作画布内控件，再读回状态；同时用 `canvas.drawImage → getImageData` 采样画布像素验证主题重绘。截图：`gallery.png`、`bindings.png`。

## 3. 本轮发现并修复的真实缺陷

1. **命中区未补偿 Phaser 的 Container origin**：`Container#displayOriginX = width/2`，而 `InputManager.pointWithinHitArea` 会把该值加到局部坐标上，导致命中区实际是 `[-w/2,w/2]×[-h/2,h/2]`——每个可交互控件**只有左上半区可点**，控件越大越"看起来正常"。修复：命中区建在 `(w/2, h/2, w, h)` 并与 rect 同步（`Widget.enablePointerInput`/`syncHitArea`）。两个子代理各自独立实测到同一问题。
2. **`topOnly` 下容器子节点的排序不确定**：Phaser 只把事件派发给"最上层"对象，而容器子节点不在 display list 上、与容器本身的先后无法判定，面板的命中区会吞掉子按钮的点击。修复：`InputRouter` 关闭 `topOnly`，改为**按控件树由深到浅自行解析命中目标**（最后一个子节点画在最上层），每个控件的处理器只在"我就是解析结果"时生效。
3. **点击后 hover 被清掉**：`handleUp` 里的 `resetInteraction` 会清 hover，而 Phaser 不会为"没离开过"的指针重发 `pointerover`。修复：点击后在指针仍位于该控件内时恢复 hover。
4. **结构变更后输入目标不重建**：插件原先以"布局是否脏"判断是否重建输入绑定，但 `UIRoot.addWidget()` 会立即布局并清掉脏标记，导致控件从未被收集（实测 `input.widgets = 0`，点击完全无效）。修复：`Widget` 向上通知结构变更、`UIRoot.structureVersion` 计数、插件按版本号重建（`InputRouter.refresh()` 而不是 `attach()`，以免丢掉模态的 `setCapture`）。
5. **主题只换控件不换背景**：画布清屏色固定在创建时。修复：`MVVMPlugin` 默认把 `theme.colors.background` 写入主相机并订阅主题变化（`themeBackground: false` 可关闭，供透明叠加在游戏场景之上的 UI 场景使用）。
6. `blockPointer` 之前只暴露了 flag：现在 `collectInteractive` 会收集这类面板，使其真正吞掉落在其上的指针。

## 4. 已知边界（M3/M4 范围内）

- **游戏世界穿透**：UI 之上/之下若还有原生 Phaser 交互对象，指针事件仍会到达它们（我们的解析只作用于控件树）。模态遮罩可用 `InputRouter.setCapture()`；完整的"UI 场景独占输入"留给 M8 的 `UIScene`/`ModalStack`。
- **焦点环**由控件用 `Graphics` 描边绘制（`focused` 不进入皮肤状态，避免双重描边）。
- **toggle 按钮**激活时翻转 `value` 并 `emit('change')`，不调用 `onClick`（决策抽成纯函数 `resolveButtonActivation`）。
- **中文无空格文本**不会折行（沿用 Phaser 的按空格换行算法）；省略号度量未计 `letterSpacing`。
- 未实现：NineSlice/渐变皮肤、长按/连击手势、`ScrollView`/`Repeat`/`Modal`/`TextField`（M5–M7）、a11y 镜像与手柄实测（M9；手柄代码路径已接好但缺硬件实测）。

---

# M5 验收记录（文本框 + DOM 输入桥，2026-09）

## 交付

- `packages/widgets/src/input-bridge.ts`：隐藏 `<input>`/`<textarea>` 桥（挂在 Phaser 的 `domContainer` 上，`opacity:0`、`pointer-events:none`，按控件矩形定位；无 `dom.createContainer` 时 `available=false` 并只警告一次）。
- `packages/widgets/src/{TextInputBase,TextField,TextArea,text-edit}.ts`：单行/多行输入（光标闪烁、选区、方向键/Home/End/Backspace/Delete、Ctrl/Cmd+A/C/V/X、`maxLength`、占位符、密码掩码、数字过滤、只读、`validate` 错误态、文本超出时滚动）、多行（自动换行、内部滚动、Enter 换行 / Ctrl+Enter 提交、跨行选区）。
- 工厂：`this.add.uiTextField`、`this.add.uiTextArea`（幂等注册）。

## 门禁

`pnpm -r typecheck` 5 个项目 0 错误；`pnpm -r test` **695 passed**（layout 251 / core 175 / phaser 98 / widgets 171，其中 M5 新增 88）；`prettier --check .` 通过。

## demo `#/form` + Playwright 实测（真实 WebGL + 真实 DOM 桥）

| 断言                         | 实测结果                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 加载后初始焦点               | `focus=name`，`document.activeElement.tagName === 'INPUT'`（隐藏 input 持有 DOM 焦点）                                                                              |
| 点击邮箱框                   | `focus=email`、控件 `isFocused()===true`、`visualState=hover`                                                                                                       |
| 逐字符键入 `ada@example.com` | 控件值 `ada@example.com`、`emailValid=true`、`#demo-state` 同步（`email=…`）                                                                                        |
| **中文 IME 组合输入**        | `compositionstart` + 两次 `compositionupdate`（值变为「张」「张三」）期间**控件值保持空**（不写入 ViewModel，符合 ADR-0004），`compositionend` 后一次性变为「张三」 |
| 校验                         | 邮箱非法时 `getError()` 返回消息且控件进入 `error` 状态（边框/文案由主题驱动）                                                                                      |

已知边界：DOM 桥依赖 `dom: { createContainer: true }` 与 `parent`；不要与 `DOMElement` 控件同层混用；纯 Canvas 回退模式仅覆盖桌面英文/数字输入。

---

# M6 验收记录（绑定与列表，2026-09）

## 交付

- `packages/core/src/binding/**`：`compilePath`（纯字符串解析 + 闭包，**不用 eval**）、`BindingContext`（`$root`/`$parent`/`$index`/`$item` 作用域链）、`registerConverter`/`applyConverter`（内置 `upper/lower/trim/number/money/join/default/date`）、`parseInterpolation`/`formatTemplate`、`createBinding`。
- `packages/phaser/src/binding.ts` 扩展：`bindPath`、`bindTemplate`、`bindCommand`（支持路径形式的 `canExecute`）、`bindModel`（双向：控件 `change` 写回 ViewModel，ViewModel 变化静默 `setValue` 写回，避免回环）。
- `packages/widgets/src/{Repeat.ts,repeat-plan.ts}`：`Repeat` 键控 diff（新增/删除/移动/复用）、`virtualize` + `itemExtent` + `overscan` 只挂载可见区间、`empty` 占位、`getRenderedKeys()/getWidgetForKey()/refresh()`；`diffKeys`、`planRepeatUpdate`、`computeVisibleRange` 为可单测纯函数；工厂 `uiRepeat`。

## 门禁

`pnpm -r typecheck` 5 个项目 0 错误；`pnpm -r test` **828 passed**（layout 251 / core 262 / phaser 98 / widgets 217；M6 新增 133 = core 绑定 87 + widgets Repeat 46）；`pnpm -r build` 与 `prettier --check .` 通过。

## demo `#/list` + Playwright 实测

| 断言             | 实测结果                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| 首帧虚拟化       | `total=220 rendered=14 first=p000 last=p013`（220 项只挂载 14 行）                                  |
| 点击 Add ×3      | `total=223`、`rendered` 仍为 14（数据增长不增加挂载量）                                             |
| 点击 Shuffle     | `first=p096 last=p169`、`rendered` 不变（键控复用而非全量重建）                                     |
| 过滤 `Player 01` | `total=10`；`azzz-no-match` → `total=0` 且显示 `empty` 占位（按 keystroke 即时生效，无需回车/失焦） |
| 列表内删除       | 点击首行 Delete → `total 223→222`、`deleted 0→1`，14 行中 13 个控件实例被复用                       |

## 本轮发现并修复的框架缺陷

**挂载子树时结构通知丢失**：`Widget.addWidget` 先调用 `child.setEngineRecursive(...)`，而 `structureListener` 是在该递归里**向下**赋值的，于是新挂载子树中每个节点的 `structureListener` 都是 `null`（只有 `UIRoot` 自己有）→ `UIRoot.structureVersion` 永不变化 → 插件不再 `refreshInteraction()` → **运行期新建的控件不会被 `InputRouter` 注册，点击被丢弃**。修复：在 `addWidget` 中于递归之前先 `child.structureListener = this.structureListener`。这是「列表增删行后按钮点不动」类问题的根因，只有真浏览器 + 动态数据才能暴露。

## 增量 arrange 与 relayout boundary 的交互（**已修复**，见 `401b153`）

**现象**：当一个会持续变化的子树（例如 `Repeat` 的行容器）位于**固定尺寸控件**（`Widget.isRelayoutBoundary === true`）内部时，从 root 到该 boundary 之间的祖先不会被标脏，而 `LayoutEngine.placeChildOf()` 又会跳过「rect 未变且自身不脏」的子树 —— 于是顶层 arrange 在祖先处就提前跳过，boundary 内部的脏子树永远拿不到 `applyRect`（新行为 0×0、不可见、不可点击）。实测 stats：一次 layout 只有 `arrange+1 / placed+1 / skipped+1`，即只走了根。

**为什么 `hasDirtyNodes` 不足**：它只解决「宿主是否要跑一趟 layout」，解决不了「arrange 自顶向下的走法能否到达脏节点」。

**已实施修复**：`LayoutEngine` 新增独立的 `dirtyPath` 集合（只放宽 arrange 的跳过判断，**不参与测量缓存失效**）；`invalidate()` 越过 relayout boundary 后继续把祖先收进 `dirtyPath`，`placeChildOf()` 的跳过条件加入 `!dirtyPath.has(node)`，每趟 layout 结束与 `dirty` 一起清空。`Repeat` 中的 `markDirty` 补偿已删除。新增 `test/engine-dirty-path.test.ts` **9 例**（其中 5 例在修复前失败），浏览器 14 项断言在无补偿下全绿。

**建议根治**（属 M7 范围内的引擎改动）：`invalidate()` 走到 relayout boundary 后，把其上的祖先加入一个独立的 `dirtyPath` 集合（**不参与测量缓存失效**，只影响 arrange 的跳过判断），再把 `placeChildOf()` 的条件改为 `!dirty.has(node) && !dirtyPath.has(node)`；或让 arrange 支持「从脏子根开始」，即记录 arrange roots 并在主 pass 之后逐个从该节点继续排布。两种都需要补一组针对性测试（固定尺寸 Panel 内的子树变更、boundary 上下同时变更、性能对照）。

---

# M7 验收记录（滚动与裁剪，2026-09）

## 交付

- `packages/widgets/src/ScrollView.ts`：滚轮（按 `deltaMode` 归一化）、指针拖拽（带位移阈值，避免与点击冲突）、惯性衰减、可选边界回弹、`auto` 滚动条（thumb 夹取与最小长度）、键盘滚动、`setScrollOffset/scrollBy/scrollTo` 与 `offset/maxOffset/viewport`。
- `packages/widgets/src/scroll-plan.ts`：纯函数 `clampOffset`/`normalizeWheel`/`applyInertia`/`thumbGeometry`/`isScrollable`/`planScrollDrag`/重新夹取，**46 个单测**。
- **裁剪**：按 PLAN §2 的结论（Phaser 4 中 `GeometryMask` 仅 Canvas 可用）走 WebGL `Components.Filters#addMask` 的滤镜遮罩路径（内部 `__WHITE` 遮罩，framebuffer = 控件尺寸即裁剪区）。
- **踩到的真缺陷**：Phaser 自带的 `filtersAutoFocus` 对**嵌套在容器里**的控件会把内容放偏 —— framebuffer 尺寸正确，但内容只画进左上约 53%×53%（实测 v 视口 300×155 / 588×356，h 视口 310×40 / 588×76）；换成 `addColorMatrix`、开 `filtersForceComposite`、手动 `centerOn` 都无效，说明问题在 focus 而不在滤镜。修复：`filtersAutoFocus = false`，每次布局自己瞄相机（`setSize(视口)` + `setOrigin(0,0)` + `setZoom(1,1)` + `setScroll(this.x, this.y)`）。
- **像素级证据**：视口外 3px 采样带内 24 个点，在"隐藏内容"前后**完全不变**（v/h/nested 三个视图）；关闭裁剪（`renderFilters = false`）后同一批点分别有 **24 / 20 / 6** 个像素发生变化（证明内容确实会画到那里）；视口内侧同位置在隐藏内容时有 **10 / 22 / 7** 个像素变化（证明内容确实画在视口内）；裁剪开启时外侧带恒为 **1 种颜色**；offset 1200 / 1240 / 1280 / 3000 时边界像素完全一致（无 1px 抖动或渗漏）。
- `#/scroll` demo：垂直 `ScrollView` 内嵌虚拟化 `Repeat`（200+ 行）、水平 chip 条、以及**固定尺寸 Panel 内的 ScrollView**（同时回归 dirtyPath 修复）。

## 门禁

`pnpm -r typecheck` 5/5；`pnpm -r test` **883 passed**（layout 260 / core 262 / phaser 98 / widgets 263）；`build` 与 `prettier --check .` 通过。

## Playwright 实测（真实 WebGL + 真实滚轮）

| 断言       | 实测                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 几何       | `v=@126,61 604x372                                                                            | h=@126,481 604x92 | nested=@742,93 332x320` |
| 首帧       | `v.offset=0 v.maxOffset=8000 v.rows=13`（虚拟化）、`h.maxOffset=2524`、`nested.maxOffset=976` |
| 滚轮 600   | `v.offset=600`、`v.rows=16`（仍远小于 200 行，虚拟化保持）                                    |
| 再滚 2000  | `v.offset=2600`（单调、未越界）                                                               |
| 滚动后命中 | 行内删除按钮的页面坐标随内容移动（`@523,86 → @523,94 → @523,70`），即滚动后点击坐标仍正确     |
| 页面错误   | `#status` 无 ERROR/REJECTION                                                                  |

## 缺陷 B 修复的回归

`#/scroll` 中"固定尺寸 Panel 内的 ScrollView"可正常滚动，且独立测试 `packages/layout/test/engine-dirty-path.test.ts`（9 例，其中 5 例在修复前失败）持续为绿。

## M7 残留项（下一轮处理）

1. **Canvas 降级不裁剪**：滤镜是 WebGL-only，Canvas 下仍可滚动但不裁剪（dev 模式 warn 一次）。
2. **滚动条 thumb 不可拖拽**：目前只做指示（几何由纯函数 `thumbGeometry` 计算并有测试）。
3. **嵌套 ScrollView 无"最内层优先"滚轮仲裁**：两个嵌套视图会同时消费 wheel 事件（demo 中三个视图互不嵌套，未触发）。
4. **`Widget.setLayoutParams(patch)` 是整包归一化而非部分补丁**（框架缺陷，`packages/phaser/src/Widget.ts`）：`setLayoutParams({ height })` 会把未提及的 `width/position/...` 重置为默认值 —— ScrollView 就因此把 holder 的 `position:'absolute'` 冲掉、内容整体不位移。建议改成"只覆盖传入的键"（并注意 `width/height` 需要同时更新其 `widthMin/widthMax` 等派生字段），补一组回归测试。
5. **M6 `#/list` demo 的滚轮只换挂载窗口、不位移容器**（视觉上"行不上移"）：应改用 M7 的 `ScrollView`（容器位移交给视图），并把 `pt.rowdelete` 从"首个挂载键"改为"首个可见行"。
