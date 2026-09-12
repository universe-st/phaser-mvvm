# 已知易踩的坑（AGENTS §8 的完整说明）

> 这是 [`AGENTS.md`](./AGENTS.md) §8 的完整版本：每条都保留「现象 → 根因 → 修法 → 实测数字」。AGENTS.md 只留一行索引，因为它已经超出工作区指令预算（第 85 轮：66 KB → 46 KB）。
> 索引里的编号与本文件的 `§8.n` 一一对应。

## 8.1 开发期包入口指向源码

**开发期包入口指向源码**：`packages/*` 的 `exports` 中 `types`/`import` 指向 `src/index.ts`，只有 `require` 指向 `dist/index.cjs`。因此改源码在 dev 里立即生效，但 CJS 消费方需要先 `build`；**永远不要手改 `dist/`**（生成物且被 gitignore）。

## 8.2 `dist/`、`.tmp/`、`coverage/`、`test-results/` 都是生成物

**`dist/`、`.tmp/`、`coverage/`、`test-results/` 都是生成物**，已 gitignore；验收截图、日志、临时脚本请放 `.tmp/`。

## 8.3 布局缓存按 (约束, 百分比基准, revision) 命中

**布局缓存按 (约束, 百分比基准, revision) 命中**：忘记 `markDirty()`/`invalidate()` 会表现为「UI 不更新」而不是报错；调试布局时优先看 `LayoutEngine#stats`（`measureCalls`/`cacheHits`/`skippedSubtrees` 等计数器）。基准进键是必须的：同一个约束在不同包含块下解析百分比会得到不同答案。

## 8.4 选项审计：拼错的选项会被指名

**选项审计：拼错的选项会被指名**（第 83 轮）：`splitOptions()` 是**唯一**的选项漏斗（容器直接进来、叶子控件经 `splitWidgetOptions()` 进来），它在开发模式下检查每个键是否属于「布局参数 / 该控件的键 / 基类键」，不属于就 `warn()`：`unknown option "pading" on "kb.page" — it is ignored. Did you mean "padding"?`（纯逻辑在 `packages/phaser/src/option-keys.ts`，建议匹配走大小写/包含/编辑距离，并列时**不给建议**；发布模式零输出）。**给控件加选项时把它加进该控件的 `*_KEYS` 列表**——漏了会让用户看到假警告；布局参数名单是 `@phaser-mvvm/layout` 的 `LAYOUT_PARAM_KEYS`（`keyof LayoutParams`，写错编译不过）。两道门禁：`scripts/visual-check.mjs` 对每个场景收集 `Runtime.consoleAPICalled` 里的 `unknown option` 并失败，同时用 `#/compose` 的 `window.compose.typo()` 做**阳性对照**（必须真的报出 `pading` → `padding`，否则门禁是死的）；全示例走查（21 场景 + `#/showcase` 的 `showAll()` + `#/compose` 全分区）必须零未知键警告，这同时是键表完整性的门禁。矩阵见 [`ACCEPTANCE-options.md`](./docs/ACCEPTANCE-options.md)。

## 8.5 调试日志

**调试日志**：开发模式下框架会打印 `[phaser-mvvm]` 前缀的轨迹——建树/挂载/焦点（`ui()`、`render()`、`mount`、`focus`、`shutdown`）、慢布局趟（测量 ≥ 200 节点或 ≥ 2 ms）、**激活**（`activate: <name> (<source>)`，鼠标/键盘/手柄同一行）、**虚拟化窗口**（`repeat: window [start, end) of N - mounted M`）、**滚动被钳制**（`scroll: clamped (x, y) -> (nx, ny)`）。`setDevMode(false)` 之后一行不打（`packages/core/test/dev.test.ts` 有用例钉住，另见 [`ACCEPTANCE-devtrace.md`](./docs/ACCEPTANCE-devtrace.md)：开发模式下点一次按钮 8 行、关掉后同样操作 0 行，而功能不受影响）。阈值在 `packages/phaser/src/UIRoot.ts` 顶部；浏览器里用示例应用暴露的 `window.mvvmDev.setDevMode(false)` 就能当场验证。改动日志时保持两条纪律：**低频路径也要 `if (isDevMode())` 包住插值**、**发布模式零输出**。

## 8.6 性能/体积预算怎么跑

**性能/体积预算怎么跑**：`pnpm --filter @phaser-mvvm/layout run test`（含 `test/perf.test.ts`：1000 节点耗时、无变化帧、缓存命中率、单节点编辑增量性、对象池稳定性）与 `pnpm size`（`scripts/size-check.mjs`，按 min+gzip 判定 core+layout < 25 KB、phaser+widgets < 45 KB，同时打印未压缩 gzip）。改动布局引擎、控件度量或新增控件后请跑这两个。

## 8.7 起了后台服务就一定要确认收尾

**起了后台服务就一定要确认收尾**：`spawn('pnpm', …, { detached: true })` + `process.kill(-pid)` 才能带走真正的子进程；只 `child.kill()` 会留下占着端口的僵尸（V31 的五个僵尸就是这么攒出来的）。收尾后请 `lsof -ti :<port>` 确认。

## 8.8 本机没有 `timeout` 命令

**本机没有 `timeout` 命令**（macOS）；长命令用后台任务而不是 `timeout` 包裹。

## 8.9 Playwright MCP 的页面默认 rAF 被节流到 1 fps（必须在断言前 `page.bringToFront()`）

**Playwright MCP 的页面默认 rAF 被节流到 1 fps（必须在断言前 `page.bringToFront()`）**：Chromium 会把你没有激活的窗口判为遮挡并节流 `requestAnimationFrame`，而 `document.visibilityState` **仍然报 `'visible'`**，所以从页面上看不出来。实测：同一页面空闲测 12 帧得到 `[808,1017,1000,1017,1000,…]`，`page.bringToFront()` 之后立刻变成 `[12,17,17,17,17,16,…]`。**任何帧率/耗时/时序断言（含"某状态多久后才消失"）都必须先 `bringToFront()`**，否则结论会和节流周期（1 s）混在一起——第 39 轮就是这样误报了一个"滚动卡住 1.6 s"的缺陷（V10，已撤销）。`#demo-state` 由场景 `update()` 写入，被节流时也会看起来"落后约 1 秒"；对时序敏感时请读场景 API（如 `window.scrollDemo.offsets()`）。

## 8.10 `back`（`Esc` / 手柄 B）的归属是逐层路由的

**`back`（`Esc` / 手柄 B）的归属是逐层路由的**：`planBack()`（`packages/phaser/src/back-plan.ts`，纯函数 + Node 单测）决定顺序——**模态 → 页面 → 场景（`UIScene.onBack()`）→ 应用**，`dismissible: false` 的对话框会**吞掉**这个键。应用级处理写 `this.mvvm.onBack`；**不要写 `this.mvvm.focus.onBack`**（那是插件安装路由钩子的地方，覆盖它 `Esc` 就再也关不掉对话框/返回不了上一页；开发模式下框架每帧恒等比较一次并打印指名警告）。

