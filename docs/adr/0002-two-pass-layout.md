# ADR-0002：两阶段 measure/arrange 布局模型

- 状态：Accepted
- 日期：2026-09
- 决策来源：PLAN.md §4.2、§8（性能预算）、§9（风险）、§10.1 决策 4
- 影响范围：`@phaser-mvvm/layout` 的公开模型、`Widget` 的子类契约、快照测试格式

## 背景

Phaser 的 `Container` 只提供 `getBounds()`（逐子节点递归求并集），没有约束概念。若直接在 `getBounds` 之上实现「内容自适应尺寸」，会出现两类问题：

1. **单遍布局无法表达「百分比 / fill / grow」**：百分比需要父内容盒已知，`grow` 需要先知道其余兄弟的自然尺寸才能分配剩余空间；
2. **单遍布局无法缓存**：父容器每次都要重新询问子节点尺寸，1000 节点树的全量布局会退化为每次变更全树重算。

PLAN §4.2 明确要求「约束下行、尺寸上行」的模型，并要求「仅改一个子节点时排布工作量与其子树同阶」（M2 验收标准）。

## 决策

布局引擎采用 **两阶段 `measure → arrange`**：

### 1. 约束模型（下行）

```ts
interface LayoutConstraint {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  mode: 'unbounded' | 'atMost' | 'exactly';
}
```

### 2. `LayoutParams`（节点自身的布局意图）

`width` / `height`（`number | 'auto' | '50%' | 'fill' | { min?, max? }`）、`grow` / `shrink` / `basis`、`margin` / `padding`、`alignSelf`、`aspectRatio`、`position: 'flow' | 'absolute'`、`ignoreLayout`、`gridColumn/gridRow/gridColumnSpan/gridRowSpan`、`order`。

### 3. 两阶段职责

| 阶段                  | 方向     | 行为                                                                                                                                             |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `measure(constraint)` | 约束下行 | 叶节点（`Label`/`Image`）调用注入的 `Measurer` 求内容尺寸；容器按自身策略（box/grid/stack/absolute/fit）组合子尺寸。百分比基于**父内容盒**解析。 |
| `arrange(rect)`       | 尺寸上行 | 父节点把最终矩形下发；`fill`/`grow` 在此分配剩余空间；节点把矩形落到实际渲染对象。                                                               |

### 4. 缓存：以 `(约束, 内容修订号)` 为键

- 内容（文本、子节点、样式、主题）变化 → 递增该节点的**内容修订号**；
- 约束变化 → 键自然失配，自动失效；
- **排布（arrange）总是重算**，不做缓存（成本低，且能避免矩形陈旧）。

### 5. 脏传播与 relayout boundary

`markNeedsLayout()` 向上冒泡，遇到「尺寸不受父约束影响的节点」（固定尺寸；或内容自适应且外部约束未变）即**停止冒泡**，该节点即为 relayout boundary。边界内重新 `measure`，边界外复用既有尺寸，只在必要时重新 `arrange`。

### 6. 像素对齐

内部保留亚像素位置与尺寸；在 `arrange` 末尾对**文本与细线**做 DPR 感知取整，由 `snapTextToPixel` / `roundPixels` 控制（默认开启）。

## 理由与权衡

- **表达力**：只有先测量全部子节点的自然尺寸，才能正确分配 `grow`/`fill` 与 `justifyContent: space-between`，这是 PLAN §4.2 列出的排布能力的硬前提。
- **性能可预测**：`(约束, revision)` 缓存 + relayout boundary 是为 §8「无变化帧布局耗时 = 0」和「单节点内容变更仅重算 boundary 子树」服务的，两件事必须成对实现，缺一不可。
- **语义对齐成熟体系**：Flutter 的 constraints-go-down/sizes-go-up、WPF 的 `Measure/Arrange` 都被大量项目验证过，用户学习成本低（PLAN §4.7）。
- **代价**：一次性遍历变成两次遍历，且 `arrange` 不做缓存——对「布局参数每帧都变」的极端场景，收益下降。我们用「帧对齐刷新」（ADR-0008）保证一帧只布局一次来兜住这一点。
- **被放弃的方案**：
  - 单遍立即布局（命令式 Sizer 风格）：无法表达百分比与剩余空间分配，且缓存无从下手。
  - 直接复用 `Container.getBounds()`：每次递归整棵子树，与 §8 预算冲突。
  - 把 `arrange` 也缓存：需要维护「父是否移动」的额外失效逻辑，收益低而 bug 面大。

