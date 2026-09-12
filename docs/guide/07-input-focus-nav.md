# 07 · 交互：指针、焦点与导航

本章目标：让页面在**鼠标、键盘、手柄**三种输入下都能用，并知道每层是谁在管事。

> 对应示例：[`#/gallery`](../../apps/examples/src/scenes/gallery.ts)（Tab/方向键焦点 + 开关按钮）、[`#/scroll`](../../apps/examples/src/scenes/scroll.ts)（键盘滚动 + 嵌套滚轮）。

> **本章代码用 Compose 风格 DSL 书写**（[09 章](./09-compose-dsl.md)）：焦点相关的选项（`focusOrder`、`focusable`、`disabled`）与工厂写法完全通用，`FocusManager`/`InputRouter` 则始终通过 `this.mvvm.focus` / `this.mvvm.input` 操作，与你怎么建控件无关。

---

## 1. 三层分工

| 层       | 类 / 模块      | 负责                                                         | 入口              |
| -------- | -------------- | ------------------------------------------------------------ | ----------------- |
| 指针路由 | `InputRouter`  | 悬停、按下、点击判定、拦截层、`disabled` 屏蔽                | `this.mvvm.input` |
| 焦点管理 | `FocusManager` | 焦点集合、Tab 顺序、方向导航、激活、**作用域栈（模态陷阱）** | `this.mvvm.focus` |
| 设备映射 | `nav.ts`       | 把键盘事件/手柄状态翻译成统一动作（`NavAction`）             | 由插件自动接入    |

统一词汇 `NavAction`：`'next' | 'prev' | 'up' | 'down' | 'left' | 'right' | 'activate' | 'back'`。控件**不需要知道**用户用的是键盘还是手柄 —— 它们只会在被激活时收到 `source`。

---

## 2. `InputRouter`：指针语义

Phaser 已经负责命中测试，路由层补的是「控件语义」：

| 行为              | 规则                                                                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 悬停              | **每帧重新推导**「指针下最深的控件」，而不是镜像 `pointerover/out` 事件流。所以控件被移动、隐藏、重建，或指针移出画布，悬停状态都不会残留                                                                                                                                                                            |
| 点击 vs 拖拽      | 按下到抬起的位移 **小于 `dragThreshold`（默认 8px）** 才算点击。这条让「拖列表」不会顺带点中行内按钮                                                                                                                                                                                                                 |
| `disabled`        | 被禁用的控件永不悬停、永不被按下、永不激活；「悬停中变禁用」由每帧轮询纠正                                                                                                                                                                                                                                           |
| 按下即聚焦        | 按下的控件若 `focusable` 且未禁用，输入路由会把它交给 `FocusManager`（`InputRouter.onPointerFocus`，插件已接好）。这样焦点环出现在鼠标点的位置，随后的 `Tab`/方向键从那里继续，而不是跳回第一个可聚焦控件                                                                                                            |
| 拦截层（capture） | 设置 capture 控件（通常是模态遮罩）后，落在它命中区内、但在它子树之外的指针事件会被吞掉，防止点穿到下层                                                                                                                                                                                                              |
| 不穿透到游戏世界  | 指针落在**任何** UI 目标上时，这次按下由 UI 消费：Phaser 的 `topOnly` 保持开启，UI 之下的游戏对象收不到它（面板的拦截层因此是真的——`Panel.blockPointer` 默认 `true`）。落在没有 UI 目标的位置时照常传给游戏对象。这条由输入路由从**坐标**解析目标，而不是靠「哪个对象收到了事件」，所以容器/子节点的绘制顺序不影响它 |
| 裁剪也裁剪命中    | 被 `ScrollView` 遮罩裁掉的内容，在它的逻辑位置上**既不悬停也不可点**（`clipsPointer`）：点滚动区外面的空白不会触发看不见的行（V23）                                                                                                                                                                                  |
| 命中区            | 交互控件需要命中区，`enablePointerInput()` 会按布局分配的矩形自动维护（缩放/重排后自动同步）                                                                                                                                                                                                                         |

```ts
// 运行期调整点击阈值：InputRouter 的公开字段
this.mvvm.input.dragThreshold = 12;
```

> ⚠️ **不要在 Game Config 的 `plugins.scene` 条目里传插件选项**：Phaser 只读 `key`/`plugin`/`mapping`，并以 `new Plugin(scene, pluginManager, mapKey)` 实例化，`MVVMPluginConfig`（`input`/`focus`/`onBack`/`navigation`/`themeBackground`）**传不进去**，写了也不会生效。正确写法：**游戏级**用 `MVVMPlugin.configure({ … })`（创建游戏之前调一次），**单场景**用 `this.mvvm.configure({ … })`，公开字段与可写属性照旧可用（见 06 §6.1）。**唯一例外是 `back`**：`FocusManager.onBack` 是插件安装路由钩子的地方，直接覆盖它会让 `Esc` 不再关对话框、不再返回上一页（开发模式下框架会打印一条警告）；应用级的返回处理请写 `this.mvvm.onBack = …`。

`this.mvvm.input` 的常用成员：

