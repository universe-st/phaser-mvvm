# 验收记录 · Compose 风格 DSL + 缺陷修复（第 1 轮）

> 目的：把「用 UI 的代码像 Jetpack Compose 一样简洁」落成可运行的 API，并按验收要求（Playwright MCP、每个控件／布局单独 demo、验收报告、提交代码）留下证据。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Chrome（Playwright MCP 内置 Chromium），dev server `http://localhost:5173`（`pnpm dev`，`strictPort`）。
> 结论：**DSL 落地并逐控件／逐容器验收通过；两个只读缺陷审计共 27 项发现，本轮修复 13 项（含 1 项 HIGH、5 项 MED），全部带回归测试；未修复项已登记到 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md)。**

---

## 1. 本轮交付

| 交付物                                  | 位置                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Compose 风格 DSL                        | `packages/widgets/src/compose.ts`（子路径导出 `@phaser-mvvm/widgets/compose`） |
| DSL 作用域机制（纯逻辑，可 Node 单测）  | `packages/phaser/src/uiscope.ts`                                               |
| 反应式参数规则（常量 / `Ref` / getter） | `packages/widgets/src/reactive-source.ts`                                      |
| 逐控件／逐容器验收场景                  | `apps/examples/src/scenes/compose.ts`（`#/compose`，11 个演示分区）            |
| 使用指南第 9 章                         | `docs/guide/09-compose-dsl.md`                                                 |
| PLAN 记录                               | `docs/PLAN.md` §5.1                                                            |
| 缺陷清单（含未修项）                    | `docs/DEFECT-BACKLOG.md`                                                       |

DSL 的写法（与 `#/compose` 场景一致）：

```ts
const page = ui(this, () => {
  Column({ gap: 12, padding: 16 }, () => {
    Text(() => `计数：${counter.value}`); // getter / ref 自动绑定
    TextField({ value: name, label: '姓名' }); // ref → 双向
    Row({ gap: 8, justifyContent: 'end' }, () => {
      Button('取消', { variant: 'ghost' });
      Button('确定', { variant: 'primary', onClick: save });
    });
  });
});
this.mvvm.mount(page);
```

---

## 2. 已运行的命令与结果（全部实测）

| 命令                                                     | 结果                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm -r run typecheck`                                  | 5/5 包通过（core / layout / phaser / widgets / examples）               |
| `pnpm -r run test`                                       | **942 passed**：core 270、layout 281、phaser 116、widgets 275（无失败） |
| `pnpm exec prettier --check .`                           | `All matched files use Prettier code style!`                            |
| `pnpm --filter @phaser-mvvm/examples run build`（见 §6） | 通过                                                                    |
| Playwright MCP（`http://localhost:5173/#/compose`）      | 10 个分区全部渲染、交互与几何断言通过，见 §3                            |

新增／更新的测试：

| 测试文件                                                               | 覆盖                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/phaser/test/uiscope.test.ts`（新，10）                       | 作用域开闭、根收集、嵌套计数、异常后不残留半开作用域、子树隔离、单根校验 |
| `packages/widgets/test/reactive-source.test.ts`（新，7）               | 常量不绑定、`Ref`/getter 识别、只读源写入告警、dev 模式开关              |
| `packages/phaser/test/skin.test.ts`（新，3）                           | 方角边框真的描边、圆角边框内缩描边、无边框状态不描边                     |
| `packages/core/test/{collections,dev,computed,watch,reactive}.test.ts` | +8 个回归用例（见 §4）                                                   |
| `packages/widgets/test/{text-edit,text-truncate}.test.ts`              | +4 个回归用例（见 §4）                                                   |

---

## 3. `#/compose` 验收：逐控件／逐布局

场景结构：左侧导航（10 个分区）+ 右侧 `ScrollView` 舞台；每个分区是一张卡片，卡片标题说明演示内容。所有可点击控件每帧把页面坐标写入 `#demo-state` 的 `pt.<key>=@x,y`，因此 Playwright 用真实鼠标点击即可验证交互；`#status` 输出 `nav/stage/section` 的实测矩形与 canvas 偏移。

