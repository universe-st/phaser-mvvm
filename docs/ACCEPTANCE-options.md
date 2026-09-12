# 验收记录 · 选项审计：拼错的选项不再悄悄消失（第 83 轮）

> 背景：控件的选项是一个**扁平对象**（节点级 `LayoutParams` + 控件自己的键），构造时由 `splitOptions()` / `splitWidgetOptions()` 拆开，落在 `layout` 那个篮子里的未知键**被 `normalizeParams()` 忽略**。这个设计本身是对的（同一个对象能交给任何容器），但代价全由使用者承担：`Panel({ pading: 20 })` 什么都不报、什么都不做，控件看上去"就是不听话"。本轮实测确认了这个代价的形态 —— 把 `#/keyboard` 面板的 `padding: 20` 写成 `pading: 20`，页面照常渲染，只是面板从 **520×150 变成 560×150**（少了内边距）：没有任何报错、日志或警告，只能靠肉眼比对几何。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，`node scripts/visual-check.mjs`（CDP 无头 Chrome + `vite preview`）。

---

## 1. 交付物

| 产物                                                      | 说明                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/layout/src/params.ts` → `LAYOUT_PARAM_KEYS`     | `LayoutParams` 的运行时键表（`readonly (keyof LayoutParams)[]`，写错键名编译不过）。审计需要把"我不读的布局键"与"谁也读不到的键"分开，只能把名单写下来                                 |
| `packages/phaser/src/option-keys.ts`（纯逻辑，零 Phaser） | `unknownOptionKeys(bag, known)`、`suggestOptionKey(key, known)`（大小写 / 包含 / 编辑距离 ≤2，并列时**不给建议**）、`reportUnknownOptions()`；导出三个函数与 `BASE_WIDGET_OPTION_KEYS` |
| `packages/phaser/src/LayoutWidget.ts` → `splitOptions()`  | 唯一的选项漏斗：容器直接用，叶子控件经 `splitWidgetOptions()` 进来 —— 在这里做审计，**所有**控件与容器一次性覆盖，DSL 也一样（DSL 交的是同一个扁平对象）                               |
| `packages/phaser/test/option-keys.test.ts`                | 12 个 Node 单测：已知键不误报、拼错必报、`undefined` 跳过、排序去重、布局键表自洽（无重复）、大小写/换位/少字母的建议、并列时沉默、短键阈值更严                                        |
| `#/compose` 的 `window.compose.typo(key, value, kind)`    | 验收仪器：在一个隔离作用域里造一个带错键的 `Panel`/`TextField`/`Button`，返回捕获到的警告。既证明整条链路（DSL → 扁平包 → `splitOptions` → `warn()`），也是"门禁不是死的"阳性对照      |
| `scripts/visual-check.mjs`                                | 常驻门禁两条：① 每个场景（`Runtime.consoleAPICalled`）出现任何 `unknown option` 警告即失败；② `#/compose` 必须**真的**报出 `pading` → `padding`（阳性对照），否则失败                  |

## 2. 开发模式：指名 + 建议（实测输出）

| 输入（`window.compose.typo(...)`）                                                                 | 实测警告                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `('pading', 20)`（Panel）                                                                          | `unknown option "pading" — it is ignored. Did you mean "padding"?`                     |
| `('vairant', 'plain')`（Panel）                                                                    | `unknown option "vairant" — it is ignored. Did you mean "variant"?`                    |
| `('maxlength', 8, 'field')`                                                                        | `unknown option "maxlength" on "typoProbe" — it is ignored. Did you mean "maxLength"?` |
| `('placeholdr', 'x', 'field')`                                                                     | `… Did you mean "placeholder"?`                                                        |
| `('onClik', () => {}, 'button')`                                                                   | `unknown option "onClik" on "typoProbe" — it is ignored. Did you mean "onClick"?`      |
| `('zzz', 1, 'field')`                                                                              | `unknown option "zzz" on "typoProbe" — it is ignored.`（离得太远，不给建议）           |
| `('padding', 20)` / `('maxLength', 8, 'field')` / `('onClick', …, 'button')` / `('focusOrder', 2)` | **无输出**（合法键绝不误报）                                                           |

