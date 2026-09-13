# ADR-0003：layout 包零 Phaser 依赖（注入测量器）

- 状态：Accepted
- 日期：2026-09
- 决策来源：PLAN.md §3.1「关键架构决策」、§1.1 目标 G6、§7 测试策略、§10.3 工具链
- 影响范围：`@phaser-mvvm/layout` 的公开接口、`PhaserTextMeasurer`、测试与 CI 形态

## 背景

文本是 UI 布局中唯一「不确定尺寸」的来源：同一段文字在 `12px` 与 `16px` 下宽度完全不同，换行宽度又反过来决定高度。在 Phaser 里，这个能力由 `Text` 的度量（`src/gameobjects/text/MeasureText.js`、`TextStyle#metrics`）提供——即：**测量的实现天然依赖渲染库**。

如果把测量直接写进布局算法，布局引擎就会 `import phaser`，后果是：

- 布局单测必须在 headless Chrome + WebGL 环境里跑；
- 黄金快照不稳定（字体在不同机器/DPR 下有细微差异）；
- Phaser 4.x 升级会直接波及布局代码。

PLAN §1.1 目标 G6 要求「响应式与布局引擎零渲染依赖，可在 Node 中单元测试（含布局快照测试）」。

## 决策

**`@phaser-mvvm/layout` 不依赖 Phaser，也不依赖任何渲染库；文本度量通过接口注入。**

1. 布局包内定义测量器接口（概念签名，实现见 `packages/layout/src`）：

   ```ts
   interface Measurer {
     // 返回给定文本在给定样式与可用宽度下的内容尺寸
     measureText(
       text: string,
       style: TextStyleSpec,
       maxWidth: number,
     ): { width: number; height: number };
   }
   ```

2. 叶节点只认接口：`Label`/`Image` 等叶节点的 `onMeasureContent(constraint)` 调用注入的 `Measurer`，不感知 Phaser。
3. 两种实现：
   - **生产**：`@phaser-mvvm/phaser` 提供 `PhaserTextMeasurer`，包装真实 `Text` 度量并加 **LRU 缓存**，缓存键为「文本 + 字体 + 字号 + 字距 + 换行宽度 + 行距」。
   - **测试**：等宽假测量器（宽度 = 字符数 × 固定值，高度 = 行数 × 行高），让快照结果**确定且可读**。
4. 依赖约束（与 ADR-0001 一致）：`packages/layout/package.json` 保持 **无任何依赖**；构建产物中不得出现 `phaser` 字样；`packages/layout` 不得声明 `phaser` 为 peer。
5. 该接口是稳定契约：新增测量能力（例如富文本分段）通过扩展接口完成，不允许把 Phaser 类型泄漏进 `layout` 的公开签名。

## 理由与权衡

- **测试速度与稳定性**：等宽假测量器让布局用例完全确定，40+ 布局用例 + 黄金快照可以在 CI 的纯 Node 步骤里跑完（PLAN §7），不需要浏览器。
- **回归定位清晰**：快照失败时，可以确定问题在布局算法本身，而不是字体渲染差异。
- **漂移隔离**：Phaser 4.x 的文本度量 API 变化只影响 `PhaserTextMeasurer` 一个文件（ADR-0007 的同一思路）。
- **代价**：
  - 多一层间接与一次函数调用（在测量缓存命中时开销可忽略）；
  - 「真实渲染宽度」与「测试假测量宽度」不一致，可能出现「快照通过但实际界面换行不同」。我们用两层测试互补：`layout` 跑假测量器快照，`widgets` 跑 Playwright 截图回归（PLAN §7，M4 起）。
  - 控件作者需要自觉：**不能在 `layout` 包内写任何依赖 Phaser 类型的分支**。

## 后果

### 正面

- `layout` 可在 Node 中单测、可在 CI 中无浏览器运行；满足了 §7「快照零漂移」的门禁形态。
- 未来支持其他渲染后端时，只需另写一个 `Measurer` 实现，布局算法零改动。
- `PhaserTextMeasurer` 的 LRU 缓存命中率可被独立统计，对应 §8「度量缓存命中率 > 95%」。

### 负面

- 测量语义需要在两处保持一致（假测量器 vs 真实 `Text`），新增文本特性（字距、行距、`maxLines`）时必须同步更新假测量器，否则测试会失真。
- `TextStyleSpec` 成为布局包与适配层之间的耦合点，需要版本管理：新增字段必须可选，避免破坏兼容。

## 相关

- PLAN.md §3.1「关键架构决策：布局引擎不依赖 Phaser」
- PLAN.md §1.1 目标 G6（可测试）
- PLAN.md §4.2 测量、§4.3 `PhaserTextMeasurer`
- PLAN.md §7 测试与质量策略（`layout` 黄金快照）、§8 文本缓存命中率目标
- ADR-0001（包划分）、ADR-0002（两阶段布局）、ADR-0007（Phaser 4 约束与适配层隔离）

## 现状校正

> 上面的正文写于决策当时，决策本身未变（`layout` 至今零 Phaser 依赖，且没有 `Measurer` 这个接口）。

- `packages/layout/src` 里**没有** `Measurer` / `measureText()` / `TextStyleSpec`。注入点是节点自己的 `LayoutNode.measureContent(constraint)`（`packages/layout/src/types.ts`）：布局包只认尺寸，不认文本。
- 真正带缓存的度量有两处，都在布局包之外：适配层 `packages/phaser/src/measurer.ts` 的 `TextMeasurer`（`measure(request: TextMeasureRequest)`、`PhaserTextMeasurer`、`textMeasureKey`），以及控件层按场景复用的 `packages/widgets/src/text-metrics.ts`（`textMetricsOf()`，`Label` 在 `measureContent()` 里读它）。
- 缓存键（`textMeasureKey`）除「文本 + 字体 + 字号 + 字距 + 换行宽度 + 行距」还包含 `fontStyle` / `color` / `align` / `padding` / `useAdvancedWrap` —— 颜色与内边距同样会改变量出来的盒子。
- 正文提到的 Playwright 截图回归，实际由 `node scripts/visual-check.mjs` 承担（CDP 驱动单个无头 Chrome：几何 + 像素 + 无障碍树断言）；仓库**不引入浏览器测试框架**（`docs/PITFALLS.md` §8.42），交互验收走 Playwright MCP 手工驱动。
