# 验收记录 · `VirtualKeyboard` 虚拟键盘（第 81 轮，M9 手柄文本输入）

> 背景：PLAN M9 最后一项未交付的能力是**纯手柄完成文本输入**。手柄能移动焦点、能按 `A`、能按 `B` 返回，但打不出字——主机 UI 的通用答案是画一个键盘。本轮交付 `VirtualKeyboard`：按键就是普通 `Button`，所以 D-Pad/`Tab`/指针/焦点环/无障碍镜像全部免费复用；键盘本体只负责「这个键是什么、按下它改什么」，写回字段走的是**和真实按键同一条路**（`insertText`/`deleteText`），因此 `maxLength`、数字过滤、清洗、变更事件的行为完全一致。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium，1280×720，`bringToFront()` 后断言），dev server 5173，假手柄 `window.fakePad`（CDP 没有手柄输入域）。

---

## 1. 交付物

| 产物                                                    | 说明                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/widgets/src/keyboard-plan.ts`                 | **纯逻辑**（零 Phaser）：按键表（33 键 × 两页 + 13 键小键盘）、标签、键宽、`pageOf()`、`pressShift()`/`afterTyping()` 大小写状态机                                              |
| `packages/widgets/src/VirtualKeyboard.ts`               | 控件本体（`extends Panel`）：页/大小写状态、槽位与按键控件的对应、把一次按键变成一次编辑；键本身由 DSL 画（键是 `Button`）                                                      |
| `packages/widgets/src/compose.ts` → `VirtualKeyboard()` | DSL 入口：`withUiParent()` 认领行（见 §6 V47），键宽来自 `keyWidth()`                                                                                                           |
| `TextInputBase.insertText/deleteText/setCaretIndex`     | 第 80 轮加的公开编辑 API，键盘用它写字段（与真实按键同一条 `applyEdit` 路径）                                                                                                   |
| `TextInputBase.setValue` 语义修正                       | 程序化写值**现在会同步模型绑定**，但不触发页面的 `onChange`（见 §6 V49）                                                                                                        |
| `packages/widgets/test/keyboard-plan.test.ts`           | 16 个 Node 单测（本轮新增这批；后续轮次又补了几条）：行结构/槽位唯一性/两页字符可达性/标签与 ⇧⇪/键宽/一次性与锁定/松手回到小写/页码切换                                         |
| `apps/examples/src/scenes/keyboard.ts`（`#/keyboard`）  | 常驻验收页：一个字段 + 文字/数字两种键盘 + 换键盘按钮；逐帧发布 `kb.*` 与每个键的 `pt.kb.<id>`/`st.kb.<id>`                                                                     |
| `scripts/visual-check.mjs`                              | `keyboard` 进像素矩阵（`kb.keyboard` 面板底色、`kb.key.enter` 主键底色，明暗两套）与 `AX_EXPECTATIONS`（**38** 个控制节点逐一断言，第 101 轮加了 `对话框里输入` 后从 37 变 38） |

`#status` 的几何（一次性上报，第一帧后）：`kb.keyboard=@380,297 520x150`、`kb.field=@380,249 520x36`、`kb.key.q=@463,307 30x28`、`kb.key.enter=@733,409 66x28`。

---

## 2. 手柄验收（假手柄：D-Pad 12–15、`A`=0、`B`=1）

| #   | 断言                                   | 实测                                                                                                 |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | 手柄被 Phaser 看到                     | `window.fakePad.pads() === 1`                                                                        |
| 2   | D-Pad 能在键盘**内部**逐键走           | `kb.text` ↑ → `keyboard.space` → `keyboard.v` → `keyboard.f` → `keyboard.r` → `kb.field`（按列上行） |
| 3   | D-Pad 能从键盘走到页面动作按钮再走回来 | `keyboard.shift` ↓ → `kb.numeric` →（→）`kb.text`                                                    |
| 4   | **`A` 在按键上就是打字**               | 焦点 `keyboard.q` 上按 `A` → `value="q"`、`caret=1`、`kb.submits` 不变                               |
| 5   | `A` 在动作按钮上执行动作               | 焦点 `kb.clear` 上按 `A` → 字段清空（含模型，见 §6 V49）；`kb.numeric` 上按 `A` → 换成小键盘         |
| 6   | `A` 在 `Enter` 键上提交                | 提交计数 1 → 2（换过键盘之后仍然有效，见 §6 V48）                                                    |
| 7   | 小键盘用 `A` 能打出数字                | 切到 `numeric` 后按两次 `keyboard.n7` → `value="77"`，键集 13 个、`focusables` 17                    |
| 8   | 焦点始终落在**看得见**的键上           | 全程 `focus.*` 与 `pt.kb.*` 一致（第 67 轮的 `revealInViewports` 对键盘不触发滚动，因为键盘不裁剪）  |

