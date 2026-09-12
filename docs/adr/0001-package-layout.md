# ADR-0001：包划分与依赖方向

- 状态：Accepted
- 日期：2026-09
- 决策来源：PLAN.md §3.1、§3.2、§10.1 决策 1、§10.3「包名与目录」
- 影响范围：workspace 结构、发布包、构建与 CI

## 背景

框架需要同时服务两类差异很大的界面：

- 工具型表单界面：长文本、中文输入法、长列表、校验与错误态；
- 游戏内 HUD / 菜单：与游戏逻辑同场景、绘制频繁、对每帧开销敏感。

如果做成单个大包，「零渲染依赖的算法」与「绑定到 Phaser 的适配代码」会混在一起，导致布局与响应式无法在 Node 中独立测试，也导致任何 Phaser 4.x 的 API 漂移都必须全量回归。因此需要按「依赖方向可判定」的方式切片。

## 决策

采用 **四包 + 一个延后包** 的划分，发布包名统一为 `@phaser-mvvm/<name>`：

| 包                      | 目录                | 职责                                                                                                                                               | 运行时依赖                             |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `@phaser-mvvm/core`     | `packages/core`     | 响应式（`ref/reactive/computed/watch/effect/scope`）、调度器（`sync/pre/frame`）、集合、绑定上下文、路径表达式编译                                 | 无                                     |
| `@phaser-mvvm/layout`   | `packages/layout`   | 纯布局引擎：约束、`LayoutParams`、测量、排布（box/grid/stack/absolute）、脏标记、测量缓存、像素对齐                                                | 无                                     |
| `@phaser-mvvm/phaser`   | `packages/phaser`   | **唯一**允许 `import phaser` 的包：`Widget` 基类、`UIRoot`、`PhaserTextMeasurer`、输入/焦点/导航路由、`MVVMPlugin`、工厂注册、主题、场景与页面体系 | `core`、`layout`；peer `phaser ^4.2.0` |
| `@phaser-mvvm/widgets`  | `packages/widgets`  | 控件库：`Panel/Label/TextField/TextArea/Button/Image/Spacer/Divider/ScrollView/Repeat/Modal`                                                       | `core`、`layout`、`phaser`             |
| `@phaser-mvvm/template` | `packages/template` | JSON/模板 → builder 编译                                                                                                                           | **延后到 Phase 2**，Phase 1 不建目录   |

依赖方向严格单向（禁止反向依赖与环）：

```
apps/examples ──► widgets ──► phaser ──┬──► layout
                                       └──► core
```

补充约定：

1. `core` 与 `layout` 之间**不互相依赖**，二者是两个独立的零渲染基座（`layout` 通过注入的 `Measurer` 接口获得度量能力，见 ADR-0003）。
2. `phaser` 与 `widgets` 都声明 `phaser` 为 `peerDependencies`（`^4.2.0`），只在 `devDependencies` 中固定 `4.2.1`（见 ADR-0005）。
3. 只有 `packages/phaser` 与 `packages/widgets` 的构建允许 `--external phaser`；`core`/`layout` 的产物不得出现任何 Phaser 引用。
4. 新增包必须走 ADR 流程（见 `docs/adr/README.md`），不得在里程碑中临时插入。

## 理由与权衡

- **可测试性**：`core` 与 `layout` 零渲染依赖，可在 Node 中用 `vitest` 直接跑单测与黄金快照，这也是 PLAN §7 覆盖率与快照门禁的前提。
- **漂移隔离**：Phaser 4.x 的 API 变更（如 filter 控制器化）只需在 `packages/phaser` 内消化，`widgets` 与示例不受影响（见 ADR-0007）。
- **成本**：包数量增加带来 workspace 配置、`exports` 字段与发布编排成本（`changesets` 需要按包管理版本）。作为交换，我们获得上面两项能力。
- **被放弃的方案**：
  - 单包（一个 `phaser-mvvm` 包）：无法阻止算法层引入 `phaser` 依赖，测试必须在浏览器中跑。
  - 按「控件切包」（每个控件一个包）：包数量膨胀，且控件之间共享状态机与皮肤逻辑，切分收益低。
  - `template` 一并进 Phase 1：模板层需要一个稳定的 builder API 作为编译目标，在 M3/M4 完成前编译目标会反复变动（PLAN §10.1 决策 1 已把模板层延后到 Phase 2）。

## 后果

### 正面

- 依赖方向可用构建配置机械校验（`core`/`layout` 的 `package.json` 无任何依赖即是最强约束）。
- `layout` 的黄金快照测试可以在 CI 中以纯 Node 运行，无需 headless Chrome。
- 后续若支持其他渲染后端（例如纯 Canvas / 其他引擎），只需新增一个适配包，复用 `core` + `layout`。

### 负面

- 四个包之间的类型对齐需要 `tsconfig` 引用与 workspace 协议（`workspace:*`）配合，初次配置成本高于单包。
- 跨包改动（例如布局节点接口调整）需要同时改动 `layout`、`phaser`、`widgets` 三个包并一起发版。
- 本地开发必须依赖 `pnpm` 的 workspace 链接，`npm`/`yarn` 无法直接工作。

## 相关

- PLAN.md §3.1 分层、§3.2 包结构
- PLAN.md §10.1 决策 1（TypeScript + 代码优先 builder）
- PLAN.md §10.3（包名与目录、工具链、许可证）
- ADR-0003（layout 零 Phaser 依赖）、ADR-0005（Phaser 依赖方式）
