# AGENTS.md

面向 AI 编码代理与自动化协作者的仓库操作手册。**人读的入门文档是 [`README.md`](./README.md) 与 [`CONTRIBUTING.md`](./CONTRIBUTING.md)；架构事实来源是 [`docs/PLAN.md`](./docs/PLAN.md)。** 本文件只写「怎么在这个仓库里干活」，不复制 PLAN 的规格表。

> 30 秒版：pnpm workspace 单仓 → 改代码 → `pnpm --filter <包名> run typecheck` + `run test` → `pnpm format`。**只有 `packages/phaser` 能 `import phaser`**；`core`/`layout` 必须零 Phaser 依赖；`docs/PLAN.md` 与 `packages/layout/test/golden/` 不要格式化。

---

## 1. 项目是什么

**phaser-mvvm** —— 基于 **Phaser 4**（`phaser@4.2.1`）的 MVVM UI 框架：响应式数据 + 声明式视图 + 两阶段自动布局 + 基础控件库。**不 fork Phaser**，只用公开 API 与插件/工厂注册；游戏逻辑照常使用原生 Phaser。

## 2. 环境与命令

- **Node 24**（CI 固定 24；本机验收环境 `v24.18.1`）、**pnpm 10.34.5**（根 `packageManager` 固定）。
- 依赖已安装时**不要**重复 `pnpm install`；只有需要同步 lockfile 时才安装，并提交更新后的 `pnpm-lock.yaml`。
- 示例 dev server 端口写死 **5173 + `strictPort: true`**：被占用会直接报错而不是换端口。若需另起服务，用后台任务并核实端口。

| 命令                                                          | 用途                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                              | `pnpm -r run typecheck`（逐包 `tsc -p tsconfig.json`）                                                           |
| `pnpm test`                                                   | `pnpm -r run test`（逐包 vitest）                                                                                |
| `pnpm build`                                                  | `pnpm -r run build`（tsup：ESM + CJS + d.ts）                                                                    |
| `pnpm format` / `pnpm format:check`                           | Prettier 写 / 校验（CI 门禁是 `prettier --check .`）                                                             |
| `pnpm dev`                                                    | 示例 dev server → http://localhost:5173（场景：`#/showcase` 工厂 API 验收页、`#/compose` DSL 验收页、`#/m0` 等） |
| `pnpm build:examples` / `pnpm preview`                        | 构建示例 / 预览产物（4173，`strictPort`）                                                                        |
| `pnpm --filter @phaser-mvvm/<pkg> run typecheck\|test\|build` | **并行开发期优先用这个**，只验证自己负责的包                                                                     |
| `node scripts/visual-check.mjs`                               | 几何 + 像素验收（见 §6），需要本机 Chrome/Chromium                                                               |
| `UPDATE_GOLDEN=1 pnpm --filter @phaser-mvvm/layout run test`  | 重新生成布局黄金快照                                                                                             |

包名：`@phaser-mvvm/core`、`@phaser-mvvm/layout`、`@phaser-mvvm/phaser`、`@phaser-mvvm/widgets`，示例为 `@phaser-mvvm/examples`（私有）。

## 3. 目录与依赖方向

```
apps/examples      Vite 示例与验收场（场景注册在 src/main.ts 的 SCENES）
packages/core      响应式内核 / 调度器 / 绑定上下文 / 表达式编译 —— 零 Phaser 依赖
packages/layout    渲染无关的两阶段布局引擎（measure/arrange）—— 零 Phaser 依赖
packages/phaser    Phaser 4 适配层：Widget/UIRoot/MVVMPlugin/输入·焦点·导航/主题/绑定——唯一可 import phaser 的包
packages/widgets   控件库：Label/Panel/Button/Image/Spacer/Divider/TextField/TextArea/ScrollView/Repeat
                   子路径 `@phaser-mvvm/widgets/compose` = Compose 风格 DSL（推荐写视图的方式）
docs/              PLAN.md（唯一事实来源）、guide/（教程式使用指南：控件/布局/用法/DSL）、adr/（ADR-0001…0008）、ACCEPTANCE-*.md（验收记录）、DEFECT-BACKLOG.md（审计缺陷登记簿）
scripts/           visual-check.mjs（CDP 无头 Chrome 几何+像素验收）、png-sample.py（Pillow 采样）
```

