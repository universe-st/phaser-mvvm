# 验收记录 · 生命周期泄漏门禁 + 重启可用性（第 3 轮）

> 目的：补上审计指出的**覆盖率缺口**——仓库此前没有任何自动化门禁检查「场景创建→销毁 100 次后计数归零」，Node 单测只覆盖纯函数、示例场景从不销毁自己。本轮先把门禁建起来（`#/lifecycle` + Playwright MCP），再用它检验框架——结果门禁第一次运行就抓到了一个**严重缺陷**。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server `http://localhost:5173`。
> 结论：**新门禁发现并修复了「场景重启后 UI 泵失效 + 整棵 UI 树泄漏」的 HIGH 缺陷；门禁现已全绿（101 个周期，8 项计数完全不变，且重启后的场景仍可点击、可输入）。另外确认并修复了 W4（虚拟列表内容长度混用视口）。**

---

## 1. 新门禁：`#/lifecycle`

场景 `apps/examples/src/scenes/lifecycle.ts` 建一页包含**全部控件与容器**的界面（Label / Button ×5 / Image / Spacer / Divider / Panel / Grid / Stack / Column / Row / TextField / TextArea / 虚拟化 List 套 `Scroll`），然后用 `scene.restart()` 反复重跑 `create()`，每轮采样 8 项泄漏指标：

| 指标                           | 来源                               | 含义                                               |
| ------------------------------ | ---------------------------------- | -------------------------------------------------- |
| `themeListeners`               | `themeListenerCount()`             | 主题订阅必须随控件销毁归还                         |
| `displayList` / `sceneObjects` | `scene.children`                   | 场景显示列表不得累积对象                           |
| `focusables`                   | `mvvm.focus.focusables.length`     | 焦点管理器不得留住已销毁控件                       |
| `pointerTargets`               | `mvvm.input.widgets.length`        | 输入路由不得留住已销毁控件                         |
| `textures`                     | `textures.getTextureKeys().length` | 不得每轮新建纹理（文本各自持有一张）               |
| `tweens` / `timers`            | `tweens` / `Clock#_active`         | 光标闪烁等定时器不得逃逸                           |
| `widgets`                      | 页面子树节点数                     | 每轮必须建出同样规模的树                           |
| `frameListeners`（第 97 轮加） | `scene.events.listenerCount(...)`  | 逐帧钩子（滚动滑行、文本拖到边缘自动滚动）必须注销 |

页面暴露 `window.lifecycle`：`churn(n)`（异步重启 n 次，每轮等首帧后采样）、`samples()`、`pages()`（每个页面是否已销毁）、`themeListeners()`、`state()`；`#status` 每轮追加一行 `lifecycle#N theme=… list=… focus=… pointer=… tex=… tweens=… timers=… widgets=…`，`#demo-state` 里另有 `pt.click` / `pt.name` 供点击与输入。

> 采样点选在 `create()` 之后**第二帧**：第一帧里虚拟化列表还没挂载行、输入/焦点集合也还没刷新，而且游戏首次 boot 与 `restart()` 的内部步骤数不同——早采样会让基线不可比。

---

## 2. 门禁第一次运行就抓到 HIGH 缺陷：重启后的场景既「死」又「漏」

### 2.1 现象（修复前，实测）

`churn(100)` 后的漂移（首轮 → 末轮）：

| 指标             | 修复前                     | 期望         |
| ---------------- | -------------------------- | ------------ |
| `themeListeners` | 40 → **3781**（每轮 +37）  | 恒定         |
| `pointerTargets` | 13 → **1287**（每轮 +13）  | 恒定         |
| `textures`       | 23 → **2185**（每轮 +21）  | 恒定         |
| `pages()`        | 最新的两三轮页面仍 `ALIVE` | 只应剩当前页 |

### 2.2 根因

`MVVMPlugin.boot()` 用 `events.once(SHUTDOWN/DESTROY, …)` 注册拆解回调，而 **Phaser 每个场景只调用一次 `boot()`**；`dispose()` 又把 `PRE_UPDATE`/`SHUTDOWN`/`DESTROY` 三个监听全部 `off` 掉。于是：

1. 第一次 SHUTDOWN 之后插件与场景事件彻底断开；
2. `scene.restart()` 只重跑 `create()`，不会重跑 `boot()` → 后续每次关闭都**不拆解**：整棵 UI 树（主题订阅、指针目标、每个文本一张纹理）留下，每轮泄漏一棵；
3. 同时 `PRE_UPDATE` 也永远不再触发 → 重启后的场景**没有帧刷新、没有布局、没有输入路由**（UI 是死的）。

第二点用浏览器内的对照实验确认：手动 `scene.mvvm.root.destroy(true)` 能让 `themeListenerCount()` 从 58 立刻回到 1，说明销毁路径本身正确——问题在于重启后它再也不会被调用。

