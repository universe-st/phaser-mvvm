# 缺陷清单（审计发现 → 处理状态）

本文件是**审计发现的缺陷登记簿**，用于跨轮次跟踪：每条给出严重度、位置、可复现的依据与建议修法，并标注状态。事实来源仍然是代码与测试；本文件只记录「已知但尚未修」的东西，修好后把状态改为 `已修复` 并附上提交/测试位置。

- 审计方式：只读子代理审查全部 `packages/*/src`，要求给出 `file:line` + 具体输入→错误输出；可疑但未证实的单独列出。
- 已修复并带回归测试的部分见 [`ACCEPTANCE-compose-dsl.md`](./ACCEPTANCE-compose-dsl.md) §4。

状态图例：`已修复` / `待修`（确认成立、未修）/ `待验证`（疑似，尚未证实）。

**第 2 轮更新**：L1–L8、W1–W3 已修复，§3 的 V5（模板二次反转义）与 V6（转换器名字 trim）也已确认并修复；证据见 [`ACCEPTANCE-layout-defects.md`](./ACCEPTANCE-layout-defects.md)。表中保留原始描述与修法以便追溯，剩余未处理项为 W4 与 §3 其余疑似项。

---

## 1. `packages/layout`（引擎层）— **L1–L8 全部已修复（第 2 轮）**

| #   | 状态   | 严重度   | 位置                                                          | 问题                                                                                                                                                                                                                                      | 修法                                                                         |
| --- | ------ | -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L1  | 已修复 | HIGH/MED | `engine.ts:279`（key）、`246-284`                             | 测量缓存键只含约束+修订号，**不含 percent/`fill` 基准**；同一引擎用不同 `percentBase` 布局根节点会命中陈旧测量（实测：`{width:400}` 得 200，改 `{width:100}` 仍得 200，新引擎得 50）。`layout(root, constraint, percentBase)` 是公开 API  | 键里并入 `base.width/base.height`                                            |
| L2  | 已修复 | MED      | `engine.ts:177`、`clearDirty 613-621`                         | `layout()` 在**结尾**清脏标记，pass 内（`measureContent`/`applyRect`/同步 watcher）产生的 `invalidate()` 被静默丢弃 → 永久陈旧几何（实测后续 `layout()` 测量次数为 0）                                                                    | 改为 pass 开始清脏，或按代数重新入队                                         |
| L3  | 已修复 | MED      | `engine.ts:235-242`、`493-501`                                | `reset()`（字体/主题全局变更）只丢缓存不标脏，且 arrange 仍跳过干净子树（实测 `inner` 高度保持 20）                                                                                                                                       | `reset(node)` 递归标脏或丢弃子树 `appliedRects`                              |
| L4  | 已修复 | MED      | `engine.ts:152`、`570-611`                                    | `contextPool` 的 `contextDepth` 只增不减，池退化为「每访问一个容器槽位留一条」并强引用 `ctx.node`/`ctx.children[i].node`（实测 9 节点链后池长 21，8/9 已脱离节点仍可达），与其它 WeakMap 纪律矛盾，影响「创建→销毁 100 次计数归零」硬门禁 | arranger 返回时 `finally` 释放（深度索引化），并在 `clearDirty()` 里置空引用 |
| L5  | 已修复 | MED      | `box.ts:347-353`、`grid.ts:395-408`                           | `'stretch'` 直接给子节点整条交叉轴长度，**丢弃子节点 min/max**，与 measure 阶段（`engine.ts:320-325`）自相矛盾（实测 `maxWidth:50` 得到 200；`minWidth:300` 得到 200；同节点放 `stack` 里却保持 300）                                     | 用子节点交叉轴 min/max 夹取拉伸值                                            |
| L6  | 已修复 | LOW      | `constraint.ts:55-67` vs `geom.ts:95-100`/`engine.ts:624-639` | `min > max` 有两套策略（中点 vs 取 min），中点数还依赖 `enforce` 调用次数（实测 `minWidth:300` 在 200 宽容器里得 275）                                                                                                                    | 统一为 CSS 的「min 胜出」并写进文档                                          |
| L7  | 已修复 | LOW      | `engine.ts:624-639`、`params.ts:239-278`、`geom.ts:115-127`   | NaN/Infinity 长度与 `dpr <= 0` 会静默传播成 NaN 矩形（实测 `width: NaN` → rect NaN；`dpr: 0` → 全部 NaN）                                                                                                                                 | 非有限长度视为未设置；构造时夹取/告警 dpr                                    |
| L8  | 已修复 | LOW      | `engine.ts:281-283/341-351/178`                               | `layout()` 返回缓存内部的 `Size` 对象，调用方改一下就会污染缓存（实测 `size.width = 999` 后不再重测）                                                                                                                                     | 存/返回副本                                                                  |

