# 03 · 控件参考：Text / Panel / Button / Slider / Image / Spacer / Divider

本章目标：把基础控件用透。每个控件都按同一套模板讲：**它是什么 → 最小示例 → 选项 → 方法/事件 → 坑**。

> **本章代码用 Compose 风格 DSL 书写**（[09 章](./09-compose-dsl.md)，可运行示例 `#/compose`）：`Text('标题')`、`Button('保存', { variant: 'primary' })`、`Panel({ gap: 12 }, () => { … })`。DSL 直接构造同一批控件类，选项表与工厂写法**完全通用**；只有当你确实需要 `this.add.uiXxx(...)` 时，按下表对照即可（§1.4）。用 DSL 不需要 `install*Factories()`。

> 文本框与滚动相关控件在 [04](./04-text-inputs.md)、[05](./05-lists-and-scroll.md) 两章。
> 想一次看全部形态，直接开 `pnpm dev` → <http://localhost:5173/#/states>（交互状态矩阵）或 `#/gallery`（工厂写法画廊）。

---

## 1. 所有控件的公共约定

### 1.1 选项是扁平的：节点参数 + 控件选项

```ts
Button('保存', {
  variant: 'primary', // 控件选项
  width: 160, // 节点参数（LayoutParams，见 02 章）
  margin: [0, 8], // 节点参数
  grow: 0, // 节点参数
});
```

拆包在构造函数里完成（`splitOptions` / `splitWidgetOptions`）。选项接口是闭合类型，直接在字面量里拼错键名会被 TypeScript 报出来；绕开类型检查时（先存变量、`as` 断言、动态拼键）**开发模式下框架会指名警告**：`unknown option "pading" on "kb.page" — it is ignored. Did you mean "padding"?`（`on "…"` 里的名字取你写的 `name` 选项，没写就不带这一段；第 83 轮的选项审计，见 [`ACCEPTANCE-options.md`](../ACCEPTANCE-options.md)；发布模式零输出）。以本章表格为准。

`name` / `visible` / `focusOrder` 这三个**基类选项**每个控件都接受（它们直接落到 `Widget` 的字段上）；其余选项见各控件自己的表格。

### 1.2 统一的视觉状态机

每个控件都有一个 `visualState`，优先级从高到低：

| 状态       | 触发条件                       |
| ---------- | ------------------------------ |
| `disabled` | `setEnabled(false)`            |
| `error`    | `setError(true)`               |
| `pressed`  | 指针按住（由输入路由设置）     |
| `hover`    | 指针悬停（由输入路由每帧推导） |
| `focused`  | 获得框架焦点                   |
| `normal`   | 以上都不成立                   |

皮肤（`ProceduralSkin` + `Graphics`）按这个状态取色，所以外观**永远来自主题令牌**，不需要美术资源。

### 1.3 公共 API（`Widget` 基类提供）

| 成员                                                                                | 说明                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layoutParams`                                                                      | 归一化后的节点参数（只读对象，改它请用 `setLayoutParams`）                                                                                                              |
| `setLayoutParams(patch)`                                                            | 部分更新节点参数并标脏                                                                                                                                                  |
| `appliedRect`                                                                       | 引擎分配的最终矩形（父容器局部坐标，已做像素取整）                                                                                                                      |
| `visualState` / `hovered` / `pressed` / `focused` / `error` / `enabled`             | 状态读取                                                                                                                                                                |
| `focusVisible`                                                                      | 现在**要不要画焦点环**（`focused` 管焦点在谁身上，它管要不要指出来：鼠标点来的焦点是 `focused` 但不画环，见 07 章 §5 与 [ADR-0012](../adr/0012-focus-visible-ring.md)） |
| `setEnabled(v)` / `setError(v)`                                                     | 改状态（会重绘并 emit `widget:state`）                                                                                                                                  |
| `setVisible(v)`                                                                     | 隐藏＝退出布局流（`inFlow = false`，见 [02 §3](./02-layout.md)）                                                                                                        |
| `focus()` / `blur()`                                                                | 键盘/手柄焦点（需要焦点管理器，见 07 章）                                                                                                                               |
| `activate(source?)`                                                                 | 触发激活（`'pointer'`/`'touch'`/`'keyboard'`/`'gamepad'`），`disabled` 时返回 `false`                                                                                   |
| `onActivate`                                                                        | 激活回调；`bindCommand` 会**链式**接在它后面                                                                                                                            |
| `addWidget(child)` / `removeWidget(child, destroy?)` / `removeAllWidgets(destroy?)` | 维护 widget 树（不是 `container.add()`）                                                                                                                                |
| `getWidgetChildren()`                                                               | 参与布局的子控件副本                                                                                                                                                    |
| `markDirty()`                                                                       | 内容变化后让布局重算                                                                                                                                                    |
| `scope`                                                                             | 该控件的 `EffectScope`（绑定都挂在里面，销毁时统一停止）                                                                                                                |
| `theme`                                                                             | 当前主题（只读；切换主题时控件自己重绘）                                                                                                                                |
| `name`                                                                              | 调试名，也是 `scene.children.getByName` 的名字                                                                                                                          |
| `focusOrder`                                                                        | Tab 顺序提示（小的先被 Tab 到；相同值保持控件树顺序，见 07 章）                                                                                                         |

事件（`Phaser.Events.EventEmitter` 语义）：

| 事件名            | 触发             | 载荷                                                                              |
| ----------------- | ---------------- | --------------------------------------------------------------------------------- |
| `widget:activate` | 激活成功         | `source: 'pointer' \| 'touch' \| 'keyboard' \| 'gamepad'`（鼠标与触摸分开，见下） |
| `widget:state`    | 视觉状态**变化** | `WidgetState`（重绘但状态没变时**不**发，见下）                                   |
| `widget:focus`    | 拿到框架焦点     | — （第 110 轮起；`setFocusedInternal` 是唯一漏斗，见 08 附录 C）                  |
| `widget:blur`     | 焦点离开         | — （**`destroy()` 不发**：那时已经没有听众了）                                    |

```ts
// 事件名就是字符串常量，直接用字面量最省事
button.on('widget:activate', (source) => console.log('activated by', source));
button.on('widget:state', (state) => console.log('state →', state));
button.on('widget:focus', () => console.log('focused'));
button.on('widget:blur', () => console.log('blurred'));
```

两条实测出来的语义（第 96 轮在 `#/states` 上按真鼠标/真触摸/键盘/手柄跑过）：

