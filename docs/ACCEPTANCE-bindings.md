# 验收记录 · 绑定层状态机（`#/bindings`，第 58 轮）

> 背景：`#/bindings` 是绑定层（`bindText`/`bindEnabled`/`bindError`/`bindVisible`/`bindCommand` + `computed` 派生）的演示页。绑定逻辑在 Node 单测里覆盖得不错（`packages/core/test/binding.test.ts`），但这页**端到端**从没验过。本轮补上可断言能力并跑完整状态机——顺带排除了一个看起来像框架缺陷的现象。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，页面 `bringToFront()`。

---

## 1. 本轮补的观测能力

页面原本用 `reportControl()` 报坐标——**创建时采样一次**。这一页的布局会随绑定变化（`bindVisible` 把 `details` 面板折叠/展开会把下面的按钮行整行推动），于是展开一次之后 `pt.details`/`pt.busy` 全都指向别处，第二次点击"没反应"。

改为逐帧发布（与 `#/states` 同款）：`pt.<key>` 每帧刷新，并新增 `st.<key>`（`add`/`remove`/`details`/`busy`/`replace` 的 `visualState`）。规则已写进 `apps/examples/src/demo.ts` 的 `reportControl` 文档与 `AGENTS.md` §6：**布局会移动的页面必须逐帧发布坐标**。

## 2. 状态机实测

| #   | 操作                                                  | 期望                                      | 实测                                                                                  |
| --- | ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | 初始                                                  | 0 件、价格 0.00、无错误                   | `count=0 price=0.00 invalid=false st.add=normal` ✓                                    |
| 2   | 连点 Add ×4                                           | 每次重算派生值                            | `1/19.50` → `2/39.00` → `3/58.50` → `4/78.00`，`invalid=false` ✓                      |
| 3   | 加到第 9 件                                           | `bindEnabled` 关掉按钮、`bindError` 标红  | `count=9`、`invalid=true`、`st.add=**disabled**`；继续点不再增加 ✓                    |
| 4   | 连点 Remove 到 0                                      | 0 时按钮自禁用                            | `count=0`、`st.remove=**disabled**` ✓                                                 |
| 5   | 展开 details                                          | `bindVisible` 让面板重新占位              | `details=true`，下方按钮行 y **329 → 391** ✓                                          |
| 6   | 再收起                                                | 行回到原位                                | `details=false`，y 回到 **329** ✓                                                     |
| 7   | 点 "Simulate request"（`bindCommand` + `canExecute`） | 进行中 `busy=true` 且按钮禁用，完成后恢复 | 150ms 后 `busy=true`、`st.busy=**disabled**`；1.2s 后 `busy=false`、`st.busy=hover` ✓ |
| 8   | 点 "Replace view"                                     | 页面重建后绑定重新接上、数据存活          | `count` 保持、再点 Add → `count=2 price=39.00` ✓                                      |

## 3. 排除了一个"疑似框架缺陷"

第 5/6 步第一次跑时读到 `details: false → true → **true**`（第二次切换没生效），且 `busy` 命令似乎没触发。换成逐帧坐标后两处都正常——原因是上面的创建时坐标：布局位移后，第二次点击落到了被挤过来的相邻控件上。**结论：框架行为正确，问题在验收页的可断言性**；这条经验已固化为上面的规则，避免以后再把它当缺陷排查。

## 4. 门禁

| 命令                           | 结果                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm -r run test`             | **1070** 通过（layout 313 / core 281 / phaser 146 / widgets 330） |
| `pnpm -r run typecheck`        | 5/5                                                               |
| `pnpm exec prettier --check .` | 通过                                                              |
| `pnpm docs:check`              | 通过                                                              |
| `pnpm run build:examples`      | 通过                                                              |
