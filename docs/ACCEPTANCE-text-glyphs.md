# 验收记录 · 文字下缘被截断（用户报告，第 53 轮）

> 用户报告：文本控件里 `Danger` / `Success` / `Warning` 这类词的小写 `g` 尾巴被截掉一小块（截图见 `~/Desktop/QQ20260912-212157.png`）。本轮定位、修复并量化验证。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173。

---

## 1. 现象与定位

`screenshot` 里只有**带下伸部**的字母（`g`）被切，且切口是**水平直线**——这是字体度量/画布尺寸问题，不是绘制顺序问题。实测 `#/compose` 的 `Text('Danger', { tone: 'danger' })`：

| 量                                         | 值                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| 主题字号                                   | `16px`                                                                         |
| Phaser 量到的字体度量（测试串 `\|MÃ‰qgy`） | `ascent 14.6` + `descent 3.0` = **17.6**                                       |
| 文本画布高度                               | `h = Math.max(fontSize,1)` → **17.57**，赋给 `canvas.height` 时被**截断为 17** |
| 基线位置                                   | 距画布顶 `ascent = 14.6`                                                       |
| 因而基线以下可用空间                       | `17 − 14.6 = 2.4px`                                                            |
| `g` 实际需要的下伸                         | **2.97px**（浏览器 `measureText` / 逐行扫描实测）                              |

即：**每行文字底部被切掉约 0.57px**，正好是用户看到的那一小块。而且 `Label` 把自己量到的 `textObject.height`（也是这个被截断的高度）报给布局，所以**布局也少留了 1px**。

## 2. 修法

新增 `packages/widgets/src/text-padding.ts`：

```ts
/** 顶部与底部各留一点，盖住画布取整损失与字形光栅溢出（按字号 8% 缩放，至少 1px）。 */
export function glyphPadding(fontSize: number): number;
```

`Label` / `Button` / `TextInputBase` 在应用主题样式后调用 `setPadding(pad, pad, pad, pad)`。**对称**填充是关键：字形基线随 `top` 下移，而盒子上下同时长高，所以文字的光学中心**不动**（`Label` 的居中算法用整个文本高度，两者恰好抵消）。

`Label.applyGlyphPadding()` 从**生效的**字号计算（`fontSizeOf(textObject.style, theme.fontSize.md)`），所以 `style: { fontSize: '26px' }` 这种覆盖也会跟着放大填充。

## 3. 量化验证（A/B，同一标签、同一坐标）

对 `#/compose` 的 `Danger` 标签把游戏画布区域拷贝到 2D 画布，逐行统计墨迹像素：

|                                 | 盒子高度 | 墨迹行数 | 末尾行像素           |
| ------------------------------- | -------- | -------- | -------------------- |
| 修复前（`glyphPadding` 返回 0） | **17.5** | **15**   | `… 35, 10, 7`        |
| 修复后（`pad = 1`）             | **19.5** | **16**   | `… 39, 35, 10, 7, 7` |

多出来的那一行就是原先被切掉的 `g` 尾巴（7 像素宽的两笔）。修复后墨迹**完整收在盒子内**，盒子下方三行全为 0。

## 4. 副作用（已确认是想要的）

- 每个文字盒子在 16px 下**高 2px**（= 上下各 1px）；26px 的标题高 4px。这同时修掉了「布局少留 1px」的问题。
- 布局的黄金快照不受影响（`packages/layout` 用等宽假测量器，只认注入的 `Measurer`）。
- 逐像素门禁 4 个场景全绿（`node scripts/visual-check.mjs` → `ok`，`hud.score` 采样点随文字盒高变化 2px，但断言读的是 `#status` 里的实际矩形，所以自动跟随）。
- 交互与泄漏门禁：`#/states` 悬停/按下/点击/输入正常；`#/lifecycle` `churn(6)` 每项计数单值、重启后仍可点。

## 5. 门禁

| 命令                            | 结果                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `pnpm -r run test`              | **1049** 通过（layout 313 / core 281 / phaser 145 / widgets 310） |
| `pnpm -r run typecheck`         | 5/5                                                               |
| `pnpm exec prettier --check .`  | 通过                                                              |
| `pnpm run build:examples`       | 通过                                                              |
| `node scripts/visual-check.mjs` | 4 个场景全绿                                                      |