- **`source` 把触摸和鼠标分开**：鼠标点击是 `'pointer'`，手指是 `'touch'`（键盘 `'keyboard'`、手柄 `'gamepad'`）。需要"点按"与"点击"两种提示、或不想在手指下弹 tooltip 的界面靠它区分，不必绕过框架去读 Phaser 的输入。
- **`widget:state` 只在状态真的变了时发**：`setEnabled` / `setError` / 主题切换都会重绘，但重绘不等于状态变化 —— 修之前一次点击会发两次 `pressed`（`pressed, pressed, focused, hover`），用它计数或判"是否进入了某个状态"的订阅者会收到重复。顺便：触摸点击后的状态流是 `pressed → focused`（**没有 `hover`**，手指没有悬停），鼠标是 `pressed → focused → hover`。

### 1.4 DSL 与工厂对照

| DSL（推荐）               | 工厂                   | 具名函数                                        | 控件         |
| ------------------------- | ---------------------- | ----------------------------------------------- | ------------ |
| `Text(str, opts?)`        | `this.add.uiLabel`     | `label(scene, opts, children?)`                 | `Label`      |
| `Panel(opts?, content?)`  | `this.add.uiPanel`     | `panel(scene, opts, children?)`                 | `Panel`      |
| `Button(str, opts?)`      | `this.add.uiButton`    | `button(scene, opts, children?)`                | `Button`     |
| `Slider(opts?)`           | `this.add.uiSlider`    | `uiSlider(scene, opts)`                         | `Slider`     |
| `Image(opts)`             | `this.add.uiImage`     | `uiImage(scene, opts, children?)`               | `Image`      |
| `Spacer(opts?)`           | `this.add.uiSpacer`    | `spacer(scene, opts, children?)`                | `Spacer`     |
| `Divider(opts?)`          | `this.add.uiDivider`   | `divider(scene, opts, children?)`               | `Divider`    |
| `TextField(opts?)`        | `this.add.uiTextField` | `textField(scene, opts, children?)`             | `TextField`  |
| `TextArea(opts?)`         | `this.add.uiTextArea`  | `textArea(scene, opts, children?)`              | `TextArea`   |
| `List(opts, item)`        | `this.add.uiRepeat`    | `uiRepeat(scene, opts)` / `repeat(scene, opts)` | `Repeat`     |
| `Scroll(opts?, content?)` | `this.add.uiScroll`    | `scrollView(scene, opts, children?)`            | `ScrollView` |

容器同理：`Column`↔`vbox`、`Row`↔`hbox`、`Grid`↔`uiGrid`、`Stack`↔`uiStack`、`Absolute`↔`uiAbsolute`、`Rect`↔`uiRect`（后六个由 `@phaser-mvvm/phaser` 的 `installFactories()` 注册）。DSL 的名字与 Compose 对齐：`Column`/`Row` 比 `vbox`/`hbox` 更说明问题。

---

## 2. `Text`：一块主题化文本（控件类 `Label`）

