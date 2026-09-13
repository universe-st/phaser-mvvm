# 验收记录 · 交互状态矩阵（第 4 轮）

> 目的：把用户验收要求里「为每个控件、布局单独写 demo，验证其在**各种情况下的状态**是否正常」补齐到**交互状态**这一层。此前 `#/showcase`（工厂 API）与 `#/compose`（DSL）证明了控件能建出来、能量出来、能点能输入，但没有系统验证 hover / press / focus / error / disabled 这些**状态迁移**——而这正是截图看不出来的部分。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server `http://localhost:5173`。
> 结论：**新建 `#/states` 状态矩阵（14 个探针）；用它做真实指针/键盘扫描时发现并修复了 P2 —— 指针按下从不移动焦点，导致焦点环永不出现、`Tab` 每次从第一个可聚焦控件重新开始。修复后状态迁移全部符合文档化优先级。**

---

## 1. 新验收页：`#/states`

`apps/examples/src/scenes/states.ts`（用 Compose DSL 编写）：

- 每一行卡片放一类控件，每个控件注册为**探针**（`probe(name, widget, restState)`）；
- 每帧把 `widget.visualState` 写进 `#demo-state` 的 `st.<name>`，页面坐标写进 `pt.<name>`；
- 暴露 `window.states`：`names()`、`rest()`（各探针的静止状态）、`state()`、`focusables()`、`geometry()`、`value(name)`、`focusable(name)`、`reveal(name)`。

| 探针                                           | 控件                                          | 静止状态 | 验证内容                                       |
| ---------------------------------------------- | --------------------------------------------- | -------- | ---------------------------------------------- |
| `button.default`                               | Button                                        | normal   | hover / press / 点击 / 聚焦 / 方向键           |
| `button.toggle`                                | Button（toggle）                              | normal   | `change` 事件与文本同步                        |
| `button.disabled`                              | Button（disabled）                            | disabled | 永不 hover/press/激活                          |
| `button.loading`                               | Button（loading）                             | normal   | 按下有 `pressed` 视觉，但激活被忽略            |
| `field.plain`                                  | TextField（双向）                             | normal   | 聚焦 / 输入 / 失焦 / 双向写回                  |
| `field.error`                                  | TextField（校验）                             | normal   | 失焦进入 `error`、error 高于 focus、补值后清除 |
| `field.readonly`                               | TextField（readOnly）                         | normal   | 可聚焦、编辑被拒                               |
| `field.disabled`                               | TextField（disabled）                         | disabled | 不可聚焦                                       |
| `field.area`                                   | TextArea                                      | normal   | 聚焦 / 多行输入                                |
| `panel.interactive`                            | Panel（interactive）                          | normal   | hover / press                                  |
| `image.plain` / `label.plain` / `spacer.plain` | Image / Label / Spacer                        | normal   | 纯展示控件始终 `normal`                        |
| `row.button`                                   | 虚拟化 List 行内 Button（两层 ScrollView 内） | normal   | 裁剪/虚拟化后状态机仍正确                      |

> 第 4 轮建页时是 14 个探针；此后又补了 6 个（当前共 **20** 个）：`button.setToggle` / `button.clearToggle`（程序化写值要上报，V70）、`cmd.label`（`bindCommand` 的 `canExecute` 禁用）、`slider.volume` / `slider.stepped` / `slider.disabled`（滑杆矩阵，见 [`ACCEPTANCE-slider.md`](./ACCEPTANCE-slider.md)）。下文表格里出现的 “14 个探针 / 14/14” 都是第 4 轮的读数。

`reveal(name)` 会把探针上方每一层 `ScrollView` 滚到让它可见——**这是必需的**：折叠在视口外的探针，其 `pt.` 坐标落在画布之外，指针事件根本到不了控件（第一次扫描时 `row.button` 就是这样报 `normal` 的假阴性）。

---

## 2. 实测结果（真实 `mouse.move/down/up` + `keyboard`）

### 2.1 悬停扫描（14 个探针）

