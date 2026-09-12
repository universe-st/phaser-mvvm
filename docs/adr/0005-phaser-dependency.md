# ADR-0005：Phaser 依赖方式（npm `phaser@4.2.1`，本地源码只读）

- 状态：Accepted
- 日期：2026-09
- 决策来源：PLAN.md §10.1 决策 2、§2 技术基线、§9 风险、§10.3
- 影响范围：所有 `package.json`、构建配置、类型检查、示例工程

## 背景

本机存在 Phaser 4 的源码副本 `/Users/kuangshensheng/codes/phaser`，同时 npm 上已有 `phaser@4.2.1`（代号 "Giedi"）。需要先决定框架依赖哪一个，因为它决定了：

- 类型从哪来（`phaser.d.ts`）；
- 构建是否需要额外编译步骤；
- 升级/修补的路径。

相关事实（PLAN §2）：本地 `dist/phaser.esm.js` ≈ 8.5 MB；Phaser 4 仍在演进，4.x 存在 API 漂移（如 filter 控制器化）。

## 决策

1. **依赖 npm `phaser@4.2.1`**：
   - `packages/phaser` 与 `packages/widgets` 声明 `peerDependencies: { "phaser": "^4.2.0" }`；
   - 同时在各自的 `devDependencies` 中**固定** `"phaser": "4.2.1"`（不用 `^`），保证本地与 CI 使用同一版本；
   - `apps/examples` 以 `dependencies` 固定 `"phaser": "4.2.1"`。
2. **本地源码 `/Users/kuangshensheng/codes/phaser` 仅作只读参考**：用于核对 API 与 v4 变更（例如 ADR-0007 引用的 `GeometryMask.js`、`FilterList.js#addMask`、`MIGRATION-GUIDE.md`），**不参与构建、不被链接、不作为 workspace 依赖**。该目录不在本仓库内，任何构建产物不得引用其路径。
3. **只有 `packages/phaser` 允许 `import` Phaser**；`packages/widgets` 经由 `@phaser-mvvm/phaser` 间接使用。`core` 与 `layout` 禁止出现任何 Phaser 引用（ADR-0003）。
4. 构建时对 `phaser` 使用 `--external phaser`，不打进产物（体积与版本冲突双重考虑，见 §8）。
5. **升级策略**：仅允许在 `^4.2.0` 范围内升级；升级时以截图回归（Playwright，PLAN §7）作为兜底门禁；跨 minor 升级需要在 ADR 中记录（新增编号，不修改本文）。

### 各包的声明方式（M0 落地结果）

| 包                     | `dependencies`                                                                     | `peerDependencies` | `devDependencies` |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------ | ----------------- |
| `@phaser-mvvm/core`    | —                                                                                  | —                  | —                 |
| `@phaser-mvvm/layout`  | —                                                                                  | —                  | —                 |
| `@phaser-mvvm/phaser`  | `@phaser-mvvm/core`、`@phaser-mvvm/layout`（`workspace:*`）                        | `phaser: ^4.2.0`   | `phaser: 4.2.1`   |
| `@phaser-mvvm/widgets` | `@phaser-mvvm/core`、`@phaser-mvvm/layout`、`@phaser-mvvm/phaser`（`workspace:*`） | `phaser: ^4.2.0`   | `phaser: 4.2.1`   |
| `apps/examples`        | `phaser: 4.2.1` + 四个 workspace 包                                                | —                  | —                 |

- `core` 与 `layout` 的依赖列表保持为空，是可被机械检查的硬约束（ADR-0001、ADR-0003）。
- `phaser` 与 `widgets` 的构建命令带 `--external phaser`，确保产物不内联 Phaser。
- `pnpm-lock.yaml` 锁定 `4.2.1`；CI 使用 `pnpm install --frozen-lockfile` 保证版本一致。

### 落地检查（M0 验收的一部分）

1. `packages/core`、`packages/layout` 的 `package.json` 中不出现 `phaser`；
2. 对 `packages/{core,layout}/src` 做「`import` 自 `phaser`」的静态检查（未来随 lint 规则加入）；
3. `tsc --noEmit` 能解析 `phaser.d.ts`，且示例工程类型检查通过（PLAN §7 类型门禁）。

## 理由与权衡

- **体积与工具链**：本地 `dist` 约 8.5 MB，链接本地源码会拖慢示例的 dev server 与构建，并让示例无法作为独立可运行工程发布；npm 包提供标准 `phaser.d.ts`，`tsc --noEmit` 可直接解析。
- **可复现性**：`peer ^4.2.0` + `devDependency` 固定 `4.2.1` 的组合，让「使用者自选小版本」与「开发者/CI 版本一致」两个目标同时成立。
- **只读参考的价值**：源码副本能让我们在写适配层时核对真实实现（例如 `addMask` 的 5 个参数与 `viewTransform`/`scaleFactor` 语义），避免照文档猜 API；但它不承担依赖角色，因此不会把仓库绑死在本机路径上。
- **代价**：npm 版本与本地源码可能短暂不同步（本地源码若领先于 npm 发布），此时以 **npm 已发布的 `4.2.1` 行为为准**。
- **为什么不用 `file:` / `link:` 指向本地源码**：那样会让 `pnpm install` 依赖某台机器的目录存在，CI 与协作者都无法构建；同时本地源码目录不是发行包，缺少稳定的入口与类型声明位置。
- **为什么不把 Phaser 打进产物**：Phaser 由使用者的游戏工程提供，重复打包会造成「两份 Phaser 实例」（不同的 `Game`/`Scene` 注册表），是难以排查的运行时错误。

## 后果

### 正面

- 示例工程可以独立 `pnpm dev`，不依赖本机源码目录的存在。
- CI 无需额外的 Phaser 编译/链接步骤（`pnpm install --frozen-lockfile` 即可）。
- 用户安装框架时不会被迫安装某一具体补丁版本（peer 范围 `^4.2.0`）。

### 负面

- 出现 Phaser 缺陷时无法就地打补丁，只能等上游或临时用 `pnpm patch`（需在 ADR 中记录）。
- `peerDependencies` 缺省时的告警需要在使用文档中说明（`pnpm` 会提示未满足 peer 的场景）。
- 本地源码副本路径仅存在于开发机；CI 与协作者不具备该副本，因此**不得**在源码注释或文档中把它写成必需路径（本文与 ADR-0007 中均标注为「可选只读参考」）。

## 相关

- PLAN.md §10.1 决策 2（Phaser 依赖方式）
- PLAN.md §2 技术基线（`dist/phaser.esm.js` ≈ 8.5 MB；Text/Container/FilterList 等调研结论）
- PLAN.md §8 体积目标（gzip 不含 Phaser）、§9 风险（Phaser 4.x API 漂移）
- PLAN.md M0 里程碑（Phaser 依赖策略落地）
- ADR-0001（包划分与依赖方向）、ADR-0003（layout 零 Phaser 依赖）、ADR-0007（Phaser 4 约束与适配层隔离）