### 2.3 修法（`packages/phaser/src/plugin.ts`）

- `boot()` 改用持久订阅：`events.on(PRE_UPDATE/SHUTDOWN/DESTROY, …)`（不再是 `once`）。
- `dispose()` 只拆 UI（root/router/focus/键盘/主题），**不再**退订场景事件；新增 `detachEvents()` 仅供插件自身的 `destroy()` 调用。

### 2.4 修复后（同一门禁，同一操作）

| 指标                           | 101 个周期的取值集合 |
| ------------------------------ | -------------------- |
| `themeListeners`               | `[58]`               |
| `displayList` / `sceneObjects` | `[1]` / `[1]`        |
| `focusables`                   | `[7]`                |
| `pointerTargets`               | `[13]`               |
| `textures`                     | `[29]`               |
| `tweens` / `timers`            | `[0]` / `[0]`        |
| `widgets`                      | `[56]`               |
| `pages()` 存活数               | 1（仅当前页）        |

并且证明重启后的场景是**活的**（不只是不泄漏）：

| 检查                                            | 结果                                                        |
| ----------------------------------------------- | ----------------------------------------------------------- |
| 重启 100 次后 `#status` 有 `page=@0,0 1200x643` | 布局泵在跑                                                  |
| 按 `pt.click` 点击按钮                          | `state().clicks` 从 0 → 1                                   |
| 点击 `pt.name` 输入 `restart ok`                | `state().name === 'restart ok'`（双向绑定与输入路由都活着） |
| 控制台                                          | 无 `ERROR`/`REJECTION`；101 轮耗时 1.68 s（每轮 ~17 ms）    |

---

## 3. W4：虚拟列表的内容长度混用了两个视口（已确认并修复）

审计把这条标为「疑似，未证实」：`ScrollView.measureContentExtent()` 对虚拟目标用 `height = target.maxOffset + 本端口视口高`，而 `target.maxOffset = 列表真实长度 − 列表自己的视口高`。两者只有在「列表自身高度 == 端口视口高」时才相等。

**复现（`#/showcase` → `repeat`，运行时把列表自身高度改成 100，端口视口 200）**：

| 读数                                                           | 值                              |
| -------------------------------------------------------------- | ------------------------------- |
| 列表真实长度 `contentExtent`                                   | 5198                            |
| 列表自己的 `maxOffset`（5198 − 100）                           | 5098                            |
| 端口视口                                                       | 200                             |
| 修复前端口会得到的 limit（= 旧公式 `maxOffset + 视口 − 视口`） | **5098**（可多滚 100px 到空白） |
| 正确 limit（5198 − 200）                                       | **4998**                        |

**修法**：`VirtualScrollTarget` 增加 `contentExtent`（列表真实长度，与任何视口无关，来自新的纯函数 `contentExtentOf(itemCount, itemExtent, gap)`），`measureContentExtent()` 直接用它，非有限值才回退旧公式。

**修复后实测**：同一场景把列表高度改成 100 或 400，端口 `maxOffset` 始终是 4998，`contentExtent` 恒为 5198；滚到底后挂载的最后两行是 `row-199`/`row-200`（末行可达）。

同时修正了 `#/compose` 的 `list` 演示：虚拟化 `List` 此前没有滚动驱动（外面没套 `Scroll`，只能看到静态的前 12 行）。现在改为 `Scroll{height:260} → List{height:'fill', virtualize}`，实测：

| 检查                                           | 结果                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| 初始                                           | 200 行、挂载 12 行、`maxOffset=6536`                |
| `contentExtent` 与 `maxOffset + viewport` 一致 | `6796 = 6536 + 260` ✓                               |
| 滚到底                                         | `offset=6536=maxOffset`，挂载 `row-199`/`row-200` ✓ |
| **真实滚轮**（`page.mouse.wheel` 在视口内）    | 6536 → 5736 ✓                                       |

---

## 3.5 追加：DSL 反应式外观槽位（Compose 手感的补齐）

`@phaser-mvvm/widgets/compose` 的槽位此前只有「数据」是反应式的（文本、输入框 value），外观只能写死——这在实际写界面时立刻会撞上（本轮第 1 轮就在示例里试过 `tone: () => …` 然后不得不删掉）。现在补齐：

| 槽位                               | 控件                | 语义                                                                             |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `tone`                             | `Text`              | `Ref`/getter → `Label.setTone()`，按帧重绘                                       |
| `variant` / `disabled` / `loading` | `Button`            | → `setVariant`/`setDisabled`/`setLoading`                                        |
| `visible`                          | **所有 composable** | → `setVisible()`；隐藏即退出布局流（`inFlow === visible`），等价 Compose 的 `if` |

