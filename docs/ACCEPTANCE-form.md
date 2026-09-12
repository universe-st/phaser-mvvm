# 验收记录 · 表单页状态机（`#/form`，第 57 轮；第 88 轮补纯 Canvas 路径）

> 背景：`#/form` 是文本框/表单能力的**综合**演示页（`TextField` + `TextArea` + 校验 + 提交），但此前的验收只做过「页面能加载、不报错」。第 57 轮把它做成可断言的验收页——补上 `st.*` 探针与 `window.form` API，然后用真实鼠标/键盘/触摸跑一遍状态机（objective：每个控件都要有 demo，且要验证**各种情况**下的状态）。第 88 轮补上**纯 Canvas 路径**（`dom: false`）的三个字段与整套走查，并修掉其中一个 `readOnly` 缺陷（V59）。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，页面 `bringToFront()`。

---

## 1. 本轮补的观测能力

| 通道          | 内容                                                                                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#demo-state` | `st.name` / `st.email` / `st.notes` / `st.submit`（逐帧 `visualState`）、`name.length`、`notes.breaks`、`email.valid`、`hint`、`nameError`/`emailError`/`notesError`（失焦时写入）、`focus`、`submitted`、`submits`，以及纯 Canvas 三个字段的 `canvas.*` / `canvasArea.*`（含 `canvasArea.breaks`）/ `canvasRo.*` |
| `window.form` | `values()`、`errors()`、`states()`、`focus()`、`submitted()`、`submits()`、`canvas()`（`{ canvas, canvasArea, canvasRo }`，每项 `{ value, caret, selection, bridged }`）                                                                                                                                          |

（自由文本带空格时不要按空格切分 `#demo-state`，走 `window.form.values()`——本文件里的读数都是这么取的。）

`submitted` 的载荷在第 88 轮改成 **`submitted#<序号> <来源>:<值>`**（值里的换行写成 `\\n`，来源是 `name`/`email`/`notes`/`button`/`canvas`/`canvasArea`）。旧载荷只有 `name / email`，**看不出是谁提交的**——而"`Ctrl+Enter` 到底提交了、还是只插了个换行"正是纯 Canvas 路径要问的问题。

## 2. 状态机实测（第 57 轮，第 88 轮用新载荷重测 9/10/12）

| #   | 操作                     | 期望                 | 实测                                                                                  |
| --- | ------------------------ | -------------------- | ------------------------------------------------------------------------------------- |
| 1   | 打开页面                 | `name` 自动聚焦      | `states = { name: focused, … }`、`focus = name` ✓                                     |
| 2   | name 输入 1 个字符后失焦 | 校验失败             | `errors().name = 'at least 2 characters'` ✓                                           |
| 3   | 补到 ≥2 字符再失焦       | 错误清除             | `errors().name = null`、值 `ada` ✓                                                    |
| 4   | email 输入 `nope`        | 派生状态跟着变       | `email.valid = false`、`hint = 'enter a valid email address'` ✓                       |
| 5   | email 失焦               | 报错                 | `errors().email = 'invalid email'` ✓                                                  |
| 6   | email 改成合法地址再失焦 | 错误清除             | `errors().email = null`、`email.valid = true`、`hint = 'ready to submit'` ✓           |
| 7   | name 输入 30 个字符      | `maxLength: 24` 生效 | `name.length = 24` ✓                                                                  |
| 8   | notes 输入两行           | `Enter` 是换行       | `notes.breaks = 1` ✓                                                                  |
| 9   | notes 里 `Ctrl+Enter`    | 提交                 | `submitted#1 notes:line one\\nline two` ✓                                             |
| 10  | 单行字段里 `Enter`       | 提交                 | `submitted#2 email:ada@example.com` ✓                                                 |
| 11  | 触摸点击 email 后输入    | 聚焦并输入           | `focus = email`、值 `touch@example.com` ✓（DOM 桥路径）                               |
| 12  | 点击 Submit 按钮         | 提交                 | `submitted#3 button:line one\\nline two`（按钮与两个 `Enter` 共用同一个 `submit()`）✓ |

## 3. 第 57 轮修的问题：演示页承诺了没有人处理的手势

notes 的 placeholder 写着「Enter adds a line, Ctrl/Cmd+Enter submits」，但页面**只订阅了 `change`**，没有任何 `submit` 订阅——于是 `Ctrl+Enter` 什么都不发生。框架侧是对的（`TextArea.submitsOnEnter()` 在 `ctrlKey/metaKey` 时返回 `true`，`submit()` 会 emit `TEXT_INPUT_EVENTS.SUBMIT`），缺的是**页面自己的接线**。

修法：把三个字段的 `SUBMIT` 事件都接到同一个 `submitFromNotes()`（Submit 按钮也复用它），于是 placeholder 的说法成立、按钮与键盘两条路径行为一致。

