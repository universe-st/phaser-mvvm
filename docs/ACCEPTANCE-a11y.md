# 验收记录 · 无障碍镜像（`A11yBridge`，M9 切片）

- **验收场**：[`#/a11y`](../../apps/examples/src/scenes/a11y.ts)（`window.a11y` 暴露 DOM 读数）
- **被测实现**：[`packages/phaser/src/a11y.ts`](../../packages/phaser/src/a11y.ts)、`Widget.a11y` / `Widget.describeA11y()` / `Widget.a11yLabel`、各控件的描述符（`Button`/`Slider`/`TextField`/`TextArea`/`ScrollView`/交互式 `Panel`）
- **范围**（PLAN §1.2、§4.3、决策 6）：**键盘全可达 + 手柄导航 + 隐藏 DOM 镜像 + `aria-live` 播报**；不做 WCAG 全量合规认证，也不复刻浏览器原生语义
- **验收方式**：Playwright MCP —— **两层断言**：① 读真实 DOM（`querySelectorAll('[data-mvvm-a11y]')` 与节点属性），不读控件树，只有这样才能抓到"对象里对、DOM 里错"；② 读**浏览器自己算出来的可访问性树**（CDP `Accessibility.getFullAXTree`，第 76 轮起进 `node scripts/visual-check.mjs` 的常驻断言）——"我们写了什么属性"和"屏幕阅读器看到什么"是两个问题，V42 正是它们的差值
- **全仓门禁**（第 76 轮复跑）：`pnpm -r run test` **1232 passed**（core 281 / layout 313 / phaser 297 / widgets 341）、`typecheck` 5/5、`prettier --check .`、`docs:check`、`pnpm size` 18.5 / 25.1 KB min+gzip（core+layout / phaser+widgets，预算 25 / 45）、`build:examples`、`node scripts/visual-check.mjs` **7 场景 + 46 采样 + `#/a11y` 的 AX 树断言**

---

## 0. 第 76 轮：从"我们写的属性"升级到"浏览器算出的树"

第 64/65 轮建立了镜像与播报，验收读的是**框架写进 DOM 的属性**。第 76 轮把同一件事拿去问浏览器：Chrome 计算自己的可访问性树，于是四个问题当场现形（均在 `#/a11y` 上实测）：

| 发现                                                                                      | 证据（`Accessibility.getFullAXTree`，修复前）                                                                                    | 结论                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **每个文本框被暴露两次**：镜像的 `<div role="textbox">` 与输入框桥的真实 `<input>` 各一个 | 两个字段出现 **4 个** `textbox` 节点；`#/a11y` 的可交互控件明明是 14 个，树里是 **16** 个                                        | V42（MED）：屏幕阅读器把同一个字段读两遍，且两遍的"值"不一样 |
| **`<div role="textbox">` 的 AX _值_ 是描述行**                                            | `textbox "名字" value="名字"` —— 因为镜像把 `describeA11yText()` 写进了节点文本，而 Chrome 对内容型角色取文本当值                | V42 的另一半：字段会把自己的标签当值读出来                   |
| **`aria-valuenow` 写在 `textbox` 上**                                                     | `textbox` 节点带 `aria-valuenow=""`；ARIA 1.2 里该属性只属于 `slider`/`spinbutton`/`scrollbar`/`progressbar`/`meter`/`separator` | 无效 ARIA：校验器会报，阅读器忽略                            |
| **DOM 焦点从不跟随框架焦点**                                                              | 框架焦点在按钮上时 `document.activeElement` 仍是 `<body>`；播报是**一次性**的，阅读器的虚拟光标没有移动                          | 读一次就没了：值变化再不会被读出，也没法"再读一遍"           |

**修法**（四条一起做，因为它们是同一个问题的四个面）：