**按键状态机**：`st.kb.<id>` 逐帧发布 `normal → hover → pressed → focused`，例如鼠标悬停 `st.kb.q=hover`、按下当帧 `pressed`、抬起后 `focused`。

## 3. 指针验收（鼠标真实事件 / CDP `Input.dispatchTouchEvent`）

| #   | 输入                | 断言                   | 实测                                         |
| --- | ------------------- | ---------------------- | -------------------------------------------- |
| 1   | `mouse.move` 到 `q` | 悬停状态               | `st.kb.q=hover`                              |
| 2   | `mouse.down`        | 按下状态               | `st.kb.q=pressed`                            |
| 3   | `mouse.click`       | 写入字段               | `value="q"`、`caret=1`、`focus=keyboard.q`   |
| 4   | 点 `Space` 再点 `w` | 空格是字符、焦点跟着走 | `value="q w"`、`caret=3`、`focus=keyboard.w` |
| 5   | 触摸点 `t`/`o`      | 每个触点都算一次按键   | `st=pressed`，`value` 依次 `"t"`、`"to"`     |
| 6   | 触摸点 `Space`      | 空格可触摸输入         | `value="to "`                                |
| 7   | 触摸点 `⌫`          | 退格删一个字符         | `value="to"`、`caret=2`                      |
| 8   | 抬起手指后          | 不残留 hover/pressed   | `st` 回到 `focused`/`normal`                 |

## 4. 大小写与页码（`keyboard-plan.test.ts` + 浏览器实测）

| 操作         | 期望                                 | 实测                                                                        |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------- |
| 按一次 `⇧`   | 下一个字符大写，然后自动释放         | `upper=on`、`kb.upperFirst=Q`；打一个 `q` 后 `upper=off`、`kb.upperFirst=q` |
| 连按两次 `⇧` | 锁定（`⇪`），连续字母都大写          | `caps=on`；打 `q`、`w` → `"QwQW"`（锁定保持）、`upperFirst` 一直是 `Q`      |
| 再按一次 `⇧` | 全部释放                             | `upper=off`、`caps=off`                                                     |
| 按 `123`     | 换到符号页，`⇧` 消失、页码键变 `ABC` | `page=symbols`、`kb.upperFirst=1`、键集仍是 33 个；按 `q` 得 `"1"`          |
| 再按 `ABC`   | 回到字母页                           | `page=letters`、`kb.upperFirst=q`                                           |
| 数字键盘     | 没有 `⇧`、没有字母页                 | 13 个键、`page=numeric`、`appearance.capsLock=false`                        |

「一次释放」与「锁定」是**两个可分别读出的探针**（`kb.upper` 与 `kb.caps`）：只报 `upper` 的验收分不出"按一次"和"按两次"，而那正是玩家最直接感受到的差别。

## 5. 门禁：泄漏、无障碍树、像素

| 门禁                         | 命令/入口                                                    | 结果                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 键/字段编辑不泄漏            | `window.keyboard.churn(20)`（打字 + 退格 ×20）               | `widgets/themeListeners/pointerTargets/focusables/displayList` 前后完全相同（49/50/39/37/1）                                                                   |
| **换键盘不泄漏**             | `window.keyboard.swapChurn(20)`（文字↔数字 ×20，每轮等一帧） | 同上，前后完全相同；结束时 `kind=text`                                                                                                                         |
| 无障碍树（浏览器算出的那棵） | `node scripts/visual-check.mjs`                              | `a11y tree ok for keyboard (37 control nodes, no duplicates)`；`Tab` 之后恰好一个控制节点带 focus；字段 `textbox` 只有 **1** 个（名字 `玩家名`、值随输入更新） |
| 像素（暗/亮两套）            | 同上                                                         | `kb.keyboard` `#1f2630`→`#eef1f4`、`kb.key.enter` `#2f6feb`→`#0969da`、`canvas.clear` 两套均 OK                                                                |
| 单测                         | `pnpm --filter @phaser-mvvm/widgets run test`                | 18 文件 / **358** 用例通过（新增 `keyboard-plan.test.ts` 15 条）                                                                                               |
| 全仓                         | `pnpm -r run typecheck` / `pnpm -r run test` / `pnpm size`   | 5/5 包通过；**1260** 用例；`phaser+widgets` 26.1 KB min+gzip（预算 45）                                                                                        |
| 其它场景未受影响             | 21 个场景逐个加载                                            | 全部 `active` 与哈希一致、`#status` 无 `ERROR:`/`REJECTION:`、控制台无报错；`#/lifecycle` 5 轮、`#/uiscene swap(20)`、`#/showcase churnSections(4)` 计数全平   |

