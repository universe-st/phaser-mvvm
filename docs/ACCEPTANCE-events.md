# 验收记录 · 指针事件链（`#/events`，第 107 轮）

对应决策：[ADR-0010](./adr/0010-pointer-event-chain.md)｜常驻场景：`apps/examples/src/scenes/events.ts`｜单测：`packages/phaser/test/pointer-chain.test.ts`

## 1. 场景结构（五层嵌套）

```
UIRoot → page(horizontal) ─┬─ l1 → l2 → l3 → l4 → leaf(Button, name='leaf')
                           └─ controls(竖排按钮 + 两块定高读数)
```

每一层（`l1`…`l4`）都同时挂两个钩子：`onPointerIntercept`（拦截）与 `onPointerEvent`（处理）；叶子是唯一会「激活」的控件（`clicks` 计数）。`window.chain` 提供：

| 探针                                               | 读数                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `state()`                                          | `consume`/`intercept`/`threshold`/`disallow`/`clicks`/`traces`/`moves`/`cancels`/`chains`/`last` |
| `last()`                                           | 最近一次分发压成一行：`phase:node.action0>`…`\|stop`（`!` = 因拒绝拦截而未询问）                 |
| `deliveries()`                                     | **投递台账**：`节点.问题.阶段 = 次数`（`l2.intercept.down`、`leaf.up`、`leaf.cancel`…）          |
| `log()` / `clearLog()`                             | 最近 60 条分发行                                                                                 |
| `points()` / `point(name)`                         | 各节点的实时页面坐标（点击用）                                                                   |
| `setConsume/setIntercept/setThreshold/setDisallow` | 逐项配置                                                                                         |
| `cancelGesture()` / `reset()` / `counts()`         | 外部 cancel、清零、计数                                                                          |

`#demo-state` 逐帧发布 `chain.count`/`chain.owner`/`chain.hit`/`chain.path`/`chain.stop`/`chain.entries`/`chain.moves`/`chain.cancels`/`chain.clicks`/`chain.ledger` 与每个节点的 `pt.*`/`st.*`。

> **探针漂移的坑（本轮真实踩到）**：两块读数标签最初没有固定高度，台账从 1 行长到 4 行时页面高了 34px，根部 `stack` 居中所致整体上移 —— 于是「先读坐标、再按下去」的那一下按到了 `l4` 上，看起来像框架缺陷。给两块标签加 `height`（`64`/`48`）后消失。这与 §8.47 是同一条纪律：**会随使用变化的页面，探针必须实时读**。

## 2. 单测（`pnpm --filter @phaser-mvvm/phaser run test`）

`pointer-chain.test.ts` 30 条，覆盖：最深优先与「没有钩子 ≠ 拒绝」、逐级冒泡、祖先拦截后更深节点**一次都不被调用**、拦截者不处理时继续冒泡、深度与 `inside` 的算法、保留链上的 `move`（含指针已离开盒子）、`move` 不重新命中测试、`up` 后清链、冒泡换拥有者、**手势中途拦截**（旧拥有者收到 `cancel`、拦截者接手）、`cancelReason` 指名、**disallow**（钩子不被调用且 trace 标 `disallowed`）、多指互不干扰、未知指针/拥有者离开树、`cancelAll`、以及「同一次分发共用同一个事件对象」的契约。

实测：**23 个测试文件 / 370 条全部通过**（`packages/phaser`；全仓 `pnpm test` 为 1352 条）。

## 3. 浏览器矩阵（真实鼠标，Playwright MCP，`http://localhost:5173/#/events`）

