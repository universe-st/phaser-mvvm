# ADR-0012：焦点可见性（`:focus-visible`）与焦点环的真正开关

- **状态**：已接受（2026-09）
- **相关**：[`PLAN.md`](../PLAN.md) §10.3（焦点可视）、ADR-0011（公开 API 冻结）、[`PITFALLS.md`](../PITFALLS.md) §8.74、[`DEFECT-BACKLOG.md`](../DEFECT-BACKLOG.md) P2 / V79、`packages/phaser/src/{Widget,focus,plugin}.ts`、`packages/widgets/src/{Button,Panel,Slider,TextInputBase}.ts`、[`guide/07-input-focus-nav.md`](../guide/07-input-focus-nav.md) §5

## 背景

第 68 轮修掉 **P2** 时，指针按下被接进了焦点系统：`InputRouter.onPointerFocus` → `FocusManager.focus()`（`phaser/src/input.ts` 里那句注释至今写着"按下即聚焦，就像每个桌面工具包那样"）。那条修复是对的——修之前焦点环永不出现，而且每次 `Tab` 都从第一个可聚焦控件重新开始——但它把**两件事绑成了一件**：

1. **焦点归属**：谁持有焦点（决定 `Tab` 从哪继续、`Enter` 激活谁、无障碍镜像报什么）；
2. **焦点可见**：屏幕上要不要画一圈 `focusRing` 描边。

于是产生了一个任何人都能一眼看到、却没有任何文档承认的后果：**点过的按钮会一直带着一个框**。用户的实际反馈就是这么一句话——"上一次点击的按钮会带框"。它既不是渲染缺陷（环确实按设计画了），也不是残留状态（焦点确实还在那个按钮上），而是"可见性"这一维根本没有被建模：四个画环点（`Button`/`Panel`/`Slider`/`TextInputBase`）判的都是 `this.focused`。

同一轮复核还发现第二个洞：`FocusManagerOptions.ring`（`focus: { ring: false }`）**是一个从未被读过的选项**。它被构造参数收下、被 `mvvm.configure()` 写进字段，然后没有任何一处渲染代码读它——文档称它"只是建议性开关"，但一个只写不读的开关与"这个维度不存在"没有区别（登记为 **V79**）。

Web 平台早就把这两个概念分开了：CSS 的 `:focus-visible`。它的规则恰好就是用户想要的那条：**鼠标点击不给按钮画焦点环，键盘导航给**；而文本输入框是例外——浏览器对点击进去的 `<input>` 仍然匹配 `:focus-visible`，因为那里"焦点在哪"就是"字会打到哪"。

## 决策

