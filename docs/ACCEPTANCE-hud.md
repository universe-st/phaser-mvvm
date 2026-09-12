# 验收记录 · 相机钉住的 HUD 常驻场景（第 38 轮）

> 背景：ADR-0009 修好了「钉住的 UI 看得见、点不到」，但验收只存在于运行时探针里；该 ADR 的收尾清单写明「把相机钉住的 HUD 做成 `apps/examples` 里的常驻场景」。本轮补上这个场景，并顺手在其中发现、修复了一个新缺陷（V8）。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium，视口 1200×643），dev server 5173。

---

## 1. 交付物

| 产物                                                                                                 | 说明                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/examples/src/scenes/hud.ts`（`#/hud`）                                                         | 2400×1600 的滚动世界 + 相机钉住的 HUD 页；暴露 `window.hud` 与 `#demo-state`，可被脚本断言        |
| `InputRouter` 指针空间改为**按候选控件自己的** `scrollFactor` 计算（`packages/phaser/src/input.ts`） | 修复 V8：只有**根**被钉住时路由器才用屏幕坐标，钉住页面（子树的常规做法）会被自己的第二道闸门拒掉 |
| `pointerInWidgetSpace()` 纯函数 + 5 个单测                                                           | 与 `InputManager#hitTest` 的公式逐字对齐，Node 侧可回归                                           |

---

## 2. 场景内容

`#/hud` 的 HUD 页用 Compose DSL 写成，根节点调 `page.setScrollFactor(0)` 钉在相机上（**不是**钉 `this.mvvm.root`，这样才覆盖「只钉子树」这一情形）：

- 顶栏：标题、`加分`（primary）、`重置`（ghost）、`得分 N · 点击 M` 读数、弹性空隙、提示文字；
- 底栏：`TextField`（钉住的输入框）、字数读数、以及一个**空槽** `hud.lateSlot`；
- 世界：200px 网格 + `x=` 地标，加一个覆盖全世界的可交互背景矩形（`world.clicks` 计数）。

`window.hud`：`scroll(x,y)` / `scrollBy(dx,dy)` / `auto(on)` / `spawn()` / `state()` / `names()` / `rest()` / `states()` / `sf(name)` / `hitTest(name,x,y)` / `focus()` / `focusables()` / `geometry()`。
`#demo-state` 每帧发布 `cam`、`score`、`clicks`、`world.clicks`、`late.*`、`field.text`、`focus`、`over`（Phaser 自己派发到指针下的对象名）、`st.<name>`、`pt.<name>`。

---

## 3. 缺陷 V8：只钉住页面时，钉住的 UI 依然点不到

### 3.1 现象（修复前，Playwright MCP 实测）

`page.setScrollFactor(0)` + `camera.setScroll(260,140)`，指针移到 `pt.score=@167,28`：

| 观测                                                       | 读数                                         |
| ---------------------------------------------------------- | -------------------------------------------- |
| Phaser 自己的命中测试 `window.hud.hitTest('score',167,28)` | **1**（Phaser 认为点中了按钮）               |
| Phaser 派发到指针下的对象 `over`                           | `hud.scoreButton+hud.bar+hud.page+Rectangle` |
| 我们的 `visualState`：悬停                                 | `normal`（**没有** hover）                   |
| 我们的 `visualState`：按下                                 | `normal`（**没有** pressed）                 |
| 松开后 `clicks` / `score` / `focus`                        | `0` / `0` / `none`                           |
| 同一个点击里世界背景矩形                                   | `world.clicks = 1`（点击穿透到游戏世界）     |

即：**渲染正确、Phaser 命中正确、我们的第二道闸门拒绝**——正是 ADR-0009 描述的形态，只是这次钉的是页面而不是根。

### 3.2 根因

`InputRouter.pointerInUiSpace()` 用 `rootWidget.scrollFactor*` 判断坐标空间。钉住的页面是 `UIRoot` 的**子节点**，`UIRoot` 自身仍是 `1` → 路由器继续用 `pointer.worldX/Y`（屏幕坐标 + 相机偏移），与布局坐标差一个相机偏移 → `resolveTarget()` 返回 `null` → `handleDown` 首行 `if (this.resolveTarget(pointer) !== widget) return;` 直接返回。

而 Phaser 的命中测试读的是**被点中对象自己的** `scrollFactor`（`InputManager.js:905/924`），所以它命中了。两套坐标空间不一致 = ADR-0009 决策第 3 条的不变量被破坏。

### 3.3 修法

把「用哪个空间」从**根**下移到**每个候选控件**，公式与 Phaser 逐字一致：

```js
px = pointer.worldX + camera.scrollX * gameObject.scrollFactorX - camera.scrollX;
```

- 新增纯函数 `pointerInWidgetSpace(pointer, widget, fallbackCamera)`（导出，Node 可测）；
- `resolveTarget()` 在走树的每个候选上用它；`handleDown` / `handleUp` / `isClickGesture` 用**解析出来的那个控件**的空间；
- 相机取 `pointer.camera`，缺失时退回 `scene.cameras.main`；`scrollFactor` 为 `1` 时结果与旧的 `pointer.worldX/Y` 完全一致，为 `0` 时与旧的「根被钉住」分支完全一致 —— 因此这是**纯增强**，现有两种用法行为不变。

