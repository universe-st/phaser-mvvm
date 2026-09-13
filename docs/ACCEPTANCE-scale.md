# 验收记录 · 设计分辨率（`Scale.FIT`）与适配层坐标系

- **验收场**：[`#/states`](../../apps/examples/src/scenes/states.ts)（触摸落点与软键盘输入）、[`#/config`](../../apps/examples/src/scenes/config.ts)（安全区读数）、全部 19 个场景（扫描）
- **被测实现**：[`packages/widgets/src/input-bridge.ts`](../../packages/widgets/src/input-bridge.ts)（隐藏输入框的定位）、[`UIRoot`](../../packages/phaser/src/UIRoot.ts) 的安全区换算、[`apps/examples/src/status.ts`](../../apps/examples/src/status.ts) 的 `pagePoint()`/`pageOrigin()`/`displayScale()`（验收探针）
- **验收方式**：CDP 设备仿真（手机视口 + DPR + 刘海 + 触摸），`?fit=WxH` 让示例以设计分辨率启动
- **第 73 轮**：把「适配层在画布被缩放时还对不对」补上——此前所有验收都跑在 `Scale.RESIZE`（画布与设计坐标 1:1）
- **相关**：[`ACCEPTANCE-mobile.md`](./ACCEPTANCE-mobile.md)（手机形态与安全区）、[`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md)（手势）

---

## 1. 两种"适配手机"的方式，框架都必须对

| 模式                       | 语义                                                                                | 谁需要自适应                        |
| -------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `Scale.RESIZE`（示例默认） | UI 拿到**真实视口**，布局跟着回流                                                   | 页面自己（`width: 'fill'`、可换行） |
| `Scale.FIT` + 设计分辨率   | UI 永远按**设计尺寸**排布（例如 980×614），整块画布缩放到屏幕上，多出来的地方留黑边 | 不需要——每个设备上长得一样          |

两者都是正规做法，而框架必须在两者下都正确，因为**差一个缩放系数**的表现是"点不到"或"输入框跑偏"，而不是报错。示例现在支持 `?fit=980x614` 启动（`main.ts`），验收才能覆盖第二种。

---

## 2. V39 · 隐藏输入框在 `Scale.FIT` 下被缩放了两次（已修复）

`TextField`/`TextArea` 的隐藏 DOM `<input>` 挂在 **Phaser 的 `game.domContainer`** 里。而 Phaser 自己会给这个容器加变换——`ScaleManager.refresh()`：

```js
domStyle.transform = 'scale(' + displaySize.width / baseSize.width + ',' + … + ')';
```

也就是说容器**已经**替我们把设计像素缩成了 CSS 像素。`DomInputBridge#place()` 却又乘了一遍 `displayScale`（`canvasRect.width / gameSize.width`），于是**双重缩放**。实测（手机 390×844、`?fit=980x614`，缩放 0.398；字段设计尺寸 220×36）：

```
修复前：元素 rect [4, 560, 35, 6]     ← 0.398² × 220 ≈ 35，位置也偏
修复后：元素 rect [10, 501, 88, 14]   ← 恰好等于该字段在屏幕上的真实框
        （设计 (26, 508.33) → 0 + 26×0.398 = 10，299 + 508.33×0.398 = 501）
```

**它是怎么活下来的**：输入的文字照常进模型（`Input.insertText` 直接写给当前焦点元素，与元素多大、在哪无关），所以功能验收全绿；而元素自己的**框**才是输入法候选窗、软键盘的 scroll-into-view、移动端 Safari 聚焦缩放所依赖的东西。第 72 轮的手机验收跑在 `RESIZE`（`displayScale = 1`）下，正好绕过了它。

**修法**：把容器自己的缩放**量出来再除掉**，而不是假设它是 1：

```ts
private containerScale(axis: 'x' | 'y'): number   // rect.width / getComputedStyle(container).width
element.style.left = (originX + rect.x * displayX) / containerX;
```

容器是中性盒子时它返回 1（页面相对定位，行为不变）；是被 Phaser 缩放的 DOM 容器时返回 0.398，元素于是按**设计像素**书写 `left/top/width/height`，由容器那层变换负责缩放。

**同时修掉一个同族问题**：`Scale.FIT` 下列表页的 `viewport()`/`point()` 与 `HUD` 的 `hitTest()` 也都在用"设计坐标当页面坐标"。现在示例的 `pt.*` 全部走 `status.ts` 的 `pagePoint()`/`pageOrigin()`（画布原点 + **缩放后**的设计坐标），一处实现、19 个场景共用。

> **纪律**：示例里任何"把控件坐标换算成页面坐标"的地方都必须走 `pagePoint()`/`pageOrigin()`；不要在场景里自己写 `canvas.left + origin.x`——那在 `RESIZE` 下恰好正确，在 `FIT` 下必错（第 73 轮一次改掉 31 处）。

---

## 3. 验收矩阵

### 3.1 坐标系与输入（`#/states`，手机 390×844 / dpr 3 / 触摸，`?fit=980x614`）

| #   | 判据                     | 实测                                                                                                    |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| F1  | 设计坐标与屏幕上的一致   | `gameSize 980×614`、`displaySize 390×244`、画布 rect `[0,299,390,244]`（`autoCenter` 居中、上下留黑边） |
| F2  | 探针给出**页面**坐标     | `pt.button.default = (28, 372)`（＝ 0 + 71×0.398, 299 + 184×0.398），落在画布内                         |
| F3  | 触摸按探针点能命中       | tap → `clicks 0 → 1`                                                                                    |
| F4  | 滑杆按比例取值           | 轨道 80% 处（宽度按 0.398 折算）→ 值 **40 → 82.94**（与 `RESIZE` 下的 82.97 一致，差异来自坐标取整）    |
| F5  | **隐藏输入框贴在字段上** | 元素 rect `[10,501,88,14]` ＝ 该字段在屏幕上的真实框（见 §2）                                           |
| F6  | 软键盘输入进模型         | tap 字段 → `Input.insertText('设计分辨率')` → 模型 `text = 设计分辨率`                                  |
| F7  | 黑边不参与命中           | 画布 y 范围 299..543；探针点均在范围内                                                                  |

### 3.2 安全区在缩放下（`#/config`，刘海 47 / 手势条 34）

`env(safe-area-inset-*)` 是 **CSS 像素**，而布局在**设计像素**里，两者在 `FIT` 下差一个缩放系数——直接把 47 当设计像素用会**少留 2.5 倍**，正好是"控件压在刘海下面"（第 72 轮那个缺陷的加强版）。另外 inset 属于**视口**，UI 属于**画布**，`FIT` 留黑边时挖孔盖住的是黑边而不是界面。

第 73 轮因此加了两步换算（都在 [`safe-area.ts`](../../packages/phaser/src/safe-area.ts)，纯函数、有单测）：

1. `insetsInsideCanvas()`：每条边只保留**画布与 inset 真正重叠**的长度；
2. `cssInsetsToDesign()`：× `gameSize / displaySize`，把 CSS 像素换到设计像素。

| #   | 环境                                       | 设备报的 inset | 根实际预留  | 说明                                                                                     |
| --- | ------------------------------------------ | -------------- | ----------- | ---------------------------------------------------------------------------------------- |
| S6  | `RESIZE` 390×844（画布＝视口）             | 47 / 34        | **47 / 34** | 换算系数 1，行为与第 72 轮一致                                                           |
| S7  | `FIT` 980×614（上下留黑边，画布 299..543） | 47 / 34        | **0 / 0**   | 挖孔盖的是黑边，不是界面——不该预留                                                       |
| S8  | `FIT` 390×844（画布铺满屏幕）              | 47 / 34        | **47 / 34** | 无缝时系数为 1；若是 980×614 的**满屏比例**，预留会是 **118 / 85**（≈47×2.513 设计像素） |

`#/config` 同时发布 `device.*`（设备报的）与 `safeArea.*`（实际预留的）两套读数，`window.config.safeArea()` 返回 `{ enabled, device, reserved, padding }`——S6/S7/S8 的差别就是这两套数字的差别。

### 3.3 回归

| #   | 判据                     | 实测                                                                   |
| --- | ------------------------ | ---------------------------------------------------------------------- |
| F8  | `RESIZE` 下毫无变化      | 19 场景扫描：全部 `ok`、零 ERROR、每个根的 padding 为 0（无 inset 时） |
| F9  | `visual-check` 仍全绿    | 6 场景 × 暗/亮两遍 = **46/46** 采样点（几何与像素期望未变）            |
| F10 | 设计分辨率下无控制台错误 | `?fit=980x614` 打开 `#/states`/`#/config`：0 error、0 warning          |

---

## 4. 门禁（第 73 轮实跑）

| 命令                            | 结果                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `pnpm -r run test`              | **1139 通过**（layout 313 / core 281 / phaser **209** / widgets 341） |
| `pnpm -r run typecheck`         | 5/5                                                                   |
| `pnpm exec prettier --check .`  | 通过                                                                  |
| `pnpm docs:check`               | 通过                                                                  |
| `pnpm run build:examples`       | 通过                                                                  |
| `pnpm size`                     | 18.5 / 22.0 KB min+gzip（见提交信息）                                 |
| `node scripts/visual-check.mjs` | 46/46（6 场景 × 2 主题）                                              |
| 19 场景扫描（`RESIZE`）         | 全部 `ok`、零 ERROR                                                   |

---

## 5. 未验证 / 已知边界

- **`ENVELOP`**：Phaser 的第四种模式（铺满、裁掉多余部分）没有单独验；`displayScale`/`containerScale` 的测量式写法对它是同一套数学，但没有实测。
- **`Scale.NONE` / `WIDTH_CONTROLS_HEIGHT` / `HEIGHT_CONTROLS_WIDTH`**：`displayScale` 在它们下面同样按 CSS/设计比计算，未逐一验收。
- **画布不在页面原点**（`parent` 带 padding、页面滚动）：`pagePoint()` 加了画布 rect 的偏移，但"页面滚动时 `pt.*` 是否仍然有效"未验（示例页面 `overflow: hidden`）。
- **真机**：全部读数来自设备仿真；**Android 模拟器上已验 DPR 与安全区**（第 112 轮 A4：`dpr=2.625`、CSS 412×842 × 2.625 = WebView 1080×2209 @screen 0,128；安全区全 0 是因为 Pixel 6 无挖孔，见 [`ACCEPTANCE-android.md`](./ACCEPTANCE-android.md) §5）；`Scale.FIT` 与物理设备的 DPR 组合仍未验。
- **示例页在 `FIT` + 手机下的可用性**：980×614 的设计在 390 宽的屏幕上只有 0.398 倍，字很小——这是设计分辨率方案的固有取舍（要好看就得给手机另一套设计尺寸，或用 `RESIZE`），框架不做判断。
