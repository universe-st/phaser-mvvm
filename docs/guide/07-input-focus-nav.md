# 07 · 交互：指针、焦点与导航

本章目标：让页面在**鼠标、键盘、手柄**三种输入下都能用，并知道每层是谁在管事。

> 对应示例：[`#/gallery`](../../apps/examples/src/scenes/gallery.ts)（Tab/方向键焦点 + 开关按钮）、[`#/scroll`](../../apps/examples/src/scenes/scroll.ts)（键盘滚动 + 嵌套滚轮）。

> **写法提示**：本章的代码片段用 `this.add.uiXxx(...)` 工厂形式书写，为的是把注意力放在选项与行为上；**推荐写法是 Compose 风格 DSL**（[09 章](./09-compose-dsl.md)，可运行示例 `#/compose`），两者建的是同一批控件，把 `this.add.uiPanel({...}, [a, b])` 读成 `Panel({...}, () => { a; b; })` 即可。用 DSL 时也不需要 `install*Factories()`。

---

## 1. 三层分工

| 层       | 类 / 模块      | 负责                                             | 入口              |
| -------- | -------------- | ------------------------------------------------ | ----------------- |
| 指针路由 | `InputRouter`  | 悬停、按下、点击判定、拦截层、`disabled` 屏蔽    | `this.mvvm.input` |
| 焦点管理 | `FocusManager` | 焦点集合、Tab 顺序、方向导航、激活、`trapFocus`  | `this.mvvm.focus` |
| 设备映射 | `nav.ts`       | 把键盘事件/手柄状态翻译成统一动作（`NavAction`） | 由插件自动接入    |

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
| 命中区            | 交互控件需要命中区，`enablePointerInput()` 会按布局分配的矩形自动维护（缩放/重排后自动同步）                                                                                                                                                                                                                         |

```ts
// 运行期调整点击阈值：InputRouter 的公开字段
this.mvvm.input.dragThreshold = 12;
```

> ⚠️ **不要在 Game Config 的 `plugins.scene` 条目里传插件选项**：Phaser 只读 `key`/`plugin`/`mapping`，并以 `new Plugin(scene, pluginManager, mapKey)` 实例化，`MVVMPluginConfig`（`input`/`focus`/`onBack`/`navigation`/`themeBackground`）**目前传不进去**，写了也不会生效。请像上面这样在运行期改公开字段或用可写属性（见 06 §6.1）。

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

| 按键          | 动作                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `Tab`         | `next`（下一个焦点）                                                       |
| `Shift+Tab`   | `prev`（上一个焦点）                                                       |
| `↑ ↓ ← →`     | 几何方向导航（找最近的邻居，见下）                                         |
| `Enter`、空格 | `activate`（激活当前焦点控件）                                             |
| `Escape`      | `back`（交给 `FocusManager.onBack`，用 `this.mvvm.focus.onBack = …` 设置） |

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

没有任何焦点时按方向键 = **进入焦点集合**（聚焦第一个），符合直觉。

### 顺序控制

```ts
this.add.uiButton({ text: '确定', focusOrder: 10 }); // 数字小的先被 Tab 到
this.add.uiButton({ text: '取消', focusOrder: 20 }); // 相同值保持控件树顺序
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

## 6. 实战：一个纯键盘/手柄可完成的确认框

```ts
import Phaser from 'phaser';

export class ConfirmScene extends Phaser.Scene {
  constructor() {
    super('confirm');
  }

