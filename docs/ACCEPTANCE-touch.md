# 验收记录 · 触摸（移动端）与鼠标并存（第 40 轮）

> 背景：需求新增「适配 PC 鼠标操作和移动端触碰操作」。框架的输入层一直是用鼠标验收的（`#/states` 用 `mouse.move/down/up`），触摸路径没有任何验收记录，而 `InputRouter` 里有几处明确区分鼠标与触摸的判断（`isHoverPointer`、`hoverPointer()`）。本轮补上触摸的驱动方式、状态矩阵，并修掉其中暴露的一个缺陷（V11）。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173。

---

## 1. 怎么驱动真实触摸（可复用配方）

Phaser 4 通过 `TouchManager` 监听**原生 `TouchEvent`**（`InputManager.onTouchStart/Move/End`），触摸指针是 `manager.pointers[1]`（`activePointers` 默认 1，够单指用）。因此要验收触摸必须真的产生 DOM 触摸事件——Playwright MCP 里用 CDP：

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await page.goto(url); // 必须在 goto 之前开启：Phaser 启动时按设备能力决定是否监听触摸
await page.bringToFront(); // 见 §4，否则 rAF 被节流到 1 fps
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
await touch('touchStart', [{ x, y, radiusX: 2, radiusY: 2, force: 1 }]);
await touch('touchMove', [{ x, y: y - 15, radiusX: 3, radiusY: 3, force: 1 }]); // 拖动/滑动
await touch('touchEnd', []); // 抬起：touchPoints 必须为空数组
```

诊断辅助：`#/hud` 的 `window.hud.pointers()` 同时给出鼠标指针与触摸指针的 `active`/`wasTouch`/坐标/`moveTime`/最后一次 DOM 事件类型，用来区分「触摸生效了」与「浏览器的兼容鼠标事件改动了 hover」。

---

## 2. 触摸状态矩阵（`#/hud`，相机滚动到 420,260）

| #   | 断言                               | 实测                                                          |
| --- | ---------------------------------- | ------------------------------------------------------------- |
| 1   | 触摸按下进入 `pressed`             | `st.score`：`normal → pressed`（触摸指针 `wasTouch=true`）    |
| 2   | 抬起即激活一次                     | `clicks=1`、`score=1`、`focus=hud.scoreButton`                |
| 3   | 抬起后**不残留 hover**             | 抬起 60 ms 后 `st.score=focused`（修 V11 前是 `hover`）       |
| 4   | 触摸点击后鼠标 hover 仍然正常      | 鼠标移到另一个按钮 → 该按钮 `hover`，被点的按钮保持 `focused` |
| 5   | 触摸点击后鼠标点击仍然正常         | 鼠标点 `重置` → `focus=hud.resetButton`                       |
| 6   | 钉住的输入框可触摸聚焦             | 触摸 `pt.field` → `st.field=focused`、`focus=hud.field`       |
| 7   | 触摸聚焦后可直接输入（IME/DOM 桥） | 输入 `触屏输入` → `note="触屏输入"`                           |
| 8   | 触摸滑动可滚动（不是"点中"）       | `#/scroll` 单指上滑 120 px → `v.offset: 0 → 150.48`           |
| 9   | 滑动不会误触发滑动起点下的控件     | 同一次滑动后 `v.deleted` 不变（起点附近就是列表行）           |

第 1–2 条走的是框架的触摸路径：Phaser 把触摸事件交给触摸指针，`InputRouter` 的 `pointerdown/pointerup` 与坐标解析对鼠标/触摸完全没有分支，所以按压、激活、拖拽阈值（`isClickGesture`）天然共用同一套语义。

---

## 3. 缺陷 V11：触摸点击后残留 hover（已修复）

**现象**：tap 之后被点的控件停在 `hover`。

**根因**：`InputRouter.handleUp` 为消除鼠标点击时的闪烁，**无条件**恢复 hover：

```ts
// `resetInteraction` 已清掉 hover；鼠标点击后光标仍在控件上，立刻恢复可以避免一帧闪烁
if (widget.enabled && this.resolveTarget(pointer) === widget) {
  widget.setHovered(true);
}
```