## 8.11 Phaser 的键盘管理器会丢弃 `defaultPrevented` 的按键

**Phaser 的键盘管理器会丢弃 `defaultPrevented` 的按键**（`KeyboardManager.js:188`：`if (event.defaultPrevented …) return;`），而且 `KeyboardPlugin.update()` 在**每个**输入事件上重走一遍队列、只跳过**相邻**的重复事件。两条加起来就是第 60 轮的 V17（输入框 `preventDefault()` 掉 `Tab`，于是场景插件永远收不到）与 V18（`Shift+Tab` 同帧两个 keydown，`Tab` 被派发 2–3 次，一次按键走两三步）。**在 `packages/phaser` 之外自己挂 `keydown` 监听时务必知道这两点**：需要自己消费的键就自己转交 `FocusManager.handleAction()`，不要指望插件还能收到。

## 8.12 虚拟化列表里的"可见"有两层

**虚拟化列表里的"可见"有两层**：窗口挂载的行可能落在视口外（`overscan`），而那些行**不可点**（裁剪，V23）。写探针时要么用视口感知的坐标（`#/list` 的 `listDemo.point()` 只在行位于视口内时给坐标），要么像 `deletePoint()` 那样先按视口过滤——否则会得到"点了没反应"的假缺陷。

## 8.13 Phaser 的 `Container#remove` 会把子节点交回场景显示列表

**Phaser 的 `Container#remove` 会把子节点交回场景显示列表**：`exclusive` 容器（默认）的 `removeHandler` 调 `gameObject.addToDisplayList()`。所以"只脱离不销毁"的复用池（`Repeat` 的 filler 就是这么做的）会把游离节点留在渲染管线里，还带着自己的主题订阅——**脱离后请显式 `removeFromDisplayList()`**（重新 `addWidget` 时 Phaser 会自己再摘掉）。第 63 轮的 V27 就是这么来的，`#/lifecycle` 的 `displayList`/`sceneObjects` 计数就是它的门禁。

## 8.14 裁剪容器也裁剪命中

**裁剪容器也裁剪命中**：`ScrollView` 声明 `clipsPointer = true`，路由器在**下钻之前**先判断点是否落在它的框内，框外整棵子树跳过——否则滚出视口的内容会在它的逻辑位置上继续悬停/可点（V23 实测：视口下方 y=671 处点一下，直接触发了看不见的 `row.8`）。写自定义裁剪容器时照抄这两行（`clipsPointer` + 自己的矩形就是视口）。

## 8.15 拖动归属必须释放

**拖动归属必须释放**：`ScrollView` 的 `dragPointerId`/`barPointerId` 是"谁在拖我"的唯一凭据，而 `onPointerDown` 一旦发现归属非空就拒绝一切新按下。**任何"按下即武装、抬手结束"的路径都要在抬手时无条件释放归属**（V24：一次没移动过的点击会让滚动区永久拖不动），并且每帧按 `InputManager#pointers[id].isDown` 剪掉"指针没了但事件没到"的归属。`#/scroll` 的 `v.owner`/`v.barOwner` 空闲必须是 `none`。

## 8.16 焦点也要"滚进视野"，而且这是框架的责任

**焦点也要"滚进视野"，而且这是框架的责任**（第 67 轮 V33）：键盘/手柄的焦点是纯几何移动的，不知道有遮罩。修之前 `Tab` 会把焦点环画到裁剪区外面（`#/scroll` 实测：可见带 stage y 92..448，焦点走到 y=553 的行，偏移仍是 0），屏幕上什么都看不到、`Enter` 却照按得动，连"点不动"这个线索都没有。现在插件在 `onPreUpdate` 里**布局之后**调用 `revealInViewports(焦点控件)`：沿 `parentContainer` 由内到外问每个视口，视口实现 `Widget#revealDescendant`（`ScrollView` 已实现；边距选项 `revealMargin`，默认 8）。自己写裁剪容器时照抄三步：`contentRectOf(target, 内容根)` 拿**内容坐标**（与当前偏移无关，所以同一次调用里既能读又能写偏移）→ `revealOffset()` → `setOffset()`（会夹到上下限并转告虚拟化列表）；**移动了返回 `true`，被自己的上下限夹回、其实没动就返回 `false`**（后者决定焦点系统要不要为一次没发生的滚动再跑一遍布局）。嵌套口是不动点：`revealInViewports` 一遍有移动就先 `flushLayout()` 再走一遍（≤3 遍）。纯逻辑在 `packages/phaser/src/reveal.ts`，单测 `test/reveal.test.ts`；矩阵见 [`ACCEPTANCE-scroll.md`](./docs/ACCEPTANCE-scroll.md)。

## 8.17 容器不许抢自己里面控件的方向

**容器不许抢自己里面控件的方向**（第 67 轮 V34）：容器的盒子包含内部的一切，所以"下方最近的候选"常常是容器本身——焦点落上去之后方向键只滚动、不再移动焦点（`#/a11y` 实测：`D-Pad 下` 从 `a11y.region.button1` 直接跳到 `a11y.region`，之后再也不动）。`FocusManager.move()` 用 `containsWidget()` + `pickDirectional(..., skip)` **先排除包围当前焦点的祖先**跑一轮，无果再带上它们跑第二轮（保证没有目标被藏起来）。

## 8.18 "认领方向"必须是诚实的

**"认领方向"必须是诚实的**：控件只在**真的做了事**时从 `onAction`/`onKeyDown` 返回 `true`。滚动容器滚到尽头再按方向键必须拒绝，否则手柄用户被永久困在口里（`#/a11y` 实测：偏移停在 126/126 后 `D-Pad 下` 毫无反应；手柄没有 `Tab` 可退，V35）。修法是 `applyScrollStep()` 比较滚动前后的 `currentX/currentY`，没变就 `false`。给新控件写 `onAction` 时同问一句"我这一步真的改变了什么吗"。

## 8.19 `UIScene.content()` 与 `ui()`/`render()` 的 lambda 是同一种东西

**`UIScene.content()` 与 `ui()`/`render()` 的 lambda 是同一种东西**：里面只能用**参与 UI 作用域**的写法。`this.add.vbox(...)`/`this.add.uiLabel(...)` 这些工厂直接 `displayList.add()`、**不进作用域**，所以拿它们当根会得到 `UIScene.content(): the content built no widget` —— 这正是 `#/m0`（纯工厂路径的 M0 验收页）保持 `Phaser.Scene` 的原因。要混用就显式 `withUiParent()`。

## 8.20 页面转场同样是「语义立即、画面延后」，而且邻居页是「画着但不可点」