带 `name` 的控件会报出名字（`on "kb.page"` —— 实测：把 `#/keyboard` 面板的 padding 写错时，浏览器控制台是 `unknown option "pading" on "kb.page" — it is ignored. Did you mean "padding"?`）。同一条消息只报一次（`warn()` 自带去重），所以一个循环里造 500 行、行行拼错也不会刷屏。

**发布模式零输出**：`window.mvvmDev.setDevMode(false)` 之后再调 `typo('pading')` 返回空数组 —— 与既有的调试日志纪律一致（`ACCEPTANCE-devtrace.md`）。

## 3. 完整性：全示例零误报（这才是审计的价值）

阳性对照只证明"能报"，**零误报**才证明键表是完整的 —— 少写一个合法键，用它的人就会看到假警告。验收方式是走遍整个示例应用：

| 走查                                                                    | 结果                             |
| ----------------------------------------------------------------------- | -------------------------------- |
| 21 个场景逐个加载（`m0`…`keyboard`）                                    | `unknown option` 警告 **0** 条   |
| `#/showcase` 的 `showAll()`（每个控件、每组布局参数，175 个被跟踪控件） | **0** 条                         |
| `#/compose` 的全部 DSL 分区逐个切换                                     | **0** 条                         |
| `node scripts/visual-check.mjs`（8 个场景，含像素与 AX 断言）           | 全绿，且新门禁没有报出任何未知键 |

> 这条走查同时是 `LAYOUT_PARAM_KEYS` 的完整性门禁：漏写一个布局键（比如 `gridColumnSpan`），用到它的示例页立刻会报假警告，走查当场变红。

## 4. 门禁有效性：它真的会失败

```
$ python3 - <<'PY'   # 临时把 #/uiscene 的 padding: 16 改成 pading: 16
$ node scripts/visual-check.mjs
[visual-check] uiscene: 1 unknown-option warning(s): unknown option "pading" — it is ignored. Did you mean "padding"?
[visual-check] 1 check(s) failed
```

改动已还原，随后重跑为 `[visual-check] ok`。**没有这一段，"零警告"就只是一个恒真的断言**（第 77 轮的 V45/V46 家族教训：门禁必须能证明自己活着）。

## 5. 命令与结果

| 命令                                               | 结果                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm -r run typecheck`                            | 5/5 包通过（`LAYOUT_PARAM_KEYS` 是 `keyof LayoutParams`，写错即编译失败）                           |
| `pnpm -r run test`                                 | **1273** 用例（layout 313 / core 281 / phaser 320 / widgets 359），新增 `option-keys.test.ts` 12 条 |
| `pnpm exec prettier --check .` / `pnpm docs:check` | 通过                                                                                                |
| `pnpm run build:examples` / `pnpm size`            | 通过；体积仍在预算内                                                                                |
| `node scripts/visual-check.mjs`                    | ok（像素明暗两套 + AX 树 + 新增的选项审计两条）                                                     |
| 21 场景走查 + `showAll()` + 全 DSL 分区            | 零未知键警告                                                                                        |

## 6. 未验证与已知边界（诚实清单）

- **只检查"键名"，不检查"取值"**：`padding: 'abc'`、`grow: '2'` 这类错值仍然静默走 `normalizeParams` 的兜底（本轮不动它；取值校验会让热路径变重，且数值兜底本身有单测）。
- **不检查"这个控件收不收这个键"**：`Text('x', { variant: 'primary' })` 里 `variant` 是**别处**的合法键（Panel/Button 有），所以不会被报出来 —— 审计的判据是"全局不认识"，不是"这个控件不认识"。要更严需要每个控件声明自己的键集并与全局键表求差，成本更高，留待需要时再做。
- **不改运行时行为**：拼错的键仍然被忽略（只是现在会说出来），因此**发布模式下的表现与第 82 轮完全一致**。
- **`as` 断言的对象仍然后知后觉**：审计只看构造时收到的那个包，`.filter()`/展开之后丢了键的写法它管不了。
- `#/compose` 的 `typo()` 仪器会临时注册 `onDevWarning` 并随即注销（否则 `warn()` 会把消息交给处理器而不再落 `console.warn`，整个示例页的警告就都看不见了）；验收脚本因此用 CDP 的 `Runtime.consoleAPICalled` 收集，而不是在页内挂钩子。

