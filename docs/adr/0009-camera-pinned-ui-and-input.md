# ADR-0009：相机钉住的 UI 与指针命中（两套坐标必须一致）

- **状态**：已接受（2026-09）
- **相关**：ADR-0007（Phaser 4 WebGL 约束）、`packages/phaser/src/input.ts`、`packages/phaser/src/Widget.ts`

## 背景

指南给「在滚动的游戏画面上放 HUD」的配方是 `this.mvvm.root.setScrollFactor(0)`。这个配方长期只做对了一半：相机一旦滚动（`camera.scrollX/Y ≠ 0`），钉住的 UI **看得见但点不到**。

排查（三轮实测，过程见 `docs/DEFECT-BACKLOG.md` 的 V1）发现失败是**两道闸门叠加**：

1. **Phaser 自己的命中测试**（`src/input/InputManager.js`）：`:905` 用 `camera.getWorldPoint(pointer.position)` 覆盖 `pointer.worldX/Y`，`:924` 再按**被点中那个对象自己的** `scrollFactor` 还原坐标（`px = worldX + scrollX * obj.scrollFactorX - scrollX`）。因此只钉住根的 UI 会失配——实测 `manager.hitTest(pointer, [button], camera)`：相机未滚动 `1`、只钉根且滚动 `0`、**整棵树都钉 `1`**。
2. **我们自己的二次校验**：`InputRouter.handleDown` 第一行是 `if (this.resolveTarget(pointer) !== widget) return;`，而 `resolveTarget` 用 `pointer.worldX/Y`（= 屏幕坐标 + 相机偏移）与布局坐标比较，在钉住的情况下永不相等 → 提前 return。

单独修任何一半都无效（第 11、28 轮各自实现并实测后回滚），因为事件先要过 Phaser 的命中测试，再过我们的走树校验。

## 决策

1. **`Widget.setScrollFactor()` 沿控件树向下传播**（`setScrollFactorAll()` 为显式形式）。相机钉住必须是**整棵树**的属性：Phaser 用的是被点中对象自己的 scrollFactor，叶子仍是 1 就会失配。
2. **`InputRouter` 的所有指针坐标统一走 `pointerInUiSpace()`**：当 UI 根被钉住（`scrollFactorX/Y === 0`）时用 `pointer.x/y`，否则用 `pointer.worldX/Y`；`resolveTarget`、按下起点（`pressedAt`）与 `isClickGesture` 必须用**同一个**空间判定。
3. **新的不变量**：路由器与 Phaser 的命中测试必须处在同一坐标空间。以后任何指针相关的改动（新控件、新容器、相机效果），都要同时确认这两个空间一致。

## 后果

- 钉住的 HUD 现在可点、可悬停：实测（`root.setScrollFactor(0)` + `camera.scrollX/Y = 260/140`）点击屏幕上的按钮 → `clicks = 1`、焦点落在该按钮；未钉住的普通页面行为不变（同样 `clicks = 1`）。
- `setScrollFactor` 从「只影响自身」变成「影响子树」：对普通 UI 无影响（默认全是 1），但如果调用方**故意**想让某个子树用不同的 scrollFactor，就必须在设置之后单独覆盖该子树。
- 收尾（均已做）：① `addWidget()` 会让新子树继承父节点的 scrollFactor；② 常驻场景 `#/hud` 上线，用**真实点击**验收（含挂载后新增的交互控件）——见 [`ACCEPTANCE-hud.md`](../ACCEPTANCE-hud.md)。
- **补充（第 38 轮）**：决策第 3 条「路由器与 Phaser 的命中测试必须处在同一坐标空间」此前是按**根**的因子近似实现的，于是「只钉一页」这种子树钉法（多页面场景里的常规做法）渲染与 Phaser 命中都正确、却被我们自己的第二道闸门拒掉。现在改为**按候选控件自己的**因子折算（`pointerInWidgetSpace()`，与 `InputManager#hitTest` 的公式逐字一致），`1` 与 `0` 两端的结果与原实现完全相同，中间取值也与渲染一致。已知遗留：UI 之上的点击仍会派发给 UI 之下的 Phaser 对象（`topOnly` 被路由器置为 `false`），登记为 V9。

## 证据

- `docs/DEFECT-BACKLOG.md` §V1：三轮实验的原始读数（含 `hitTest` 的 0/1 对比）。
- 修复提交：`fix(phaser): make a camera-pinned UI clickable (V1)`；Playwright MCP 实测读数见该提交信息。
- 回归：986 个单测、`pnpm -r run typecheck` 5/5、`pnpm exec prettier --check .` 均通过。