| 探针                                                            | 静止 → 悬停             | 判定                |
| --------------------------------------------------------------- | ----------------------- | ------------------- |
| `button.default` / `button.toggle` / `button.loading`           | normal → **hover**      | ✅                  |
| `field.plain` / `field.error` / `field.readonly` / `field.area` | normal → **hover**      | ✅                  |
| `panel.interactive`                                             | normal → **hover**      | ✅                  |
| `button.disabled` / `field.disabled`                            | **disabled → disabled** | ✅ disabled 优先    |
| `image.plain` / `label.plain`                                   | normal → normal         | ✅ 非交互控件不参与 |
| `spacer.plain`                                                  | 零尺寸、无坐标          | ✅（不可交互）      |
| `row.button`（先 `reveal`）                                     | normal → **hover**      | ✅                  |

### 2.2 按下 / 点击

| 场景                              | 结果                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `button.default` 按下（不抬起）   | `st.button.default = pressed` ✅                           |
| 抬起                              | 状态回到 `hover`，`clicks +1` ✅                           |
| `button.disabled` 按下            | 保持 `disabled`，无激活 ✅                                 |
| `button.loading` 按下             | `pressed`（视觉有反馈），**`clicks` 不变**（激活被忽略）✅ |
| `panel.interactive` 按下          | `pressed` ✅                                               |
| 在 `row.button` 上按下并拖走 60px | 不触发点击，但焦点落在被抓住的行内按钮上 ✅                |

### 2.3 焦点与遍历（修复 P2 之后）

| 操作                  | 修复前                                              | 修复后                                        |
| --------------------- | --------------------------------------------------- | --------------------------------------------- |
| 点击 `button.default` | `focusedWidget = null`，`#demo-state` 无 `focus` 键 | `focus = button.default` ✅                   |
| 移开指针后的视觉状态  | `normal`（永远不会出现焦点环）                      | **`focused`** ✅                              |
| 之后按 `Tab`          | `stage`（跳回第一个可聚焦控件）                     | **`button.toggle`**（从点击处继续）✅         |
| 之后按 `→`            | 从集合头部进入                                      | **`button.loading`**（从当前焦点几何邻接）✅  |
| 点击输入框 → 点击按钮 | 输入框保持聚焦                                      | 焦点从 `field.plain` 移到 `button.default` ✅ |
| 点击纯展示 Label      | —                                                   | 焦点不变（不抢焦点）✅                        |

### 2.4 输入框状态

| 操作                              | 结果                                                  |
| --------------------------------- | ----------------------------------------------------- |
| 点击 `field.plain` 输入 `hello`   | 控件值与绑定的 ref 都变为 `hello` ✅                  |
| 失焦                              | `focus = none` ✅                                     |
| `field.error` 留空后失焦          | `error` ✅                                            |
| 再聚焦（错误未消除）              | 仍是 **`error`**（文档化的优先级：error > focused）✅ |
| 补值 `ok` 后失焦                  | 回到 `hover`/`normal`，`validate` 通过、错误清除 ✅   |
| `field.readonly` 聚焦后输入 `xyz` | 值仍为 `只读内容` ✅                                  |
| 点击 `field.disabled`             | 状态 `disabled`，`focus = none`（不可聚焦）✅         |
| `field.area` 输入 `hi`            | `notes` 长度 2 ✅                                     |

### 2.5 渲染证据

`.tmp/pw/round4-states-top.png`（矩阵总览）、`round4-states-focused.png`（鼠标移开后按钮的焦点态）、`round4-states-error.png`（校验失败的红框）、`round4-field-plain|readonly|disabled.png`（三种输入框皮肤逐像素对照，裁剪到控件矩形 ±6px）。

---

## 3. 本轮修复的缺陷

| #   | 严重度 | 缺陷                                                                                                                                                                                                                                                                    | 修法                                                                                                                                                                                | 回归测试                                                                                          |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P2  | MED    | `InputRouter.handleDown` 从不移动焦点：点击 Button/Panel 后 `focus.focusedWidget` 仍为 `null`，焦点环永不出现；`Tab` 每次都从第一个可聚焦控件开始（实测点击按钮后 Tab 落到 `stage`），方向键导航同样失去起点。输入框之所以能聚焦，是 `TextInputBase` 自己处理了指针按下 | 新增纯函数 `shouldFocusOnPress(widget)`（可聚焦且未禁用）与路由钩子 `InputRouter.onPointerFocus`；插件 `attachUi()` 把它接到 `FocusManager.focus(widget)`，按下即聚焦、拖拽前先聚焦 | `packages/phaser/test/input-order.test.ts`：`shouldFocusOnPress` 三例（可聚焦 / 非可聚焦 / 禁用） |

