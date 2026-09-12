# 验收记录 · DSL 入口收敛与文档对齐（第 7 轮）

> 目的：让「像 Jetpack Compose 一样写界面」这件事从 **API 存在** 走到 **默认路径就是它**。上一轮结束时 DSL 已经覆盖全部控件与容器，但：① 整页还要写两行（`ui()` + `this.mvvm.mount()`）；② 指南第 1 章教的第一种写法仍是工厂 API，照着读会先学到次要写法；③ 控制流（`if`/`for`/`visible`）没有任何文档，读者不知道能直接写。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173。
> 结论：**新增 `render()` 一次调用建树 + 挂载；`#/compose` 改为 `render()` 并新增 `Flow` 分区（静态 `if`/`for`/`switch` 与反应式 `visible` 都有可点按实测）；指南第 1 章与 README 改为 DSL 优先，并明确「用 DSL 不需要 install\*Factories()」。11 个场景全部 0 错误。**

---

## 1. 本轮改动

| 改动                        | 位置                                  | 说明                                                                                                                                                                               |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render(plugin, content)`   | `packages/widgets/src/compose.ts`     | `setContent { … }` 的对应物：建树 + `plugin.mount()` 一次完成，返回根控件。`ScenePlugin#scene` 是 protected，因此从 `plugin.root.scene` 取场景（顺带在首次使用时创建并接好 UI 根） |
| `#/compose` 改用 `render()` | `apps/examples/src/scenes/compose.ts` | 页面入口由两行变一行；其余代码不变，作为「整页写法」的活样例                                                                                                                       |
| 新增 `Flow` 分区            | 同上                                  | 演示静态 `if`、`for`、`switch` 与反应式 `visible`，并暴露 `pt.flow.toggle` / `flow.notice` / `flow.after` 供断言                                                                   |
| 指南第 1 章改为 DSL 优先    | `docs/guide/01-quick-start.md`        | §3 用 `render()` + 内容 lambda 重写；§4 由「三种创建方式」改为「DSL 优先的四种方式」，并说明用 DSL 时 `install*Factories()` **不必调**                                             |
| 指南第 9 章补两节           | `docs/guide/09-compose-dsl.md`        | §4.1「控制流就是 TypeScript」（静态 `if`/`for`/`switch` vs 反应式 `visible`）；入口表加入 `render()`                                                                               |
| README §4 改用 `render()`   | `README.md`                           | 最小示例去掉 `installFactories()`/`installWidgetFactories()` 与 `ui()`+`mount()` 两行                                                                                              |
| 指南阅读路线                | `docs/guide/README.md`                | 「第一次接触」的路线改为 01 → 09 → 02 → 03                                                                                                                                         |

---

## 2. 实测（Playwright MCP）

### 2.1 `Flow` 分区：静态控制流 + 反应式条件

| 状态                          | `flow.notice` 可见        | 同一行里其后的分隔线 x |
| ----------------------------- | ------------------------- | ---------------------- |
| 初始（`highlighted = false`） | false（`inFlow = false`） | **224**                |
| 点 `pt.flow.toggle` 一次      | true（`inFlow = true`）   | —                      |
| 再点一次                      | false                     | **88**                 |

分隔线在 224 ↔ 88 之间移动（= 通知文本宽度 + 间距），说明 `visible` 是真的把它移出了布局流；静态 `if`/`for`/`switch` 分支在 `Flow` 卡片里可见（5 个 `for` 生成的标签块、`switch` 依据当前分区输出的那行文字）。

### 2.2 全场景回归

| 场景                                                                                                                                   | `#status` 错误数 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `#/compose`、`#/states`、`#/lifecycle`、`#/showcase`、`#/form`、`#/list`、`#/scroll`、`#/bindings`、`#/gallery`、`#/dashboard`、`#/m0` | 全部 **0**       |

`#/compose` 的 11 个分区（含新 `Flow`）逐个切换均报回自身 id，`parity` 分区仍为 **`parity=ok`**（工厂 API 与 DSL 建出的卡片逐节点几何一致）。

### 2.3 命令与结果

| 命令                           | 结果                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm -r run typecheck`        | 5/5 包通过                                                                   |
| `pnpm -r run test`             | **984 passed**：core 278、layout 306、phaser 119、widgets 281                |
| `pnpm exec prettier --check .` | 通过                                                                         |
| `pnpm run build:examples`      | 通过                                                                         |
| `pnpm size`                    | 两组均 within budget（core+layout 18.3 KB、phaser+widgets 14.7 KB min+gzip） |

---

## 3. 顺带修掉的门禁脆弱点

跑全仓测试时 `perf.test.ts` 的「无变化帧」用例在**并发跑各包测试**时失败了一次：它的时间阈值是 0.05 ms，而该量级下计时根本区分不了「零工作（0.02 ms）」与「重测 922 个节点（0.06 ms）」，机器一忙就会误报。

改法：这条预算的**门禁改为结构性断言**（`measureCalls` 增量 = 0、`arrangeCalls` 增量 = 1、`skippedSubtrees` > 100），时间只保留 1 ms 的粗上界用于抓「数量级」回归；PLAN §8 与验收记录同步说明该口径。这符合 `AGENTS.md` §9「不要为了通过而降低断言强度」的反面：这里不是放宽门禁，而是把门禁换成真正能判定它的形式。

---

## 3.1 验收时发现的一个读取陷阱（已记录，未改格式）

`#demo-state` 是**空格分隔**的 `key=value` 串，因此值里含空格时朴素解析会截断：输入 `round seven` 后，控件值与 ref 都是 `round seven`，但从 DOM 文本按空格切分会读成 `field.text=round`（本轮状态扫描里就出现了这个假象）。**结论**：自由文本/输入内容一律用场景导出的 API 读（`window.states.value(name)`、`window.compose.state()`），DOM 文本只用于短枚举值与坐标。已把这一点写进 `apps/examples/src/demo.ts` 的注释与 `AGENTS.md` §6，未改分隔符（多个既有检查按空格解析，改格式是纯收益有限、破坏面更大的动作）。

---

## 4. 未做 / 下一步

1. **`#/showcase`（1589 行、工厂 API 写的旧验收页）尚未迁移到 DSL**。它是当前唯一还在教工厂写法的大页面；迁移需要逐分区与 `#status`/`#demo-state` 基线比对（各分区控件数 39/43/35/71/161/81/83/110/107/39 与几何已记录，可直接作为等价性基线）。建议单独一轮做，并保留 `#/showcase` 作为「工厂 API 仍可用」的对照页。
2. `Modifier` 式链式写法**不做**：DSL 刻意复用控件的选项对象（`{ padding, gap, width }`），另造一套链式词汇会违背「一个词汇表」的目标；`visible`/反应式槽位已经覆盖 Compose `Modifier` 的常用语义。
3. `When`/`ForEach` 这类 helper **不做**：`if`/`for` 原生可用（本轮 §2.1 实测），再加一层包装只会增加概念。

---

## 5. 提交

- 提交信息：`feat(widgets): render() entry point, a flow demo, and a DSL-first quick start`。
- 提交前门禁：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples`、`pnpm size` 全绿。
