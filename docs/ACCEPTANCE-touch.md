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

- **多指手势**（双指缩放、双指滚动）：Phaser 需要 `input.activePointers > 1`（默认 1），框架层也还没有手势语义（pinch/rotate），本轮未触碰。
- **真实移动端浏览器**（iOS Safari 的兼容鼠标事件行为、`touch-action` 与页面滚动）：只在桌面 Chromium 的触摸模拟下验收过；`ScrollView` 的 `preventDefault` 行为（backlog V3）在真机上更敏感。
- **软键盘弹出导致的视口变化**：`Scale.RESIZE` 下的布局重排未在移动端模拟中验证。