**它是什么**：包了一个 `Phaser.GameObjects.Text` 的控件。文本对象**不是**布局子节点 —— `Label` 自己测量它、自己把它摆在内容盒里，因此对齐、换行、截断都是可控的。

```ts
Text('账户设置', { size: 'xl' }); // 主题令牌，换主题自动跟着变
Text('这是说明文字', { tone: 'muted' });
Text('很长很长的一段话…', { width: 260, maxLines: 2, ellipsis: true });

// 数据槽可以是 ref 或 getter，值变了自动重绘（不需要手动 setText）
Text(() => `共 ${rows.value.length} 行`);
Text(vm.title); // ref 直接传
```

### 选项

| 选项         | 类型                                                                      | 默认        | 说明                                                                              |
| ------------ | ------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `text`       | `string`                                                                  | `''`        | 逻辑文本；`\n` 强制换行（即使关闭自动换行）                                       |
| `size`       | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` 或像素数                           | `'md'`      | 字号；**主题令牌**，换主题时跟着变（写数字则固定像素）                            |
| `style`      | `Phaser.Types.GameObjects.Text.TextStyle`                                 | —           | 覆盖在主题样式**之上**（字体、颜色、描边、阴影…），`style.fontSize` 优先于 `size` |
| `wrap`       | `boolean`                                                                 | `true`      | 在可用宽度内换行                                                                  |
| `align`      | `'left' \| 'center' \| 'right'`                                           | `'left'`    | 内容盒内的水平对齐（同时作用于文本样式与对象位置）                                |
| `maxLines`   | `number`                                                                  | 不限        | 最多显示几行，超出部分丢弃（**数据槽**：`ref`/getter 可在运行时折叠/展开）        |
| `ellipsis`   | `boolean`                                                                 | `false`     | **掉了行就一定**在最后一行补 `…`（必要时缩短那一行；**数据槽**）                  |
| `tone`       | `'default' \| 'muted' \| 'danger' \| 'success' \| 'warning' \| 'primary'` | `'default'` | 语义色，映射到主题令牌（见 §8）                                                   |
| `selectable` | 只能传 `false`                                                            | —           | 为了表单模板能统一传 `selectable: false`；Canvas 文本本来就不可选中               |

### 各控件的 `size` 是什么意思

`size` 这个名字在三个控件上各指一件事，写错地方会被审计**当场指名**（不是静默忽略）：

| 控件                     | `size` 的含义                                                     | 想改字号怎么办                                                |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `Label` / `Text`         | **字号**（`'xs'`…`'xl'` 主题令牌，或直接写像素数）                | 就是它；`style.fontSize` 仍然优先                             |
| `Button`                 | **控件尺寸档**：默认高度（`controlHeight`）与左右内边距，字号不变 | 传 `style: { fontSize: … }`，或直接用 `size: 'lg'` 让按钮更高 |
| `TextField` / `TextArea` | **没有这个选项**：高度来自主题的 `controlHeight.md` 或 `rows`     | `TextField` 传 `height`；`TextArea` 传 `rows`（或 `height`）  |

实测（`#/showcase` 的 `Label · sizes` 卡）：`size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'` 解析出 `12 / 14 / 16 / 20 / 26` px；`size: 18` 就是 18px；`size: 'xs'` 与 `style: { fontSize: '18px' }` 同时写时**后者胜出**（渲染 18px）。而把 `size` 写给 `TextField` 时会打印 `[phaser-mvvm] unknown option "size" on "canvas" — it is ignored.`，字段高度不变（实测 36px）——这条警告正是用来抓这种"以为按 Button 的写法能生效"的。

### 方法

| 方法               | 说明                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `getText()`        | 逻辑文本（**不是**被截断后的显示文本）                                 |
| `getDisplayText()` | **画出来的**文本：换行 + `maxLines`/`ellipsis` 之后的结果（`\n` 分隔） |
| `setText(value)`   | 改文本，自动重新测量并标脏                                             |
| `setTone(tone)`    | 换语义色                                                               |
| `setMaxLines(n)`   | 改行数上限（重测 + 变脏）—— `Text({ maxLines: … })` 槽位的入口         |
| `setEllipsis(on)`  | 开关省略号 —— `Text({ ellipsis: … })` 槽位的入口                       |
| `get truncated()`  | 当前显示是否被裁剪（掉了行，或单行溢出被截断）                         |
| `textObject`       | 底层 `Text`，用于高级样式（**不要**拿它当布局子节点）                  |

### 坑

