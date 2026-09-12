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

1. **触摸**：全部扫描用鼠标事件（`mouse.move/down/up`）。触摸的 hover 抑制（`isHoverPointer`）、长按连发、移动端软键盘未在本轮复测。
2. **手柄**：`pollGamepad` 需要真实手柄或注入 Gamepad API，本轮未覆盖。
3. **`loading` 视觉**：只断言了「激活被忽略 + 按下有 pressed 反馈」，加载态皮肤（省略号标签）未做像素断言（`#/showcase` 有静态展示）。
4. 探针坐标依赖每帧重算；若在 `reveal()` 之后立刻取坐标（不等一帧）可能拿到旧值——验收脚本里 `reveal()` 内部已等待一帧，但这是使用约束，已写进 AGENTS §6。
5. 焦点环的**像素**未采样（只断言 `visualState`/`focused` 标志）；环的绘制由 `paintFocusRing` 的单测（`appearance.test.ts`）覆盖。

---

## 6. 提交

- 提交信息：`fix(phaser): focus the pressed widget so the ring and Tab order follow the mouse`（正文含状态矩阵结果与 P2 前后对照）。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples` 全绿。
