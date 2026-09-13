# 验收记录 · 手柄（Gamepad）导航

- **验收场**：`#/modal`（焦点导航 / 激活 / `back`）、`#/pages`（`back` 逐层路由）、`#/states`（滑杆与滚动容器的**动作归属**）、`#/gallery`（连发）
- **被测实现**：[`packages/phaser/src/nav.ts`](../../packages/phaser/src/nav.ts)（`gamepadStateOf` / `gamepadActionsOf` / `heldDirectionsOf` / `NavRepeat`）、[`packages/phaser/src/plugin.ts`](../../packages/phaser/src/plugin.ts)（`pollGamepad` / `dispatchAction`）、[`packages/phaser/src/Widget.ts`](../../packages/phaser/src/Widget.ts) 的 `onAction` 钩子、`Slider`/`ScrollView` 的动作处理
- **第 64 轮**：示例应用补上 `input: { gamepad: true }`（此前**一直没开**，见下），新增假手柄夹具 `window.fakePad`，把整条手柄路径第一次跑通并写成常驻验收；同一轮修掉 V28
- **验收方式**：Playwright MCP + 页内假手柄（CDP 没有手柄输入域）

---

## 1. 怎么在没有硬件的情况下测手柄

Chromium 的 DevTools 协议**没有**手柄输入域，所以真手柄无法从外面模拟。可行的办法是替换 Phaser 读取手柄的那**一个**入口：

- Phaser 每帧调 `navigator.getGamepads()`（`GamepadPlugin#refreshPads`），把结果包成自己的 `Gamepad`（`Gamepad#update` 只在假手柄的 `timestamp` 前进时才同步按键/轴）；
- 所以把 `navigator.getGamepads` 换成一个返回**可变假对象**的函数就够了，整条链路（阈值、边沿、连发、路由）都按真实手柄跑。

`apps/examples/src/fake-pad.ts` 把这件事封装成 `window.fakePad`（`main.ts` 里安装）：

| 调用                                | 作用                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| `window.fakePad.pads()`             | Phaser 现在持有几个手柄（**手柄没开时是 0**）         |
| `window.fakePad.pad()`              | Phaser 那份手柄对象的 id/按键数/轴数                  |
| `window.fakePad.button(i, down)`    | 按/放某个键（`0` = A/×，`1` = B/○，`12..15` = D-Pad） |
| `window.fakePad.stick(dir, value?)` | 推左摇杆（默认 ±0.8，超过死区 0.5）                   |
| `window.fakePad.clear()`            | 全部回中                                              |

实测 `window.fakePad.pads()` = 1、`pad()` = `{ id: 'phaser-mvvm fake pad (standard)', buttons: 17, axes: 4 }`。

---

## 2. 验收矩阵（第 64 轮实测）

### 2.1 导航与激活（`#/modal`）

| 操作                        | 结果                                                           |
| --------------------------- | -------------------------------------------------------------- |
| 初始（无焦点）按 `D-Pad 右` | 焦点进入集合：`modal.openConfirm`                              |
| 再按 `D-Pad 右`             | `modal.openForm`（几何导航）                                   |
| `D-Pad 下`                  | `modal.pageB`（跨行）                                          |
| `A`                         | **激活**：`pageClicks 0 → 1`，dev 轨迹 `activate: … (gamepad)` |
| `D-Pad 上`                  | 回到 `modal.openForm`                                          |
| `D-Pad 左` ×6               | 停在最左（`modal.openConfirm`），不会绕出去                    |
| `A`（在 `openConfirm` 上）  | 对话框打开：`depth=1`、焦点 `confirm.cancel`                   |
| `B`                         | **关闭**对话框：`depth=0`、`reasons=['back']`                  |

### 2.2 `back` 的逐层路由（`#/pages`）

| 操作                                  | 结果                                             |
| ------------------------------------- | ------------------------------------------------ |
| 推入一层后按 `B`                      | `names` 从 `['list','detail:3']` 回到 `['list']` |
| 在底层页再按 `B`                      | 落到 `mvvm.onBack`（`appBacks` 0 → 1）           |
| 不可关闭的对话框上按 `B`（`#/modal`） | **被吞掉**：`depth` 仍为 1、`reasons` 不增长     |
| 该对话框自己的按钮上按 `A`            | 关闭，`reasons=['api']`                          |

### 2.3 连发节流（`#/gallery`、`#/modal`）

按住 `D-Pad 右` 1.2 秒：焦点移动 **4 次**，间隔 **351 / 99 / 101 ms**（`NAV_REPEAT_DEFAULTS = { initialDelay: 350, repeatDelay: 90 }`）——即"按住立即一次，之后 350ms 再开始按 90ms 节奏重复"，**不是**每帧一步。激活/返回是**边沿触发**（按住不重复提交）。

### 2.4 动作归属：手柄与键盘同权（`#/states`）

| 控件（已聚焦）       | 输入              | 结果                                                           |
| -------------------- | ----------------- | -------------------------------------------------------------- |
| `slider.volume`      | **`D-Pad 右`**    | 值 40 → **45**，焦点**留在**滑杆（修复前：焦点被搬走、值不动） |
| `slider.volume`      | `D-Pad 下`        | 焦点移到 `slider.stepped`（横向控件的上下留给导航）            |
| `slider.volume`      | `→`（键盘）       | 值 45 → **50**（键盘行为不变）                                 |
| `slider.volume`      | `End`（键盘）     | 值 → **100**（`Home`/`End`/`PageUp`/`PageDown` 仍是键盘专属）  |
| `scroll`（滚动容器） | **`D-Pad 下` ×2** | 偏移 0 → **80**（每步 40px；修复前完全不动）                   |
| `scroll`             | `End`（键盘）     | 偏移 → **330**                                                 |