- **宽度从哪来**：`wrap: true` 时按「测量时拿到的最大宽度」换行。放在 `vbox` 里因为默认 `stretch`，它会拿到整行宽度 —— 想让长文案按固定宽度换行，**显式写 `width`**。
- **中文（以及任何没有空格的长串）也会换行**：Phaser 的换行只在空格处断行，所以框架在它之后补了一道**逐码点兜底断行**（`rewrapOverflowingLines`，等价于 CSS 的 `overflow-wrap: anywhere`）：凡是仍然超过内容宽度的行都按字符切开，单个字形比盒子还宽时独占一行。因此中文长句、长 URL、长英文单词都不会横向溢出；`wrap: false` 时不参与（那是你明确要求不换行）。
- **`maxLines` 的实现**：先在 `Text` 上换行，再由 `text-truncate.ts` 裁掉多余行并可选补省略号，然后写回显示文本。所以 `getText()` 永远返回完整原文，`getDisplayText()` 才是屏幕上那几行。
- **`ellipsis` 的意思是「掉了东西就说出来」**，不是「让这一行放得下」：补标记时会把最后一行缩短到放得下 `…`，所以正文被裁掉时读者一定看得见；`wrap: false` 的单行超出宽度走同一条路（按**实际生效的宽度**裁剪）。这两种情况的 `truncated` 都是 `true`。
- **「展开 / 收起」用数据槽，不要重建子树**：`Text(text, { maxLines: () => (expanded.value ? 99 : 2), ellipsis: true })`。重建会连带丢掉滚动位置、焦点与选区；`#/compose` 的 State slots 分区有常驻演示（读数 `window.compose.slots().paintedLines`/`truncated`）。
- **主题切换会重新裁行**：字体或字号变了，换行结果也会变，`Label` 已经处理了这一点。
- **每个文字盒子上下各留一点内边距**（字号 8%、至少 1px）：Phaser 的文本画布高度取自字体度量 `ascent + descent`，而这个值带小数、赋给 `canvas.height` 时会被截断，于是 `g`/`y` 的下伸部会被切掉约 0.6px（同时布局也少留 1px）。框架替所有文字对象补上这点填充，**测量高度里已经包含它**，所以你不用自己加 padding；如果你的自定义控件直接 `new Phaser.GameObjects.Text()`，请照抄 `packages/widgets/src/text-padding.ts` 的做法。

---

## 3. `Panel`：主题化容器（页面的骨架）

**它是什么**：一个 `box` 布局容器 + 程序化绘制的背景。默认 `direction: 'vertical'`，所以 `Panel` 天然就是「一块竖着排内容的卡片」。

```ts
Panel({ direction: 'vertical', gap: 12, padding: 16, variant: 'surface', radius: 10 }, () => {
  Text('卡片标题');
  Text('内容', { tone: 'muted' });
});
```

### 容器选项（默认即 `vbox` 的默认值）

| 选项                           | 取值                                                                 | 默认         |
| ------------------------------ | -------------------------------------------------------------------- | ------------ |
| `direction`                    | `'vertical'` / `'horizontal'`                                        | `'vertical'` |
| `gap` / `rowGap` / `columnGap` | `number`                                                             | `0`          |
| `justifyContent`               | `start`/`center`/`end`/`space-between`/`space-around`/`space-evenly` | `'start'`    |
| `alignItems`                   | `auto`/`start`/`center`/`end`/`stretch`                              | `'stretch'`  |
| `wrap`                         | `boolean`（flex-wrap）                                               | `false`      |
| `alignContent`                 | 同 `justifyContent` 取值                                             | `'start'`    |
| `reverse`                      | `boolean`                                                            | `false`      |

### 外观选项

| 选项           | 类型                                                                         | 默认                                                     | 说明                                       |
| -------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| `variant`      | `'surface' \| 'surfaceAlt' \| 'overlay' \| 'primary' \| 'danger' \| 'plain'` | `'surface'`                                              | 背景语义；`'plain'` 不画背景               |
| `radius`       | `number`                                                                     | `theme.radius.md`（8）                                   | 圆角；会被自动夹到「短边的一半」           |
| `border`       | `boolean`                                                                    | `surface`/`surfaceAlt`/`overlay` 为 `true`，其余 `false` | 是否描边                                   |
| `elevation`    | `number`                                                                     | `0`                                                      | 模拟投影的强度（设计像素）                 |
| `interactive`  | `boolean`                                                                    | `false`                                                  | 变成「可点击、可聚焦的卡片」               |
| `blockPointer` | `boolean`                                                                    | `true`                                                   | 保留指针命中区，拦下点击、不穿透到游戏世界 |

### 要点

- **`Panel` 没有内容尺寸**（`measureContent` 返回 `0×0`）：尺寸来自你的 `width`/`height`/`fill`，或由子节点汇总 + padding。空的 `Panel` 且不写宽高 = 0×0。
- **`blockPointer` 默认开着**：一个覆盖全屏的 `Panel` 会挡住它下面的控件与游戏对象。这是「UI 拦截层」的实现方式；如果确定不需要拦截（比如纯装饰背景），写 `blockPointer: false`。
- **`interactive: true` 会让它 `focusable`**：能进 Tab 焦点链，激活时触发 `onActivate` / `widget:activate`（可以配合 `bindCommand` 当成一个大按钮）。