（顺带确认：`hover` 优先于 `focused`、`error` 优先于 `focused`、`disabled` 最高——与 `widget-state.ts` 的文档和 `#/states` 的实测一致，未改动。）

---

## 4. 已运行的命令与结果

| 命令                           | 结果                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm -r run typecheck`        | 5/5 包通过                                                                                                                                                                                       |
| `pnpm -r run test`             | **969 passed**：core 274、layout 298、phaser 119（+3）、widgets 278                                                                                                                              |
| `pnpm exec prettier --check .` | 通过                                                                                                                                                                                             |
| `pnpm run build:examples`      | 通过                                                                                                                                                                                             |
| Playwright MCP `#/states`      | 悬停 14/14、按下 6 项、焦点 6 项、输入框 8 项全部符合预期，0 错误                                                                                                                                |
| Playwright MCP 全场景回归      | `#/states`、`#/compose`、`#/showcase`、`#/form`、`#/list`、`#/scroll`、`#/bindings`、`#/gallery`、`#/dashboard`、`#/lifecycle`、`#/m0` 全部 0 错误；`#/form` 点击输入框输入 `Zhang San` 正常写回 |

---

## 5. 未验证 / 边界

1. **触摸**：主扫描用鼠标事件（`mouse.move/down/up`）。额外用 CDP `Input.dispatchTouchEvent` 做了触摸探测，结果是**部分可验、部分不可验**：
   - 可验：两次触摸 tap 都成功激活按钮（`clicks` 0 → 1 → 2），且过程中没有报错；
   - 不可验（环境限制）：本机 Chromium 的 CDP 触摸事件会**同时移动鼠标指针**（实测 `manager.mousePointer = (70,174), wasTouch: false, moveTime: 2527`），因此「触摸后指针留在原地、由 `isHoverPointer` 抑制悬停」这条路径**无法在这里观察到**——观察到的 `hover` 属于合法状态（路由器看到的是真实鼠标指针停在按钮上）。该判定本身有纯函数单测（`input-order.test.ts › isHoverPointer`），如需端到端验证需要真机/移动模拟器。
   - 未覆盖：触摸拖动滚动（本次 CDP 拖拽未产生位移，`stage.offset` 保持 0；`ScrollView` 的拖拽逻辑已有 `scroll.ts` 场景的鼠标拖拽覆盖）、长按连发、移动端软键盘。
2. **手柄**：`pollGamepad` 需要真实手柄或注入 Gamepad API，本轮未覆盖。
3. **`loading` 视觉**：只断言了「激活被忽略 + 按下有 pressed 反馈」，加载态皮肤（省略号标签）未做像素断言（`#/showcase` 有静态展示）。
4. 探针坐标依赖每帧重算；若在 `reveal()` 之后立刻取坐标（不等一帧）可能拿到旧值——验收脚本里 `reveal()` 内部已等待一帧，但这是使用约束，已写进 AGENTS §6。
5. 焦点环的**像素**未采样（只断言 `visualState`/`focused` 标志）；环的绘制由 `paintFocusRing` 的单测（`appearance.test.ts`）覆盖。

---

## 6. 提交

- 提交信息：`fix(phaser): focus the pressed widget so the ring and Tab order follow the mouse`（正文含状态矩阵结果与 P2 前后对照）。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples` 全绿。

---

## 7. `WIDGET_EVENTS`：控件事件词汇表第一次被订阅（第 96 轮）

### 7.1 为什么查它

把四个包的**事件表**（`BUTTON_EVENTS`/`SLIDER_EVENTS`/`TEXT_INPUT_EVENTS`/`WIDGET_EVENTS`）逐个拿去查 demo / 指南 / 单测三份语料，只有 `WIDGET_EVENTS` 的**两个成员没有任何代码用过**：

```ts
export const WIDGET_EVENTS = { ACTIVATE: 'widget:activate', STATE_CHANGE: 'widget:state' } as const;
```

它是"任何控件都能订阅"的那一层词汇表（也是 `ActivationSource` 的唯一出口），却从没被跑过 —— 于是本轮在 `#/states` 的 `probe()` 里给**每个探针**挂上两个监听（`eventLog`，各保留最近 40 条），逐帧发布 `events.activations`/`events.states`/`events.lastActivation`/`events.lastState`，并加 API `window.states.events()` / `clearEvents()`。

