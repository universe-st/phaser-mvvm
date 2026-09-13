# 验收记录 · 虚拟化列表（`Repeat` + `#/list`）

- **验收场**：[`#/list`](../../apps/examples/src/scenes/list.ts)（`window.listDemo` 暴露几何、窗口与创建计数）
- **被测实现**：[`packages/widgets/src/Repeat.ts`](../../packages/widgets/src/Repeat.ts)、[`packages/widgets/src/repeat-plan.ts`](../../packages/widgets/src/repeat-plan.ts)（`computeVisibleRange` / `diffKeys` / `planRepeatUpdate`）、`ScrollView` 的视口裁剪与 `InputRouter` 的命中
- **本轮（第 63 轮）**：把这一页从"看起来对"变成**可断言**——新增 `listDemo.created()`（自启动以来构建过多少行）、`offset/scrollTo/scrollRows`、`window/visibleKeys/viewport`、`point/pointMounted`、`counts/churn/state`；并修掉页面自己写错的一句复用说明（见 §4）
- **验收方式**：Playwright MCP（真实鼠标；断言前 `bringToFront()`）+ Node 单测（`packages/widgets/test/repeat.test.ts` **54** 条 + `scroll-plan.test.ts` **49** 条；本记录里"220 条"是当时那一批的旧口径）
- **全仓门禁**：`pnpm -r run test` 1096 passed、`typecheck` 5/5、`prettier --check .`、`docs:check`、`size` 18.2 KB min+gzip、`build:examples`、`visual-check` 5 场景

---

## 1. 被测行为

| #   | 行为         | 判据                                                                                                                                             |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | 初始窗口     | 220 行、只挂载 14 行（`p000..p013`）、`maxOffset = 220 × 38 − 4 − 408 = 7948`（`itemExtent` 含行距，`contentExtentOf()` 要减去最后一行的 `gap`） |
| L2  | 滚动一步一行 | 每滚一行**只构建一行**（`created` 每步 +1），窗口 `first/last` 同步推进、挂载数保持有界                                                          |
| L3  | 大跨度跳转   | 一次跳 20 行：窗口整体换人（`p017..p033`），构建数 = 新进入的行数，不是整表重建                                                                  |
| L4  | 到底         | `offset == maxOffset`、`last` = 最后一行、末行可达                                                                                               |
| L5  | 键控复用     | **窗口内交换两行**（key 集合不变）→ `created` 不增长，且行顺序按新顺序重排                                                                       |
| L6  | 删除         | 删一行：`total −1`、偏移不变、只补建从下方进入窗口的那一行                                                                                       |
| L7  | 新增         | `+1` 行：`total +1`、窗口向右扩一行                                                                                                              |
| L8  | 过滤         | 窗口跟着过滤后的集合走（`Player 01` → 10 行，`maxOffset=0`）；无匹配 → 空状态 + 计数归零                                                         |
| L9  | `canExecute` | 列表空时 Clear 按钮自动禁用 → 它**从焦点集合里消失**                                                                                             |
| L10 | 视口裁剪     | **overscan 行（挂载但在视口外）不可点**：点它不删行（V23 在虚拟化列表上的复测）                                                                  |
| L11 | 焦点         | 点行内按钮后再滚到别处（该行被卸载）：不报错、焦点释放                                                                                           |
| L12 | 泄漏         | `churn(20)`（来回滚 10 个窗口）后 `widgets`/`themeListeners`/`pointerTargets`/`focusables` 全部回基线                                            |

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

> 采样注意①：`pointerTargets` 由插件在结构变化后的**下一帧**重收集，而 `churn()` 是同步返回的——所以 `churn()` 末尾显式调一次 `refreshInteraction()`，把读数钉在收敛后的值上（不然会读到 19 这种中间态）。
>
> 采样注意②（第 82 轮补）：`churn()` 在取 `before` 之前先做一次**热身滚动**（滚到第 6 行再回 0）。页面**第一次**滚动会做一次性工作——窗口越过被钳掉的 leading overscan、滚动条出现——实测 `themeListeners` 会在那一步从 91 走到 92（就是上面那条「预期偏移」）。不热身的话，在一个**还没滚过的**页面上取 `before`，快照之间就跨过了这个台阶，读数看起来像 +1 泄漏（第 82 轮的 21 场景走查正好撞到：同一轮里有时报平、有时报 +1）。热身之后连跑 4 次（含「加载后 180 ms 就量」）都是 92 → 92 恒定。

