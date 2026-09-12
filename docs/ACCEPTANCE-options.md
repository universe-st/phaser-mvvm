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
