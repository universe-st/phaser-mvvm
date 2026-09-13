# 验收记录 · 页面栈（`this.mvvm.pages`，M8 切片）

- **验收场**：[`#/pages`](../../apps/examples/src/scenes/pages.ts)（`window.pages` 暴露全部探针）
- **被测实现**：[`packages/phaser/src/pages.ts`](../../packages/phaser/src/pages.ts)、[`packages/phaser/src/back-plan.ts`](../../packages/phaser/src/back-plan.ts)、[`packages/phaser/src/ui-build.ts`](../../packages/phaser/src/ui-build.ts)、[`packages/phaser/src/plugin.ts`](../../packages/phaser/src/plugin.ts) 的 `back` 路由
- **第 61 轮新增**：`PageHost`/`PageHandle`（`push`/`pop`/`popToRoot`/`close`/`handleBack`/`dispose`）、`planBack()`、`MVVMPlugin.onBack` + `back` 路由守卫、`buildUiPage()`（`ui()`/`modal.open()`/`pages.push()` 共用一条「视图 lambda」规则）
- **验收方式**：Playwright MCP（真实鼠标 + 键盘，断言前 `bringToFront()`）；Node 单测覆盖 `planBack()`；`node scripts/visual-check.mjs` 5 场景仍全绿
- **测试**：全仓 `pnpm -r run test` = **1092 passed**（layout 313 / core 281 / phaser 165 / widgets 333）

---

## 1. 被测行为

页面栈要证明的**不是**「页面画出来了」，而是「**你离开的那一页怎么了**」。所以每条判据都是状态对照：

| #   | 行为             | 判据                                                                                                                     |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P1  | 第一页与生命周期 | `depth=1`、`names=[list]`、`resumes=1`（`push()` 后调用 `onResume`）                                                     |
| P2  | 推入             | `depth=2`、`names=[list,detail:n]`；`focusables` **只剩新页**的控件                                                      |
| P3  | 被盖住的那一页   | 计数、输入内容、滚动偏移三项逐字保留；页面不可点、不可输入                                                               |
| P4  | 焦点跟着页面走   | 新页上 `Tab` 落到新页第一个可聚焦控件；`pop()` 后焦点**回到被盖住那页此前持有的控件**                                    |
| P5  | 隐藏页输入框     | 推入后 DOM 桥失焦（`activeElement=BODY`），打字不会进到隐藏页的字段                                                      |
| P6  | `Esc` 弹出一层   | `onPause` → `onResume`（下层）→ `onDispose`（被弹出的页）顺序正确                                                        |
| P7  | 三层             | `names=[list,detail,deeper]`；`popToRoot()` 一次回到第一页，每一步 `onDispose` 都被调用                                  |
| P8  | 与模态的层序     | 页面上开对话框 → 第一次 `Esc` 只关对话框（`depth` 不变），第二次才弹页                                                   |
| P9  | 应用级返回       | 只剩第一页时 `Esc` 落到 `mvvm.onBack`（`appBacks` +1）；输入框持有焦点时同样落到那里                                     |
| P10 | 泄漏             | `churn(50)`（50 次 push/pop）后 `widgets`/`themeListeners`/`pointerTargets`/`focusables` 全部回基线                      |
| P11 | 日志             | dev 模式一次 push/pop 打印 3 行；`setDevMode(false)` 后同样操作 0 行                                                     |
| P12 | `back` 归属      | `planBack()` 的 4 条边界（Node 单测）：有模态 → `modal`；无模态且 `pageDepth>1` → `page`；`pageDepth<=1` → `app`         |
| P13 | 视图 lambda 规则 | `ui()`/`modal.open()`/`pages.push()` 共用同一条规则：0 个根 → 指名报错；1 个根 → 正常；多个根 → 包一层 Column + 开发告警 |

---

## 2. 实测（第 61 轮）

**准备**：点 `list.counter` 两次 → `clicks=2`；点 `list.field` 输入 `kept text`；`scrollList(140)` → `listOffset=140`。

