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
| `pnpm docs:check`                                             | 指南代码片段门禁：`docs/guide/*.md` 的 `ts` 片段里调用的标识符必须真的导出（见 §6）                              |
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
  - 要校验的场景在脚本里**硬编码**（当前 `m0`、`probe`、`stack`、`hud`、`modal`）——新增场景若需像素断言，必须同时加进 `PIXEL_EXPECTATIONS` 与该场景列表。
  - 需要先摆好状态的场景用 `SCENE_SETUP`（页内表达式，截图前执行）：`hud` 用它把相机滚到 (260,140)，于是「HUD 钉住不动 + 世界真的滚动」两件事都被像素断言（`score` 按钮在布局坐标上仍是 `#2f6feb`，而世界坐标 (960,520) 的瓦片色 `#161b22` 只有在相机滚动后才成立）。
  - 通用检查「画布清屏色」默认在画布内 4px 处取样（假设左上角是空的）；`#/hud` 的顶栏盖在那里，所以它用 `CANVAS_CLEAR_AT` 把取样点挪到两块瓦片之间的 2px 缝上（画布相对坐标 (340,60)），那里能看见相机背景色。
  - 被其它控件遮挡的采样点用 `{ rgb, fx, fy }` 指定相对采样位置。
  - 少数场景的**角落本来就不是清屏色**：`CANVAS_CLEAR_SKIP` 里的场景跳过通用 `canvas.clear` 检查，改由它自己的采样承担（`modal` 就是——模态遮罩按设计盖满整块画布，角落是「主题背景 × 半透明黑」的混合值，属于 GPU 取整问题）。跳过时**必须**在该场景补更具体的断言，不允许只是删掉检查。
  - 脚本起的 **preview 服务是 detached 进程组**（`pnpm exec vite preview` 被 `SIGTERM` 时不会带走真正的 vite 进程，早期版本因此每次运行都漏一个僵尸服务器占住端口，下轮就会报 `timed out waiting for vite preview`，见 DEFECT-BACKLOG V31）——改动脚本的收尾逻辑时请保持 `killGroup()`。
  - 脚本启动 Chrome 时**不传** `--user-data-dir`，因此依赖默认 profile 目录可写（`~/Library/Application Support/Google/Chrome`）。在受限/沙箱环境里 Chrome 会直接崩溃（Crashpad 写盘被拒），脚本报 `timed out waiting for chrome devtools endpoint` —— 这是环境限制而非脚本缺陷；此时请在汇报里说明「像素验收未运行」，并至少断言 `#status` 里的几何。
