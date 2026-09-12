# 验收记录 · 虚拟化列表（`Repeat` + `#/list`）

- **验收场**：[`#/list`](../../apps/examples/src/scenes/list.ts)（`window.listDemo` 暴露几何、窗口与创建计数）
- **被测实现**：[`packages/widgets/src/Repeat.ts`](../../packages/widgets/src/Repeat.ts)、[`packages/widgets/src/repeat-plan.ts`](../../packages/widgets/src/repeat-plan.ts)（`computeVisibleRange` / `diffKeys` / `planRepeatUpdate`）、`ScrollView` 的视口裁剪与 `InputRouter` 的命中
- **本轮（第 63 轮）**：把这一页从"看起来对"变成**可断言**——新增 `listDemo.created()`（自启动以来构建过多少行）、`offset/scrollTo/scrollRows`、`window/visibleKeys/viewport`、`point/pointMounted`、`counts/churn/state`；并修掉页面自己写错的一句复用说明（见 §4）
- **验收方式**：Playwright MCP（真实鼠标；断言前 `bringToFront()`）+ Node 单测（`packages/widgets/test/repeat.test.ts` 等 220 条 `Repeat`/plan 用例）
- **全仓门禁**：`pnpm -r run test` 1096 passed、`typecheck` 5/5、`prettier --check .`、`docs:check`、`size` 18.2 KB min+gzip、`build:examples`、`visual-check` 5 场景

---

## 1. 被测行为

| #   | 行为         | 判据                                                                                                  |
| --- | ------------ | ----------------------------------------------------------------------------------------------------- |
| L1  | 初始窗口     | 220 行、只挂载 14 行（`p000..p013`）、`maxOffset = 220 × 38 − 408`                                    |
| L2  | 滚动一步一行 | 每滚一行**只构建一行**（`created` 每步 +1），窗口 `first/last` 同步推进、挂载数保持有界               |
| L3  | 大跨度跳转   | 一次跳 20 行：窗口整体换人（`p017..p033`），构建数 = 新进入的行数，不是整表重建                       |
| L4  | 到底         | `offset == maxOffset`、`last` = 最后一行、末行可达                                                    |
| L5  | 键控复用     | **窗口内交换两行**（key 集合不变）→ `created` 不增长，且行顺序按新顺序重排                            |
| L6  | 删除         | 删一行：`total −1`、偏移不变、只补建从下方进入窗口的那一行                                            |
| L7  | 新增         | `+1` 行：`total +1`、窗口向右扩一行                                                                   |
| L8  | 过滤         | 窗口跟着过滤后的集合走（`Player 01` → 10 行，`maxOffset=0`）；无匹配 → 空状态 + 计数归零              |
| L9  | `canExecute` | 列表空时 Clear 按钮自动禁用 → 它**从焦点集合里消失**                                                  |
| L10 | 视口裁剪     | **overscan 行（挂载但在视口外）不可点**：点它不删行（V23 在虚拟化列表上的复测）                       |
| L11 | 焦点         | 点行内按钮后再滚到别处（该行被卸载）：不报错、焦点释放                                                |
| L12 | 泄漏         | `churn(20)`（来回滚 10 个窗口）后 `widgets`/`themeListeners`/`pointerTargets`/`focusables` 全部回基线 |

---

## 2. 实测（第 63 轮）

**L1 初始**：`{ total:220, rendered:14, first:'p000', last:'p013', created:14, offset:0, maxOffset:7948 }`；视口 `@278,164 544x408`。

**L2 一步一行（20 步）**：`created` 的每步增量是 **1,1,1,…,1**（20 步 +20）；窗口随偏移推进（`first` 从 `p000` 到 `p017`、`last` 从 `p014` 到 `p033`）；`rendered` 15→17 后稳定。**这是虚拟化的核心断言**：滚动不会重建。

**L3 大跨度跳转**：一次 `scrollRows(20)` → `{ rendered:17, first:'p017', last:'p033', created:31 }`；随后的 `pointerTargets` 28、`focusables` 22。

**L4 到底**：`{ offset:7948, maxOffset:7948, first:'p206', last:'p219', rendered:14 }`。

**L5 键控复用（窗口内交换）**：`swapVisible(1, 2)` → `created` 增量 **0**，`rendered` 仍 17，顺序变成 `p017,p018,p019,p020,p022,p021,…`（交换生效且无重建）。

**L6 删除 / L7 新增**：点可见行 `p022` 的删除 → `{ total:219, created:+1, offset:760 }`；`add()` → `{ total:220, last:'p034', created:+1 }`。

**L8 过滤**：`filter('Player 01')` → `{ total:10, rendered:10, first:'p010', last:'p019', maxOffset:0 }`，渲染键正好是 10 个匹配项；`filter('zzz')` → `{ total:0, rendered:0, widget 计数 89→33 }`。

