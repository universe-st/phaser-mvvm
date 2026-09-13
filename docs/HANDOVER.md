# 交接说明 · 第 21 轮快照 + 当前状态（滚动更新）

> 这份文档是**给下一个会话（或下一个 agent）看的**：第 1–3 节与第 4 节是**第 21–26 轮的快照**（当时的状态与当时的计划，保留下来做历史），第 1.1 节与第 4.1 节是**当前状态**——两者不一致时以第 1.1/4.1 节与代码为准。
> 事实来源仍是代码与 `pnpm -r run test` 的实跑结果；本文件只做导航与交接，规格与门禁细节看 [`PLAN.md`](./PLAN.md) 与 [`AGENTS.md`](../AGENTS.md)。

## 1.1 当前状态（第 110–112 轮：M9 收尾 + 公开 API 冻结 + 范围收紧到 Android + Android 模拟器验收）

| 检查     | 结果                                                                                                                                                                                                                           | 怎么复现                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 单测     | **1377 passed**：core 281、layout 314、phaser 386、widgets 396（第 110 轮 +16：4 条焦点事件用例、10 条导航来源与插件配置用例）                                                                                                 | `pnpm -r run test`                                                                                                             |
| 类型     | 5/5 包通过（含 `apps/examples`）                                                                                                                                                                                               | `pnpm -r run typecheck`                                                                                                        |
| 格式     | 干净（`docs/PLAN.md` 与布局黄金快照在忽略列表里）                                                                                                                                                                              | `pnpm exec prettier --check .`                                                                                                 |
| 指南门禁 | 通过：195 个选项键、21 个 DSL 导出、idiom/vocabulary 零违规（7 张非选项表按设计跳过）                                                                                                                                          | `pnpm docs:check`                                                                                                              |
| API 冻结 | **817 个导出名**（5 个入口点）与 `docs/API-SURFACE.json` 一致；四个包版本 `1.0.0`                                                                                                                                              | `pnpm api:check`（ADR-0011）                                                                                                   |
| 体积     | 均在预算内：core+layout **18.6 KB**、phaser+widgets **32.2 KB**（min+gzip；第 110 轮复测，phaser 侧 +0.9 KB 来自导航来源层）                                                                                                   | `pnpm size`                                                                                                                    |
| 场景     | 注册表 **23 个场景**；`visual-check` 硬编码 13 个：**96 个像素检查（48×2）+ 4 张 AX 表全部 OK**                                                                                                                                | `node scripts/visual-check.mjs`（受限沙箱里 Chrome 可能起不来，见 AGENTS §6）                                                  |
| 里程碑   | **M0–M8 全部交付**；**M9 全部交付**（手柄导航 / 无障碍镜像 / 手柄文本输入 / `NavSource` 抽象）；真机与真人验证范围见 PLAN §1.2                                                                                                 | [`PLAN.md`](./PLAN.md) §6 的「执行状态」段落                                                                                   |
| 仍未完成 | **Android 物理设备验证**（模拟器已验收 9/9，见 [`ACCEPTANCE-android.md`](./ACCEPTANCE-android.md)；iOS / 桌面真机、真实屏幕阅读器、真实手柄硬件都在范围外）、`@phaser-mvvm/template`（Phase 2）、M10 的 TypeDoc 与控件规格文档 | [`PLAN.md`](./PLAN.md) §1.2、[`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md)、[`guide/08 §5`](./guide/08-lifecycle-and-pitfalls.md) |

提交历史已远超第 21 轮；工作区状态请自己跑 `git status` 与 `git log -1` 确认（不要相信本文里的旧哈希）。

### 第 110 轮做了什么（三条待完成项 + 契约冻结）

| #   | 项目                                         | 结果                                                                                                                                                            | 证据                                                                                                  |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | **焦点/失焦事件**（指南 08 §5.3 缺口①）      | `widget:focus`/`widget:blur` 从 `Widget.setFocusedInternal()`（焦点变化的唯一漏斗）发出，每个可聚焦控件都有；`#/states` 的 `events()` 探针常驻                  | [`ACCEPTANCE-states.md`](./ACCEPTANCE-states.md) §9、`#/states` 真鼠标与 `Tab` 实测                   |
| 2   | **Game Config 条目传选项**（缺口②）          | 选项写在 `plugins.scene[].data`，插件从 `game.config.installScenePlugins` 读回；`#/config` 断言 `默认值(120) < 条目(320) < 运行期补丁(50)`                      | [`ACCEPTANCE-config.md`](./ACCEPTANCE-config.md) §6、[`PITFALLS.md`](./PITFALLS.md) §8.71（修掉 V78） |
| 3   | **`NavSource` 具名抽象**（PLAN M9 最后一项） | `NavSource` + `NavSourceRegistry`（每源一只 `NavRepeat`）+ 内置 `KeyboardNavSource`/`GamepadNavSource`；`mvvm.registerNavSource/unregisterNavSource/navSources` | [`ACCEPTANCE-gallery.md`](./ACCEPTANCE-gallery.md) §6、`packages/phaser/test/nav.test.ts`（+6 条）    |
| 4   | **三条覆盖率缺口**（DEFECT-BACKLOG §4）      | Node 假渲染器夹具（真 `Widget` 能进 CI）、聚焦字段后重启不留闪烁定时器、多场景 `add→launch→stop→remove` 计数回基线                                              | [`ACCEPTANCE-lifecycle.md`](./ACCEPTANCE-lifecycle.md) §6                                             |
| 5   | **公开 API 冻结（1.0）**                     | 四包 `1.0.0`；`scripts/check-api-surface.mjs` + `docs/API-SURFACE.json` 钉住 5 个入口点的 817 个导出名，进 CI                                                   | [ADR-0011](./adr/0011-public-api-freeze.md)                                                           |

---

## 1. 第 21 轮快照（历史，已被 §1.1 取代）

| 检查 | 结果（第 21 轮）                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 单测 | 986 passed：core 278、layout 306、phaser 121、widgets 281                                                                       |
| 类型 | 5/5 包通过                                                                                                                      |
| 格式 | 干净                                                                                                                            |
| 体积 | 第 107 轮复测：core+layout 18.6 KB、phaser+widgets 31.3 KB，min+gzip                                                            |
| 场景 | 13/13 加载零错误；`#/lifecycle` 31 轮计数全平、仅 1 页存活；`#/states` 15 个探针静止态正确；`#/compose` 11 个分区且 `parity=ok` |

工作区：第 21 轮结束时干净。

---

## 2. 目标 1（像 Jetpack Compose 一样写 UI）——已达成的部分

- **入口**：`render(this.mvvm, () => { … })` 一次调用建树 + 挂载；`ui(scene, () => { … })` 只建不挂（切页/对话框用）。
- **覆盖面**：容器 `Column`/`Row`/`Grid`/`Stack`/`Absolute`/`Panel`/`Scroll`（`Panel` 就是 Compose 的 `Surface`/`Card`；**没有别名**，第 95 轮把没人用过的 `Surface` 删掉了）；叶子 `Text`/`Button`/`Image`/`Rect`/`Spacer`/`Divider`/`TextField`/`TextArea`；列表 `List`(=Repeat，可虚拟化)。选项对象与控件类完全一致，**没有第二套词汇**。
- **反应式**：数据槽位（文本、输入框 `value`）与外观槽位（`tone`/`variant`/`disabled`/`loading`）都接受常量 / `ref` / getter；所有 composable 支持 `visible`（隐藏即退出布局流 = Compose 的 `if`）。
- **控制流**：内容是同步执行的，所以 `if`/`for`/`switch` 直接写即可（`#/compose` 的 `Flow` 分区有可点按演示）。
- **文档**：01 章按 DSL 重写；09 章是 DSL 手册（含 §4.1 控制流、§7 自定义控件加入树）；README §4 用 `render()`；02–07 章**已改写为 DSL 写法**，章首横幅现在说的是「本章代码用 Compose 风格 DSL 书写，与工厂写法等价」。
- **活样例**：`#/compose`（DSL，含工厂 vs DSL 的逐节点 parity 校验）与 `#/showcase`（全部控件形态，已迁移到 DSL，迁移前后各分区控件数与几何完全一致）。

## 3. 目标 2（查缺补漏）——已修复的 20 项

按「最值得记住」排序（完整清单见各轮验收记录与 `DEFECT-BACKLOG.md`）：

1. **`shallowReactive(Map/Set)` 栈溢出**（`reactive.ts`）：RAW 判定只认 `reactiveMap`，浅代理自我递归。
2. **场景重启后 UI 既不拆解也不刷新**（`plugin.ts`，HIGH）：`boot()` 用 `once` 订阅又在 `dispose()` 里全部退订，而 `boot()` 每场景只跑一次 → 每轮泄漏一整棵 UI 树（主题订阅 40→3781、指针目标 13→1287、文本纹理 23→2185），且 `PRE_UPDATE` 永久失效。由新建的 `#/lifecycle` 门禁第一次运行就抓到。
3. **指针按下从不移动焦点**（`input.ts`）：点击按钮后 `focusedWidget` 仍为 null，焦点环不出现，`Tab` 总是从第一个可聚焦控件重开。由 `#/states` 抓到。
4. **`bindCommand` 的指针可达性**（`binding.ts`）：静止页面上后绑定的命令收不到点击；A/B 实测修复前 0 次、修复后 1 次。
5. **布局引擎 8 项**（第 2 轮）：缓存键缺百分比基准、pass 内 `invalidate()` 被丢弃、`reset()` 不重排、上下文池强引用、`stretch` 丢 min/max、`min > max` 双策略、非有限长度/dpr、返回值污染缓存。
6. **`ScrollView` 偏移不重新夹取**（第 2 轮，先在浏览器复现：视口变大后停在 224.5 / limit 0 的空白处）。
7. **`ProceduralSkin` 在 `radius: 0` 时画不出边框**；**`deepEqual` 不对称**；**抛错的 `computed` 保留陈旧缓存**；**`watch([reactiveObject])` 永不触发**；**`readonly(ref)` 不再是 ref**；**省略号与垂直移动切坏代理对**；**`filterNumeric` 产出 `NaN`**；**模板字面量二次反转义**；**转换器名字 trim 不一致**；**网格索引未净化**；**`EffectHandle.run()` 文档与行为不符**。
8. PLAN §8 的六条性能/体积预算**从口号变成门禁**（`packages/layout/test/perf.test.ts` + `pnpm size`），并已实测（1000 节点 0.108 ms、无变化帧零测量、缓存 95.59%、单节点编辑只重测 1/922、文本度量缓存稳态 100% 命中；第 107 轮复测读数，随机型漂移见 `ACCEPTANCE-performance.md` §7）。

---

## 4. 下一步计划（第 21 轮写下，除第 5 项外都已交付）

| #   | 任务                                                             | 为什么值得做 / 起点                                                                                                                                                                                                                                                                                               | 完成判据                                                                                                                                         | 现状                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **V1：相机被滚动且 UI 被 `setScrollFactor(0)` 钉住时点击不生效** | **根因已定位**（第 27 轮读源码）：Phaser 的命中测试用的是**被点中对象自己**的 `scrollFactor`（`src/input/InputManager.js:924-925`：`px = worldX + cs*obj.scrollFactorX - cs`），而随后的 `getWorldTransformMatrix()` 已经包含被钉住的根的位移；我们只钉了根、叶子的 `scrollFactor` 仍是 1，两者因此差一个相机偏移 | 给整棵树设 `scrollFactor(0)`：加 `root.setScrollFactorAll(0)` 并在 `addWidget` 时对新子树一并设置；在相机钉住的 HUD 场景上验收，把原因写进新 ADR | ✅ 已交付：`setScrollFactorAll()` + `addWidget` 继承，[ADR-0009](./adr/0009-camera-pinned-ui-and-input.md)、`#/hud`、[`ACCEPTANCE-v1-camera-pinned.md`](./ACCEPTANCE-v1-camera-pinned.md) |
| 2   | **指南 02–07 片段改写为 DSL**                                    | 约 140 处工厂写法；建议从最常被复制的 03 控件参考章开始，再 04/05 的完整示例                                                                                                                                                                                                                                      | 每章改完与 `#/compose`/`#/showcase` 对照一次；删掉该章的「写法提示」横幅                                                                         | ✅ 已完成（章首横幅已改成 DSL 写法说明）                                                                                                                                                  |
| 3   | **Node 侧假渲染器夹具**                                          | 让 `packages/phaser`/`widgets` 的生命周期与输入逻辑能进 CI                                                                                                                                                                                                                                                        | 至少覆盖「创建→销毁 ×100 计数归零」「主题订阅回基线」「`#/states` 的状态迁移」中的前两项                                                         | 大部分已达成：`packages/phaser` 23 个纯 Node 测试文件（370 条）覆盖输入/焦点/动效/路由/无障碍；`#/lifecycle` 的 100 次重启仍是浏览器门禁                                                  |
| 4   | **`#/showcase` 像素验收**                                        | 迁移后只做过几何/状态等价；`visual-check.mjs` 的场景与 `PIXEL_EXPECTATIONS` 是硬编码的                                                                                                                                                                                                                            | 把 `showcase` 加进脚本场景列表与像素期望（注意 `?capture=1`）                                                                                    | ✅ 已交付：`showcase` 在 13 个门禁场景里，`SCENE_SETUP` 用 `await showAndReport("sizing")`，四个采样点明暗两套（[`ACCEPTANCE-showcase.md`](./ACCEPTANCE-showcase.md) §7.5）               |
| 5   | **框架缺口**（`docs/guide/08 §5.3` 仍列着）                      | ① 文本框没有聚焦/失焦事件；② `MVVMPluginConfig` 传不进 Game Config（Phaser 只读 `key`/`plugin`/`mapping`）；③ `UIRoot` 不自动 `setScrollFactor(0)`；④ `LayoutParams.hideMode` 解析了但不生效                                                                                                                      | 每项要么实现，要么把文档改成「有意如此」并说明替代做法                                                                                           | ①② ✅ **第 110 轮实现**（事件 + 条目 `data` 通道，见 §1.1）；③ 仍然成立（已写进指南 08 §5.3，两种钉法都支持）；④ ✅ 第 53 轮实现                                                          |

---

## 4.1 会话结束时的状态（第 22–26 轮）

第 22–26 轮**没有代码改动**：这几轮只做了「验证 + 文档收尾」（22/25 为只读验证；23/24 补了两条指南的「缺口 → 今天可行的做法」说明；另外第 17–19 轮修掉了 `uiScroll`、`WIDGET_EVENTS` 两个导出缺口并补全了待办清单）。原因是**执行会话的上下文预算耗尽**：剩余工作（第 4 节里的 1–5 项）全都属于**必须用 Playwright MCP 验收行为**的改动，而本项目自己的标准（也是用户的目标 3）不允许只凭 typecheck/test 就报告完成，因此宁可停手也不提交未验证的行为变更。

**当时的下一个会话建议从第 4 节的第 1 项（V1）开始**——那条早已交付（见上表「现状」列）。今天要接着做的话，看 §1.1 的「仍未完成」一行与 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md)（每一项都有原始描述与已排除的路径）。

---

## 5. 工作约定速记（改代码前必读）

- **Phaser 只出现在两个包**：`packages/phaser` 与 `packages/widgets` 都把 `phaser` 当 peer dependency 直接 `import`；`core`/`layout` 零 Phaser 依赖（连类型都不引）。`packages/phaser/src/uiscope.ts`（DSL 作用域）与 widgets 的纯逻辑模块必须保持可在 Node 单测。
- 提交前：`pnpm docs:check`、`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples`；改动布局/度量再加 `pnpm size`；改动控件外观/几何/交互再跑 `node scripts/visual-check.mjs`。
- 验收优先用 Playwright MCP：读 `#status`（几何）与 `#demo-state`（状态），`pt.<key>=@x,y` 是可点击控件的页面坐标；含空格的值走 `window.<scene>.state()`（DOM 文本按空格分隔，会截断）。
- 调试日志：开发模式打印建树/挂载/焦点/慢布局轨迹，`setDevMode(false)` 后零输出；新增日志要保持「发布模式零开销」。
- 详细规则见 [`AGENTS.md`](../AGENTS.md)，架构事实来源见 [`PLAN.md`](./PLAN.md)。