1. **一个控件一个节点**：控件如果**自己就有 DOM 元素**（`Widget#getA11yDomElement()`，文本框的桥元素），镜像节点就 `aria-hidden` 让位，由那个元素承载 role/name/state；桥建不出来时（没有 DOM 容器）返回 `null`，镜像节点仍是唯一表面——**回退路径是诚实的**。
2. **角色感知的 ARIA**（`a11yAttributes()`，纯函数 + 13 条单测）：值域属性只写给真的支持它的角色；`textbox` 这类内容型角色的节点文本只写**值本身**（`a11yText()`）。
3. **DOM 焦点跟随框架焦点**（`A11yBridge#focusChanged()`）：镜像节点带 `tabindex="-1"`（可被程序聚焦，**不进 Tab 序**），框架焦点变化时把 DOM 焦点移过去；字段则聚焦它自己的 `<input>`（本来就走这条）。焦点移动失败时，才退回 `announceFocus()` 用 `aria-live` 播报——**播报从"唯一手段"变成"兜底"**。
4. **被聚焦控件每帧同步**：`sync()` 改成"变了才写"（签名比对），所以插件可以对当前焦点控件每帧调一次——滑杆用方向键改值、开关回车翻转、提交后出现的校验错误，都不再需要应用手写 `sync()`。

**实测（修复后）**：

```
AX 树（#/a11y，Tab 一次之后）：14 个控制节点、0 重复，恰好一个 focused
  textbox "名字" / textbox "备注"            ← 各自只有真实的 <input> 一个，value 是用户输入的文字
  checkbox "接收通知" checked=true           ← 回车翻转后变 false，无需 sync()
  button "不可用按钮" disabled=true
  slider "音量" value=40 valuemin=0 valuemax=100   ← 方向键 40 → 45，节点当场跟着变
  region "按钮区域" + 6 个 button + button "可点击的卡片" + button "普通按钮"
  status（aria-live=assertive, atomic=true） ← 来自 MVVMPlugin.configure({ a11y: { politeness: 'assertive' } }）

DOM 焦点：框架 focus('a11y.plain') → document.activeElement = 那个 mirror 节点（tabindex=-1）
          Tab → 焦点与 DOM 焦点一起走到下一个控件（镜像节点不抢 Tab）
          字段 → document.activeElement = <input>，输入 "hi" 后 AX 值就是 "hi"
          校验失败 → <input aria-invalid="true" aria-description="名字不能为空">，AX invalid=true
          对话框打开 → DOM 焦点在 confirm.cancel 的节点上；关闭 → 释放回 <body>，不留悬空节点
```

**每帧同步的代价**：新加的"被聚焦控件每帧同步"落在帧路径上，所以量了一次（`#/list`，220 行、89 个控件、焦点在一行的删除按钮上，`bringToFront()` 后各采 120 帧）：镜像是开的 median **16.6 ms** / p95 18.2 ms，把镜像关掉（`sync()` 直接返回）median **16.7 ms** / p95 17.6 ms —— 两者都是"一帧 60 Hz"，差值是噪声。写前比对（签名相同就不写 DOM）是它能做到这一点的原因。

**同轮追加（V44）**：把镜像关掉再打开时发现 `enabled = true` 只挂了容器、**不建节点**（`roots=1`、`nodes=0`，看起来一切正常）。修法是 `set enabled` 里补一次 `refresh()`；现在 `off {root:0,nodes:0}` → `on {root:1,nodes:14}`，重新聚焦后 DOM 焦点照样落在节点上，AX 树也仍是 14 个控制节点。演示页新增两个探针把这件事变成可断言的读数：`state().hidden`（让位给 DOM 元素的镜像节点数，`#/a11y` 上恒为 2）与 `surface(name)`（`element` = 该控件由自己的 DOM 元素承载，`mirror` = 镜像节点就是表面；实测两个字段是 `element`，按钮/滑杆是 `mirror`）。

**门禁**：`scripts/visual-check.mjs` 新增 `AX_EXPECTATIONS`（每个场景列出"角色 + 名字 + 属性"），门槛是**每一条在浏览器算出的树里恰好出现一次**、控制节点总数等于期望条数、`Tab` 之后恰好一个控制节点带 focus、live 区恰好一个且 politeness 正确。把"让位"那一步关掉再跑，脚本立刻报：

```
[visual-check] a11y a11y: "名字" (textbox): found 2 node(s) in the computed tree, expected 1
[visual-check] a11y a11y: the tree exposes 16 control node(s), expected 14 (...)
```

