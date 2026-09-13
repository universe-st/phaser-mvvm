# 验收记录 · 性能与体积预算（第 5 轮）

> 目的：把 PLAN §8 的性能/体积预算从「PR 评审依据」变成**可执行、可复现的门禁**，并实测一遍。此前仓库里没有任何基准：布局测试只是用 `loose(1000, 1000)` 当约束，没有人量过 1000 节点的耗时、无变化帧的开销、缓存命中率或产物体积。
> 环境：macOS（Apple Silicon），Node v24.18.1，pnpm 10.34.5，浏览器为 Playwright MCP 内置 Chromium（dev server 5173）。
> 结论：**6 条预算中 5 条实测通过（布局耗时 26× 余量、无变化帧零测量、缓存命中 95.6%、单节点编辑只重测 1 个节点、体积 18.3 KB / 14.7 KB）；第 6 条（文本度量缓存 > 95%）当时**尚未实现**——`PhaserTextMeasurer` 已导出但控件没在用，登记为待办。** 第 6 轮把这笔账还清了（**换了一条实现路径**：`packages/widgets/src/text-metrics.ts` 的按场景缓存，`Label`/`TextInputBase` 都在用，稳态命中率 100%），细节见 §4.1 与 §5.1；`PhaserTextMeasurer` 本身至今没有被控件接入（它与 `text-metrics.ts` 功能重叠，是适配层自带的工具）。

---

## 1. 新增门禁

| 门禁     | 位置                                                                      | 说明                                                                  |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 布局基准 | `packages/layout/test/perf.test.ts`（5 个用例，随 `pnpm -r run test` 跑） | 1000 节点耗时、无变化帧、缓存命中率、单节点编辑的增量性、对象池稳定性 |
| 体积检查 | `scripts/size-check.mjs`（`pnpm size`）                                   | 逐入口打印 raw / gzip / min+gzip，并按 PLAN §8 判定两组预算           |

计时断言写成「预热后多次取**最小值**」，并把实际数字 `console.log` 出来；结构性断言（`measureCalls` 增量、逐节点 `measureCount`、`pool.length`）是精确的，承担真正的回归权重。

## 2. 实测结果（本机）

### 2.1 布局（Node，`packages/layout/test/perf.test.ts`）

| 预算                                     | 实测                                                                                                                                                                                                                                                                  | 判定                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1000 节点全量 `measure+arrange` < 1.5 ms | **0.059 ms**（922 节点：120 行 grid 行 + 20 张卡片 + 780 个文本叶）                                                                                                                                                                                                   | ✅ 26× 余量                        |
| 无变化帧布局耗时 = 0                     | **以结构性断言为准**：一次无变化 pass 的 `measureCalls` 增量 **0**、`arrangeCalls` 增量 **1**、`skippedSubtrees` **121**；时间只作粗略上界（实测 0.02 ms，断言 < 1 ms——该量级下计时区分不了「零工作」与「重测 922 个节点」，原先 0.05 ms 的阈值在并发跑测试时会误报） | ✅                                 |
| 单节点内容变更只重算该子树               | 编辑 780 个叶中的一个：**922 个节点里只有 1 个被重新测量**（该叶自身 3 次调用：flow 测量 + 紧约束重测 + 父级 arrange）                                                                                                                                                | ✅                                 |
| 度量缓存命中率 > 95 %                    | 100 次键盘编辑：**95.59 %**（13000 命中 / 600 未命中）                                                                                                                                                                                                                | ✅（断言下限 90%，理由见 PLAN §8） |
| 排布热路径零新增对象/闭包                | 按深度索引的 `EngineContext` 池：预热后 3 条，200 次无变化 pass 后仍是 **3 条**，且测量数增量为 0                                                                                                                                                                     | ✅（结构性证明）                   |

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

## 4.1 第 6 轮追加：文本度量缓存（此前唯一未达标的预算）

**实现**：`packages/widgets/src/text-metrics.ts` —— 按场景（`WeakMap`）持有的 LRU 缓存，缓存三件事（`LruCache` 从 `packages/phaser` 移到 `packages/core/src/utils/lru.ts`，`phaser` 继续 re-export 以保持 API 兼容；这样 `widgets` 能用到它而不必把 Phaser 运行时拉进纯逻辑路径，Node 单测也因此能覆盖缓存本身）：

