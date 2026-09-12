# 验收记录 · 主题重绘（切换主题时每个控件都跟着换）

- **验收方式**：Playwright MCP 逐场景做「暗 → 亮」切换，**在画布上按控件矩形采样像素**（`?capture=1` + `canvas.drawImage → getImageData`），逐控件判断"这一块重绘了吗、重绘成了什么"；再由 `node scripts/visual-check.mjs` 把它变成**常驻门禁**（每个场景一条暗色期望 + 一条亮色期望）。
- **被测实现**：`packages/phaser/src/theme.ts`（令牌 + 订阅）、`Widget`（构造时订阅 `onThemeChange` → `refreshAppearance()` + `markDirty()`）、`skin.ts`（绘制时读令牌）、`modal.ts`（遮罩）
- **第 71 轮**：审查"主题切换到底重绘了什么"，抓到 **V38**（对话框遮罩不跟随主题）
- **相关**：[`guide/06`](./guide/06-data-and-theme.md) §6、[`ACCEPTANCE-config.md`](./ACCEPTANCE-config.md)（`themeBackground`）、[`ACCEPTANCE-lifecycle.md`](./ACCEPTANCE-lifecycle.md)（`themeListeners` 泄漏门禁）

---

## 1. 怎么审的

主题系统的契约是"**控件不缓存颜色字面量**"（PLAN §4.6）：每个 `Widget` 构造时订阅 `onThemeChange`，变化时 `refreshAppearance()` 重画、`markDirty()` 重排。这个契约此前只有零散证据（`#/dashboard` 的画布清屏色、几张肉眼截图），**没有任何检查逐控件问过"你重绘了吗"**。

审计脚本（临时，跑在 `?capture=1` 的页面里）：

1. 沿 `mvvm.root` 遍历控件树，记录每个**可见且 ≥10×8** 控件的名字、矩形（`appliedRect` + 容器链求和）与两个采样点（左上角内 4px、中心）；
2. `canvas.drawImage → getImageData` 逐点取色（因 `?capture=1` 保留了 WebGL 绘制缓冲）；
3. `mvvm.setTheme('light')`，等 0.6s 再采一遍；
4. 报告"两个采样点**都没变**"的控件——那才是可疑项（背景/文字/边框任一变了就算重绘）。

**结果（一次全量扫描）**：

| 场景                          | 采样控件数 | 未重绘 | 说明                                                                            |
| ----------------------------- | ---------- | ------ | ------------------------------------------------------------------------------- |
| `#/states`（全控件 × 全状态） | **31**     | **0**  | 含 disabled/loading/error/聚焦态，全部换到亮色令牌                              |
| `#/pages`（推入一页后）       | **30**     | **0**  | 栈顶页与被覆盖的页都重绘                                                        |
| `#/list`（虚拟化滚动后）      | **47**     | **0**  | **池化复用的行**也重绘（这是最容易漏的一类）                                    |
| `#/modal`（对话框打开）       | **25**     | 1      | `modal.title`：采样点落在**世界瓦片 × 遮罩**上——那是游戏对象，不是控件（见 §2） |
| `#/compose`（decor 分区）     | **21**     | 1      | `Image`：贴图是**资源**不是令牌，两种主题下都应是同一张图（正确行为）           |

`#/states` 的读数示例（`左 4px / 中心`）：

```
UIRoot         #0d1117/#161b22 → #f6f8fa/#ffffff
button.disabled #1f2630/#1f2630 → #eef1f4/#eef1f4   （surfaceAlt）
button.loading  #1f2630/#1f2630 → #eef1f4/#eef1f4
```

---

## 2. V38 · 对话框遮罩不跟随主题（已修复）

审计里 `modal.title` 的异常把注意力引到了遮罩上：它由 `ModalHost` 用 **`RectWidget`** 画，而 `Rect` 的语义是"一个纯色块"，颜色是**调用方给的字面量**（`RectWidget` 不订阅主题、也没有 `refreshAppearance()`）。`ModalHost` 却把**主题令牌**喂了进去：

```ts
const scrim = new RectWidget(scene, { color: getTheme().colors.overlay, alpha: scrimAlpha, … });
```

于是**在打开对话框的那一刻**把当时的 `overlay` 烤进了矩形的填充色里，之后再切主题也不动。实测（读遮罩自己的 `shape.fillColor`，与当前主题的 `overlay` 对照）：