---

## 7. 选项覆盖：`#/options`（第 87 轮）

§1 的审计检查的是「**拼错**的选项」，第 87 轮把同一份键表反过来用：把 `packages/widgets` 里每个 `*_KEYS` 与示例应用对照，找出**只出现在控件源码里**的选项 —— 也就是从来没有任何 demo 走过的路径。候选是 `Repeat.update`、`ScrollView.inertia`/`wheelSpeed`、`TextArea.submitOnEnter`、`Grid.autoFlow`/`minRowHeight`、`Box.alignContent`、`Slider.knobRadius`/`trackThickness`。

它们**按代码看都没坏** —— 而 `bounce` 当年按代码看也没坏，第 86 轮一加 demo 就发现它从未生效（V55）。所以本轮新建 `#/options`，一卡一族、尽量做成 **A/B**（开了这个选项的一侧 vs 没开的一侧），读数进 `#demo-state`、几何进 `window.optionsDemo.rects()`。

### 7.1 `Repeat.update`（原地刷新 vs 销毁重建）

两个列表、同样的三个 key；「换数据」把每一项换成**同 key 的新对象**。`Repeat` 用 `Object.is` 比对象身份，所以这是与"同一项"可区分的一类变化。

| 观测点                       | with `update`                  | without `update`           |
| ---------------------------- | ------------------------------ | -------------------------- |
| 第一次换数据后 `update` 调用 | **3**                          | 0（选项没给）              |
| 模板构建次数（初始 3）       | **3**（没有重建 ✓）            | **6**（三项全部重建 ✓）    |
| 第二次换数据后               | `updCalls` 6、构建数仍 **3**   | 构建数 **9**               |
| 行上**画出来的文字**         | `A 1 → A1 1 → A2 1` ✓ 原地刷新 | `B 1 → B1 1 → B2 1` ✓ 重建 |

「画出来的文字」是这一条的关键：两个列表的**数据源**都变了，只有读行控件的文本才能区分"原地刷新"与"重建"（`state().updatedPainted`/`plainPainted` 就是这么读的）。这条同时关掉了 `DEFECT-BACKLOG.md` §3.6 里登记了很久的「`Repeat` 的 `options.update` 路径没有 demo」。

### 7.2 `TextArea.submitOnEnter`

| 输入（真实键盘）    | `submitOnEnter: true`        | 默认                     |
| ------------------- | ---------------------------- | ------------------------ |
| 输入 `ab` + `Enter` | 提交 **1** 次、换行 **0** 个 | 换行 **1** 个、提交 0 次 |
| 再按 `Ctrl+Enter`   | —                            | 提交 **1** 次            |

### 7.3 `inertia` / `wheelSpeed`

| 观测点                | 默认口（`inertia: true`） | `inertia: false`   |
| --------------------- | ------------------------- | ------------------ |
| 拖动中 `dragVelocity` | `{0, 0.901}` px/ms        | `{0, 0.917}` px/ms |
| 松手瞬间 `coasting`   | **`true`**                | **`false`**        |
| 松手 120 ms 后偏移    | 50 → **116**（滑到尽头）  | 50（纹丝不动）     |
| 720 ms 后             | 116                       | 50                 |