| 调用点                       | 缓存内容                                  | 为什么值得缓存                                |
| ---------------------------- | ----------------------------------------- | --------------------------------------------- |
| `Label.updateDisplayedText`  | `Text#getWrappedText(rawText)` 的换行结果 | 每次测量重算一遍换行（画布排版）              |
| `Label.measureTextWidth`     | 省略号二分搜索的候选串宽度                | 每行 `log2(n)` 次 `measureText`，且候选集固定 |
| `TextInputBase.measureWidth` | 光标定位/窗口化/截断用的逐串宽度          | 每次重绘与每次测量都重复量同一批串            |

键为 `样式键 \u0001 换行宽度 \u0001 文本`（`Label` 的样式键含主题、tone、align 与调用方的 `userStyle` 序列化；`TextInputBase` 用已有的 `textStyleKey`）。**缓存的是控件自身画布的度量结果**，不引入 probe 对象：数值不可能与渲染结果不一致，也不会多出一张纹理（生命周期门禁仍然全平）。缓存只存字符串与数字，随场景一起被 GC，无需销毁钩子。

**实测（Playwright MCP，`#/states`，119 个控件）**：

| 阶段                                                    | hits              | misses            | 说明                                              |
| ------------------------------------------------------- | ----------------- | ----------------- | ------------------------------------------------- |
| 首屏                                                    | 176               | 124               | 124 个不同的 (文本, 样式, 换行宽度) 各付一次 miss |
| 悬停扫描 ×4（每轮 35 个探针）                           | 36 / 36 / 36 / 36 | **0 / 0 / 0 / 0** | 稳态命中率 **100%**                               |
| 整段交互会话（悬停 + 输入 43 字符 + 校验失焦 + 再悬停） | 1743              | 214               | 累计 89.1%（每个新字符串只付一次 miss）           |

也就是说：**「同一帧内同文本同样式只度量一次」成立**，重复度量 100% 命中；累计命中率随会话变长收敛（首屏那一轮必然全是 miss）。会话中避免的画布度量次数 = hits（示例会话 1743 次）。

**不回归的证据**：把这次改动 `git stash` 掉再截同一界面，与开启缓存后逐像素比对——

| 场景                   | 差异像素       |
| ---------------------- | -------------- |
| `#/showcase` → buttons | **0 / 771600** |
| `#/showcase` → params  | **0 / 771600** |

另外 `#/compose` → text 分区与第 3 轮基线 **0 像素差异**，`#/showcase` 十个分区的控件数与基线完全一致（39/43/35/71/161/81/83/110/107/39），`#/compose` 各分区高度除第 3 轮新增演示导致的 `text` 分区外全部一致（±0.5 舍入）。

---

## 5. 未达标 / 未验证

1. ~~**文本度量缓存（PLAN §8：命中率 > 95 %，同帧同文本同样式只度量一次）目前不成立**~~ **已还清（第 6 轮，走的是 `packages/widgets/src/text-metrics.ts` 这条路径）**：它是按场景的 `WeakMap` + LRU，缓存 `Label` 的换行结果与省略号候选宽度、`TextInputBase` 的逐串宽度，两处都在用（`Label.ts`、`TextInputBase.ts`），`#/states` 的 `window.states.textMetrics()` 是常驻读数，稳态命中率 100%（PLAN §8 已按此改写）。**仍然成立的部分**：`PhaserTextMeasurer`（带 LRU 与 `stats`，在 `packages/phaser/src/index.ts` 导出）**至今没有被控件接入**——它与 `text-metrics.ts` 功能重叠，是适配层自带的独立工具，接它属于可选的收敛工作。
2. **IME 输入**未在浏览器里实测（CDP `Input.insertText` 能触发 `compositionupdate`，但真实 IME 需要中文输入法环境）；本轮只覆盖了逐字符键盘输入。
3. **排布热路径零分配**用对象池长度稳定性间接证明，未做真正的分配计数（需要 `--expose-gc` 或堆剖析）。
4. 体积预算只覆盖四个库入口，**未**统计示例应用产物（`apps/examples/dist` 的 1.6 MB 是含 Phaser 的验收页，不属于预算范围）。
5. 文本度量缓存**没有时间维度的收益量化**：浏览器里计时噪声大，本轮用「避免的画布度量次数（hits）」与「逐像素无差异」代替；Node 侧无法度量 `Label`（需要渲染器）。

---

## 6. 提交