  create(): void {
    const ok = this.add.uiButton({ text: '确定', variant: 'primary', focusOrder: 1, name: 'ok' });
    const cancel = this.add.uiButton({
      text: '取消',
      variant: 'ghost',
      focusOrder: 2,
      name: 'cancel',
    });

    const dialog = this.add.uiPanel(
      { direction: 'vertical', gap: 14, padding: 20, variant: 'surface', radius: 12, width: 360 },
      [
        this.add.uiLabel({ text: '确认操作', style: { fontSize: '20px' } }),
        this.add.uiLabel({ text: '该操作不可撤销。', tone: 'muted' }),
        this.add.hbox({ gap: 10, justifyContent: 'end' }, [cancel, ok]),
      ],
    );

    // 半透明遮罩 + 居中对话框 = 一个 stack 层
    const mask = this.add.uiPanel(
      { variant: 'overlay', width: 'fill', height: 'fill', radius: 0, interactive: true },
      [],
    );
    const overlay = this.add.uiStack({ width: 'fill', height: 'fill' }, [mask, dialog]);
    this.mvvm.mount(overlay);

    // 遮罩成为指针拦截层：点穿不到下面的 UI
    this.mvvm.input.setCapture(mask);

    // 焦点陷阱 + 键盘/手柄的 Escape/B 键关闭
    this.mvvm.focus.trapFocus = true;
    this.mvvm.focus.onBack = () => this.close();

    ok.on('widget:activate', () => this.close());
    cancel.on('widget:activate', () => this.close());

    // 打开即把焦点放到主操作上
    ok.focus();
  }

  private close(): void {
    this.mvvm.focus.trapFocus = false;
    this.mvvm.focus.onBack = null;
    this.scene.restart();
  }
}
```

这张图里每一行的作用：

| 代码                       | 解决什么                                |
| -------------------------- | --------------------------------------- |
| `interactive: true` 的遮罩 | 有命中区 → 能被 `setCapture` 用作拦截层 |
| `stack` 包住遮罩 + 对话框  | 对话框居中叠在遮罩之上                  |
| `setCapture(mask)`         | 防止点击穿透到遮罩下面的界面与游戏对象  |
| `trapFocus = true`         | Tab / 方向键不会跑到对话框外面          |
| `onBack`                   | Escape 与手柄 B 键都能关闭              |
| `ok.focus()`               | 打开即有焦点，键盘用户不必先 Tab        |

> 注意：`interactive: true` 会让遮罩进入焦点集合，Tab 会停在它上面。真正做模态时建议用 `FocusManager` 的 `root` 参数**只收集对话框子树**（如上面的对话框焦点管理示例），而不是把整个页面交给它。

---

## 7. 常见坑

| 现象                               | 原因                                                       | 修法                                                               |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 新建的控件点不动 / Tab 不到        | 树结构变化后没有重新收集交互目标                           | 用 `this.mvvm.mount()`（自动刷新）或手动 `refreshInteraction()`    |
| 焦点死死停在某个已经不存在的控件上 | 该控件被移除但没刷新                                       | `this.mvvm.focus.refresh()`（插件会在结构变化后自动做）            |
| 拖列表时误点按钮                   | 阈值太小                                                   | 调大 `this.mvvm.input.dragThreshold`                               |
| 点击穿透到下面的游戏对象           | 面板没有命中区（`blockPointer: false`）或没设 capture      | 打开 `blockPointer` / 用 `setCapture`                              |
| 方向键怎么都走不到旁边那列         | 几何容差与半平面规则不匹配（比如目标斜得很远）             | 调整布局让目标大致正对；或自己监听按键调 `focus.move`              |
| 空格键在页面里翻页 / 滚动页面      | 浏览器默认行为与 `activate` 冲突                           | 框架只对已处理的按键 `preventDefault`；必要时自己 `preventDefault` |
| 手柄没反应                         | 浏览器要求先与手柄交互一次才暴露 `navigator.getGamepads()` | 按一下手柄按键；确认用的是 0 号手柄                                |
| 两个输入框都拿到焦点               | 自己调 `focus()` 绕过了管理器                              | 统一走 `widget.focus()` / `manager.focus()`                        |

---

## 8. 小结

- **指针**：`InputRouter` 每帧推导悬停 + 位移阈值判定点击 + capture 拦截层。
- **焦点**：只有 `focusable` 的控件进集合；Tab 走顺序，方向键走几何漏斗；`focusOrder` 调顺序。
- **设备**：键盘与手柄统一成 `NavAction`，控件只看到 `activate(source)`；手柄由插件每帧自动轮询并做连发节流。
- **模态**：拦截层（`setCapture`）+ 焦点陷阱（`trapFocus`）+ `onBack` 三件套，可以自己拼出来。

下一篇 [08 生命周期、性能与常见坑](./08-lifecycle-and-pitfalls.md)：怎么保证不泄漏、怎么验证性能预算，以及一份「全部选项/事件/常量」的速查表。