**页面转场同样是「语义立即、画面延后」，而且邻居页是「画着但不可点」**（第 78 轮）：`push()` 让新页淡入（160 ms）、被盖住的那页**保留像素**到最后才 `visible: false`；`pop()` 当帧弹栈并交回焦点，离开的那页再淡出 120 ms 才销毁。三条纪律：① 转场期间邻居页的 `Widget#routingEnabled = false` —— **这不是 `visible: false`**（那会连像素一起撤掉），只让命中测试跳过那棵子树，所以转场里点一下不会打到用户已经离开的那一页；控件仍留在 `input.widgets` 与无障碍镜像里（把镜像节点摘了又建比短暂不可点更糟）；② 断言计数必须在 `settle()` 之后（`transitions.pending === 0`）并且**从 UI 根**数控件——幽灵页已经不在 `pages.handles` 里；③ 推进动画的收尾回调（「把被盖住的页隐藏」）必须检查那一页是否仍被覆盖，否则一次 `push()` 紧跟 `pop()` 会被残留回调把刚露出来的页面藏掉（V46：`focusables` 18 → 0，`Tab` 无处可去）。

## 8.21 动效时长是主题令牌，不是常量

**动效时长是主题令牌，不是常量**（第 80 轮）：`Theme.motion = { enter, exit }`（毫秒，两个内置主题都是 `160/120`），`MVVMPlugin.transitionFor()` 把它交给 `resolveTransitions()` 当**默认时长**；`DEFAULT_ENTER`/`DEFAULT_EXIT` 只负责缓动与端点。优先级是"写得越具体越赢"：游戏级 `configure({ transition })` ＞ 逐对话框/逐页选项 ＞ 主题令牌 ＞ 内置默认。所以换一套 `setTheme({ ...theme, motion: { enter: 90 } })` 就能同时改变所有对话框与页面转场的节奏，而只写了缓动的 spec 会跟随主题、显式写了时长的不会。给 `Theme` 加字段时记得同步 `packages/widgets/test/fixture-theme.ts`（它是手工写的完整对象）。

## 8.22 动效把"关闭"拆成了两件事，别的门禁要跟着改

**动效把"关闭"拆成了两件事，别的门禁要跟着改**（第 74 轮）：`modal.close()` **当帧**完成所有交互语义（弹栈、`popScope()`、`setCapture()`、`onClose`、`handle.open=false`），只有**图层的销毁**被推迟到出场动画结束（默认 120 ms）。因此：① 任何时候想知道"还有多少在动/落定了没有"就读 `this.mvvm.transitions.pending`，**不要用 `setTimeout` 猜时长**；② 断言"计数回基线"必须在落定之后（`settle()`），而且在淡出期间计数**本来就**比基线高——`#/modal` 的 `churn(n)` 因此是 async 的；③ 淡出期间图层仍在树上、仍然吞掉点击，这是**有意**的（否则一次触摸会"关弹窗 + 点下面的按钮"），要断言"页面按钮在淡出期间不可点、落定后可点"；④ 动效走自己的逐帧步进（`TransitionRunner`，由插件 `PRE_UPDATE` 喂 delta），**不建 Phaser tween**，所以 `#/lifecycle` 的 `tweens`/`timers` 仍是 0；⑤ `TransitionRunner` **一个目标同时只有一个 run，后来者接管**（V40：关闭时进场动画还在跑，两批 run 写同一批属性，对话框会淡回来）；⑥ 像素验收脚本在 `SCENE_SETUP` 之后等 `pending === 0` 再截图——**给任何"开场有动效"的场景加像素断言时都要确认这一步**，否则采到的是动画中间帧。

## 8.23 `UIScene` 的 `setContent()` 是"销毁整页 + 重建"

**`UIScene` 的 `setContent()` 是"销毁整页 + 重建"**：状态必须放在场景字段/ViewModel 上（视图闭包里的局部变量每次换页都会消失），值变化用 `ref` 槽原地更新而不是换页。它是插件结构变化通道的正常入口（`mount()` → `refreshInteraction()` → 路由器/焦点/无障碍镜像重收集，被销毁的焦点控件由 `FocusManager.collect()` 释放），所以**不需要手动清任何东西**；20 次替换的计数门禁在 `#/uiscene` 的 `swap(n)`。

## 8.24 `back` 现在有四层，第 3 层是场景

**`back` 现在有四层，第 3 层是场景**：`planBack()` 的模态 → 页面之后，插件会问 **`UIScene.onBack()`**（返回 `true` 才算拦下），最后才是应用的 `mvvm.onBack`。判定靠 `UIScene` 上的 **`backHook` 标记**，所以普通 `Phaser.Scene` 上恰好叫 `onBack` 的方法不会被框架误调——写自定义场景基类时若要接这一层，请同时设上 `backHook = true`。

## 8.25 嵌套口的"用完传出去"对所有手势都成立

**嵌套口的"用完传出去"对所有手势都成立**（第 70 轮 V37）：滚轮从 M7 就链式传递，**拖拽直到第 70 轮都没有**——`onPointerMove` 直接 `scrollBy`，而拖拽归属被 `innermostAt()` 锁在最内层（外层在 `onPointerDown` 里主动放弃），于是内层到头后剩下的手指位移没人接。触摸设备**没有滚轮**，表现就是"短列表嵌在长页面里，手指一直在动、页面一动不动"（`#/scroll` 实测：上拖 120 ×2 全程 `nested` 停在 950）。现在拖拽步走 `dispatchDrag()`，与 `dispatchWheel()` 同一条逐层传递规则（每层只吃自己有余量的部分，归属仍属于最内层那个口）。**改动拖拽/滚轮路径时注意两点**：`applyDrag` 不能调用 `stopScroll()`（会把 `dragVelocity` 清零、甩动惯性消失），`applyScrollDelta()` 是"我能吃多少"的唯一实现，别在两处各写一份。检测"探针是否真的测到了屏幕位置"：`stagePosition()` 不含缩放、`Container.getBounds()` 返回的是**子节点墨迹**（74×24 的按钮会给出 49×20），缩放过的口里要用 `getWorldTransformMatrix()`。

## 8.26 示例应用按哈希选场景，改哈希会整页重载

**示例应用按哈希选场景，改哈希会整页重载**：场景在启动时按 `location.hash` 选定**一次**，之后改哈希（手输地址、浏览器后退、页内链接）只会换地址栏而跑的还是旧场景——第 67 轮真实撞上：请求 `#/scroll`、`location.hash` 也显示 `#/scroll`，活着的却是 `compose`，**按哈希断言等于对着错误的场景断言**。`main.ts` 现在挂了 `hashchange → location.reload()`（依赖全在模块加载期接好）。验收脚本导航时建议 `goto` + `reload`，或直接读活跃场景（`window.game.scene.scenes.find((s) => s.scene.isActive()).scene.key`）而不是信哈希。

## 8.27 手柄验收怎么做

