# 验收记录 · 开闭动效（`transition`，M8 收尾）

- **验收场**：[`#/modal`](../../apps/examples/src/scenes/modal.ts)（`window.modal.motion()` / `settle()` / `instant()` / `transition()` 暴露全部探针）与 [`#/config`](../../apps/examples/src/scenes/config.ts)（`window.config.motion()`，动效策略的取值与合并）
- **被测实现**：[`packages/phaser/src/transition.ts`](../../packages/phaser/src/transition.ts)（纯逻辑 + `TransitionRunner`）、[`packages/phaser/src/modal.ts`](../../packages/phaser/src/modal.ts) 的 `open`/`closeEntry`、[`packages/phaser/src/plugin.ts`](../../packages/phaser/src/plugin.ts) 的 `transitionFor()` 与 `PRE_UPDATE` 步进
- **本轮（第 74 轮）新增**：缓动表与 `resolveTransition`/`resolveTransitions`（策略解析）、`TransitionRunner`（逐帧、成组、抢占、取消）、`prefersReducedMotion()`、`MVVMPluginConfig.transition`、`ModalOptions.transition`、`this.mvvm.transitions` 与 `this.mvvm.transitionFor()`
- **验收方式**：Playwright MCP 真实鼠标 / 真实触摸（`Input.dispatchTouchEvent`）/ `prefers-reduced-motion` 仿真（`Emulation.setEmulatedMedia`）+ `node scripts/visual-check.mjs`（**46/46** 采样，新增「动效未落定不截图」的等待）
- **测试**：`packages/phaser/test/transition.test.ts`（**36** 条）+ `packages/phaser/test/plugin-config.test.ts`（**7** 条，新增：`mergePluginConfig` 从 `plugin.ts` 拆到无 Phaser 依赖的 `plugin-config.ts` 后第一次有单测）；全仓 `pnpm -r run test` = **1187 passed**（core 281 / layout 313 / phaser 252 / widgets 341）
- **体积**：min+gzip `core`+`layout` **18.5 KB**（预算 25）、`phaser`+`widgets` **23.7 KB**（预算 45，较上轮 22.0 增加 1.7）

---

## 1. 被测行为与判据

动效的难点不在「画得出淡入」，而在**它把「关闭」拆成了两件事**：交互上的关闭必须立刻生效，画面上的消失可以等一下。所以每条判据都分「语义」与「画面」两问，并且都要有 A/B 对照。

| #   | 行为           | 判据                                                                                                                               |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| T1  | 默认策略       | `motion.enter=160`（`outCubic`）、`motion.exit=120`（`inCubic`）；`prefers-reduced-motion` 未开时 `reduced=0`                      |
| T2  | 淡入曲线       | 打开后逐帧采样：`body`/`scrim` 的 alpha 单调升到 1、`scale` 从 0.96 升到 1，`pending` 结束时回到 0                                 |
| T3  | 首帧不是终态   | 打开后的**第一帧** alpha 必须已经接近 0（先应用起始帧），不允许先整帧全亮再淡入                                                    |
| T4  | 关闭立刻生效   | `close()` 当帧：`depth=0`、`handle.open=false`、焦点归还页面、`closes` 记下原因，而 `pending=2`（画面还在淡出）                    |
| T5  | 淡出曲线       | 关闭后逐帧采样：alpha 单调降到 0，约 `exit` 毫秒后控件被销毁（`motion.body=gone`、`widgets` 回基线）                               |
| T6  | 淡出期间挡点击 | 关闭后 `exit` 毫秒内点/触摸页面按钮坐标：`page.clicks` **不变**（图层还在树上，故意继续吞掉这一次点击）                            |
| T7  | 淡出后放行     | `settle()` 之后再点同一坐标：`page.clicks` +1（没有任何残留图层）                                                                  |
| T8  | 单对话框免动效 | `transition: false` 的对话框：开/关都 `pending=0`，关闭是同步销毁（`widgets` 当帧回基线）                                          |
| T9  | 运行时改策略   | `mvvm.configure({ transition: { enter: 400 } })` 立刻对**下一个**对话框生效，且不破坏未提及的选项                                  |
| T10 | 减少动效       | 仿真 `prefers-reduced-motion: reduce` 后：`reduced=1`、`enter=exit=0`，开/关都不再动；`respectReducedMotion: false` 可显式恢复动效 |
| T11 | 泄漏           | `churn(12)` 每一轮都在 `settle()` 之后采样，四类计数（`widgets`/`themeListeners`/`pointerTargets`/`focusables`）前后一致           |
| T12 | 不干扰既有语义 | 淡出期间的 `Esc` 不产生额外的 `closes`；淡出期间开新对话框：新对话框正常可交互、旧图层在下面淡完即销毁                             |
| T13 | 抢占           | 在淡入未结束时 `close()`：淡出**接管**同一批目标，曲线只下降（V40，见 §4）                                                         |
| T14 | 像素           | `node scripts/visual-check.mjs` 的 `modal` 场景在**动效落定之后**截图，暗/亮两套期望值 46/46 全过                                  |

