# 验收记录 · 控件画廊（`#/gallery`，第 59 轮）

> 背景：`#/gallery` 是"每个控件、每种状态"的工厂 API 演示页，但此前的验收只有几何（`#status` 里的五个矩形）——**没有任何状态读数**，而且除了 `primary`/`toggle` 之外的按钮**连名字都没有**，焦点读数只能得到 `unnamed`。本轮把这一页做成可断言的，并把它自己 caption 里承诺的键盘操作验一遍。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，页面 `bringToFront()`。

---

## 1. 本轮补的观测能力

- 九个按钮全部**命名**（`primary`/`secondary`/`ghost`/`danger`/`small`/`large`/`disabled`/`loading`/`toggle`）；
- 逐帧发布 `pt.<name>` 与 `st.<name>`（`visualState`），以及 `focusables`（焦点集合的**名字**列表）。

这一页的布局是静态的（没有 `bindVisible` 之类的重排），所以坐标本可以用创建时采样；状态探针才是缺的那一块——"每个控件的每种状态"如果读不出来，验收就无从谈起。

## 2. 实测矩阵

| #   | 断言                               | 实测                                                                                                                           |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 初始状态                           | `primary=focused`（页面主动聚焦它）、`disabled=disabled`、其余 `normal` ✓                                                      |
| 2   | 焦点集合                           | `primary+secondary+ghost+danger+small+large+loading+toggle`——**disabled 不在其中** ✓                                           |
| 3   | 普通按钮悬停/按下/点击             | `danger`：`normal → hover → pressed → hover`，点击后 `focus=danger` ✓                                                          |
| 4   | 禁用按钮拒绝一切                   | 悬停仍是 `disabled`、点击后焦点**不变**（仍是 `danger`）✓                                                                      |
| 5   | loading 按钮拒绝激活但可聚焦       | 点击后 `focus=loading`，`visualState` 不进入 `pressed`（`Button.activate()` 在 loading 时返回 `false`，与指南 03 的说明一致）✓ |
| 6   | 开关按钮鼠标点击                   | `toggle: false → true`，文案随之更新 ✓                                                                                         |
| 7   | **键盘走查**（caption 承诺的行为） | Tab ×7 到达 `toggle`，`Space` → `true`、`Enter` → `false` ✓                                                                    |
| 8   | Tab 顺序与环绕                     | `primary → secondary → ghost → danger → small → large → loading → toggle → primary …`，**跳过 disabled** ✓                     |

第 7 条是这一页自己写下的承诺（"Tab / arrows to move focus · Enter or Space to activate · gamepad supported"）：键盘部分已实测；**手柄部分当时未验证**——第 64 轮起有了答案：`apps/examples/src/fake-pad.ts` 会把 `navigator.getGamepads` 换成一个可编程的假手柄（`main.ts` 装成 `window.fakePad`），整条手柄路径因此可以在浏览器里跑，见 [`ACCEPTANCE-gamepad.md`](./ACCEPTANCE-gamepad.md)。

## 3. 未做的像素验证（诚实记录）

本轮尝试过用"游戏画布取像素"来验证 `Image` 的三种 `fit`（`contain`/`cover`/`fill`）是否真的按预期缩放：在画布里确实找到了贴图的蓝色像素带（约 y 190–224，对应 `contain` 的高 64px 方图），但三种 fit 的像素差异用这种粗采样无法可靠判定，**没有继续**。这部分几何与缩放规则由 `packages/widgets/test/fit.test.ts`（12 个单测）覆盖，像素级验证留给 `scripts/visual-check.mjs`（若要加，需要给这一页设计采样点，见 AGENTS §6 的 `PIXEL_EXPECTATIONS`）。

## 4. 剩余缺口

- **手柄**：`MVVMPlugin` 每帧轮询 0 号手柄。~~浏览器自动化里没有可注入的 Gamepad API~~ **已解决（第 64 轮）**：`apps/examples/src/fake-pad.ts` 替换 `navigator.getGamepads`，浏览器里能驱动整条手柄路径（`nav.ts` 的映射另有 `packages/phaser/test/nav.test.ts` 的 Node 单测，本页的连发速率见 [`ACCEPTANCE-gamepad.md`](./ACCEPTANCE-gamepad.md) §2.3）。真实手柄硬件仍未验。
- 画廊没有覆盖 `Panel({ interactive: true })`（可激活卡片）与 `Image` 的 `fit: 'none'`：两者都已在别的页面/单测出现，但如果要保持"这一页=全部状态"，值得补。

## 5. 门禁

| 命令                           | 结果                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm -r run test`             | **1070** 通过（layout 313 / core 281 / phaser 146 / widgets 330） |
| `pnpm -r run typecheck`        | 5/5                                                               |
| `pnpm exec prettier --check .` | 通过                                                              |
| `pnpm docs:check`              | 通过                                                              |
| `pnpm run build:examples`      | 通过                                                              |