（这就是 V42 的现场证据：门禁能抓住它，而不是"看起来在守门"。）

---

## 1. 它是什么，不是什么

画布对屏幕阅读器是一块不透明的东西，所以框架给**每个可交互控件**放一个视觉隐藏的 DOM 镜像节点（`role`/`aria-label`/`aria-valuenow`/`aria-checked`/`aria-disabled`/`aria-invalid`），焦点变化与应用消息通过一个 `aria-live` 区域播报。

三条刻意设计（都写进代码注释与指南）：

1. **镜像节点不进 `Tab` 序**（`tabindex="-1"`，第 76 轮起）：键盘控制权留在框架里（方向键/`Tab`/手柄），按键仍然由游戏处理；而**程序化焦点会跟随框架焦点**，屏幕阅读器因此落在被聚焦的控件上（而不是只听到一次性播报）；
2. **镜像跟着"可交互集合"走**（`InputRouter` 的注册集合）：`Label`、装饰性 `Panel` 这类没有描述符的控件**不产生节点**，而**禁用控件有节点**并带 `aria-disabled="true"`（它在画面上存在，用户应该听到）；
3. **默认开启**：任何页面在第一次结构变化时就会建出镜像层；不想要就 `this.mvvm.a11y.enabled = false`（运行期，会把整层从 DOM 移除）或配置 `a11y: false`。

---

## 2. 验收矩阵（第 64/65 轮实测）

### 2.1 节点与属性（`#/a11y`，14 个节点）

| 控件                 | 镜像节点                                                          |
| -------------------- | ----------------------------------------------------------------- |
| `Button('普通按钮')` | `button "普通按钮"`                                               |
| `Button(toggle)`     | `checkbox "接收通知" checked=true`                                |
| `Button(disabled)`   | `button "不可用按钮" **disabled**`（**禁用控件也在镜子里**）      |
| `Slider`             | `slider "音量" v=40`                                              |
| `TextField`          | `textbox "名字"`（`label` 选项 → 可访问名；无则退到 placeholder） |
| `TextArea`           | `textbox "备注"`                                                  |
| 交互式 `Panel`       | `button "可点击的卡片"`                                           |
| `Scroll`             | `region "按钮区域" v=0`，`hint` 说明"纵向滚动区，可滚 0px"        |
| 滚动区里的 6 个按钮  | 6 个 `button`，各带自己的文本                                     |
| `Text`（非控件）     | **没有节点**（`Label` 由拥有它的控件读出，不单独播报）            |

`Label`（`a11y.title`/`a11y.hint`/`a11y.tail`）与两个纯布局容器都不在镜像里：节点数 14 = 可交互控件数，`focusables` 13（不含禁用按钮）。

> **第 67 轮追加**：这个滚动区（72px 高、内容 198px、`maxOffset = 126`）同时是"**焦点永远在可见带里**"的验收场：区内 6 个按钮用 `D-Pad 下` 依次走过时，口自动跟随滚动（偏移 32 → 66 → 100 → 126），焦点**每一步都在带内**；而且第一次按下不再把焦点丢给口自己（V33/V34，读数见 [`ACCEPTANCE-scroll.md`](./ACCEPTANCE-scroll.md) §2.3）。屏幕阅读器用户与手柄用户在这一点上需求相同：焦点在哪，就得看得见。

### 2.2 焦点：DOM 焦点跟随（`aria-live` 兜底）

第 76 轮起，焦点变化**首先**体现为 DOM 焦点移动（这是屏幕阅读器真正跟随的东西）：

| 动作                        | `document.activeElement`                                                | live 区域                                               |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `focus('a11y.plain')`       | 该按钮的镜像节点（`tabindex="-1"`，`data-mvvm-a11y-name="a11y.plain"`） | **空**（不再重复播报）                                  |
| 按 `Tab`                    | 焦点与 DOM 焦点一起走到下一个控件（镜像节点不抢 `Tab`）                 | 空                                                      |
| 聚焦滑杆                    | 滑杆的镜像节点                                                          | 空                                                      |
| 聚焦文本框                  | 桥的 `<input>`（本来如此）                                              | 空                                                      |
| 镜像被关掉 / 节点不在文档里 | 不动                                                                    | `音量, 40` 这类播报文本（**兜底路径**，第 64 轮的行为） |