**分区清单与实测结果**（`window.compose.show(id)` 切换，逐一截图；尺寸为 `#status` 中该分区**布局完成后**的实测值，`x.5` 来自 dpr=2 的像素对齐）：

| 分区      | 覆盖内容                                                                                    | 实测（`section` 主机尺寸 / 节点数） |
| --------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flow`    | `if`/`for`/build 期 `switch`、`visible` 反应式条件、`hideMode: 'keep'`、`Branch()` 结构切换 | 1136×422.5 / 41                     |
| `text`    | 常量、ref、getter、tone、align、`maxLines`+`ellipsis`、`alignSelf`                          | 928×248 / 18                        |
| `buttons` | 4 变体 × 3 尺寸、disabled、loading、toggle、图标（含纯图标按钮）                            | 928×180.5 / 20                      |
| `inputs`  | `TextField`（ref 双向、getter+`onValueChange`、number、password、校验）、`TextArea`         | 928×462.5 / 16                      |
| `decor`   | Panel 6 变体、elevation、Divider 横/纵、Spacer flex/固定、Image 三种 fit                    | 928×340 / 35                        |
| `box`     | `justifyContent` 5 种、`alignItems`、`wrap`                                                 | 928×512.5 / 73                      |
| `grid`    | 固定列、`columns:'auto'`+`minColumnWidth`、`gridColumnSpan`                                 | 928×363 / 38                        |
| `stack`   | `align` 三种 + `Absolute` 角标                                                              | 928×280.5 / 20                      |
| `params`  | `width` 关键字、`50%`、`grow`、`min/max`、`aspectRatio`、`alignSelf`、`order`               | 928×284.5 / 27                      |
| `list`    | keyed `List` + 虚拟化（200 行）+ add/remove 按钮                                            | 928×388.5 / 31                      |
| `parity`  | 同一卡片：工厂 API vs DSL，逐节点比对 `appliedRect`                                         | 928×206.5 / 15                      |

### 3.1 第 69 轮追加：`Branch`（结构性切换）

`visible` 保留节点、只藏起来；**换成另一棵树**要用 `Branch()`：按 key 建一个分支，切 key 时销毁旧分支（连同它的绑定、主题订阅、文字纹理），再建新分支。演示在 `Flow` 分区的最后一张卡片里（四个按钮：`分支 A` / `分支 B` / `三个根` / `未知 key`），`#/compose` 逐帧发布 `branch.key`/`branch.builds`/`branch.widgets`/`branch.roots`/`branch.destroyed`，`window.compose.branch()`/`setBranch(k)`/`counts()` 也能直接读。

**实测（一次干净的 A → B → 三个根 → 未知 key → A 循环；`window.compose.setBranch(k)` + 真实鼠标点击两种驱动都试过）**：

| key         | 触发 | `builds` | 分支内控件 | 分支根数 | 旧分支已销毁 | 分区高度 | `counts`（控件/主题订阅/焦点/指针/镜像）     |
| ----------- | ---- | -------- | ---------- | -------- | ------------ | -------- | -------------------------------------------- |
| `a`（起始） | —    | 1        | 3          | 1        | —            | 469      | 41 / 64 / 20 / 31 / 20                       |
| `b`         | 点击 | 2        | 7          | 1        | ✅ `true`    | **484**  | 45 / 68 / 20 / 31 / 20                       |
| `multi`     | 点击 | 3        | 3          | **3**    | ✅ `true`    | **436**  | 42 / 65 / 19 / 29 / 19                       |
| `missing`   | 点击 | 4        | **0**      | 0        | ✅ `true`    | **396**  | 38 / 61 / 19 / 29 / 19                       |
| `a`（回到） | 点击 | 5        | 3          | 1        | ✅ `true`    | 469      | **41 / 64 / 20 / 31 / 20**（与起始逐项相同） |

**判据**：