---

## 4. `Button`：可激活控件

```ts
const save = Button('保存', {
  variant: 'primary',
  size: 'md',
  onClick: (button) => console.log('clicked', button.getText()),
});

// 开关型：`value` 是数据槽，直接绑 ref 就是双向的
const notify = ref(false);
Button(() => `通知：${notify.value ? '开' : '关'}`, { toggle: true, value: notify });

notify.value = true; // 代码写 ref → 按钮跟着翻过去（外部状态驱动）
// 用户点击 → 事件写回 ref，上面的文案同一帧更新
// 只想接住"用户改了"（例如写进 store）：onValueChange
const saveMuted = (on: boolean) => store.set('muted', on);
Button('静音', { toggle: true, onValueChange: saveMuted });

// 加载态 / 禁用态也可以是响应式的：值一变，外观自己跟上
Button('保存', { variant: 'primary', loading: () => saving.value });

// 纯图标按钮、以及"点整块卡片"（Panel + bindCommand）
Button('', { icon: 'demo-tile', size: 'sm' });
```

### 选项

| 选项       | 类型                                                 | 默认          | 说明                                                                  |
| ---------- | ---------------------------------------------------- | ------------- | --------------------------------------------------------------------- |
| `text`     | `string`                                             | `''`          | 文案                                                                  |
| `icon`     | `string`（贴图键）\| `Phaser.GameObjects.GameObject` | —             | 图标；贴图键会自动建一个左上原点的 `Image`，传入对象则原样使用        |
| `variant`  | `'primary' \| 'secondary' \| 'ghost' \| 'danger'`    | `'secondary'` | 视觉风格                                                              |
| `size`     | `'sm' \| 'md' \| 'lg'`                               | `'md'`        | 决定默认高度与水平内边距                                              |
| `disabled` | `boolean`                                            | `false`       | 初始禁用（等价于 `setEnabled(false)`）                                |
| `toggle`   | `boolean`                                            | `false`       | 开关模式：激活时翻转 `value` 并 emit `change`，**不调用** `onClick`   |
| `value`    | `boolean` 或数据槽（`Ref`/getter）                   | `false`       | 开关状态；传 `ref` 则**双向**，传 getter 则单向（配 `onValueChange`） |
| `loading`  | `boolean`                                            | `false`       | 加载态：忽略激活，文案后补省略号                                      |
| `onClick`  | `(button: Button) => void`                           | —             | 非开关按钮的激活回调                                                  |

`size` 与主题的关系：默认高度 `theme.controlHeight[size]`（sm=28 / md=36 / lg=44），水平内边距 `theme.spacing[size]`（sm=8 / md=12 / lg=16）。**写了 `height` 就用你的**。

### 方法

| 方法                                                 | 说明                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `getValue()` / `setValue(v)`                         | 开关值；值真的变了就 emit `change`（模型因此不会落后，见下） |
| `getText()` / `setText(t)`                           | 文案                                                         |
| `setVariant(v)` / `setLoading(v)` / `setDisabled(v)` | 改状态                                                       |
| `setIcon(icon)` / `clearIcon()` / `get icon`         | 换/清/读图标                                                 |
| `activate(source?)`                                  | `loading` 时**直接返回 `false`**（不吞掉这次交互）           |

### 事件

| 事件              | 触发                                         | 载荷             |
| ----------------- | -------------------------------------------- | ---------------- |
| `change`          | 开关值变化（用户激活**或** `setValue` 写入） | `value: boolean` |
| `widget:activate` | 任意成功激活                                 | `source`         |

### 坑

- **`toggle: true` 时 `onClick` 不会被调用**：用 `value: ref`（写回数据源）或监听 `change`。
- **`setValue()` 与用户点击走同一条上报路径**：开关的 `value` 是数据槽，而双向绑定（`bindBooleanModel`）靠 `change` 写回 `ref` —— 程序化写值若静默，`ref` 会永远停在旧值上（向下绑定只在**源**变化时才跑，谁也不会有机会纠正它）。实测：`#/a11y` 的开关 `setValue(false)` 后，控件已关、页面仍发布 `notify=true`。用户专属的回调仍是 `onClick`。
- **开关的 `value` 与文本可以各自响应式**：`Button(() => \`开：${on.value}\`, { toggle: true, value: on })`里，文案与开关状态读的是同一个`ref`，不会各说各话。
- **图标对象的原点**：传字符串最省事；传自定义对象时请确保它是左上原点（`Image`/`Sprite` 记得 `setOrigin(0,0)`），否则居中算法会偏。
- **`loading` 的按钮仍然可聚焦、可被点击**，只是 `activate()` 返回 `false`。如果你的业务需要它在加载期间也不接收焦点，请自己 `setEnabled(false)`。