---

## 3. 本轮修掉的运行时缺陷

**V27 · 被卸载的池化填充块留在场景显示列表上。** 在 `#/list` 上量"窗口滚动后计数是否回基线"时，`displayList` 从 **1 变成 2**、`themeListeners` 从 91 变成 92，且不再回落。定位办法是列出"场景显示列表里但不在 UI 根子树里"的对象：唯一一个是 `Widget "repeat.leading"`（544×642）——`Repeat` 为了复用而**只脱离不销毁**的填充块。根因是 Phaser 的 `Container#removeHandler`：对 `exclusive` 容器（默认）它会把子节点**交回场景显示列表**（`gameObject.addToDisplayList()`）。空 Container 不画东西，所以这不是可见缺陷，但它是一个留在渲染管线里的游离节点 + 一条永久的主题订阅，也会让"计数回基线"的门禁长期偏移。

修法：`Repeat.orderChildren()` 在脱离"要保留"的子节点后调用 `removeFromDisplayList()`（重新挂载时 Phaser 自己会再摘下来）。修复后实测：滚到 760 再回 0、滚到底再回 0、`churn(20)` 之后，`displayList` **恒为 1**、游离节点为空。

> 还剩下的"预期偏移"：池化的 filler 本身仍然活着（`themeListeners` 稳定在 **92** 而不是初始的 91）。这是 `Repeat` 有意为之的复用池，不是泄漏——判据是 **`churn` 前后一致**，而不是"必须等于第一帧"。

---

## 4. 未覆盖 / 有意不做

- **5000 行 / 帧率**：PLAN M7 的 "5000 项稳定 60 fps" 需要真实帧率测量；本轮只断言挂载数与构建数（`#/lifecycle` 与 `visual-check` 覆盖泄漏与几何）。用 Playwright MCP 测帧率必须 `bringToFront()`，否则 rAF 被节流（见 `ACCEPTANCE-touch.md` §4）。
- **`Repeat` 的 `update` 回调路径**（`RepeatOptions.update` 原地更新而不重建）：`#/list` 没有用它——**第 87 轮起 `#/options` 有它的 A/B 卡**（`update:` + `upd.calls`/`upd.builds` 读数，见 [`ACCEPTANCE-options.md`](./ACCEPTANCE-options.md) §7.1），Node 单测另有覆盖。
- **重复 key 的降级**：`planRepeatUpdate.duplicates` 只由 Node 单测覆盖。
- ~~**触摸滚动这个列表**~~：第 77 轮已补（§6 有真实触摸拖动的帧预算数字）。
- **`focusables` 的逐帧发布**：`#/list` 目前只有 `listDemo.focusables()`（按需），没有逐帧 `st.*`/`focusables` 行——需要时再补。

---

## 5. 本轮修掉的文档型缺陷

**V26 · `#/list` 把键控复用的适用条件写错了。** 页面头部与侧栏都写着「Shuffle keeps every mounted row (keyed reuse)」，实测一次 `shuffle()` 会**构建 15 行**（窗口里 17 行）。原因不是 `Repeat` 有毛病：shuffle 重排的是**整个数据源**，于是索引窗口里换成了**另一批 key**，这些行当然必须新建——这正是虚拟化的正确行为。真正的键控复用出现在"窗口内 key 集合不变、只是顺序变了"的时候（`swapVisible()`：`created` 增量 0）。所以本轮改的是**说明文字**，并把两种情形都变成可断言的数字（`created`），另加 `swapVisible()` 作为复用的正面用例。

同类教训（供以后写 demo 参考）：一句"看起来更快"的注释如果没法测量，就不该写成结论；`created()` 这类计数器是把宣传变成断言的最省事的办法。

---

## 6. 5000 行 60 fps（PLAN §M7 的验收标准，第 77 轮实测）

PLAN 的 M7 行写着「滚动 + 虚拟化在 5000 项下稳定 60 fps」，而 `#/list` 一直是 220 行——这条标准此前**从没被量过**。第 77 轮补上：演示页新增 `listDemo.setTotal(n)`（把数据源换成 n 行）与 `listDemo.perf({ frames, step })`。