| #   | 断言                 | 实测                                                                                                                                                                                                         |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | key 变了才重建       | 点分支 A 里面的按钮两次：`builds` 仍是 **1**（分支没有被重建），只有 `branch.clicks` 从 0 → 2                                                                                                                |
| B2  | 旧分支真的被销毁     | 每次切换后 `previousDestroyed=true`，且被销毁控件在焦点集合、指针目标、无障碍镜像里都不再出现（`focusablesIncludeInner=false`）                                                                              |
| B3  | 焦点被释放而不是悬空 | 焦点在分支 A 的按钮上时切到 B：`focus=none`，且 DOM 里查不到 `branch.a.inner` 的镜像节点（换成 B 自己的节点，总数仍是 20）                                                                                   |
| B4  | 布局跟着分支走       | 分区高度 **469 → 484 → 436 → 396 → 469**（B 更高、未知 key 最矮），A 往返后逐像素回到 469                                                                                                                    |
| B5  | 多根按页面的规则处理 | `三个根` 分支 `roots=3`：控制台一条 `wrapped in a vertical Column` 警告，页面照常显示                                                                                                                        |
| B6  | 未知 key 不崩        | `missing` 分支清空（`widgets=0`）并打一条指名警告（列出可用 key）；内部用 `hasOwnProperty` 查询，`constructor`/`toString`/`__proto__` 不会被误当分支调用（`packages/widgets/test/branch-plan.test.ts` 8 例） |
| B7  | 反复切换不泄漏       | 一整圈回到 A 后 `counts` 与起始逐项相同（41 / 64 / 20 / 31 / 20）                                                                                                                                            |
| B8  | 触摸同权             | CDP 触摸仿真下 tap `分支 B` → tap `未知 key` → tap `分支 A`：`builds` 1→2→3、key 依次变化，与鼠标一致                                                                                                        |
| B9  | 探针不撒谎           | 分支被销毁后 `pt.branch.a.inner=gone`、`st.branch.a.inner=gone`（否则 `#demo-state` 会一直留着最后一帧的坐标，验收会点到别的东西上）                                                                         |
| B10 | dev 轨迹 / 发布静默  | `branch: branch -> b (7 widget(s), 1 root(s), 2 build(s) so far)`；`未知 key` 时 `branch: cleared (no branch for key "missing")`                                                                             |

**交互断言（Playwright MCP 真实鼠标/键盘）**：

| 断言                        | 结果                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10 个分区依次切换           | 每次 `section=<id>`，主机宽高非零，`#status` 无 `ERROR/REJECTION`；几何在该分区**布局完成后**上报（场景把上报推迟到下一帧，避免读到上一分区的 rect） |
| `counter.inc` 点 3 次       | `compose.state().counter === 3`，且画布上的 getter 文本变为 “counter = 3”（截图为证）                                                                |
| `clicks` 点 2 次 + `toggle` | `clicks === 2`、`toggled === true`，按钮文本原地变为「点击次数：2」「开关：开」                                                                      |
| `TextField({ value: ref })` | 点击输入框输入 `Li Lei` → `compose.state().name === 'Li Lei'`（双向绑定写回 ref）                                                                    |
| `onValueChange` 单向 getter | 输入 `abc` → ref 变为 `ABC`（大写提升策略生效）                                                                                                      |
| 邮箱失焦校验                | 输入 `nope` 后点击他处 → `email === 'nope'`，`computed` 读出“无效”                                                                                   |
| `List` 虚拟化               | 200 行时 `rows.rendered=12`（窗口化）；add×2 → `rows=202`；remove → `rows=201`                                                                       |
| `parity`                    | `parity=ok`（工厂 API 与 DSL 建出的卡片逐节点几何一致）                                                                                              |
| 主题切换                    | 切换 dark↔light 后页面几何不变、无错误                                                                                                               |
| 控制台                      | 无框架告警；dev 日志按预期输出 `ui(): built N widget(s), D level(s) deep`，`setDevMode(false)` 后静默                                                |

