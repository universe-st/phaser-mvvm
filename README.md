# phaser-mvvm

基于 **Phaser 4**（`phaser@4.2.1 "Giedi"`）的 **MVVM UI 框架**：在 Phaser 4 渲染管线上提供「响应式数据 + 声明式视图 + 自动布局 + 基础控件」的完整方案 —— 不 fork Phaser，只用公开 API 与插件/工厂注册，游戏逻辑照常使用原生 Phaser。

> **当前状态：M0–M7 已完成并通过验收（2026-09），API 仍未冻结；M8 的 `ModalStack`/页面栈/`UIScene` 与 M9 的手柄导航/`A11yBridge` 已交付（`Router`、开闭动效、真实屏幕阅读器仍未开始）。**
> 已交付：workspace 骨架与 CI、响应式内核 `@phaser-mvvm/core`（281 个单测）、渲染无关的两阶段布局引擎 `@phaser-mvvm/layout`（314 个单测，含黄金快照与 `perf.test.ts` 性能门禁）、Phaser 4 适配层（`Widget`/`UIRoot`/`MVVMPlugin`/输入与焦点路由/主题令牌/绑定，329 个单测）、控件库 `@phaser-mvvm/widgets`（Label/Panel/Button/Image/Rect/Spacer/Divider/TextField/TextArea/ScrollView/Repeat + DOM 输入桥，373 个单测）与 **Compose 风格 DSL**（`@phaser-mvvm/widgets/compose`，推荐写视图的方式）。**合计 1297 个单测**，另有可执行的性能/体积门禁（`pnpm --filter @phaser-mvvm/layout run test`、`pnpm size`）。
> 验收场：`#/compose`（DSL，含工厂 API 与 DSL 的逐节点 parity 校验）、`#/showcase`（全部控件与布局形态，已迁移到 DSL）、`#/states`（交互状态矩阵）、`#/lifecycle`（创建→销毁 100 次泄漏门禁），以及 `#/gallery`、`#/dashboard`、`#/bindings`、`#/form`、`#/list`（虚拟化列表：一行一步只建一行、键控复用、视口裁剪、泄漏门禁）、`#/scroll`、`#/modal`（模态对话框：焦点陷阱 / 遮罩拦截 / `Esc` 关闭 / 叠层 / 100 次开关无泄漏）、`#/pages`（页面栈：列表→详情→对话框、返回时状态与焦点复原、`Esc` 逐层路由）、`#/list`（虚拟化列表的构建计数与键控复用）、`#/a11y`（无障碍镜像：每个可交互控件的隐藏 DOM 节点与 `aria-live` 播报）、`#/config`（插件选项：游戏级默认值与运行期补丁）、`#/uiscene`（`UIScene` 基类：`content()` 自动挂载、`setContent()` 整页替换、`onBack()` 先于应用层、20 次替换不泄漏）。鼠标、触摸、手柄（D-Pad/摇杆）三条输入路径与无障碍镜像都有常驻验收。
> 各轮验收证据与已知边界见 [`docs/ACCEPTANCE-compose-dsl.md`](./docs/ACCEPTANCE-compose-dsl.md)、[`ACCEPTANCE-layout-defects.md`](./docs/ACCEPTANCE-layout-defects.md)、[`ACCEPTANCE-lifecycle.md`](./docs/ACCEPTANCE-lifecycle.md)、[`ACCEPTANCE-states.md`](./docs/ACCEPTANCE-states.md)、[`ACCEPTANCE-performance.md`](./docs/ACCEPTANCE-performance.md)、[`ACCEPTANCE-dsl-entry.md`](./docs/ACCEPTANCE-dsl-entry.md)、[`ACCEPTANCE-round8.md`](./docs/ACCEPTANCE-round8.md)；未修/待验证项见 [`docs/DEFECT-BACKLOG.md`](./docs/DEFECT-BACKLOG.md)。
> **API 仍可能调整**：项目仍在起步阶段，破坏式更新与重构是被接受的（见 `AGENTS.md` §4）。

---

## 1. 目标与非目标（摘要）

完整清单见 [`docs/PLAN.md` §1](./docs/PLAN.md)。

**目标（Phase 1）**

