# 验收记录 · 布局引擎缺陷修复批次（第 2 轮）

> 目的：处理第 1 轮两次只读审计在 `packages/layout` 中发现的 8 项缺陷（其中 1 项 HIGH），以及控件层 2 项 MED 缺陷；全部要求「先复现 → 修根因 → 有回归测试 → 在 Playwright MCP 上确认没有回归」。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server `http://localhost:5173`。
> 结论：**L1–L8 全部修复并带回归测试；W2 先在真实浏览器里复现（偏移 224.5 / limit 0）再修复并复测通过；W1 增加祖先回退与明确告警。布局黄金快照零漂移，全仓 959 个用例通过。**

---

## 1. 本轮修复的缺陷

### 1.1 `packages/layout`（引擎）

| #   | 严重度   | 缺陷（审计发现）                                                                                                                                                     | 修法                                                                                                                                                                                                   | 回归测试                                                                                                                                                        |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | HIGH/MED | 测量缓存键只有「约束 + 修订号」，**缺百分比基准**：同一引擎换一个包含块仍命中原答案（400 基准得 200，改 100 基准仍是 200，新引擎才是 50）                            | 缓存键改为 `约束｜base.width x base.height`                                                                                                                                                            | `engine: measurement cache › keys the cache by the percentage base as well as the constraint`                                                                   |
| L2  | MED      | `layout()` 在**结尾**清脏标记，pass 运行期间产生的 `invalidate()`（来自 `measureContent`/`applyRect`/同步 watcher）被静默丢弃 → 永久陈旧几何、后续 pass 测量次数为 0 | pass **开始**时把待处理标记移入 `activeDirty`/`activeDirtyPath`（本趟使用），pass 期间新产生的标记留在 `dirty`/`dirtyPath` 供下一趟；`measureNode` 与 `placeChildOf` 改读这两组                        | `keeps an invalidation raised during the pass for the next pass`                                                                                                |
| L3  | MED      | `reset()`（字体/主题全局变更）只丢缓存不标脏，且 arrange 仍跳过干净子树 → 无修订号变化的内容尺寸改动永远不生效                                                       | `reset(node)` 递归丢缓存 + 标脏子树 + 向上 `invalidate`；无参 `reset()` 额外自增 generation，使所有已存矩形失效                                                                                        | `re-arranges after reset() even when no revision changed`、`re-arranges a subtree after reset(node)`、两条既有 reset 缓存断言同步更新语义（子树 = 自身 + 后代） |
| L4  | MED      | `contextPool` 的 `contextDepth` 只增不减，池退化为「每访问一个容器槽位一条」并强引用 `ctx.node`/`ctx.children` → 已脱离的子树无法回收，违背 ADR/AGENTS 的 GC 门禁    | 容器测量/排布返回后 `releaseContext()`：深度回退 + 清空 `node`/`children` 引用                                                                                                                         | `releases the pooled contexts, so a detached subtree is not retained`（断言池长 ≤ 嵌套深度且 `node` 均为 null）                                                 |
| L5  | MED      | `'stretch'`（以及 `fill`）直接给整行/整格长度，**丢掉子节点交叉轴 min/max**，与 measure 阶段自相矛盾（`maxWidth: 50` 在 200 宽容器里得 200）                         | box `placeLine`、grid `placeInCell` 拉伸/填充时按子节点交叉轴 `min/max`（含 `{ value, min, max }` 额外钳制）夹取，新增无分配的 `axisMinOf`/`axisMaxOf`                                                 | `box: stretch honours the child cross-axis clamps`（max / min / `{value,max}` 三个用例）                                                                        |
| L6  | LOW      | `min > max` 有两套策略：`constraint.enforce` 取中点（既不满 min 也不满 max，且嵌套测量时反复漂移），`geom.clamp` 取 min                                              | 统一为 **min 胜出**（与 `clamp` 一致，同 CSS）                                                                                                                                                         | `constraint: contradictory min/max › lets min win, matching geom.clamp`、`is idempotent`                                                                        |
| L7  | LOW      | NaN/Infinity 长度与 `dpr <= 0` 静默传播成 NaN 矩形（`width: NaN` → rect NaN；`minWidth: Infinity` → Infinity；`dpr: 0` → 全部 NaN）                                  | `resolveLength` 非有限数字视为 `'auto'`；`normalizeParams` 对长度单位与 `{value,min,max}` 钳制做 `finiteOr`；`normalizeBound` 丢弃非有限边界；`resolveOwnLength` 兜底；引擎构造时 `dpr` 非法则回落到 1 | `treats a non-finite length as auto instead of spreading NaN into the rect`、`clamps a non-positive dpr to 1`、`params: non-finite values`（2 例）              |
| L8  | LOW      | `layout()` 返回缓存内部持有的 `Size` 对象，调用方改写即污染缓存（`size.width = 999` 后不再重测）                                                                     | `layout()` 在边界处复制一份返回                                                                                                                                                                        | `does not let a caller corrupt the cache through the returned size`                                                                                             |

`docs/PLAN.md` §4 的两条与之冲突的表述（缓存键、排布重算）已同步更新，并补上「脏标记消费时机」一条；`docs/guide/02-layout.md` 补充了 `stretch`/`fill` 受子节点 min/max 约束的说明。

### 1.2 `packages/widgets`（控件）

