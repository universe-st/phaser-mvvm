# ADR-0010：指针事件链（Android 风格的传递 / 拦截 / 消费）

- **状态**：已接受（2026-09）
- **相关**：ADR-0009（相机钉住的 UI 与指针命中）、`packages/phaser/src/pointer-chain.ts`、`packages/phaser/src/input.ts`、`packages/phaser/src/Widget.ts`、`packages/phaser/src/pointer-claim.ts`

## 背景

在这之前，框架的指针语义只有一条：**命中测试**（`resolveTargetInTree`，最深优先）。它回答「指针下面是哪个控件」，对叶子上的单击足够，对**嵌套**不够。三轮实战各暴露了一半：

1. **拖动归属**（V24/V37）：文本域在自己的 `pointerdown` 里 `claimPointerDrag()`，`ScrollView` 在越过阈值时用 `pointerDragOwner()` 问一句「有人认领吗」。这套协议只解决「谁先谁后」，没有「谁在过程中被通知失去了手势」——被抢走的一方只能靠自己下一次检查发现。
2. **口套口**（V37）：内层口滚到尽头后要让手势传给外层，靠的是每个口在每次移动里各自判断「我还能吃多少」；层级越深，判断越散，而且没有任何一层能在中途**接管**已经发出的手势。
3. **点击 vs 拖拽**（V24 的邻居）：按下后是否算点击，由路由器在 `pointerup` 时按位移阈值判定；一个在移动过程中才决定「这是拖动」的容器没有办法**收回**已经发给子控件的按下。

共同点是缺同一件东西：**一条有序的传递链**，以及「谁能在中途把手势拿走、被拿走的人怎么被告知」。

Android 在 `ViewGroup.dispatchTouchEvent` / `onInterceptTouchEvent` / `onTouchEvent` 里把这件事定死了，本项目的场景与它一一对应（`ScrollView` ≈ `ScrollView`、`TextField` ≈ `EditText`、`Panel` ≈ `ViewGroup`），因此直接照搬它的语义，而不是再发明一套。

## 决策

1. **新增纯逻辑内核 `pointer-chain.ts`（`PointerChainHub`）**：无 Phaser 依赖（连类型都不引），在 Node 里单测。它只做四件事——按路径分发、询问拦截、调用处理、保留手势。
2. **一次手势的语义（与 Android 对齐）**：
   - `down`：由命中测试得到**路径**（根 → 最深目标）。自根向下逐个询问 `onPointerIntercept`（只问还有更深节点的那些），第一个返回 `true` 的把事件拿走、不再向下；否则走到最深节点调用 `onPointerEvent`，返回 `true` 即**消费**，`false` 则**向上冒泡**给父节点。
   - 消费 `down` 的节点**拥有这次手势**：`move`/`up` 只沿**保留的路径**投递给它（以及它的祖先），**从不重新命中测试**。指针离开控件、离开嵌套口、离开画布，事件照样送达。这是整套机制存在的理由。
   - 手势进行中，保留路径上的祖先仍可拦截。拦截发生时，当前拥有者收到 `cancel`（`PointerChainEvent.cancelReason` 写明是谁抢的），拦截者成为新的拥有者。
   - `up` 一定清除手势；没有任何节点消费 `down` 时**不保留**任何手势（零开销，也让「没有 handler 的树行为完全不变」成立）。
   - 一个指针 id = 一次手势，多指互不干扰。
3. **拒绝拦截**：`Widget#requestDisallowInterceptPointer(pointerId)`（Android 的 `requestDisallowInterceptTouchEvent`）禁止该指针的**所有祖先**拦截。它复用已有的认领表（`pointer-claim.ts`）——「谁拥有这个指针」只有一个家，不是两套会打架的记录。文本域拖选因此天然免疫外层滚动口的接管。
4. **控件侧 API（`Widget`）**：
   - `onPointerIntercept(event): boolean` —— Android 的 `onInterceptTouchEvent`，容器在事件下行时先看；
   - `onPointerEvent(event): boolean` —— Android 的 `onTouchEvent`，返回 `true` 即消费；
   - 两者同时是**选项键**（`WidgetOptions` 及 `PointerChainOptionHooks`，混入每个控件的选项接口），所以 `Panel({ onPointerEvent })` 在类型上、审计上、运行期三处一致（V74 的教训：审计接受、类型拒绝、构造时静默丢掉）；
   - `event.x/y` 是**当前节点自己的坐标系**（与命中测试同一套换算），`event.inside` 说明指针是否还在这个控件里，`event.stageX/stageY` 是根空间坐标，`event.dx/dy` 是本次手势的位移；一次分发里传给所有钩子的是**同一个事件对象**（逐节点改写，Android 的 `MotionEvent` 同样如此），所以钩子不该把它存起来。