| #   | 目标                                                                                                      | 里程碑       |
| --- | --------------------------------------------------------------------------------------------------------- | ------------ |
| G1  | 响应式数据层：`ref/reactive/computed/watch`，变更后同帧批量刷新、无重复布局                               | M1           |
| G2  | 自动布局：纵向/横向/网格/层叠/绝对定位；固定、百分比、内容自适应、填充、伸缩、间距、内边距、对齐          | M2           |
| G3  | MVVM 绑定：单向、双向（表单）、命令、列表 `repeat`（键控复用 + 可选虚拟化）、格式化器/校验器              | M6           |
| G4  | 基础控件：`Panel`、`Label`、`TextField`、`TextArea`、`Button`、`Image`、`Spacer`、`Divider`、`ScrollView` | M4 / M5 / M7 |
| G5  | 与 Phaser 4 正交：不 fork、只用公开 API；游戏逻辑照常用原生 Phaser                                        | M3           |
| G6  | 可测试：响应式与布局引擎零渲染依赖，可在 Node 中单测（含布局黄金快照）                                    | M1 / M2      |

**非目标（明确排除，避免范围失控，见 PLAN §1.2）**

- 不做 HTML/CSS 引擎或浏览器兼容层（无 CSS 选择器、层叠、伪类）。
- 不做可视化 UI 编辑器 / 设计稿导入。
- 不做 3D、物理、粒子相关控件。
- **不兼容 Phaser 3 API**（只吸收 rexUI 的设计经验）。
- 不做 WCAG 全量合规认证：a11y 限定为「键盘全可达 + 手柄导航 + 隐藏 DOM 镜像（供屏幕阅读器与 `aria-live` 播报）」，**M9**。
- Phase 1 不做 URL 路由（只做轻量 `Router`：路由名 → Page，**M8**）；模板层 `@phaser-mvvm/template` 延后到 **Phase 2**。

---

## 2. 架构

### 2.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ apps/examples (Vite)                                         │  示例与验收场
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/template   JSON/模板 → builder 编译（Phase 2）   │  可选层（延后）
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/widgets    Panel/Label/TextField/TextArea/      │  控件库
│                         Button/Image/Spacer/Divider/         │
│                         ScrollView/Repeat/Modal              │
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/phaser     Widget 基类(Container 适配)、UIRoot、 │  Phaser 适配层
│                         测量器、输入/焦点/导航路由、          │  ← 唯一允许 import
│                         ScenePlugin、工厂注册、主题、页面体系  │     Phaser 的包
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/layout     纯布局引擎：约束、测量、排布、        │  零 Phaser 依赖
│                         脏标记、缓存、像素对齐                │  → 可在 Node 单测
├──────────────────────────────────────────────────────────────┤
│ @phaser-mvvm/core       响应式(reactive/ref/computed/watch/  │  零 Phaser 依赖
│                         effect/scope)、集合、绑定上下文、     │
│                         表达式编译、调度器                    │
└──────────────────────────────────────────────────────────────┘
```

依赖方向严格单向（禁止反向与环）：`apps → widgets → phaser → { core, layout }`；`core` 与 `layout` 互不依赖，是两个独立的零渲染基座。详见 [`docs/adr/0001-package-layout.md`](./docs/adr/0001-package-layout.md)。

### 2.2 包职责

| 包                      | 职责                                                                                                                                                                                            | 状态                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@phaser-mvvm/core`     | 响应式、调度器（`sync/pre/frame`）、集合、绑定上下文、路径表达式编译（不使用 `eval`/`new Function`）                                                                                            | 包骨架已建（M0）；实现中（**M1**，**M6** 补绑定）                      |
| `@phaser-mvvm/layout`   | 约束、`LayoutParams`、测量、排布（box/grid/stack/absolute/fit）、脏传播与 relayout boundary、测量缓存、像素对齐、对象池                                                                         | 实现中（**M2**）                                                       |
| `@phaser-mvvm/phaser`   | `Widget` 基类、`UIRoot`、`PhaserTextMeasurer`(+LRU)、`InputRouter`、`FocusManager`、`NavSource`、`A11yBridge`、`MVVMPlugin`、工厂注册、主题、`UIScene`/`Page`/`PageStack`/`ModalStack`/`Router` | 包骨架已建（M0）；**M3** 适配层，**M8** 场景与页面，**M9** 导航与 a11y |
| `@phaser-mvvm/widgets`  | 控件库：`Panel`/`Label`/`Button`/`Image`/`Spacer`/`Divider`（**M4**）、`TextField`/`TextArea`（**M5**）、`Repeat`（**M6**）、`ScrollView`（**M7**）、`Modal`（**M8**）                          | 包骨架已建（M0）；实现自 **M4** 起                                     |
| `@phaser-mvvm/template` | JSON/模板 → builder 编译                                                                                                                                                                        | **未创建，Phase 2**                                                    |

