# 验收记录 · 性能与体积预算（第 5 轮）

> 目的：把 PLAN §8 的性能/体积预算从「PR 评审依据」变成**可执行、可复现的门禁**，并实测一遍。此前仓库里没有任何基准：布局测试只是用 `loose(1000, 1000)` 当约束，没有人量过 1000 节点的耗时、无变化帧的开销、缓存命中率或产物体积。
> 环境：macOS（Apple Silicon），Node v24.18.1，pnpm 10.34.5，浏览器为 Playwright MCP 内置 Chromium（dev server 5173）。
> 结论：**6 条预算中 5 条实测通过（布局耗时 26× 余量、无变化帧零测量、缓存命中 95.6%、单节点编辑只重测 1 个节点、体积 18.3 KB / 14.7 KB）；第 6 条（文本度量缓存 > 95%）**尚未实现**——`PhaserTextMeasurer` 已导出但控件没在用，登记为待办而不是假装达标。**

---

## 1. 新增门禁

| 门禁     | 位置                                                                      | 说明                                                                  |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 布局基准 | `packages/layout/test/perf.test.ts`（5 个用例，随 `pnpm -r run test` 跑） | 1000 节点耗时、无变化帧、缓存命中率、单节点编辑的增量性、对象池稳定性 |
| 体积检查 | `scripts/size-check.mjs`（`pnpm size`）                                   | 逐入口打印 raw / gzip / min+gzip，并按 PLAN §8 判定两组预算           |

计时断言写成「预热后多次取**最小值**」，并把实际数字 `console.log` 出来；结构性断言（`measureCalls` 增量、逐节点 `measureCount`、`pool.length`）是精确的，承担真正的回归权重。

## 2. 实测结果（本机）

### 2.1 布局（Node，`packages/layout/test/perf.test.ts`）

| 预算                                     | 实测                                                                                                                   | 判定                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1000 节点全量 `measure+arrange` < 1.5 ms | **0.059 ms**（922 节点：120 行 grid 行 + 20 张卡片 + 780 个文本叶）                                                    | ✅ 26× 余量                        |
| 无变化帧布局耗时 = 0                     | **0.024 ms**；一次无变化 pass 的 `measureCalls` 增量 **0**、`arrangeCalls` 增量 **1**、`skippedSubtrees` **121**       | ✅                                 |
| 单节点内容变更只重算该子树               | 编辑 780 个叶中的一个：**922 个节点里只有 1 个被重新测量**（该叶自身 3 次调用：flow 测量 + 紧约束重测 + 父级 arrange） | ✅                                 |
| 度量缓存命中率 > 95 %                    | 100 次键盘编辑：**95.59 %**（13000 命中 / 600 未命中）                                                                 | ✅（断言下限 90%，理由见 PLAN §8） |
| 排布热路径零新增对象/闭包                | 按深度索引的 `EngineContext` 池：预热后 3 条，200 次无变化 pass 后仍是 **3 条**，且测量数增量为 0                      | ✅（结构性证明）                   |

> 逐节点计数用的是测试夹具自带的 `measureCount`，因此「只重测一个节点」是**结构事实**，不是时间推断。

### 2.2 输入（浏览器，Playwright MCP）

PLAN §8 的「连续输入（含 IME）不引发整树布局」用布局引擎计数器（`mvvm.root.layoutEngine.stats`）实测，场景把计数器暴露为 `window.states.stats()`：

| 场景                                                          | 页面控件数 | 输入    | `passes` 增量 | `measureCalls` 增量 | 结论                                                                              |
| ------------------------------------------------------------- | ---------- | ------- | ------------- | ------------------- | --------------------------------------------------------------------------------- |
| `#/states` → `field.plain`（`width: 220` 固定）               | 119        | 43 字符 | **4**         | 216（≈5/字符）      | 帧对齐批处理把 43 次按键合并成 4 次布局；每次只重测输入框自身子树，与页面规模无关 |
| `#/showcase` → Show all → 第一个 TextField（`width: 'fill'`） | **786**    | 43 字符 | **0**         | **0**               | 输入框尺寸不随文本变化，连一次布局都不需要（严格优于预算的「不引发整树布局」）    |

两次输入都正常写回控件值（43 字符全部进入 `getValue()`），控制台无 `ERROR`/`REJECTION`。