**怎么量的**：`perf()` 在页面里用 `requestAnimationFrame` 驱动——每一帧把滚动位置推进一行（或指定行数），因此采样到的是**帧间隔**，也就是框架自己的开销（布局 + 虚拟化 + 渲染），而不是 CDP 派发输入的速度。（一个 `while` 循环里调 `performance.now()` 只会量出 `scrollTo()` 返回得多快，那不是这个问题。）测量前先 `bringToFront()`（否则 rAF 被节流到 1 fps，见 AGENTS §8）。

| 场景（5000 项，1280×720，无头 Chrome）        | 帧数 | median  | p95  | max  | fps      | 本轮新建行数        |
| --------------------------------------------- | ---- | ------- | ---- | ---- | -------- | ------------------- |
| 脚本驱动，1 行/帧                             | 180  | 16.7 ms | 17.8 | 18.6 | **59.9** | 181（正好 1 行/帧） |
| 脚本驱动，4 行/帧（快速甩动）                 | 180  | 16.7    | 18.0 | 18.6 | **59.9** | 724                 |
| **真实滚轮**输入（每 3 帧 3 个 wheel tick）   | 180  | 16.7    | 18.2 | 18.8 | 59.9     | —                   |
| **真实触摸拖动**（40 次 touchMove，25 ms/次） | 200  | 16.7    | 18.3 | 18.6 | **59.9** | 219                 |

对照与旁证：

- **220 行**的同一测量也是 median 16.7 / max 18.3 —— 帧预算与**项目数无关**，17 行常驻（窗口顶部 14 行，因为前导 overscan 被夹掉）。
- 布局计数器（1 行/帧那次）：`layoutPasses=180`（每帧正好一趟）、`measureCalls=6416`（≈36/帧：挂载的 17 行 + 被内容高度变化弄脏的祖先链，**不是 5000 行**）、`cacheHits=16591`；4 行/帧时 `measureCalls=10655`（≈59/帧，多出来的 23 次与新建的 543 行同阶，约 7.8 次/行）。按 PLAN §8 的预算（1000 节点全量测量 0.06 ms）算，即便页面再大十倍，这也不是帧预算里的量级——所以 5000 项与 220 项的帧时间实测完全相同。
- `Repeat.created()` 的增长证明滚动真的在换窗口（1 行/帧 → +181；4 行/帧 → +724），而不是"什么都没做所以很快"。
- 触摸那次如果按 **CDP 突发**（40 个 touchMove 背靠背派发）max 会到 33.8 ms；改成真实手指速度（25 ms/次）后 max 降到 18.6 ms —— 那个尖峰来自压测方式，不是框架。

**同轮修掉的门禁缺陷（V45）**：`churn(n)` 的 `before` 快照原来取自"页面当前所在的偏移"、`after` 取自上滚回顶部的状态，而挂载行数取决于偏移（顶部 14 行、中间 17 行）——先跑 `perf()` 再跑门禁就会看到 `102 → 89`，像漏了 13 个控件。现在 `churn()` 先把偏移归零再取快照，冷启动 / 5000 行 `perf()` 之后（offset 2318）/ 滚到 45600 之后再调，三者都是 `before == after` 的 `{widgets: 89, themeListeners: 92, pointerTargets: 25, focusables: 19}`。顺带复核：一行一行地滚时 `created` 每步**正好 +1**（44→45→46→47→48→49），5000 行跑完后再跑泄漏门禁仍然全平。

**这条标准的可复现方式**：`#/list` → `window.listDemo.setTotal(5000)` → `await window.listDemo.perf({ frames: 180 })`（返回 `{frames, median, p95, max, fps, created, rendered, measureCalls, arrangeCalls, layoutPasses, cacheHits}`）。

**Node 侧钉住"为什么"**：`packages/widgets/test/repeat.test.ts` 新增两条用例——窗口行数在 220 / 5000 / 1 000 000 项下**完全相同**（顶部 14、中间 17），以及 5000 行（190 000 px）时填充块高度与闭合式 `count × itemExtent − gap` 逐像素相等、三段相加回到内容总高。墙钟数字会随机器变，这三条不变式不会。

**未做**：**物理设备**上的帧率与 `Scale.FIT`（画布被缩放）下的帧率 —— Android 模拟器上虚拟化本身已验（第 112 轮 A3：拖动后 `created 14 → 25`、挂载行 14 → 17 / 共 220 行），但软件渲染的模拟器量不出可信吞吐（见 [`ACCEPTANCE-android.md`](./ACCEPTANCE-android.md) §5）；GPU 是软件渲染的无头 Chrome，所以这里量的是"框架跟得上显示器"，不是绝对吞吐。