---

## 2. 实测（第 74 轮，全部为本机实跑数字）

### T1 默认策略

`window.modal.motion()`（无对话框时）：`{ pending: 0, reduced: false, enter: 160, exit: 120, instant: false, body: null, scale: null, scrim: null }`。

### T2/T3 淡入曲线（逐帧 rAF 采样，先 `bringToFront()`）

`[t(ms), body, scale, scrim, pending]`：

```
[28, 0.28, 0.971, 0.28, 2]   [36, 0.505, 0.98, 0.505, 2]   [53, 0.675, 0.987, 0.675, 2]
[66, 0.802, 0.992, 0.802, 2] [82, 0.89, 0.996, 0.89, 2]     [98, 0.945, 0.998, 0.945, 2]
[116, 0.98, 0.999, 0.98, 2]  [131, 0.995, 1, 0.995, 2]      [232, 1, 1, 1, 0]
```

`outCubic` 的形状（先快后慢）与 `pending: 2 → 0`（遮罩 + 主体两个目标）都符合预期；`scale` 走在 0.96→1 上，且**只有主体缩放**（`scrim` 只动 alpha，否则整块舞台会朝左上角缩小）。

### T4/T5 关闭：语义立刻、画面延后

`window.modal.close()` 后逐帧：

```
[6, 0.997, 2] [23, 0.978, 2] [39, 0.928, 2] [56, 0.831, 2] [73, 0.667, 2] [90, 0.42, 2]
[206, gone, 0] ...            (widgets 30 → 22)
```

同一次关闭里：`depth` 立刻为 0、`closes` 立刻记下 `api`、`focus` 立刻回到页面控件（`popScope()` 与 `setCapture()` 都在当帧完成），而图层再活 `exit` 毫秒。

### T6/T7 淡出期间的点击（A/B，真实鼠标）

`pt.page.a = (81,261)`：

| 时刻                       | `page.clicks` | `pending` | `widgets` |
| -------------------------- | ------------- | --------- | --------- |
| 无对话框，直接点           | 0 → **1**     | 0         | 22        |
| 打开并落定                 | 1             | 0         | 30        |
| 关闭后 **5 ms** 点同一坐标 | **1（不变）** | 2         | 30        |
| `settle()` 之后读          | 1             | 0         | **22**    |
| `settle()` 之后再点        | 1 → **2**     | 0         | 22        |

触摸同样成立（`Input.dispatchTouchEvent`，一次验收只用一种输入设备）：

| 时刻                         | 结果                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| 无对话框点页面按钮           | `page.clicks` 0 → 1                                                |
| 打开并落定后点遮罩（同坐标） | `reasons=[api, backdrop]`、`depth=0`、`pending=2`、`page.clicks=1` |
| 淡出期间**再点一次**         | `pending=2`、`page.clicks=1`（被吞）、`reasons` 不新增             |
| `settle()` 之后点            | `page.clicks=2`、`widgets=22`、`pending=0`                         |

「关闭后那 `exit` 毫秒里点击被吞掉」是**有意**的：刚被关掉的对话框不能把同一次点按转给下面的按钮，否则一次触摸会同时「关弹窗 + 触发下面的按钮」。

### T8 单对话框免动效

`window.modal.instant(true)` → `open('confirm')`：`afterOpen = { pending: 0, body: 1, scale: 1, scrim: 1 }`（没有任何过渡帧）；`close()` 后 `body=gone`、`widgets=22` 当帧回基线 —— 即「不动效」就是第 60 轮那条同步路径，一帧不差。

### T9 运行时策略

`window.modal.transition({ enter: { duration: 400, easing: 'linear' } })` 的返回与随后打开的对话框：