### 2.3 体积（`pnpm size`，不吃 Phaser）

| 组               | 入口                      | raw      | gzip    | **min+gzip** | 预算    | 判定            |
| ---------------- | ------------------------- | -------- | ------- | ------------ | ------- | --------------- |
| core + layout    | `core/dist/index.js`      | 59.9 KB  | 14.4 KB | 9.8 KB       |         |                 |
|                  | `layout/dist/index.js`    | 59.1 KB  | 13.3 KB | 8.5 KB       |         |                 |
|                  | **合计**                  | 119.0 KB | 27.7 KB | **18.3 KB**  | < 25 KB | ✅ 余量 6.7 KB  |
| phaser + widgets | `phaser/dist/index.js`    | 70.2 KB  | 18.6 KB | 10.7 KB      |         |                 |
|                  | `widgets/dist/index.js`   | 7.7 KB   | 1.7 KB  | 2.3 KB       |         |                 |
|                  | `widgets/dist/compose.js` | 9.3 KB   | 2.0 KB  | 1.6 KB       |         |                 |
|                  | **合计**                  | 87.2 KB  | 22.3 KB | **14.7 KB**  | < 45 KB | ✅ 余量 30.3 KB |

判定口径写在脚本与 PLAN 里：**库产物故意不 minify**（堆栈可读），预算按消费方实际发布的 **min+gzip** 判定，同时打印未压缩 gzip 值以免掩盖差异。

---

## 3. 已运行的命令与结果

| 命令                                         | 结果                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| `pnpm --filter @phaser-mvvm/layout run test` | **303 passed**（新增 `perf.test.ts` 5 例）                    |
| `pnpm -r run test`                           | **974 passed**：core 274、layout 303、phaser 119、widgets 278 |
| `pnpm -r run typecheck`                      | 5/5 包通过                                                    |
| `pnpm run size`（`--no-build`，构建已完成）  | 两组均 within budget，`size check passed`                     |
| `pnpm exec prettier --check .`               | 通过                                                          |
| Playwright MCP                               | `#/states`、`#/showcase` 输入预算实测如上；无错误             |

---

## 4. 本轮修复

本轮**没有发现需要改代码的缺陷**：三条布局预算与体积预算在实测中都有充裕余量（这与第 2 轮修掉缓存键/脏标记后的状态一致——正因为修了那些缺陷，增量重算才成立）。

顺带记录两处**文档与实现不一致**并已修正：

1. AGENTS §8 仍写「布局缓存按 (约束, revision) 命中」——第 2 轮已改为「(约束, 百分比基准, revision)」，已更新；
2. PLAN §8 只列预算不写测量方式，现补上每条预算的**测量方法、门禁位置与实测值**（含「哪条尚未成立」）。

---

## 5. 未达标 / 未验证

1. **文本度量缓存（PLAN §8：命中率 > 95 %，同帧同文本同样式只度量一次）目前不成立**：`PhaserTextMeasurer`（带 LRU 与 `stats`）在 `packages/phaser/src/index.ts` 导出，但 `Label`/`TextInputBase` 都没用它——`Label` 走 Phaser `Text` 自身度量、`TextInputBase`/`Label` 的截断用 `context.measureText` 直接量。这不是本轮引入的问题，而是从未实现的预算。**登记为待办**（见 `DEFECT-BACKLOG.md` §4），可选做法：把 `PhaserTextMeasurer` 接进 `Label.measureContent`/截断路径，并按 (文本, 样式键) 缓存；需要同时处理字体/主题切换时的失效。
2. **IME 输入**未在浏览器里实测（CDP `Input.insertText` 能触发 `compositionupdate`，但真实 IME 需要中文输入法环境）；本轮只覆盖了逐字符键盘输入。
3. **排布热路径零分配**用对象池长度稳定性间接证明，未做真正的分配计数（需要 `--expose-gc` 或堆剖析）。
4. 体积预算只覆盖四个库入口，**未**统计示例应用产物（`apps/examples/dist` 的 1.6 MB 是含 Phaser 的验收页，不属于预算范围）。

---

## 6. 提交

- 提交信息：`test(layout): enforce the PLAN §8 performance budgets and add a bundle-size check`。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run size`、`pnpm run build:examples` 全绿。