实现：常量仍走构造参数（零额外开销），只有 `Ref`/getter 才建立帧对齐绑定（`bindValue` + `bindOption`）。`#/compose` 的 `text` 分区新增一段实时演示（按钮同时切换自身 `variant`、标签 `tone` 与一个节点的 `visible`），Playwright 实测：

| 状态     | `state().highlighted` | `tone`      | 按钮 `variant` | 隐藏节点 `visible`/`inFlow` | 其下方分隔线的 y |
| -------- | --------------------- | ----------- | -------------- | --------------------------- | ---------------- |
| 初始     | false                 | muted       | ghost          | false / false               | 34               |
| 点一次   | true                  | **success** | **primary**    | **true / true**             | **58**           |
| 再点一次 | false                 | muted       | ghost          | false / false               | 34               |

分隔线在显示/隐藏之间移动 24px（= 18px 文本高 + 6px 间距），证明「隐藏」是真的把它移出了布局流，而不是仅仅不可见。

---

## 4. 已运行的命令与结果

| 命令                           | 结果                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run typecheck`        | 5/5 包通过                                                                                                             |
| `pnpm -r run test`             | **966 passed**：core 274、layout 298、phaser 116、widgets 278（新增 `contentExtentOf` 3 例）                           |
| `pnpm exec prettier --check .` | 通过                                                                                                                   |
| `pnpm run build:examples`      | 通过                                                                                                                   |
| Playwright MCP `#/lifecycle`   | 101 轮 churn：8 项计数恒定、仅 1 页存活、点击与输入正常                                                                |
| Playwright MCP 全场景回归      | `#/compose`（10 分区切换 + parity=ok）、`#/showcase`、`#/list`、`#/scroll`、`#/form`、`#/bindings`、`#/m0` 全部 0 错误 |

---

## 5. 未验证 / 边界

1. 门禁依赖 `scene.restart()`；**没有**覆盖 `scene.stop()/start()`、多场景同时挂 UI、以及场景被 `SceneManager.remove()` 的路径。
2. `textures` 计数在 Node 侧无法断言（需要渲染器），只有浏览器门禁覆盖。
3. `tweens`/`timers` 恒为 0，是因为本轮页面里没有聚焦的输入框（光标闪烁定时器只在聚焦时存在）；「聚焦后重启是否留下定时器」尚未实测。
4. 本轮未复跑 `node scripts/visual-check.mjs`。注意脚本现在的硬编码场景是 **13 个**（`m0`/`probe`/`stack`/`hud`/`modal`/`uiscene`/`a11y`/`compose`/`options`/`keyboard`/`showcase`/`pages`/`events`），**`#/lifecycle` 至今不在里面**——本页的泄漏门禁仍然只由 `window.lifecycle.churn()` 的读数承担。

---

## 5.5 追加：第 97 轮的第九项计数 `frameListeners`（并做了阳性对照）

给 `TextInputBase` 加"拖到框外逐帧自动滚动"时用的是 `scene.events.on(POST_UPDATE, …)`——**逐帧监听是新的泄漏面**：忘一次 `off()`，场景重启后那个闭包还在跑，并把整个控件拖着不放。而原有的八项计数**全都看不见它**（显示列表、焦点集合、输入路由都会正常放开被销毁的控件；实测把 `off()` 注释掉，其余八项依旧恒定）。

所以本轮给 `#/lifecycle` 补了第九项：`frameListeners` = `preupdate`/`update`/`postupdate` 三个事件在场景 `EventEmitter` 上的监听者总数（`scene.events.listenerCount(event)`），逐帧写进 `#demo-state` 与 `#status` 的 `frame=`。

| 检查                                                                      | 结果                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常运行 `churn(20)`                                                      | `frameListeners` 恒为 **11**，其余八项与 `distinctRows = 1` 一致 ✓                                                                                      |
| **阳性对照**：注释掉 `TextInputBase.destroy()` 里的 `off(POST_UPDATE, …)` | `11 → 13 → 15 → 17 → 19 → 21 → 23`（每轮 **+2**，两个 Canvas 字段各漏一个），而 `themeListeners`/`widgets`/`focusables`/`pointerTargets` 全部照旧恒定 ✓ |
| 恢复 `off()`                                                              | 回到恒 11 ✓                                                                                                                                             |

也就是说这一项**能失败**、失败时指名的正是新加的那条逐帧路径。

---

## 6. 提交