```
base  { depth:1, clicks:2, field:'kept text', listOffset:140, resumes:1, disposes:0 }
```

**P2/P3/P4 推入一层**（点 `row.4`）：

```
pushed      { depth:2, names:['list','detail:4'], clicks:2, field:'kept text', listOffset:140 }
focusables  ['detail.back','detail.deeper','detail.dialog']     ← 基础页的 18 个控件全部不可聚焦
events      resume:list · pause:list · resume:detail
Tab         → detail.back                                        ← 遍历只走新页
```

**P3/P5 被盖住的那一页**：点它 `list.counter` 原来的坐标 → `clicks` 仍为 **2**；再打字 `INTRUDER` → `field` 仍为 **`kept text`**（`activeElement=BODY`）。

**P4/P6 `Esc` 弹回**：

```
events  … dispose:detail · resume:list
state   { depth:1, clicks:2, field:'kept text', listOffset:140 }
focus   row.4        ← 回到“打开详情页的那个控件”，不是第一个控件
```

**P8 模态叠在页面上**：`pages.dialog()` → 对话框取得焦点（`dialog.close`）；`Esc` 一次 → `depth` 仍是 **2**（只关掉对话框）；再 `Esc` → `depth=1`，焦点回到 `row.4`。

**P7 三层 + `popToRoot()`**：

```
threeDeep      ['list','detail:7','deeper']
afterPopToRoot { depth:1, clicks:2, field:'kept text', listOffset:140, disposes:3 }
events         … pause:detail · resume:deeper · dispose:deeper · resume:detail · dispose:detail · resume:list
```

**P9 应用级返回**：`Esc` 让输入框先回滚（`field: 'abc' → ''`）并失焦，然后**仍然**把 `back` 交给 `mvvm.onBack`（`appBacks` 0 → 1）。只剩一页时 `Esc` 不会弹空页面，只走应用级处理。

**P10 泄漏**：

```
churn(50) before { widgets: 24, themeListeners: 26, pointerTargets: 19, focusables: 18 }
          after  { widgets: 24, themeListeners: 26, pointerTargets: 19, focusables: 18 }
```

**P11 日志**：dev 模式 `pages.push(): built 6 widget(s), 2 level(s) deep` / `pages.push: detail:1 (depth 2, 6 widget(s))` / `pages.pop: detail:1 (depth 1)`；发布模式 0 行。

**P12 单测**：`packages/phaser/test/plan-back.test.ts`（4 条），另有 `focus-scope.test.ts`（15 条，第 60 轮）覆盖作用域栈。

**P13 视图 lambda 规则**（`window.pages.viewLambdaRule()` 现场跑一遍）：

```
multi  { container: 'BoxWidget', children: 2, name: 'multi-root' }
empty  'pages.push(): the content built no widget. A view needs exactly one root — wrap the content
        in Column()/Row()/Panel(), or check for an early return inside the lambda.'
告警   'pages.push(): the content built 2 root widgets; they were wrapped in a vertical Column. …'
depth  1（报错那次没有改动栈）
```

这条规则本轮从三份副本收敛成 `buildUiPage()` 一处（`ui()`、`modal.open()`、`pages.push()`），所以它值得被现场断言一次。

---

## 3. 本轮修掉的三个缺陷

都是做页面栈验收时抓到的，其中 V20 是**文档教错了**。

### V20 · 覆盖 `focus.onBack` 会静默拆掉 `back` 路由

- **现象**：指南 06/07 一直教读者 `this.mvvm.focus.onBack = …` 来接管 `Esc`。在引入模态与页面栈之后，这么做会让 `Esc` **再也关不掉对话框、也返回不了上一页**，页面上没有任何提示。
- **修法**：`back` 路由归插件所有；应用级处理改用新公开字段 **`mvvm.onBack`**（`config.onBack` 仍然可用，`focus.onBack` 作为旧写法继续被读取）。另外在开发模式下每帧做一次恒等比较：一旦发现 `focus.onBack` 被换掉就打印一条指名警告（发布模式零开销、零输出）。
- **实测**：把 `focus.onBack` 换成别的函数后，控制台立刻出现 `focus.onBack was replaced: … Use this.mvvm.onBack = …`；指南 01/06/07 的写法已全部改正。