> 这一类「文档/演示承诺 > 实现」的缺口，过去几轮出现过多次（`List({ gap })`、`focusOrder`、`hideMode`、本轮的 placeholder），已统一记在 `docs/DEFECT-BACKLOG.md` 的 V13/V16 与文档待办里。

## 5. 纯 Canvas 输入路径（`dom: false`，第 88 轮）

### 5.0 为什么这一轮才做

`dom: false` 是 guide 04 §2 记录的**降级路径**：控件不建隐藏 `<input>/<textarea>`，自己用捕获阶段的 `window` keydown 读键，自己画光标与选区。框架的默认是 DOM 桥，所以这条路径只在"没有 DOM 容器""不想要 IME"的场景里才走——但在第 88 轮之前它**一个 demo 都没有**（`grep -rn "dom: false" apps/examples/src` 为空），而 V17/V18 两个输入缺陷恰好都出自它的那个监听器。没有覆盖的路径 = 没人知道的路径，所以本轮给它加了三个字段并逐条走查：

| 字段         | 构造                                                    | 覆盖什么                                        |
| ------------ | ------------------------------------------------------- | ----------------------------------------------- |
| `canvas`     | `dom: false`、`maxLength: 40`                           | 单行编辑、光标、选区、Tab 交接、粘贴/剪切       |
| `canvasArea` | `dom: false`、`rows: 3`（`wrap` 默认开）                | 多行编辑、视觉行/逻辑行的光标、软换行后点击定位 |
| `canvasRo`   | `dom: false`、`readOnly: true`、`value: 'locked value'` | 只读语义（含剪贴板捷径）——V59 就在这里          |

三个字段都进了 `window.form.canvas()`、`#demo-state` 的逐帧探针与 `#status` 的几何报告。**坐标一律从 `window.game.scene.getScene('form').mvvm.input.widgets` 的实时 `rect` 取**：`reportControl`/`reportWidget` 是"创建时采样一次"，加了 `canvasRo` 之后旧快照与真实布局差了 48px（本轮第一次走查就因此点到空白处，误以为"点击后焦点丢失"——见 §5.7）。

### 5.1 单行编辑（`canvas`）

| #   | 操作                                            | 期望                                                 | 实测                                                           |
| --- | ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| 1   | 点击字段                                        | 聚焦、`bridged === false`                            | `focus = canvas`、`bridged = false` ✓                          |
| 2   | 输入 `hello world`                              | 值随键变化                                           | `value = 'hello world'`、`caret = 11` ✓                        |
| 3   | `Shift+ArrowLeft` ×2                            | 选区 2、光标 3                                       | `caret = 3`、`selection = 2` ✓                                 |
| 4   | `Backspace`                                     | 删掉选区                                             | `value = 'hel'`、`selection = 0` ✓                             |
| 5   | `Home` / `End`                                  | 光标到行首/行尾                                      | `caret 0` → `caret 2` ✓                                        |
| 6   | `Delete`                                        | 前向删除                                             | `value = 'el'`（删掉 `h`）✓                                    |
| 7   | `Control+a`                                     | 全选                                                 | `caret = 0`、`selection = 2` ✓                                 |
| 8   | `ArrowRight` / `ArrowLeft`                      | 折叠选区后移动                                       | `selection 0`、`caret 1` → `caret 0` ✓                         |
| 9   | `Tab` / `Shift+Tab`                             | **不被输入框吞掉**，交给焦点链                       | `focus` 从 `canvas` 走到 `canvasArea` 再回来 ✓（V17 的回归位） |
| 10  | 在文本上点击（x = 456…800）                     | 点哪光标落在哪                                       | `caret` 0/0/2/4/7/13/17/22/29/36/36（单调，≈9px/字符）✓        |
| 11  | `Control+C` / `Control+X`                       | 复制 / 剪切（canvas 路径自己实现）                   | 剪贴板 `hello `、`value 'hello world' → 'world'`、`caret 0` ✓  |
| 12  | `Control+V`                                     | 粘贴                                                 | `value = 'hello '`、`caret = 6` ✓                              |
| 13  | `maxLength: 40` 下输入 50 个字符                | 截到 40（DOM 桥靠 `maxlength`，canvas 路径得自己截） | `value.length = 40`、`caret = 40` ✓                            |
| 14  | `canvasArea`（没有 `maxLength`）输入 120 个字符 | 不设上限就不截                                       | `value.length = 120` ✓                                         |

### 5.2 多行编辑（`canvasArea`）

