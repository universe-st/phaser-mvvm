# 验收记录 · `Slider` 拖动取值（第 41 轮）

> 背景：控件库缺一个"拖动取值"的控件（`Button.toggle` 只能表达开关），而滑杆恰好是**触摸最典型**的控件——需求第 6 条（PC 鼠标 + 移动端触摸）与第 1 条（Compose 式控件词汇）都指向它。本轮新增 `Slider`：控件本体 + DSL + 工厂 + 12 个纯函数单测 + `#/states` 演示与鼠标/触摸验收。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，页面 `bringToFront()`。

---

## 1. 交付物

| 产物                                                    | 说明                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/widgets/src/Slider.ts`                        | 控件本体：轨道 + 填充 + 滑块，按下即跳转、拖动持续跟踪（可拖出控件外）                           |
| `packages/widgets/src/slider-geometry.ts`               | 纯几何/数值函数（零 Phaser 依赖）：`clampSliderValue`/`sliderFraction`/`sliderValueFromPosition` |
| `packages/widgets/test/slider.test.ts`                  | 12 个单测（钳制、步长锚点、浮点噪声、零长度轨道、`NaN` 防御）                                    |
| `bindNumberModel()`（`packages/phaser/src/binding.ts`） | `bindModel` 的数值孪生：值在双向绑定中保持 `number`（`bindModel` 会 `String()` 化）              |
| DSL `Slider({ value: ref, onValueChange })`             | `packages/widgets/src/compose.ts`：`value` 可直接绑 `ref`，拖动即写回                            |
| 工厂 `this.add.uiSlider(...)`                           | 与其它控件一致（`WIDGET_FACTORY_KEYS` + `augment.ts` 类型声明）                                  |
| `#/states` 新增 Slider 行                               | 连续滑杆（绑 `ref`）+ `step=10` 量化滑杆 + disabled 滑杆，全部进 `st.*`/`pt.*` 探针              |

---

## 2. 鼠标验收（`#/states`，`slider.volume` 宽 200、`knobRadius` 9）

| 位置（相对中心）    | 期望      | 实测    |
| ------------------- | --------- | ------- |
| 左端 −91 px         | 0         | **0**   |
| 1/4 处 −45 px       | 25        | **25**  |
| 中心 0              | 50        | **50**  |
| 右端 +91 px         | 100       | **100** |
| 拖动到最右（6 步）  | ≈100      | **99**  |
| 再拖回最左（12 步） | ≈0        | **1**   |
| 拖出左边界 120 px   | 0（钳制） | **0**   |
| 量化滑杆点 +60 px   | 10 的倍数 | **80**  |

状态机：`normal → hover → pressed`，拖动中保持 `pressed`，松开回到 `hover`（`st.slider.volume` 实测）。
绑定：拖动时同行的 `Text(() => \`volume=…\`)`与`window.states.state().volume` 同步变化（`ref` 双向绑定生效）。

## 3. 触摸验收（CDP `Input.dispatchTouchEvent`）

| #   | 断言                  | 实测                                                         |
| --- | --------------------- | ------------------------------------------------------------ |
| 1   | 手指按下即跳到该处    | 按在左 1/4 处 → `volume=25`，`st.slider.volume=pressed`      |
| 2   | 手指滑动持续取值      | 6 步滑到右端 → `volume=98`                                   |
| 3   | 抬起后不残留 hover    | 抬起 200 ms 后 `st=focused`（第 40 轮的触摸 hover 修复生效） |
| 4   | 手指滑出控件仍然控制  | 横向 +90 px、纵向 +80 px（已离开滑杆矩形）→ `volume=99`      |
| 5   | disabled 滑杆拒绝触摸 | `st.slider.disabled=disabled`，值不变                        |

第 4 条是滑杆的关键：Phaser 只在指针位于对象内时才派发 `pointermove`，所以拖动必须走**场景级**指针流（与 `ScrollView` 同一套做法），否则手指一旦滑出轨道就丢失控制。

---

## 4. 开发中被演示页抓到的缺陷：`localX` 的 `displayOrigin` 偏移

第一版实现用 Phaser 交给 `pointerdown` 的 `localX` 定位，实测"点中心得到 100（右端）"。原因：

```
InputManager.hitTest → pointWithinHitArea():  localX = 局部坐标 + displayOrigin
Container 的 displayOrigin = size / 2
```

所以宽 200 的滑杆中心按下时，`localX` 报的是 **200** 而不是 100 —— 与 `Widget#enablePointerInput()` 注释里描述的是同一个偏移（那里为了让命中区正确而把矩形放在 `(w/2, h/2)`）。

**修法**：不再使用 Phaser 的 `localX`，改用与输入路由器**同一个**坐标空间助手 `pointerInWidgetSpace(pointer, widget, camera)`（第 38 轮引入，本轮从包入口导出），再减去容器链的偏移。这样鼠标、触摸、相机钉住的滑杆都是同一套坐标，且与 ADR-0009 的第二道闸门保持一致。

修后实测即 §2 的表格：左端 0、1/4 处 25、中心 50、右端 100，线性且精确。

---

## 5. 泄漏门禁（`#/lifecycle`）

滑杆是唯一在**拖动期间**监听场景级指针流的控件，因此把它加进了泄漏门禁页（页面现在包含全部控件类型）。`window.lifecycle.churn(20)` 实测：

| 采样                         | 20 轮取值    |
| ---------------------------- | ------------ |
| `themeListeners`             | `59`（单值） |
| `focusables`                 | `8`（单值）  |
| `pointerTargets`             | `14`（单值） |
| `widgets`                    | `57`（单值） |
| `displayList`/`sceneObjects` | `1`/`1`      |
| `textures`/`tweens`/`timers` | `29`/`0`/`0` |

即：每项只有一个取值（相对第 38 轮的 58/7/13/56 各 +1，对应新增的滑杆本身），只剩当前页存活；重启 20 轮后按钮可点（`clicks` 1→2）、输入框可输入（`张三`→`张三A`）。拖动开始与结束成对注册/注销的场景监听不会跨场景残留。

## 6. 门禁

| 命令                           | 结果                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm -r run typecheck`        | 5/5 通过                                                          |
| `pnpm -r run test`             | **1005** 通过（layout 306 / core 278 / phaser 128 / widgets 293） |
| `pnpm exec prettier --check .` | 通过                                                              |
| `pnpm run build:examples`      | 通过                                                              |

---

## 7. 未做

- **键盘操作**：方向键被焦点管理器占用（导航语义），滑杆的键盘支持需要先与它达成约定；已在指南 §4.5 与 backlog 注明。
- **刻度/`steps` 标记、双向区间（RangeSlider）、垂直方向**：未实现。
- **`a11y` 镜像**（ADR-0004 规划的 DOM 无障碍层）：滑杆尚未接入。