---

## 4.5 `Slider`：拖动取值（触摸优先）

```ts
// `value` 可以直接绑 ref：拖动即写回（双向）
const volume = ref(40);
Slider({ value: volume, min: 0, max: 100, width: 200 });
Text(() => `volume=${Math.round(volume.value)}`); // 拖动时实时跟着变

// 只关心"用户改了"（例如写进 store），用 onValueChange
Slider({ value: () => settings.brightness, onValueChange: (next) => save(next) });

// 量化 + 禁用
Slider({ value: quality, min: 0, max: 3, step: 1 });
Slider({ value: 60, disabled: true, width: 160 });

// 区间也是数据槽：换单位、换量程只改状态（滑块会跟着重新归位并重画）
Slider({
  value: temperature,
  min: () => (celsius.value ? 0 : 32),
  max: () => (celsius.value ? 40 : 104),
});
```

### 选项

| 选项             | 类型                                      | 默认         | 说明                                                                                |
| ---------------- | ----------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `value`          | `number`                                  | `min`        | 初值；会先按 `min`/`max`/`step` 归位                                                |
| `min` / `max`    | `number`（**DSL 里可以是 `ref`/getter**） | `0`/`100`    | 取值区间；`max < min` 时按 `min` 处理；槽位变化会调用 `setRange`                    |
| `step`           | `number`                                  | `0`          | 量化步长，`0`（默认）为连续；网格**以 `min` 为锚点**（`min:5, step:10` → 5/15/25…） |
| `disabled`       | `boolean`（**DSL 槽位**）                 | `false`      | 初始禁用（拖不动、拿不到焦点）                                                      |
| `trackThickness` | `number`                                  | `6`          | 轨道厚度（设计像素）                                                                |
| `knobRadius`     | `number`                                  | `9`          | 滑块半径（拖拽中会 +1，作为触摸反馈）                                               |
| `onChange`       | `(value: number, slider: Slider) => void` | —            | **用户**改变时回调（程序化写值不触发；见下）                                        |
| `width`/`height` | —                                         | `180`/`2r+4` | 常规布局参数；不写时用默认尺寸                                                      |

### 方法 / 事件

| 成员                         | 说明                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `getValue()` / `setValue(v)` | 读写值；`setValue` 会归位，并在值真的变了时 emit `change`（模型因此不会落后）              |
| `value`（get/set）           | 同上，属性形式                                                                             |
| `setRange(min, max)`         | 改区间：重新归位当前值、**重画**（滑块位置按比例变）、同步无障碍镜像、必要时 emit `change` |
| `setStep(step)`              | 改步长（`0` 为连续），当前值重新归位                                                       |
| `change`（事件）             | **值变了就 emit**（用户拖动/点击/按键，或控件自己归位时），载荷 `value: number`            |

> **`change` 与 `onChange` 的分工**和文本框一致：`change` 是"模型通道"（`value: ref` 与 `bindNumberModel()` 靠它写回，所以程序化写值也会到达），`onChange` **选项**是"用户动了它"的回调。两者都只在值**真的**变了时触发。

### 坑

- **键盘与手柄**：聚焦后 `← →`（手柄 `D-Pad 左右` / 左摇杆左右）按一个 `step` 移动（连续滑杆按量程的 1/20），`Home`/`End` 到两端，`PageUp`/`PageDown` 按量程的 1/10（不小于一个 `step`）。`↑`/`↓` **不**属于滑杆：它是横向控件，上下留给焦点导航——所以手柄用户不会被"卡"在滑杆上（`Widget.onAction`，第 64 轮统一了两台设备的规则）。其余键（`Tab`/`Enter`/`Escape`）同样交还给焦点管理器（见指南 07「控件先挑键」）。
- **拖动会跟出控件**：手指/指针滑出滑杆范围时仍继续控制（超出两端按端点钳制），这是刻意的触摸行为；不要用 `pointerleave` 之类的逻辑去打断它。
- **`step` 不是"只允许这些值"**：调用方 `setValue(37)` 时若 `step=10` 会被吸附到 40，绑定到 `ref` 的值永远是网格上的值。
- **值永远是有限数**：`NaN`/`±Infinity` 会被归位到 `min`，不会传到绑定的 `ref` 里。
- **改区间会改位置**：滑块与小节的填充按 `(value - min) / (max - min)` 画，所以 `setRange` 在值不变时**画面也会变**（值 40、量程 0..100 → 0..200，填充从 40% 缩到 20%）；值落到新区间之外时会被钳制，并像 `setValue` 一样把钳制结果通过 `change` 报给模型（否则 `ref` 会一直停在那个已经不可能的值上）。