live 区域属性（`Accessibility.getFullAXTree` 读出的计算值）：`role="status"`、`aria-live="assertive"`（示例应用 `MVVMPlugin.configure({ a11y: { politeness: 'assertive' } })`）、`aria-atomic="true"`。

`announceFocus()` 仍然可用（公共 API）：应用自己管 DOM 焦点时用它只播报不移动；应用消息走 `announce(text)`，与焦点无关。

### 2.3 值变化与校验

| 动作                          | 结果                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `setVolume(85)` + `sync()`    | 滑杆节点 `aria-valuenow` 40 → **85**                                                                |
| 让必填字段校验失败 + `sync()` | 字段节点 `aria-invalid="true"`，文本 `名字, invalid, 名字不能为空`（错误消息进 `aria-description`） |
| `announce('测试播报')`        | live 区域文本变成 `测试播报`（同一条消息重复播报也会被读出：先清空再写入）                          |

> **第 76 轮起，被聚焦的控件不再需要应用调用 `sync()`**：插件每帧同步当前焦点控件（写前做签名比对，没变不写），所以滑杆方向键改值（40 → 45）、开关回车翻转（`aria-checked` true → false）、提交时出现的校验错误（`<input aria-invalid="true" aria-description="名字不能为空">`，AX `invalid=true`）都当场反映在节点上。`sync()` 仍然用于"未被聚焦的控件"这类批量场景。

### 2.4 生命周期与开关

| 场景                      | 结果                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `enabled = false`         | DOM 里 `[data-mvvm-a11y-root]` **0 个**、节点 0 个          |
| `enabled = true`          | 重新建出 1 个 root + 14 个节点                              |
| 场景 `restart()`          | 仍然只有 **1** 个 root、14 个节点（插件 teardown 里销毁）   |
| `#/lifecycle` `churn(10)` | 8 项计数全平 + 1 个 root + 9 个节点（**不累积**）           |
| 普通页面（`#/gallery`）   | 自动出现 1 个 root + 9 个节点，无需任何代码触碰 `mvvm.a11y` |

### 2.5 日志（开发模式）

```
[phaser-mvvm] a11y: mirrored 14 widget(s)
[phaser-mvvm] a11y: announce: 测试播报
```

`setDevMode(false)` 后同样的操作（refresh + announce + 改值）**0 行**。

---

## 3. 本轮修掉的两个设计缺口

做这个功能时，"先按最自然的实现跑一遍再看数字"暴露了两处：

### V29 · 禁用控件不在镜像里

第一版镜像从**焦点集合**（`FocusManager.focusables`）生成——那正好是"键盘能到达的东西"，听起来很合理，但那意味着**禁用按钮对屏幕阅读器完全不存在**：实测 `#/a11y` 的镜像只有 13 个节点，`a11y.disabled` 缺席。一个画面上看得见、鼠标点不动的按钮，用户至少应该听到"不可用按钮，disabled"。

修法：镜像改为从 **`InputRouter` 的注册集合**（"用户能作用的控件"）生成，并按控件名排序后保留树的顺序；没有描述符的控件（`Label`、装饰面板）自然被跳过。修后 14 个节点，禁用按钮带 `aria-disabled="true"`。

### V30 · 没有"可访问名"这个选项，无文字控件的名字是内部 id

`Slider`、`Scroll`、交互式 `Panel` 自己不画文字，于是镜像只能退到控件的 `name`（调试 id）：实测读出来的是 `"a11y.volume"`、`"a11y.card"`——一个屏幕阅读器用户会听到 `a11y.volume` 这种东西。

修法：`WidgetOptions` 新增 **`label`**（可访问名），`Widget.a11yLabel` 保存，控件描述符按 `label → 可见文字 → placeholder → name` 的优先级取名；`baseWidgetOptions()` 统一转发（这正是 V13 的教训：**没有代码读的选项等于骗人**）。`TextField`/`TextArea` 早在 M5 就有 `label`（当时用作 DOM 桥的可访问名），现在同一个选项两处都对。修后读出来的是 `"音量"`、`"可点击的卡片"`、`"按钮区域"`。