| 成员                                | 说明                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `refresh()`                         | 重新收集交互控件。`this.mvvm.mount()` 会立刻刷新；`addWidget` 之类的结构变化由插件在**下一次 `PRE_UPDATE`** 自动刷新 |
| `setCapture(widget \| null)`        | 设置/清除拦截层（对话框遮罩）；会顺手给它开命中区                                                                    |
| `get capture`                       | 当前拦截控件                                                                                                         |
| `update(time, delta)`               | 每帧重算悬停（插件自动调用）                                                                                         |
| `attach(root, scene?)` / `detach()` | 手动接管路由时使用                                                                                                   |

> **谁算「交互控件」**：具有命中区的控件。`Button`/`TextField`/`TextArea` 在构造时就调用 `enablePointerInput()`；`ScrollView` 只是 `focusable`，它的命中区由 `InputRouter.refresh()` 统一补上（它自己注册的是画布 `wheel` 与场景指针监听）；`Panel` 默认 `blockPointer: true`（用于拦截），只有 `interactive: true` 时才可聚焦。

---

## 3. `FocusManager`：焦点与遍历

只有 `focusable === true` 的控件会进入焦点集合。当前是谁：

| 控件                                     | 默认可聚焦 | 说明             |
| ---------------------------------------- | ---------- | ---------------- |
| `Button`                                 | ✅         | 主要交互控件     |
| `TextField` / `TextArea`                 | ✅         | 聚焦后接管编辑键 |
| `ScrollView`                             | ✅         | 聚焦后接管滚动键 |
| `Panel`（`interactive: true`）           | ✅         | 可点击卡片       |
| `Label` / `Image` / `Spacer` / `Divider` | ❌         | 不参与焦点       |

焦点状态的**优先级**（`resolveWidgetState`）：`disabled` > `error` > `pressed` > `hover` > `focused`。也就是说鼠标停在已聚焦的按钮上时，它显示 `hover` 而不是 `focused`——移开指针才会看到焦点环；`error` 高于 `focused`，所以聚焦一个校验失败的输入框仍然是错误样式。

### 键盘映射

| 按键          | 动作                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `Tab`         | `next`（下一个焦点）                                                                  |
| `Shift+Tab`   | `prev`（上一个焦点）                                                                  |
| `↑ ↓ ← →`     | 几何方向导航（找最近的邻居，见下）                                                    |
| `Enter`、空格 | `activate`（激活当前焦点控件）                                                        |
| `Escape`      | `back` → **逐层路由**：先给模态栈，再给页面栈，最后才交给 `this.mvvm.onBack`（见 §7） |

带 `Ctrl`/`Cmd`/`Alt` 的组合键**不会被吞**，浏览器快捷键（复制/刷新/开发者工具）照常工作。

### 控件先挑键：`Widget.onKeyDown`

上表是**默认**映射。有焦点的控件可以先拿走它自己要用的键——`MVVMPlugin` 在导航之前问一次：

```ts
class MyControl extends Widget {
  constructor(scene: Phaser.Scene) {
    super(scene);
    // 返回 true = 这个键我用了（插件会 preventDefault 并跳过导航）
    this.onKeyDown = (event) => (event.key === 'ArrowUp' ? (this.bump(+1), true) : false);
  }
}
```

返回 `false`/`undefined` 就把键交还给焦点管理器，所以 `Tab`/`Enter`/`Escape` 在默认实现下永远还是导航。当前的使用者：

| 控件            | 拿走的键                                                        | 行为                                                                                                                        |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Slider`        | `← → ↑ ↓`、`Home`/`End`、`PageUp`/`PageDown`                    | 按步长/一页/两端移动值（04 章的 `Slider`）                                                                                  |
| `ScrollView`    | `↑ ↓`（垂直）、`← →`（横向）、`PageUp`/`PageDown`、`Home`/`End` | 按行/按页/到两端滚动                                                                                                        |
| `TextInputBase` | 光标键、`Backspace`、`Delete`、`Home`/`End` 等                  | **不走这个钩子**：文本框用的是隐藏 DOM 输入框，按键在 DOM 层就被 `stopPropagation()` 拦下（光标必须由浏览器处理），效果等价 |

三种机制里，前两种共用这个钩子；如果你要给自己的控件加键盘语义，**优先用钩子**，不要照抄早期的 `window.addEventListener('keydown', …, true)` 写法（`ScrollView` 第 42 轮已改成钩子，就是为了去掉每个实例一个全局监听）。

### 方向导航的「漏斗」

`move(direction)` 不是简单的「下一个」，而是几何选择：

1. 候选必须落在目标方向的半平面里（中心点严格在那边）；
2. 候选与当前控件的**切向偏移**必须在容差内 —— 容差 = `max(当前矩形切向尺寸 × 0.6, 64px)`。这条让「一行 40px 高的列表行」也能用左右键横向走出来；
3. 在合格候选里选**主轴距离最近**的，距离相同则取切向偏移更小的。

**第 4 条：不抢自己里面的控件。** 容器的盒子里包含它内部的一切，所以"下方最近的候选"经常就是那个容器本身（`#/a11y` 实测：焦点在滚动区的 `button1` 上，按一次 `D-Pad 下`，焦点变成了滚动区自己——口中心 542 比下一个按钮的 554 更近）。焦点落到容器上之后方向键只滚动、不再移动焦点，用户看到的就是"焦点没了"。

所以 `move()` 分两轮问：