5. **与既有「点击机器」的关系**：不是替换，是前置。
   - 没有任何节点消费时，按下/悬停/激活/`dragThreshold` 的老路径**原样执行**（这正是所有既有 demo 不受影响的原因）。
   - 手势被**消费**（`handledBy !== null`）：焦点、`pressed` 外观照旧（用户确实按了这个控件），但**不再触发 `activate()`**——控件已经说了「这次手势我自己处理」。
   - 按下被**拦截**（`stop === 'intercepted'`）：目标从未收到 `down`，因此既不留按下状态、也不移动焦点、更不会在抬手时变成点击。没有这一条，拦截形同虚设（`#/events` 实测：`l2` 拦截后叶子仍然 `onClick` 了一次）。
6. **move/up 由每帧轮询投递**（不监听场景级事件流）：与悬停一样，「指针状态」是状态不是事件流——Phaser 只把 `pointermove/up` 交给指针**仍在上面**的对象，而拖动恰恰会离开它。轮询因此同时解决三件事：离开控件后的继续投递、抬手落在空白处/游戏对象上时补发 `up`、以及指针消失时清理。
7. **cancel 的触发点**（缺一个就会留下"还在收事件"的幽灵手势）：拥有者或其路径上的节点被卸载（`unregister`）/ 被销毁 / `routingEnabled` 变 `false` / 指针不再存在 / 拦截层变化（模态打开，`setCapture`）/ 路由 `detach()`。
8. **可观测性是一等公民**：每次分发产出 `PointerChainTrace`（投递顺序、每步的答案、停在哪、谁拥有），`InputRouter#lastChain` / `#chains()` / `onPointerChain` 三个读数出口。单测直接断言 trace，浏览器里 `#/events` 把它渲染成实时日志。

## 后果

- **嵌套稳定性成为可验证的性质**，而不是每层各自小心的结果：五层嵌套下实测（`#/events`，见 [`ACCEPTANCE-events.md`](../ACCEPTANCE-events.md)）拖动 300px 离开盒子后仍有 12 次 `move` 与那次 `up` 送达叶子（`inside=false`）；`l2` 在 20px 处拦截时叶子收到 `cancel`、拥有者换成 `l2`；叶子 `disallow` 后祖先的 `onPointerIntercept` **一次都没被调用**（trace 里标 `!`）。
- **既有行为零变化**：控件库里没有任何控件设置这两个钩子，所以链永远是「全部拒绝」，点击机器照常。回归实测见验收记录。
- **认领协议被吸收**：`claimPointerDrag` 现在同时是「拒绝拦截」的登记表，`ScrollView`/`TextInputBase` 的既有协作不需要改写一句就能与链共存；将来把 `ScrollView` 改成用 `onPointerIntercept` 表达「越过阈值才接管」时，两者已经说同一句话。
- **新增门禁**：`packages/phaser/test/pointer-chain.test.ts`（30 条：投递顺序、冒泡、拦截、cancel、disallow、多指、owner 离开树、事件对象复用契约）与常驻场景 `#/events`。改动 `InputRouter` 的命中/分发逻辑前先跑这两样。
- **文档**：指南 [07 §2.1](../guide/07-input-focus-nav.md) 是用法；本文是语义；`docs/PITFALLS.md` §8.69 记录两条实测踩坑（消费抑制点击、读数标签重排导致探针漂移）。

## 证据

- 单测：`pnpm --filter @phaser-mvvm/phaser run test` → 23 文件 / 370 条通过（其中 `pointer-chain.test.ts` 30 条）；全仓 `pnpm test` → 1352 条通过。
- 浏览器：`#/events` 的真实鼠标矩阵（A 普通点击仍激活 / B 消费后不再激活 / C 拦截后叶子完全不知情 / D 拖出盒子仍收到 move+up / E disallow 后祖先不被询问 / F 20px 阈值中途夺取 + cancel / G 外部 cancel），读数见 [`ACCEPTANCE-events.md`](../ACCEPTANCE-events.md)。
- 回归：`#/showcase`、`#/states`、`#/gallery`、`#/modal`、`#/pages`、`#/hud`、`#/form`、`#/scroll`、`#/list`、`#/keyboard`、`#/bindings`、`#/router`、`#/uiscene` 用真实指针/键盘复跑，读数全部符合各自验收记录；22 个场景冷启动无 console 错误。