触摸没有"留在控件上的光标"：手指已离开，这个 `hover` 只会被下一帧的轮询清掉。

**修法**：新增纯函数 `keepsHoverAfterPress(pointer)`（`pointer.wasTouch !== true`），`handleUp` 只在鼠标按压后恢复 hover；带 2 个单测（`packages/phaser/test/input-order.test.ts`）。

**修后实测**（60 fps，`bringToFront()` 之后）：`pressed` → 抬起 60 ms 即 `focused`、`clicks=1`；鼠标的 hover 与激活不受影响（第 4、5 条）。

> 注意：第 39 轮曾把这个现象记成"卡住约 600 ms"。那是测量假象——当时页面 rAF 被节流到 1 fps（见 §4），"一帧"就是 1 秒。

---

## 3.5 多指（第 46 轮）

单指能跑通并不等于多指正确：`ScrollView` 与 `Slider` 都靠**场景级**指针流维持拖动（`ScrollView` 拖内容/滚动条，`Slider` 允许把手滑出控件），而事件处理函数此前不看 `pointer.id`——第二根手指一动，第一根手指抓住的控件就跟着动。示例页也因为 `activePointers` 默认为 1 而从未暴露这一点。

**配置**：`apps/examples/src/main.ts` 现在传 `input: { activePointers: 2 }`（Phaser 分配 2 个触摸指针，加上鼠标共 3 个；`window.hud.pointers().pointerCount` 实测 **3**）。

**驱动方式**：CDP 的 `Input.dispatchTouchEvent` 一次可带多个触点，每个触点有自己的 `id`（`touchStart`/`touchMove` 要带上**当前所有**活跃触点，`touchEnd` 只带抬起的那个）：

```js
await touch('touchStart', [
  { x: 320, y: 320, id: 1, radiusX: 5, radiusY: 5, force: 1 },
  { x: 700, y: 300, id: 2, radiusX: 5, radiusY: 5, force: 1 },
]);
await touch('touchMove', [
  { x: 320, y: 284, id: 1, radiusX: 5, radiusY: 5, force: 1 }, // 第一根手指不动
  { x: 700, y: 280, id: 2, radiusX: 5, radiusY: 5, force: 1 }, // 第二根手指移动
]);
await touch('touchEnd', [{ x: 320, y: 284, id: 1, radiusX: 5, radiusY: 5, force: 1 }]); // 只抬起 1
```

**实测矩阵**：

| #   | 断言                                   | 实测                                                            |
| --- | -------------------------------------- | --------------------------------------------------------------- |
| 1   | 两根手指同时按下两个不同按钮           | 两个按钮**同时** `pressed`                                      |
| 2   | 抬起其中一根手指只激活它自己的按钮     | `clicks +1`，另一个按钮**仍是** `pressed`（等待自己的手指抬起） |
| 3   | 另一根手指抬起时才激活它自己的按钮     | 开关翻到 `true`                                                 |
| 4   | 一根手指拖滑杆，另一指在别处按下并移动 | 滑杆值 **28 → 28**（不受第二指影响）                            |
| 5   | 一根手指拖列表，另一指移动 100px       | `v.offset` **36 → 36**（不受第二指影响）                        |

第 1–3 条来自 `InputRouter`：`pressedAt` 以**指针**为键（`handlePointerUp` 只处理自己那根指针的按下），因此多指按压天然互不干扰。第 4–5 条是第 46 轮修掉的 V12。

### 3.6 双指捏合缩放（第 55 轮）

`ScrollView` 现在支持 `zoom: true | { min, max }`（默认关闭）：两指距离决定缩放比，**两指中点是锚点**，缩放只对内容 holder 做 `setScale`（不触发布局）。纯触摸序列实测：