- 提交信息：`fix(phaser,widgets): keep the scene plugin subscribed across restarts, and size virtual content by its own length`（正文含门禁数据与 W4 复现表）。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples` 全绿。

---

## 6. 第 110 轮追加：三条"从未跑过的生命周期路径"

DEFECT-BACKLOG §4 一直挂着三条覆盖缺口，本轮的判定标准都是**同一件事**：让门禁先失败一次（阳性对照），再确认它绿。

### 6.1 Node 侧假渲染器夹具（`packages/phaser/test/support/fake-renderer.ts`）

`Widget` 继承 `Phaser.GameObjects.Container`，而 Node 里 `import Phaser` 直接抛 `window is not defined` —— 所以 `Widget` 这一侧的行为（事件表、拆卸、焦点管线）此前**一条单测都没有**，只能在浏览器里看。夹具只做两件事：`installDomStub()` 定义 Phaser 模块初始化会碰的全局量（画布的 2D context 用宽容 `Proxy`，因为特性探测会 `getImageData()` 再往结果写 `fillStyle`），`createFakeScene()` 给出 `GameObject` 需要的场景面（显示列表、事件、带 `addEvent`/`delayedCall` 的时钟、相机）。

**顺序是硬约束**：必须在 `import` Phaser **之前**装桩，而 ESM 的静态 import 会提升——所以消费者（`test/widget-events.test.ts`）先 `installDomStub()`，再 `await import('../src/Widget')`。夹具模块自己不 import Phaser。

| 用例                  | 断言                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| 成对、各一次          | `first.focus()` → 只有 `first:focus`；`second.focus()` → 再加 `first:blur`, `second:focus`（旧持有者先被告知） |
| 重复不发              | 连调两次 `focus()` 只发 1 个事件；`blur()` 两次同理                                                            |
| 销毁不发 blur         | `widget.focus()` 后 `destroy()` → `blur` 计数 **0**（`destroy()` 直接清标志位）                                |
| 离开可聚焦集合要 blur | `setVisible(false)` + `manager.refresh()` → 发一次 `blur` 且 `focusedWidget === null`                          |

`pnpm --filter @phaser-mvvm/phaser run test`：**374** 通过（24 个文件；此前 370）。

### 6.2 聚焦着文本框重启：不留光标闪烁定时器

光标闪烁是 `clock.addEvent({ delay, loop: true })` —— 一个挂在**场景**时钟上的 `TimerEvent`，以及一个 `window` 级 keydown 守卫；两者都在字段自己的子树之外。`#/lifecycle` 新增 `focusField()`（把焦点放进 `name` 字段）与 `churnFocused(n)`（带着这个状态重启、每轮采样 10 项）。

| 阶段                                 | 读数                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 聚焦之后（`fieldProbe()`）           | `{ focused: 'name', timers: 1, frameListeners: 11 }` → 闪烁定时器**真的存在**，探针不是空转                                          |
| `churnFocused(3)` 三次重启后的每一轮 | `themeListeners 59 / displayList 1 / focusables 8 / pointerTargets 14 / timers **0** / widgets 57 / frameListeners 11 / textures 29` |
| 结束后                               | `fieldProbe()` → `{ focused: 'none', timers: 0, frameListeners: 11 }`                                                                |

三项与基线逐项相同，`timers` 回到 0：**没有**留下定时器（阳性对照是"注释掉 `stopBlink()`"——那会让每轮多 1 个，与第 97 轮 `frameListeners` 的对照同型）。

### 6.3 多场景：`add → launch → stop → SceneManager.remove()`

`churnScenes(n)` 走完四个阶段并在**三个阶段之间**采样（`during`/`after`/`removed`），因为 `stop()` 与 `remove()` 是 Phaser 两条不同的拆卸路径：前者触发 `SHUTDOWN`（场景对象还活着、还能再 `start()`），后者接着触发 `DESTROY` 并把它从管理器里摘掉。

| 读数                                                                | rounds 1–3                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| `activeScenes`（伴生场景在运行时）                                  | 2（**并存**已验）                                    |
| `during.themeListeners`                                             | **66**（伴生页 4 个控件带来的 7 个订阅在）           |
| `after.themeListeners`                                              | **59** ＝ 基线（`scene.stop()` 已把它拆干净）        |
| `removed.themeListeners`                                            | 59（`remove()` 不再改变任何计数）                    |
| 本页其余 9 项（`widgets`/`focusables`/`pointerTargets`/`timers`/…） | 全程 57 / 8 / 14 / 0 / …，三轮不变                   |
| `companionDestroyed`                                                | `true`（`stop()` 之后伴生页 `isDestroyed === true`） |
| `companionPages()`                                                  | 3 个伴生页全部 `destroyed: true`                     |
| `#status`                                                           | 无 `ERROR:`/`REJECTION:` 行                          |

`#demo-state` 另发 `scenes.round` / `scenes.builds` / `scenes.active`（实测 `3 / 3 / 1`），`window.lifecycle.sceneRounds()` 给出三阶段的完整样本。

**未覆盖**：`scene.pause()/resume()`（本框架的 UI 不因暂停而拆卸，所以它不属于"泄漏"面）、以及两个**同时**带 UI 的场景各自 `churn()`（本轮只让伴生场景整体进出，没有让它也重启）。