### 2.5 走进 / 走出滚动区（`#/a11y` 与 `#/scroll`，第 67 轮追加）

滚动区里放着一排可聚焦按钮时，手柄这条路此前是**单向的**：进得去、出不来。

| 焦点                     | 输入                  | 第 67 轮之前                         | 现在（实测）                                                                                                                  |
| ------------------------ | --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `a11y.region.button1`    | `D-Pad 下` ×1         | 焦点变成 **`a11y.region`（口自己）** | `a11y.region.button2`（[V34](../DEFECT-BACKLOG.md)：容器不抢内部控件的方向）                                                  |
| `a11y.region.button2..5` | `D-Pad 下` ×4         | 只滚动、焦点不动                     | 依次走到 `button3/4/5/6`，偏移 **32 → 66 → 100 → 126**，每一步焦点都在可见带内（[V33](../DEFECT-BACKLOG.md)：焦点自动进视野） |
| `a11y.region.button6`    | `D-Pad 下`            | 偏移卡在 126/126、毫无反应           | 下面没有控件 → 不动（焦点留在 `button6`，不会被口吞掉）                                                                       |
| `scroll.v`（口本身）     | `End` 后再 `D-Pad 下` | 偏移停在 8000，之后**永远**没反应    | 焦点**离开口** → `row.delete.r215`，再按 → `r216`（[V35](../DEFECT-BACKLOG.md)：滚到尽头必须拒绝方向）                        |

完整矩阵与读数见 [`ACCEPTANCE-scroll.md`](./ACCEPTANCE-scroll.md) §2.3；`#/modal` 的 2.1 矩阵在本轮改动后逐条复跑，读数不变。

---

## 3. 本轮修掉的缺陷

### V28 · 手柄无法操作"值控件"（已修复）

**现象**：聚焦滑杆后，方向键能调值，但 `D-Pad` **把焦点搬走**、值一点不变；聚焦滚动容器后 `D-Pad` 也不滚动。也就是说键盘有一条"当前焦点控件先挑动作"的通道（`Widget.onKeyDown`），而手柄没有——手柄动作直接进焦点管理器。

**实测（修复前，同一控件 A/B）**：

```
slider.volume 聚焦   D-Pad 右   → focus=stage（搬走）      volume 40（不变）
slider.volume 聚焦   →（键盘）  → focus=slider.volume      volume 40 → 45
scroll 聚焦          D-Pad 下×3 → offset 40（不变）
scroll 聚焦          ↓（键盘）×3 → offset 40 → 160
```

**修法**：把这条通道抽成**与设备无关**的钩子 `Widget.onAction(action, source)`，键盘与手柄都先问它，再交给焦点管理器（`MVVMPlugin.dispatchAction()` 是唯一入口）。`Slider` 与 `ScrollView` 因此各自只保留一份"方向"逻辑：

- `Slider`：`left`/`right` 调值（两台设备一致），`up`/`down` 明确**拒绝**——横向控件的上下留给导航，手柄用户不会被卡在控件里；
- `ScrollView`：沿**自己的轴**认方向（纵向只认 `up`/`down`，横向只认 `left`/`right`，`direction: 'both'` 全认），交叉轴照样导航；
- 不属于导航动作的键（`Home`/`End`/`PageUp`/`PageDown`）仍走 `onKeyDown`，保持键盘专属。

`ARROW_KEY_OF_DIRECTION`（`nav.ts`）把"动作 ↔ 方向键"的对应关系收在一处，两个控件都用它，所以 `D-Pad 右` 和 `→` 不可能再走岔。

### 顺带修掉的演示缺陷

**示例应用从来没有开手柄**：`main.ts` 的 Phaser 配置里没有 `input: { gamepad: true }`（Phaser 默认 `false`），而 `#/gallery` 的文案已经写着"gamepad supported"。第 64 轮补上这一行，并把假手柄夹具装进应用，于是这条路径有了常驻验收（同族问题见 DEFECT-BACKLOG V13/V19/V26：**没有门禁的承诺会一直停留在文案里**）。

---

## 4. 未覆盖 / 待办

- **真手柄**：本轮全部走假手柄（模拟 `navigator.getGamepads`），真机的按键映射差异（`mapping: 'standard'` 之外的布局）、浏览器"必须先按一下手柄才暴露"的怪癖未验。
- **第二只手柄 / 多手柄**：`nav.ts` 的纯函数支持任意手柄，插件只轮询 0 号（与文档一致）。
- **右摇杆、扳机、震动**：框架不映射，未验。
- **手柄文本输入**：表单里的文本仍需要键盘（DOM 桥），手柄只负责走到那个控件。
- ~~**无障碍（M9 的 `A11yBridge`）**：仍未开始。~~ **已交付**：`A11yBridge` 已实现（`packages/phaser/src/a11y.ts`），`#/a11y` 是常驻验收页，`visual-check` 有 4 张 AX 表当门禁（见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md)）。仍未做的只有**真实屏幕阅读器人工走查**。