## 2. `packages/widgets`（控件层）— **W1、W2 已修复（第 2 轮）**

| #   | 严重度 | 位置   | 问题                                                        | 修法                                                                                                                                                                                        |
| --- | ------ | ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | 已修复 | MED    | `Repeat.ts:554-563`（+`376-391`、`repeat-plan.ts:190-193`） | 自身与父容器高度都未解析时 `viewportSize()` 返回 0 → 虚拟窗口塌成 `overscan` 行（`overscan: 0` 时 0 行），但 `maxScrollOffset` 仍声称整表可滚，且**无告警**（指南 §7 的最小示例就踩这个坑） | 视口为 0 时告警，并回退到最近的非零祖先高度/外层 `ScrollView` 视口                    |
| W2  | 已修复 | MED    | `ScrollView.ts:585-592/595-618/416-434`                     | 内容范围重算后从不重新 clamp：滚到底再删行/放大视口 → `currentY > limitY` 停在越界位置（空白），`thumbGeometry` 又把 progress 夹到 [0,1] 掩盖问题                                           | `onRectChanged` 先测量再 clamp；`sync()` 刷新后在非拖拽/非惯性时重新 clamp + 应用偏移 |
| W3  | 已修复 | LOW    | `scroll-plan.ts:127-134`                                    | `ThumbGeometry.position` 文档写「轨道比例 0…1」，实现与使用都是像素（已改为「像素」）                                                                                                       | 改文档或改名 `positionPx`                                                             |
| W4  | 待验证 | 待验证 | `ScrollView.ts:602-605`                                     | `height = target.maxOffset + viewport.height` 混用了 Repeat 自身视口与 ScrollView 视口，二者不等时 `contentHeight`/`limitY` 可能失真（末行不可达或滚出空白）                                | 需在渲染环境实测后判定                                                                |

## 3. 疑似项（第 2 轮已处理 V5、V6）

> V5（转换器字符串字面量二次反转义）与 V6（`registerConverter` trim 不一致）在第 2 轮确认成立并修复，回归用例见 `packages/core/test/binding.test.ts`（`converter registry · name handling`、`template literals · escaping`）；W3（`ThumbGeometry.position` 文档）已改为「像素」。
> 下面保留原始描述；未标注的条目仍未证实，勿按缺陷处理。

| #   | 位置                                                    | 疑点                                                                                                                                                          |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | `input.ts` `resolveTarget` / `ScrollView.containsPoint` | 命中测试用 `pointer.worldX/Y`（相机感知）比对场景空间坐标，相机被 scroll/zoom 时失效（插件默认相机是静止的，故未复现）                                        |
| V2  | `ScrollView.enableClip`                                 | Phaser `Filters` 组件销毁时未显式 `filters.destroy()`，`addMask` 的 Mask filter 未见释放路径（共享 `__WHITE` 纹理，未观察到 GPU 泄漏）                        |
| V3  | `ScrollView.ts:830`                                     | 最内层不可滚动的 `ScrollView` 也 `preventDefault()`，指针在其上时页面无法滚动（注释显示可能是有意设计，待产品确认）                                           |
| V4  | `binding.ts` `bindCommand` / 直接赋值 `onActivate`      | 挂载后新绑定的命令不会被输入路由收集（路由器只在结构变化时刷新）；现有控件都带 `focusable/interactive/blockPointer` 标记故未复现                              |
| V5  | `template.ts:216-238`                                   | **已修复**：转换器字符串字面量曾二次反转义（先解 `\\` 再解 `\n`），`{{ p \| default('C:\\new') }}` 会渲染成换行；现在单趟解转义，回归用例见 `binding.test.ts` |
| V6  | `converter.ts:103-139`                                  | **已修复**：四个入口统一使用 trim 后的名字（此前 `registerConverter(' money ')` 注册的转换器查不到、也用不了）                                                |
| V7  | `template.ts`                                           | `}}` 出现在引号内的转换器参数里会截断占位符（报 `TemplateSyntaxError`，是「响亮的错误」而非静默错误）                                                         |

## 4. 覆盖率缺口（不是缺陷，但值得补门禁）

- 仓库**没有**自动化门禁覆盖「场景创建→销毁 100 次后计数归零」「场景关闭后 `themeListenerCount()` 回到基线」「`InputRouter`/`FocusManager`/`ScrollView`/`Repeat`/`TextInputBase` 生命周期」——现有 `packages/{phaser,widgets}/test` 只测纯函数。建议在 M8 前补一个 Node 侧的假渲染器夹具，或把该门禁放进 Playwright 验收脚本。