依赖方向严格单向、禁止反向与环：`apps → widgets → phaser → { core, layout }`；`core` 与 `layout` 互不依赖（见 [ADR-0001](./docs/adr/0001-package-layout.md)、[ADR-0003](./docs/adr/0003-layout-is-renderer-agnostic.md)）。

## 4. 硬约束（改动前先读）

1. **只有 `packages/phaser` 允许 `import phaser`**（含类型引入）。`core`/`layout` 零 Phaser 依赖；`widgets` 只通过 `@phaser-mvvm/phaser` 间接使用。构建时 `phaser` 一律 `--external`。
   例外与延伸：`packages/phaser/src/uiscope.ts`（DSL 作用域机制）是**纯逻辑**，只允许 `import type` Phaser，必须保持可在 Node 单测。
2. **布局算法不依赖渲染**：文本度量通过注入的 `Measurer` 接口获得；测试用等宽假测量器，保证黄金快照确定。
3. **裁剪用 Mask filter**（`FilterList#addMask`），不要用 v3 的 `setMask(graphics)` 思路——`GeometryMask` 在 Phaser 4 仅 Canvas 可用（[ADR-0007](./docs/adr/0007-phaser4-webgl-constraints.md)）。
4. **响应式副作用必须归入 `EffectScope`**：`destroy()` 里 `scope.stop()` + 注销输入 + 归还对象池；「场景创建→销毁 100 次后计数归零」是硬门禁（[ADR-0008](./docs/adr/0008-reactivity-and-scheduler.md)）。
5. **UI 刷新默认帧对齐**（`flush: 'frame'`）：不要用 `sync` 绕过批量刷新。
6. **不使用 `eval` / `new Function`**：路径表达式编译为 getter/setter 闭包，保证 CSP 可用。
7. **`docs/PLAN.md` 是唯一事实来源**：实现细节与它冲突时，先改 PLAN（或新增 ADR），再改代码。
8. **以下改动必须新增一篇 ADR**（新编号，**不得修改历史 ADR 的决策正文**）：新增发布包、改变包间依赖方向、引入新的运行时依赖（或在 `core`/`layout` 中引入任何依赖）、改变布局模型/响应式·调度语义/裁剪方案等已冻结决策。模板与流程见 [`docs/adr/README.md`](./docs/adr/README.md)。

## 5. 代码约定

| 约定     | 要求                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型     | 继承 `tsconfig.base.json`：`strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters`、`noEmit`。禁用 `any` 与 `@ts-ignore`，用 `unknown` + 收窄。                          |
| 导入     | 相对导入**不带扩展名**（`./reactivity/ref`）；跨包用包名（`@phaser-mvvm/core`），不要用相对路径穿透 `packages/`。                                                                                                                |
| 格式     | Prettier：单引号、`printWidth: 100`、`trailingComma: all`、分号、`arrowParens: always`。                                                                                                                                         |
| 注释语言 | 公开 API 的 JSDoc 用**英文**；解释性的设计注释可用中文。既要「为什么」而不是复述代码。                                                                                                                                           |
| 提交信息 | Conventional Commits + **英文祈使句**简述，例：`feat(widgets): ScrollView with WebGL clipping and gestures`、`fix(layout): keep the arrange pass descending to a dirty boundary`、`docs: M7 acceptance record`。文档正文用中文。 |

## 6. 测试与验收