**手柄验收怎么做**：CDP 没有手柄输入域，所以用**假手柄**：`apps/examples/src/fake-pad.ts` 把 `navigator.getGamepads` 换成一个可变对象（Phaser 每帧就是这么读手柄的），`main.ts` 把它装成 `window.fakePad` —— `pads()`（Phaser 看到几个手柄，**没开手柄时是 0**）、`button(i, down)`（`0`=A、`1`=B、`12..15`=D-Pad）、`stick(dir, value?)`、`clear()`。游戏配置必须写 `input: { gamepad: true }`（Phaser 默认 `false`，示例直到第 64 轮才补上，而 `#/gallery` 的文案早已写着 "gamepad supported"）。矩阵见 [`ACCEPTANCE-gamepad.md`](./docs/ACCEPTANCE-gamepad.md)。

## 8.28 插件选项的正确写法

**插件选项的正确写法**（Guide 01/06/07/08 说"传不进去"的那件事已在第 66 轮解决）：Phaser 用 `new Plugin(scene, pluginManager, mapKey)` 实例化场景插件，**Game Config 里的 config 字段永远为空**；游戏级默认值用 `MVVMPlugin.configure({ … })`（创建游戏之前调一次），单场景运行期用 `this.mvvm.configure({ … })`。`mergePluginConfig()` 对 `input`/`focus`/`a11y`/`layout`/`transition` 做**一层深合并**——加新子选项包时请同步加进这个函数，否则一次补丁会清掉同级选项。订阅类选项（`navigation`/`themeBackground`/`a11y`）立即生效，建树类（`align`/`container`…）下次建根生效。

## 8.29 示例有两种缩放模式

**示例有两种缩放模式**：默认 `Scale.RESIZE`（画布＝视口，响应式），`?fit=980x614` 走设计分辨率（画布被缩放 + 居中留黑边）。`node scripts/visual-check.mjs` 与绝大多数验收跑在 `RESIZE` 下；要验收"画布被缩放"的那一半，用 `?fit=`，见 [`ACCEPTANCE-scale.md`](./docs/ACCEPTANCE-scale.md)。

## 8.30 画布可能被缩放：一切"设计坐标 ↔ 页面坐标"的换算都要过 `displayScale`

**画布可能被缩放：一切"设计坐标 ↔ 页面坐标"的换算都要过 `displayScale`**（第 73 轮 V39）：`Scale.FIT`/`ENVELOP` 下画布 CSS 尺寸 ≠ 设计尺寸，1 个设计像素不是 1 个 CSS 像素。示例的 `status.ts` 提供 `displayScale(game)`/`pagePoint(game, widget)`/`pageOrigin(game, widget)`，**所有 `pt.*` 探针都必须走它们**（31 处已统一）；自己写 `canvas.left + origin.x` 在 `RESIZE` 下恰好正确、在 `FIT` 下必错。另外 **Phaser 会给 `game.domContainer` 加 `transform: scale(displaySize / baseSize)`**——挂进去的元素已经处于设计像素空间，再乘一次 `displayScale` 就是双重缩放（隐藏输入框踩过：220×36 的字段变成 35×6）；`DomInputBridge#place()` 现在**量出容器自己的缩放再除掉**（`rect.width / getComputedStyle(container).width`），要往那个容器里放东西时照抄。矩阵见 [`ACCEPTANCE-scale.md`](./docs/ACCEPTANCE-scale.md)。

## 8.31 安全区（刘海 / 手势条）默认就开着，但需要页面配合

**安全区（刘海 / 手势条）默认就开着，但需要页面配合**（第 72 轮）：`UIRoot` 默认 `safeArea: true`，它读 `env(safe-area-inset-*)`（两个临时探针元素量完即删）并把它设成**根自己的 padding**——用 padding 而不是给页面加偏移，是因为排布器本来就解析 padding，`width: 'fill'` 的页面自动落在安全区内，而根的盒子仍铺满视口（相机背景、钉住的 HUD、模态遮罩保持全屏）。**三条要点**：① 没有 `<meta name="viewport" content="…, viewport-fit=cover">` 时浏览器对所有 inset 报 0（示例应用已加），框架替不了这一步；② inset 只在 **resize** 时重读（旋转会触发，真机上够用；某环境单独改 inset 时要自己 `root.resize()`）；③ 每条边最多占该轴 **25%**（`clampSafeArea`）——刘海是物理像素高度，横屏/小窗时照单全收会把界面挤没；④ **inset 是 CSS 像素、布局是设计像素**，而且 inset 属于**视口**、UI 属于**画布**：`insetsInsideCanvas()` 先去掉"盖在黑边上"的部分，`cssInsetsToDesign()` 再按 `gameSize / displaySize` 换算（`FIT` 留黑边时预留 0/0，铺满时 47/34，纯函数各有单测）。逐设备矩阵见 [`ACCEPTANCE-mobile.md`](./docs/ACCEPTANCE-mobile.md)。

## 8.32 `Rect` 收的是颜色字面量，不是令牌

**`Rect` 收的是颜色字面量，不是令牌**（第 71 轮 V38）：`RectWidget` 按契约就是"纯色块"（`Rect({ color: 0x2f6feb })`），它**不订阅主题**、也没有 `refreshAppearance()`，所以任何"给 `Rect` 喂 `getTheme().colors.*`"的写法都会在换肤后留下旧颜色。框架里唯一这么干的地方是对话框遮罩，已改成自己订阅（`onThemeChange` + `scrim.setColor()`，并把退订挂在 `scrim.scope.onScopeDispose` 上，随对话框关闭释放）。**要给自己的色块跟随主题**：用 `Panel({ variant })`（变体名就是令牌），或照遮罩那样自己订阅 + `scope.onScopeDispose`。逐控件重绘矩阵与门禁见 [`ACCEPTANCE-theme.md`](./docs/ACCEPTANCE-theme.md)。

## 8.33 字段的 `setValue()` 与"用户编辑"是两件事

**字段的 `setValue()` 与"用户编辑"是两件事**（第 81 轮 V49）：`TextInputBase` 的写值走 `commit()`，其中 `userEdit` 决定**是否调用页面的 `onChange` 选项**；`change` **事件**则任何一次提交都发——因为 DSL 的 `value: ref` 与 `bindModel()` 正是靠它把值写回数据源。第一版把两件事合成一个 `silent` 开关，于是 `field.setValue('')` 之后字段空了、`ref` 还是旧文本（实测 `caret=0` 而读数是 `"QwQW"`），绑定下一帧又把旧值写回控件，"清空"时灵时不灵。**规矩**：模型通道（`change` 事件 / `onValueChange` / `ref`）跟着**值**走，用户通道（`onChange` 选项）跟着**用户**走；加新的写值 API 时把它接进 `commit()`，不要绕开。

## 8.34 可访问名有两个来源，别让它们打架