**L9**：空列表时 `focusables = ['add','shuffle','filter','list.scroll']` —— Clear **不在集合里**（`bindCommand` 的 `canExecute` 路径把它禁用了），列表回来后又出现。

**L10 视口裁剪**：视口 `y 164..572`；挂载的 `p017..p019` 在视口上方、`p031..p033` 在下方（overscan）。点 `p017` 的删除按钮（`@647,67`）→ `deleted` 不变；点视口内的 `p022`（`@647,257`）→ 删除成功。`listDemo.point(key)` 现在只在行**位于视口内**时返回坐标（`pointMounted()` 才是原始位置），避免"瞄准了 overscan 行"这类假缺陷。

**L11**：点某可见行的按钮 → 再 `scrollTo(0)` → 无错误、`focus=none`、计数与窗口正常。

**L12 泄漏**：

```
churn(20) before { widgets: 89, themeListeners: 92, pointerTargets: 25, focusables: 19 }
          after  { widgets: 89, themeListeners: 92, pointerTargets: 25, focusables: 19 }
```

> 采样注意：`pointerTargets` 由插件在结构变化后的**下一帧**重收集，而 `churn()` 是同步返回的——所以 `churn()` 末尾显式调一次 `refreshInteraction()`，把读数钉在收敛后的值上（不然会读到 19 这种中间态）。

---

## 3. 本轮修掉的运行时缺陷

**V27 · 被卸载的池化填充块留在场景显示列表上。** 在 `#/list` 上量"窗口滚动后计数是否回基线"时，`displayList` 从 **1 变成 2**、`themeListeners` 从 91 变成 92，且不再回落。定位办法是列出"场景显示列表里但不在 UI 根子树里"的对象：唯一一个是 `Widget "repeat.leading"`（544×642）——`Repeat` 为了复用而**只脱离不销毁**的填充块。根因是 Phaser 的 `Container#removeHandler`：对 `exclusive` 容器（默认）它会把子节点**交回场景显示列表**（`gameObject.addToDisplayList()`）。空 Container 不画东西，所以这不是可见缺陷，但它是一个留在渲染管线里的游离节点 + 一条永久的主题订阅，也会让"计数回基线"的门禁长期偏移。

修法：`Repeat.orderChildren()` 在脱离"要保留"的子节点后调用 `removeFromDisplayList()`（重新挂载时 Phaser 自己会再摘下来）。修复后实测：滚到 760 再回 0、滚到底再回 0、`churn(20)` 之后，`displayList` **恒为 1**、游离节点为空。

> 还剩下的"预期偏移"：池化的 filler 本身仍然活着（`themeListeners` 稳定在 **92** 而不是初始的 91）。这是 `Repeat` 有意为之的复用池，不是泄漏——判据是 **`churn` 前后一致**，而不是"必须等于第一帧"。

---

## 4. 未覆盖 / 有意不做

- **5000 行 / 帧率**：PLAN M7 的 "5000 项稳定 60 fps" 需要真实帧率测量；本轮只断言挂载数与构建数（`#/lifecycle` 与 `visual-check` 覆盖泄漏与几何）。用 Playwright MCP 测帧率必须 `bringToFront()`，否则 rAF 被节流（见 `ACCEPTANCE-touch.md` §4）。
- **`Repeat` 的 `update` 回调路径**（`repeateOptions.update` 原地更新而不重建）：`#/list` 没有用它，只有 Node 单测覆盖。
- **重复 key 的降级**：`planRepeatUpdate.duplicates` 只由 Node 单测覆盖。
- **触摸滚动这个列表**：本轮用鼠标；虚拟化 + 触摸拖动在 `#/pages` 已验收（`ACCEPTANCE-touch.md` §3.7）。
- **`focusables` 的逐帧发布**：`#/list` 目前只有 `listDemo.focusables()`（按需），没有逐帧 `st.*`/`focusables` 行——需要时再补。

---

## 5. 本轮修掉的文档型缺陷

**V26 · `#/list` 把键控复用的适用条件写错了。** 页面头部与侧栏都写着「Shuffle keeps every mounted row (keyed reuse)」，实测一次 `shuffle()` 会**构建 15 行**（窗口里 17 行）。原因不是 `Repeat` 有毛病：shuffle 重排的是**整个数据源**，于是索引窗口里换成了**另一批 key**，这些行当然必须新建——这正是虚拟化的正确行为。真正的键控复用出现在"窗口内 key 集合不变、只是顺序变了"的时候（`swapVisible()`：`created` 增量 0）。所以本轮改的是**说明文字**，并把两种情形都变成可断言的数字（`created`），另加 `swapVisible()` 作为复用的正面用例。

同类教训（供以后写 demo 参考）：一句"看起来更快"的注释如果没法测量，就不该写成结论；`created()` 这类计数器是把宣传变成断言的最省事的办法。