## 6. 换键集：`kind` 是数据槽（第 82 轮）

第 81 轮把 `VirtualKeyboard` 交出来时，"换键盘"要调用方自己 `buildUiSubtree()` + `addWidget/removeWidget`，而且必须把 `onSubmit` 之类的选项**再抄一遍**——两份选项就是两次机会漏东西（V48 已经漏过一次）。第 82 轮把 `kind` 做成普通数据槽：键盘自己重建自己的键。

| #   | 断言                                       | 实测                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 写 `ref` 即换键集（鼠标点按钮 / 手柄 `A`） | `setKind('numeric')` → 键 33 → **13**、`focusables` 37 → 17、面板几何仍是 `520x150`；`counts.widgets` 49 → 29                                                                                                                                                                                          |
| 2   | 键探针跟着重建走                           | 数字键盘上 `pt.kb.q=gone`、`st.kb.q=gone`，`pt.kb.n7=@604,389`、`st.kb.enter=normal`                                                                                                                                                                                                                   |
| 3   | 选项不会在重建中丢失（V48 的根因消失）     | 换键盘**之后**用 `A` 打数字得 `"77"`、`Enter` 提交计数 +1（`onSubmit` 只有一份）                                                                                                                                                                                                                       |
| 4   | 换键集**保住焦点**（同一个键 id 还在）     | 焦点在 `keyboard.enter` 时换键集 → 仍是 `keyboard.enter`（两种键盘都有）                                                                                                                                                                                                                               |
| 5   | 换键集**兜底**到第一个键（原键 id 没了）   | 焦点在 `keyboard.q` 时切数字键盘 → `keyboard.n1`，紧接着按 `A` 打出 `"1"`（手柄玩家不会"焦点消失"）                                                                                                                                                                                                    |
| 6   | 页码键与可访问名                           | `123` → 键 33 → **32**（真的没有 `⇧`）、`st.kb.shift=gone`、焦点回到 `keyboard.page`；该键的可访问名在符号页是 `Letters`（名字跟着去向走，不是复述当前页）                                                                                                                                             |
| 7   | 可访问性树跟着重建走                       | 初始 **38** 个控制节点（第 101 轮加了 `对话框里输入`）→ 数字键盘 **17**（13 键 + 3 按钮 + 字段）→ 符号页 **36**，`textbox` 始终只有 1 个、无重名                                                                                                                                                       |
| 8   | 换键集不泄漏                               | `swapChurn(20)`（翻 `kind` ref）与"翻页 20 次 + `churn(20)`"前后 `widgets/themeListeners/pointerTargets/focusables/displayList` 完全相同（这一轮的基线是 49/50/39/**37**/1；第 101 轮加了对话框后 §9 的基数是 50/51/40/**38**/1）。**`pageChurn` 这个探针不存在**，翻页用 `press('page')` + `churn(n)` |

第 6 条顺带修掉了第 81 轮留下的一个**文档与代码不一致**（V50）：计划函数 `keyboardRows()` 一直说"符号页没有 `⇧`"，但控件只是**重新贴标签**，`⇧` 明明还在屏上——单测断言的是计划、浏览器看到的是控件，两边从没对上过。现在页码切换是换键集，两边一致。

第 4/5 条需要一个框架侧的小补充：复合控件（键盘）**自己**不是可聚焦控件，`Widget#focusManager` 永远是 `null`，要从它的键上拿；而且 `FocusManager.focus()` 只接受**当前收集集合**里的控件，而那个集合此刻还描述着刚被销毁的旧键——所以先 `refresh?.()` 再 `focus()`，否则调用被静默忽略（实测：修之前四种换键集场景焦点全是 `none`）。`FocusTarget` 因此补上可选的 `refresh()` 并从包入口导出。