1. **采用 `:focus-visible` 语义**：指针按下仍然**移动焦点**（P2 的修复一字不改），但**不画焦点环**；`Tab`、方向键、手柄、`widget.focus()` 这些来源照旧画环。
2. **例外由控件自己声明**：`Widget#focusRingOnPointer`（默认 `false`）为 `true` 时，指针按下也算可见焦点。`TextInputBase` 打开它（`TextField`/`TextArea` 共用），与浏览器对 `<input>` 的处理一致——文本域的环就是光标的所在。`Button`/`Panel`/`Slider` 保持默认（不画）。
3. **`Widget#focusVisible` 是画环的唯一判据**：`focusVisible` = 持有焦点 **且** 本次焦点请求允许可见 **且** 全局 `ring` 为真。四个画环点一律改成判它，不再判 `focused`。**`focused` 与 `visualState` 的语义不变**——被鼠标点过的按钮仍然是 `focused`（`#/states` 的 `st.*`、`#/gallery` 的焦点集合、无障碍镜像、`Enter` 激活全部照旧），变的只是像素。
4. **`FocusManager#ring` 变成真开关**（默认 `true`）：`false` 时只抑制环，不动焦点，并且**立即**作用于当前持有焦点的控件（与既有的 `wrap`/`trapFocus` 写入语义一致）。这是"整块画布都不要焦点框"的出口（kiosk / 纯 Canvas 宿主）。
5. **可见性变化不算焦点变化**：`setFocusedInternal(value, focusVisible)` 在只有可见性变化时重画但**不发** `widget:focus`/`widget:blur`——事件承诺的是**变化**（第 110 轮 V63 的教训：`widget:state` 曾经一次点击发两次 `pressed`）。
6. **不新增任何导出名**：`FocusManager#focus(widget, { pointer })` 用可选入参，`focusRingOnPointer`/`focusVisible` 是类成员，`docs/API-SURFACE.json` 的 817 个名字**不变**（ADR-0011 的冻结门禁因此保持绿色，`pnpm api:check` 不需要重新冻结）。
7. **按下就降级，哪怕焦点没移动**（同一轮、在消费方项目里补的，V82）：`FocusManager#applyFocus` 原来在"焦点已经在这个控件上"时直接早退，于是**对话框打开时被自动聚焦的那个控件，用户再点它一下，环不会消失**——而这正是消费方（揭棋）第一次点音量滑杆时看到的画面。现在早退前先把新的可见性请求交给控件：只重画、不发事件（焦点确实没动），返回值仍然是 `false`（没有 _focus_ 移动）。这一条比浏览器的启发式更"干净"：Chrome 对"点击一个已由键盘聚焦的元素"会保留 `:focus-visible`，而这里按下总是降级——环是为不看鼠标的用户存在的，而他们不会去点。
8. **画环的控件，其重绘缓存键必须包含 `focusVisible`**：`Slider` 是唯一把绘制结果缓存的控件（`styleKey`），而它的键里有 `visualState` 却没有可见性。于是 `focus: { ring: false }` 这条**只改可见性、不改状态**的路径不会触发重画，环会一直留在屏幕上，直到别的事情顺带重画（例如切主题）。修法是把 `focusVisible` 加进键——这正是 [`PITFALLS.md`](../PITFALLS.md) §8.59 那条"缓存键必须覆盖画的时候读到的每一个输入"，只是这次的输入是**第二个绘制判据**，不是几何量。

## 后果

**正面**

- 屏幕上的焦点指示重新变得**有意义**：它只在"需要靠它来定位操作"的时候出现。鼠标点过的按钮干净了，键盘/手柄玩家的环一个不少。
- `focused` 这个读数不再被当作"看得见"用——四个画环点、`#/states` 的探针、`ring: false` 的语义都指向同一个新读数，`focusVisible` 成为单一判据。
- `focus: { ring: false }` 从死选项变成可用开关，而且**运行期可切**：`#/states` 实测 `configure({ focus: { ring: false } })` 之后聚焦控件的 `ringOn` 由 `true` 变 `false`（焦点与光标都还在），切回来立刻恢复。

**负面**

- **多了一个概念**：写控件的人现在要分清"状态"（`focused`，进 `visualState`、进无障碍）与"可见性"（`focusVisible`，只决定画不画）。判据错误的表现是"控件看起来没被聚焦"或"画了两个环"，不会编译失败——所以它进了 [`PITFALLS.md`](../PITFALLS.md) §8.74。
- **像素门禁的覆盖面变了**：`visual-check` 的场景表从 13 个名字涨到 15（`#/states` 两遍），像素检查 96 → 108。多出来的成本是**每轮多两次页面加载 + 两次截图**（暗明各一次），换来的是这条规则从"手工验过"变成"每轮都验"。
- `TextInputBase` 的皮肤**自己也画焦点配色**（`textInputSkinStyles.focused` 的边框是 `focusRing` 色，环是叠在它上面的第二个指示），所以全局 `ring: false` 必须同时折进皮肤状态（`skinState()`），否则"关掉环"会留下一圈同色的边框——同一信息画两处是这套皮肤历史的既有形状。

## 证据