- **单测**：vitest，测试放 `packages/<pkg>/test/*.test.ts`；仓库**没有** vitest 配置文件，用默认 include。`core`/`layout`/`phaser`/`widgets` 的测试都必须在纯 Node 下跑通（不启动渲染器）。
- `packages/phaser`、`packages/widgets` 的 `test` 脚本带 `--passWithNoTests`——不要删掉这个 flag，也**不要**为了「有测试」写空断言。
- **黄金快照**：`packages/layout/test/golden/*.json`，零漂移是门禁；确认是有意变更后再用 `UPDATE_GOLDEN=1 pnpm --filter @phaser-mvvm/layout run test` 重生成，并在说明里解释每一处差异。该目录在 `.prettierignore` 中。
- **几何 + 像素验收**：`node scripts/visual-check.mjs`。脚本用**单个**无头 Chrome（CDP + 固定视口 1280×720）逐场景：读页面 `#status`（场景把引擎实际分配的 rect 写进 DOM）→ 截图 → 按 canvas 偏移换算后采样中心像素并与期望填充色比对。常用参数：`--no-build`、`--size 1024x768`、`--port`、`--out .tmp/visual-check`；需要 `CHROME_PATH` 或本机 Chrome/Chromium，**仅 macOS/Linux 可用**。
  - 要校验的场景在脚本里**硬编码**（当前 `m0`、`probe`、`stack`）——新增场景若需像素断言，必须同时加进 `PIXEL_EXPECTATIONS` 与该场景列表。
  - 被其它控件遮挡的采样点用 `{ rgb, fx, fy }` 指定相对采样位置。
  - 脚本启动 Chrome 时**不传** `--user-data-dir`，因此依赖默认 profile 目录可写（`~/Library/Application Support/Google/Chrome`）。在受限/沙箱环境里 Chrome 会直接崩溃（Crashpad 写盘被拒），脚本报 `timed out waiting for chrome devtools endpoint` —— 这是环境限制而非脚本缺陷；此时请在汇报里说明「像素验收未运行」，并至少断言 `#status` 里的几何。
- **交互状态矩阵**：`#/states`（`apps/examples/src/scenes/states.ts`）把每个有状态的控件摆成一行，并把 `visualState` 逐帧写进 `#demo-state` 的 `st.<name>`，坐标写进 `pt.<name>`。验收方式：用真实 `mouse.move`/`down`/`up`、`keyboard.press` 驱动悬停/按下/聚焦/校验，断言 `st.*` 的迁移；在视口外的探针先用 `window.states.reveal(name)` 滚进视野（否则坐标在画布外，指针事件落不到控件上）。
- **生命周期泄漏门禁**：`#/lifecycle`（`apps/examples/src/scenes/lifecycle.ts`）建一页全控件界面并暴露 `window.lifecycle.churn(n)`：重启场景 n 次、每轮采样 8 项计数（`themeListeners`/`displayList`/`focusables`/`pointerTargets`/`textures`/`tweens`/`timers`/`widgets`）。验收断言：每项只有一个取值 + `pages()` 只剩当前页 + 重启后 `pt.click` 能点、`pt.name` 能输入。改动插件生命周期、控件销毁或主题订阅后必须跑一次。
- **示例场景约定**：在 `apps/examples/src/scenes/<name>.ts` 导出 `Phaser.Scene` 子类 → 注册进 `apps/examples/src/main.ts` 的 `SCENES`（hash 即场景名）。用 `status.ts` 的 `setStatus`/`appendStatus`/`reportWidget`/`reportCanvas` 输出可断言的几何；`#status`、`#demo-state` 在 CSS 里 `display: none`（内容供机器读，不画到画布上）。注意 `#demo-state` 是**空格分隔**的 `key=value`：值里含空格时（自由文本、输入框内容）必须走场景自己的 API（`window.<scene>.state()`）读取，不要在 DOM 文本上按空格切分。`?capture=1` 会开启 `preserveDrawingBuffer`，否则截图读不到 WebGL 帧。
- **性能预算**（PR 评审依据，PLAN §8）：1000 节点全量 `measure+arrange` < 1.5 ms（实测 0.06 ms）；无变化帧布局耗时 = 0（实测 0.024 ms、零测量）；布局约束缓存命中率 > 95 %（实测 95.6 %）；单节点编辑只重测该子树（实测 922 个节点里只重测 1 个）；排布热路径零新增对象/闭包（对象池长度稳定）；gzip 体积 `core`+`layout` < 25 KB、`phaser`+`widgets` < 45 KB（按 min+gzip，实测 18.3 / 14.7 KB）。怎么跑见 §8；**文本度量缓存那条预算尚未实现**（`PhaserTextMeasurer` 未被控件使用）。
- **CI**（`.github/workflows/ci.yml`）：Prettier 检查 → 逐包 `typecheck` → 逐包 `test` → 逐包 `build` → 示例构建，PR 必须全绿。`perf.test.ts` 随逐包 `test` 一起跑；`pnpm size` 尚未接进 CI（需要先 build），本地提交前跑一次即可。

