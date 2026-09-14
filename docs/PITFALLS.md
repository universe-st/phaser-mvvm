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

**选项审计：拼错的选项会被指名**（第 83 轮）：`splitOptions()` 是**唯一**的选项漏斗（容器直接进来、叶子控件经 `splitWidgetOptions()` 进来），它在开发模式下检查每个键是否属于「布局参数 / 该控件的键 / 基类键」，不属于就 `warn()`：`unknown option "pading" on "kb.page" — it is ignored. Did you mean "padding"?`（纯逻辑在 `packages/phaser/src/option-keys.ts`，建议匹配走大小写/包含/编辑距离，并列时**不给建议**；发布模式零输出）。**给控件加选项时把它加进该控件的 `*_KEYS` 列表**——漏了会让用户看到假警告；布局参数名单是 `@phaser-mvvm/layout` 的 `LAYOUT_PARAM_KEYS`（`keyof LayoutParams`，写错编译不过）。两道门禁：`scripts/visual-check.mjs` 对每个场景收集 `Runtime.consoleAPICalled` 里的 `unknown option` 并失败，同时用 `#/compose` 的 `window.compose.typo()` 做**阳性对照**（必须真的报出 `pading` → `padding`，否则门禁是死的）；全示例走查（**全部 23 个注册场景** + `#/showcase` 的 `showAll()` + `#/compose` 全分区）必须零未知键警告，这同时是键表完整性的门禁。矩阵见 [`ACCEPTANCE-options.md`](./docs/ACCEPTANCE-options.md)。

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

**插件选项的正确写法**（Guide 01/06/07/08 说"传不进去"的那件事已在第 66 轮解决一半、第 110 轮彻底解决）：Phaser 用 `new Plugin(scene, pluginManager, mapKey)` 实例化场景插件，**Game Config 条目里的 config 字段永远为空**；但条目本身被原样保留在 `game.config.installScenePlugins` 里，所以选项可以写在条目的 **`data`** 字段里，由 `pluginConfigFromGameConfig()` 读回（第 110 轮，强弱：默认值 < 条目 `data` < 单实例 config < 运行期 `configure()`；⚠️ 匹配条目时**既要看 `key` 也要看 `mapping`**，见 §8.71）。其余两种写法：游戏级默认值用 `MVVMPlugin.configure({ … })`（创建游戏之前调一次），单场景运行期用 `this.mvvm.configure({ … })`。`mergePluginConfig()` 对 `input`/`focus`/`a11y`/`layout`/`transition` 做**一层深合并**——加新子选项包时请同步加进这个函数，否则一次补丁会清掉同级选项。订阅类选项（`navigation`/`themeBackground`/`a11y`）立即生效，建树类（`align`/`container`…）下次建根生效。

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

**性能读数比状态更危险，因为它会被当成契约引用**（第 107 轮实测）：`PLAN.md` §8、`AGENTS.md` §6、`HANDOVER.md`、`README.md` 四份活文档都写着「实测 18.3 KB / 14.7 KB」「1000 节点 0.06 ms」，而重跑同一条命令得到的是 **18.6 KB / 31.3 KB** 与 **0.108 ms**。差异有两个来源，必须分开看：

- **体积是真实增长**：`phaser/dist/index.js` 从第 5 轮的 70.2 KB（raw）长到 205.7 KB —— 页面栈、路由、模态、动效、无障碍镜像、虚拟键盘这些第 5 轮之后的功能都在这个包里。四份文档里的那个 14.7 KB 因此不是「测量口径变了」，而是**没人重新量过**。
- **计时是噪声**：1000 节点同一份夹具在两次运行里是 0.059 ms 与 0.108 ms（机型/负载都不同）。这种数**不该以「实测 X」的口气写进规范**，写法应该是「预算（契约）+ 读数（快照，带机型与日期，并给出重跑命令）」。

判据：**改完布局引擎、加控件、加包内模块之后，`pnpm size` 与 `perf.test.ts` 的读数都要重跑并就地更新活文档**（§8.6 是命令）；验收记录（`ACCEPTANCE-*.md`）保持当轮读数不动，复测**追加一节**（`ACCEPTANCE-performance.md` §7 就是这么做的），修订历史只留给 ADR。

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

## 8.57 "按住不动"是逐帧的事，`pointermove` 里做不到（第 97 轮 V62）

给纯 Canvas 文本字段补"拖到框外继续滚"时，第一反应是把它写在 `pointermove` 里——**写不出来**，因为浏览器在指针停住之后就不再发移动事件了。而这个手势恰恰以"停住"为主：用户把指针拖到框外就**不再动**，靠时间继续滚。实测：修前按住不动五个采样点（450 ms）里 `top`/`caret`/`selection` 一个数都不变。

所以这类行为必须有一个**逐帧**的钩子（本仓库用 `Phaser.Scenes.Events.POST_UPDATE`，与 `ScrollView` 的滑行同一个），并且要按**帧间隔**积分而不是每帧一个固定像素——否则同一段代码在 30 fps 的机器上会慢一半。（单帧积分另设上限 50 ms：切到后台再切回来时 `delta` 可能是好几秒，不封顶会直接跳到末尾。）

**第二半是"谁拥有滚动偏移"**。`TextInputBase` 每次重绘都会调 `updateScroll()` 把光标滚进视野；拖动越界期间光标被**钳在框内**（指针说"哪条边"，滚动说"哪个字符"），于是这个"把光标滚进视野"的动作会把内容一步弹到光标所在的行——也就是文本末尾，逐帧推进退化成原来那一次跳转。修法是让 `updateScroll()` 在这次拖动期间直接返回（内容偏移由拖动决定），并且这个标志只在"指针确实越界"时为真：指针回到框内就立刻交还，读数随即冻结（实测 `top 107.72` 四个采样点不变）。

**验收这类行为要注意两点**：① "数字在变"必须与"没有输入事件"同时成立，否则分不清是逐帧推进还是残留的 `pointermove`；② 阳性对照要**真的把钩子摘掉**再跑一遍——本轮摘掉后读数回到 `top 0`/`caret 14`，装回去是 `top 0 → 55.01 → 107.45 → 120`。顺带一提，用"点一下 → `Ctrl+Home` → 立刻按下拖动"准备状态时，第一次点击与按下会落进 400 ms 的双击窗口里（§8.54），于是变成"选词 + 拖选"，读出来的 `scrollLeft` 一开始就在上限 —— 那是我自己的探针错，不是产品行为。

## 8.58 被截断的文本必须**说出来**，而"能被撑宽"的宽度什么也证明不了（第 98 轮 V64/V65）

给 `Text` 补 `maxLines`/`ellipsis` 数据槽时，`#/compose` 的探针读到 `truncated: true` 却**没有省略号**——顺着查下去，两个缺陷叠在一起，而且它们互相掩护了很久。

**一半在纯函数里**：`truncateLines()` 用 `ellipsizeLine()` 收尾，而那个函数的契约是"让这一行**放得下**"——一行本来就放得下时它原样返回。可换行之后的每一行**按定义**都放得下，于是"掉了行"这件事实在正文里从来不写出来：`ellipsis: true` 画出来的段落看着像完整的。修法是分开两件事：`ellipsizeAlways()` 承诺"结尾一定有 `…`"（只在必要时缩短），`truncateLines()` 改成用它；`ellipsizeLine()` 保持原契约给单行裁剪用。单测里那条"掉行"的用例原本期望 `['one','two']`——**它把缺陷写成了规格**，所以整轮都没有门禁反对。