**可访问名有两个来源，别让它们打架**：控件自己画的文字（`Button` 的 `text`、字段的 `placeholder`）是默认可访问名，**没有文字的控件必须用 `label` 选项**（`WidgetOptions.label` → `Widget.a11yLabel`），否则屏幕阅读器会读出调试 `name`（`a11y.volume` 这种内部 id）。`TextField`/`TextArea` 在 M5 就有 `label`，同一个选项现在既是 DOM 桥的可访问名、也是镜像的可访问名。新增选项时照 `baseWidgetOptions()` 转发——**没有代码读的选项等于骗人**（V13/V19/V30 是同一族）。

## 8.35 无障碍镜像跟着"可交互集合"走

**无障碍镜像跟着"可交互集合"走**：`A11yBridge` 从 `input.widgets`（`InputRouter` 注册集合）生成节点，所以**禁用控件有节点**（`aria-disabled`）、`Label`/装饰面板**没有**（没有描述符）；节点带 `tabindex="-1"`（**不进 `Tab` 序**，但会被程序聚焦），默认开启，`mvvm.a11y.enabled = false` 会把整层从 DOM 移除。节点数是"用户能作用的控件数"，可用来当结构变化的门禁。

## 8.36 `[data-mvvm-a11y]` 的属性 ≠ 屏幕阅读器看到的东西

**`[data-mvvm-a11y]` 的属性 ≠ 屏幕阅读器看到的东西**（第 76 轮 V42/V43）：只有读**浏览器算出的可访问性树**（CDP `Accessibility.getFullAXTree`）才能发现"每个文本框被暴露两次""`aria-valuenow` 写在 `textbox` 上""DOM 焦点不跟随框架焦点"这三类问题。现在 `scripts/visual-check.mjs` 的 `AX_EXPECTATIONS` 会断言：每条期望（角色 + 名字 + 属性）在树里**恰好出现一次**、控制节点总数等于期望条数、`Tab` 之后恰好一个控制节点带 focus、live 区恰好一个且 politeness 正确。改 `a11y.ts`/`describeA11y()`/输入框桥时请跑它。三条设计要点：**一个控件一个节点**（控件自带 DOM 元素的走 `Widget#getA11yDomElement()` 让位给元素）、**值域属性只写给支持它的角色**（`VALUE_RANGE_ROLES`）、**被聚焦控件每帧同步**（`sync()` 写前做签名比对）。

## 8.37 控件状态变化要主动告诉无障碍桥

**控件状态变化要主动告诉无障碍桥**（第 84 轮 V52）：镜像只在**焦点变化**、结构变化与"被聚焦控件逐帧同步"时重读，于是**没被聚焦**的控件改了状态（提交后校验失败、`setEnabled(false)`、程序化写值）在镜像与桥元素上一直是旧值 —— 屏幕阅读器把出错的字段读成正常可输入。机制是 `Widget#a11yListener`（与 `structureListener` 同型，由 `A11yBridge` 建节点时装上、节点移除/控件销毁时清掉）+ `notifyA11yChanged()`；**新增任何会影响 `describeA11y()` 的 setter 时都要调它**（现有：`setEnabled`/`setError`/`Button.setValue`/`Button.setText`/`Slider.setValue`/`TextInputBase.commit`）。桥的 `applyDescriptor()` 有签名比对，没变不写 DOM，所以逐键调用也不贵；用户代码**不需要**手动 `mvvm.a11y.sync()`。门禁：`#/a11y` 的 `SCENE_SETUP` 只调 `validate()`/`setVolume(65)`（不手动 sync），AX 树必须报 `名字 invalid=true` 与 `音量 valuenow=65`。

## 8.38 滚动位置是状态，而且只有一个写入口

**滚动位置是状态，而且只有一个写入口**（第 85 轮）：`Scroll({ offset })` 接受常量 / `ref` / getter —— 传 `ref` 是**双向**（拖动/滚轮/惯性/缩放/焦点滚进视野/内容替换/尺寸变化都写回），写 `ref` 移动视图并**先停掉惯性**；传 getter 是单向。`ScrollView` 里**每一条**偏移写入都必须走 `commitOffset()`（`grep -n "this.currentX = "` 应当只剩它自己内部那两行）—— 事件 `'scroll'` 在且只在它里面发，否则观察者（`offset` 槽、自绘滚动条）会在缩放或内容替换之后读到旧值（V53）。`setScrollOffset()` 会先 `stopScroll()`：用户说「回到顶部」就必须真的到 0（V54）。门禁：`#/compose` 的 `list` 分区逐帧同时发布 `list.offset`（控件读数）与 `list.offsetState`（`ref`）并要求一致；`#/scroll` 提供 `watchScroll(port)`/`scrollEvents(port)` 断言"每次偏移变化都上报"。矩阵见 [`ACCEPTANCE-compose-dsl.md`](./docs/ACCEPTANCE-compose-dsl.md) §3.3 与 [`DEFECT-BACKLOG.md`](./docs/DEFECT-BACKLOG.md) §3.26。

## 8.39 "这个方向归谁"只写一遍

**"这个方向归谁"只写一遍**：`Widget.onAction(action, source)` 是与设备无关的优先处理权（键盘与手柄都走 `MVVMPlugin.dispatchAction()`），`onKeyDown` 只留非导航的键（打字、`Home`/`End`、`PageUp`/`PageDown`）。值控件要沿**自己的轴**认方向、交叉轴明确拒绝，否则手柄用户会被卡在控件里（V28）。动作 ↔ 方向键的对应关系用 `ARROW_KEY_OF_DIRECTION`，别在两处各写一份。

## 8.40 触摸验收怎么做

**触摸验收怎么做**：`Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`（CDP），见 `docs/ACCEPTANCE-touch.md`；`window.hud.pointers()` 会同时给出鼠标指针与触摸指针（`wasTouch`/坐标/最后一次 DOM 事件）便于定位。**多指**：示例游戏配有 `input: { activePointers: 2 }`（共 3 个指针），一次 `dispatchTouchEvent` 可带多个触点，每个触点自带 `id`，`touchMove` 要带上当前**所有**活跃触点、`touchEnd` 只带抬起的那个；拖动类控件（`ScrollView`/`Slider`）只认抓住它的那个 `pointer.id`。**一次验收只用一种输入设备**：混用 `page.mouse` 与触摸仿真会让一次手势变成两个指针。模态与页面栈的触摸矩阵（点遮罩关闭、在遮罩/按钮上拖动不算点击、列表拖动不误触行、两指各管各的）见 [`ACCEPTANCE-touch.md`](./docs/ACCEPTANCE-touch.md) §3.7。

## 8.41 文档数字会滞后

**文档数字会滞后**：`README.md`、`CONTRIBUTING.md`、`docs/ACCEPTANCE-*.md` 里的里程碑状态与测试数量彼此不一致（例如三份文档分别写着 M0–M2 / M0–M7 与不同的用例数）。**以代码、`pnpm -r run test` 的实跑结果和 CI 为准**；顺手更新过时描述是受欢迎的改动。