截图（Playwright MCP，`.tmp/pw/`，均为 1200×643 视口）：`compose-10-text.png`、`compose-03-buttons.png`、`compose-11-inputs.png`、`compose-12-decor.png`、`compose-13-box.png`、`compose-14-grid.png`、`compose-15-stack.png`、`compose-16-params.png`、`compose-17-list.png`、`compose-18-parity.png`、`showcase-buttons-compare.png`（回归对照）。

**回归对照**：`#/showcase`（旧工厂 API 验收页）在改动后仍正常渲染与交互（点击 `nav.buttons` 切换分区成功，43 个控件、无错误），确认 DSL 与缺陷修复没有破坏既有页面。

---

### 3.2 第 84 轮追加：状态槽位（`disabled` / `error` / `variant`）

`#/compose` 新增第 11 个分区 **State slots**：一个 `TextField`（`disabled` 与 `error` 都由 `ref` 驱动）、一个 `Slider`（同一个 `disabled`）、一个 `Panel`（`variant` 由 `ref` 驱动），外加三个只改 `ref` 的按钮（锁定 / 标记错误 / 换变体）。逐帧发布 `state.locked`/`state.error`/`state.variant`/`state.volume` 与每个控件的 `st.state.*`；`window.compose.setState({ locked, error, variant })` 与 `slots()` 是读写入口。

**判据（Playwright MCP 真实鼠标）**：

| #   | 断言                           | 实测                                                                                                                                          |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | 点字段 → 拿到焦点              | `focus=state.field`，`st.state.field` 从 `normal` 到 `hover`                                                                                  |
| S2  | `disabled: () => ref` 真的生效 | 点「锁定」后 `st.state.field=disabled`、`st.state.slider=disabled`（滑杆同槽位），**焦点自己离开字段**（`focus=state.lock`）                  |
| S3  | 禁用的字段拒绝聚焦             | 再点字段：`focus` 仍是 `state.lock`（没有被抢走），DOM 桥同步禁用                                                                             |
| S4  | `error: () => ref` 传文案      | 点「标记错误」→ `slots().fieldError === '这个值不合法（来自状态）'`，与 `state.error` 一致                                                    |
| S5  | 清除即恢复                     | 点「清除错误」→ `fieldError=null`；解锁后 `st.state.field` 由 `disabled` 变 `error`（错误仍在）→ 清掉后 `hover`                               |
| S6  | `variant: () => ref` 重绘      | 连点 5 次「换变体」：`surface → surfaceAlt → primary → danger → plain → surface`，像素上 `state.panel` 采样到 `#f85149`（暗）/`#cf222e`（亮） |
| S7  | 触摸同权（CDP）                | 触摸 tap「锁定」→ 触摸拖拽滑杆 → `volume` 停在 **40**；tap 解锁后同样的拖拽 → **58**                                                          |
| S8  | 逐帧探针不撒谎                 | 分区有 `pt.state.*`/`st.state.*`（此前 `#/compose` 只发 `pt.*`，本轮补上 `st.*`，与 `#/states`/`#/showcase` 对齐）                            |

**像素门禁**：`scripts/visual-check.mjs` 把 `#/compose` 收进常驻矩阵，`SCENE_SETUP` 先切到 `state` 分区、再把面板变体**在运行时**改成 `danger`，然后断言 `state.panel` 采样到 `#f85149`/`#cf222e`。面板是**以 `surface` 构造**的，所以这个颜色只可能来自一次真正的重绘 —— 一个"换了变体但没重绘"的静默缺陷（V38 家族）会在这里红掉。实测：`OK state.panel: #f85149 at (1176,230)`（暗）、`OK state.panel: #cf222e at (1176,230)`（亮）。

### 3.3 第 85 轮追加：`Scroll` 的 `offset` 槽位（滚动位置即状态）

`#/compose` 的 `list` 分区把 `Scroll` 的滚动位置绑到一个 `ref` 上（`window.compose.listOffset()` / `setListOffset(v)` 读写它），并逐帧发布两个读数：`list.offset`（控件自己的 `offset`）与 `list.offsetState`（那个 `ref`）。**两者必须一致**，这就是"状态跟着视图走"的证据；另加一个「回到顶部」按钮，它只写 `ref`。