**另一半在"宽度"上**：`wrap: false` 的标签根本没有宽度可裁——`wrapWidth` 只在换行路径上设置（Phaser 要拿它换行），于是 `ellipsis: true` 拿着一把 `Infinity` 的尺子，什么也裁不掉，长文本直接溢出盒子。修法是给标签再记一个 `availableWidth`（measure 阶段的 `constraint.maxWidth` / arrange 阶段的盒子宽），**不换行**时用它当裁剪宽度。两个来源都来自祖先的约束、永不来自自己的尺寸，所以不会形成"测出来更小 → 分到更多 → 又更大"的回环。

**而把这两条遮住的，是 demo 自己**：`#/showcase` 的 "Label · truncation" 卡写着 `width: 340` / `width: 220`，但两张标签都长在 `alignItems: 'stretch'`（默认值）的列里——**cross 轴长度会被 stretch 覆盖**（指南 02 §199 早写了）。于是盒子是 964，段落两行就装下了，`truncated` 两张都是 `false`、省略号一个都没有：卡片标题承诺"maxLines + ellipsis 与 wrap: false 的裁剪"，屏幕上却是两张普通标签。教训是**反过来的 §8.55**：不是"没人用过的名字"，而是"**有人用、但用错了宽度**"——门禁读的是 `truncated`/画出来的文字才看得见，读截图看不见（两张标签本身画得毫无毛病）。修法：两处 `alignSelf: 'start'`，并把 `window.showcase.truncation()` 做成常驻读数（画出来的行数、是否掉行、结尾是不是 `…`、实际宽度）。

**给自己留的判据**：任何"按宽度裁剪/省略/换行"的 demo，必须把**实际生效的宽度**也读出来。宽度来自祖先约束，而约束可以被 `stretch`/`fill`/`grow` 改掉，所以"我写的是 340"不是证据。

## 8.59 重画的缓存键必须包含**画的时候读到的每一个输入**（第 99 轮 V67）

给滑块的量程加数据槽时，`#/compose` 的 A/B 两只滑块（同值 40，量程 `0..100` 与 `0..200`）画出了一模一样的填充。顺着查下去是两处**互相掩护**的错误：

1. `setRange()` 用 `return this.setValue(this.current)` 收尾——值还在新区间里时 `setValue` 直接早退，于是一次重画都没发生；
2. 就算调了 `refreshAppearance()` 也没用：它的缓存键是 `[width, height, current, visualState, disabled, theme]`，**没有 `min`/`max`**，而滑块与小节的填充位置是 `(value - min) / (max - min)`——值没变、盒子没变，键就没变，画被跳过。

实测：值 40、`setRange(0, 200)` 之后填充仍然盖住 40% 的轨道（应该 20%）；`aria-valuemax` 也还停在 100（`describeA11y()` 里读 `min`/`max`，而那次改动没通知桥）。修法是：`setRange()` 自己负责重画（不指望 `setValue` 的早退路径）、把量程与 `knobRadius`/`trackThickness` 一起放进缓存键、并在量程变化时通知无障碍层。

**纪律**：任何 `styleKey`/`paintKey` 式的缓存，键里必须列全**画的时候读到的字段**；改一条绘制输入就回来补一次键。同一族的还有 V38（面板变体没丢皮肤缓存）与 V48/V50（键盘换键集只重新贴标签）。判据很简单：**"值不变但画面该变"的操作存在吗？** 存在，就说明键少了东西。

## 8.60 控件自己改了值，就要说出来（第 99 轮 V69）

`Slider.setValue()` 与 `Button.setValue()` 都是"静默"写值（文档写的是"不 emit `change`"），理由是"程序化写值不该看起来像用户编辑"。但对**双向绑定**来说这条理由不成立：`value: ref` 的向下方向只在**源变化时**才跑，所以控件自己改的值永远没有机会被写回源——两者就永久各说各话。

实测（`#/compose`，滑块绑定到 `stateVolume`）：`setRange(0, 30)` 把值从 90 钳到 30，控件显示 30，而 `ref` 一直停在 **90**（页面按帧发布的 `volume=90` 与画面对不上）；`setValue(80)` 更直接——控件 80、`ref` 40，且不会回弹（向下绑定不会主动重读没变过的源）。

修法是把"值变了"这件事在**所有**值变更路径上统一上报：`setValue`/`setRange` 的钳制结果都 emit `change`，而**用户专属**的回调仍然是 `onChange`（选项）——这正是文本框早就写明的分工（`TEXT_INPUT_EVENTS.CHANGE` 是模型通道，`onChange` 选项才是"用户动了它"）。于是 DSL 的 `onValueChange` 也跟着变成"值真的变了就给"，与 Compose 的 `onValueChange` 语义一致。

**同一族的第二个实例（第 100 轮 V70，开关按钮）**：`Button.setValue()` 也是静默写值，而开关的 `value: ref` 同样是双向数据槽（`bindBooleanModel` 只听 `change`）。实测 `#/a11y`：`setValue(false)` 之后控件已关，而页面按帧发布的 `notify` 仍是 `true`。修法一致——值真的变了就 emit `change`，用户专属回调仍是 `onClick`。**修的时候要注意别把激活路径改成发两次**：`handleActivation()` 原本自己 emit 一次，`setValue` 现在也会 emit，所以那行必须删掉（实测：点击一次恰好一个 `change`，`#/gallery` 两次点击 = `true` → `false`）。

判据可以一句话概括：**控件自己动的值，和用户动的值，都要走过同一个上报通道**；只有"这是不是用户干的"这件事才分两条路。

## 8.61 公开读数要报告**解析后**的值，不是"请求的值"（第 100 轮 V71）

给 `Image` 的 `frame` 槽做 A/B 验收时顺手量了一次"帧名写错会怎样"：Phaser 的 `Texture#get` 打印一条警告（`Texture "compose.atlas" has no frame "nope"`）并按**第一帧**绘制——而 `Image#currentFrame` 当时报告的是 `'nope'`，也就是**请求**，不是屏幕上那一帧。这类读数最危险的地方在于它专门用来断言"槽位有没有生效"：一个撒谎的读数会让检查读到它想看到的东西。

修法：`setTexture(texture, frame?)` 记录 `image.frame.name`（Phaser 解析后的帧），只在"调用方根本没点名帧"时保留 `undefined`——那种情况下"第一帧"是贴图的默认，不是一个可命名的选择。实测修后同一个错名字：画面 `red`、`currentFrame === 'red'`、控制台仍有一条指名警告（警告保留是对的，它才是让调用方去改名字的那条信息）。

**同族的判据**：任何 `current*`/`get*()` 形态的读数，都要问一句"它报告的是我上文写下的东西，还是这个东西实际变成的样子？" 请求与结果在**失败路径**上分叉的地方（缺帧、被钳制、被四舍五入、被平台改写），必须报告结果。

## 8.63 "被盖住"有两种：模态与页面，无障碍树都要跟着变（第 102 轮 V73）

修完模态（§8.62）之后，同一族的第二个实例几乎是立刻就能问出来的：**页面栈盖住的页呢？**

实测（`#/pages`，CDP `Accessibility.getFullAXTree`，只数 `textbox`/`button`）——列表页 17 个控制节点；`open(1)` 推入详情页后 **20 个**（列表的 17 **加上**详情页自己的 3 个：`返回列表`/`再进一层`/`打开对话框`）；再 `deeper()` 第三层是 22 个；`popToRoot()` 回到 17 个。也就是说：读屏用户在新页面上往下走，会先穿过**被盖住的整页**——14 个列表条目、两个输入框、计数器按钮。

根因与 V72 完全同族：页面栈"让被盖住的页继续活着"（这正是它保留状态的原因），但**活着不等于该被读到**。两者的差别只在"遮住"的语义：