## 8.42 不要引入浏览器测试框架

**不要引入浏览器测试框架**（仓库无 Playwright 依赖，验收走 `scripts/visual-check.mjs` 的 CDP）；任何新运行时依赖都需要 ADR。

## 8.43 橡皮筋：越界位移不能被布局钳掉（第 86 轮 V55）

`ScrollView.bounce: true` 让内容可以**越界**并弹回。任何"把偏移拉回合法范围"的代码都必须先问一句「这个越界是不是有意的」：

- `clampToLimits()` **硬钳制**（`clampOffset(x, limit, false)`），它在 `onRectChanged()` 里被调用，而拖拽的每一步都会让 holder 重新排布 —— 修之前顺序是「拖出边界 → 布局 → 钳回边界」，于是 `bounce` 看起来完全没生效（实测：从顶端下拉 60px，偏移全程 0，每步两次 `scroll` 事件）。现在橡皮筋打开时它直接返回，回弹交给 `step()` 的 `springBack()`（每帧 30%，`!dragging && outOfRange()` 才跑），后者同时负责原本那个「视口变大/内容变短后停在范围外」的场景。
- **给 `ScrollView` 加任何"纠正偏移"的逻辑之前**，先确认 `bounceEnabled` 下它不会被误伤；`packages/widgets/test/scroll-plan.test.ts` 的 `clampOffset` 用例钉住了曲线本身（饱和于 `BOUNCE_LIMIT`、随拉力变硬），但**控件级**的这条纪律只能靠 `#/scroll` 的橡皮筋口（`scroll.bounce`）验收。

## 8.44 数据槽位会"每帧写回同一个值"，这类写入必须是空操作（第 87 轮 V56）

`Scroll({ offset: ref })` 这样的双向槽位，内部是「控件变化 → 写 `ref`」+「`ref` 变化 → 写控件」两条边。第二条边**每一帧都会执行一次**（`ref` 一变，绑定就重放），写进去的通常正是控件当前的值。

所以任何"设置值"的 API 都要把**目标与当前一致**当成空操作处理，不要在里面做有副作用的收尾动作：

- `ScrollView.setScrollOffset(同一个位置)` 曾经无条件 `stopScroll()` —— 于是槽位每帧清零 `dragVelocity`/`coasting`，带槽位的口**拖完不会滑行**（实测：拖动中 `velocity` 恒为 `{0,0}`，`coasting` 永远 `false`）。现在先比目标，一致就 `return`；只有真的要换位置才停惯性（V54 的语义保留）。
- 同族纪律见 §8.33（`setValue` 与 `change` 的两条通道）、§8.38（偏移只有一个写入口）。**给双向槽位加 setter 时先问**：它会不会被绑定每帧重放？重放时做的事有没有副作用？

验收方式：`#/options` 把「带槽位 + `inertia: true`」与「带槽位 + `inertia: false`」并排，同一次快速拖拽下前者必须滑行、后者必须立刻停 —— 两个口都带槽位，所以任何"槽位掐掉动量"的回归都会让第一列同时失去滑行。

## 8.45 从"原始选项"读的选项，也要进 `*_KEYS`（第 87 轮 V57）

`splitOptions()` 只把**键表里写着**的键搬进控件包，其余的归进 `layout` 参数（`normalizeParams` 会忽略）。于是有两种写法：

- 从**拆出来的**控件包读：`widget.onClick`（前提是键表里有 `onClick`）；
- 从**原始选项对象**读：`this.onSubmit = options.onSubmit ?? null`。

第二种写法**能用**，但键表里没有它，审计就会把用户写对了的选项报成拼错的键（实测：`TextField`/`TextArea` 的 `onChange`/`onSubmit`/`onFocus`/`onBlur` 四个回调都不在 `TEXT_INPUT_KEYS` 里，而 `onSubmit` 按 Enter 时确实被调用）。**框架自己的审计喊错比没有审计更糟** —— 它教用户忽略这条警告，而这条警告正是抓 V51（拼错的 `pading`）的东西。

**纪律**：新增选项时，不论从哪里读，都把它加进该控件的 `*_KEYS`；`packages/widgets` 里已有 `Button` 的 `onClick`、`Slider` 的 `onChange` 作为正确样例。门禁是 `scripts/visual-check.mjs` 的逐场景审计 + `#/options` 页面（它同时是"审计抓自己"的用例）。

## 8.46 编辑权限要判在唯一漏斗上，别判在每个调用点（第 88 轮 V59）

文本框的"这次改动能不能落地"有两条来源：**DOM 桥**由元素自己的 `readonly`/`disabled` 属性负责（浏览器拦住一切，包括粘贴），**纯 Canvas 路径**必须自己判。而 Canvas 路径的编辑入口不止一个：

- `handleKeyEvent()` 的按键分支（打字 / `Backspace` / `Delete` / `Enter`）—— 这里逐个判了 `readOnly`；
- `Ctrl+X`/`Ctrl+V` 走的 `cutSelection()` / `pasteClipboard()` —— **不经过按键分支**，于是漏判。

实测（`dom: false, readOnly: true`，值 `locked value`）：打字、`Backspace`、`Enter` 全被正确拒绝，但 `Ctrl+V` 把它改成 `ZZZ`、`Ctrl+X` 把它清成 `''`。两者最终都写进 `applyEdit()`。

**纪律**：状态权限（`readOnly`/`enabled`）判在**唯一的编辑漏斗**里，公共命令（`insertText`/`deleteText`）与键盘/剪贴板路径共用同一条判定 —— 现在是 `canEditValue({ enabled, readOnly })`（`packages/widgets/src/text-edit.ts`，纯函数，有 Node 单测）。判在每个调用点的写法会随"新增一个入口"而失效，而新入口往往正是捷径（剪贴板就是）。

**顺带记住剪切的两半**：剪切 = "复制 + 删除"。只读字段应当**仍然能复制**（浏览器也是这个语义），所以 `cutSelection()` 先写剪贴板、由 `applyEdit()` 拒绝删除 —— 修完的实测是「值不变、剪贴板得到 `locked value`」，这比"剪切什么都不做"更正确。

## 8.47 一次性几何探针会在布局变化后撒谎（第 88 轮）

`reportControl()`/`reportWidget()` 是**创建时采样一次**（AGENTS §5 有纪律），一旦页面在创建之后又长高/上移（本例：给 `#/form` 加了一个字段，面板 466px → 514px，整块上移 24px），快照里的中心点就落在控件外面了。

现象：点击 `canvas` 字段后 `focus = none`，看起来像"输入框之间点击会丢焦点"——实际是点在空白处，框架正确地释放了焦点。改用 `window.game.scene.getScene(<scene>).mvvm.input.widgets` 里每个控件的**实时** `rect`（或逐帧发布的 `pt.*`）后，六个字段逐个点击全部正常。