| 步骤                   | `theme` | 遮罩填充  | 当前 `overlay` | 判断    |
| ---------------------- | ------- | --------- | -------------- | ------- |
| 暗色下打开对话框       | dark    | `#000000` | `#000000`      | ✅      |
| **开着的时候切到亮色** | light   | `#000000` | `#1f2328`      | ❌ 陈旧 |
| 切到亮色**之后**再打开 | light   | `#1f2328` | `#1f2328`      | ✅      |

可见后果：暗 → 亮时，白色对话框上盖着一层**按暗色主题算的纯黑面纱**（`overlay` 在暗色主题里是 `#000000`、亮色主题里是 `#1f2328`），反方向则是一层几乎看不见的浅灰。

**修法**：给遮罩自己的订阅，并把它挂在遮罩的 `scope` 上（对话框关闭时 `destroy()` → `scope.stop()` → 退订，`themeListenerCount()` 不会涨）：

```ts
const unsubscribeScrim = onThemeChange((theme) => {
  scrim.setColor(theme.colors.overlay);
});
scrim.scope.onScopeDispose(() => unsubscribeScrim());
```

修后实测：`#000000 ↔ #1f2328` 双向跟随；`window.modal.churn(12)`（连开连关 12 次）前后计数完全相同（`widgets 21 / themeListeners 23 / pointerTargets 10 / focusables 7`），`depth=0`。

> **一般化**：`Rect` 收的是字面量色（`Rect({ color: 0x2f6feb })`），框架里唯一"给 `Rect` 喂令牌"的地方就是这个遮罩，所以修在它这里。**要在业务代码里画跟随主题的色块，用 `Panel({ variant })`，或者自己订阅 `onThemeChange` 并 `setColor()`。**

### 常驻仪表

`#/modal` 现在逐帧发布 `scrim=<当前遮罩填充>` 与 `scrim.overlay=<当前主题 overlay>`：**两者必须永远相等**，切主题前后各读一次即可断言（`window.modal.scrim()` 也返回数值）。这条读数就是 V38 的门禁——它的存在理由是"像素上看不出来"（遮罩是半透明的混合值，采样不稳定，`visual-check` 明确跳过了 `#/modal` 的画布清屏检查）。

---

## 3. 常驻门禁：`scripts/visual-check.mjs` 的亮色半场

审计是一次性的，门禁必须每次跑。脚本的每个场景现在做**两遍**像素检查：

1. **暗色半场**（原有）：`PIXEL_EXPECTATIONS` —— 控件画对了令牌吗；
2. **亮色半场**（第 71 轮新增）：`setTheme('light')` 后重新截图，用 `LIGHT_EXPECTATIONS` 比对**同一批采样点**。

亮色半场里有两类条目，**两类都必须对**：

| 类型       | 例子                                                                   | 亮色期望                        | 意义                                                     |
| ---------- | ---------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| **令牌**   | `modal.confirm.ok`（danger）、`hud.score`（primary）、`uiscene.show.a` | `#cf222e`、`#0969da`、`#0969da` | 没重绘就会失败（V38 这类问题的探针）                     |
| **字面量** | `m0.rect.blue`、`probe.abs.topleft`、`stack.card`、`hud.tile`          | **与暗色半场相同**              | "全都变了"不能冒充"重绘正确"（贴图/世界/纯色块就该不变） |

另外每个（非跳过的）场景都断言**画布清屏色**变成 `#f6f8fa`（相机跟随主题由插件负责）。

实测（6 场景 × 2 遍全绿）：

```
OK  canvas.clear: #0d1117 at (4,4)          OK  canvas.clear (light): #f6f8fa at (4,4)
OK  rect.blue: #2f6feb at (568,399)         OK  rect.blue: #2f6feb at (568,399)      ← 字面量：不变
OK  rect.amber: #f2a33c at (752,399)        OK  rect.amber: #f2a33c at (752,399)
OK  score: #2f6feb at (148,28)              OK  score: #0969da at (148,28)           ← 令牌：变了
OK  tile: #161b22 at (701,381)              OK  tile: #161b22 at (701,381)           ← 世界：不变
OK  confirm.ok: #f85149 at (781,396)        OK  confirm.ok: #cf222e at (781,396)
OK  confirm.cancel: #161b22 at (715,396)    OK  confirm.cancel: #ffffff at (715,396) ← ghost 按钮透出对话框面板
OK  show.a: #2f6feb at (326,215)            OK  show.a: #0969da at (326,215)
```