| #   | 步骤                     | 实测                                                                                   |
| --- | ------------------------ | -------------------------------------------------------------------------------------- |
| 1   | 缩放前单指拖动           | `nested.offset` 0 → **87**                                                             |
| 2   | 双指捏开（40 → 80 半距） | `zoom` 1 → **2.0**，offset 337（锚点保持在手指之间）                                   |
| 3   | 捏合结束后单指拖动       | 337 → **430**（拖动恢复正常 ← 本轮修的 V15）                                           |
| 4   | 双指捏拢（90 → 30 半距） | `zoom` 2 → **0.67**（下限外被夹到 0.5 与 2.5 之间）                                    |
| 5   | 再次单指拖动             | 37 → **127**                                                                           |
| 6   | 可滚动范围随缩放变化     | 内容 1276px、视口 300px：scale 0.75 → `maxOffset = 657`（= 1276×0.75−300，逐像素吻合） |

鼠标路径：`scrollDemo.setZoom(99)` → **2.5**（上限夹取）、`setZoom(0.01)` → **0.5**、`setZoom(1)` → **1**。

> **验收脚本注意**：不要在同一次运行里混用 `page.mouse` 与触摸模拟——Chromium 会把鼠标事件也转成触摸，于是同一次手势出现**两个**指针（按下是触摸 id 2、移动是鼠标 id 0），「拖动属于按下它的指针」这条检查会（正确地）拒绝它。第 55 轮第一版测试就是被这个假象误导过一次；纯触摸序列才是有效验收。

**仍未实现**：双指**旋转**（rotate）、双指滚动的独立语义、以及惯性缩放（松手后的回弹/吸附）。虚拟化列表**不支持**缩放（需要把 `itemExtent` 也按比例映射），同时配置时会 `warn` 一次并忽略手势。

## 3.7 模态对话框与页面栈（第 62 轮）

第 60/61 轮新增的 `this.mvvm.modal` 与 `this.mvvm.pages` 一开始只用鼠标 + 键盘验收过，本轮补触摸矩阵。驱动配方同 §1（CDP `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`，一次手势只用一个指针，全程不混用鼠标）。

### 3.7.1 `#/modal`

| 操作                            | 结果                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| 点（tap）页面按钮打开对话框     | `depth=1`、`focus=confirm.cancel`                             |
| 点对话框里的「删除」            | `deletes=1`、`note` 更新、按 `api` 关闭、焦点回到页面按钮     |
| **点遮罩**                      | 按 `backdrop` 关闭（`reasons=[…,'backdrop']`）                |
| **在遮罩上拖 120px 后抬手**     | **不关闭**（`depth` 仍为 1）：拖动不是点击（`dragThreshold`） |
| **从「删除」按钮上向下拖 80px** | **不激活**（`deletes` 不变、对话框仍在）                      |
| 不可关闭的对话框：点遮罩        | 无效（`depth` 仍为 1）；只有它自己的按钮能关（`api`）         |

`touchStart → touchEnd` 的 tap 会正常触发 `onActivate`，因此「点遮罩关闭」这条在触摸上与鼠标一致；而拖动被 `InputRouter` 的点击判定挡掉，所以"手指在遮罩上滑一下就把对话框关掉"不会发生。

### 3.7.2 `#/pages`

| 操作                               | 结果                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| **在列表行上触摸拖动 120px**       | 列表滚动（`offset 0 → 156`）且**没有推入页面**（`depth` 仍为 1）                          |
| 点一行                             | `depth=2`、`names=[list,detail:4]`                                                        |
| 点「返回列表」                     | `depth=1`、焦点回到 `row.4`、列表偏移与输入内容保留                                       |
| 从详情页点「打开对话框」，再点遮罩 | 对话框关闭、**页面仍在**（`depth` 仍为 2）                                                |
| 点计数器 / 点输入框                | `clicks` +1、`st.clicks=focused`（**不残留 hover**）；`activeElement=INPUT`，打字进入模型 |

### 3.7.3 多指与状态残留

