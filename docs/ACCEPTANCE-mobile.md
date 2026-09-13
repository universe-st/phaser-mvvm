# 验收记录 · 手机形态与安全区（safe area）

- **验收场**：[`#/config`](../../apps/examples/src/scenes/config.ts)（唯一与设备有关、因此必须逐设备验收的插件选项）、[`#/states`](../../apps/examples/src/scenes/states.ts)（触摸输入矩阵）、[`#/scroll`](../../apps/examples/src/scenes/scroll.ts)（几何回归）
- **被测实现**：[`packages/phaser/src/safe-area.ts`](../../packages/phaser/src/safe-area.ts)（纯逻辑 + DOM 读取）、[`UIRoot`](../../packages/phaser/src/UIRoot.ts) 的 `safeArea` / `safeAreaInsets`、`MVVMPluginConfig.safeArea`
- **验收方式**：CDP 设备仿真（`Emulation.setDeviceMetricsOverride` 手机视口 + `setSafeAreaInsetsOverride` 刘海/手势条 + `setTouchEmulationEnabled`）；触摸用 `Input.dispatchTouchEvent`，软键盘用 `Input.insertText`
- **第 72 轮**：把"适配移动端"从"触摸事件能跑通"推进到**手机形态**（视口 / DPR / 旋转 / 刘海）
- **相关**：[`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md)（手势矩阵）、[`ACCEPTANCE-scroll.md`](./ACCEPTANCE-scroll.md)（滚动与焦点）

---

## 1. 手机形态下先验什么

触摸事件本身在 M7 之后已经验过多轮（[`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md)），但那些验收都跑在**桌面视口**里。真机上还有三件与此无关、只在手机形态下才暴露的事：**视口小且比例不同**、**DPR ≠ 1（通常 2–3）**、**刘海与手势条**。本轮的矩阵就是这三件。

| #   | 判据                     | 实测（390×844 / dpr 3）                                                                                                                                                               |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | 画布与 UI 根跟随手机视口 | `#status`：`size=390x844 dpr=3`；`canvas` 与 `UIRoot` 都是 390×844、`getBoundingClientRect` 从 (0,0) 起                                                                               |
| M2  | 触摸点击落在正确控件上   | tap `button.default` → `clicks 0 → 1`；tap `button.toggle` → `toggled false → true`                                                                                                   |
| M3  | 滑杆按比例取值           | 在 200px 轨道上点 80% 处（`pt.slider.volume` 中心 + 0.3×宽）→ 值 **40 → 82.97**                                                                                                       |
| M4  | **软键盘输入**（DOM 桥） | tap `field.plain` → `document.activeElement` 是 `<input type="text">`，其 `getBoundingClientRect` 与控件矩形一致（CSS 像素）；`Input.insertText('手机输入')` → 模型 `text = 手机输入` |
| M5  | 旋转                     | 切到 844×390：`gameSize`/`canvas`/`UIRoot` 全部 844×390，触摸依旧落点正确（`clicks 1 → 2`）                                                                                           |
| M6  | DPR 变化（同一尺寸）     | dpr 3 → 2：画布尺寸不变（CSS 像素为准）、触摸照常（`clicks 2 → 3`）                                                                                                                   |

> M4 是这一组里最有价值的一条：软键盘走的不是按键事件，而是"往隐藏 DOM 输入框里塞文本"，与真机输入法的路径一致。

---

## 2. 安全区（第 72 轮新增的能力）

### 2.1 为什么需要它

Canvas 在手机上铺满整个视口，**包括系统画摄像头挖孔与 Home 手势条的那两条**。浏览器是唯一知道这两条多高的角色：CSS 把它们暴露为 `env(safe-area-inset-*)`。所以框架的动作是"读出来，然后**把根的内边距设成它**"——用 padding 而不是给页面加偏移，是因为排布器本来就解析 padding，`width: 'fill'` 的页面自然落在安全区内，而根自己的盒子仍然铺满视口（主题背景与钉住的图层保持全屏）。

```ts
// 默认开启（与 SwiftUI 的 safeArea 同语义）：桌面/没有刘海的环境量出来是 0，什么都不变
MVVMPlugin.configure({ safeArea: true });
// 想让画布铺到挖孔里（全屏背景、或自己处理 inset）：
MVVMPlugin.configure({ safeArea: false });
```

读数的取法：往 `<body>` 临时塞两个 `visibility: hidden` 的探针元素，一个贴左上（宽 = `env(safe-area-inset-left)`、高 = `env(safe-area-inset-top)`），一个贴右下（宽 = right、高 = bottom），量完立刻删掉——不绘制、不参与命中、不影响页面布局，但 `env()` 会被解析。

### 2.2 必须在页面上声明 `viewport-fit=cover`

**这是使用者的责任，框架替不了**：没有

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