1. **先排除包围当前焦点的祖先**（`containsWidget(candidate, focused)`）跑一轮；
2. 第一轮没有结果，**再带上它们**跑第二轮 —— 所以一个真的位于该方向的滚动区仍然可达，没有目标被藏起来。

这是第 67 轮的 [V34](../DEFECT-BACKLOG.md)；同轮的 [V35](../DEFECT-BACKLOG.md) 是它的另一半：滚动容器**滚到尽头后必须拒绝**这个方向，否则焦点会被永久困在容器里（手柄没有 `Tab` 可以绕开）。

### 焦点一定会被滚进视野

焦点是纯几何地移动的，它不知道有遮罩。所以每次焦点变化后，框架会沿 `parentContainer` 往上问每一个滚动容器（`Widget#revealDescendant` → `revealInViewports()`），把焦点控件滚进可见带。**你不需要做任何事**；只有自己写裁剪容器时才要实现这个方法，做法见 [05 章 §4.1](./05-lists-and-scroll.md)。

没有任何焦点时按方向键 = **进入焦点集合**（聚焦第一个），符合直觉。

### 顺序控制

```ts
Button('确定', { focusOrder: 10 }); // 数字小的先被 Tab 到
Button('取消', { focusOrder: 20 }); // 相同值保持控件树顺序
```

`focusOrder` 是排序提示，不是 `tabIndex`（`tabIndex` 已被 Phaser 的 `GameObject` 占用）。

### 监听焦点变化

```ts
this.mvvm.focus.onFocusChange = (widget) => {
  console.log('focused:', widget ? widget.name : 'none');
};
```

`onFocusChange` 是**可写属性**，不是事件。想读当前焦点用 `this.mvvm.focus.focusedWidget`。

### 直接操作焦点

```ts
widget.focus(); // 聚焦某个控件（等价于 this.mvvm.focus.focus(widget)）
widget.blur(); // 释放
this.mvvm.focus.next(); // 下一个
this.mvvm.focus.previous(); // 上一个
this.mvvm.focus.move('down'); // 几何移动
this.mvvm.focus.activate(); // 激活当前焦点（source 默认 'keyboard'）
this.mvvm.focus.refresh(); // 树变了之后重新收集（插件已自动做）
```

### `trapFocus`：焦点陷阱

模态对话框需要「焦点不逃逸」。`FocusManager` 提供了开关（`ModalStack` 属 **M8，尚未实现**，但你可以自己用）：

```ts
import { FocusManager } from '@phaser-mvvm/phaser';

const dialogFocus = new FocusManager({
  root: dialog,
  trapFocus: true, // 遍历到边缘会环绕；blur() 无法释放焦点
  onBack: () => this.closeDialog(),
});
dialogFocus.next();
```

别忘了用完 `dialogFocus.dispose()`（等价于 `detach()`），否则控件的 `focusManager` 反向引用不会被清理。

---

## 4. 手柄与长按连发

| 项目         | 值 / 行为                                                                       |
| ------------ | ------------------------------------------------------------------------------- |
| 左摇杆死区   | `GAMEPAD_AXIS_THRESHOLD = 0.5`（轴绝对值 ≥ 0.5 才算按住）                       |
| 激活键       | `buttons[0]`（A/×）→ `activate`                                                 |
| 返回键       | `buttons[1]`（B/○）→ `back`                                                     |
| D-Pad / 摇杆 | 映射成 `up`/`down`/`left`/`right`，并经过 `NavRepeat` 节流                      |
| 连发节奏     | 首次按住立即触发，之后 `initialDelay = 350ms`，随后每 `repeatDelay = 90ms` 一次 |
| 边沿触发     | 激活/返回是**边沿触发**（按住不会重复提交），方向才是连发                       |

插件每帧轮询 0 号手柄，所以**不需要**你自己写 gamepad listener。想换映射或加第二个手柄，`nav.ts` 导出了纯函数（`gamepadStateOf`、`gamepadActionsOf`、`heldDirectionsOf`、`NavRepeat`），可以脱离 Phaser 单测。

> ⚠️ **游戏配置里必须开手柄**：`new Phaser.Game({ input: { gamepad: true } })`。Phaser 默认 `false`，此时插件轮询拿到的永远是空列表——示例应用直到第 64 轮才补上这一行（`#/gallery` 当时已经在文案里写着"gamepad supported"）。

**方向键和手柄完全同权**：两台设备的导航动作都先问"当前焦点控件要不要这个动作"（`Widget.onAction`），再交给焦点管理器。所以聚焦滑杆后，`→` 与 `D-Pad 右` 都是**调值**，而不是一个调值、一个把焦点搬走；聚焦滚动容器后，`↓` 与 `D-Pad 下` 都是**滚动**。`↑`/`↓` 在横向滑杆上是"离开"，这就是手柄用户不会被困在控件里的原因（第 64 轮修复的 V28；同一轮还用它验证了 `activate`/`back` 与连发）。

> **"认领"必须是诚实的**：控件只在**真的做了事**时才算消费这个动作。滑杆在最小值上按 `←`、滚动容器滚到尽头再按 `↓`，都要返回 `false` 把方向交出去，否则手柄用户会被永久困在里面（第 67 轮的 V35，实测见 [`ACCEPTANCE-scroll.md`](../ACCEPTANCE-scroll.md) §2.3）。