| #   | 操作                                       | 期望                                | 实测                                                                  |
| --- | ------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------- |
| 1   | `ab` + `Enter` + `cd`                      | `Enter` 插换行                      | `value = 'ab\ncd'`、`caret = 5` ✓                                     |
| 2   | `ArrowUp` / `ArrowDown`                    | 跨**逻辑行**移动光标                | `caret 5 → 2 → 0`（`Home` 后 `ArrowDown` 到 3）✓                      |
| 3   | `Control+Enter`                            | 提交，**不**插换行                  | `submitted#5 canvasArea:one\\ntwo`、`value` 未变 ✓                    |
| 4   | 点第 1 行左侧 / 文本中间                   | 光标落在该行                        | `caret 0` / `caret 2`（`ab` 之后）✓                                   |
| 5   | 点第 2 行左侧 / 中间                       | 光标落在第 2 行                     | `caret 3` / `caret 5` ✓                                               |
| 6   | 点第 3 行（空行）或更下方                  | 钳到最后一个逻辑行                  | `caret 3`（在 `cd` 行首，不是 0）✓                                    |
| 7   | 60 个字符的**一条**逻辑行（软换行成 2 行） | 点第 2 个**视觉**行要落回同一逻辑行 | 点第 1 视觉行 `caret 2`、点第 2 视觉行 `caret 46`（该行起点 44 + 2）✓ |

第 7 条是这条路径最容易错的地方：`placeCaretAt()` 用 `displayLines[index].text` + `line.x` 把"第几个视觉行"折算成逻辑偏移，软换行后仍然对得上。

### 5.3 `readOnly`（`canvasRo`）——第 88 轮的 V59

DOM 路径的只读由元素自己的 `readonly` 属性负责；Canvas 路径必须自己判。逐条实测（修前 → 修后）：

| #   | 操作                                    | 期望                             | 修前                         | 修后                                |
| --- | --------------------------------------- | -------------------------------- | ---------------------------- | ----------------------------------- |
| 1   | 点击 + 输入 `X` / `Backspace` / `Space` | 值不变                           | 值不变 ✓                     | 值不变 ✓                            |
| 2   | `Control+a`                             | 可以选中（浏览器也允许）         | `caret 0`、`selection 12` ✓  | 同 ✓                                |
| 3   | `Control+V`                             | 值不变                           | **`locked value` → `ZZZ`** ✗ | `locked value` ✓                    |
| 4   | `Control+X`                             | 值不变，剪切板的"复制那一半"照常 | **`locked value` → `''`** ✗  | 值不变、剪贴板得到 `locked value` ✓ |
| 5   | `Control+C`                             | 复制照常                         | 剪贴板 `locked value` ✓      | 同 ✓                                |
| 6   | `Delete` / `Enter`                      | 不变、不提交                     | 不变 ✓                       | 不变 ✓                              |
| 7   | `Home` / `ArrowRight`                   | 光标仍可移动（只读≠冻结）        | `caret 1` ✓                  | 同 ✓                                |
| 8   | 旁边可写字段的粘贴/剪切                 | 不受影响                         | ✓                            | ✓（回归）                           |

**根因**：`Ctrl+C/X/V` 不走 `handleKeyEvent()` 的按键分支，而是直接进 `cutSelection()` / `pasteClipboard()`，这两个函数漏了 `readOnly` 判断，最终写进 `applyEdit()` —— 于是"逐键判断"的写法人人记得，唯独剪贴板捷径漏了。**修法**：把权限判定收成 `canEditValue({ enabled, readOnly })`（`packages/widgets/src/text-edit.ts`，纯函数、有 Node 单测），在**唯一的编辑漏斗** `applyEdit()` 里判一次，`insertText()`/`deleteText()` 也改用它；`cutSelection()` 仍然先写剪贴板再删——所以"只读字段能复制"这条语义保留得和浏览器一致。

### 5.4 绘制：光标与选区真的画出来了吗

`caretIndex` 只是模型里的数字，**画没画**要另找证据。用两条独立证据（`?capture=1` 之后 `gl.readPixels` 读帧缓冲；以及 CDP 截图按像素比对）：

- **光标**：`value = 'abc'`、光标在 0 时，文本行左侧出现一条 2×20 的竖条（x 462–463，颜色就是 `theme.colors.text`）；`ArrowLeft` 走到末尾（index 3）时竖条出现在 `c` 之后（x ≈ 488，3 个字符 ≈ 26px）——**位置跟着模型走**。
- **闪烁**：对孤立的那一列连续采样 2.4s，开关时刻为 `23(on) → 286(off) → 786(on) → 1303(off) → 1786(on) → 2304(off)`，即**亮 500ms / 灭 500ms**（`CARET_BLINK_MS = 500`）✓。
- **选区**：`Control+a` 后文本带（x 460–492 / y 378–395）的平均色从 `[69,75,82]` 变成 `[75,92,123]`（蓝通道 +41），即真的铺了一层 `primary` 底色 ✓。