---

## 4. 未覆盖 / 有意不做

- **真实屏幕阅读器**（VoiceOver / NVDA / TalkBack）：本轮只断言 DOM —— 也就是"喂给屏幕阅读器的原料"；**没有用真实 SR 听过一遍**。这是本记录里最重要的未验证项。
- **浏览模式与焦点模式的交互**：镜像节点刻意不可聚焦，因此 SR 的"表单控件列表"里能看到控件、但 `Tab` 由游戏接管；这种分工**未在真实 SR 上验证过体验**。
- **`aria-activedescendant` / roving tabindex**：没有做（那是"复刻浏览器原生语义"的范畴，PLAN §1.2 明确排除）。
- **层级/角色语义**：没有 `aria-owns`、没有树形结构（列表 → 行 → 单元格只以平铺控件呈现）。
- **本地化播报文案**：`checked`/`disabled`/`invalid` 等词是英文常量，未走主题或 i18n。
- **`aria-live` 的节流**：连续快速变化（拖动滑杆）会连续播报；没有做合并/防抖。

---

## 6. 镜像在虚拟化滚动与转场下的边界（第 80 轮审计）

镜像节点是跟着"可操作控件集合"逐帧重建的，所以"滚动一个 5000 行的虚拟化列表"和"页面转场"是两条最容易让它漏节点的路径。两条都量过，**没有泄漏**：

| 场景                                                             | 判据                                                       | 实测                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `#/list` 逐格滚动（每步 40 行，共 12 步）                        | 镜像节点数必须跟着"挂载窗口"走，而不是跟着数据量           | 启动 19 个节点（14 行窗口）→ 滚动中稳定 **22**（17 行窗口，多出的 3 个是窗口里的按钮/滚动口）→ 滚到列表末尾回落到 19；**没有单调增长** |
| `#/list` 5000 行 + 240 帧连续滚动（`listDemo.perf()`，59.9 fps） | 每帧都 mount/unmount 行，节点数必须回落到窗口大小          | 运行前 **22** → 运行后 **22**（`rendered=17`，新建 241 行）                                                                            |
| `#/pages` 弹出一页（页面还要淡出 120 ms）                        | 幽灵页的节点在淡出期间保留（它还在屏幕上），销毁后必须移除 | 21 → 21（`departing=detail:1`, `routing=false`）→ **18**（落定后只剩基页）                                                             |

这三条现在是**手工断言**（写进本文档），没有做成脚本站点：它们的输入是"滚动多久/多少帧"，做成门禁会带上时间敏感性。相关的常驻门禁仍然是 `scripts/visual-check.mjs` 的 `AX_EXPECTATIONS`（`#/a11y` 的树里每条期望恰好一次、`Tab` 后恰好一个控制节点带 focus、live 区恰好一个）。

---

## 7. 状态变化直接到达无障碍表面（第 84 轮，V52）

第 84 轮把 `disabled`/`error`/`variant` 做成数据槽之后，在 `#/compose` 的 State slots 分区量到一件旧事：**没被聚焦的控件改了状态，镜像与桥元素都不跟着变**。

| #   | 断言                                       | 修前实测                                                                                              | 修后实测                                                                                                     |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A15 | 反应式 `error` 立即到达表面（不碰焦点）    | 桥 `<input>` 与镜像 `<div>` 都是 `aria-invalid=null`、`aria-description=null`（一个正常可编辑的字段） | `aria-invalid=true`、`aria-description=这个值不合法（来自状态）`（两者同时）                                 |
| A16 | 反应式 `disabled` 立即到达表面（不碰焦点） | `disabled` 仍是 `false`                                                                               | 桥元素 `disabled=true`、镜像 `aria-disabled=true`                                                            |
| A17 | 清除状态立即回到正常                       | 需要等一次焦点变化                                                                                    | `aria-invalid` 立刻移除                                                                                      |
| A18 | 程序化写值到达 AX 树（无手动 `sync()`）    | `#/a11y` 的 `setVolume(65)` 靠示例**自己**调 `mvvm.a11y.sync()` 才生效                                | 示例不再手动 sync，AX 树仍报 `valuenow=65`（常驻门禁）                                                       |
| A19 | 门禁能失败（反向验证）                     | —                                                                                                     | 把 `notifyA11yChanged()` 改成空实现：`a11y: "名字": invalid is "false", expected true` + `2 check(s) failed` |

