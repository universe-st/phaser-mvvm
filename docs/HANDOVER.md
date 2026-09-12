# 交接说明 · 当前状态与后续计划（截至第 21 轮）

> 这份文档是**给下一个会话（或下一个 agent）看的**：本仓库连续 21 轮的工作到这里告一段落，所有改动都已提交、工作区干净、门禁全绿。下面写清「现在是什么状态」「每一项结论的证据在哪」「接下来该做什么、为什么」。
> 事实来源仍是代码与 `pnpm -r run test` 的实跑结果；本文件只做导航与交接。

---

## 1. 当前状态（已验证）

| 检查 | 结果                                                                                                                                | 怎么复现                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 单测 | **986 passed**：core 278、layout 306、phaser 121、widgets 281                                                                       | `pnpm -r run test`                                                                     |
| 类型 | 5/5 包通过                                                                                                                          | `pnpm -r run typecheck`                                                                |
| 格式 | 干净                                                                                                                                | `pnpm exec prettier --check .`                                                         |
| 体积 | 两组均在预算内（core+layout 18.3 KB、phaser+widgets 14.7 KB，min+gzip）                                                             | `pnpm size`                                                                            |
| 场景 | **13/13 加载零错误**；`#/lifecycle` 31 轮计数全平、仅 1 页存活；`#/states` 15 个探针静止态正确；`#/compose` 11 个分区且 `parity=ok` | Playwright MCP 打开 `http://localhost:5173/#/compose` 等（详见各轮 `ACCEPTANCE-*.md`） |

工作区：干净，`main` 上连续提交（最近：`017685f`）。

---

## 2. 目标 1（像 Jetpack Compose 一样写 UI）——已达成的部分

- **入口**：`render(this.mvvm, () => { … })` 一次调用建树 + 挂载；`ui(scene, () => { … })` 只建不挂（切页/对话框用）。
- **覆盖面**：容器 `Column`/`Row`/`Grid`/`Stack`/`Absolute`/`Panel`(=Surface)/`Scroll`；叶子 `Text`/`Button`/`Image`/`Rect`/`Spacer`/`Divider`/`TextField`/`TextArea`；列表 `List`(=Repeat，可虚拟化)。选项对象与控件类完全一致，**没有第二套词汇**。
- **反应式**：数据槽位（文本、输入框 `value`）与外观槽位（`tone`/`variant`/`disabled`/`loading`）都接受常量 / `ref` / getter；所有 composable 支持 `visible`（隐藏即退出布局流 = Compose 的 `if`）。
- **控制流**：内容是同步执行的，所以 `if`/`for`/`switch` 直接写即可（`#/compose` 的 `Flow` 分区有可点按演示）。
- **文档**：01 章按 DSL 重写；09 章是 DSL 手册（含 §4.1 控制流、§7 自定义控件加入树）；README §4 用 `render()`；02–07 章开头有「本章片段用工厂写法，推荐 DSL」横幅。
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
8. PLAN §8 的六条性能/体积预算**从口号变成门禁**（`packages/layout/test/perf.test.ts` + `pnpm size`），并已实测（1000 节点 0.06 ms、无变化帧零测量、缓存 95.6%、单节点编辑只重测 1/922、文本度量缓存稳态 100% 命中）。

---

## 4. 下一步计划（按建议顺序）

| #   | 任务                                                             | 为什么值得做 / 起点                                                                                                                                                                                                                                                                | 完成判据                                                                                            |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | **V1：相机被滚动且 UI 被 `setScrollFactor(0)` 钉住时点击不生效** | 已复现（`#/states` 上设 `root.setScrollFactor(0)` + `camera.scrollX/Y=260/140` 后点按钮无反应）；已排除「改我们自己的指针坐标」这条路（改完结果不变，已回滚）。线索：路由器订阅的是**每个控件自己的 Phaser 指针事件**（`input.ts:433 register()`），真正的闸门是 Phaser 的命中测试 | 在 `#/m0`/`#/states` 上做一个相机钉住的 HUD 场景，点击/悬停都能生效；并把原因写进 ADR-0007 或新 ADR |
| 2   | **指南 02–07 片段改写为 DSL**                                    | 约 140 处工厂写法；建议从最常被复制的 03 控件参考章开始，再 04/05 的完整示例                                                                                                                                                                                                       | 每章改完与 `#/compose`/`#/showcase` 对照一次；删掉该章的「写法提示」横幅                            |
| 3   | **Node 侧假渲染器夹具**                                          | 让 `packages/phaser`/`widgets` 的生命周期与输入逻辑能进 CI（现在只能靠浏览器门禁）                                                                                                                                                                                                 | 至少覆盖「创建→销毁 ×100 计数归零」「主题订阅回基线」「`#/states` 的状态迁移」中的前两项            |
| 4   | **`#/showcase` 像素验收**                                        | 迁移后只做过几何/状态等价；`visual-check.mjs` 的场景与 `PIXEL_EXPECTATIONS` 是硬编码的                                                                                                                                                                                             | 把 `showcase` 加进脚本场景列表与像素期望（注意 `?capture=1`）                                       |
| 5   | **框架缺口**（`docs/guide/08 §5.3` 仍列着）                      | ① 文本框没有聚焦/失焦事件；② `MVVMPluginConfig` 传不进 Game Config（Phaser 只读 `key`/`plugin`/`mapping`）；③ `UIRoot` 不自动 `setScrollFactor(0)`；④ `LayoutParams.hideMode` 解析了但不生效                                                                                       | 每项要么实现，要么把文档改成「有意如此」并说明替代做法                                              |

---

## 5. 工作约定速记（改代码前必读）

- 只有 `packages/phaser` 能 `import phaser`；`core`/`layout` 零依赖；`packages/phaser/src/uiscope.ts`（DSL 作用域）必须保持可在 Node 单测。
- 提交前：`pnpm -r run typecheck`、`pnpm -r run test`、`pnpm exec prettier --check .`、`pnpm run build:examples`；改动布局/度量再加 `pnpm size`。
- 验收优先用 Playwright MCP：读 `#status`（几何）与 `#demo-state`（状态），`pt.<key>=@x,y` 是可点击控件的页面坐标；含空格的值走 `window.<scene>.state()`（DOM 文本按空格分隔，会截断）。
- 调试日志：开发模式打印建树/挂载/焦点/慢布局轨迹，`setDevMode(false)` 后零输出；新增日志要保持「发布模式零开销」。
- 详细规则见 [`AGENTS.md`](../AGENTS.md)，架构事实来源见 [`PLAN.md`](./PLAN.md)。