- **模态**：层以外的**一切**都不能到达（指针与焦点陷阱就是这么做的）；
- **页面**：只有**被盖住的那几页**不能到达 —— 与页面并排的 HUD / 底栏是活界面的一部分，必须留下。所以判据不能写成"顶层页面之外一律隐藏"，而要写成"栈里所有 `active === false` 的页（含正在淡出的那一页）"。

修法：`A11yBridge#isInert(widget)` 一个谓词同时回答这两问（模态优先，其次页面栈），`applyDescriptor` 里那个 `inert` 标志照旧进缓存签名——模态与页面栈本来都会触发 `refreshInteraction()`，时序不需要新钩子。实测修后：列表 17 → 详情页 **3** → 第三层 **2** → 根 17；在详情页上再开一个对话框只剩 **1**（对话框自己的按钮）。

**门禁**：`visual-check` 的 `AX_EXPECTATIONS` 再补 `pages` 一条（`SCENE_SETUP` 用 `window.pages.open(1)` 推入详情页，期望只列详情页的 3 个按钮）。正对照：把 `isInert` 强制返回 `false`，`modal` 与 `pages` 两条**同时**变红（`2 check(s) failed`），恢复后全绿。

> **顺带一条工具纪律**：`visual-check --no-build` 用的是 `dist/` 里**上一次构建**的包。把阳性对照的改动还原、却用 `--no-build` 复跑，读到的仍是"对照版"的失败——看着像"改回去也没修好"。改完源码要么重新构建，要么别加 `--no-build`。

## 8.62 模态挡住了画布，但**挡不住无障碍树**（第 101 轮 V72）

把虚拟键盘放进对话框验收时（手柄用户最需要它的场合）顺手读了一次浏览器算出来的无障碍树，于是发现：对话框开着的时候，**被盖住的整页仍然在树里**。

实测（`#/keyboard`，CDP `Accessibility.getFullAXTree`，只数 `textbox`/`button`）：无对话框 38 个控制节点；打开对话框后 **73 个**——页面的 38 个**加上**对话框自己的 35 个，读屏用户一路走下去会先撞见对话框下面那个 `玩家名` 文本框，再撞见对话框里的 `角色名`。关闭后回到 38。

根因是"模态做了什么"和"读屏软件读什么"不是一回事：模态层挡住了指针命中（画布坐标在层内被吞）、把焦点管理器推进了一个新作用域，但**这两条都不进无障碍树**。`A11yBridge` 把所有"有描述的控件"（`input.widgets ∪ focus.focusables`）都镜像成 DOM 节点，与"哪一层在上面"无关；而文本框这类**自带 DOM 元素**的控件，它的表面就是那个隐藏 `<input>`，把镜像节点标成 `aria-hidden` 对它一点用都没有。

修法：桥新增"是否在模态之后"的判断（顶层模态的 `content` 是当前活着的表面，不在它子树里的控件一律 `aria-hidden`，**镜像节点与它自己的 DOM 元素都标**），而**当前持有 DOM 焦点的控件永不隐藏**——`aria-hidden` 标在聚焦元素上是无效 ARIA，浏览器可能直接把焦点丢掉；模态 `open()` 时焦点还没进层（`refreshInteraction()` 在 `pushScope` 之前），所以这一条例外不是可选的。缓存签名里带上这个标志，所以开关模态会重新应用；模态本来就调用 `refreshInteraction()`，不需要新钩子。

**门禁**：`visual-check` 的 `AX_EXPECTATIONS` 新增 `modal`（该场景 setup 本来就开着 `confirm`），只列对话框自己的两个按钮，而 AX 门禁的语义是"控制节点**恰好**这么多"——于是"下面的页面还在树里"会当场红。正对照：把判断强制返回 `false`，这条如期失败。

**顺带一条同族的采样纪律**：模态的关闭是"语义立即、画面延后"（§8.22），所以**泄漏门禁必须等出场动画结束再采样**。本轮第一版的键盘页 `churn` 只等两帧，五轮之后读到 `widgets 96`（基线 50）——那 46 个全是"还在淡出的图层"，不是泄漏。修法就是 `#/modal` 早就用的 `await settle()`。

## 8.64 无障碍镜像必须是**树**，不能是一张清单（第 103 轮 V74）