- **单测**（`packages/phaser/test/focus-visible.test.ts`，11 条，真 `Widget` + 真 `FocusManager`，Node 假渲染器夹具）：指针按下 `focused=true`/`focusVisible=false`；`Tab`/程序化焦点两者皆真；`focusRingOnPointer` 例外；失焦清零；`ring` 关→开对当前控件的即时作用与"不给按下补发环"；可见性变化不重发焦点事件；样式的幂等写入不发事件；销毁后两个标志都不留。
- **`#/states` 常驻探针**：`#demo-state` 逐帧发 `ring.<name>=on|off`，`window.states.ring()` 读**实时**的 `{ focused, ringOn }`（不是上一帧发布值），见 [`ACCEPTANCE-states.md`](../ACCEPTANCE-states.md) §10。
- **真浏览器实测**（Chromium 1408×677、dpr 2、`#/states`，真 `mouse`/`keyboard`，第 113 轮）：

  | 操作                                                 | `focused` | `ringOn`                     | 像素                                      |
  | ---------------------------------------------------- | --------- | ---------------------------- | ----------------------------------------- |
  | 真鼠标点 `button.default`，指针移开                  | `true`    | `false`                      | 无 `#58a6ff` 描边（截图比对相邻按钮一致） |
  | 接着按真 `Tab`（焦点落在 `button.toggle`）           | `true`    | `true`                       | `button.toggle` 出现 `#58a6ff` 环         |
  | 真鼠标点 `field.plain`（文本域例外）                 | `true`    | `true`                       | 字段出现 `#58a6ff` 环                     |
  | `configure({ focus: { ring: false } })` 后再按 `Tab` | `true`    | `false`（全场无一 `ringOn`） | 环消失，光标仍在（焦点未丢）              |
  | `configure({ focus: { ring: true } })`               | `true`    | `true`                       | 环恢复                                    |

- **常驻像素门禁**（`scripts/visual-check.mjs`，同轮补上）：`#/states` 以别名**跑四遍**——同一个 hash、同一次主题切换，唯一差别是输入序列（CDP 真鼠标 / 真 `Tab`）：
  - `states.pointer`：点 `button.default`。它和一个没人碰过的同款按钮必须**同色**。
  - `states.tab`：真 `Tab` 到同一个按钮。`ring.target` 必须读环色，邻居仍是边框色。
  - `states.pressFocused`（决策 7 的门禁）：先真 `Tab` 把焦点给 `slider.volume`（`until` 表达式顺手记下"此刻确实画着环"），再真鼠标按同一个滑杆——`ring.slider` 的顶边必须回到卡片底色。`Slider` 画**没有背景**，所以这一行要么是环、要么是背后的卡片，判别很干净。
  - `states.ringGate`（决策 8 的门禁）：同样先键盘聚焦滑杆，然后 `configure({ focus: { ring: false } })`——这是**只改可见性、不改状态**的路径，只有重绘缓存键覆盖了 `focusVisible` 才画得掉。

  采样行统一取控件的**最上一行**（`fy: 0`）：环宽 2 内缩 1 盖第 0/1 行，按钮自己的 1px 边框只盖第 0 行，所以这一行是"两态不同、且采样点错位就会红"的那一行。每条臂各带一条输入后断言（`{focused, ringOn}`），防止"输入没落到控件上"式的假通过。规模：场景名 13 → **17**、像素检查 96 → **116**。

- **阳性对照（三个，分别钉住三条不同的代码路径）**：
  1. `Button` 判据改回 `if (this.focused)` → `states.pointer` 明暗各红一条（`expected #30363d got #58a6ff` / `#d0d7de → #0969da`），`states.tab` 仍全过。
  2. `applyFocus` 改回"焦点没动就早退" → `states.pressFocused` 断言失败 **且**明暗两条像素都红（`got #58a6ff` / `got #0969da`），`states.ringGate` 仍全过。
  3. `Slider` 的 `styleKey` 抽掉 `focusVisible` → **只有** `states.ringGate` 的**暗色**半场红（`expected #161b22 got #58a6ff`），断言与亮色半场都过——因为亮色是在 `setTheme` 之后截的，主题切换顺带改了键、自己把陈旧画笔修好了。这条差异本身就是"陈旧重画"的签名，也是为什么像素采样不能只靠断言。
     每一条还原后复跑都是 `[visual-check] ok`。
- **未验证**：真机触摸（`pointer.wasTouch`）下无环这一条只做了逻辑推断——触摸同样走 `onPointerFocus`，但本轮没有在 Android 模拟器上复跑 `scripts/android-check.mjs`。