### 2.3 当前进度（M0–M2 已完成，M3+ 未开始）

里程碑级事实（详细验收证据见 [`docs/ACCEPTANCE-M0-M2.md`](./docs/ACCEPTANCE-M0-M2.md)）：

| 位置                   | 现状                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src`    | **M1 完成**：`ref/reactive/computed/watch/watchEffect/effect/effectScope/makeObservable`、`pre`/`post`/`frame` 三档调度器（`nextTick`/`flushSync`/`flushFrame`/`configureScheduler`）、循环更新保护；**175 个单测**                          |
| `packages/layout/src`  | **M2 完成**：`BoxConstraints`、`LayoutParams` 归一化、`LayoutEngine`（测量缓存 + 脏传播 + relayout boundary + 像素对齐）、`box`/`grid`/`stack`/`absolute` 四种排布、`measureContent`/`applyRect` 节点契约；**251 个单测**（含 4 个黄金快照） |
| `packages/phaser/src`  | **M3 部分先行**：`Widget`（`Container` + `LayoutNode`）、`UIRoot`、`MVVMPlugin`（`this.mvvm`，帧对齐 flush）、工厂注册、`RectWidget`/`LabelWidget` 探针控件。`input`/`focus`/`nav`/`a11y`/主题/`scene/*`（M8）尚未建立                       |
| `packages/widgets/src` | 仅入口占位；**M4** 起的控件库尚未实现                                                                                                                                                                                                        |
| `apps/examples/src`    | 三个场景：`#/m0`（vbox→hbox→两个矩形）、`#/probe`（stack + absolute + 百分比 + 嵌套 box）、`#/stack`（层叠与负偏移角标）；页面底部 `#status` 输出引擎实际分配的 rect，供无头校验断言                                                         |
| `scripts/`             | `visual-check.mjs`：CDP 驱动单个无头 Chrome（固定视口）→ 读 `#status` 几何 + 截图 → `png-sample.py` 采样像素比对；`png-sample.py`                                                                                                            |
| `docs/`                | `PLAN.md`、`adr/`（8 篇）、`ACCEPTANCE-M0-M2.md`；`api/`、`widget-spec/` 属 **M10**，尚未创建                                                                                                                                                |

仓库级门禁目前全绿：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm -r run build`、`pnpm exec prettier --check .`、`pnpm run build:examples`、`node scripts/visual-check.mjs`。

---

## 3. 快速开始

前置：**Node 24**、**pnpm 10**（仓库 `packageManager` 固定为 `pnpm@10.34.5`）。

```bash
# 1) 安装依赖（workspace 链接）
pnpm install

# 2) 启动示例（Vite dev server，端口固定 5173）
pnpm dev
#   → http://localhost:5173
#   注意：端口写死为 5173 且 strictPort: true，被占用时会直接报错而不是换端口；
#   请先释放 5173，或先停止其它 dev server。

# 3) 其它常用命令
pnpm test          # pnpm -r run test（core/layout 为纯 Node vitest）
pnpm typecheck     # pnpm -r run typecheck（tsc --noEmit，strict）
pnpm build         # pnpm -r run build（tsup：ESM + CJS + d.ts）
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
pnpm build:examples # 构建示例（vite build）
pnpm preview       # 预览构建产物（端口 4173）
```

> 示例自 **M0** 起逐步补齐：入口 `apps/examples/src/main.ts` 与场景目录已存在（含 M0 验收场景与 probe 场景），但能否跑通取决于当前检出时各包 `src/` 的完成度（见 §2.3）。控件画廊页自 **M4** 起，表单示例自 **M5** 起。

---

## 4. 最小代码示例（已实现）

视图用 **Compose 风格 DSL** 写：嵌套调用 + 内容 lambda，没有 `this.add` 前缀、没有 children 数组。

```ts
import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { MVVMPlugin } from '@phaser-mvvm/phaser';
import {
  Button,
  Column,
  Divider,
  List,
  Panel,
  render,
  Row,
  Scroll,
  Spacer,
  Text,
  TextField,
} from '@phaser-mvvm/widgets/compose';
// 用 DSL 不需要 installFactories()/installWidgetFactories()：那两个只注册 this.add.* 工厂方法。

// ViewModel：普通 TS 类 + ref/computed
class UserFormVM {
  name = ref('');
  users = ref<User[]>([]);
  valid = computed(() => this.name.value.trim().length >= 2);
  save(): void {
    /* … */
  }
}