`wheelSpeed`（滚轮一格的距离倍率，同一个口一次 1 单位的滚轮）：默认口 **+2**、`wheelSpeed: 2` 口 **+4**；一次 3 单位：**+6** vs **+12**（比值精确为 2 ✓）。

> 第一次量 `wheelSpeed` 时两个口都读到 116 —— 那是**我的测量饱和**（100 单位的滚轮一次性推到底，两个口都撞上 `maxOffset = 116`），不是缺陷。改成小步长后才看出真实比值。记在这里因为它是"读数像缺陷、其实是探针问题"的典型。

### 7.4 布局参数（几何断言，不是看截图）

| 断言                                           | 实测                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `autoFlow: 'column'`                           | 四个 30px 高的 tile：`tile0/tile1` 同列（x=26，y=428/524）、`tile2/tile3` 在第二列（x=179）       |
| `minRowHeight: 90` + `rows: 2`                 | 行距 **96** = 90 + `rowGap` 6，tile 被拉高到 **90**                                               |
| `minRowHeight: 140` + `rows: 2`                | 行距 **146** = 140 + 6，tile 高 **140**                                                           |
| `Row({ wrap, alignContent: 'space-between' })` | 6 个 chip 折成 3 行（y 404/449/494），行距 15 = (120 − 3×30) / 2 ✓，最后一行底边 524 = 容器底边 ✓ |

`minRowHeight` 那一对是 A/B 的意义所在：它**只在 `rows` 固定时生效**（[指南 02](../guide/02-layout.md) §grid 已写明），所以只写 `minRowHeight` 而不写 `rows` 的 demo 什么也证明不了 —— 第一版就是这样，量到的行距是子节点自己的高度。

### 7.5 本轮顺带修掉的缺陷（V56）

给 `inertia` 做 A/B 时发现：**`Scroll({ offset })` 的槽位会掐掉拖拽动量与惯性**。槽位把每一次 `scroll` 事件写进 `ref`，绑定下一帧再把同一个值写回控件 —— 而 `setScrollOffset()` 会先 `stopScroll()`（第 85 轮 V54 的修法），于是 `dragVelocity`/`coasting` 每帧被清零：实测拖动中 `velocity` 恒为 `{0,0}`、松手后 `coasting` 永远是 `false`，两个口都**不会滑行**（`#/options` 的两个口都带槽位，而 `#/scroll` 不带槽位的口照常滑行 —— 这就是定位它的关键对照）。

修法：`setScrollOffset()` 在目标位置**与当前一致**时直接返回（"别动"不是一个请求），只有真的要求换位置才 `stopScroll()`。修后同一 A/B：默认口拖动中 `velocity {0, 0.901}`、松手 `coasting: true`、120 ms 后 50 → 116；`inertia: false` 口同样拖法 `coasting: false`、720 ms 后仍是 50。

### 7.6 审计抓到的一次自造错误（V57）

新页面上线第一次跑 `visual-check` 就红了：

```
[visual-check] options: 2 unknown-option warning(s): unknown option "onSubmit" on "options.submitArea" — it is ignored. | unknown option "onSubmit" on "options.defaultArea" ...
```

而同一个 `onSubmit` **确实被调用了**（§7.2 的 `enterSubmits` 0 → 1）。原因是 `TextField`/`TextArea` 从**原始选项对象**读 `onChange`/`onSubmit`/`onFocus`/`onBlur`，但 `TEXT_INPUT_KEYS` 里没有这四个键 —— 它们被 `splitOptions()` 归进布局参数，于是审计把它们当成拼错的键。把四个回调补进键表后页面转绿。详见 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.29。

### 7.7 仍是代码级、没有 demo 的选项

`Slider.knobRadius` / `trackThickness`（纯外观，验证需要像素采样）与 `Label.selectable`（只作为类型层面的"接受 `false`"，没有运行期行为）。前者留待需要像素门禁时补；后者不是行为选项。