```ts
// 自定义连发节奏（想自己接管导航时）
import { NavRepeat } from '@phaser-mvvm/phaser';
const repeat = new NavRepeat({ initialDelay: 500, repeatDelay: 120 });
```

---

## 5. 焦点环怎么来的

`Button` 与 `Panel` 在绘制皮肤时会检查 `focused`，并用 `paintFocusRing` 画一圈 `theme.colors.focusRing` 的描边（宽度 `theme.focusRingWidth = 2`）。所以**焦点可见性默认就有**，不需要额外代码。

想自定义焦点样式，两种做法：

```ts
// A) 换主题里的焦点环颜色（所有控件一起变）
const theme = this.mvvm.theme;
this.mvvm.setTheme({
  ...theme,
  colors: { ...theme.colors, focusRing: 0xffd166 },
  focusRingWidth: 3,
});

// B) 只给某类控件换：自己写一个控件，覆盖 refreshAppearance()
//    （Button/Panel 的焦点环就是各自 refreshAppearance 里调 paintFocusRing 画的）
class MyCard extends Panel {
  protected override refreshAppearance(): void {
    super.refreshAppearance();
    if (this.focused) {
      // 换一种高亮方式，例如描一条更粗的边
    }
  }
}
```

`FocusManager` 的 `ring` 选项只是个**建议性开关**（默认 `true`），管理器自己不渲染任何东西。

---

## 6. 实战：模态对话框（焦点陷阱）

模态框要同时做到四件事：**画在最上面**、**挡住下面的指针**、**把焦点关在里面**、**`Escape` 把它关掉**。这四件事分散在三层里（层序在 Phaser 容器、拦截在 `InputRouter`、焦点在 `FocusManager`），所以框架把它们包成了一个入口：

```ts
const dialog = this.mvvm.modal.open(
  () => {
    Panel({ gap: 14, padding: 20, variant: 'surface', radius: 12, width: 420 }, () => {
      Text('删除这一项？', { size: 'lg' });
      Text('删除后无法恢复。按 Esc 或点遮罩可以取消。', { tone: 'muted' });
      Row({ gap: 8, justifyContent: 'end' }, () => {
        Button('取消', { variant: 'ghost', onClick: () => dialog.close() });
        Button('删除', { variant: 'danger', onClick: () => this.deleteSelected() });
      });
    });
  },
  { name: 'confirm.delete' },
);
```

`modal.open(content, options?)` 返回一个 `ModalHandle`：

| 成员                   | 说明                                                    |
| ---------------------- | ------------------------------------------------------- |
| `close(reason?)`       | 关闭（默认原因是 `'api'`）；返回 `false` 表示它已经关了 |
| `widget` / `content`   | 整个图层 / 你自己的内容根（都可以继续当普通控件用）     |
| `open` / `dismissible` | 是否还开着 / 是否允许 Esc 与遮罩关闭                    |
| `id`                   | 打开顺序，从 1 开始                                     |

选项：

| 选项           | 默认      | 说明                                                                                |
| -------------- | --------- | ----------------------------------------------------------------------------------- |
| `dismissible`  | `true`    | `false` 时 **Esc 与点遮罩都不关**（而且 Esc 会被吞掉，不会漏给页面自己的 `onBack`） |
| `scrim`        | `0.5`     | 遮罩不透明度；`0` 表示不画遮罩，但图层仍然挡住指针，点空白处依旧可以关闭            |
| `autoFocus`    | `true`    | 打开后立刻聚焦内容里第一个可聚焦控件                                                |
| `initialFocus` | —         | 指定打开后聚焦哪个控件                                                              |
| `transition`   | 策略默认  | 这一个对话框的动效：`false` 表示立刻出现/消失，或写一个 spec 覆盖策略（见 §6.1）    |
| `onClose`      | —         | 关闭时回调一次，参数是原因（`'api'` / `'back'` / `'backdrop'` / `'scene'`）         |
| `name`         | `modal#n` | 图层名，出现在 dev 轨迹与 `getByName` 里                                            |

`this.mvvm.modal` 上还有 `depth`、`top`、`handles`、`closeTop()`、`closeAll()` 与 `handleBack()`（`back` 动作先经过它再交给 `onBack`）。**可以叠多层**：`Esc` 只关最上面那层，关掉后焦点回到打开它的那个控件。

它替你做的事，逐条对应上面那三个「层」：

| 机制                             | 由谁实现                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| 图层是根容器的**最后一个子节点** | Phaser 容器的绘制顺序 = 子节点顺序；`mount()` 会把已开的图层重新抬到最上面 |
| 指针被挡住                       | 图层整块带有命中区并成为 `InputRouter` 的 capture（`setCapture`）          |
| 半透明遮罩 + 点遮罩关闭          | 主题色 `colors.overlay` 的矩形，带 `onActivate`                            |
| 焦点陷阱                         | `FocusManager.pushScope(layer, { trap: true })`                            |
| 关闭后焦点复原                   | `popScope()` 把焦点还给被挂起的那个控件                                    |
| `Esc`（含手柄 `B`/`○`）          | `Handle` → `modal.handleBack()`，插件已接在 `onBack` 之前                  |