export class DemoScene extends Phaser.Scene {
  create(): void {
    const vm = new UserFormVM();

    render(this.mvvm, () => {
      Panel({ variant: 'surface', radius: 12, padding: 16, width: 480, gap: 12 }, () => {
        Text('用户信息', { style: { fontSize: '18px' } });
        TextField({ value: vm.name, label: '姓名', placeholder: '请输入姓名', clearable: true });
        Text(() => (vm.valid.value ? '姓名有效' : '姓名至少 2 个字符'), { tone: 'muted' });
        Divider({});

        Scroll({ direction: 'vertical', height: 200, width: 'fill' }, () => {
          List(
            {
              items: () => vm.users.value,
              key: (user) => user.id,
              virtualize: true,
              itemExtent: 34,
            },
            (user) => {
              Row({ gap: 8, height: 30, alignItems: 'center', width: 'fill' }, () => {
                Text(() => user.name);
                Spacer({ flex: true });
              });
            },
          );
        });

        Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
          Button('取消', { variant: 'ghost' });
          Button('保存', { variant: 'primary', onClick: () => vm.save() });
        });
      });
    });
  }
}

new Phaser.Game({
  // …
  dom: { createContainer: true },
  plugins: { scene: [{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm' }] },
  scene: [DemoScene],
});
```

三件事需要记住：

1. **`render(this.mvvm, () => { … })` 是入口**：建树与挂载一次完成（底层等价形式是 `const page = ui(this, () => { … }); this.mvvm.mount(page);`，需要在挂载前拿到根控件时用后者）。
2. **数据槽位接受常量 / `ref` / getter**：`Text(() => …)` 是单向，`TextField({ value: ref })` 是双向（IME 组合期暂停写回）。
3. **工厂 API 仍然可用**（`this.add.uiButton(...)`、`vbox([...])`）：DSL 只是更顺手的写法，两者建的是同一批控件，可混用。

完整教程见 [`docs/guide/09-compose-dsl.md`](./docs/guide/09-compose-dsl.md)；可运行示例见 `pnpm dev` → `#/compose`（逐控件验收）与 `#/showcase`（工厂 API 版验收页）。

---

## 5. 开发约定

1. **TypeScript strict**：继承 `tsconfig.base.json`，开启 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`verbatimModuleSyntax` 等；类型检查用 `tsc -p tsconfig.json`（`noEmit`），不做跨包 composite 构建。
2. **Prettier 统一格式**：配置见 `.prettierrc.json`（`singleQuote`、`printWidth: 100`、`trailingComma: all`、`semi`、`arrowParens: always`）。提交前跑 `pnpm format`；CI 跑 `pnpm exec prettier --check .`。`docs/PLAN.md` 已在 `.prettierignore` 中（它是冻结的评审文档，不做格式化）。
3. **相对导入不带扩展名**：`import { ref } from './reactivity/ref'`（`moduleResolution: bundler`）。跨包引用走包名（`@phaser-mvvm/core`），由 workspace 协议解析到源码。
4. **只有 `packages/phaser` 允许 `import` Phaser**：`core`/`layout` 必须零 Phaser 依赖（含类型）；`widgets` 通过 `@phaser-mvvm/phaser` 间接使用。构建时 `phaser` 一律 `--external`。见 [ADR-0001](./docs/adr/0001-package-layout.md)、[ADR-0003](./docs/adr/0003-layout-is-renderer-agnostic.md)、[ADR-0005](./docs/adr/0005-phaser-dependency.md)。
5. **布局算法不依赖渲染**：文本度量通过注入的 `Measurer` 接口获得，测试用等宽假测量器，保证黄金快照确定。
6. **响应式副作用必须归入 `EffectScope`**：控件/页面的 `destroy()` 要停 scope、注销输入、归还对象池；泄漏回归是硬门禁（场景创建→销毁 100 次后计数归零）。
7. **UI 刷新默认帧对齐**（`flush: 'frame'`）：不要用 `sync` 绕过批量刷新。见 [ADR-0008](./docs/adr/0008-reactivity-and-scheduler.md)。
8. **新增包、引入运行时依赖、改变包间依赖方向 —— 必须新增一篇 ADR**（新编号，不修改历史 ADR）。见 [`docs/adr/README.md`](./docs/adr/README.md)。
9. **不使用 `eval` / `new Function`**：路径表达式编译为 getter/setter 闭包，保证 CSP 环境可用。
10. **提交前自查**：`pnpm format:check`、受影响包的 `typecheck` / `test`；涉及控件的改动需附带示例页（M4 起截图回归）。
11. **CI**：`.github/workflows/ci.yml` 在 `push` 与 `pull_request` 上运行 Prettier 检查、逐包 `typecheck`、逐包 `test`、逐包 `build` 与示例构建。四个包当前都有测试（合计 **1297** 个用例：core 281 / layout 314 / phaser 329 / widgets 373）；`packages/phaser`、`packages/widgets` 的 `test` 脚本带 `--passWithNoTests`，只为「暂时没有测试也不至于失败」，不代表可以长期没有断言。

---

## 6. 目录结构

下面是 PLAN §3.2 定义的**目标结构**（尚未全部落地；当前实际快照见 §2.3，标 `# 尚未创建` 的目录现在不存在）：

```
phaser-mvvm/
├─ pnpm-workspace.yaml
├─ tsconfig.base.json                  # strict: true, noUncheckedIndexedAccess
├─ .prettierrc.json / .prettierignore
├─ .github/workflows/ci.yml
├─ packages/
│  ├─ core/          src/{reactivity,collections,binding,expression,scheduler,util}
│  ├─ layout/        src/{constraint,params,measure,arrange,arrangers,nodepool,snap}
│  ├─ phaser/        src/{Widget,UIRoot,measurer,input,focus,nav,a11y,plugin,factory,theme,pool}
│  │                 src/scene/{UIScene,Page,PageStack,ModalStack,Router}   # M8
│  ├─ widgets/       src/{panel,label,textfield,textarea,button,image,spacer,divider,scrollview,repeat,modal}
│  └─ template/      src/{parser,compiler,renderer}            # Phase 2（尚未创建）
├─ apps/
│  └─ examples/      # index.html + vite.config.ts（dev 端口 5173）
│                    # 控件画廊（每个控件一页）+ 性能基准页，自 M4 起
│                    # apps/form-demo 规划中（完整 MVVM 表单），尚未创建
└─ docs/             # PLAN.md、adr/
                     # api/（TypeDoc，M10）、widget-spec/（M10）尚未创建
```

---

## 7. 文档索引

| 文档                                                                           | 内容                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/PLAN.md`](./docs/PLAN.md)                                               | **唯一事实来源**：目标/非目标、技术基线与源码调研结论、总体架构、核心设计、API 草案、里程碑 M0–M10、测试与性能预算、风险对策、已冻结决策（§10.1–§10.3）       |
| [`docs/guide/`](./docs/guide/README.md)                                        | **使用指南（教程式，以已实现代码为准）**：快速开始、布局、全部控件、文本框与表单、列表与滚动、数据绑定与主题、交互与导航、Compose 风格 DSL、生命周期与速查表  |
| [`docs/ACCEPTANCE-options.md`](./docs/ACCEPTANCE-options.md)                   | 验收记录：选项审计（拼错的选项被指名 + 建议、发布模式零输出、全示例零误报与门禁的阳性对照）                                                                   |
| [`docs/ACCEPTANCE-a11y.md`](./docs/ACCEPTANCE-a11y.md)                         | 验收记录：无障碍镜像与浏览器可访问性树、`aria-live` 播报、**状态变化主动同步（V52）**                                                                         |
| [`docs/ACCEPTANCE-compose-dsl.md`](./docs/ACCEPTANCE-compose-dsl.md)           | 验收记录：Compose DSL、逐控件／逐布局实测、缺陷修复清单                                                                                                       |
| [`docs/ACCEPTANCE-layout-defects.md`](./docs/ACCEPTANCE-layout-defects.md)     | 验收记录：布局引擎缺陷批次（缓存键、脏标记时机、`reset`、上下文池、stretch 钳制）与 Playwright 复现证据                                                       |
| [`docs/ACCEPTANCE-states.md`](./docs/ACCEPTANCE-states.md)                     | 验收记录：交互状态矩阵（hover/press/focus/error/disabled 真实输入扫描）与指针聚焦缺陷                                                                         |
| [`docs/ACCEPTANCE-options.md`](./docs/ACCEPTANCE-options.md)                   | 验收记录：选项审计（拼错的选项在开发模式下被指名 + 建议、发布模式零输出、全示例零误报与门禁的阳性对照）                                                       |
| [`docs/ACCEPTANCE-keyboard.md`](./docs/ACCEPTANCE-keyboard.md)                 | 验收记录：`VirtualKeyboard` 屏幕键盘（手柄 `A` 打字 / 鼠标 / 触摸、`⇧` 一次性与锁定、换键盘泄漏门禁、37 个控制节点的可访问性树断言）与三个缺陷（V47/V48/V49） |
| [`docs/ACCEPTANCE-performance.md`](./docs/ACCEPTANCE-performance.md)           | 验收记录：PLAN §8 性能与体积预算的实测（1000 节点 0.06 ms、无变化帧零测量、缓存 95.6%、体积 18.3/14.7 KB）                                                    |
| [`docs/ACCEPTANCE-dsl-entry.md`](./docs/ACCEPTANCE-dsl-entry.md)               | 验收记录：`render()` 入口、控制流演示、DSL 优先的快速开始与文档对齐                                                                                           |
| [`docs/ACCEPTANCE-round8.md`](./docs/ACCEPTANCE-round8.md)                     | 验收记录：命令绑定的指针可达性（V4 复现+修复）与 `#/showcase` 迁移到 DSL 的等价性核对                                                                         |
| [`docs/ACCEPTANCE-v1-camera-pinned.md`](./docs/ACCEPTANCE-v1-camera-pinned.md) | 验收记录：相机钉住的 UI 可点击（V1 的两道闸门、命中测试读数与修复前后对比）                                                                                   |
| [`docs/PITFALLS.md`](./docs/PITFALLS.md)                                       | 已知易踩的坑的完整版（`AGENTS.md` §8 的展开：每条含现象 → 根因 → 修法 → 实测数字）                                                                            |
| [`docs/DEFECT-BACKLOG.md`](./docs/DEFECT-BACKLOG.md)                           | 审计发现的缺陷登记簿（待修／待验证／覆盖率缺口）                                                                                                              |
| [`docs/HANDOVER.md`](./docs/HANDOVER.md)                                       | 交接说明：当前状态、已修复清单的证据位置、下一步计划（按建议顺序）与工作约定速记                                                                              |
| [`docs/adr/`](./docs/adr/README.md)                                            | 架构决策记录（ADR-0001…0008 及索引）；新决策新增编号                                                                                                          |
| `docs/api/`（**M10**，TypeDoc 生成，尚未创建）                                 | 生成的 API 参考                                                                                                                                               |
| `docs/widget-spec/`（**M10**，尚未创建）                                       | 控件规格文档；落地前以 [`docs/guide/`](./docs/guide/README.md) 的控件章节为现行参考                                                                           |

关键 ADR 速览：包划分 [0001](./docs/adr/0001-package-layout.md)｜两阶段布局 [0002](./docs/adr/0002-two-pass-layout.md)｜layout 零 Phaser 依赖 [0003](./docs/adr/0003-layout-is-renderer-agnostic.md)｜DOM 输入桥 [0004](./docs/adr/0004-dom-input-bridge.md)｜Phaser 依赖方式 [0005](./docs/adr/0005-phaser-dependency.md)｜Phase 1 范围 [0006](./docs/adr/0006-phase1-scope.md)｜Phaser 4 WebGL 约束 [0007](./docs/adr/0007-phaser4-webgl-constraints.md)｜响应式与调度器 [0008](./docs/adr/0008-reactivity-and-scheduler.md)。

---

## 8. 许可证

MIT（与 Phaser 一致）。各 `packages/*` 的 `package.json` 已声明 `"license": "MIT"`；根目录的 `LICENSE` 文件尚未创建，随 **M0** 骨架补齐。