---

## 8. `ScrollView.direction: 'both'`（第 90 轮）——本页第一次抓到**功能级**缺陷

### 8.1 为什么加这一张卡

第 89 轮把 `text-*` 键表反查过一遍之后，这一轮改成反查**选项的取值**：`direction: 'both'` 这个取值从 M7 起就存在、有完整的 x 轴实现（`limitX`/`maxOffsetX`/`setScrollOffset({x,y})`/`revealOffset` 的 x 分支/两条滚动条），但**没有任何页面构造过它**。于是"交叉轴"整条路径只有代码、没有屏幕。

`#/options` 新增一卡（A/B）：两个 **内容完全相同**（700×420）、视口完全相同（300×170）的口并排，左边 `direction: 'vertical'` 作对照，右边 `direction: 'both'` 并挂一个 `offset` 槽位；两边内容里各有一对角落按钮（`options.both.nw` / `options.both.se`），供"聚焦要把它滚进视野"用。

新探针：`bothInfo()`（两轴偏移、两个上限、内容/视口尺寸、`direction`、槽位读数、拖拽归属）、`setBoth(x, y)`、`setControl(y)`、`pointOf(name)`、`focus(name)`、`watchScroll(name)`/`scrollEvents(name)`、`prepare()`（异步：把卡滚进可见带 + 把两个口的 rect 写进 `#status`）；`#demo-state` 逐帧发布 `both.x`/`both.y`/`both.maxX`/`both.maxY`/`both.slot`/`both.controlY`。

### 8.2 实测矩阵（全部真实输入 / 真实页面）

| #   | 操作                                    | 期望                                          | 实测                                                                                                                                      |
| --- | --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 读上限                                  | `maxX = 内容宽 − 视口宽`、`maxY` 同理         | `400 / 250`（700−300、420−170）✓                                                                                                          |
| 2   | 合成 `WheelEvent{deltaY:100}`           | y +100，x 不动                                | `y 100`、`x 0` ✓（且 `slotY 100`，槽位读到同一个值）                                                                                      |
| 3   | 合成 `WheelEvent{deltaX:100}`           | x +100，y 不动                                | `x 100`、`y 0` ✓                                                                                                                          |
| 4   | 合成 `WheelEvent{deltaX:40, deltaY:70}` | 两轴各走各的                                  | `x 40 / y 70` ✓                                                                                                                           |
| 5   | `deltaMode: 1`（行）/`2`（页）          | 乘 `LINE_HEIGHT` / `LINE_HEIGHT × PAGE_LINES` | 3 行 → +48、1 页 → +48 ✓                                                                                                                  |
| 6   | 沿 x 与 y 反复滚到两端                  | 各自钳在 [0, 上限]                            | `400/250`，反向回到 `0/0` ✓                                                                                                               |
| 7   | 一次 `scroll` 事件 = 一次偏移变化       | 每步 1 个事件                                 | 单次滚轮 `events` 0 → 1 ✓（V53 的单写入口纪律）                                                                                           |
| 8   | 斜向拖动 8 步                           | 两轴同时移动，松手后滑行                      | 拖动中 `x 96 y 64 dragging true` → 松手 `x 152 y 101 dragging false`、`dragPointer null` ✓                                                |
| 9   | 只移动 x 后连等 30 帧                   | 槽位每帧写回 y，**不能**碰 x                  | `x 200 y 0` 稳定 ✓（V56 的纪律在交叉轴上成立）                                                                                            |
| 10  | 聚焦右下角按钮                          | 两轴都要把它滚进视野                          | 之前 `se=(990,432)` 在视口 (336,100,300,170) 之外 → 聚焦后 `offset x 400 y 198`、`se=(590,234)` 落在视口内 ✓ **交叉轴的 reveal 真的存在** |
| 11  | 切主题（切两次）                        | 偏移与槽位不变                                | `x 150 y 120` 前后一致 ✓                                                                                                                  |
| 12  | 两条滚动条                              | 两口都画：双轴口有下边与右边，单轴口只有右边  | 见 §8.4 的像素 A/B ✓                                                                                                                      |