---

## 5. `Image`：把贴图放进矩形

```ts
Image({ texture: 'demo-tile', fit: 'contain', width: 120, height: 64 });
Image({ texture: 'avatar', frame: 'idle' }); // 用贴图自然尺寸

// 贴图是**数据槽**：换头像、换角标只改状态，不重建控件
const selected = ref(0);
Image({ texture: () => avatars.value[selected.value] ?? 'avatar.empty', width: 48, height: 48 });
```

| 选项      | 类型                                       | 默认        | 说明                                                       |
| --------- | ------------------------------------------ | ----------- | ---------------------------------------------------------- |
| `texture` | `string`                                   | **必填**    | `scene.textures` 里的键（**数据槽**：`ref`/getter 可换图） |
| `frame`   | `string`                                   | —           | 贴图内的帧名（同样是数据槽）                               |
| `fit`     | `'none' \| 'contain' \| 'cover' \| 'fill'` | `'contain'` | 贴图如何映射到分配到的矩形                                 |

`fit` 语义（`computeFit`）：

| 值          | 行为                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `'contain'` | 等比缩放到**完整可见**（默认，宁可留白也不裁）                         |
| `'cover'`   | 等比缩放到**铺满**（溢出的部分居中、留在矩形之外；`Image` 自己不裁剪） |
| `'fill'`    | 不保持比例，拉伸到正好填满                                             |
| `'none'`    | 不缩放，按原始像素居中原样绘制                                         |

方法：`setTexture(texture, frame?)`、`setFit(fit)`、`get naturalSize`（当前帧的原始尺寸）、`get imageFit`、`get currentTexture` / `get currentFrame`（当前贴图与帧名，`texture` 与 `frame` 两个槽位靠它们互不覆盖）、`image`（底层 `Phaser.GameObjects.Image`，用于 tint 等）。

> **帧名不存在时会发生什么**：Phaser 的 `Texture#get` 会打印一条警告并按该贴图的**第一帧**绘制，`currentFrame` 报告的是**实际画出来的帧**而不是你请求的那个名字（否则这个读数会撒谎）。实测：`setTexture('atlas', 'nope')` → 控制台一条 `has no frame "nope"`，画面仍是 `red`，`currentFrame === 'red'`。

要点：

- **内在尺寸 = 贴图尺寸**，所以不写 `width`/`height` 也能正确测量。
- 分配到的矩形如果是 0 面积（例如控件不可见、已退出布局流），图片会被**隐藏**而不是溢出绘制。
- **`Image` 的名字与 `Phaser.GameObjects.Image` 冲突**：`@phaser-mvvm/widgets` 里它就叫 `Image`，同时也导出别名 `UIImage`。工厂只能叫 `uiImage`（`image` 被 Phaser 占了）。

---

## 6. `Spacer`：纯布局填充

```ts
Row({ gap: 8, alignItems: 'center' }, () => {
  Text('标题');
  Spacer({ flex: true }); // 把后面的按钮推到最右
  Button('操作');
});
```

| 选项   | 类型      | 默认    | 说明                                                                        |
| ------ | --------- | ------- | --------------------------------------------------------------------------- |
| `flex` | `boolean` | `false` | 等价于 `grow: 1`；显式 `grow` 优先，所以 `{ flex: true, grow: 2 }` 用权重 2 |

特点：不画任何东西、`measureContent` 为 `0×0`、没有子容器、不参与命中测试。想固定间距就直接写 `gap` 或 `width`/`height`，不必用 `Spacer`。

---

## 7. `Divider`：一条分隔线

```ts
Panel({ direction: 'vertical', gap: 10, padding: 16, width: 'fill' }, () => {
  Text('第一段');
  Divider({}); // 横向，自动撑满宽度
  Text('第二段');

  Row({ gap: 8, height: 20 }, () => {
    Text('左');
    Divider({ orientation: 'vertical' }); // 纵向，自动撑满高度
    Text('右');
  });
});
```

| 选项          | 类型                          | 默认                     | 说明                               |
| ------------- | ----------------------------- | ------------------------ | ---------------------------------- |
| `orientation` | `'horizontal'` / `'vertical'` | `'horizontal'`           | 横线沿 x 画，竖线沿 y 画           |
| `color`       | `ThemeColorName \| number`    | `theme.colors.border`    | 主题令牌名或字面颜色               |
| `thickness`   | `number`                      | `theme.borderWidth`（1） | 线宽（交叉轴尺寸），至少 1，会取整 |

**默认尺寸是「主轴自动填满，交叉轴 = 线宽」**：横向 Divider 在 `vbox` 里自动撑满宽度；纵向 Divider 在 `hbox` 里自动撑满高度。显式写 `width`/`height` 会覆盖对应轴。