机制：`Widget#a11yListener`（与 `structureListener` 同型）由 `A11yBridge` 在**建节点时**装上、节点移除或控件销毁时清掉；`setEnabled`/`setError`/`Button.setValue`/`Button.setText`/`Slider.setValue`/`TextInputBase.commit` 调 `notifyA11yChanged()`，桥用原有的签名比对决定是否真的写 DOM。

常驻门禁在 `scripts/visual-check.mjs`：`SCENE_SETUP.a11y` 调 `window.a11y.validate()` 与 `window.a11y.setVolume(65)`（**都不再手动 sync**），`AX_EXPECTATIONS.a11y` 要求 `名字` 的 `invalid=true`、`音量` 的 `value=65`。矩阵 §0 的其余判据不受影响（14 个控制节点、无重名、`Tab` 后恰好一个带 focus）。

---

## 9. 第 101 轮：模态对话框必须也让**无障碍树**失效（V72）

把虚拟键盘搬进对话框验收时（见 [`ACCEPTANCE-keyboard.md`](./ACCEPTANCE-keyboard.md) §9）顺手量了无障碍树：**对话框打开时，被盖住的整页仍然在树里**。

| 读数（CDP `Accessibility.getFullAXTree`，只数 textbox/button） | 修前                                    | 修后                       |
| -------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| 无对话框（`#/keyboard` 页面本身）                              | 38                                      | 38                         |
| 打开「对话框里输入」                                           | **73** = 页面的 38 **加上** 对话框的 35 | **35**（只有对话框自己的） |
| 页面上的 `玩家名` 文本框                                       | **仍在树里**（读屏用户可以走到它）      | 已从树里消失               |
| 对话框的 `角色名` / 33 个键 / `取消`                           | 在                                      | 在                         |
| 关闭后                                                         | 38                                      | 38（`玩家名` 回来）        |

根因：模态层挡住了指针（画布命中）也接管了焦点作用域，但**读屏软件走的是无障碍树**——桥把 `input.widgets ∪ focus.focusables` 里每个有描述的控件都镜像出来，与"哪一层在上面"无关；而文本框这类**自带 DOM 元素**的控件，其表面就是那个隐藏 `<input>`，遮住镜像节点根本不够。

修法（`packages/phaser/src/a11y.ts`）：桥新增 `isBehindModal(widget)` —— 顶层模态的 `content` 是"当前活着的表面"，不在它子树里的控件一律 `aria-hidden`（镜像节点与它自己的 DOM 元素都标），而**当前持有 DOM 焦点的控件永不隐藏**（`aria-hidden` 标在聚焦元素上是无效 ARIA，浏览器可能直接丢掉焦点）。缓存签名里带上 `inert`，所以开关模态时重新应用；模态的 `open`/`close` 本来就会 `refreshInteraction()`，时序不需要新的钩子。

**常驻门禁**：`scripts/visual-check.mjs` 的 `AX_EXPECTATIONS` 新增 `modal` 一条（该场景的 `SCENE_SETUP` 本来就开着 `confirm` 对话框），只列对话框自己的两个控件（`取消` / `删除`），而 AX 门禁的语义是"**控制节点恰好这么多**"——于是"被盖住的页面按钮还在树里"会当场红掉。实测修后 `a11y tree ok for modal (2 control nodes, no duplicates)`；同一次运行里 `a11y` 14 个、`keyboard` 38 个（第 101 轮新增的 `对话框里输入` 按钮算第 38 个）。

**正对照**：把 `isBehindModal` 强制返回 `false` 再跑一次 —— `modal` 这一条如期失败（`1 check(s) failed`），恢复后重新全绿。

> 这一条**无法用 Node 单测回归**：它验的是浏览器算出来的无障碍树，所以门禁落在 `visual-check` 的 AX 表上（与第 76 轮 V42/V43 同一条路）。