| #   | 配置                                        | 动作                           | 实测读数                                                                                                                                                           | 结论                                                                               |
| --- | ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| A   | 全默认（无任何钩子生效）                    | 点叶子                         | `last = down:l1.intercept0>l2.intercept0>l3.intercept0>l4.intercept0>leaf.handle0>l4.handle0>l3.handle0>l2.handle0>l1.handle0\|declined`；`clicks=1`               | 链是**加法**：没人消费时点击机器照常                                               |
| B   | `consume.leaf`                              | 按下 + 抬起                    | `down: …>leaf.handle1\|handled`；台账有 `leaf.down`/`leaf.up`；`clicks=0`                                                                                          | 消费 = 自己处理：手势归叶子，**不再算点击**                                        |
| C   | `intercept.l2`（立即拦截，且 l2 不处理）    | 按下 + 抬起                    | `down:l1.intercept0>l2.intercept1>l2.handle0>l1.handle0\|intercepted`；台账**没有** `l3`/`l4`/`leaf` 条目；`clicks=0`                                              | 被拦截的按下**连「按下」都不算**（修前 `clicks=1`）                                |
| D   | `consume.leaf`                              | 按下 → 拖到 (+300,+200) → 抬手 | `chains[0] = { owner: leaf, path: [UIRoot,page,l1,l2,l3,l4,leaf] }`；`moves=12`、台账 `leaf.move=12`；`last = up: …>leaf.handle1\|handled`，且 `leaf:outside.up=1` | 拖出盒子/离开控件后**事件照样送达**（`inside=false`），抬手也送达                  |
| E   | `consume.leaf` + `disallow`                 | 按下 → 拖 120px                | `move:l1.intercept!>l2.intercept!>l3.intercept!>l4.intercept!>leaf.handle1\|handled`；台账**没有**任何 `l*.intercept.move`；`leaf.move=8`                          | 子控件的拒绝拦截真的抑制了全部祖先（Android `requestDisallowInterceptTouchEvent`） |
| F   | `consume.leaf` + `intercept.l2` + 阈值 20px | 按下 → 拖 60px                 | 按下时 `l2.intercept0`（位移不够）；越过 20px 的那一次：`l2.intercept1` + `leaf.cancel`（`cancelReason = intercepted by l2`），拥有者变 `l2`，`up` 归 `l2`         | **手势中途易主**：旧拥有者被告知，新拥有者接管                                     |
| G   | `consume.leaf`                              | 按下 → `cancelGesture()`       | `cancel:leaf.cancel1\|cancelled`；`chains=[]`；`clicks=0`                                                                                                          | 外部（场景切换、模态打开）能结束手势并通知拥有者                                   |

A–G 每一步都另读 `#demo-state` 的 `st.leaf`/`chain.*`，`st.*` 的迁移与预期一致（按下 `pressed`、抬起后 `hover`）。

## 3.1 触摸路径（CDP `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`，§8.40 的姿势）

`#demo-state` 的 `chain.kind` / `chain.activeKind` 说明这次手势来自哪种设备（`PointerChainEvent.kind` 来自 `pointer.wasTouch`）。

| #   | 配置                          | 动作                                                   | 实测读数                                                                                                                                                                      | 结论                                               |
| --- | ----------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| T1  | 全默认                        | 单指轻点叶子                                           | 按住时 `st.leaf=pressed`；抬手 `clicks=1`；`chain.kind=touch`                                                                                                                 | 触摸的**点击路径**照常（链没有把触摸吃掉）         |
| T2  | `consume.leaf`                | 单指按下 → 拖 200px 出画布外 → 抬起                    | 拖动中 `chains[0] = { pointerId: 1, kind: 'touch', owner: leaf, path: […,leaf] }`、`moves=4`、台账 `leaf.move=4`；抬手 `up:…>leaf.handle1` 且 `leaf:outside.up=1`，`clicks=0` | 触摸拖动同样**跟人不跟盒子**；消费照样抑制点击     |
| T3  | `consume.leaf` + `consume.l1` | 两指同时按下（一指在叶子、一指在 `l1` 区域），先后抬起 | 两指时 `chains` 有**两条**独立手势：`{pointerId:1, owner:leaf}` 与 `{pointerId:2, owner:l1, hitTarget:l4}`；抬起第一指后只剩第二指那条；两指都抬起后 `chains=[]`              | 一个指针 id = 一次手势：多指互不干扰、各自独立结束 |

> 触摸与鼠标**不要在同一次验收里混用**（一次手势会变成两个指针，§8.40）；上面每个用例都在新建的页面上下文里只跑一种设备。

## 4. 回归（真实指针 / 键盘，同一浏览器会话）