## 后果

### 正面

- `measure` 的结果可以在约束不变时跨帧复用，命中率高时布局开销趋近于「只有变化的子树」。
- 布局测试可以直接断言「约束树 → 矩形树」（JSON 黄金快照），与渲染完全解耦。
- `relayout boundary` 让万级节点树的增量布局成为 O(变化量)，而不是 O(节点数)。

### 负面

- 子类必须同时实现 `onMeasureContent(constraint)` 与 `onArrange(rect)`，漏实现一侧会出现「尺寸对但位置错」的隐性问题，需要靠快照测试兜住。
- **内容修订号的递增责任落在控件作者身上**：改文本、换贴图、改样式却忘记 `invalidateContent()`，会拿到陈旧尺寸。这是本设计最需要文档与测试约束的点。
- 亚像素 + 末尾取整意味着「逻辑矩形」与「渲染像素」不总是相等，调试时需要明确看的是哪一个。

## 相关

- PLAN.md §4.2 布局引擎（模型、排布策略、缓存、脏传播、像素对齐、零分配）
- PLAN.md §7 测试策略（layout 黄金快照）、§8 性能预算与体积目标
- PLAN.md §9 风险：团队学习成本（两阶段布局）
- ADR-0003（layout 零 Phaser 依赖）、ADR-0008（响应式与调度器，帧对齐刷新）

## 现状校正

> 上面的正文写于决策当时，决策本身未变。以下是**与当前代码不一致的名字与边界**。

- 约束类型是 `BoxConstraints { minWidth, maxWidth, minHeight, maxHeight }`（`packages/layout/src/constraint.ts`），**没有 `mode` 字段**，也没有 `LayoutConstraint` 这个符号；`unbounded()` / `atMost()` / `tight()` / `loose()` 是工厂函数。
- `LayoutParams` 里**没有 `ignoreLayout`**（仓库里不存在这个键）。实际键表见 `packages/layout/src/params.ts` 的 `LAYOUT_PARAM_KEYS`，除正文列的以外还有 `minWidth`/`maxWidth`/`minHeight`/`maxHeight`、`left`/`top`/`right`/`bottom`、`hideMode`；min/max 钳制是 `LengthValue { value, min?, max? }`。
- 容器策略是 `box` / `grid` / `stack` / `absolute` / **`scroll`**（`packages/layout/src/types.ts` 的 `ContainerLayout`）：没有 `fit` 容器（`fit` 只是图片的适配模式，见 `packages/widgets/src/fit.ts`），而正文漏了 `scroll`。
- 测量缓存的键是 `(约束, 百分比基准, node.revision)` —— 百分比基准（containing block）必须一起进键（`packages/layout/src/engine.ts` 文件头与缓存实现），这是第 2 轮修掉的一类缺陷。
- 脏传播的入口是 `Widget.markDirty()`（`packages/phaser/src/Widget.ts`）+ `LayoutEngine.invalidate()` 里的边界行走（`isRelayoutBoundary`，`packages/layout/src/types.ts`）；**没有 `markNeedsLayout()`**。
- 像素对齐由 `LayoutEngineOptions.snapMode`（默认 `'round'`，取值 `none`/`round`/`floor`/`ceil`）与 `dpr` 控制，作用对象是**整个矩形**；**没有 `snapTextToPixel()` / `roundPixels`**。
- 节点契约是 `measureContent(constraint): Size` 与 `applyRect(rect): void`（`packages/layout/src/types.ts`，`Widget` 在 `packages/phaser/src/Widget.ts` 覆写），内容失效走 `markDirty()`；**没有 `onMeasureContent()` / `onArrange()` / `invalidateContent()`**。