### V21 · 页面 `pop()` 之后焦点丢失

- **现象**：`push()` 一层再 `Esc` 回来，焦点变成 `none`，而不是回到推入前那个控件。
- **根因**（两处顺序错误，缺一不可）：
  1. `push()` 里先调了 `refreshInteraction()` → `FocusManager.refresh()` 只重收集**当前顶层作用域**，而那一页恰好刚被隐藏 → 收集结果为空、焦点被丢掉；随后 `pushScope()` 想记住「下面那页的焦点」时已经没有东西可记（`suspended=null`）。
  2. `pop()` 里先 `popScope()` 再把下层的页面 `setVisible(true)`；而 `popScope()` 是靠**重新收集**下层页面的控件来还原焦点的，页面还隐藏着自然收不到。
- **修法**：`push()` 改为「先 `pushScope()`（此时下层作用域还完整）→ 再 `raiseLayers()`/`refreshInteraction()`」；`pop()` 改为「先显示下层页面并 `flushLayout()` → 再 `popScope()` → 再销毁被弹出的页」。
- **实测**：修前 `Esc` 回来后 `focus=none`；修后 `focus=row.4`（P4/P6），且隐藏页面里打字不再落入字段（P5）。

### V22 · `Escape` 在输入框里永远到不了应用

- **现象**：焦点在文本输入框里时按 `Esc`，只会回滚并失焦，`mvvm.onBack` **永远不会被调用**（`appBacks` 一直 0）。
- **根因**：输入框为了避免 Phaser 的键盘管理器处理这个键而 `preventDefault()` + `stopPropagation()`（V17 的同一段代码），于是场景插件根本看不到它；第 60 轮加的转发只在「`blur()` 被拒绝」时才做，普通页面上 `blur()` 成功 → 谁也没接管这个 `back`。
- **修法**：`Escape` **总是**在回滚 + 失焦之后把 `back` 交给 `FocusManager.handleAction()`。规则因此统一为「`Esc` 在任何位置都意味着返回：先模态、再页面、最后应用」，而输入框的「回滚 + 失焦」依然是它自己的额外动作。
- **实测**：输入 `abc` 后按 `Esc` → `field: ''`、`focus: none`、`appBacks: 1`；模态框里仍然是「一次 `Esc` 关掉对话框并回滚字段」。

---

## 4. 未覆盖 / 有意不做

- ~~**页面转场动画**~~：第 78 轮已交付，见 §5（`PageOptions.transition` + 交叉淡入淡出 + `Widget#routingEnabled` 盾牌）。
- **URL / 路由表**：`pages` 只是一叠页面，不做路径匹配（PLAN 里也写明「不做 URL 路由」）。
- **弹出最后一页**：`pop()` 在只剩顶层时返回 `false`（弹空会留下白屏），需要空栈请显式 `dispose()` 或换页。
- **触摸**：转场这一项用鼠标 + 键盘 + **CDP 触摸域**都跑过（§5 的 P11）；**软键盘已在 Android 模拟器上验过**（第 112 轮 A5，见 [`ACCEPTANCE-android.md`](./ACCEPTANCE-android.md)），但**页面转场自己的触摸路径仍只在 CDP 触摸域跑过**；物理设备未跑。
- **`mount()`/`render()` 与 `pages` 混用**：两者是并行用法，混用时的层序行为只做了「对话框抬到最上」这一条保护，未做更多约定。
- **像素门禁**：`#/pages` 没有加进 `scripts/visual-check.mjs`（它的重点是交互与状态，几何由 `#status` 里的三行 + MCP 断言覆盖）。

---

## 5. 页面转场（第 78 轮）