### 8.3 本轮修掉的缺陷（V60，MED）：双轴口的左右键走进了 y 轴

`applyScrollStep()` 决定轴的方式是「看 `direction`」：

```ts
} else if (this.direction === 'horizontal') {
  this.scrollBy(step.delta, 0);
} else {
  this.scrollBy(0, step.delta);   // ← 'both' 落到这里
}
```

于是 `direction: 'both'` 的口**四个方向键全部作用于 y**：聚焦口本身后连按 `ArrowRight`，实测 `y 0 → 40 → 80 → 120`，`x` 始终 0（焦点在手柄/键盘用户手里时，横向的意图完全丢失）。修法：`ScrollKeyStep` 增加 `axis` 字段（`ArrowLeft`/`ArrowRight` → `'x'`，其余 → `'y'`），判定抽成纯函数 `keyScrollAxis(direction, key)`（单轴口仍然"覆盖"按键：横向条用 `PageUp`/`PageDown` 翻页是既有行为），并在 `applyScrollStep` 里按这个轴分发。

**同一处还发现第二个问题**：按键步进的"一页"用的是 `viewport.height`，即使这个口是横向的 —— 于是横向条 `PageDown` 只走 `0.9 × 76 ≈ 68`。现在按轴取尺寸，实测横向条 `PageDown` 走 **529.2**（`0.9 × 588` 宽，正是它该有的量）。修后双轴口：`ArrowRight` x+40、`ArrowDown` y+40、`ArrowLeft` x−40、`ArrowUp` y−40、`PageDown` y+153、`Home` 回 y=0 ✓；对照口（vertical）`ArrowRight` 不滚动而是把焦点交给焦点链 ✓。

### 8.4 像素门禁：交叉轴真的有它自己的滚动条

`#/options` 第一次进 `PIXEL_EXPECTATIONS`（明暗两套，四个点）：

| 采样点                 | 位置         | 暗        | 亮        | 判据                                                |
| ---------------------- | ------------ | --------- | --------- | --------------------------------------------------- |
| `options.both`         | 双轴口下边带 | `#4a515a` | `#b5b9be` | **横向**滚动条（`textMuted` 45% 叠在 `surface` 上） |
| `options.bothx`        | 双轴口右边带 | `#4a515a` | `#b5b9be` | 纵向滚动条                                          |
| `options.bothControl`  | 对照口下边带 | `#161b22` | `#ffffff` | **背景**：不滚 x 的口不许画横向条                   |
| `options.bothControlx` | 对照口右边带 | `#4a515a` | `#b5b9be` | 纵向滚动条                                          |

两个口都开了 `scrollbar: true`（`auto` 只在"刚被使用过"时画，截图会与产生它的手势赛跑），并在 `SCENE_SETUP` 里把两口都钉到中间偏移（滚动条画的是**滑块**，采样点必须落在滑块里）。

**正对照**：把双轴口临时改回 `direction: 'vertical'`，门禁当场转红 —— `options.both` 读到 `#161b22`/`#ffffff`（背景），而 `options.bothx`（纵向条）仍然通过，说明这条检查抓的正是交叉轴那一半。恢复后 8 项全绿。

### 8.5 观测到的、**不是**本轮缺陷的两件事