**纪律**：验收脚本里的坐标要么取逐帧 `pt.*`，要么当场读实时 `rect`；`#status` 只用来核对"布局本身对不对"，不要拿它当点击坐标。**先怀疑探针、再怀疑框架**——这条和 §8.41（文档数字滞后）是同一类错误：读数过期比读数错误更常见。

## 8.48 构建趟里 `reportWidget()` 读到的是 `0×0`（第 89 轮）

`reportWidget()` 打印的是 `appliedRect`，而 `appliedRect` 要等**第一次布局趟**之后才有值。把报告写在建卡的闭包里（`#/showcase` 的 `sizing` 分区第一版就是这么写的），`#status` 里就会出现四行 `@0,0 0x0`——数字都在、名字都对，只有几何是假的。

现象：新加的像素门禁报「`sizing.shrink.on`: expected `#161b22` got `#0d1117` at (0,0)」——读到的是画布角落。看起来像布局放错了位置，实际是读数早了一帧；同一族的坑见 §8.47（一次性探针过期）与 AGENTS §5（`reportControl` 是创建时采样一次）。

**纪律**：任何"把 `appliedRect` 写进 DOM"的探针，都要在**至少一帧之后**调用。跨不出场景的函数就把它做成场景的方法并返回 Promise：`#/showcase` 的 `showAndReport(section)` = `show()` + 等两帧 + `reportGate()`，`scripts/visual-check.mjs` 的 `SCENE_SETUP` 用 `awaitPromise: true` 等它。另外 `reportWidget()` 是**追加**行，`parseRects()` 取同名最后一个 → 重复报告是安全的（不需要先清空 `#status`）。

## 8.49 双轴口的"轴"由**键**决定，不由 `direction` 决定（第 90 轮 V60）

`direction: 'both'` 的滚动口有四个方向键要认领，而"该往哪个轴走"曾经是从 `direction` 推出来的：

```ts
} else if (this.direction === 'horizontal') this.scrollBy(step.delta, 0);
else this.scrollBy(0, step.delta);      // 'both' 会落到这里 → 左右键也走 y
```

实测（`#/options` 的双轴口，聚焦口本身）：`ArrowRight` 把 `y` 从 0 推到 40 → 80 → 120，`x` 一直是 0。修法：`planScrollKey()` 返回的每一步带上它自己的 `axis`，`keyScrollAxis(direction, key)` 是那条纯规则（单轴口**覆盖**按键——横向条用 `PageUp`/`PageDown` 翻页是既有行为），`applyScrollStep()` 按解析出来的轴分发。

**同一处还有一半**：按键步进的"一页"参照的是 `viewport.height`。横向口因此只走 `0.9 × 高度`（实测横向条 `PageDown` 走 68 而不是它该有的 529）。**规律**：任何"按方向/按页"的动作，都要同时问「哪个轴」和「该轴的尺寸是多少」。

**验收方式**：`#/options` 的 `ScrollView.direction: 'both'` 卡（两个口内容与视口完全相同，一个 vertical 作对照）+ `keyScrollAxis` 的三组单测（双轴按键盘走 / 横向按自己的轴 / 纵向永不横移）。

## 8.50 自动化输入设备的滚轮增量可能与"请求值"不同（第 90 轮）

用 CDP `Input.dispatchMouseEvent({ type: 'mouseWheel', deltaY: 100 })` 时，**页面收到的 `deltaY` 是 200**（实测：在 canvas 上加一个捕获阶段监听打印 `event.deltaY`，读到 200；`window.devicePixelRatio` 为 1，排除了 dpr 缩放）。Playwright 的 `page.mouse.wheel(0, 100)` 同样翻倍（它内部就是发 CDP 事件）。

所以量"滚轮走了多远"时：

- 要**绝对值**就用合成事件：`canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX, clientY }))` —— 实测控件严格按 100 移动（`deltaMode: 1` 时 3 行 → 48 = 3 × `LINE_HEIGHT`）；
- 要**比较两侧**就无所谓（比值不受影响），第 87 轮的 `wheelSpeed` A/B 就是这么做的。

触摸与拖动没有这个问题（CDP 的坐标就是 CSS 像素）。

## 8.51 `duration: 0` 的语义是"应用终态"，不是"什么都不做"（第 91 轮 V61）

动效的 `duration` 塌成 0（`prefers-reduced-motion`、`transition: false`、显式 `duration: 0`）时，有两套可能的语义：

- **什么都不写**：控件保持它自己的 alpha/scale；
- **应用终态**：把 `toAlpha`/`toScale`（没写则取目标自己的值）写上去。

框架选的是后者，而且写了三处：`resolveTransition()` 的注释（"A zero duration still keeps the _end_ state … so the properties are carried through with a collapsed range"）、`TransitionRunner.start()` 的 `if (transition.duration <= 0) { applyAt(…, 1); return null; }`、以及 `runGroup()` 用返回值 0 告诉调用方"走同步路径"。

但 `modal.ts` 的 `transitionTargets()` 在更前面就把它过滤掉了：

```ts
if (transition.duration <= 0) return []; // ← 于是 runner 那段成了死代码
```

后果：`enter: { duration: 0, toAlpha: 0.75, toScale: 1.4 }` 被**静默忽略**（实测对话框落在 alpha 1 / scale 1）。默认策略与 reduced-motion 两种常见情况下看不出差别（默认终态就是"目标自己的值"），所以只有显式端点才暴露。

**纪律**：把"这次要不要动"的判断放在**一个**地方（这里是 runner），调用方只负责把目标与 spec 交上去；任何"提前 return 空列表"的优化都要问一句「这会不会让下游那个分支永远跑不到」。修法是把这段判断搬进纯函数 `modalTransitionTargets()`（`transition.ts`，无 Phaser，可 Node 单测），删掉 duration 过滤；单测钉住"零长度也要交出 runs"。关闭路径不受影响：全 instant 的组仍然返回 0，`close()` 照旧同步销毁。

## 8.52 指南与示例是"被抄的代码"，它们教什么就会被抄什么（第 92 轮）

`Label.size` 一直存在（令牌或像素，`style.fontSize` 仍优先），但**指南和多数示例写的是长写法**：

```ts
Text('Ops dashboard', { style: { fontSize: '20px' } }); // 指南 02/03/04/06 里到处都是
Text('Form', { style: { fontSize: `${theme.fontSize.lg}px` } }); // 还要把 theme 拉进作用域
Label({ text: 'hint', style: { fontSize: '14px', color: '#8b949e' } }); // 顺手把深色配色写死
```

三条代价：① 令牌名（`lg`）在代码里消失，换主题时字号不再跟着主题走；② 写死颜色让这段代码在亮色主题下不可读（`#8b949e` 是深色的 `textMuted`）；③ 用户抄的就是这一份 —— 而 `#/showcase` 里那张 **`Label · sizes` 卡本身**就在用长写法演示 `size`。

