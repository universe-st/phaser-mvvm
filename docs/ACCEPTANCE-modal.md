# 验收记录 · 模态对话框（`this.mvvm.modal`，M8 切片）

- **验收场**：[`#/modal`](../../apps/examples/src/scenes/modal.ts)（`window.modal` 暴露全部探针）
- **被测实现**：[`packages/phaser/src/modal.ts`](../../packages/phaser/src/modal.ts)、[`packages/phaser/src/focus.ts`](../../packages/phaser/src/focus.ts) 的作用域栈、[`packages/phaser/src/plugin.ts`](../../packages/phaser/src/plugin.ts) 的 `back` 路由与按键去重
- **本轮（第 60 轮）新增**：`ModalHost`/`ModalHandle`（`open`/`close`/`closeTop`/`closeAll`/`handleBack`/`raiseLayers`/`dispose`）、`FocusManager.pushScope/popScope/scopeDepth`、`FocusTarget.handleAction?`
- **验收方式**：Playwright MCP 真实鼠标/键盘（页面先 `bringToFront()`，避免 rAF 被节流）+ `node scripts/visual-check.mjs`（新增 `modal` 场景的像素断言）
- **测试**：`packages/phaser/test/focus-scope.test.ts`（15 条作用域栈用例）；全仓 `pnpm -r run test` = 1088 passed

---

## 1. 被测行为与判据

`modal.open()` 的价值不在「对话框画出来了」，而在**它挡住了什么**。所以每条验收都是「A/B 对照」：同一个操作在**没有**对话框时必须有反应，在**有**对话框时必须没有。

| #   | 行为         | 判据                                                                               |
| --- | ------------ | ---------------------------------------------------------------------------------- |
| M1  | 打开与图层   | `depth=1`、`top=modal.confirm`、根容器最后一个子节点                               |
| M2  | 焦点陷阱     | `focusables` 只剩对话框自己的控件；`Tab`/`Shift+Tab` 在其内循环、不逃逸            |
| M3  | 打开即聚焦   | `focusFirst` 落在对话框第一个可聚焦控件（`confirm.cancel`）                        |
| M4  | 遮罩挡住页面 | 点页面按钮的坐标：`page.clicks` 不变，反而按「点遮罩」关闭                         |
| M5  | 遮罩挡住游戏 | 同一坐标的点击不落到 UI 之下的游戏对象（`world.clicks` 不变）                      |
| M6  | `Esc` 关闭   | 关闭原因记为 `back`；关闭后焦点回到打开它的控件                                    |
| M7  | 点遮罩关闭   | 关闭原因记为 `backdrop`                                                            |
| M8  | 不可关闭     | `dismissible: false`：`Esc` 与点遮罩都不关，而且 `Esc` 被吞（不漏给页面）          |
| M9  | 无遮罩       | `scrim: 0`：不画遮罩，图层自身命中区仍挡住指针，点空白处仍可关闭                   |
| M10 | 输入框       | 对话框内的输入框可点、可输入（走 DOM 桥）、`Tab` 能离开它                          |
| M11 | 叠层         | 两层时只有上层可聚焦；`Esc` 只关上层，焦点还给下层此前持有的控件                   |
| M12 | 页面换页     | 打开对话框后 `mount()` 新页面，图层仍在最上面（`raiseLayers()`）                   |
| M13 | 场景重启     | 带着打开的对话框 `scene.restart()`：计数回基线、无 ERROR、重启后仍可用             |
| M14 | 泄漏         | 开/关 100 轮后 `widgets`/`themeListeners`/`pointerTargets`/`focusables` 全部回基线 |
| M15 | 发布模式静默 | `setDevMode(false)` 后开/关一轮，`[phaser-mvvm]` 输出 0 行                         |
| M16 | 像素         | 对话框内 `danger` 填充与「透明 ghost 按钮下的对话框表面」都被脚本精确采样          |

---

## 2. 实测（第 60 轮）

页面初始态（`#demo-state`）：`depth=0 top=none focus=none page.clicks=0 world.clicks=0`；`focusables=modal.openConfirm+modal.openForm+modal.openStubborn+modal.openBare+modal.openNested+modal.pageA+modal.pageB`。

### M1–M3 打开与陷阱

点 `pt.openConfirm`（`@81,153`）→ `depth=1`、`top=modal.confirm`、`focus=confirm.cancel`、`focusables=confirm.cancel+confirm.ok`；图层结构 `modal.confirm/modal.confirm.scrim/confirm.title/confirm.body/confirm.cancel/confirm.ok`。

连按 5 次 `Tab`：`confirm.cancel → confirm.ok → confirm.cancel → …`（陷阱内环绕）。
连按 5 次 `Shift+Tab`：`confirm.cancel → confirm.ok → confirm.cancel → confirm.ok → confirm.cancel → confirm.ok`（**每次正好一步**，见 §4 的 V18）。