> 这两条只作为**一次性测量**记录：`scripts/visual-check.mjs` 每场景只截一张图，而光标是闪的，放进门禁会变成 flaky。**未进门禁 = 未持续验证**，这一条写在这里而不是假装它被持续守着。

### 5.5 触摸（CDP `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`）

| #   | 操作                         | 期望                   | 实测                                                    |
| --- | ---------------------------- | ---------------------- | ------------------------------------------------------- |
| 1   | 触摸点击 `canvas`（x = 470） | 聚焦 + 光标落在点处    | `focus = canvas`、`caret 1`（文本起点 462 + 8px/字符）✓ |
| 2   | 接着用键盘打字               | 打进被点中的字段       | `value 'abc' → 'ahellobc'`、`caret 6` ✓                 |
| 3   | 触摸点击文本中间（x = 480）  | 光标随点移动           | `caret 2` ✓                                             |
| 4   | 触摸点击 `canvasArea`        | 聚焦 + 落在第 1 视觉行 | `focus = canvasArea`、`caret 5` ✓                       |
| 5   | 触摸点击 DOM 桥字段 `name`   | 两种路径共存、互不干扰 | `focus = name` ✓                                        |

（软键盘是否弹出只能在真机上验；本轮只证明"触摸落点 → 聚焦 + 光标"这条链路。）

### 5.6 拖动选择：从"已知局限"变成"已实现"（V58，第 93 轮）

第 88 轮把这条写成了局限性：Canvas 路径**没有**任何指针选择（没有 `pointermove` 处理，双击也不选词），并注明"要补它得先有拖动归属协议，否则在可滚动页面里拖选会同时滚动页面"。第 93 轮把协议做出来了，实测矩阵见 [`ACCEPTANCE-options.md`](./ACCEPTANCE-options.md) §9（页面就是 `#/options`：那张卡本身长在一个滚动舞台里，A/B 两条边都能量）。

现在的行为：按下即**认领**这次拖动（`claimPointerDrag`），`pointermove` 期间按指针位置扩展选区，`pointerup`/失焦/销毁时释放；外层 `ScrollView` 在**真的要动之前**问一句"这次拖动有人认领吗"，有人就让出。第 93 轮同批补上了**双击选词与三击选行**（多行字段按被点到的那一行解析字符下标；第一版取错行，靠 `#/form` 的多行字段实测抓到并修掉）。矩阵见 `docs/ACCEPTANCE-options.md` §9。

### 5.7 走查时踩到的探针坑（不是产品缺陷）

第一次走查"点击 `canvas` 之后焦点变成 `none`"，看起来像焦点被抢；实际是**探针坐标过期**：`pt.*`/`#status` 是创建时采样一次，而加了 `canvasRo` 之后面板从 466px 长到 514px、整块上移 24px，于是「`canvas` 的中心」还是旧快照里的 `y = 387`，而真实矩形是 `345..381` —— 点在了空白处，焦点当然被释放。改用实时 `rect` 后，六个字段（含三个 Canvas 字段）逐个点击全部正常聚焦。

**纪律**：布局会变的页面必须逐帧发布 `pt.*`；本页布局在使用中不变，所以保留一次性采样，但**验收脚本里必须从实时 `rect` 取坐标**——这一条已写进 `docs/PITFALLS.md` §8.46。

## 6. 门禁

| 命令                            | 第 57 轮                                                          | 第 88 轮                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm -r run test`              | **1070** 通过（layout 313 / core 281 / phaser 146 / widgets 330） | **1276** 通过（core 281 / layout 313 / phaser 320 / widgets 362）                                                                                                                |
| `pnpm -r run typecheck`         | 5/5                                                               | 5/5                                                                                                                                                                              |
| `pnpm exec prettier --check .`  | 通过                                                              | 通过                                                                                                                                                                             |
| `pnpm docs:check`               | 通过                                                              | 通过                                                                                                                                                                             |
| `pnpm run build:examples`       | 通过                                                              | 通过                                                                                                                                                                             |
| `pnpm size`                     | 未记录                                                            | **26.9 KB** min+gzip（`phaser`+`widgets`，预算 45）✓                                                                                                                             |
| `node scripts/visual-check.mjs` | 未记录                                                            | 通过（几何 + 像素 + AX 树 + 每场景未知选项审计）✓                                                                                                                                |
| 22 场景扫场 + 泄漏门禁          | 未记录                                                            | 0 异常 / 0 警告 / 0 未知选项；`lifecycle` 101 轮逐项一致，`modal`/`pages`/`router`/`list`/`uiscene`/`showcase`/`keyboard` churn 前后相同，`#/scroll` 归 `{drag:null,bar:null}` ✓ |
