# 贡献指南

本文件是 [`README.md`](./README.md) 与 [`docs/PLAN.md`](./docs/PLAN.md) 的补充。**PLAN.md 是唯一事实来源**：任何实现细节与它冲突时，先改 PLAN（或补一篇 ADR），再改代码。

> 当前状态：M0–M8 已交付；M9（导航与无障碍）已交付三个切片——手柄导航、无障碍镜像、手柄文本输入（`NavSource` 命名抽象、真实屏幕阅读器与真机手柄验证未做）。API 仍在演进但已可用，仓库级的 `pnpm typecheck` / `test` / `build` 应当全绿；日常迭代仍建议用 `pnpm --filter <包名> run <脚本>` 只验证自己负责的包。

## 1. 环境

- Node 24、pnpm 10（`packageManager: pnpm@10.34.5`）。
- 依赖已装好时**不要**重复 `pnpm install`；需要同步 lockfile 时才安装，并提交更新后的 `pnpm-lock.yaml`。

## 2. 提交流程

```bash
pnpm format            # prettier --write .
pnpm --filter @phaser-mvvm/<pkg> run typecheck
pnpm --filter @phaser-mvvm/<pkg> run test
```

CI（`.github/workflows/ci.yml`）在 push 与 PR 上运行：Prettier 检查 → 逐包 `typecheck` → 逐包 `test` → 逐包 `build` → 示例构建。PR 必须全绿。

## 3. 代码约定

| 约定              | 说明                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript strict | 继承 `tsconfig.base.json`（`strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters`）。不要用 `any` 或 `@ts-ignore` 绕过，用 `unknown` + 收窄。 |
| 格式              | Prettier（`.prettierrc.json`：单引号、`printWidth: 100`、`trailingComma: all`、分号）。`docs/PLAN.md` 在 `.prettierignore` 中，**不要**格式化它。                                                      |
| 相对导入          | 不带扩展名（`./reactivity/ref`）；跨包引用用包名（`@phaser-mvvm/core`），不写相对路径穿透 `packages/`。                                                                                                |
| 无 `eval`         | 不使用 `eval` / `new Function`（CSP 兼容，PLAN §4.4）。                                                                                                                                                |
| 注释语言          | 公开 API 的 JSDoc 用英文；解释性的设计注释可用中文。                                                                                                                                                   |

## 4. 架构边界（硬约束）

1. **只有 `packages/phaser` 允许 `import phaser`。** `core` 与 `layout` 必须零 Phaser 依赖（含类型引入）；`widgets` 通过 `@phaser-mvvm/phaser` 间接使用。见 [ADR-0001](./docs/adr/0001-package-layout.md)、[ADR-0003](./docs/adr/0003-layout-is-renderer-agnostic.md)。
2. **布局算法不依赖渲染**：文本度量通过注入的 `Measurer` 接口获得；测试用等宽假测量器，保证黄金快照确定。
3. **裁剪用 Mask filter**（`FilterList#addMask`），不要用 v3 的 `setMask(graphics)` 思路 —— `GeometryMask` 在 v4 仅 Canvas 可用。见 [ADR-0007](./docs/adr/0007-phaser4-webgl-constraints.md)。
4. **响应式副作用必须归入 `EffectScope`**：`destroy()` 里 `scope.stop()` + 注销输入 + 归还对象池。泄漏回归（场景创建→销毁 100 次后计数归零）是硬门禁。
5. **UI 刷新默认帧对齐**（`flush: 'frame'`），不要用 `sync` 绕过批量刷新。见 [ADR-0008](./docs/adr/0008-reactivity-and-scheduler.md)。
6. **`packages/widgets` 的 `test` 脚本带 `--passWithNoTests`**：这个 flag 只是「暂时没有测试也不至于失败」，四个包现在都有实打实的用例（合计 1311：core 281 / layout 314 / phaser 332 / widgets 384），**不要**为了「有测试」而写空断言。

## 5. 何时需要写 ADR

以下改动**必须**新增一篇 ADR（新编号，不修改历史 ADR 的决策正文）：

- 新增发布包、改变包间依赖方向；
- 引入新的运行时依赖（或在 `core`/`layout` 中引入任何依赖）；
- 改变布局模型、响应式/调度语义、裁剪方案等已冻结决策。

流程：按 [`docs/adr/README.md`](./docs/adr/README.md) 的模板新建 `NNNN-<slug>.md`，把受影响的历史 ADR 状态改为 `Superseded by ADR-XXXX`，并在 PR 描述中链接。

## 6. 测试要求（PLAN §7）

| 层                   | 要求                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| `core`               | vitest 单测，覆盖率 ≥ 90%（依赖收集/清理、调度时序、销毁后写入等边界）          |
| `layout`             | 用例 ≥ 40 + JSON 黄金快照零漂移（含 RTL、极窄容器、`auto` 列数、跨行列冲突）    |
| `phaser` / `widgets` | Playwright headless Chrome（WebGL）截图回归 + 交互脚本；关键控件截图差异 < 0.5% |
| 性能                 | 1000 节点布局、1000 行虚拟列表、连续输入 10 s 无掉帧、无内存增长趋势            |

## 7. 性能预算（PR 评审依据，PLAN §8）

- 1000 节点全量 `measure+arrange` < 1.5 ms；无变化帧布局耗时 = 0；
- 测量缓存命中率 > 95%（表单类界面）；
- 排布热路径零新增对象/闭包；连续输入（含 IME）不引发整树布局；
- 体积（gzip，不含 Phaser）：`core` + `layout` < 25 KB；`phaser` + `widgets` < 45 KB。