| #   | 断言                            | 实测                                                                                                                   |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| O1  | 滚轮 → 状态跟着走               | 滚轮 220 → `list.offset=440`、`list.offsetState=440`、`listOffset()=440`                                               |
| O2  | 鼠标拖动 → 状态跟着走           | 拖拽 120px → 662 / 662 / 662                                                                                           |
| O3  | 甩动惯性 → 状态跟着走           | 快速上拖松手：`200 / 200 / 200`（松手瞬间就一致，惯性的每一帧都在写回）                                                |
| O4  | 写状态 → 视图移动               | `setListOffset(0)` → 立刻 0；`setListOffset(150)` → 150                                                                |
| O5  | 按钮只写 `ref` 就能回顶         | 点「回到顶部」→ 0 / 0 / 0                                                                                              |
| O6  | **惯性不会带走一次显式写入**    | 甩动中 `setListOffset(0)`：修前落在 **5**（还在滑），修后立刻 0 并**停在 0**                                           |
| O7  | 触摸拖动同权                    | CDP 触摸拖 120px → 120 / 120 / 120                                                                                     |
| O8  | 缩放也写回（以前完全不上报）    | `#/scroll`：`watchScroll('nested')` 后 `setZoom(1.6)` → 偏移 0 → 90 且**触发 1 次 `'scroll'`**；缩回 1 → 2 次          |
| O9  | 重构没有破坏焦点滚进视野（V33） | `#/scroll` 连按 60 次 `Tab`：60 个**不同**的控件，每一个都落在某个口的可见带内，且 v / nested / inner 三个口都真的滚过 |

**同轮修掉的两个问题（V53）**：① `'scroll'` 事件只在 `setOffset()` 里发，而捏合缩放、`setContent()`、尺寸变化后的钳制都**直接写** `currentX/currentY` —— 一个观察者（`offset` 槽、自绘滚动条）在缩放后会停在旧值；现在**所有**偏移写入都走 `commitOffset()`（`grep 'this.currentX = '` 只剩它自己）。② 显式设置位置不打断惯性：`offset.value = 0` 会被上一次甩动继续带走，落点不是 0；现在 `setScrollOffset()` 先 `stopScroll()`。

## 4. 本轮修复的缺陷（均带回归测试）

审计方式：两个只读子代理分别审查 `packages/{core,layout}` 与 `packages/{phaser,widgets}`，要求给出 `file:line`、可复现输入→错误输出、最小修复建议；子代理用临时 vitest 探针验证后删除，`git status` 无残留。