## 7. 本轮抓到并修掉的三个缺陷

| #   | 严重度 | 位置                                   | 问题                                                                                                                                                                                                                                                                                                                                                     | 修法                                                                                                                                                                                                                                                                                   |
| --- | ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V47 | MED    | `widgets/src/compose.ts`               | **`VirtualKeyboard()` 从不认领自己的行**：它 `emitWidget(widget)` 之后才逐行 `Row(...)`，于是键挂到了**当前容器**（页面面板）上，键盘本体成了一个空盒子。实测 `kb.keyboard=@380,442 520x20`（面板 520×20、位于按键下方），而按键坐标在 y=281..431——**键照旧可点可聚焦**，所以只有读几何才看得见                                                          | 改用 `withUiParent(widget, () => { …keys… })`（与 `Panel`/`Row` 同一套容器协议），并去掉多余的 `emitWidget`；修复后 `kb.keyboard=@380,297 520x150`，恰好包住四行按键                                                                                                                   |
| V48 | LOW    | `apps/examples/src/scenes/keyboard.ts` | **第二条构建路径从未被验收**：换键盘发生在点击回调里（没有构建作用域），而 DSL 的入口会 `currentUiScene()` → **抛错**（`uiscope.ts` 的 `scopeError`，已有单测钉住）；同时重建时漏传 `onSubmit`，于是"切到数字键盘之后 `Enter` 不提交了"                                                                                                                  | 懒构建走**文档里就有的**入口 `buildUiSubtree(scene, () => VirtualKeyboard(...), '…')`；两条路径共用 `keyboardOptions(kind)` 一个工厂，`Enter` 在换键盘前后都提交（实测 1→2→3）                                                                                                         |
| V49 | MED    | `widgets/src/TextInputBase.ts`         | **程序化写值不与模型同步**：`setValue()` 走 `commit(..., { silent: true })`，连 `change` 一起吞掉，而双向绑定（`value: ref`）正是靠 `change` 写回 —— 于是一次 `field.setValue('')` 之后**字段空了、`ref` 还是旧文本**，页面的模型与用户看到的内容不一致（实测：`caret=0` 但 `kb.value="QwQW"` 一直不消失）。这类"两个真相"在表单里迟早变成"提交了旧内容" | `commit()` 的开关从「是否发声」拆成「是否**用户编辑**」：任何提交都发 `change`（绑定与 `onValueChange` 跟得上），只有用户编辑才调 `onChange` 选项。修后 `setValue('')` → `kb.value=""`；`#/form`（`bindValue(..., w => w.setValue(v))`）回归通过，`bindModel` 的相等性守卫仍保证不成环 |

三条里有两条（V47/V48）能且只能靠**读几何/走第二条路径**发现：按键可点、计数为零、截图好看，全部"正常"。

## 8. 未验证与已知边界（诚实清单）

- ~~**真实手柄硬件**未测：CDP 没有手柄域，全程用假手柄（`navigator.getGamepads` 替换）~~ **已移出验收范围（第 111 轮，有意排除，不是待办）**：真实手柄硬件不再验收，见 [`PLAN.md`](./PLAN.md) §1.2；证据是假手柄夹具（`window.fakePad`，整条链路按真手柄跑）+ `packages/phaser/test/nav.test.ts`。
- ~~**真实屏幕阅读器**（VoiceOver/NVDA）仍未人工走一遍~~ **已移出验收范围（第 111 轮）**：三个真实 SR 都不做；证据是**浏览器算出的可访问性树**（本文 §2 的 AX 表断言，与 M9 同一套）。见 [`PLAN.md`](./PLAN.md) §1.2。
- **按住 `A` 不会连打**：`activate` 是边沿触发（方向键才有 `NavRepeat` 连发），这是有意的——自动重复打字几乎总是误输入。同理，字母键上**没有**手机那种长按出符号，符号走 `123` 页。
- **不是输入法**：`VirtualKeyboard` 打不出中文/日文（没有候选词/组合）。需要中文的用户仍走真实键盘路径（隐藏 DOM 输入桥，ADR-0004）。
- **`Repeat` 行模板里的键盘**未做演示页验证（懒构建路径本轮验证的是按钮回调这条；`buildUiSubtree()` 是同一个入口，见指南 09）。
- 本轮**没有**做手柄 + 页面转场/模态框里键盘的组合验收（键盘在对话框里、转场期间按键是否可点）。