```
patch = { enter: 400, exit: 120 }      // 只提 enter，exit 保持
下一个对话框 motion.enter = 400
打开后首帧 body = 0                    // 起始帧已应用
restored = { enter: 160, exit: 120 }   // 再 configure 回来
```

### T10 减少动效（`Emulation.setEmulatedMedia`）

```
未仿真:      reduced=false  enter=160
simulate reduce: matchMedia=true  policy{ reduced:true, enter:0, exit:0 }
  open  → pending=0, body=1, widgets=30（当帧就是终态）
  close → pending=0, body=gone, widgets=22（当帧销毁，无幽灵）
respectReducedMotion:false → reduced=false, enter=160, 打开后 pending=2、body=0（动效回来了）
恢复 respectReducedMotion:true + 取消仿真 → matchMedia=false, enter=160
```

### T11 泄漏门禁

```
churn(12) before { widgets: 22, themeListeners: 23, pointerTargets: 10, focusables: 7 }
          after  { widgets: 22, themeListeners: 23, pointerTargets: 10, focusables: 7 }
churn 之后 motion.pending = 0
```

`churn()` 现在是 **async**：每开关一轮都 `await settle()`，所以门禁强度不变（每一轮都要落在同一组数字上），并且顺带证明了「动画不会留下任何东西」。`counts.widgets` 改成从 **UI 根**开始数（原来是「页面的控件数 + `modal.depth`」）——否则一个还在淡出的图层会被算成「干净」，门禁就看不见幽灵了。

### T12 不干扰既有语义

- 淡出期间按两次 `Esc`：`depth=0`、`closes` 不新增（`reasons` 仍以 `api` 结尾）、`focus=none`、无 ERROR。已关闭的图层不再吃 `back`。
- 淡出期间开新对话框：`ghost pending=4`（旧图层 2 + 新图层进场 2）→ 新对话框 `depth=1`、`top=modal.form`、`focusables=3`（陷阱生效）→ `settle()` 后 `pending=0`、`widgets=30`。

### T15 策略取值与合并（`#/config`）

`window.config.motion()` 读的就是 `this.mvvm.transitionFor()`（`modal.open()` 用的同一个入口）：

```
初始（只有游戏级默认值）        { enter: 160, exit: 120, reduced: false }
patch({ transition: { exit: 0 } })   → { enter: 160, exit: 0 }        // 子选项包深合并，enter 不被清掉
patch({ transition: { enter: 250 } }) → { enter: 250, exit: 0 }
patch({ focus: { wrap: false }, input: { dragThreshold: 14 } })       // 打在别的包上
                                      → 动效仍 { enter: 250, exit: 0 }，dragThreshold 8 → 14
patch({ transition: false })          → { enter: 0, exit: 0 }
恢复                                   → { enter: 160, exit: 120 }
```

`#demo-state` 逐帧发布 `motion.enter` / `motion.exit` / `motion.reduced`，所以这一页也能被脚本按帧读。

### T14 像素与回归

- `node scripts/visual-check.mjs`：**46/46** 采样通过（`modal` 场景的 `confirm.ok=#f85149`/`#cf222e`、`confirm.cancel=#161b22`/`#ffffff` 等）。
- 脚本新增一步「等动效落定」（`scene.mvvm.transitions.pending === 0`，5 s 超时）：不这么做，`SCENE_SETUP` 打开对话框后立刻截图会采到动画中间帧（遮罩 30% 不透明度、危险色与背景混色），期望值会随机失败。这是**采样时机**的修正，不是放宽期望值。
- 其它页面的泄漏门禁复跑：`#/pages churn(10)` 前后一致（24/26/19/18）、`#/uiscene swap(20)` 前后一致（22/24/1/7/11/7）、`#/lifecycle churn(3)` 四轮完全相同（`tweens: 0`、`timers: 0` —— 动效走自己的逐帧步进，不产生 Phaser tween，所以这条门禁不受影响）、`#/list churn(20)` 第二、三次调用完全相同（第一次冷启动会把 `Repeat` 的复用 filler 池化出来：`themeListeners` 91→92，[`ACCEPTANCE-list.md`](./ACCEPTANCE-list.md) §3 已记录，非本轮引入）。

---

## 3. 单元测试（Node，无渲染器）