**纪律**：改完 API 之后要顺手把**指南与示例**也改到新写法，它们不是"能跑就行"的副产物。第 92 轮把 12 个示例页 + 5 篇指南里的 28 处扫成 `size: 'lg'` / `size: 18`，并在 `pnpm docs:check` 里加了一条 **idiom 检查**：`docs/guide/**` 的 `ts` 片段与 `apps/examples/src/scenes/**` 里再出现 `style: { fontSize` 就报错（要*演示* `style` 优先于 `size` 的那一行用 `idiom-ok` 标注）。

**等价性怎么证明**：扫之前先把 12 个受影响场景的 `#status` 存在 `sessionStorage` 里，扫之后再抓一遍逐行比较 —— **0 处几何差异**（字号变了矩形就会变），加上像素门禁照常全绿、`size: 'xs'…'xl'` 实测解析出 `12/14/16/20/26` px ✓。

## 8.53 拖动归属：让控件先"认领"，滚动口再决定（第 93 轮 V58）

控件和 `ScrollView` 会**同时**想要一次拖动：文本域想用它选字，滚动口想用它滚动。两者的第一个信号都是同一个 `pointerdown`，而**谁先收到它是不该被依赖的**（Phaser 的对象事件与场景级监听器的顺序不是契约，历史上 V17/V18 就是在这种顺序上翻车的）。

协议（`packages/phaser/src/pointer-claim.ts`）：

- 想要这个手势的控件在自己的 `pointerdown` 里 `claimPointerDrag(scene, pointer.id, owner)`；
- 滚动口在**真的要动之前**（越过拖动阈值那一刻，不是 `pointerdown` 那一刻）问 `pointerDragOwner(scene, pointer.id)`；
- 释放是调用方的责任：`pointerup` / `pointerupoutside` / 失焦 / 销毁四条路都要清。**留着不放 = 之后所有拖动都被拒**（V24 的形状：控件保着一个已经不存在的指针）。

**为什么"晚一点问"是关键**：早问（在 `pointerdown` 里）就会依赖两个监听器的顺序；晚问则无论谁先跑，答案都一样。这条经验可以推广到任何"多方争同一个手势"的地方。

实测（`#/options` §9）：文本域拖动 `caret 3→7→11→16→21→26`、`selection` 跟着长；同一距离在旁边的普通面板上拖则**页面滚动 106px 而选区不动**；触摸走同一条路径（`claim = 1:options.select`）；DOM 桥路径不认领（浏览器自己选，隐藏元素把指针吞掉，页面也不滚）。

**顺带一条探针纪律**：第一次量 A/B 的"页面没滚"时，舞台偏移本来就是**最大值**——向上拖当然不动。改方向重测才得到 106px。看到"没反应"先问一句：这个探针是不是已经饱和（同 §8.47）。

## 8.54 点击计数是"时间 + 距离"的窗口，探针别连点（第 93 轮）

Canvas 路径没有 DOM 的 `event.detail`，"这是第几次点击"只能由控件自己数：**400ms 之内、6px 之内**再按一次就 +1（2 = 选词，3 = 选行）。两个后果：

- **产品侧**：先单击、再快速双击 = 连击 1-2-3，于是第三次会选中整行 —— 浏览器也是这个行为（单击后立刻双击就是三击）。要"单击 + 双击"两个独立手势，中间必须停一下。
- **探针侧**：验收脚本里若连续 `click`（哪怕只是扫一行里的不同 x），它们会被算成多击。第 93 轮第一次量多行字段时就是这样：13 次点击间隔 160ms、x 相同，读数里冒出 `selection = 11`（三击选了整行），差点被当成"单击也选中"的缺陷。**规矩**：手势之间隔 > 400ms 或移动 > 6px，并且先点一次确认基线（`selection 0`）再发双击。

## 8.55 公开 API 里"没人用过的那一个名字"（第 95 轮）

把四个包的运行时导出拿去查 demo / 指南 / 单测三份语料，只有一个名字三处全空：`compose.ts` 的 `export const Surface = Panel`（`Panel` 的别名，指南的容器表里还写着「`Panel`（别名 `Surface`）」）。

它不是"没文档"，而是**没有任何代码用过它**。这类名字有两个害处：

1. **没人会发现它坏了** —— 别名自己不会腐烂，但"没人用"意味着任何相关改动都不会惊动它（第 86 轮的 `bounce` 就是"看着对、其实一直没生效"）；
2. **它让一个概念有两个名字** —— `docs/HANDOVER.md` 自己写着「没有第二套词汇」，而别名正好违反它；从 Compose 过来的人会在 `Surface` 与 `Panel` 之间抛硬币，然后自己的代码与所有示例都不一样。

**纪律**：新增一个导出（尤其是别名/便捷包装）时问一句「谁会调用它？」—— 答不上来就别加；加上了就必须有 demo 用到、指南提到。第 95 轮把这条变成 `pnpm docs:check` 的第三关 **vocabulary**（`compose` 的每个运行时导出都要在示例里出现、并在指南里被提名），正对照是把这个别名加回去立刻报红。

**顺带一句**：同一轮发现 `justifyContent` 的六个取值里 `space-evenly` 从没被任何页面画过（引擎实现了、指南写了，就是没有 demo）。**"文档里有"不等于"跑过"** —— 三份语料要一起查。

## 8.56 事件名承诺"变化"，就别在每次重绘时发（第 96 轮 V63）

`WIDGET_EVENTS.STATE_CHANGE`（`'widget:state'`）是从 `appearanceChanged()` 里发的，而那个方法的名字就写着"外观需要重绘"：主题切换、`setVariant`、`setError`、焦点环变化都会走它。于是**一次鼠标点击会发出两次 `pressed`**（实测 `#/states`：`pressed, pressed, focused, hover`）。

对订阅者来说这是错的：按状态计数的人会多算一次，问"它进入 `pressed` 了吗"的人会触发两次副作用。**名字是给订阅者的契约**——要么改名成"重绘了"，要么只在真的变化时发。这里选了后者：判定收成纯函数 `announceableState(previous, current)`（返回 `null` = 不必发），单测钉住三条（首次必发/相同不发/不同发新的）。

修后（同一页面、同样的手势，鼠标与触摸都跑）：

| 手势                                     | `widget:state` 流                                     |
| ---------------------------------------- | ----------------------------------------------------- |
| 鼠标点击                                 | `pressed → focused → hover`                           |
| 触摸点击                                 | `pressed → focused`（手指没有悬停，所以没有 `hover`） |
| `Enter`/`Space`/手柄 A（焦点已在控件上） | 空                                                    |

同一轮还发现 `WIDGET_EVENTS` 的两个事件**从没被任何 demo 或单测订阅过**（`ActivationSource` 的唯一出口），以及 `ActivationSource` 把鼠标与触摸都报成 `'pointer'` —— 已在 `#/states` 的 `events()` 探针与 `'touch'` 源里补上。