时 iOS 会让画布避开挖孔（并给所有 inset 报 `0`），框架读到的就是 0，也就无从避让。示例应用的 `index.html` 已加上这一行。

### 2.3 矩阵

| #   | 环境                                   | 读数                                                                                                                                  |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | 桌面 1280×720，无 inset                | `insets 0/0/0/0`、`root.padding` 全 0（**行为与从前完全一致**，`visual-check` 的像素期望未变）                                        |
| S2  | 手机 390×844，刘海 47 / 手势条 34      | `insets {top 47, bottom 34}`、`padding {top 47, bottom 34}`；第一个可交互控件的页面 y **237 → 284**（正好 +47），**触摸依然落点正确** |
| S3  | 横屏 844×390，刘海在侧边 47 / 底部 21  | `padding {top 47, bottom 21, left 47, right 47}`；第一个控件的 x **-65 → 162**（从屏幕外回到安全区内）                                |
| S4  | 极端值：390×120 的视口 + 4000 的 inset | 夹到 **30 / 30 / 97 / 97**（每条边最多占该轴 25%，见下）                                                                              |
| S5  | 改变 inset 但**不改变尺寸**            | `padding` 保持旧值——inset 只在 **resize** 时重读（手机上是旋转／窗口变化触发）；`#/config` 为此暴露了 `window.config.resize()`        |

**夹取（`clampSafeArea`）**：刘海是**物理**像素高度，视口一矮（横屏、小窗）它就可能比整个界面还高——S4 里 120px 高配 4000 的 inset，如果照单全收就没有任何空间留给 UI。规则是**每条边最多占该轴的四分之一**，且逐轴独立（横屏时左右两组 inset 各自与宽度比）。负数 / `NaN` / 缺失一律当 0：这些数字都来自 DOM 测量，接受一个 `-12px` 的内边距比忽略一次坏读数更糟。纯函数单测（`insetsInsideCanvas` / `cssInsetsToDesign` / `clampSafeArea` 共 14 例，其中夹取 6 例）见 `packages/phaser/test/safe-area.test.ts`。

### 2.4 顺带说明的三条边界

- **只在 resize 时重读**：inset 的变化（旋转、状态栏显隐）在真机上几乎总和 resize 一起来；若某环境单独改了 inset，需要自己调 `root.resize()`。
- **`UIRoot` 的盒子不变**：padding 只影响**子节点**的排布区域，`appliedRect` 仍是整屏，所以相机背景、钉住的 HUD 页、模态遮罩都还是全屏。
- **画布被缩放时（`Scale.FIT`）要换两次算**：inset 是 CSS 像素、布局是设计像素；而且 inset 属于视口、UI 属于画布，留黑边时挖孔盖的是黑边。第 73 轮补上了 `insetsInsideCanvas()` 与 `cssInsetsToDesign()`——`RESIZE` 下预留 47/34、`FIT 980×614` 留黑边时预留 **0/0**、`FIT` 铺满时 47/34（公式见 [`ACCEPTANCE-scale.md`](./ACCEPTANCE-scale.md) §3.2）。

---

## 3. 门禁（第 72 轮实跑）

| 命令                            | 结果                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `pnpm -r run test`              | **1136 通过**（layout 313 / core 281 / phaser **201** / widgets 341） |
| `pnpm -r run typecheck`         | 5/5                                                                   |
| `pnpm exec prettier --check .`  | 通过                                                                  |
| `pnpm docs:check`               | 通过                                                                  |
| `pnpm run build:examples`       | 通过                                                                  |
| `pnpm size`                     | 18.5 / 21.1 KB min+gzip                                               |
| `node scripts/visual-check.mjs` | 6 场景 × 暗/亮两遍全绿（桌面无 inset，几何与像素期望未变）            |
| 19 场景扫描                     | 全部 `ok`、零 ERROR                                                   |

---

## 4. 未验证 / 已知边界

- **真机**：全部读数来自 Chrome 的设备仿真（视口 / DPR / 安全区 / 触摸），**真机 iOS Safari 与 Android Chrome 未验**——尤其是 iOS 的软键盘会把视口顶起来（`visualViewport` 变化），框架没有专门处理，可能与固定布局打架。
- **软键盘弹出后的视口变化**：`window.innerHeight` 在软键盘弹出时会变小（Android 默认 resize），`Scale.RESIZE` 会让整个 UI 重排；真机上是否可接受未验（示例页是固定宽度，重排后会需要滚动）。
- **示例页在手机视口下是"桌面布局被裁掉"**：`#/compose`（700px）、`#/states`（内容 1380px）等比 390px 宽得多，垂直口只裁不横滚。**这是示例页的固定宽度选择，不是框架缺陷**；真要在手机上用，页面需要自适应宽度或给 `ScrollView` 加 `direction: 'both'`。本轮没有改这些示例页。
- **刘海内的游戏世界**：`safeArea: false` + 全屏世界的组合没有实测。