| 场景         | 动作                                                                                          | 实测读数                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `#/showcase` | `showAndReport('buttons')` → 按住 `buttons.toggle`                                            | 按住瞬间 `st.buttons.toggle=pressed`；抬起 `clicks=1 toggled=true focus=toggleButton`                                |
| `#/states`   | `reveal('slider.volume')` → 悬停/按下/抬起                                                    | `st` 迁移 `hover→pressed→focused→hover`；`events(): activated [slider.volume@pointer]`                               |
| `#/gallery`  | 点 `primary`                                                                                  | `st.primary=hover`，`focusables` 八个名字齐全                                                                        |
| `#/modal`    | 点 `page.a` → 开 `confirm` → 同一点再点                                                       | 第一次 `pageClicks=1`；开框后同一点**不增**（`pageClicks=1`、`worldClicks=0`）且关闭原因是 `backdrop`（V9 语义保持） |
| `#/pages`    | 点 `row.1` → 点详情页返回                                                                     | `depth 1→2→1`，`names [list] → [list, detail:1] → [list]`，返回后 `clicks=0 field=''`                                |
| `#/hud`      | `scroll(260,140)` → 点 `pt.score`                                                             | `clicks=1 world.clicks=0 focus=hud.scoreButton`（相机钉住的命中保持）                                                |
| `#/form`     | 点 name 输入 → 点 email 输入 → 点提交                                                         | `values {name:'round 107', email:'a@b.co'}`、`submits=1`、`focus=submit`                                             |
| `#/scroll`   | 垂直口内上拖 140px                                                                            | `v 0 → 161.79`，`visibleRowKey=r004`，`owners drag=null`（空闲必须是 none，V24）                                     |
| `#/list`     | `scrollRows(3)` → 点可见行                                                                    | `offset 0→114`、`created 14→17`；点击后 `deleted=1 total=219`                                                        |
| `#/keyboard` | 点 `kb.q`                                                                                     | 按住 `focus=keyboard.q`；抬起 `value='q'`                                                                            |
| `#/bindings` | 点 `add`                                                                                      | `count=1 focus=add`                                                                                                  |
| `#/router`   | 点 `home.user.1` → `back()`                                                                   | `path home→user/1→home`，`params {id:'1'}`，返回后焦点回到 `home.user.1`                                             |
| `#/uiscene`  | 点 `show.b`                                                                                   | `view=b swaps=1 previousDestroyed=true`                                                                              |
| 22 个场景    | 冷启动（含 `m0`/`probe`/`stack`/`dashboard`/`compose`/`options`/`config`/`a11y`/`lifecycle`） | 画布就绪、`#status` 与 `#demo-state` 有内容、**console 无 error / pageerror**                                        |

## 5. 像素 / 几何 / 可访问性树门禁（`node scripts/visual-check.mjs`）

本场景已接进仓库的常驻像素门禁（`scripts/visual-check.mjs` 的场景列表 + `SCENE_SETUP.events` + 明暗两张期望表）：

```
$ node scripts/visual-check.mjs          # 构建 + 无头 Chrome（1280×720）逐场景
[visual-check] status for events:
scene=events renderer=webgl size=1280x720 dpr=1
events.page=@316,39 648x642 / events.leaf=@400,235 126x36 / events.l2=@352,103 222x214 …
OK       canvas.clear: #0d1117 at (4,4)
OK       events.l2: #f85149 at (363,210)
OK       events.leaf: #2f6feb at (405,253)
OK       events.l2: #cf222e at (363,210)      # 亮色半场
OK       events.leaf: #0969da at (405,253)
[visual-check] ok
```

- `SCENE_SETUP.events` 在截图前把 `l2` 的拦截**在运行期打开**（`window.chain.setIntercept("l2", true)`），于是 `events.l2` 采样到「会抢走手势的那一层被画成 `danger`」（`#f85149` / `#cf222e`，采在它自己的内边距上），而叶子仍然必须是 `primary`（`#2f6feb` / `#0969da`，采在按钮左内边距——它的文字几乎占满按钮，取 `fx: 0.12` 会读到字形，这正是第一次跑出来的 `#f4f8fe`）。
- **阳性对照**（把 setup 换成 `void 0` 再跑）：`MISMATCH events.l2: expected #f85149 got #1f2630`（亮色 `expected #cf222e got #eef1f4`）→ `2 check(s) failed`，而 `events.leaf` 仍然 OK——所以这条门禁真的在测「状态到达了绘制」，不是两个颜色恰好都对。
- **整轮结果**：场景 13 个（新增 `events`）、`OK` 96 项、`MISMATCH` 0、4 张可访问性树断言全过（`modal` 2 / `a11y` 14 / `keyboard` 38 / `pages` 3 个控制节点，无重复）。

### 5.1 仍未覆盖的

- `#/events` **没有** `AX_EXPECTATIONS` 条目：这一页的验收对象是事件投递，不是无障碍镜像；镜像代码本轮未改动，`modal`/`pages`/`a11y`/`keyboard` 四张树断言仍在门禁里跑。
- 像素门禁只覆盖「链的页面画对了」；链的语义（投递顺序、拦截、cancel、disallow）由 §2 的单测与 §3/§3.1 的真机矩阵负责——两者互补，谁都替代不了谁。
- `pnpm build` / `pnpm size` 通过：`core + layout` min+gzip **18.6 KB**（预算 25）、`phaser + widgets` **31.3 KB**（预算 45）——均有余量；本例新增的 `pointer-chain.ts` 单独量是 **1.6 KB min+gzip**（`esbuild --bundle --minify --external:phaser | gzip -9`），所以 `phaser + widgets` 的读数远高于 AGENTS §6 记的 14.7 KB 不是本轮的增量（那条数字早已滞后，见 §8.41）。`pnpm build:examples`：`dist/assets/index-*.js` 1.82 MB / gzip 483 kB。
- `pnpm docs:check` 全绿（含 vocabulary 与 idiom）；`check-doc-options.mjs` 195 个键全部被对应包接受。