- **两指分别按住「行」与「计数器」，再依次抬手**：`depth` 1→2（行被点中）、`clicks` 1→2（计数器被点中）。每个指针各自完成自己那次按压，没有互相取消、也没有重复触发（`InputRouter.pressedAt` 按指针归属）。
- **触摸点击后不残留 hover**（V11 的回归检查，在第 61 轮的两个新场景上重做）：点完后 `st.clicks=focused`，同屏其他控件的 `st.*` 仍是 `normal`。
- 顺带改掉一个**验收陷阱**：`#/modal` 与 `#/pages` 现在对已销毁的控件发布 `st.<key>=gone`。此前对话框关掉后 `st.confirm.ok` 会**停在最后一帧的 `pressed`**，读起来像是「卡住了」。

模态与页面栈的触摸路径与鼠标共用同一套命中区与 `onActivate`，实测行为一致。不过这一轮的"点一下再拖一下"暴露了**两个与输入设备无关的旧缺陷**，都在同一轮修掉并复测：

- **V23（裁剪容器也要裁剪命中）**：被 `ScrollView` 遮罩裁掉的内容在它的逻辑位置上仍然可悬停、可点击。`#/pages` 实测：视口 y 359..527，鼠标放在 y=671（那里什么都看不见）时 `st.row.8=hover`，点一下直接推进了 `detail:8`。
- **V24（拖动归属必须释放）**：在滚动区里**点一下**（没有移动过）会让这个滚动区**永久拖不动**——`dragPointerId` 在 `endDrag()` 里从不清理，而 `onPointerDown` 的归属检查会拒绝之后所有按下。`#/scroll` 实测：点一次 `vrowdelete` 后鼠标与触摸都拖不动，直到场景重启。

两者的复测都在本节同一套触摸/鼠标手势下完成：`#/pages` 里视口外不再有 hover 与点击、视口内照旧；`#/scroll` 里"点一次行内按钮 → 拖动"仍然有效（`v.owner` 空闲为 `none`，见 `scrollDemo.owners()`）。

---

## 4. 方法论：Playwright MCP 的页面默认被节流到 1 fps（必须先 `bringToFront()`）

本轮最重要的环境发现，直接推翻了此前的一个"缺陷"（V10，已撤销）：

| 测量                       | 12 帧的间隔（ms）                                  |
| -------------------------- | -------------------------------------------------- |
| 直接测（页面未置前）       | `808, 1017, 1000, 1017, 1000, 1000, 1015, 1000, …` |
| `page.bringToFront()` 之后 | `12, 17, 17, 17, 17, 16, 16, 19, 15, 19, 15, 19`   |

被节流时 `document.visibilityState` **仍报 `'visible'`**、`document.hidden === false`、`hasFocus() === true`，所以从页面里看不出任何异常。影响面：

- 任何帧率/耗时结论都会与 1 s 的节流周期混在一起（第 39 轮的"滚动卡住 1.6 s"就是这么来的）；
- `#demo-state` 由场景 `update()` 写入，被节流时看起来"落后约 1 秒"（第 39 轮据此写过一条验收注意事项，现已改写成"先 `bringToFront()`"）。

**规矩**：与帧率、耗时、"多久之后状态才变"有关的断言，一律先 `page.bringToFront()`；需要精确读实时值时优先读场景 API（`window.scrollDemo.offsets()`、`window.hud.state()`），而不是 DOM 文本。

---

## 5. 未做 / 待办

- ~~**多指手势**~~：**多指输入**已在第 46 轮验收（见 §3.5：`activePointers: 2` + 每个指针拥有自己的拖动/按压）；**pinch 缩放已在第 55 轮交付**（`ScrollView` 的 `zoom: true | { min, max }`，实测见本文 §3.6 与 `#/scroll` 的 `scroll.nested` 口）；**rotate（双指旋转）仍未实现**。
- **真实移动端浏览器**（iOS Safari 的兼容鼠标事件行为、`touch-action` 与页面滚动）：只在桌面 Chromium 的触摸模拟下验收过；`ScrollView` 的 `preventDefault` 行为（backlog V3）在真机上更敏感。第 62 轮的模态/页面栈矩阵同样是**模拟触摸**，未上真机。
- **软键盘弹出导致的视口变化**：`Scale.RESIZE` 下的布局重排未在移动端模拟中验证。