- **键盘要"口自己"持有焦点才会滚动**：`ScrollView.onAction` 的第一句是 `if (!this.focused) return false`，所以焦点在口**内部的按钮**上时，方向键既不让口滚动、也不会沿着内容走（口内的内容不是可聚焦链）。这是既有设计（V28/V35 的形状：口的动作是"认领方向"，走查靠焦点移动 + reveal），`#/scroll` 的验收也是这么写的；本轮只是把它记下来，没有改。
- **CDP / Playwright 的滚轮增量在本机会翻倍**：`Input.dispatchMouseEvent{deltaY:100}` 到页面里变成 `deltaY: 200`（实测，`dpr = 1`），合成 `WheelEvent` 则原样送达。所以**量滚轮距离要用合成事件**，或者只比较两侧比值 —— 第 87 轮的 `wheelSpeed` A/B 正是比值，才没有踩到。已记入 [`PITFALLS.md`](./PITFALLS.md) §8.49。

---

## 9. 拖动选择与拖动归属协议（V58，第 93 轮）

### 9.1 为什么在这页测

第 88 轮发现纯 Canvas 文本路径**没有任何指针选择**（只有键盘能选），但它**没法在 `#/form` 上补测**：那页是固定面板，没有滚动容器，而缺的正是"拖动归属"——在可滚动页面里给文本域加拖选，会**同时**滚动页面。`#/options` 的整页内容住在一个 `ScrollView` 舞台里，所以新卡（`drag to select (dom: false)`）天生就是一个 A/B：一边是 `dom: false` 的 `TextField`，另一边是一块**不是输入框**的面板，同一次拖动分别落在两边。

### 9.2 协议（`packages/phaser/src/pointer-claim.ts`）

```ts
claimPointerDrag(scene, pointerId, owner); // 文本域在自己的 pointerdown 里认领
pointerDragOwner(scene, pointerId); // 滚动口在"真的要动"之前问一句
releasePointerDrag(scene, pointerId, owner); // pointerup / 失焦 / 销毁时释放
```

关键在于**两边都不需要知道对方的执行顺序**：文本域在 `pointerdown` 就认领，滚动口在**越过拖动阈值的那一刻**才问（而不是在 `pointerdown` 时决定），所以谁先谁后都得到同一个结果。释放是调用方的责任——留着认领不放会让之后所有拖动都被拒（V24 的形状），所以 `pointerup`/`pointerupoutside`/失焦/销毁四条路都会清。

按 (scene, pointerId) 记账：两个场景互不可见，多指手势各管各的（文本域只会认领按在**自己**身上的那根手指，因此缩放用的第二指不受影响）。

### 9.3 实测（真实鼠标 / 真实触摸，`window.optionsDemo.selection()`）

`caret`/`selection` 来自字段自己的 `caretIndex`/`selectionAnchor`；`claim` 是当前未释放的认领。

| #   | 操作                                           | 期望                                   | 实测                                                                                            |
| --- | ---------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | 鼠标按住从左往右拖过文本（6 步 × 30px）        | 选区随指针增长，锚点不动               | `caret 3 → 7 → 11 → 16 → 21 → 26`、`selection` 与 `caret` 相等 ✓（锚点在按下处 = 0）            |
| 2   | 拖动过程中的认领                               | 归该字段，松手即释放                   | 拖动中 `claim = 0:options.select`，松手后 `none` ✓                                              |
| 3   | **A/B**：同样距离在旁边的普通面板上拖          | 页面滚动、选区不变                     | 舞台偏移 `1075 → 969`（滚动 106px）、`selection` 保持 15、`claim = none` ✓                      |
| 4   | 反向确认（把舞台滚回最大再拖）                 | 只有往下拖才动（已到上限）             | 向上拖：偏移不变（本来就到顶）；向下拖：106px ✓ —— 第一次量到的"没滚动"是**探针饱和**，不是缺陷 |
| 5   | 从文本内往外拖出右边界                         | 选区延伸到文本末尾                     | `caret 34`（= 文本长度）、`selection 31` ✓                                                      |
| 6   | 触摸拖过文本（CDP `Input.dispatchTouchEvent`） | 与鼠标同一路径                         | `caret 4 → 9 → 14 → 19 → 24`、`claim = 1:options.select`、松手释放 ✓                            |
| 7   | 触摸拖在普通面板上                             | 页面滚动                               | 舞台 `1075 → 963`、选区不变 ✓                                                                   |
| 8   | 连续第二次拖动（上一次的认领是否卡住）         | 仍然能选                               | 第二次拖动 `caret 15`、`claim` 正常，松手后 `none` ✓                                            |
| 9   | 对照：DOM 桥字段（`bridged: true`）上拖动      | 浏览器负责选择，画布不认领、页面不滚动 | 舞台不变（700）、`claim = none` ✓（隐藏元素把指针吞掉了）                                       |