> 纵向 Divider 在 `hbox` 里会自动撑到该行高度（默认 `alignItems: 'stretch'` + 它自己的 `height: 'fill'`）。但放进 `vbox` 时它占的是主轴：需要父容器有确定高度可供分配，否则会被算成 0 而看不见。

---

## 8. 主题令牌速查（控件取色的来源）

控件从不写死颜色，全部来自主题（[`packages/phaser/src/theme.ts`](../../packages/phaser/src/theme.ts)）：

| 分类   | 令牌                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 颜色   | `background`、`surface`、`surfaceAlt`、`surfaceHover`、`overlay`、`primary`、`primaryHover`、`primaryPressed`、`onPrimary`、`text`、`textMuted`、`textDisabled`、`border`、`borderStrong`、`danger`、`success`、`warning`、`focusRing` |
| 字号   | `fontSize`: `xs 12` / `sm 14` / `md 16` / `lg 20` / `xl 26`                                                                                                                                                                            |
| 间距   | `spacing`: `xs 4` / `sm 8` / `md 12` / `lg 16` / `xl 24`                                                                                                                                                                               |
| 圆角   | `radius`: `sm 4` / `md 8` / `lg 12` / `pill 999`                                                                                                                                                                                       |
| 控件高 | `controlHeight`: `sm 28` / `md 36` / `lg 44`                                                                                                                                                                                           |
| 其他   | `fontFamily`、`borderWidth`(1)、`focusRingWidth`(2)                                                                                                                                                                                    |

`Label` 的 `tone` → 令牌映射：`default→text`、`muted→textMuted`、`danger→danger`、`success→success`、`warning→warning`、`primary→primary`。

换肤与自定义主题见 [06 章 §6](./06-data-and-theme.md)。

---

## 9. 组装练习：把六个控件拼成一个「设置卡片」

```ts
create(): void {
  const scale = ref(1);

  // 一行的写法就是一行函数：标签 + 控件
  const row = (label: string, control: () => void) =>
    Row({ gap: 12, alignItems: 'center' }, () => {
      Text(label, { tone: 'muted', width: 120 });
      control();
    });

  render(this.mvvm, () => {
    Panel({ gap: 14, padding: 18, variant: 'surface', radius: 12, width: 460 }, () => {
      Text('通知设置', { size: 'lg' });
      Divider({});

      // 开关：`value` 只是初值，变化通过 `change` 回到数据源（见 §4）
      const mail = Button('邮件通知：开', { toggle: true, value: true, name: 'mail' });
      mail.on('change', (on: boolean) => mail.setText(`邮件通知：${on ? '开' : '关'}`));
      row('邮件通知', () => mail);
      row('头像', () => Image({ texture: 'demo-tile', fit: 'cover', width: 48, height: 48 }));
      row('缩放', () => Slider({ value: scale, min: 1, max: 4, step: 0.5, width: 200 }));

      Divider({});
      Row({ gap: 8, justifyContent: 'end' }, () => {
        Button('重置', { variant: 'ghost', onClick: () => { mail.setValue(true); scale.value = 1; } });
        Button('保存', { variant: 'primary', onClick: () => console.log('saved') });
      });
    });
  });
}
```

三种写法都建同一批控件，差别只在"谁记得住顺序"：DSL 里**兄弟顺序就是源码顺序**，`if`/`for` 直接写在 `content` 里（见 [09 章](./09-compose-dsl.md)）。

练习方向：

1. 把 `card` 的 `width` 改成 `'50%'`，观察它在 `UIRoot` 居中时的表现，并解释为什么内层 `hbox` 仍然撑满（提示：`alignItems` 默认 `stretch`）。
2. 给「头像」那行加一个 `elevation: 4` 的 `Panel` 包一层，体会 `elevation` 是模拟投影而不是真实阴影。
3. 把按钮的文案换成 `Text(() => …)` 派生出来的读数（开关状态、滑杆数值各来一行），体会「数据槽直接吃 getter」——不需要 `bindTemplateText`（进 [06 章](./06-data-and-theme.md)）。

---

## 10. 小结

- 六个控件的选项都是「节点参数 + 控件选项」的扁平合并；不认识的键在开发模式下会被指名警告（并尽量给出建议），不会再悄悄消失。
- 状态机只有六个状态，全部由主题驱动；`disabled`/`error` 优先级最高。
- `Label` 负责文本的换行/截断，`Panel` 负责骨架与拦截，`Button` 负责激活与开关，`Image` 负责贴图适配，`Spacer`/`Divider` 负责排布里的「空白」与「线」。

下一篇 [04 文本框与表单](./04-text-inputs.md)：`TextField`/`TextArea`、DOM 输入桥（中文输入法）、校验与错误态。