---

## 9. 第 101 轮：对话框里的键盘（模态 × 复合控件）

手柄用户最需要键盘的场合恰恰是"弹一个框让你输入"（改名、输入房间号）。本轮给 `#/keyboard` 加了一个「对话框里输入」按钮：它打开一个模态层，里面是**自己的一套** 字段 + `VirtualKeyboard`（独立 `target` 与独立 `ref`，不与页面上的那套共用）。

**为什么值得单独验**：键盘是复合控件（键是 `Button`、键盘自己不可聚焦），模态是"新焦点作用域 + 遮罩 + 语义立即/画面延后"，两者的交界处正是过去几轮缺陷的产地（V27/V47/V50）。

### 9.1 读数字（真实输入）

`window.keyboard` 新增 `openDialog()` / `closeDialog()` / `dialogState()` / `dialogType(text)` / `dialogPress(id)` / `dialogPoint(id)` / `dialogChurn(n)`；`#demo-state` 逐帧发布 `dlg.open`/`dlg.value`/`dlg.length`/`dlg.caret`/`dlg.kind`/`dlg.submits`（关闭后值类读数发 `gone`——控件已经销毁）。

| #   | 操作                                             | 期望                            | 实测                                                                                                |
| --- | ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| K20 | 真鼠标点「对话框里输入」                         | 开层、焦点在对话框里            | `top=modal#1`、`focus=kb.dlg.field`、`focusables` = 对话框自己的 35 个（页面的 38 个全部不在） ✓    |
| K21 | **假手柄**：`→` 从字段走到键、`↓` 换行、`A` 打字 | 焦点走查 + `A` 就是输入         | `focus: kb.dlg.field → keyboard.y → keyboard.g`，`A` 后 `value=abg`（多了一个 `g`） ✓               |
| K22 | 按屏幕键盘的 `Enter` 键                          | 提交并关闭                      | `dialogPress('enter')=true` → `dlg.submits=1`、`dialog=null`、`dlg.open=no` ✓                       |
| K23 | 真鼠标点对话框里的 `q` 键                        | 输入一个字符、焦点落到该键      | `value=abgq`、`focus=keyboard.q` ✓                                                                  |
| K24 | **真触摸**（CDP）点 `space` 键                   | 输入空格                        | 新开一层时 `value=''` → tap 后 `value=' '`（长度 1）、`focus=keyboard.space` ✓                      |
| K25 | `Esc`                                            | 关闭 + **焦点回到打开它的按钮** | `dialog=null`、`focus=kb.dialog` ✓（模态的 `popScope()` 承诺）                                      |
| K26 | `dialogChurn(5)`（开/关各 5 次，每轮等动画结束） | 计数回基线、不泄漏              | `widgets/themeListeners/pointerTargets/focusables/displayList` = `50/51/40/38/1` **前后完全相同** ✓ |
| K27 | 页面自己的字段在对话框期间                       | 不受影响                        | `kb.value` 始终是 `''`（两个 `ref` 互不干扰） ✓                                                     |

### 9.2 两处**探针**教训（不是产品缺陷）

1. **别在出场动画没结束时采样**：第一版 `dialogChurn` 每轮只等两帧（~33ms），而关闭后的图层要等 `exit` 120ms 才销毁——五轮之后读到 `widgets 96`（基线 50），看起来像每轮漏一层，实际是"五个还在淡出的图层"（`#/modal` 的门禁早就为此用 `await settle()`，本轮把同一条搬到键盘页：`transitions.pending === 0` 才算一轮结束）。修后前后完全一致。
2. **上一层的坐标不能拿来点下一层**：连续两次开启（第一次用 `enter` 关掉、第二次用真鼠标点开）之后，如果还照着旧读数的坐标点，落点会打在**遮罩**上——遮罩点击是"取消"（这是设计），于是表现为"点了键没反应、对话框还关了"。干净复现（重新加载页面 → 只开一层 → 用 `dialogPoint()` 现算坐标）后触摸与鼠标都正常。**判据**：跨层操作前必须重新读目标层的坐标。

### 9.3 相关

- 模态期间被盖住的那一页在**无障碍树**里是否还可达：本轮发现它**还可达**，已修（V72），见 [`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md) §9 与 [`PITFALLS.md`](./PITFALLS.md) §8.62。
- 键盘自身的状态机（大小写、换键集、焦点回填）见 §1–§8。
