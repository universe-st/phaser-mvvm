# ADR-0011：1.0 公开 API 冻结与版本号

- **状态**：已接受（2026-09）
- **相关**：`scripts/check-api-surface.mjs`、`docs/API-SURFACE.json`、`docs/PLAN.md` §6（M10）、ADR-0001（包划分与依赖方向）、`packages/*/package.json`

## 背景

M0–M9 交付之后，四个包一直停在 `0.0.0`：版本号在 `package.json` 里是占位符，公开 API 的边界只存在于「入口文件写了什么」这件事实里，没有任何东西把它记下来。这带来两个具体问题：

1. **改名字没有代价，也没有记录。** 第 95 轮把没人用过的 DSL 别名 `Surface` 删掉、第 104 轮把 `runtimeOptionTarget` 的键表收敛成一份、第 110 轮把 `Widget` 的聚焦事件补齐 —— 这些改动对外都是「公开 API 变了」，但除了人类写的文档，仓库里没有一处会因为它们而变化。指南门禁（`check-doc-snippets.mjs`）只能抓到*被文档调用过*的名字，`tsc` 更看不见：删掉一个导出，只要没人 import，编译就是绿的。
2. **`0.0.0` 的语义**。按 semver，`0.y.z` 意味着「任何版本都可能破坏兼容」。对一个已经写了七章指南、十个 ADR、1361 条单测、四十多个验收矩阵的框架来说，这个声明是错的：它的公开面早就该被当成契约，而不是草稿。

同时，M10 的「1.0 发布」需要先回答一个前提问题：**哪些名字是公开契约**。这个问题必须由机器回答，否则「发布 1.0」只是把 `0.0.0` 换成 `1.0.0` 三个字符。

## 决策

1. **四个包（`core`/`layout`/`phaser`/`widgets`）的版本号定为 `1.0.0`**；根包与 `@phaser-mvvm/examples` 保持私有，不参与版本契约。依赖仍走 `workspace:*`，peer dependency `phaser: ^4.2.0` 不变。
2. **新增公开 API 快照门禁 `scripts/check-api-surface.mjs` + `docs/API-SURFACE.json`**：
   - 快照记录**五个入口点**（四个包 + `widgets/compose` 子路径）的导出名字，共 817 个；
   - 判据是**集合相等**：新增、改名、删除任一导出都会让门禁失败并逐条打印 `+`/`-`；
   - 真相来源是**入口文件的源码**（本仓库 `exports` 映射把 `types`/`import` 都指向 `src/index.ts`，入口文件即公开面），`export *` 会**传递解析**——包括 `@phaser-mvvm/phaser` 对 `@phaser-mvvm/layout` 的跨包 re-export，因为通过星号到达的名字和手写的名字一样公开；
   - 记录**名字，不记录签名**。值和类型列在同一张表里：对使用者它们是同一个命名空间（改一个接口名同样编译不过），而且 `export { type X }` 这种写法在入口文件里本来就与值无法区分。签名漂移由单测、指南片段与类型检查负责。
   - `UPDATE_API=1 node scripts/check-api-surface.mjs` 是唯一的重新冻结方式，并且要求在 diff 里逐条解释。
3. **冻结的边界是「名字集合」，不是「行为」**。行为契约仍然由既有门禁承担：`pnpm -r run test`、`pnpm docs:check`、`node scripts/visual-check.mjs`、`pnpm size`、以及每个验收页的矩阵。本 ADR 只承诺「1.0 之后，公开名字的增删改必须是一次显式动作」。
4. **破坏性改动需要新 ADR**。冻结不等于禁止演进：新增导出、改名、删除导出都仍然允许，但必须新开一篇 ADR 说明理由，并在同一次提交里重新冻结快照、更新指南与 `HANDOVER.md`。

## 后果

**正面**

- 「1.0」现在有一份可执行的清单：817 个名字，谁都能在 diff 里看到 API 变化的边界。
- 删除导出这一动作从「悄悄发生」变成「必须在快照里留下 `-` 行」，与第 95 轮删 `Surface` 那类经验对得上：那次是靠人肉三份语料比对发现的。
- 跨包 `export *` 的传递解析顺带回答了「`phaser` 到底公开了 `layout` 的哪些东西」——在此之前没有任何文档写过这件事。

**负面**

- 新增一个导出要改两处（源码 + 快照），评审时要判断它是不是有意为之。这是冻结的代价，也是它的全部意义。
- 快照是**文本级**解析（`export` 语句的正则集合），不是 TypeScript 编译器的答案：`export default`、`export =` 这两种写法它不认（本仓库不用），而 `export { x } from './y'` 里的 `x` 会被记为公开名，即使 `./y` 并没有导出它——类型检查会在同一提交里报错，门禁不替代编译。
- 名字集合会随框架长大而变长（本次 817）。它不是越小越好，而是越**显式**越好。

## 证据

- `node scripts/check-api-surface.mjs` → `ok: 817 frozen export(s) across 5 entry points match docs/API-SURFACE.json`。
- 阳性对照（临时把 `packages/phaser/src/index.ts` 的 `NavSourceRegistry` 从导出列表里删掉）→ 门禁逐条打印 `@phaser-mvvm/phaser: - NavSourceRegistry` 并以退出码 1 失败；还原后重新通过。第 110 轮实测。
- 四个包的版本：`packages/{core,layout,phaser,widgets}/package.json` 均为 `1.0.0`。
