# M0–M2 验收记录

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