`packages/phaser/test/transition.test.ts`，36 条：缓动（端点/单调/形状）、`resolveTransition`（默认值合并、裸时长、`false`、零时长仍保留终态、负数与非有限值拒绝、只动提到的属性）、`resolveTransitions`（策略 × 逐层覆盖 × 减少动效）、`prefersReducedMotion`（无 `window`、`matchMedia` 抛错）、`progressOf`（窗口内外的钳制、`delay`）、`TransitionRunner`（首帧即起始帧、插值到终值、`false` 不回调、`'base'` 端点恢复非 1 的 alpha、成组一次回调、最慢成员决定结束、目标被销毁时不回调、拒绝在已销毁目标上开始、取消、抢占、非法 delta、`clear()`）。

`plugin-config.test.ts` 覆盖 `mergePluginConfig`：每个子选项包（`input`/`focus`/`a11y`/`layout`/`transition`）分别合并而不是整体替换、`false` 关掉再被一个包补丁打开、两个参数都不被改动、连续补丁满足结合律、以及"两边都没提的包不会被凭空造出来"。这条规则**类型系统管不了**（漏一个包照样编译，症状是"改 `focus` 清掉了 `input`"），所以它值得有单测——这也是把这个纯函数从 `plugin.ts`（模块级 `import Phaser`）拆到 `plugin-config.ts` 的原因。

`TransitionTarget` 是**结构化接口**（`alpha`/`scaleX`/`scaleY`/`setAlpha`/`setScale`），测试里用一个三行的假对象即可，所以整套时序模型都在 CI 里跑，不需要渲染器 —— 与 `reveal.ts`/`back-plan.ts` 同一种做法。

---

## 4. 本轮修复的缺陷：V40 · 关闭时进场与出场两套动画互相打架

**现象（真实可达）**：在开场动画还没播完时关闭对话框（用户按 `Esc` 快、或代码里 `open()` 紧跟 `close()`，例如 `churn`），对话框会**先淡回来再消失**：采样到 `pending=4`、关闭中 `body=0.262` 且数值在上升。

**根因**：进场与出场是**两批 run 写同一批属性**（`layer` 的 alpha、`body` 的 alpha/scale）。`TransitionRunner.step()` 从数组尾部往前遍历，于是**先**应用出场的值、**再**被进场的 run 覆盖——最终画面由更早启动的那次动画决定。两次 `runGroup` 各自独立完成回调，所以「销毁」最终还是发生了，只是画面在关闭过程中反向播放。

**修法**：`start()` 里先 `this.cancel(target)` —— **一个目标同时只有一个 run，后来者接管**。这同时给「取消」一个明确语义：`runGroup` 里最后一个成员停止（无论是播完、被接管还是被取消）就是这一组结束，回调照常触发，因此被延后的销毁不会因为一次取消而永远等下去。

**证据**：

- 修复前（把 `this.cancel(target)` 注释掉，仅作证据，已还原）：`pnpm --filter @phaser-mvvm/phaser run test` → `transition.test.ts` 有 **2 条失败**（`lets the newest run take a target over instead of fighting it`、`completes a group whose member was taken over by a newer run`），其余 243 条通过。
- 修复后：同一场景在浏览器里逐帧采样 —— 淡入到 `body=0.302` 时关闭，之后**只下降**（`0.296 → 0.25 → 0.127 → gone`），约 147 ms 销毁，`depth=0`、`pending=0`、`widgets=22`。

---

## 5. 未覆盖 / 有意不做

- **页面栈的转场**（`pages.push/pop` 的滑动/淡入）与 `Branch()` 分支切换的转场：`TransitionRunner` 是通用件，但两者的目标都不止一层（整页替换、被覆盖页仍在树上），语义要单独设计，本轮不做，也不假装做了。
- **主题里的动效时长令牌**：PLAN §4 的令牌清单里有「动效时长」，目前时长写在 `DEFAULT_ENTER`/`DEFAULT_EXIT` 与 `transition` 选项里；等 `#/theme` 令牌体系铺开时再挂过去（否则就是两个真相）。
- **真机（iOS Safari / Android Chrome）验证**：`prefers-reduced-motion` 用 CDP 仿真验证，系统级开关的真机行为未测；触摸路径用了 CDP 触摸域（等效于上一轮 `ACCEPTANCE-touch.md` 的做法）。
- **`delay` 与 `fromScale/toScale` 的浏览器实测**：单测覆盖（`progressOf` 的 delay、"scale 端点"），浏览器只跑了默认策略与 `enter: 400` 的变体，没有为每个参数各开一页。
- **画布被缩放（`?fit=`）下的动效**：动效只改 alpha/scale，与设计像素换算无关，未在 `FIT` 下单独跑一遍。