| #   | 严重度 | 缺陷                                                                                                                                                                      | 修法                                                                                                                                                                 | 验证                                                                                            |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| W2  | MED    | `ScrollView` 只在偏移**移动**时夹取；视口变大或内容变短后 `currentY > limitY` 会一直保留（内容停在越界位置、露出空白），`thumbGeometry` 又把 progress 夹到 [0,1] 掩盖问题 | `sync()` 里每帧重算 content extent 后，若未拖拽/未惯性且越界，则 `setOffset(current, current)`（夹取 + 重排内容 + 发 `scroll`；`bounce: true` 时仍由回弹接管）       | **先在真实浏览器复现再修**，见 §3.2                                                             |
| W1  | MED    | `Repeat` 的 `viewportSize()` 在自身与父容器高度都为 0 时返回 0 → 虚拟窗口塌成 `overscan` 行（`overscan: 0` 时 0 行），而 `maxOffset` 仍声称整表可滚，且无任何提示         | 高度都不可解析时向上寻找第一个有高度的祖先（通常是包裹它的 `ScrollView` 视口）；确实没有时给出明确告警（且只在**已经历过一次布局**后才告警，避免新建列表首帧的误报） | 虚拟化在 `#/compose`（12/200）与 `#/showcase`（10/200，滚到底）两处实测仍正常；控制台无框架告警 |

---

## 2. 已运行的命令与结果

| 命令                                         | 结果                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm --filter @phaser-mvvm/layout run test` | **294 passed**（含 4 条黄金快照用例，零漂移）                                 |
| `pnpm -r run test`                           | **959 passed**：core 270、layout 294、phaser 116、widgets 275（0 失败）       |
| `pnpm -r run typecheck`                      | 5/5 包通过                                                                    |
| `pnpm exec prettier --check .`               | 通过                                                                          |
| `pnpm run build:examples`                    | 通过                                                                          |
| Playwright MCP（`#/compose`、`#/showcase`）  | 两个场景 10+10 个分区全部渲染、切换、交互正常，`#status` 无 `ERROR/REJECTION` |

新增测试分布：`test/engine.test.ts` +7（缓存基准、pass 内失效、reset ×2、返回值隔离、上下文释放、非有限长度、dpr）、`test/box.test.ts` +3（拉伸钳制）、`test/constraint.test.ts` 重写并新增 2 例、`test/params.test.ts` +2（非有限值）。

---

## 3. Playwright MCP 实测证据

### 3.1 无回归

| 检查                           | 结果                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#/compose` 10 个分区依次切换  | 每次 `section=<id>`、主机宽高非零、`parity=ok`、无错误                                                                                             |
| `#/showcase` 10 个分区依次切换 | 控件数与修复前一致（text 39 / buttons 43 / inputs 35 / decoration 71 / box 161 / grid 81 / stack 83 / params 110 / repeat 107 / focus 39），无错误 |
| `#/showcase` 按钮分区截图对比  | 与修复前逐像素观感一致（按钮宽度、间距、图标按钮位置不变）                                                                                         |
| 虚拟化列表                     | `#/compose` 200 行渲染 12 行；`#/showcase` 200 行滚到底渲染 10 行（窗口随偏移移动）                                                                |
| 控制台                         | 无框架告警（`Repeat` 视口告警在正常路径不触发）                                                                                                    |

### 3.2 W2 复现与修复对比（同一操作序列）

操作：`#/showcase` → `show('box')`（内容 819px）→ 视口 1200×643（视口高 595）→ 滚动到底 → 把窗口拉高到 1200×943（视口高 895 > 内容 819，limit 应为 0）。

| 阶段             | 修复前                                                         | 修复后                                      |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------- |
| 停靠（视口 595） | `offset=224.5, limit=224.5`                                    | `offset=224, limit=224`                     |
| 拉高窗口后       | `offset=224.5, limit=0, outOfRange=true`（内容悬空、下方空白） | `offset=0, limit=0, outOfRange=false`       |
| 再拉回 643       | —                                                              | `offset=0, limit=224`（可再次滚动）         |
| 再次滚到底       | —                                                              | `offset=224, limit=224`（滚动能力未被破坏） |

---

## 4. 未修 / 未验证

1. **`docs/DEFECT-BACKLOG.md`** 剩余项：`ScrollView` 视口混用（W4，待渲染环境实测确认）、`ThumbGeometry.position` 文档与实现不符（W3，纯文档）、以及 §3 的 7 条「待验证」疑似项（相机 transform 命中测试、`Filters` 销毁、`converter` 名字 trim 不一致、模板二次反转义等）。
2. **W1 的告警路径**尚未在浏览器里构造「真正一直为 0 高度」的虚拟化列表用例（构造需要新增一个故意写错的 demo）；本轮验证的是「正常路径不再误报 + 回退逻辑存在且不崩」。
3. `contextPool` 的释放以「池长与引用」白盒断言证明，未做 GC/FinalizationRegistry 级别的证明。
4. 性能预算未复测（本轮改动在热路径上只增加了一次 `base` 字符串拼接与两次集合查询；如需要可在下一轮补 1000 节点基准）。

---

## 5. 提交

- 提交信息：`fix(layout): cache by percent base, keep in-pass invalidations, and clamp stretch/fill to child min/max`（正文列出 L1–L8、W1–W2 与验证证据）。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples` 全绿。
