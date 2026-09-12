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