> **触摸也一样**：点遮罩关闭用的是同一条 `onActivate`，而在遮罩/按钮上**拖动**不算点击（`InputRouter` 的 `dragThreshold`），所以手指滑一下不会误关对话框、也不会误触按钮（实测见 [`ACCEPTANCE-touch.md`](../ACCEPTANCE-touch.md) §3.7）。

> **不想要现成的模态框？** 上面每一层都可以自己搭：`ui()` 建一个 `Stack` 包住遮罩 + 对话框 → `this.mvvm.input.setCapture(mask)` → `this.mvvm.focus.pushScope(dialogRoot, { trap: true, focusFirst: true })`，关闭时 `popScope()` 并 `destroy()` 这个子树。`modal.open()` 就是这套流程的封装，验收记录见 [`ACCEPTANCE-modal.md`](../ACCEPTANCE-modal.md)。

### 6.1 开闭动效

对话框默认**淡入并轻微放大**（160 ms `outCubic`），关闭时**淡出**（120 ms `inCubic`）。策略在游戏级配置里定，逐对话框可以覆盖：

```ts
// 创建游戏之前：全游戏的默认动效
MVVMPlugin.configure({ transition: { enter: 200, exit: 0 } });

// 运行期：只改这个场景
this.mvvm.configure({ transition: { respectReducedMotion: false } });

// 单个对话框：不动效（例如一个必须立刻出现的提示）
this.mvvm.modal.open(
  () => {
    /* … */
  },
  { transition: false },
);
```

| 策略字段               | 默认   | 说明                                                                  |
| ---------------------- | ------ | --------------------------------------------------------------------- |
| `enabled`              | `true` | `false` 等于全局关掉动效                                              |
| `enter`                | `160`  | 进场时长（ms）；也可以写 `{ duration, easing, fromAlpha, fromScale }` |
| `exit`                 | `120`  | 出场时长（ms）；`0` 表示关闭即销毁（第 60 轮那条同步路径）            |
| `easing`               | —      | `'linear'` / `'inCubic'` / `'outCubic'` / `'inOutCubic'`              |
| `respectReducedMotion` | `true` | 系统要求减少动效时（`prefers-reduced-motion: reduce`）把时长折叠成 0  |

> 上表的默认时长不是写死的常量，而是**主题令牌** `theme.motion`（`{ enter, exit }`，毫秒）：换主题就换节奏；显式写在配置、逐层选项或 spec 里的时长优先（见指南 06 §6.2）。

**动效不改变关闭的语义**，这一点值得记住：`close()` 当帧就弹栈、归还焦点、把指针捕获交回下一层，`handle.open` 立刻是 `false`，`onClose` 立刻触发——**只有图层的销毁被推迟到出场动画结束**（这段时间里它继续吞掉点击，避免一次触摸同时"关弹窗 + 点下面的按钮"）。所以：

```ts
this.mvvm.transitions.pending; // 还有多少目标在动（0 = 一切都落定了）
```

`this.mvvm.transitions.run({ target, transition })` 也可以用同一套时序给自己的图层做动画；它是**逐帧步进**的（不建 Phaser tween，因此生命周期门禁里的 `tweens` 永远是 0），且**一个目标同时只有一个动画**——后来的接管先前的（这条是第 74 轮的 V40：对话框关闭时进场动画还在跑，两批动画写同一批属性，画面会"淡回来"）。矩阵见 [`ACCEPTANCE-transition.md`](../ACCEPTANCE-transition.md)。

---

## 7. 实战：页面栈（`this.mvvm.pages`）

多页界面（列表 → 详情 → 编辑）以前只能自己 `mount()` 一棵新树、再把旧树藏起来，还要自己处理返回与焦点。现在它是一个入口：

```ts
// 第一页（也可以是任意一层）
this.mvvm.pages.push(() => {
  Panel({ gap: 12, padding: 20 }, () => {
    Text('条目列表', { size: 'lg' });
    List({ items: () => rows.value, key: (row) => row.id, gap: 6 }, (row) => {
      Button(`${row.name} ›`, { variant: 'ghost', onClick: () => this.openDetail(row) });
    });
  });
}, { name: 'list' });

private openDetail(row: Row): void {
  this.mvvm.pages.push(() => {
    Panel({ gap: 12, padding: 20 }, () => {
      Text(`详情 · ${row.name}`, { size: 'lg' });
      Button('返回', { variant: 'secondary', onClick: () => this.mvvm.pages.pop() });
    });
  }, { name: `detail:${row.id}`, onResume: (page) => this.reloadDetail(row, page) });
}
```

`push(content, options?)` 返回 `PageHandle`（`pop()` / `depth` / `active` / `open` / `widget`）。`this.mvvm.pages` 还有 `depth`、`top`、`handles`、`names()`、`pop()`、`popToRoot()`、`handleBack()`。

| 选项         | 说明                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| `name`       | 页名，出现在 `names()` 与 dev 轨迹里（默认 `page#n`）                                |
| `onResume`   | 这一页成为可见页时调用：`push()` 之后、以及上层页面被 `pop()` 之后（数据刷新写这里） |
| `onPause`    | 被新页面盖住时调用                                                                   |
| `onDispose`  | 页面控件销毁后调用（被 `pop()`，或场景关闭）                                         |
| `onBack`     | 这一页在栈顶时对 `back` 的**优先处理权**：返回 `true` 表示自己处理（例如弹确认框）   |
| `transition` | 这一页的转场：`false` 表示立刻出现/消失，或写一个 spec 覆盖策略（见下）              |