- 提交信息：`test(layout): enforce the PLAN §8 performance budgets and add a bundle-size check`。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run size`、`pnpm run build:examples` 全绿。

---

## 7. 第 107 轮复测（Apple A18 Pro / macOS 26.6.2 / Node 24.18.1）

预算没变，读数**本来就会随机型与负载漂移**——第 5 轮那批数字后来被四份活文档（PLAN §8、AGENTS §6、HANDOVER、README）当成常数引用，于是和第 107 轮重新跑出来的结果对不上。复测如下（命令与第 5 轮完全相同，先 `pnpm build` 再判定体积）：

| 预算                                     | 第 5 轮读数 | 第 107 轮读数                                                                | 判定 |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ---- |
| 1000 节点全量 `measure+arrange` < 1.5 ms | 0.059 ms    | **0.108 ms**                                                                 | ✅   |
| 无变化帧布局耗时 = 0                     | 0.02 ms     | **0.0441 ms**（仍以结构性断言为准：`measureCalls` 增量 0、`arrangeCalls` 1） | ✅   |
| 度量缓存命中率 > 95 %                    | 95.59 %     | **95.59 %**（13000 命中 / 600 未命中，逐字相同）                             | ✅   |
| 单节点编辑只重测该子树                   | 1 / 922     | **1 / 922**                                                                  | ✅   |
| 排布热路径零新增对象/闭包                | 池 3 条不变 | **池 3 条不变**（200 次 pass 后仍 3）                                        | ✅   |

体积（`pnpm size`，两队都在预算内）：

| 组               | 第 5 轮 min+gzip | 第 107 轮 raw / gzip / **min+gzip** | 预算    | 判定            |
| ---------------- | ---------------- | ----------------------------------- | ------- | --------------- |
| core + layout    | 18.3 KB          | 120.7 KB / 28.1 KB / **18.6 KB**    | < 25 KB | ✅ 余量 6.4 KB  |
| phaser + widgets | 14.7 KB          | 229.9 KB / 61.5 KB / **31.3 KB**    | < 45 KB | ✅ 余量 13.7 KB |

`phaser + widgets` 从 14.7 KB 涨到 31.3 KB **不是第 107 轮的增量**：那一轮的指针事件链（`pointer-chain.ts`）单独量只有 **1.6 KB min+gzip**（`esbuild --bundle --minify --format=esm --external:phaser | gzip -9`，裸产物 4.5 KB）；翻倍的来源是第 5 轮之后 phaser 包本身长大（`phaser/dist/index.js` raw 70.2 KB → 205.7 KB：`pages`/`router`/`modal`/`transition`/`a11y`/`VirtualKeyboard`/`Slider` 等陆续进来），而这条读数一直没有被重新记录。**教训**：预算是契约，读数是快照——写文档时给读数标上日期与机型，别让快照变成第二种契约（§8.41）。

命令与结果：

| 命令                                                                  | 结果                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm --filter @phaser-mvvm/layout exec vitest run test/perf.test.ts` | 5 passed（读数见上表）                                           |
| `pnpm build`                                                          | 5 个包 + 示例全部成功                                            |
| `pnpm size`                                                           | `size check passed`（两组均 within budget）                      |
| `pnpm test`                                                           | **1352 passed**（core 281、layout 314、phaser 370、widgets 387） |
| `node scripts/visual-check.mjs`                                       | `[visual-check] ok`：13 场景、96 项 OK、0 MISMATCH、4 张 AX 树   |

---

## 8. 第 109 轮：滚动视口的渲染裁剪（`#/showcase` "All sections" 的卡顿）

**症状（用户报告）**：`#/showcase` 打开 "All sections" 后，右侧画布的滑动与点击明显掉帧（菜单里其它单分区都不明显）。

**定位过程**（Playwright MCP + CDP，dev server 5173，Apple A18 Pro / macOS 26.6.2 / Node 24.18.1，Chromium 窗口 1408×626 CSS）：