第 102 轮末尾登记的增强（[`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md) §10.1）：镜像把每个控件做成**同一个隐藏 div 下的兄弟节点**。这满足了"一个控件恰好一个节点"，但**表达不了"谁属于谁"**——`#/a11y` 的 `region: 按钮区域` 与它那 6 个按钮是并排的兄弟，`role="dialog"` 加上去也只会是"一个没有子节点的对话框"（`aria-modal` 的包含关系更是无从表达）。读屏用户听到的是 8 个平铺控件，而不是"按钮区域里有 6 个按钮"。

修法：`A11yBridge#nest()` 在**结构变化时**把每个镜像节点挂到"最近的、有镜像节点的祖先控件"的节点下（`mirrorParentOf` 沿 `parentContainer` 上溯，找不到就挂回镜像根），按控件树顺序重排兄弟，并把 `this.nodes` 也按树顺序排好（`collectWanted` 走一遍树）。**只在结构变化时做**：重新 `appendChild` 就是一次 DOM 变更，而 DOM 变更正是唤醒无障碍树的东西，稳定帧必须零变更。

实测（`#/a11y`，CDP `Accessibility.getFullAXTree`）：修前 `region` 的 `childIds` 里 0 个控制节点（6 个按钮是它的兄弟），修后 6 个全在它里面；`#/modal` 的 `confirm` 对话框修前根本没有容器节点，修后是 `dialog:删除这一项？`（`aria-modal=true`）且里面正好 2 个按钮。

三件必须一起想清楚的事：

1. **`aria-hidden` 在 DOM 里是**继承**的**。平铺的时候每个节点只顾自己；一旦嵌套，"祖先被隐藏"就会连带隐藏子孙。所以 §8.62/§8.63 的"持有焦点的控件永不隐藏"这条豁免必须**扩展到它的祖先链**：`isInert()` 现在还会对"内部含有当前聚焦控件的容器"回答 `false`（`holdsFocus`）。这不是假想情形——外层是个 `ScrollView`（`role="region"`）而焦点在里面的字段上，正是这个形状，它出现在"模态刚打开、焦点还没进层"的那一帧里；容器自己的子孙控件依然逐个按各自的判据隐藏，所以暴露面只有那一条祖先链。
2. **自带 DOM 元素的控件不在镜像树里**。文本框的表面是它自己的 `<input>`（§8.62、V42），那个元素在 overlay 里、与镜像根并排，**没法**成为对话框节点的 DOM 子节点——除非把活的 `<input>` 真的搬进一个 1px 裁剪的节点里，那会动到浏览器定位、IME 与选区，不值得。ARIA 为这件事准备了 `aria-owns`：`nest()` 把这类元素挂到"它本该属于的那个镜像节点"上（缺 `id` 时补一个，已有的 `id` 绝不覆盖）。实测（`#/keyboard` 的对话框）：不用 `aria-owns` 时 35 个控件只有 34 个在对话框里，对话框自己的 `角色名` 是一个**与对话框并排**的文本框；用上之后 35/35。注意它只改**无障碍树里的父子关系**，DOM 位置、样式与 DOM 焦点一概不动。
3. **`label` 在容器上是"静默丢弃"的（V74）**。`label` 是基类选项，选项审计（`BASE_WIDGET_OPTION_KEYS`）明确接受它，但 `Column`/`Row`/`Grid`/`Stack`/`Absolute` 的选项类型里没有它（`tsc` 直接报错），而绕开类型传进去会被 `splitOptions` 扔进布局参数袋、被 `normalizeParams` 静默忽略——正是选项审计当初要消灭的那类陷阱。修法：四个布局容器的选项补上 `label` 并转交给基类，`splitOptions` 把 `label` 与 `name` 一样交给基类；`Widget.describeA11y()` 的默认实现顺势补一条规则——**没有任何描述、但被给了可访问名字的控件，镜像为一个具名 `group`**（`Panel.describeA11y()` 的非交互分支改为回落到它）。于是"给容器起个名字"成了一件有事发生的事：`#/a11y` 的字段区现在是 `group:字段区域`，两个输入框（`aria-owns`）在它里面。

**门禁**：`visual-check` 新增 `AX_STRUCTURE_EXPECTATIONS`（与"控制节点恰好这么多"的 `AX_EXPECTATIONS` 并列），断言的是**包含关系**而不是数量：`a11y` 的 `region:按钮区域` 里 6 个 `button`、`group:字段区域` 里 2 个 `textbox`、`modal` 的 `dialog:删除这一项？`（`aria-modal=true`）里 2 个 `button`。**两条正对照各验一半**：① 让 `mirrorParentOf` 直接返回根（等于回到平铺）→ 3 条断言全红（`3 check(s) failed`），而所有计数断言依然绿——这正说明旧门禁**测不到**这件事；② 只关掉 `aria-owns` → 只有 `字段区域` 那条红（`1 check(s) failed`），嵌套那两条照旧绿——两条断言测的是两套机制，不是同一件的两种写法。

## 8.65 指南里的选项键，必须真的被代码接受（第 104 轮）

第 83 轮的选项审计让**代码**这一侧不再静默：拼错或多余的键会在开发模式下被指名报出。但审计只看得见"代码接收了什么"，看不见**指南承诺了什么**——而指南的选项表正是读者照着写代码的那份契约。两份语料之间的缝里，一个键可以"文档里有、代码里没有"，读起来完全正常，跑起来只有一条开发警告（发布模式连警告都没有）。

所以 `scripts/check-doc-options.mjs` 把这条缝也变成门禁（已接进 `pnpm docs:check`）：解析 `docs/guide/**` 里所有键表（表头首格是「选项」或「字段」），按标题栈把每张表归属到它文档化的那个选项包（widget / `LayoutParams` / `ModalOptions` / `PageOptions` / `TransitionOptions`），再拿**那个包真正接受的键**去核对。当前 **195 个文档键**全部通过。

写这个门禁时踩到的四个"归属"坑，都是**检查器**的问题而不是文档的问题，值得记下来：

1. **DSL 是文档化的那一层**。指南写的是 `TextField({ error })`/`onValueChange`（DSL 槽位），而 `TEXT_INPUT_KEYS` 里没有它们——包必须把 `compose.ts` 的 `*DslOptions` 类型也算进来（`type X = Omit<WidgetOptions, 'slot'> & { slot }` 的**内联对象块**，不是 `interface`）。
2. **标题栈**。"### 选项"不命名任何东西，属性来自**外层**的 "## 4.5 `Slider`"；但 05 章的 "## 2. 选项" 是**兄弟**标题而不是子标题，所以那里的标题改成了 "## 2. `ScrollView` 选项"——标题自己说清楚归属，比检查器去猜更划算。
3. **`type X` 出现在 import 里**。`import { withListFlow, type ListFlowShorthands } from './list-flow'` 里也有 "type ListFlowShorthands"，用它当声明去解析会拿到一段无关代码外的 `{ … }`。声明必须**从行首开始**。
4. **带类型标注的数组**。`export const LAYOUT_PARAM_KEYS: readonly (keyof LayoutParams)[] = [...]` 里 `=` 前面有标注，早期的 `const X_KEYS = [` 正则整个漏掉——于是所有"布局参数"行（`width`/`padding`…）都没被核对过。

**结论**：这一轮**没有**发现代码缺陷（`Repeat` 的 `gap` 曾经看起来是缺陷，核实后是 DSL `List` 的 `ListFlowShorthands` 在撑着它，指南的写法是对的）。门禁的价值在于把"文档承诺 vs 代码接受"变成一条命令，而不是等到某个读者照着写却什么都不发生。

## 8.66 一组选项没有响应式通道，就等于"这个维度不能是状态"（第 105 轮）

第 84/98/99 轮把 `value`/`disabled`/`error`/`variant`/`readOnly`/`maxLines`/`texture`/`min`/`max` 一个个做成了数据槽，于是在这个框架里"状态驱动 UI"看起来是普遍的。但**布局参数与容器选项**一直是例外：`width`/`padding`/`grow` 与 `gap`/`justifyContent`/`columns` 只能在建树时写死，或者绕到命令式的 `setLayoutParams()`（指南 02 §13 就是这么教的）。

后果不是"少写一行"，而是**这个维度上不能有状态**：`Column({ gap: 8 })` 想随状态变，唯一可行的手法是**重建整棵子树**——连带丢掉焦点、滚动偏移、输入框里的文字（`Branch`/`Page` 那两条路都是这个代价，它们有明确的语义理由；间距不该有）。这正是"看起来像 Compose、写起来不是 Compose"的那类缝。

修法分三层，缺一不可：

1. **运行期入口**：`Widget#setContainerOptions(patch)`，与既有的 `setLayoutParams(patch)` 对称。两个袋子分工是固定的——布局参数 = 控件自己的盒子，容器选项 = 它怎么摆子节点；引擎每趟 measure/arrange 都重新读它们，所以"改 + `markDirty()`"就够了。
2. **键表只有一份**：`runtimeOptionTarget(containerType, key)` 回答"这个键能不能在运行期改、改哪一半"。它必须放在**同时被 `Widget.ts` 与 `LayoutWidget.ts` 引用**的模块里（两者互相 import 会在模块求值时炸：`BoxWidget extends Widget`），于是有了 `container-options.ts`。DSL 绑槽位与 `setContainerOptions()` 校验用同一张表，才不会有"绑了但写进了没人读的袋子"。
3. **建树时解析、之后才绑定**：`new BoxWidget(scene, { gap: Ref })` 会把 `Ref` 当成 gap 存下来。所以 `splitDsl()` 在把 bag 交给构造器前先用 `readReactive()` 解析槽位值，`applyDslOptions()` 再为之后的变化建绑定（`splitDsl`/`resolveSlots` 是唯一漏斗，19 个 DSL 包装器都走它）。

**判据是"按名字，不按形状"**：`onClick`/`validate`/`items` 本来就是函数，与 getter 在文本上无法区分。所以哪些键是槽位由**键表**决定（`LayoutParams` 的全部键 + 该容器自己的选项键），绝不看值是不是函数；这也是 `runtimeOptionTarget()` 有单测的原因（`packages/phaser/test/container-options.test.ts`）。

**门禁与实测**：`#/options` 新增 `layout slots` 卡（`gap`/`padding` 在容器上、`width` 在叶子上），`window.optionsDemo.slots()` 同时读三样东西——`ref` 的值、**引擎真正持有的**容器选项/`layoutParams`、以及**排布出来的** `rowY`；再加 `sameRows`（行控件是否还是建树时那批实例）。实测翻 ref：`containerGap` 4 → 16、`boxWidth` 120 → 240、`rowY` `[6,34,62]` → `[18,58,98]`（正好是 padding + 行高 + gap），而 `sameRows` 始终 `true` —— **几何变了、子树没重建**；真鼠标点卡片自己的三个按钮得到同样的结果。像素门禁取"宿主列（宽 260 固定）的 90% 处"：roomy 时落在 240 宽的盒子里（`primary` 令牌 `#2f6feb` / 亮色 `#0969da`），默认 120 时同一点落在卡片底色上——所以它测的是**槽位真的生效**，而不是"盒子大致在那儿"。阳性对照（让 `layout` 那一类槽位永不绑定）如期 `2 check(s) failed`。

**一条容易被误判成缺陷的边界**：`stretch` 会让子节点拿到整条交叉轴长度，**即使它写了自己的 `width`**（`box.ts` 的实现说明与指南 02 §6 都写明了这是有意的、与 CSS 不同）。所以"宽度槽位不生效"的第一嫌疑是宿主容器在 `stretch` —— 把宿主改成 `alignItems: 'start'`，槽位立刻可见（本轮就是这么踩了一次）。

## 8.67 `hover`/`pressed` 属于**控件**，不属于"有命中区的层"（第 106 轮 V76）

路由的语义是"指针下**最深**的那个目标"，而"是目标"这件事有**两个**理由：

1. 它是个控件（可聚焦、有激活回调、显式 `interactive`）——`hover`/`pressed` 是它的**操作反馈**；
2. 它的命中区是**拦截层**（`Panel` 的 `blockPointer` 默认 `true`）——为的是"落在 UI 上的按下不再穿透到 UI 之下的游戏对象"（V9）。

第二类也进了路由的目标集合（`collectInteractive` 有意收集它们），于是它同样收到了 `hover`/`pressed`，而 `ProceduralSkin` 又照着画了：`#/showcase` 左边的菜单是一块 `variant: 'surface'` 的面板，鼠标从它的按钮上滑过时，只要有**一个像素**落在按钮之间的 6px 缝隙或面板内边距上，路由就把 hover 从按钮移回面板——面板底色的 `normal ⇄ hover` 于是随鼠标抖动（实测：指针在按钮上 `nav=normal`、在缝隙上 `nav=hover`）。同一族里更显眼的是整页背景：`variant: 'plain'` 的页面面板 hover 时用 `surfaceHover` 以 0.5 alpha 刷满全屏，指针滑过卡片之间的 10px 缝就会让整页闪一下。按下也有同一半问题：点菜单空白处，面板会整块变暗（`pressed`）。

**判据**：`takesPointerStates(widget)`（`input.ts`，纯函数、有单测）= 可聚焦 / 有 `onActivate` / 显式 `interactive`。`syncPointerState()` 先用 `resolveTarget()` 拿到命中目标（拦截与激活的语义**不变**），再 `pointerStateTarget()` **向上**走到最近的那个控件去设 hover；`handlePointerDown()` 仍然把这次按下记在命中目标上（`pressedAt`，点击手势与激活判定的依据），但只在目标是控件时才 `setPressed(true)`。

向上走这一步是有意的，不是补丁：一个 `interactive: true` 的卡片里放着一层普通面板时，指针落在那一层上，亮的应该是**卡片**（CSS `:hover` 的直觉），而不是那层什么都做不了的面板。

**别把读数变化当回归**：改完之后"容器自己不会 hover"这句话仍然成立，只是现在多了一条——**不是控件的容器永远不会** hover/pressed。`#/showcase` 的 `st.nav`/`st.section.*` 这类探针本来就只提供几何；真正需要 hover 面板的是 `#/states` 的 `panel.interactive`（显式 `interactive: true`），实测仍是 `normal → hover → pressed → hover`。

**怎么验**：三张同区域截图（指针移开 / 落在按钮缝隙 / 落在面板内边距）应当**逐字节相同**（`shasum` 一比即可）；再加一条真实鼠标的 A/B——同一个坐标在"控件"与"拦截层"上分别读到 `hover` 与 `normal`。

## 8.68 自动高度的行里放 `fill` 子节点，会把整行撑到"父容器还能给的全部"（第 106 轮 V77）

`fill` 的语义是"撑满**父容器的内容盒**"，而测量趟里父容器的内容盒只有一个上界（`loosen(constraint)`）——于是

```ts
Panel({ direction: 'vertical', height: 'fill', padding: 12 }, () => {
  Row({ width: 'fill' }, () => { Text('标题'); });                 // 页头，auto 高
  Row({ width: 'fill', grow: 1 }, () => {                          // 主体
    Scroll({ width: 'fill', height: 'fill' }, () => { … });
  });
  Row({ width: 'fill' }, () => { Text('页脚'); });
});
```

主体那一行会在测量时**报告自己等于整块内容盒**（因为 `Scroll` 的 `height: 'fill'` 解析成"父容器内容盒的高度"，而父容器就是这一行；行自己的高度还是 auto，只能拿到这个上界）。接着 `grow: 1` 保留的就是这个实测尺寸——它已经吃掉了页头与页脚的位置，`shrink` 默认又是 0，于是**页脚被推出页面**、主体底边落到画布之外。这一页历史上所有的"最后一个卡片的两个圆角看不见"都是这一个原因（不是裁剪算错、也不是 `ScrollView` 少算了几像素）。

两条正确写法，语义不同但这里等价：

| 写法                     | 主轴上发生了什么                                                          |
| ------------------------ | ------------------------------------------------------------------------- |
| `height: 'fill'`（推荐） | 主轴 `fill` ⇒ 基准 0 + `grow: 1`（`flex: 1 1 0`）：拿到"剩下多少就要多少" |
| `grow: 1, basis: 0`      | 同上，显式写出基准（想保留宽度实测值时用得上）                            |
| `grow: 1`                | **保留实测尺寸**，空间不够时溢出（要配合 `shrink` 才有救）                |

`guide/02-layout.md` §"主轴上的 `fill` 基准是 0"与 `box.test.ts` 的「treats `fill` as grow: 1 with a base size of 0」写的就是这条；**"行里有个 `fill` 子节点"是判断"这一行会不会撑满"的信号**。

**顺带一条**：容器**不裁剪**自己的内容。一个装不下自己内容的 `Panel`（比如那 572px 的菜单列表放在 551.5px 的轨道里）不会把溢出的部分挡住——它会照画在面板的圆角外面。所以"这块内容可能装不下"就必须自己给一个 `Scroll` 口（`#/showcase` 的侧栏现在是 `Panel → Scroll → Column`），而不是指望面板兜住。

**验收姿势**：`showAndReport(id)` 之后 `scrollStage(1e6)`，再把"分区最后一张卡片的底边"与"舞台底边"、"页底"、"画布高"四个数放在一起读——只看卡片自身永远看不出它被画到了画布外面（`#/showcase` §9.4 的表就是这么来的）。

---

## 8.69 事件链的两条「不生效」坑：消费要抑制点击，拦截要整条掐掉（第 107 轮）

指针事件链（ADR-0010）把「谁拿到事件、谁能中途夺走」变成了显式语义。两条最容易写错的地方都在**链与既有点击机器的交界**上，而且都能"看起来正常工作"：

**① 消费了 `down` 的控件，不能再顺带触发一次 `activate()`。** 第一次实现里链只管投递、点击机器照旧跑，于是「叶子消费了按下」的手势在抬手时**又**跑了一遍 `onClick` —— `#/events` 的 B 用例实测 `clicks=1`，而按语义它必须是 `0`（控件已经说了"这次我自己处理"）。修法：按下时分发链，记下 `handledBy`；抬手时若这次手势被消费过，就跳过 `activate()`（焦点与 `pressed` 外观照旧——用户确实按了这个控件，**只是这次按下不再等于点击**）。

**② 被祖先拦截的按下，连"按下"都不算。** 同一个场景的 C 用例：`l2` 拦截后叶子**根本没收到 `down`**，但标记为"被按下"的目标仍是叶子（命中测试与链是两件事），抬手时它照样激活了一次。Android 里这是不可能的——`onInterceptTouchEvent` 返回 `true` 时子 View 收不到 `ACTION_DOWN`，自然不会按下、不会点击。修法：`down` 的 trace 若停在 `intercepted`，就**在记录按下之前返回**：不写 `pressedAt`、不设 `pressed`、不移动焦点。

**判据一句话**：链只改变"谁拿到事件"，而"事件没到过的地方不应留下任何痕迹"。加新钩子/新拦截点时，先问一遍：**这次事件到底有没有到过那个控件？**

**顺带记一个探针坑（同一轮踩到）**：`#/events` 的两块读数标签原本高度自适应，台账从 1 行长到 4 行时页面高了 34px、根部 `stack` 居中所致整体上移，于是"先读坐标再按下"的那一下落到了 `l4` 上，现象与"拦截没生效"一模一样。**会随使用变化高度的读数必须定高**（`height: 64`），否则探针会在读与点之间漂移（§8.47 的同一条纪律）。

## 8.70 视口裁剪：**布局矩形不是子树的边界**，而"隐藏"不能借用 `visible`（第 109 轮）

`#/showcase` 打开 "All sections" 后滑动/点击明显卡顿。实测（Playwright + `drawElements` 计数 + `game.loop` 计时，Apple A18 Pro / Chromium / 1280×720 画布 1408×626）：

| 状态                                                    | 每帧 draw call | 帧时间中位数        |
| ------------------------------------------------------- | -------------- | ------------------- |
| "All sections"（853 控件 / 内容高 8298px / 视口 511px） | **578**        | **90 ms（11 fps）** |
| 单分区（86 控件）                                       | 94             | 29 ms               |
| 把舞台内容整体 `setVisible(false)`（阳性对照）          | 40             | 17 ms（= vsync）    |

滑动位置从 0 换到 7800 时 draw call **一个不变**：内容全部在画，而画布里只看得见 6%。根因是**没有任何视口裁剪**——`ScrollView` 只用 mask 把看不见的像素挡住，但 GPU 那一笔账照付；Phaser 4 的 `Graphics` 每帧都要重放命令缓冲、重新三角化（`GraphicsWebGLRenderer` + `Earcut`），在 ~0.13 ms/个的量级上，578 个就是 75 ms。

**① 裁剪要写"只影响渲染"的开关，绝不能用 `visible`。** `visible` 在这个框架里是一个语义开关，有五个读者：`inFlow`（隐藏的控件退出布局流，`setVisible()` 因此会 `markDirty()`）、`collectRects`（内容长度 → 滚动上限与滚动条）、焦点收集、`resolveTargetInTree`（指针落点）、无障碍镜像。拿它做裁剪，等于"滚一下就要重排一次 + Tab 顺序随滚动变化 + 滚动条长度抖动"。落地方式：`Widget.culled`（普通字段）+ `Widget#willRender()` 里 `if (this.culled) return false`——`ContainerWebGLRenderer` 正是逐子节点问 `willRender()`，一个 `false` 就把整棵子树从这一帧里摘掉，而布局/焦点/命中/无障碍看到的世界完全不变。

**② 判据必须是"子树画出来的外接矩形"，不是节点自己的 `appliedRect`。** 第一版按节点自身矩形判、命中就整棵剪掉。`#/list` 立刻整屏空白：那块内容是 `height: 'fill'` 的 `Panel`（自身矩形 408px）+ 虚拟化 `Repeat`（行按**内容坐标** `index × itemExtent` 摆放，前后用 filler 占位），行在 y=3838…4382，离父矩形几千像素——父矩形被判为"在视口外"，行跟着一起消失。改成后序递归、返回**实际会画出来的**外接矩形（自身矩形 ∪ 未被剪掉的子节点矩形），再拿这个矩形判，问题消失；代价是每帧要遍历整棵内容树一次，`#/showcase` 892 个控件实测 **0.125 ms**（对比它省下的 75 ms）。截图 A/B（把 `cullContent` 换成空函数 + 清标记）在 4 个页面、13 个滚动口、4×N 个偏移上共 **64 对截图逐像素完全相同**——这是"裁剪只挡住了 mask 已经挡住的东西"的判据。

**③ 顺带一条 A/B 方法论**：滚动条拇指只在 `commitOffset()`/`onRectChanged()` 里重画，不是逐帧重画；左右两次截图若"上一次滚过、这次没滚"，第 2 次会带着**迟到重画的拇指**，于是看起来像"裁剪把滚动条弄丢了"。A/B 前先把每个口滚到底再滚回 0 做一次 prime，两边共享同一段重画历史，读数才有意义。

**判据一句话**：裁剪改的是"这一帧画不画"，不是"这个控件存不存在"；而"画不画"必须按**子树真实外接矩形**算——布局矩形只描述节点自己，`fill`、绝对定位、虚拟化列表都能让子节点跑到它外面去。

## 8.71 Phaser 交给场景插件的第三个参数是条目的 **`mapping`**，不是 `key`（第 110 轮）

做"插件选项从 Game Config 传进去"时踩到的第一条坑，而且是**静默**的：条目 `{ key: 'MVVMPlugin', plugin: MVVMPlugin, mapping: 'mvvm', data: { transition: { enter: 320 } } }` 写得好好的，`#/config` 里读回来却是默认值 120。

根因在 Phaser 4.2.1 的两条不同代码路径（`src/plugins/PluginManager.js`）：

| 路径                                      | 实例化语句                                                       | 第三个参数                  |
| ----------------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| `plugins.scene`（Game Config）            | `addToScene` 第 273 行：`new source.plugin(scene, this, mapKey)` | `source.mapping` → `'mvvm'` |
| `installScenePlugin()`（运行时 / Loader） | 第 388 行：`new plugin(addToScene, this, key)`                   | `key` → `'MVVMPlugin'`      |

`ScenePlugin` 只是把这个值存成 `pluginKey`，所以**同一个插件在两条路径下的 `pluginKey` 不一样**。只按 `entry.key === pluginKey` 找条目，在 Game Config 路径上永远匹配不到；而"找不到"与"没配置"在读回值上完全一样，唯一的痕迹是选项没生效。

修法：`pluginConfigFromGameConfig(entries, pluginKey)` 同时比 `key` 与 `mapping`（两者都标识这个插件），并且拒绝空 `pluginKey`——否则它会匹配上每一条既没有 `key` 也没有 `mapping` 的条目。

**判据一句话**：读 Phaser 的内部状态前，先确认这个值是从**哪条调用路径**来的；同一个字段在不同路径下可能装着不同的东西，而"读不到"与"没设置"长得一模一样。

## 8.72 吸附网格必须跟着**绘制缓冲**走，而字形必须按**显示倍率**烘焙（第 111 轮 V79）

起因是"画面有点糊、文字和边框总像蒙了层纱"这一句主观描述，最后量出了两条互不相同、又被同一组数字放大的原因。**两条都出在"屏幕多密"被当成了一个数**：Phaser 的画布后备缓冲永远等于 `gameSize`，而屏幕密度与它无关。

实测环境（`Scale.FIT` 的 450×900 设计、竖屏、`devicePixelRatio = 2`）：

| 量                  | 值             |
| ------------------- | -------------- |
| 设计分辨率          | 450 × 900      |
| 画布**后备缓冲**    | **450 × 900**  |
| 画布 CSS 尺寸       | 338.5 × 677    |
| 屏幕上**物理**像素  | **677 × 1354** |
| 物理像素 / 布局单位 | **1.504**      |

**原因一（主因）：位图被浏览器放大了 1.5 倍。** 450 宽的位图铺在 677 个物理像素上，整张画面（棋盘、棋子、字形）都是双线性放大的结果。Phaser 4.2.1 的 `ScaleManager` 里**没有任何 `devicePixelRatio` 支持**（`src/scale/ScaleManager.js` 全文只有一处无关的 `resolution` 字样），`FIT`/`RESIZE` 都只在 **CSS 像素**上缩放画布，所以后备缓冲永远是设计分辨率。矢量图形（矩形、描边、圆角）是**在相机变换之后**光栅化的，位图密一点就够用；但 `Phaser.GameObjects.Text` 的字形是**构造时画进一张画布纹理**的 —— 它的清晰度在那一刻就定死了，之后的放大只能把它变糊。

**原因二：`UIRoot` 的吸附网格默认用 `window.devicePixelRatio`，而缓冲只有 1 像素/布局单位。** 于是矩形被吸附到 **.5** 上：

```
menuTitle  x=149.5  w=151   h=72.5
Label      x=146.5  y=108.5 w=157  h=16.5
```

在 1× 缓冲里，`.5` 的位置**只能**被光栅化成两个各半亮的像素 —— 边框和文字框因此发虚。这条吸附本身是对的，错的是它的**前提**：只有"一个布局单位覆盖多个缓冲像素"（相机 `setZoom(2)`、容器 `setScale(2)`，或应用自己把缓冲放大）时，设备像素网格才落在缓冲能表示的范围内。

修法两条，互不替代：

1. **`UIRootOptions.dpr` 的默认值改成 `1`**（= 缓冲像素/布局单位），文档写清它**不是** `devicePixelRatio`；把内容渲染得比布局空间更大时才手动填那个倍率。
2. **字形按显示倍率烘焙**：`Widget#textResolution` → `MVVMPlugin#textResolution`，值为 `devicePixelRatio × 画布 CSS 宽 ÷ gameSize`，取整到 ½ 档、上限 2（纹理面积随倍率平方增长，3× 手机上 9 倍的字形内存不是默认值该做的决定）。`Text.style.resolution` 只加密纹理，**不改布局尺寸**（两个渲染器都用 `frame.source.resolution` 去除），所以测量、排布、命中测试全部不动。想按自己的预算调就 `MVVMPlugin.configure({ textResolution: 1 })`；要烘焙自己的资源（棋子、筹码）读 `this.mvvm.renderScale`。

**实测（在真实应用上做的 A/B，只改吸附网格、只重排不重建）**：强边缘像素 2915 → 3906（+34%），最锐的梯度 88.6 → 99.5 —— 也就是说这一条确实消掉了"半像素双亮"，但它修不了字形被放大这件事，两条必须都做。

**判据一句话**：**"屏幕多密"有三个不同的数** —— 缓冲像素/布局单位（决定吸附网格，Phaser 下恒为 1）、物理像素/布局单位（决定字形烘焙倍率与自烘焙资源尺寸）、CSS 像素/布局单位（决定输入与 DOM 桥的换算）。先问自己要用哪一个，别拿 `window.devicePixelRatio` 一概而论。

## 8.73 设备分辨率渲染：`designResolution` 这一趟，以及"变焦之后相机在看哪儿"（第 112 轮）

§8.72 修的是"吸附网格"和"字形烘焙"两条局部原因；它们对**矢量绘制**（面板描边、棋盘格线、任何每帧 `Graphics`）无能为力：那些图形是在相机变换**之后**、按**缓冲分辨率**光栅化的，而缓冲永远等于 `gameSize`。所以只要游戏用设计分辨率（`Scale.FIT` + 450×900），在 2× 屏上画布就是一张 450×900 的位图铺在 780×1560 个物理像素上 —— 整幅画面被浏览器放大 1.73 倍，格线变成一条 3 设备像素、两端渐变的糊线。

要让矢量图形也变锐，只有一条路：**把游戏本身做成设备分辨率**（`gameSize = 设计 × dpr`），再用**相机缩放**把设计空间放大回来。框架为此提供 `UIRootOptions.designResolution`（`MVVMPlugin.configure({ designResolution: { width, height } })`），它一次性回答四个问题：

| 派生量                                | 公式                                  | 不说会怎样                           |
| ------------------------------------- | ------------------------------------- | ------------------------------------ |
| 根的布局尺寸                          | `designResolution`（否则 `gameSize`） | 页面在 900×1800 里排版，整体缩小一半 |
| 吸附网格 `layoutEngine.dpr`           | `gameSize.width ÷ design.width`       | 回到 §8.72 的半像素                  |
| 字形烘焙倍率 `MVVMPlugin#renderScale` | `dpr × 画布 CSS 宽 ÷ **布局宽**`      | 用 gameSize 当分母会少算整整一个倍率 |
| DOM 桥的 `displayScale`               | `renderScale ÷ dpr`                   | 隐藏输入框位置错一倍（IME 飘走）     |

**第一个坑（我在这轮真踩了）：只 `setZoom(dpr)` 是不够的，画面会只剩设计框的一角。** Phaser 的相机在 `Camera.preRender` 里算的是 `midPoint = scroll + gameSize/2`、`worldView = midPoint ± (gameSize ÷ zoom)/2` —— 也就是说 zoom 只影响"看到多大范围"，**不影响看的是哪一块**。gameSize 变成 900×1800 之后，scroll 仍是 (0,0)，于是可视世界是 [225,675]×[450,1350]，正好是设计框的右下那四分之一。实测症状很迷惑：画面"看起来是对的"（棋子、格线都锐了），只是棋盘被推到左上角裁掉一半，而且**点击全都落空**（`point(square)` 给的页面坐标映射到的世界坐标在设计框之外）。修法是把它对准设计框中心：

```ts
const camera = scene.cameras.main;
camera.setZoom(RENDER_SCALE);
camera.centerOn(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2); // 缺这一行 = 只看到设计框的四分之一
```

修后实测 `worldView = [0, 0, 450, 900]`（正好是设计框），真实点击走子 `ply 1 → 3`，框架按钮（`widgetPoint('开始Button')` 那条路径）在缩放相机下也照常触发。

**第二个坑：相机放大不了细节，只能放大已有的像素。** 凡是"烘焙过一次"的东西都得自己按倍率重做，否则开了设备分辨率反而**更糊**（缓冲变大而纹理没变大 = 放大倍数从 1.73 变成 2.0）：

- `Graphics.generateTexture` 的贴图：不用改任何绘制代码，在 `generateTexture` 之前 `graphics.setScale(BAKE_SCALE)` 即可 —— 它内部走 `SetTransform`，会应用 `Graphics` 自己的变换（Phaser 4.2.1 `Graphics.js:1532` → `GraphicsCanvasRenderer` → `SetTransform`）。但**只给那些"消费者一定会 `setDisplaySize`"的贴图加密**：按原始尺寸显示的粒子（`spark`/`petal`，以及 `fx` 用 `setScale` 补间的 `ring`）会直接被撑大。
- `Phaser.Text`：`style.resolution` 是唯一入口（Phaser 4 里 `resolution` 缺省被强制成 1，没有 Game Config 通道）。**注意它和 `setScale` 相乘**：一个 `fontSize: 52` 且 `setScale(1.8)` 的标题要 `resolution: 倍率 × 1.8`，否则仍然被放大。框架自己的控件走 `textResolution`（§8.72），游戏自己的 `scene.add.text` 得自己填。
- 显示尺寸是一道必须走的账：贴图加密之后，凡是没写 `setDisplaySize` 的地方都会变成"图变大了"，而不是"图变清楚了"。

**实测（揭棋，dpr 2 / 390×844 / `Scale.FIT`）**：

| 量                       | 修前                                  | 修后                              |
| ------------------------ | ------------------------------------- | --------------------------------- |
| 画布后备缓冲             | 450 × 900                             | **900 × 1800**                    |
| 物理像素（画布 CSS×dpr） | 780 × 1560                            | 780 × 1560（不变）                |
| 缓冲 ÷ 物理              | 放大 1.733 倍                         | **缩小 0.867 倍**                 |
| 棋盘格线剖面（一条竖线） | `109,87,74,77,88,131`（没有实心像素） | `102,72,72,72,84,148`（有实心核） |
| 强边缘像素               | 3308                                  | **15281**                         |
| 最锐梯度（p99.95）       | 86.2                                  | **121.7**                         |
| 棋子圆盘贴图             | 46 × 46                               | 92 × 92（`BAKE_SCALE`）           |

**判据一句话**：设备分辨率渲染是**三件事**同时成立 —— 游戏尺寸放大、相机**缩放并对准**设计框、每一份"烘焙过的像素"（贴图、字形）都按同一倍率重做；少任何一件，都会以"更糊"或"点到别处"的形式还回来。

---

## 8.74 画焦点环要判 `focusVisible`，不是 `focused`（第 113 轮 V81）

**现象**：鼠标点过的按钮一直带着一个蓝框，直到焦点被别的东西拿走；而任何想"让它别带框"的尝试都失败——`focus: { ring: false }` 完全没有效果。

**根因（两层）**：

1. **一个读数被当成两件事用**。第 68 轮修 P2（指针按下不聚焦）之后，`focused` 同时承担"行为"（`Tab` 从哪继续、`Enter` 激活谁、无障碍镜像报什么、`visualState` 说什么）与"像素"（`paintFocusRing` 画不画）。四个画环点（`Button`/`Panel`/`Slider`/`TextInputBase`）判的都是 `this.focused`，所以**"焦点存在"必然等于"焦点被画出来"**，中间没有任何表达空间。
2. **一个只写不读的开关**。`FocusManagerOptions.ring` 被构造参数收下、被 `mvvm.configure()` 写进字段，然后没有任何渲染代码读它。文档说它是"建议性开关"，读起来像"关掉就没了"，实际是"关掉什么也不会发生"。这类死选项比"没有这个选项"更坏：它让人以为问题已经解决了。

**修法**（[ADR-0012](./adr/0012-focus-visible-ring.md)）：把"可见性"单独建模，采用 CSS `:focus-visible` 的规则。

| 来源                                        | `focused` | `focusVisible` | 谁决定                                                                            |
| ------------------------------------------- | --------- | -------------- | --------------------------------------------------------------------------------- |
| 指针按下                                    | `true`    | `false`        | `FocusManager#focus(widget, { pointer: true })`，插件在 `onPointerFocus` 里标来源 |
| 指针按下，但控件打开了 `focusRingOnPointer` | `true`    | `true`         | 控件自己（`TextInputBase` 打开它，跟浏览器对点击 `<input>` 的例外一致）           |
| `Tab` / 方向键 / 手柄 / `widget.focus()`    | `true`    | `true`         | 默认                                                                              |
| 任意来源 + `focus: { ring: false }`         | `true`    | `false`        | 全局 `FocusManager#ring`                                                          |

五条落地纪律：

1. **控件画环一律判 `focusVisible`**，`focused` 留给行为。`Widget#focusVisible` = 持有焦点 ∧ 本次请求允许可见 ∧ 全局 `ring`。
2. **`visualState` 不动**。鼠标点过的按钮仍然是 `focused` 状态（`#/states` 的 `st.*`、`#/gallery` 的焦点集合、`#/states` 的 §2.3 迁移矩阵都还成立）——"状态是 `focused` 但没画环"是**正常组合**，不是 bug。
3. **变可见性 ≠ 变焦点**。`setFocusedInternal(value, focusVisible)` 只有可见性变化时重画、**不发** `widget:focus`/`widget:blur`（第 110 轮 V63 的教训：事件名承诺的是变化）。
4. **销毁时两个标志一起清**（`_focused` 与 `_focusVisible`）。只清一个的话，路由/焦点管理器在下一帧的"再推一次 false"会被当成真变化，去重画已经释放的 `Graphics`——这正是 `_hovered`/`_pressed` 当初被一起清掉的原因。
5. **皮肤自己画焦点配色的控件要一起折进来**。`textInputSkinStyles.focused` 的边框色**就是** `focusRing`，所以全局 `ring: false` 只压 `Graphics` 环的话，字段上还会留一圈同色边框（同一信息画两处）——`TextInputBase#skinState()` 在状态进入皮肤之前就把可见性折掉了。

**判据一句话**：`focused` 管**焦点在谁身上**，`focusVisible` 管**要不要把它指出来**；任何一处把这两者混用，都会以"点过的按钮一直带框"或"键盘用户不知道焦点在哪"的形式还回来。

**三个隐含条件（第 113 轮踩过，V82）**——把"画不画环"变成第二个判据之后，有三处早退/缓存会静默吃掉它：

1. **焦点没动 ≠ 可见性没变**。`FocusManager#applyFocus` 在"焦点已经在这个控件上"时本来直接早退，于是**对话框打开时被 `focusFirst` 聚焦的那个控件，用户再点它一下，环不会消失**——这正是消费方（揭棋）第一次点音量滑杆时看到的画面。早退之前必须把新的可见性请求交给控件（`setFocusedInternal` 只重画、不发事件，因为焦点确实没动）。
2. **绘制缓存里要有它**。`Slider` 是唯一把绘制结果缓存的控件（`styleKey`），而它的键里有 `visualState` 却没有 `focusVisible`：`focus: { ring: false }` 只改可见性、不改状态 → 键不变 → 不重画 → 环留在屏幕上。陈旧画笔的**签名**很好认：切一次主题（或任何顺带重画的事）它自己就好了——实测亮色半场自愈、暗色半场还挂着。
3. **"没有来源"的焦点变化要跟随最后一次输入的模态**（V83）。`Tab`/手柄是显式来源，指针按下也是，但**对话框 `focusFirst`、页面栈 `pop` 还原、`widget.focus()` 都没有来源**——一律按"可见"处理的话，触摸游戏点开音量对话框就会看到第一个滑杆戴着一个框，而那个框是**上一次点击的后果**（点击已经说明发生了什么）。规则：写入点是插件的两个输入漏斗（`onPointerFocus` 与 `dispatchAction`），读法是 `FocusManager#noteInput`/`visibleFor()`——最后一次是触摸/鼠标就不画，是键盘/手柄就画，任何输入之前保守地画。
4. **皮肤自己画焦点配色的控件要一起折进来**（`textInputSkinStyles.focused` 的边框就是 `focusRing` 色），否则全局关掉环之后还剩一圈同色边框。

**读数 / 门禁**：`#/states` 的 `#demo-state` 逐帧发 `ring.<name>=on|off`，`window.states.ring()` 读实时的 `{ focused, ringOn }`（[`ACCEPTANCE-states.md`](./ACCEPTANCE-states.md) §10）。常驻门禁是 `visual-check` 里 `#/states` 的**四条臂**——`states.pointer`（真鼠标点按钮）、`states.tab`（真 `Tab`）、`states.pressFocused`（`Tab` 聚焦滑杆**再**点它）、`states.ringGate`（`Tab` 聚焦滑杆**再**切 `ring: false`）；点过的必须与没碰过的邻居同色、键盘聚焦的必须读环色、两条"之后"的必须回到卡片底色，明暗两套。三条阳性对照分别钉住三个判据（`Button` 判据、`applyFocus` 的降级、`Slider` 的缓存键），第二条会同时打红断言与两条像素，第三条只打红暗色半场——见 [`ACCEPTANCE-states.md`](./ACCEPTANCE-states.md) §10.1。