被盖住的那一页**不会被销毁**，只是 `visible: false`：滚动位置、输入内容、计数全都留着，`pop()` 回来时逐字节还原；同时它自动变成不可见、不可点、不可聚焦、也不在焦点集合里，输入框的 DOM 焦点也会被释放（隐藏页面里的输入框不会再收字符）。

### 7.1 转场：页面之间的交叉淡入淡出

推进/返回默认是**两个都在屏幕上的页面之间的交叉淡入**：新页淡入（160 ms `outCubic`）、下面那页保留像素到淡完才隐藏；返回时下页立刻出现、离开的那页在它上面淡出（120 ms `inCubic`）后销毁。策略来自 `MVVMPlugin.configure({ transition: … })`（与对话框同一套），逐页可覆盖：

```ts
this.mvvm.pages.push(
  () => {
    /* … */
  },
  { transition: false },
); // 这一页立刻出现
this.mvvm.pages.push(
  () => {
    /* … */
  },
  { transition: { enter: 300 } },
); // 慢一点
```

三条要点，都是"为什么会这样"而不是"怎么调参"：

1. **只有 alpha 在动**。页面的 `x` 归布局所有（滑入要写 `x`，下一次布局就会把它放回去），整页缩放会朝左上角收缩——所以两个都不做。对话框也只缩放主体，理由相同。
2. **"关闭"是当帧的，"消失"是异步的**。`pop()` 当帧就弹栈、交回焦点、把指针路由交给下面那页；离开的那页再活 `transition.exit` 毫秒。`this.mvvm.transitions.pending` 是"还有没有在动"，`pages.departing` 是"正在淡出的那一页叫什么"（它已经不在 `handles` 里了）。
3. **淡入/淡出期间，邻居是"画着但不可点"的**（`Widget#routingEnabled = false`）。它不是 `visible: false`——那会连像素一起撤掉；这个标志只让命中测试跳过那棵子树，所以转场里的一次点击不会落到用户已经离开的那一页上。控件仍留在交互集合与无障碍镜像里（把镜像节点摘了又建比"短暂不可点"更糟）。

> 页面状态仍然是第 7 节的规矩：**被 `pop()` 的页面是真的销毁**，所以每页的数据放场景/ViewModel 上；只是它多活了 `exit` 毫秒——渲染用，不再接收输入。

### 7.2 路由表（可选）：`this.mvvm.router`

`pages.push(() => { … })` 已经够用，`router` 只是把「哪一页」变成**数据**：视图集中在一张表里，导航是一个字符串，写错路径会当场报错（而不是白屏）。它**不引入 URL 路由**，也不新建一套导航模型——`navigate()` 就是 `pages.push()`，所以 `Esc`、页面生命周期、焦点、输入框桥的行为与第 7 节完全一样。

```ts
// 一张表，写一次（路径里可以有 :参数，也可以带显式参数）
this.mvvm.router.routes = {
  home: () => {
    Button('用户 42', { onClick: () => this.mvvm.router.navigate('user/42') });
  },
  'user/:id': (params) => {
    const { id } = routeParams<{ id: string }>(params);
    Text(`用户 ${id}`, { size: 'lg' });
    Button('他的帖子', { onClick: () => this.mvvm.router.navigate(`user/${id}/posts`) });
    Button('返回', { variant: 'ghost', onClick: () => this.mvvm.router.back() });
  },
  'user/:id/posts': (params) => Text(`用户 ${routeParams<{ id: string }>(params).id} 的帖子`),
};

this.mvvm.router.navigate('home'); // 起始页也是路由
this.mvvm.router.navigate('settings', { tab: 'profile' }); // 显式参数，与路径参数合并
```

| 成员                                | 说明                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `routes`（可写）                    | 整张表；`route(path, builder)` 逐条追加                                                     |
| `navigate(path, params?, options?)` | 打开路由：推入一层；`options` 就是 `PageOptions`（`onResume`/`onBack`…，`name` 由路由表给） |
| `replace(path, params?, options?)`  | 用新页**换掉**当前层（栈深度不变）；只剩基页时退化成 `navigate`（基页不能弹）               |
| `back()`                            | 等于 `pages.pop()`；只剩基页时返回 `false`（让第 3/4 层决定）                               |
| `current` / `history`               | 当前页来自哪个路由 / 整栈的路由（直接 `pages.push()` 的页面不在其中，`current` 为 `null`）  |

**匹配规则**（纯函数 `route-plan.ts`，Node 单测）：字面量 key 优先于 `:参数` 模式；`#/a/b/` 与 `a//b` 会归一化成 `a/b`；两个模式都匹配时取**声明在前**的那个；只认表自己的 key（`navigate('constructor')` 不会走到 `Object.prototype` 上）。路径写错抛 `UnknownRouteError`，消息里带你表里的全部 key：

```ts
this.mvvm.router.navigate('user/9/posts');
// UnknownRouteError: Unknown route "user/9/posts" — the table has: home, user/:id, user/:id/posts,
// settings. Add it to `this.mvvm.router.routes`, or check the spelling.
```