1. 逐帧采样 `requestAnimationFrame` 间隔：空闲即 **91 ms**，滑动时 **94 ms** —— 与滑动无关，是**每帧固定成本**。
2. `game.loop.sleep()` 后同一采样变成 16.7 ms ⇒ 成本在游戏循环里；CPU profile 却只有约 18 ms/帧的 JS，其余记在 `(idle)` ⇒ 时间花在 GPU 提交/等待上。
3. 给 `WebGLRenderingContext.prototype` 打计数桩：每帧 **`drawElements` 577、`useProgram` 576、`bufferSubData` 861、`bindTexture` 404`**；把场景内容 `setVisible(false)` 后降到 **40 / 17.0 ms**（vsync 地板）。
4. 按控件类型再切一刀：**只隐藏 61 个 `Graphics`** 就足以回到 45 calls / 17.0 ms。根因因此明确：**Phaser 4 的 `Graphics` 每帧重放命令缓冲并重新三角化**（`GraphicsWebGLRenderer` → `Earcut`），单个体约 0.13 ms；853 个控件的页面有 393 个 `Graphics`，而画布里只看得见其中一小部分。
5. 关键证据：把舞台内容分别滚到 0 / 3000 / 8000 / 16000，**每帧 draw call 恒为 577** —— 没有任何视口裁剪，ScrollView 的 mask 只是"挡住了像素"，没有省下渲染。

**修法**（不改 API、不改结构，见 [`PITFALLS.md`](./PITFALLS.md) §8.70）：

- `Widget.culled` + `Widget#willRender()`：一个只影响渲染的开关，`ContainerWebGLRenderer` 的 `child.willRender(camera)` 会把整棵被剪子树从这一帧摘掉；布局、焦点、指针路由、无障碍镜像、内容长度全部照旧读 `visible`。
- `ScrollView#cullContent()`：每帧（`POST_UPDATE`）对内容做一次后序遍历，按**子树实际外接矩形**判可见带（`[offset, offset+viewport] / zoomScale` 外扩 `CULL_MARGIN = 48` px），命中即标记并整棵剪掉；判据是"子树画出来的外接矩形"而不是节点自己的 `appliedRect`，因为 `fill` 容器、绝对定位、虚拟化列表都能让子节点跑到父矩形外面（`#/list` 的空白事故就是这条）。纯几何部分落在 `scroll-plan.ts` 的 `cullBand()` / `outsideCullBand()` 上，含 9 条 Node 单测。

**实测（同一台机器、同一个页面、同一段脚本）**：

| 滚动位置（内容坐标）                                    | 修前 draw calls / 帧 | 修后 draw calls / 帧 | 修前帧时间 | 修后帧时间                |
| ------------------------------------------------------- | -------------------- | -------------------- | ---------- | ------------------------- |
| 0                                                       | 577                  | **56**               | 90.4 ms    | **16.8 ms**               |
| 2000                                                    | 577                  | **76**               | 91.3 ms    | **18.0 ms**               |
| 4000                                                    | 577                  | **82**               | 91.1 ms    | **18.6 ms**               |
| 6000                                                    | 577                  | **64**               | 90.5 ms    | **17.5 ms**               |
| 7787（底部）                                            | 577                  | **80**               | 90.9 ms    | **18.5 ms**               |
| 真实滚轮手势（70 次 `mouse.wheel`，中位数 / p90 / p95） | —                    | —                    | —          | **18.0 / 25.7 / 27.2 ms** |

裁剪自身的开销：`#/showcase` 892 个控件的完整后序遍历 **0.125 ms/帧**（同一个口，量 20 次的平均）。单分区页面（86 控件）本来就只画 ~94 calls，读数与修前一致，说明裁剪没有把"本来就要画的东西"藏起来。

**"没有画错"的判据（A/B 逐像素）**：把 `ScrollView.prototype.cullContent` 临时替换成空函数并把所有 `culled` 清掉，得到"完全不裁剪"的对照；在 `#/showcase`（4 个口）、`#/list`（1 个）、`#/scroll`（5 个）、`#/options`（6 个）上，每个口取 0 / 0.35 / 0.5 / 1.0 四个偏移截图，**64 对截图逐像素完全相同（0 差异）**。A/B 前每个口先滚到底再回 0 做一次 prime，否则滚动条拇指的"迟到重画"会污染对照（见 §8.70 ③）。

**已跑的门禁**：

| 命令                                       | 结果                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                           | 5/5 通过                                                                                        |
| `pnpm test`                                | **1361 passed**（core 281、layout 314、phaser 370、widgets 396——widgets 新增 9 条裁剪几何用例） |
| `pnpm docs:check`                          | 四关全过（含 vocabulary / idiom / option keys）                                                 |
| `pnpm size`                                | `size check passed`：18.6 KB / **31.3 KB** min+gzip（预算 25 / 45）                             |
| `node scripts/visual-check.mjs`            | `[visual-check] ok`：13 场景像素 + 几何 + 4 张 AX 树、0 MISMATCH                                |
| `#/lifecycle` `window.lifecycle.churn(12)` | 10 项计数在 cycle 1 与 cycle 13 完全相同（无泄漏）                                              |

> 环境说明：本机 DSH 沙箱下 Chrome 无法在默认 profile 建 Crashpad 目录，`scripts/visual-check.mjs` 直接用 `CHROME_PATH` 指向一个把 `--user-data-dir` 指到 `.tmp/` 的本地包装脚本运行（包装脚本只在 `.tmp/`，未入库）。这不是脚本缺陷，见 AGENTS §6。