单测：`packages/phaser/test/pointer-claim.test.ts`（7 条：认领/查询/跨场景隔离/带 owner 的释放不会被过期释放误删/关闭清理/探针命名/非法 id）。

### 9.4 双击选词与三击选行（同一轮到齐）

`text-edit.ts` 新增两个纯函数：`charIndexAtX(text, x, measureWidth)`（指针**压在哪一个字符**上）与
`wordRangeAt(value, characterIndex)`（该字符所在的**同类连段**：词 / 连续空白 / 连续标点），以及 `lineRangeAt()`（三击选整行）。
控件侧按时间 + 距离窗口自己数点击次数（Canvas 路径没有 DOM 的 `event.detail`），2 次选词、3 次选行。

实测（真鼠标，手势之间间隔 > 400ms）：

| 场景                         | 期望                          | 实测                                                                   |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `#/options` 单行字段点一下   | 只放光标                      | `caret 8`、`selection 0` ✓                                             |
| 双击 `across`                | 选中 `across`                 | `selected: 'across'`（`caret 11`、`anchor 5`）✓                        |
| 三击                         | 选中整行（单行字段 = 整个值） | `selected` = 整个值（`caret 34`、`anchor 0`）✓                         |
| `#/form` 多行字段双击第 1 行 | 选中 `alpha`                  | `caret 5`、`selection 5` ✓                                             |
| 同一字段双击**第 2 行**      | 选中 `gamma`                  | `caret 16`、`selection 5` ✓（**修了一个自己刚写出来的缺陷**，见 §9.5） |
| 第 2 行第二个词              | 选中 `delta`                  | `caret 22`、`selection 5` ✓                                            |
| 三击第 2 行                  | **只**选第 2 行               | `caret 22`、`selection 11`（= `gamma delta`）✓                         |
| 软换行的第二个视觉行双击     | 落在同一逻辑行                | 选中整段 `w` 连段（`caret 56`、`selection 56`）✓                       |
| 双击之后再拖动               | 拖选仍然生效                  | `caret 4`、`claim 0:options.select` ✓                                  |

### 9.5 顺带修掉的缺陷：多行字段的"词"取错了行

第一版 `selectUnitAt()` 用**整个 value** 去算"指针压在哪一个字符"（`charIndexAtX(this.value, x, …)`），
而多行字段里 x 是相对**内容盒左边缘**的——换行符与前面每一行的文字都会把 x→字符的映射推偏。
于是：双击第 2 行的 `gamma`，实测选中的是第 1 行的 `alpha`（`caret 5`、`selection 5`）。
修法是在**被点到的那一行**里解析字符下标（`line.start + charIndexAtX(line.text, lineX, …)`，
再经 `valueOffsetFromDisplay` 折回 value 偏移），与光标那一路完全对称。修后第 2 行两处双击分别得到
`gamma` 与 `delta` ✓。**这条缺陷是"为每个控件写 demo 并逐格试"直接抓出来的**：单测覆盖不到"点在第几行"。

### 9.6 仍然没做的

- **拖动自动滚动**（拖到视口外时页面自己滚）：浏览器原生输入框有这个行为，Canvas 路径没有；要做得先有"按指针位置驱动滚动"的循环，已登记为 V62。