### 7.2 实测矩阵（真鼠标 / 真键盘 / 假手柄 / 真触摸）

| #   | 手势                                                 | `widget:activate`                                 | `widget:state` 流                        |
| --- | ---------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| 1   | 鼠标点击 `button.default`                            | `{ name: 'button.default', source: 'pointer' }` ✓ | `pressed → focused → hover` ✓            |
| 2   | 聚焦后按 `Enter`                                     | `source: 'keyboard'` ✓                            | 无（焦点早已在那，状态没变）✓            |
| 3   | 聚焦后按 `Space`                                     | `source: 'keyboard'` ✓                            | 无 ✓                                     |
| 4   | 假手柄按 A（`window.fakePad.button(0, true/false)`） | `source: 'gamepad'` ✓                             | 无 ✓                                     |
| 5   | **触摸**点击 `button.default`                        | `source: 'touch'` ✓                               | `pressed → focused`（**没有 `hover`**）✓ |
| 6   | 触摸点击 `button.toggle`                             | `source: 'touch'` ✓                               | `pressed → focused` ✓                    |
| 7   | 点击 `button.disabled`（负对照）                     | **两个都是空** ✓                                  | 空 ✓                                     |

第 5/7 条各自说明一件事：`source` 里鼠标与触摸**是可以分开的**；`disabled` 的控件连状态事件都不发（不是"发了但没人管"）。

### 7.3 顺带修掉的两件事

**V63（LOW，已修）：`widget:state` 在状态没变时也发。** 第 1 条第一次量出来的是 `pressed, pressed, focused, hover` —— 一次点击里 `pressed` 出现两次。原因：`appearanceChanged()` 是"重绘即调用"（主题切换、`setVariant`、`setError`、焦点环都走它），而事件名承诺的是**变化**。修法：把判定收成纯函数 `announceableState(previous, current)`（`widget-state.ts`，返回 `null` 表示不必发），`Widget` 只保留"上次播报过的状态"；单测三条钉住（首次必发、相同不发、不同发新的）。修后同一次点击是 `pressed → focused → hover` ✓。

**`ActivationSource` 补上 `'touch'`（API 改进，非缺陷）。** 此前鼠标与手指都报 `'pointer'`，需要区分"点击/点按"的界面只能绕过框架去读 Phaser 的输入；`pointer.wasTouch` 本来就摆在那里。现在输入路由器按它选源，实测第 5/6 条得到 `'touch'`、第 1 条仍是 `'pointer'`。类型是加法（`'pointer' | 'touch' | 'keyboard' | 'gamepad'`），`#/states` 的探针把两种都记下来了。

### 7.4 仍然没覆盖的

- **真实手柄**：第 4 条用的是 `window.fakePad`（替换 `navigator.getGamepads`），真机与蓝牙手柄未验。
- **长按/连发**：`activate` 是单次事件，框架没有重复激活的概念（第 51 轮登记过的导航连发在 `NavSource` 层）。

---

## 8. 第 100 轮追加：绑定到 `ref` 的开关，程序化写值也要到达模型（V70）

`#/states` 的 `button.toggle` 是 `toggle: true` + `value: this.toggled`（双向数据槽），页面上另有两个「外部置开/置关」按钮（写 `ref`）。本轮补的是**反方向**：控件自己被写入时，`ref` 是否跟着走。

| 操作                                                                                      | 修前                                                                  | 修后                                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `toggle.setValue(!toggle.getValue())`（模拟"控件自己动了"，例如键盘激活之外的程序化写入） | 控件 `false → true`，而 `#demo-state` 的 `toggled` 仍是 **`false`** ✗ | `toggled` 同步变 **`true`** ✓                                                                                                |
| `#/a11y` 的开关（`value: this.notify`）`setValue(false)`                                  | 控件已关，页面仍发布 `notify=true` ✗                                  | `notify=false` ✓                                                                                                             |
| `#/gallery` 的开关：真实鼠标点两下                                                        | —                                                                     | `toggle=true` → `toggle=false`，**每次点击恰好一个 `change`**（修 `setValue` 时删掉了激活路径里那次显式 emit，否则会发两次） |

根因与滑杆的量程钳制同族：`change` 是**模型通道**，而双向绑定的向下方向只在"源变了"时才跑——控件自己改的值不发事件，就永远没人纠正它。详见 [`PITFALLS.md`](./PITFALLS.md) §8.60。