页面前进/后退以前是瞬间切换。现在两个方向都是**在两张都在屏幕上的页面之间做交叉淡入淡出**：推进时新页淡入、下面那页**保持像素**直到淡完才隐藏；返回时下面那页**立刻**出现、离开的那页在它上面淡出，淡完才销毁。

**关键机制**：`Widget#routingEnabled = false` —— "画着，但不是一个指针目标"。`visible: false` 是同一件事的粗暴版本（它还退出布局流、停止绘制），而转场需要的是"保留像素、只失去路由"。这一条只影响命中测试（`resolveTargetInTree` 跳过该子树）；控件**仍然留在** `InputRouter#widgets` 与无障碍镜像里，因为把它们从镜像里摘掉再建回来（每次转场两次）比"页面短暂不可点"更糟。

| #   | 判据                         | 实测                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 推进：新页淡入               | `list → detail:1` 逐帧 `topAlpha` 0.28 → 0.885 → 1（`pending` 1 → 0，约 160 ms）                                                                                                                                                                                                                      |
| P2  | 推进：下页保留像素、不接指针 | 转场期间 `motion.routing=false`（下页），淡完 `routing=true` 且 `setVisible(false)`                                                                                                                                                                                                                   |
| P3  | **点击盾牌**                 | 转场期间在下页按钮（`list.counter`，@640,250）真实点一下：`clicks` 保持 **0**（没有打到已经离开的那一页）                                                                                                                                                                                             |
| P4  | 返回：离开页淡出后销毁       | `departing=detail:2`，`departingAlpha` 0.998 → 0.828 → 0.106 → `none`；`departingRouted=false` 全程；`widgets` 31 → **25**（幽灵销毁，无泄漏）                                                                                                                                                        |
| P5  | 返回：语义立即生效           | `pop()` 当帧：`depth` 已减 1、焦点交回下页、`counts` 仍含幽灵（诚实计数：从 **UI 根**数，不是从页面栈数）                                                                                                                                                                                             |
| P6  | 几何与动效无关               | 同一次导航：动效开/关的 `#status` 矩形**逐字相同**（`list.page=@360,125 560x470` 等）                                                                                                                                                                                                                 |
| P7  | 关掉动效就是老路径           | `mvvm.configure({ transition: false })` / `prefers-reduced-motion` → 两个方向都当帧完成（`pending=0`）                                                                                                                                                                                                |
| P8  | 快速连点                     | 同一 tick 内 `open→open→pop→open`：停在 `depth 3 / detail:3`，`names=[list, detail:1, detail:3]`（被 pop 掉的 `detail:2` 不在），随后 `popToRoot` 回到干净基页（`focusables=18`、计数回基线）                                                                                                         |
| P9  | 转场期间按 `Esc`             | `depth 2 → 1`、`departing=detail:1`（一边淡出一边返回）；基页再按 `Esc` 走到应用层（`appBacks=1`）                                                                                                                                                                                                    |
| P10 | 泄漏                         | `churn(10)`（每轮 `await settle()`）：`{widgets 25, themeListeners 26, pointerTargets 19, focusables 18}` 前后一致                                                                                                                                                                                    |
| P11 | 真实输入                     | 鼠标点行 → `detail:2`（`pending=1`）；点详情页「返回」→ `depth 1` + `departing=detail:2`；**触摸**（`Input.dispatchTouchEvent`）tap 行 → `detail:1`（`pending=1`）→ 落定后 `focusables=3`/`counts 31`，tap「返回」→ `depth 1` + `departing=detail:1` → 落定后 `counts 25`/`focusables 18`/`pending 0` |

**策略**：沿用 `MVVMPluginConfig.transition`（默认进场 160 ms `outCubic`、出场 120 ms `inCubic`），逐页用 `PageOptions.transition` 覆盖（`false` = 这一页立刻出现/消失）；默认遵循 `prefers-reduced-motion`。**只动 alpha**：页面的 `x` 归布局所有（`flushLayout()` 在转场步进**之前**跑，动画写完后不会被同一帧覆盖，但下一次布局就会把它放回去），而整页缩放会朝左上角收缩——所以滑入/缩放都不做，这一点与对话框只缩放主体是同一个理由。