### M4–M5 遮挡（A/B）

| 操作                             | 无对话框         | 有对话框                                   |
| -------------------------------- | ---------------- | ------------------------------------------ |
| 点页面按钮 `@81,261`             | `page.clicks=1`  | `page.clicks` 仍为 1（且 `backdrop` 关闭） |
| 点空白 `@40,600`（页面透传世界） | `world.clicks=1` | `world.clicks` 不变                        |

不可关闭的对话框再来一遍：`Esc` 与点遮罩之后 `depth` 仍为 1，`world.clicks`、`page.clicks` 增量都是 **0**，只有点它自己的按钮才关闭（原因 `api`）。

### M6–M9 关闭语义

| 场景                    | 结果                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `Esc`                   | `depth=0`、`reasons=[…,'back']`、`focus=modal.openConfirm`（焦点复原）                   |
| 点遮罩（`dismissible`） | `reasons=[…,'backdrop']`                                                                 |
| `dismissible: false`    | `Esc`/点遮罩都无效，`reasons` 不增长；点「知道了」→ `api`                                |
| `scrim: 0`              | 打开（`focus=bare.ok`），点空白 `@60,620` → `depth=0`、`backdrop`，`page/world` 增量为 0 |

### M10 输入框

点 `pt.form.field` → `focus=form.field`；输入 `abc` → `field="abc"`（DOM 桥 `activeElement=INPUT`）。
`Tab` → `form.cancel`；`Shift+Tab` → `form.field`；`Shift+Tab` → `form.ok`（作用域内反向环绕）；`Tab` → `form.field`。
字段有内容时 `Esc` → 对话框关闭（原因 `back`），关闭后 `activeElement=BODY`，再打字不会进到已销毁的输入框（`field` 不再变化）。

### M11 叠层

打开 `nested` → `focus=nested.close`；点 `pt.nested.deeper` → `depth=2`、`focus=second.ok`、`focusables=second.ok`（下层控件不可聚焦）。
`Esc` → 只剩 `modal.nested`、`focus=nested.deeper`（**焦点还给下层里打开它的那个控件**）；再 `Esc` → `depth=0`、`focus=modal.openNested`。

### M12 页面换页

`modal.open()` 之后调用 `this.mvvm.mount(page)`：图层被重新抬为根容器最后一个子节点（`raiseLayers()`），新页面不会盖住对话框。

### M13 场景重启

带对话框执行 `scene.restart()`：重启后 `depth=0`、`reasons` 末尾是 `'scene'`（`onClose` 仍然回调）、`counts` 与基线完全一致、`#status` 无 `ERROR`、控制台 0 条 error；重启后的页面点击与对话框开/关都正常。

### M14–M15 泄漏与静默

`window.modal.churn(100)`（100 次开/关）：

```
before { widgets: 21, themeListeners: 23, pointerTargets: 10, focusables: 7 }
after  { widgets: 21, themeListeners: 23, pointerTargets: 10, focusables: 7 }
```

dev 模式下一次开/关打印 2 行（`modal.open: …`、`modal.close: …`），`setDevMode(false)` 后同样操作 **0 行**。

### M16 像素（`node scripts/visual-check.mjs`）

新增 `modal` 场景：`SCENE_SETUP.modal = 'window.modal.open("confirm")'`，场景在**每种对话框第一次打开**时把自己的 rect 追加进 `#status`：

```
confirm.panel=@430,285 420x150
confirm.cancel=@706,378 58x36
confirm.ok=@772,378 58x36
```

1280×720 视口下 `confirm.panel` 中心正好是 `(640, 360)`（居中）；采样结果：

```
OK  confirm.ok: #f85149      (danger 填充)
OK  confirm.cancel: #161b22  (ghost 透明 → 透出对话框表面色，而不是被遮罩压暗的页面色)
```

该场景**不检查** `canvas.clear`：遮罩按设计盖满整块画布，角落是「主题背景 × 半透明黑」的混合值，属于 GPU 取整问题而非稳定期望（`CANVAS_CLEAR_SKIP`）。其余四个场景（`m0`/`probe`/`stack`/`hud`）的 `canvas.clear` 照旧。

---

## 3. 单元测试（Node，无渲染器）

`packages/phaser/test/focus-scope.test.ts` 用假控件跑真实的 `FocusManager`，15 条：