亮色半场复用暗色半场的 `#status` 几何，这是一条**顺手做的断言**：主题切换不应该移动任何东西——如果布局被主题影响，采样点就会落到别的控件上，期望值随之失败。

---

## 4. 门禁（第 71 轮实跑）

| 命令                            | 结果                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `pnpm -r run test`              | **1130 通过**（layout 313 / core 281 / phaser 195 / widgets 341） |
| `pnpm -r run typecheck`         | 5/5                                                               |
| `pnpm exec prettier --check .`  | 通过                                                              |
| `pnpm docs:check`               | 通过                                                              |
| `pnpm run build:examples`       | 通过                                                              |
| `pnpm size`                     | 18.5 / 20.9 KB min+gzip                                           |
| `node scripts/visual-check.mjs` | **6 场景 × 2 遍（暗/亮）全绿**                                    |
| `#/modal` churn(12)             | 四项计数前后相同、`depth=0`                                       |
| 19 场景扫描                     | 全部 `ok`、零 ERROR                                               |

---

## 5. 未验证 / 已知边界

- **自定义主题**：`setTheme({ name, colors })` 的路径只验了内置的 dark/light 两个；`overlay` 之外的自定义令牌值没有专门的用例（遮罩跟随的逻辑对任何令牌都成立，因为它读的是 `theme.colors.overlay`）。
- **主题切换 + 动画/惯性中的控件**：切换时正在滚动、正在拖拽的控件没有单独验（`scrollbar` 颜色在读令牌处重绘，但"切换会不会打断手势"没测）。
- **Canvas 渲染器**：本轮全部在 WebGL 下跑（`ScrollView` 的 Canvas 兜底走 `GeometryMask`，遮罩矩形的颜色是否跟随主题未验）。
- **`Image` 的染色**：主题不影响贴图（审计里它是"未重绘"的例外之一）；如果将来加 `tint` 令牌，这条要重审。

---

## 5. 动效时长令牌（第 80 轮）

`Theme` 新增 `motion: { enter: number; exit: number }`（毫秒），两个内置主题都写 `{ enter: 160, exit: 120 }`——也就是把它们从 `transition.ts` 里的魔法数字变成设计系统的一部分。转场系统（对话框、页面栈、路由）在解析策略时读它，因此**换主题就换节奏**。

| 判据                 | 实测（`#/modal`、`#/pages`，Playwright MCP）                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 内置主题不改变行为   | `window.modal.motion()` = `{ enter: 160, exit: 120 }`；`#/pages` 同                                                                                                      |
| 换主题立刻改策略     | `setTheme({ ...theme, motion: { enter: 400, exit: 40 } })` → 两个页面的 `motion.enter/exit` 变成 400/40                                                                  |
| **动画本身真的变慢** | 同一主题下打开对话框，逐帧 `motion.body`：0.111 → 0.422 → 0.645 → 0.802 → 0.904 → 0.963 → 0.991 → 0.999 → **1（约 363–413 ms）**；默认 160 ms 时同样采样在约 130 ms 到 1 |
| 页面转场同样吃令牌   | `{ enter: 300, exit: 30 }` → 推进曲线约 282–348 ms 到 1；返回时 `departingAlpha` 20 ms 处 0.867、约 42 ms 变 `none`                                                      |
| 更具体的写法优先     | 主题写 400，`mvvm.configure({ transition: { enter: 90 } })` → 策略读数 **enter 90 / exit 40**（只覆盖 enter，exit 仍吃主题）                                             |
| 换回内置主题         | `setTheme('dark')` → 回到 160/120                                                                                                                                        |
| 减少动效仍然优先     | `prefers-reduced-motion` 或 `transition: false` 之下，主题给多长都是 0（纯函数单测 5 条：主题令牌、显式覆盖、内置回退、减少动效）                                        |

**测试**：`packages/phaser/test/transition.test.ts` 新增 4 条（主题时长、显式时长在三个位置都优先、只写缓动时保留主题时长、无令牌时回退内置值、减少动效折叠）。