## 7. 提交前自查清单

1. `pnpm format`（或只格式化改动文件），确保 `pnpm exec prettier --check .` 通过。
2. `pnpm --filter @phaser-mvvm/<受影响包> run typecheck` 与 `run test`。
3. 改动涉及包 `src/` 且被示例消费时：`pnpm run build:examples`；涉及控件外观/布局几何/输入交互时：`node scripts/visual-check.mjs`（等价于先 build 再验收），或用 Playwright MCP 打开 `http://localhost:5173/#/showcase`｜`#/compose` 读 `#status`/`#demo-state` 做几何与状态断言（`pt.<key>=@x,y` 是每个可点击控件的页面坐标）。
4. 触及硬约束 §4 的任一条 → 先补/改 ADR，再写代码。
5. 汇报时给出**实际运行过的命令与结果**，区分「已验证」与「未验证」。

## 8. 已知易踩的坑

- **开发期包入口指向源码**：`packages/*` 的 `exports` 中 `types`/`import` 指向 `src/index.ts`，只有 `require` 指向 `dist/index.cjs`。因此改源码在 dev 里立即生效，但 CJS 消费方需要先 `build`；**永远不要手改 `dist/`**（生成物且被 gitignore）。
- **`dist/`、`.tmp/`、`coverage/`、`test-results/` 都是生成物**，已 gitignore；验收截图、日志、临时脚本请放 `.tmp/`。
- **布局缓存按 (约束, 百分比基准, revision) 命中**：忘记 `markDirty()`/`invalidate()` 会表现为「UI 不更新」而不是报错；调试布局时优先看 `LayoutEngine#stats`（`measureCalls`/`cacheHits`/`skippedSubtrees` 等计数器）。基准进键是必须的：同一个约束在不同包含块下解析百分比会得到不同答案。
- **性能/体积预算怎么跑**：`pnpm --filter @phaser-mvvm/layout run test`（含 `test/perf.test.ts`：1000 节点耗时、无变化帧、缓存命中率、单节点编辑增量性、对象池稳定性）与 `pnpm size`（`scripts/size-check.mjs`，按 min+gzip 判定 core+layout < 25 KB、phaser+widgets < 45 KB，同时打印未压缩 gzip）。改动布局引擎、控件度量或新增控件后请跑这两个。
- **本机没有 `timeout` 命令**（macOS）；长命令用后台任务而不是 `timeout` 包裹。
- **文档数字会滞后**：`README.md`、`CONTRIBUTING.md`、`docs/ACCEPTANCE-*.md` 里的里程碑状态与测试数量彼此不一致（例如三份文档分别写着 M0–M2 / M0–M7 与不同的用例数）。**以代码、`pnpm -r run test` 的实跑结果和 CI 为准**；顺手更新过时描述是受欢迎的改动。
- **不要引入浏览器测试框架**（仓库无 Playwright 依赖，验收走 `scripts/visual-check.mjs` 的 CDP）；任何新运行时依赖都需要 ADR。

## 9. 变更范围纪律

- 只改与任务相关的文件；当前工作区可能已有他人未提交的在制品（`git status` 先看），不要顺手格式化或回滚它们。
- 不要为了「让检查通过」而降低断言强度、跳过测试或删除门禁脚本；发现真实缺陷就修根因，并在提交信息/汇报中说明。