| #   | 严重度  | 缺陷                                                                                                                              | 修复                                                                                                 |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | HIGH    | `shallowReactive(Map/Set)` 的代理无法 `toRaw` 解包，所有被插桩方法自我递归 → 栈溢出                                               | `reactive.ts`：RAW 判定改为「四个 proxy Map 中任一登记的代理」                                       |
| 2   | MED     | `deepEqual` 的 `visited` 不按路径回收 → 比较不对称、深监听误触发                                                                  | `equality.ts`：拆出 `compareObjects`，`finally` 中 `visited.delete(a)`                               |
| 3   | MED     | `ProceduralSkin` 在 `radius: 0` 时用 `fillRect` + `strokePath`，方角边框**画不出来**（`#showcase` 的 `radius: 0` 面板同样受影响） | `skin.ts`：方角走 `strokeRect`，圆角走 `strokeRoundedRect`（新增 3 个单测锁定调用序列）              |
| 4   | MED     | 控件销毁后输入路由／焦点管理器仍调用 `setHovered/setPressed/setFocused`，导致对已释放的 `Graphics/Text` 重绘                      | `Widget.destroy`：清理 `_hovered/_pressed/_focused/pointerReady`，让后续调用命中相等性守卫成为空操作 |
| 5   | MED     | `InputRouter.resolveTarget` 根偏移取负（`-root.x`），命中原点被平移 2×root 偏移                                                   | `input.ts`：改为 `+root.x/+root.y`（默认路径下根在 (0,0)，此前不可见）                               |
| 6   | MED     | `watch([reactiveObject], cb)` 永不触发（数组源里的 reactive 对象不遍历、无告警）                                                  | `watch.ts`：reactive 条目走 `traverse` 并按元素深比较，不可观察条目给出告警                          |
| 7   | MED-LOW | `computed` 的 getter 抛错后 `#dirty=false`，后续读取静默返回陈旧缓存                                                              | `computed.ts`：抛错路径恢复 `#dirty = true`                                                          |
| 8   | LOW     | `readonly(ref)` 不再是 ref（`isRef` 为假、`unref`/`watch` 失效）                                                                  | `reactive.ts`：补 `IS_REF` 标记并转发 `trigger()`                                                    |
| 9   | LOW     | `ellipsizeLine` 二分按 UTF-16 单元切，可能切出半个表情（豆腐块）                                                                  | `text-truncate.ts`：新增 `snapToCodePoint` 并回退到码点边界                                          |
| 10  | LOW     | `moveCaretVertically` 用原始 `Math.min` 恢复列，落点可能位于代理对中间                                                            | `text-edit.ts`：改用 `clampCaret`（复用 `snapToCodePoint`）                                          |
| 11  | LOW     | `filterNumeric` 可返回 `-` / `.` / `-.`，`Number()` 为 `NaN`，双向绑定会把 `NaN` 写进 VM                                          | `text-edit.ts`：无数字则返回空串                                                                     |
| 12  | LOW     | `DomInputBridge.detach()` 少摘一个 `keyup` 监听（attach/detach 不对称）                                                           | `input-bridge.ts`：补 `removeEventListener('keyup', …)`                                              |
| 13  | LOW     | `bindCommand` 的 stop 会覆盖之后绑定的 `onActivate`                                                                               | `binding.ts`：仅当自身回调仍安装时才恢复旧值                                                         |

另外新增：`core/utils/dev.ts` 的 `devLog()`（调试期打点、发布期静默）与告警去重表的容量上限（避免长生命周期应用里字符串无界增长）。

**未修复项**：`packages/layout` 的测量缓存键缺 percent base、pass 内 `invalidate()` 被丢弃、`reset()` 后不重排、`contextPool` 强引用已脱离节点、`'stretch'` 忽略子节点 min/max 等 14 项，以及 phaser/widgets 的 4 项（`Repeat` 视口为 0 时虚拟化退化为 overscan 行、`ScrollView` 内容变短后不重新 clamp、`ThumbGeometry.position` 文档与实现不符、`ScrollView` 视口混用）——已逐条登记在 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) 并标注触发条件与建议修法，下一轮按严重度处理。

---

## 5. 已知未验证 / 边界

1. **Canvas 渲染器降级路径**未在本轮复测（本轮全部为 WebGL；Canvas 仅做不崩溃保证）。
2. **触摸／移动端软键盘**未实测（桌面 Chromium 鼠标+键盘覆盖）。
3. `#/compose` 的 parity 只比较**几何**（`appliedRect` 与节点数），不比较绘制调用序列；绘制差异由 §4 的 `skin.test.ts` 单测覆盖。
4. 缺陷审计中标注「suspected but unconfirmed」的项（相机 transform 下的命中测试、`filters` 销毁、`ScrollView` 视口混用等）**未确认成立**，登记为待验证而不是缺陷。
5. 本轮未复跑 `node scripts/visual-check.mjs`（其硬编码场景为 `m0`/`probe`/`stack`，与本轮改动无关；几何断言改用 Playwright MCP 的 `#status` 读取，等价且更直接）。

---

## 6. 提交

- 提交信息：`feat(widgets): Compose-style UI DSL with scopes, reactive arguments and per-widget acceptance scene`（正文列出缺陷修复与验收证据）。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm --filter @phaser-mvvm/examples run build` 全绿。