- **指南片段门禁**：`pnpm docs:check`（`scripts/check-doc-snippets.mjs`）把 `docs/guide/*.md` 的 `ts` 代码块里**被调用**的标识符与四个包（含 `widgets/compose` 子路径）的公开导出对照，抓「改了 API 没改文档」与拼写错误。它是语法层面的检查（先剥掉注释、字符串与 `{{ … }}` 模板占位，跳过片段内自己声明的名字），不是编译器；新增/重命名导出后请跑一次。
- **指针落点走树有 Node 单测**：`packages/phaser/test/target-walk.test.ts` 覆盖 `resolveTargetInTree()`（最深优先、隐藏子树跳过、容器链偏移、每个候选自己的坐标空间、**裁剪容器把整棵子树移出命中**等 14 条）——这是 V1/V8/V9/V23 四次缺陷的所在，改动 `InputRouter` 的命中逻辑（含 `pointerInWidgetSpace`、`clipsPointer`）时先跑它，再用浏览器验收。
- **交互状态矩阵**：`#/states`（`apps/examples/src/scenes/states.ts`）把每个有状态的控件摆成一行，并把 `visualState` 逐帧写进 `#demo-state` 的 `st.<name>`，坐标写进 `pt.<name>`。验收方式：用真实 `mouse.move`/`down`/`up`、`keyboard.press` 驱动悬停/按下/聚焦/校验，断言 `st.*` 的迁移（滑杆探针为 `slider.volume`/`slider.stepped`/`slider.disabled`，见 [`ACCEPTANCE-slider.md`](./docs/ACCEPTANCE-slider.md)）；在视口外的探针先用 `window.states.reveal(name)` 滚进视野（否则坐标在画布外，指针事件落不到控件上）。
- **相机钉住的 HUD**：`#/hud`（`apps/examples/src/scenes/hud.ts`）是 ADR-0009 的常驻验收场：2400×1600 的滚动世界 + `page.setScrollFactor(0)` 钉住的 HUD 页。`window.hud` 提供 `scroll(x,y)`/`auto(on)`/`spawn()`/`hitTest(name,x,y)`/`states()`/`states().<name>`；`#demo-state` 里的 `pt.<name>` 是页面坐标，`world.clicks` 是「点击穿透到游戏世界」的计数：页面的 `blockPointer: false` 让世界区域的点击照常到达游戏对象，而顶栏/底栏面板体与按钮会吞掉它（第 43 轮修复的 V9，矩阵见 `docs/ACCEPTANCE-hud.md` §5）。断言方式：先 `window.hud.scroll(260,140)` 再点 `pt.score`，读数应为 `clicks=1`、`focus=hud.scoreButton`；`spawn()` 后新增的按钮同样可点（`late.clicks=1`）。
- **表单状态机**：`#/form`（`apps/examples/src/scenes/form.ts`）是文本框/表单的综合验收页，暴露 `window.form`（`values()`/`errors()`/`states()`/`focus()`/`submitted()`）与逐帧 `st.name`/`st.email`/`st.notes`/`st.submit`、`name.length`、`notes.breaks`、`email.valid`、`hint`。验收矩阵（校验失败→修正、`maxLength`、`Enter` 提交、`Ctrl+Enter` 提交、触摸点击后输入）见 [`ACCEPTANCE-form.md`](./docs/ACCEPTANCE-form.md)。
- **绑定层状态机**：`#/bindings`（`apps/examples/src/scenes/bindings.ts`）逐帧发布 `pt.*` 与 `st.*`（`add`/`remove`/`details`/`busy`/`replace`）。验收矩阵（派生值随点击重算、`bindEnabled` 在两个边界自禁用、`bindVisible` 折叠后面板行位移、`bindCommand` 的 `canExecute` 期间禁用、`Replace view` 后绑定重挂）见 [`ACCEPTANCE-bindings.md`](./docs/ACCEPTANCE-bindings.md)。
- **控件画廊**：`#/gallery`（`apps/examples/src/scenes/gallery.ts`）是"每个控件、每种状态"的工厂 API 页：九个按钮全部命名并逐帧发布 `pt.<name>`/`st.<name>`，另发布 `focusables`（焦点集合的名字列表）。验收矩阵（禁用按钮拒绝悬停/点击且不在焦点集合、loading 拒绝激活但可聚焦、开关鼠标与键盘都能翻转、Tab 顺序与环绕）见 [`ACCEPTANCE-gallery.md`](./docs/ACCEPTANCE-gallery.md)。
- **模态对话框**：`#/modal`（`apps/examples/src/scenes/modal.ts`）是 `this.mvvm.modal` 的常驻验收场：五种对话框（确认 / 带输入框 / 不可关闭 / 无遮罩 / 嵌套两层）+ 一个 4000×4000 的「世界」（UI 之下的游戏对象）与两个页面按钮。`#demo-state` 逐帧发布 `depth`/`top`/`focus`/`focusables`/`page.clicks`/`world.clicks`/`closes`/`pt.*`/`st.*`/`counts.*`；`window.modal` 提供 `open(kind)`/`point(kind,name)`/`close`/`closeAll`/`state()`/`reasons()`/`counts()`/`churn(n)`。**验收要点是 A/B**：同一个点击在「没有对话框」时必须打到页面按钮或世界（`page.clicks`/`world.clicks` 增 1），在「有对话框」时必须两者都不增、只把对话框按 `backdrop` 关掉。矩阵与两个顺带修掉的输入缺陷（V17/V18）见 [`ACCEPTANCE-modal.md`](./docs/ACCEPTANCE-modal.md)。
- **页面栈**：`#/pages`（`apps/examples/src/scenes/pages.ts`）是 `this.mvvm.pages` 的常驻验收场：列表页（含一个可滚动列表、计数器与两个输入框）+ 详情页 + 第三层 + 从详情页打开的对话框。`window.pages` 提供 `open(i)`/`deeper()`/`dialog()`/`pop()`/`popToRoot()`/`point(name)`（**当前栈顶页**里某个控件的页面坐标，按需计算）/`scrollList(y)`/`listOffset()`/`state()`/`counts()`/`churn(n)`；`#demo-state` 逐帧发布 `depth`/`top`/`focus`/`focusables`/`clicks`/`field.length`/`list.offset`/`appBacks`/`resumes`/`disposes`/`counts.*`/`pt.*`/`st.*`。**核心判据是「离开的那一页怎么了」**：推入后 `focusables` 只剩新页、被盖住的页不可点不可输入（DOM 桥失焦）、`pop()` 后计数/文本/滚动偏移逐字保留且焦点回到此前持有的控件；`Esc` 的顺序是「模态 → 页面 → `mvvm.onBack`」。矩阵与三个修掉的缺陷（V20/V21/V22）见 [`ACCEPTANCE-pages.md`](./docs/ACCEPTANCE-pages.md)。
- **虚拟化列表**：`#/list`（`apps/examples/src/scenes/list.ts`）是 `Repeat` 虚拟化的常驻验收场（220 行、`itemExtent` 38、`overscan` 3）。`window.listDemo` 提供 `created()`（**自启动以来构建过多少行**——虚拟化的核心数字）、`offset()`/`scrollTo(y)`/`scrollRows(n)`、`window()`/`renderedKeys()`/`visibleKeys()`/`viewport()`、`point(key)`（**只在行位于视口内时**返回坐标；`pointMounted()` 是原始位置）、`add/shuffle/swapVisible/click/filter/clear`、`counts()`/`churn(n)`/`state()`；`#demo-state` 逐帧发布 `total/rendered/first/last/created/offset/maxOffset/filter/deleted`。**关键判据**：一行一行地滚，`created` 每步正好 +1（不是重建）；窗口内交换两行 `created` 不增长；overscan 行（挂载但在视口外）点了没反应；`churn(20)` 计数回基线。矩阵与修掉的文档型缺陷（V26）见 [`ACCEPTANCE-list.md`](./docs/ACCEPTANCE-list.md)。
- **无障碍镜像**：`#/a11y`（`apps/examples/src/scenes/a11y.ts`）是 `A11yBridge` 的常驻验收场（普通/开关/禁用按钮、滑杆、必填字段、多行字段、可点击卡片、滚动区 + 区内 6 个按钮，以及一个**不该**被镜像的 `Label`）。`window.a11y` 提供 `nodes()`/`node(name)`/`names()`（**逐属性读真实 DOM**）、`live()`/`liveAttributes()`/`announce(text)`、`focus(name)`/`focusName()`/`focusables()`、`sync()`/`refresh()`/`enabled(on)`、`setVolume(v)`/`validate()`、`counts()`/`state()`。**断言方式**：全部走 `querySelectorAll('[data-mvvm-a11y]')` 与节点属性（不是控件树）——只有这样才能抓到"对象里对、DOM 里错"。矩阵与两个设计缺口（V29 禁用控件缺席、V30 无 `label` 选项）见 [`ACCEPTANCE-a11y.md`](./docs/ACCEPTANCE-a11y.md)。
- **生命周期泄漏门禁**：`#/lifecycle`（`apps/examples/src/scenes/lifecycle.ts`）建一页全控件界面并暴露 `window.lifecycle.churn(n)`：重启场景 n 次、每轮采样 8 项计数（`themeListeners`/`displayList`/`focusables`/`pointerTargets`/`textures`/`tweens`/`timers`/`widgets`）。验收断言：每项只有一个取值 + `pages()` 只剩当前页 + 重启后 `pt.click` 能点、`pt.name` 能输入。改动插件生命周期、控件销毁或主题订阅后必须跑一次。
- **坐标探针：`reportControl` 是"创建时采样一次"**，只适合布局不会移动的页面；**布局会随使用变化的页面必须逐帧发布 `pt.*`**（`#/states`、`#/compose`、`#/hud`、`#/bindings` 都这么做）。否则探针会指向被挤到别处的控件，验收时表现为"点了没反应"甚至误判为框架缺陷（第 58 轮在 `#/bindings` 上真实发生过）。
- **示例场景约定**：在 `apps/examples/src/scenes/<name>.ts` 导出 `Phaser.Scene` 子类 → 注册进 `apps/examples/src/main.ts` 的 `SCENES`（hash 即场景名）。用 `status.ts` 的 `setStatus`/`appendStatus`/`reportWidget`/`reportCanvas` 输出可断言的几何；`#status`、`#demo-state` 在 CSS 里 `display: none`（内容供机器读，不画到画布上）。注意 `#demo-state` 是**空格分隔**的 `key=value`：值里含空格时（自由文本、输入框内容）必须走场景自己的 API（`window.<scene>.state()`）读取，不要在 DOM 文本上按空格切分。**已销毁的控件要发布 `st.<key>=gone`**（`#/modal`/`#/pages` 这么做），否则对话框关掉后 `st.*` 会停在最后一帧，读起来像"卡住了"。`?capture=1` 会开启 `preserveDrawingBuffer`，否则截图读不到 WebGL 帧。
- **性能预算**（PR 评审依据，PLAN §8）：1000 节点全量 `measure+arrange` < 1.5 ms（实测 0.06 ms）；无变化帧布局耗时 = 0（实测 0.024 ms、零测量）；布局约束缓存命中率 > 95 %（实测 95.6 %）；单节点编辑只重测该子树（实测 922 个节点里只重测 1 个）；排布热路径零新增对象/闭包（对象池长度稳定）；gzip 体积 `core`+`layout` < 25 KB、`phaser`+`widgets` < 45 KB（按 min+gzip，实测 18.3 / 14.7 KB）；文本度量缓存已实现（`packages/widgets/src/text-metrics.ts`，稳态命中率 100%）。怎么跑见 §8。
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
- **调试日志**：开发模式下框架会打印 `[phaser-mvvm]` 前缀的轨迹——建树/挂载/焦点（`ui()`、`render()`、`mount`、`focus`、`shutdown`）、慢布局趟（测量 ≥ 200 节点或 ≥ 2 ms）、**激活**（`activate: <name> (<source>)`，鼠标/键盘/手柄同一行）、**虚拟化窗口**（`repeat: window [start, end) of N - mounted M`）、**滚动被钳制**（`scroll: clamped (x, y) -> (nx, ny)`）。`setDevMode(false)` 之后一行不打（`packages/core/test/dev.test.ts` 有用例钉住，另见 [`ACCEPTANCE-devtrace.md`](./docs/ACCEPTANCE-devtrace.md)：开发模式下点一次按钮 8 行、关掉后同样操作 0 行，而功能不受影响）。阈值在 `packages/phaser/src/UIRoot.ts` 顶部；浏览器里用示例应用暴露的 `window.mvvmDev.setDevMode(false)` 就能当场验证。改动日志时保持两条纪律：**低频路径也要 `if (isDevMode())` 包住插值**、**发布模式零输出**。
- **性能/体积预算怎么跑**：`pnpm --filter @phaser-mvvm/layout run test`（含 `test/perf.test.ts`：1000 节点耗时、无变化帧、缓存命中率、单节点编辑增量性、对象池稳定性）与 `pnpm size`（`scripts/size-check.mjs`，按 min+gzip 判定 core+layout < 25 KB、phaser+widgets < 45 KB，同时打印未压缩 gzip）。改动布局引擎、控件度量或新增控件后请跑这两个。
- **起了后台服务就一定要确认收尾**：`spawn('pnpm', …, { detached: true })` + `process.kill(-pid)` 才能带走真正的子进程；只 `child.kill()` 会留下占着端口的僵尸（V31 的五个僵尸就是这么攒出来的）。收尾后请 `lsof -ti :<port>` 确认。
- **本机没有 `timeout` 命令**（macOS）；长命令用后台任务而不是 `timeout` 包裹。
- **Playwright MCP 的页面默认 rAF 被节流到 1 fps（必须在断言前 `page.bringToFront()`）**：Chromium 会把你没有激活的窗口判为遮挡并节流 `requestAnimationFrame`，而 `document.visibilityState` **仍然报 `'visible'`**，所以从页面上看不出来。实测：同一页面空闲测 12 帧得到 `[808,1017,1000,1017,1000,…]`，`page.bringToFront()` 之后立刻变成 `[12,17,17,17,17,16,…]`。**任何帧率/耗时/时序断言（含"某状态多久后才消失"）都必须先 `bringToFront()`**，否则结论会和节流周期（1 s）混在一起——第 39 轮就是这样误报了一个"滚动卡住 1.6 s"的缺陷（V10，已撤销）。`#demo-state` 由场景 `update()` 写入，被节流时也会看起来"落后约 1 秒"；对时序敏感时请读场景 API（如 `window.scrollDemo.offsets()`）。
- **`back`（`Esc` / 手柄 B）的归属是逐层路由的**：`planBack()`（`packages/phaser/src/back-plan.ts`，纯函数 + Node 单测）决定顺序——**模态 → 页面 → 应用**，`dismissible: false` 的对话框会**吞掉**这个键。应用级处理写 `this.mvvm.onBack`；**不要写 `this.mvvm.focus.onBack`**（那是插件安装路由钩子的地方，覆盖它 `Esc` 就再也关不掉对话框/返回不了上一页；开发模式下框架每帧恒等比较一次并打印指名警告）。
- **Phaser 的键盘管理器会丢弃 `defaultPrevented` 的按键**（`KeyboardManager.js:188`：`if (event.defaultPrevented …) return;`），而且 `KeyboardPlugin.update()` 在**每个**输入事件上重走一遍队列、只跳过**相邻**的重复事件。两条加起来就是第 60 轮的 V17（输入框 `preventDefault()` 掉 `Tab`，于是场景插件永远收不到）与 V18（`Shift+Tab` 同帧两个 keydown，`Tab` 被派发 2–3 次，一次按键走两三步）。**在 `packages/phaser` 之外自己挂 `keydown` 监听时务必知道这两点**：需要自己消费的键就自己转交 `FocusManager.handleAction()`，不要指望插件还能收到。
- **虚拟化列表里的"可见"有两层**：窗口挂载的行可能落在视口外（`overscan`），而那些行**不可点**（裁剪，V23）。写探针时要么用视口感知的坐标（`#/list` 的 `listDemo.point()` 只在行位于视口内时给坐标），要么像 `deletePoint()` 那样先按视口过滤——否则会得到"点了没反应"的假缺陷。
- **Phaser 的 `Container#remove` 会把子节点交回场景显示列表**：`exclusive` 容器（默认）的 `removeHandler` 调 `gameObject.addToDisplayList()`。所以"只脱离不销毁"的复用池（`Repeat` 的 filler 就是这么做的）会把游离节点留在渲染管线里，还带着自己的主题订阅——**脱离后请显式 `removeFromDisplayList()`**（重新 `addWidget` 时 Phaser 会自己再摘掉）。第 63 轮的 V27 就是这么来的，`#/lifecycle` 的 `displayList`/`sceneObjects` 计数就是它的门禁。
- **裁剪容器也裁剪命中**：`ScrollView` 声明 `clipsPointer = true`，路由器在**下钻之前**先判断点是否落在它的框内，框外整棵子树跳过——否则滚出视口的内容会在它的逻辑位置上继续悬停/可点（V23 实测：视口下方 y=671 处点一下，直接触发了看不见的 `row.8`）。写自定义裁剪容器时照抄这两行（`clipsPointer` + 自己的矩形就是视口）。
- **拖动归属必须释放**：`ScrollView` 的 `dragPointerId`/`barPointerId` 是"谁在拖我"的唯一凭据，而 `onPointerDown` 一旦发现归属非空就拒绝一切新按下。**任何"按下即武装、抬手结束"的路径都要在抬手时无条件释放归属**（V24：一次没移动过的点击会让滚动区永久拖不动），并且每帧按 `InputManager#pointers[id].isDown` 剪掉"指针没了但事件没到"的归属。`#/scroll` 的 `v.owner`/`v.barOwner` 空闲必须是 `none`。
- **手柄验收怎么做**：CDP 没有手柄输入域，所以用**假手柄**：`apps/examples/src/fake-pad.ts` 把 `navigator.getGamepads` 换成一个可变对象（Phaser 每帧就是这么读手柄的），`main.ts` 把它装成 `window.fakePad` —— `pads()`（Phaser 看到几个手柄，**没开手柄时是 0**）、`button(i, down)`（`0`=A、`1`=B、`12..15`=D-Pad）、`stick(dir, value?)`、`clear()`。游戏配置必须写 `input: { gamepad: true }`（Phaser 默认 `false`，示例直到第 64 轮才补上，而 `#/gallery` 的文案早已写着 "gamepad supported"）。矩阵见 [`ACCEPTANCE-gamepad.md`](./docs/ACCEPTANCE-gamepad.md)。
- **可访问名有两个来源，别让它们打架**：控件自己画的文字（`Button` 的 `text`、字段的 `placeholder`）是默认可访问名，**没有文字的控件必须用 `label` 选项**（`WidgetOptions.label` → `Widget.a11yLabel`），否则屏幕阅读器会读出调试 `name`（`a11y.volume` 这种内部 id）。`TextField`/`TextArea` 在 M5 就有 `label`，同一个选项现在既是 DOM 桥的可访问名、也是镜像的可访问名。新增选项时照 `baseWidgetOptions()` 转发——**没有代码读的选项等于骗人**（V13/V19/V30 是同一族）。
- **无障碍镜像跟着"可交互集合"走**：`A11yBridge` 从 `input.widgets`（`InputRouter` 注册集合）生成节点，所以**禁用控件有节点**（`aria-disabled`）、`Label`/装饰面板**没有**（没有描述符）；节点不可聚焦（键盘由框架接管），默认开启，`mvvm.a11y.enabled = false` 会把整层从 DOM 移除。节点数是"用户能作用的控件数"，可用来当结构变化的门禁。
- **"这个方向归谁"只写一遍**：`Widget.onAction(action, source)` 是与设备无关的优先处理权（键盘与手柄都走 `MVVMPlugin.dispatchAction()`），`onKeyDown` 只留非导航的键（打字、`Home`/`End`、`PageUp`/`PageDown`）。值控件要沿**自己的轴**认方向、交叉轴明确拒绝，否则手柄用户会被卡在控件里（V28）。动作 ↔ 方向键的对应关系用 `ARROW_KEY_OF_DIRECTION`，别在两处各写一份。
- **触摸验收怎么做**：`Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`（CDP），见 `docs/ACCEPTANCE-touch.md`；`window.hud.pointers()` 会同时给出鼠标指针与触摸指针（`wasTouch`/坐标/最后一次 DOM 事件）便于定位。**多指**：示例游戏配有 `input: { activePointers: 2 }`（共 3 个指针），一次 `dispatchTouchEvent` 可带多个触点，每个触点自带 `id`，`touchMove` 要带上当前**所有**活跃触点、`touchEnd` 只带抬起的那个；拖动类控件（`ScrollView`/`Slider`）只认抓住它的那个 `pointer.id`。**一次验收只用一种输入设备**：混用 `page.mouse` 与触摸仿真会让一次手势变成两个指针。模态与页面栈的触摸矩阵（点遮罩关闭、在遮罩/按钮上拖动不算点击、列表拖动不误触行、两指各管各的）见 [`ACCEPTANCE-touch.md`](./docs/ACCEPTANCE-touch.md) §3.7。
- **文档数字会滞后**：`README.md`、`CONTRIBUTING.md`、`docs/ACCEPTANCE-*.md` 里的里程碑状态与测试数量彼此不一致（例如三份文档分别写着 M0–M2 / M0–M7 与不同的用例数）。**以代码、`pnpm -r run test` 的实跑结果和 CI 为准**；顺手更新过时描述是受欢迎的改动。
- **不要引入浏览器测试框架**（仓库无 Playwright 依赖，验收走 `scripts/visual-check.mjs` 的 CDP）；任何新运行时依赖都需要 ADR。

## 9. 变更范围纪律

- 只改与任务相关的文件；当前工作区可能已有他人未提交的在制品（`git status` 先看），不要顺手格式化或回滚它们。
- 不要为了「让检查通过」而降低断言强度、跳过测试或删除门禁脚本；发现真实缺陷就修根因，并在提交信息/汇报中说明。