### 3.4 修复后实测（同一坐标、同一相机）

| 观测                  | 读数                                         |
| --------------------- | -------------------------------------------- |
| 悬停 `st.score`       | `hover`                                      |
| 按下 `st.score`       | `pressed`                                    |
| 松开 `clicks`/`score` | `1` / `1`                                    |
| `focus`               | `hud.scoreButton`                            |
| 相机                  | `260,140`（钉住：`pt.score` 始终 `@167,28`） |

---

## 4. 交互验收矩阵（`#/hud`，修好后）

| #   | 断言                                     | 实测                                                                                             |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | 钉住的树整体 `scrollFactor` 为 `0`       | `sf('title')=0,0`、`sf('score')=0,0`、`sf('field')=0,0`                                          |
| 2   | 相机滚动后钉住控件坐标不变               | `cam=260,140` 时 `pt.score=@167,28`，与 `cam=0,0` 时相同                                         |
| 3   | 钉住控件可悬停 / 可按下 / 可点击         | `normal → hover → pressed → hover`，`clicks=1`、`score=1`                                        |
| 4   | 点击后焦点落在该控件                     | `focus=hud.scoreButton`                                                                          |
| 5   | 钉住的输入框可聚焦并输入（相机已滚动）   | 点击 `pt.field` → `focus=hud.field`，输入 14 字符 → `note="pinned hud 打字"`                     |
| 6   | **挂载后新增**的交互控件可点击           | `spawn()` → `late1` 的 `scrollFactor=0,0`，悬停 `hover`，点击 `late.clicks=1`、`focus=hud.late1` |
| 7   | 相机可编程滚动 / 自动漂移                | `scroll(320,200)` → `cam=320,200`；`auto(true)` 0.5 s 后 `cam=462,281`                           |
| 8   | 点在世界区域（HUD 之外）仍然到达游戏对象 | `world.clicks` +1，`clicks`/`score` 不变                                                         |
| 9   | 未钉住的普通页面不受影响（回归）         | `#/states`：`hover → pressed`、`clicks=1`、`focus=button.default`                                |
| 10  | 迁移后的工厂页几何不变（回归）           | `#/showcase`：`page=@12,12 1176x619`、`nav=@24,62 232x595`、`stage=@268,62 908x595`              |

两种钉法都实测过（`window.hud.pinRoot(on)` 切换）：钉页面（场景默认）`clicks=1`、`focus=hud.scoreButton`；钉整根（指南/ADR-0009 的配方）`clicks=2`、`sf('score')=0,0`。取消钉住后（`pinRoot(false)`）在同一个 `pt.score` 上 `hitTest(...)=0`、点击不生效——此时 `pt.*` 是**布局**坐标，不再等于屏幕上看到的点（HUD 随世界滚走了）。

第 6 条对应 ADR-0009 收尾清单里的另一项：`Widget.addWidget()` 让新子树继承父节点的 `scrollFactor`，这里用**真实点击**（而不只是读 `scrollFactor`）验收。

---

## 5. 仍然存在的问题（本轮未修，已登记）

**点击穿透到游戏世界（PLAN §9 把「Panel 默认带拦截层」列为对策，实测未解决）**：下面四次点击**都**让世界的背景矩形收到 `pointerdown`：

| 点击位置                 | `world.clicks` 增量 | `clicks` 增量 |
| ------------------------ | ------------------- | ------------- |
| 顶栏空白（Panel 面板体） | 1                   | 0             |
| 底栏空白（Panel 面板体） | 1                   | 0             |
| 世界区域                 | 1                   | 0             |
| `加分` 按钮              | 1                   | 1             |

原因：`InputRouter.attach()` 为了让自己的走树逻辑决定目标，把 `scene.input.topOnly` 置为 `false`，而 Phaser 会**逐个**把事件派发给命中列表里的每个对象；路由器的「拦截层」只作用于**控件之间**，管不到 Phaser 自己的游戏对象。
可行的修法（待评估）：在路由器解析出目标的那一次事件里调用 Phaser 事件容器的 `stopPropagation()`（`InputPlugin#_eventContainer`，会置 `_eventData.cancelled` 并中断对象循环），并给 Panel 一个显式的「允许穿透」开关。风险：现在**满屏 Panel 的页面会吞掉所有世界点击**，行为变化波及所有示例场景，需要单独一轮做 A/B。

---

## 6. 门禁

| 命令                           | 结果                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `pnpm -r run typecheck`        | 5/5 通过                                                         |
| `pnpm -r run test`             | **991** 通过（layout 306 / core 278 / phaser 126 / widgets 281） |
| `pnpm exec prettier --check .` | 通过                                                             |
| `pnpm run build:examples`      | 通过                                                             |