- 基础作用域行为不变（收集顺序、`wrap: false` 到边界停住）；
- `pushScope` 后：只收集模态子树、页面控件自己 `focus()` 被忽略（陷阱）、`trap` 蕴含环绕；
- 挂起语义：页面控件的焦点环被摘掉但身份被记住；
- `focusFirst` 立即进入对话框；
- 几何导航（`move('down')`）不会跑到模态外面；
- `blur()` 在陷阱作用域被拒绝、在普通作用域生效；
- `popScope()` 把焦点还给此前持有者（环也还）；**此前持有者已被销毁时释放焦点**；三层嵌套逐层回退；
- 空栈 `popScope()` 返回 `false`；
- `refresh()` 只动当前作用域；`detach()` 清空全部作用域与环；`attach()` 丢掉临时叠加的作用域。

`packages/widgets/test/label-size.test.ts` 3 条覆盖新增的 `Text({ size })` 令牌解析（见 §4 V19）。

---

## 4. 本轮同时修复的两个真实缺陷

这两条都是**做模态验收时被抓出来的**，都不只影响模态框：

### V17 · 输入框吃掉了 `Tab` 与 `Escape`

- **现象**：持有焦点的文本框里按 `Tab` **什么都不发生**（页面与模态框都是）；模态框里的文本框按 `Esc` 也关不掉对话框。
- **根因**：Phaser 的 `KeyboardManager.onKeyDown` 会**直接丢弃 `defaultPrevented` 的按键**（`KeyboardManager.js:188`）。DOM 桥路径下输入框为了不让浏览器搬走 DOM 焦点而 `preventDefault()` 了 `Tab`，于是场景插件永远收不到它；`Escape` 更是被 `stopPropagation()` 掉，而它对 `blur()` 的调用在陷阱作用域里被拒绝 → 键彻底失效。
- **修法**：`FocusTarget` 增加可选 `handleAction()`；`TextInputBase` 在 DOM 桥路径下把 `Tab`/`Shift+Tab` 直接交给焦点管理器，并在「`blur()` 被拒绝（说明在陷阱作用域里）」时把 `Escape` 转成 `back`。
- **验证**：`#/form` 点名字框 → 输入 → `Tab` → 焦点到 email（修复前不动）→ `Shift+Tab` 回到名字框；模态框里同样成立（§2 M10）。

### V18 · 一次按键被当成两三次

- **现象**：`Shift+Tab` 有时走一步、有时走两三步（一次按下在日志里产生 2–3 次 `prev`），滑块连按方向键的步数也可能翻倍。
- **根因**：`KeyboardPlugin.update()` 在**每个**输入事件上重走一遍管理器队列，而它的「重复事件」判据只比较**相邻**一条（`prevCode/prevTime/prevType`）。`Shift+Tab` 同帧产生两个 keydown（Shift、Tab），于是队列被走了多遍、`Tab` 被派发多次。
- **修法**：插件按帧记录已处理的**事件对象**（`Set<KeyboardEvent>`，`PRE_UPDATE` 清空）——重复派发的是同一个对象，而新按键一定是新对象，所以既不会漏按也不会重复。
- **验证**：连按 5 次 `Shift+Tab` 每次正好一步（§2 M1–M3）；`#/states` 点滑杆后连按 3 次 `→`，值 50 → 65（每步 5，正好 3 步）；其余 11 个场景无 ERROR，`#/lifecycle` churn(20) 全部计数为单值。

### V19 · `Text({ size })` 是文档里有、代码里没有的选项

- **现象**：DSL 的头号示例 `Text('Hello phaser-mvvm', { size: 'xl' })` 编译报错（TS 层面）／运行时被静默忽略（JS 层面）；`size` 只存在于 `Button`。
- **修法**：`LabelOptions` 增加 `size: 'xs'|'sm'|'md'|'lg'|'xl' | number`，按**当前主题**的字号表解析（换主题跟着变），`style.fontSize` 仍可覆盖；`resolveLabelFontSize()` 放在无 Phaser 依赖的 `text-padding.ts` 里并有 3 条单测。
- **验证**：`#/modal` 的标题用 `{ size: 'lg' }` 渲染为 20px 级别（截图可见），指南 03 已补进选项表。

---

## 5. 未覆盖 / 有意不做

- **旋转（双指旋转）与双击缩放**：仍未实现（`ScrollView` 只做捏合缩放），与模态无关。
- **真机（iOS Safari）触摸**：本轮只在 CDP 触摸仿真下验收过滚动/滑杆（历史记录见 `ACCEPTANCE-touch.md`）；模态的触摸路径与鼠标共用同一套命中区与 `onActivate`，但**未在真机上跑过**。
- **手柄**：`back`（B/○）走的是同一条 `handleBack()` 路径（`pollGamepad` → `handleAction('back')`），本轮**未接实体手柄验证**，仅由键盘 `Esc` 覆盖。
- **`scrim` 的像素混合值**：只断言了不透明度会盖住画面（截图可见），没有把混合结果写成精确像素期望（GPU 取整）。
- **动画/转场钩子**：`ModalOptions` 目前没有开闭动画；PLAN M8 里的「开闭动效钩子」尚未实现。