### 同轮修掉的缺陷（V46）

**推进的淡入还没播完就被自己 pop 掉时，刚露出来的那页会被隐藏**。`push()` 的收尾动作（"把被盖住的那页隐藏"）挂在动画结束回调上；如果用户（或 `churn()` 这种代码）在同一次 tick 里 pop，那个回调就成了**一次不再成立的移动留下的残留**，它会把 pop 刚刚显示出来的页面又隐藏掉——于是那一页的焦点作用域收集到 0 个控件，`Tab` 无处可去。实测：`open(1)` + 立刻 `pop()` 之后 `focusables 18 → 0`（而且再也不恢复）。修法：收尾回调里先判断"这一页是否仍被覆盖"（`stack` 栈顶 !== 它才隐藏），并且在 `pop()` 里显式把重新露出的页面恢复 `visible` + `routingEnabled`。修复后同一序列 `focusables` 保持 18，`churn(10)` 前后一致。

**同轮顺带修的门禁**（不是产品缺陷，但同样会骗人）：`#/router` 的 `churn(20)` 原来是同步的，转场落地后它在采样时能看到还在淡出的页面（`themeListeners` 16 → 22，看着像泄漏）。现在它也是 async + 每轮 `settle()`，并且和 `#/modal`/`#/pages` 一样**从 UI 根**数控件（从页面栈数会漏掉幽灵）。

---

## 6. 审计：转场与周边机制的交叉路径（第 80 轮）

这一轮按"审查缺陷"的目标把第 78 轮改动周边的路径逐条走了一遍。**没有发现产品缺陷**，但下面的数字让几条边界从"看起来没事"变成"量过"：

| 路径                                                    | 判据                                                                 | 实测                                                                                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages.close(handle)`（关中间一页，要连带关掉它上面的） | 只应有一个幽灵在飞；落定后计数回基线                                 | `close(handles[1])` 当帧 `depth=1`、`pending=1`、`departing=detail:1`；落定后 `{widgets 25, themeListeners 26, pointerTargets 19, focusables 18}`、`pending 0` |
| `popToRoot()` 连续弹多页                                | 每弹一页都发起出场动画，前一个必须被"快进到终态"                     | 落定后同样回基线、`focusables 18`、无残留幽灵                                                                                                                  |
| **转场进行中重启场景**                                  | 幽灵的收尾回调不能碰正在销毁的树；重启后计数与"新场景走同样导航"一致 | 重启后计数 `{31,32,23,3}`、镜像 21 个节点，与**全新场景**做同一导航完全相同；`transitions.pending = 0`；0 个 pageerror                                         |
| 转场进行中打开对话框                                    | 对话框必须仍在最上层、焦点在它里面、页面继续存在                     | `modalDepth=1`、根节点最后一个子节点是 `pages.dialog`、`focus=dialog.close`                                                                                    |
| 幽灵页在无障碍镜像里的节点                              | 淡出期间保留（它还在屏幕上），销毁后必须移除                         | 21 → 21（`departingRouted=false` 期间）→ **18**（销毁后）                                                                                                      |
| `modal.open()` 传空 lambda                              | 应当指名报错（既有契约）                                             | 抛错（`modal.open(): the content built no widget`），未影响后续操作                                                                                            |

仍然存在的**已知缺口**（不是缺陷，是缺 demo）：`Repeat` 的 `options.update` 原地更新路径在 `#/list` 上没有用（那边走的是键控重建）——**第 87 轮起 `#/options` 有它的 A/B 卡**（原地刷新 vs 销毁重建，读数 `upd.calls`/`upd.builds`，见 [`ACCEPTANCE-options.md`](./ACCEPTANCE-options.md) §7.1）。转场与它的交叉（更新一行时该行正在淡出）仍然没有被浏览器验证过。