`routeParams<T>()` 只是类型层的转换：路径参数在匹配成功时**一定**存在，而 TypeScript 的索引签名访问总会带上 `| undefined`（`noUncheckedIndexedAccess`），所以用它把类型收回来，不要在代码里到处写 `?? ''`。

> 状态放哪儿仍然和第 7 节一样：**页面被 `pop()` 会真的销毁**，所以"用户 1 的备注"这类每页数据要放在场景/ViewModel 上（`#/router` 就是这么做的：同一个 `user/:id` 的两个访问各有一份备注，来回切都在）。`navigate()` 只在 `pages.push()` 之上加了一层簿记（哪个 id 来自哪个路由），页面被别人 `pop()` 掉时它会自动忘掉——`current` 永远等于栈顶那一页的真实来源。

### `back` 的归属顺序

按 `Esc`（或手柄 `B`/`○`）时，框架按固定顺序问四层，前两层写在 `planBack()` 里（纯函数 + Node 单测）：

1. **模态栈**：有对话框就归它——`dismissible: false` 的对话框会**吞掉**这个键（下层不能替它做决定）；
2. **页面栈**：还有上一页可回时 `pop()` 一层；只剩顶层那一页时**不弹**（弹空会留下白屏）；
3. **场景**：继承 `UIScene` 时，`onBack()` 在这里被调用——返回 `true` 表示这一页自己处理了；
4. **应用**：`this.mvvm.onBack`（这才是放应用级处理的地方）。

```ts
// 1) 页面自己的返回（UIScene）：返回 true 就不往下走了
export class SettingsScene extends UIScene {
  protected override onBack(): boolean {
    if (!this.dirty.value) {
      return false; // 交回给应用层
    }
    this.confirmDiscard(); // 有未保存的改动，先问一句
    return true;
  }
}

// 2) 应用级返回：只有模态、页面、场景都不要这个键时才会走到这里
this.mvvm.onBack = () => this.togglePause();
```

第 3 层是为"这一页想自己决定怎么退"准备的，而它**不会**把应用级处理抢掉——只有返回 `true` 才拦。判定用一个显式标记（`UIScene` 上的 `backHook`），所以普通 `Phaser.Scene` 上恰好同名的 `onBack()` 方法不会被框架误调。

### 与模态框的层序

页面和对话框都是 UI 根的子节点，绘制顺序 = 子节点顺序，所以对话框永远在所有页面之上：`push()` 会把已打开的对话框图层重新抬到最上面（`raiseLayers()`），你不需要关心谁先开。

> **触摸**：页面里的列表照样可以用手指拖动（拖动不会误触行内按钮），`pop()` 之后滚动位置与输入内容都还在。

> `mount()`/`render()` 仍然可用（单页应用最简单）：它们把整棵树挂到根上，与页面栈是两条并行的用法，**不要在同一处混用**——`pages.push()` 会把根上的其他内容留在下面不管。

---

## 8. 常见坑

| 现象                               | 原因                                                       | 修法                                                                      |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| 新建的控件点不动 / Tab 不到        | 树结构变化后没有重新收集交互目标                           | 用 `this.mvvm.mount()`（自动刷新）或手动 `refreshInteraction()`           |
| 焦点死死停在某个已经不存在的控件上 | 该控件被移除但没刷新                                       | `this.mvvm.focus.refresh()`（插件会在结构变化后自动做）                   |
| 拖列表时误点按钮                   | 阈值太小                                                   | 调大 `this.mvvm.input.dragThreshold`                                      |
| 点击穿透到下面的游戏对象           | 面板没有命中区（`blockPointer: false`）或没设 capture      | 打开 `blockPointer` / 用 `setCapture`，或直接用 `this.mvvm.modal.open()`  |
| 输入框里按 Tab 没反应              | 输入框 `preventDefault()` 后 Phaser 丢掉了这个按键（V17）  | 第 60 轮起框架已转交 `FocusManager`；自定义输入控件请照抄 `TextInputBase` |
| 一次按键走了两步（Shift+Tab 尤其） | 同帧两个按键被 Phaser 重复派发（V18）                      | 第 60 轮起插件按帧去重；自定义按键处理请勿绕过插件                        |
| 方向键怎么都走不到旁边那列         | 几何容差与半平面规则不匹配（比如目标斜得很远）             | 调整布局让目标大致正对；或自己监听按键调 `focus.move`                     |
| 空格键在页面里翻页 / 滚动页面      | 浏览器默认行为与 `activate` 冲突                           | 框架只对已处理的按键 `preventDefault`；必要时自己 `preventDefault`        |
| 手柄没反应                         | 浏览器要求先与手柄交互一次才暴露 `navigator.getGamepads()` | 按一下手柄按键；确认用的是 0 号手柄                                       |
| 两个输入框都拿到焦点               | 自己调 `focus()` 绕过了管理器                              | 统一走 `widget.focus()` / `manager.focus()`                               |

---

## 9. 无障碍：隐藏的 DOM 镜像

画布对屏幕阅读器是一块不透明的东西，所以框架给**每个可交互控件**放一个视觉隐藏的 DOM 镜像节点，并把焦点变化与应用消息通过 `aria-live` 播报（范围见 [PLAN §1.2](../PLAN.md)，不做 WCAG 全量合规）：

