# 验收记录 · 相机钉住的 UI 可点击（V1，第 32–34 轮）

> 背景：指南给「在滚动画面上放 HUD」的配方是 `this.mvvm.root.setScrollFactor(0)`，但这个配方长期只做对一半——相机一滚动，钉住的 UI **看得见、点不到**。缺陷自第 1 轮审计登记为「疑似」，第 11 轮复现，第 27–31 轮三次实测定位，第 32 轮修复并验收。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173。

---

## 1. 结论

**已修复并验收通过。** 失败是**两道闸门叠加**，单独修任何一半都无效（第 11、28 轮各自实现并实测后回滚）：

1. **Phaser 的命中测试**：`InputManager.js:905` 用 `camera.getWorldPoint(pointer.position)` 覆盖 `pointer.worldX/Y`，`:924` 再按**被点中那个对象自己的** `scrollFactor` 还原（`px = worldX + scrollX * obj.scrollFactorX - scrollX`）。只钉根时叶子仍是 1 → 与随后 `getWorldTransformMatrix()` 的逆变换差一个相机偏移。
2. **我们自己的二次校验**：`InputRouter.handleDown` 首行 `if (this.resolveTarget(pointer) !== widget) return;`，而 `resolveTarget` 用 `pointer.worldX/Y`（屏幕坐标 + 相机偏移）与布局坐标比较，钉住时永不相等。

修法（两部分一起）：`Widget.setScrollFactor()` 沿控件树向下传播（`setScrollFactorAll()` 为显式形式）；`InputRouter` 的所有指针读取统一走 `pointerInUiSpace()`——根被钉住时用 `pointer.x/y`，`resolveTarget`、按下起点与 `isClickGesture` 共用同一空间。决策与后果见 [ADR-0009](./adr/0009-camera-pinned-ui-and-input.md)。

---

## 2. 实测证据（Playwright MCP，`#/states`）

### 2.1 定位阶段：直接调 Phaser 的命中测试

对同一个按钮调 `manager.hitTest(pointer, [button], camera)`（今天可以在页面里复现：`window.hud.hitTest(name, x, y)` 返回同一个 `hits.length`，配合 `hud.pinRoot(on)` / `hud.scroll(x, y)` 摆状态）：

| 状态                        | `hitTest` 命中数 |
| --------------------------- | ---------------- |
| 相机未滚动                  | **1**            |
| 只钉根 + 相机滚动 (260,140) | **0**            |
| **整棵树都钉 + 相机滚动**   | **1**            |

即：命中测试本身能过，前提是**整棵树**都是 `scrollFactor 0`；但过了它之后还有我们那道二次校验。

### 2.2 修复后：真实点击

| 场景                                                                                                                   | 结果                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 根被钉住（`setScrollFactor(0)` 传播后按钮 `scrollFactor = [0,0]`）+ 相机 `scrollX/Y = 260/140`，点击按钮在屏幕上的位置 | **`clicks = 1`**、焦点落在 `button.default`（修复前为 0 / null） |
| 普通页面（未钉住、相机在 0）同样点击                                                                                   | **`clicks = 1`**、焦点落在 `button.default`（无回归）            |
| 控制台                                                                                                                 | 无 `ERROR`/`REJECTION`                                           |

### 2.3 门禁

| 命令                           | 结果                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `pnpm -r run test`             | **986 passed**（core 278、layout 306、phaser 121、widgets 281） |
| `pnpm -r run typecheck`        | 5/5 包通过                                                      |
| `pnpm exec prettier --check .` | 通过                                                            |

---

## 3. 交付物

| 文件                                          | 内容                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/phaser/src/Widget.ts`               | `setScrollFactor()` 向下传播 + `setScrollFactorAll()`                        |
| `packages/phaser/src/input.ts`                | `pointerInUiSpace()`，`resolveTarget`/`handleDown`/`handleUp` 统一使用       |
| `docs/adr/0009-camera-pinned-ui-and-input.md` | 约束、决策、后果（含新不变量：路由器与 Phaser 命中测试必须同处一个坐标空间） |
| `docs/guide/01-quick-start.md`                | HUD 配方说明传播行为并链接 ADR                                               |
| `docs/DEFECT-BACKLOG.md` §V1                  | 三轮实验的原始读数与已回滚的中间尝试                                         |

提交：`fix(phaser): make a camera-pinned UI clickable (V1)`（`b4fdfaf`）、ADR（`07f1b57`）、指南（`5e37d74`）。

---

## 4. 未做 / 后续

1. ~~**常驻演示场景**：仓库里还没有「相机钉住的 HUD」场景~~ **已交付**：`#/hud`（`apps/examples/src/scenes/hud.ts`：2400×1600 滚动世界 + 钉住的 HUD 页 + `pt.*` 发布 + `window.hud` 探针），并且是 `scripts/visual-check.mjs` 的场景之一（像素 + `CANVAS_CLEAR_AT`）；矩阵见 [`ACCEPTANCE-hud.md`](./ACCEPTANCE-hud.md)。
2. ~~**`addWidget` 继承根 scrollFactor**~~ **已实现**：`Widget.addWidget()` 在父节点已被钉住（`scrollFactor !== 1`）时对新子树调 `setScrollFactorAll(...)`，所以钉住之后新增的控件自动跟着钉住（`packages/phaser/src/Widget.ts`）。
3. ~~**触摸**：本轮的点击都来自鼠标事件~~ **已补**：`#/hud` 的 `window.hud.pointers()` 分开读触摸指针与兼容鼠标事件，矩阵见 [`ACCEPTANCE-hud.md`](./ACCEPTANCE-hud.md)。真机触摸仍未跑。
