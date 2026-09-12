# 验收记录 · 表单页状态机（`#/form`，第 57 轮）

> 背景：`#/form` 是文本框/表单能力的**综合**演示页（`TextField` + `TextArea` + 校验 + 提交），但此前的验收只做过「页面能加载、不报错」。这一轮把它做成可断言的验收页——补上 `st.*` 探针与 `window.form` API，然后用真实鼠标/键盘/触摸跑一遍状态机（objective：每个控件都要有 demo，且要验证**各种情况**下的状态）。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，页面 `bringToFront()`。

---

## 1. 本轮补的观测能力

| 通道          | 内容                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#demo-state` | `st.name` / `st.email` / `st.notes` / `st.submit`（逐帧 `visualState`）、`name.length`、`notes.breaks`、`email.valid`、`hint`、`nameError`/`emailError`/`notesError`（失焦时写入）、`focus`、`submitted` |
| `window.form` | `values()`、`errors()`、`states()`、`focus()`、`submitted()`                                                                                                                                             |

（自由文本带空格时不要按空格切分 `#demo-state`，走 `window.form.values()`——本文件里的读数都是这么取的。）

## 2. 状态机实测

| #   | 操作                     | 期望                 | 实测                                                                        |
| --- | ------------------------ | -------------------- | --------------------------------------------------------------------------- |
| 1   | 打开页面                 | `name` 自动聚焦      | `states = { name: focused, … }`、`focus = name` ✓                           |
| 2   | name 输入 1 个字符后失焦 | 校验失败             | `errors().name = 'at least 2 characters'` ✓                                 |
| 3   | 补到 ≥2 字符再失焦       | 错误清除             | `errors().name = null`、值 `ada` ✓                                          |
| 4   | email 输入 `nope`        | 派生状态跟着变       | `email.valid = false`、`hint = 'enter a valid email address'` ✓             |
| 5   | email 失焦               | 报错                 | `errors().email = 'invalid email'` ✓                                        |
| 6   | email 改成合法地址再失焦 | 错误清除             | `errors().email = null`、`email.valid = true`、`hint = 'ready to submit'` ✓ |
| 7   | name 输入 30 个字符      | `maxLength: 24` 生效 | `name.length = 24` ✓                                                        |
| 8   | notes 输入两行           | `Enter` 是换行       | `notes.breaks = 1` ✓                                                        |
| 9   | notes 里 `Ctrl+Enter`    | 提交                 | `submitted = 'submitted: ada / ada@example.com'` ✓（本轮修，见 §3）         |
| 10  | 单行字段里 `Enter`       | 提交                 | 同上 ✓                                                                      |
| 11  | 触摸点击 email 后输入    | 聚焦并输入           | `focus = email`、值 `touch@example.com` ✓（DOM 桥路径）                     |
| 12  | 点击 Submit 按钮         | 提交                 | 与 9/10 同一实现（按钮与 Enter 共用 `submitFromNotes()`）✓                  |

## 3. 本轮修的问题：演示页承诺了没有人处理的手势

notes 的 placeholder 写着「Enter adds a line, Ctrl/Cmd+Enter submits」，但页面**只订阅了 `change`**，没有任何 `submit` 订阅——于是 `Ctrl+Enter` 什么都不发生。框架侧是对的（`TextArea.submitsOnEnter()` 在 `ctrlKey/metaKey` 时返回 `true`，`submit()` 会 emit `TEXT_INPUT_EVENTS.SUBMIT`），缺的是**页面自己的接线**。

修法：把三个字段的 `SUBMIT` 事件都接到同一个 `submitFromNotes()`（Submit 按钮也复用它），于是 placeholder 的说法成立、按钮与键盘两条路径行为一致。

> 这一类「文档/演示承诺 > 实现」的缺口，过去几轮出现过多次（`List({ gap })`、`focusOrder`、`hideMode`、本轮的 placeholder），已统一记在 `docs/DEFECT-BACKLOG.md` 的 V13/V16 与文档待办里。

## 4. 门禁

| 命令                           | 结果                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm -r run test`             | **1070** 通过（layout 313 / core 281 / phaser 146 / widgets 330） |
| `pnpm -r run typecheck`        | 5/5                                                               |
| `pnpm exec prettier --check .` | 通过                                                              |
| `pnpm docs:check`              | 通过                                                              |
| `pnpm run build:examples`      | 通过                                                              |