```ts
// 默认就开着，不需要写任何代码。想关掉：
this.mvvm.a11y.enabled = false; // 运行期：整层从 DOM 移除
// 或者配置：new MVVMPlugin(..., { a11y: false }) / { a11y: { politeness: 'assertive' } }

// 应用自己播报（校验失败、保存成功、进度…）
this.mvvm.a11y.announce('已保存 3 项');
```

| 事实           | 说明                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 谁有节点       | **可交互控件**（`InputRouter` 的注册集合）：按钮、开关、禁用按钮、滑杆、输入框、滚动区、可点击卡片——**每个控件在浏览器算出的可访问性树里恰好一个节点** |
| 谁没有节点     | `Text` 这类非控件、装饰性面板（它们没有描述符，由拥有它们的控件读出）                                                                                  |
| 节点可聚焦吗   | **不进 `Tab` 序**（`tabindex="-1"`）：键盘/手柄控制权留在框架里；但**程序化焦点会跟随框架焦点**，屏幕阅读器因此落在被聚焦的控件上                      |
| 可访问名从哪来 | 控件自己的文字（按钮文案、`placeholder`）优先；**没有文字的控件用 `label` 选项**（`Slider({ label: '音量' })`），否则会读出调试 `name`                 |
| 什么时候更新   | 结构变化（`refreshInteraction()`）、焦点变化、**以及被聚焦控件每帧一次**（写前比对，没变不写）——所以值/校验/开关状态不用你操心                         |
| 播报什么       | 焦点变化**优先移动 DOM 焦点**（阅读器自己读节点）；移动不了才用 `aria-live` 读"可访问名, 状态/值"；`announce(text)` 读你给的句子                       |
| 开发模式日志   | `a11y: mirrored N widget(s)`、`a11y: announce: <text>`；发布模式零输出                                                                                 |

**两个容易踩的点**（第 76 轮用浏览器算出的树实测出来的）：

1. **文本框由自己的隐藏 `<input>` 承载**，镜像节点对它 `aria-hidden` 让位——否则同一个字段会在树里出现两次。要判断"某个控件到底在树里长什么样"，别只看 `[data-mvvm-a11y]` 的属性，去读浏览器的计算树（`scripts/visual-check.mjs` 的 `AX_EXPECTATIONS` 与 `AX_STRUCTURE_EXPECTATIONS` 就是干这个的）。这类元素由 `aria-owns` 挂进它**本该属于**的那个节点（第 103 轮起），所以对话框里的输入框在树里是对话框的子节点，尽管它的 `<input>` 在 DOM 里位于别处。
2. **值域属性只写给支持它的角色**：`aria-valuenow` 属于 `slider`/`spinbutton`/`scrollbar`/`progressbar`/`meter`/`separator`，写在 `textbox` 上是无效 ARIA（阅读器忽略、校验器报错）。文本类角色的节点文本就是**值本身**，不是描述行。

**镜像是一棵树，不是一个清单**（第 103 轮）：每个镜像节点挂在"最近的、有镜像节点的祖先控件"之下，所以**包含关系**在计算树里是真的。这带来两件写代码时用得上的事：

```ts
// 给一组控件起个名字：容器带 `label` 就是具名 group，里面的控件在树里属于它
Column({ label: '字段区域', gap: 8 }, () => {
  TextField({ label: '名字', value: name });
  TextArea({ label: '备注', value: notes });
});

// 对话框的名字就是内容根控件的 `label`（镜像给模态的 content 根 role="dialog" + aria-modal）
this.mvvm.modal.open(() =>
  Panel({ label: '删除这一项？', width: 420 }, () => {
    Text('删除这一项？');
    Button('删除', { onClick: () => this.mvvm.modal.remove() });
  }),
);
```

`ScrollView` 自己报 `role="region"`，所以它装的控件也在它里面；被盖住的内容（模态之外、栈里被盖住的那几页）一律 `aria-hidden`，**只有持有 DOM 焦点的控件及其祖先链例外**。

验收页 `#/a11y` 把每条都做成了可断言项（读真实 DOM），见 [`ACCEPTANCE-a11y.md`](../ACCEPTANCE-a11y.md) §11。

> **未验证**：真实屏幕阅读器（VoiceOver/NVDA/TalkBack）没有听过一遍——目前只断言"喂给屏幕阅读器的 DOM"。这是这套机制最关键的未验证项。

---

## 10. 小结

- **指针**：`InputRouter` 每帧推导悬停 + 位移阈值判定点击 + capture 拦截层。
- **焦点**：只有 `focusable` 的控件进集合；Tab 走顺序，方向键走几何漏斗；`focusOrder` 调顺序。
- **设备**：键盘与手柄统一成 `NavAction`，控件只看到 `activate(source)`；手柄由插件每帧自动轮询并做连发节流。
- **模态**：拦截层（`setCapture`）+ 焦点陷阱（`trapFocus`）+ `onBack` 三件套，可以自己拼出来。

下一篇 [08 生命周期、性能与常见坑](./08-lifecycle-and-pitfalls.md)：怎么保证不泄漏、怎么验证性能预算，以及一份「全部选项/事件/常量」的速查表。
