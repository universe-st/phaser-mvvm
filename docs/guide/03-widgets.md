# 03 · 控件参考：Label / Panel / Button / Image / Spacer / Divider

本章目标：把 M4 的六个基础控件用透。每个控件都按同一套模板讲：**它是什么 → 最小示例 → 选项 → 方法/事件 → 坑**。

> 文本框与滚动相关控件在 [04](./04-text-inputs.md)、[05](./05-lists-and-scroll.md) 两章。
> 想一次看全部形态，直接开 `pnpm dev` → <http://localhost:5173/#/gallery>（对应 [`apps/examples/src/scenes/gallery.ts`](../../apps/examples/src/scenes/gallery.ts)）。

> **写法提示**：本章的代码片段用 `this.add.uiXxx(...)` 工厂形式书写，为的是把注意力放在选项与行为上；**推荐写法是 Compose 风格 DSL**（[09 章](./09-compose-dsl.md)，可运行示例 `#/compose`），两者建的是同一批控件，把 `this.add.uiPanel({...}, [a, b])` 读成 `Panel({...}, () => { a; b; })` 即可。用 DSL 时也不需要 `install*Factories()`。

---

## 1. 所有控件的公共约定

### 1.1 选项是扁平的：节点参数 + 控件选项

```ts
this.add.uiButton({
  text: '保存', // 控件选项
  variant: 'primary', // 控件选项
  width: 160, // 节点参数（LayoutParams，见 02 章）
  margin: [0, 8], // 节点参数
  grow: 0, // 节点参数
});
```

拆包在构造函数里完成（`splitOptions` / `splitWidgetOptions`），未知键在**运行时**被静默忽略。但选项接口是闭合类型：直接在字面量里拼错键名会被 TypeScript 报出来，只有绕开类型检查（先存变量、`as` 断言）时才会悄悄失效。以本章表格为准。

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

| 成员                                                                                | 说明                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `layoutParams`                                                                      | 归一化后的节点参数（只读对象，改它请用 `setLayoutParams`）                  |
| `setLayoutParams(patch)`                                                            | 部分更新节点参数并标脏                                                      |
| `appliedRect`                                                                       | 引擎分配的最终矩形（父容器局部坐标，已做像素取整）                          |
| `visualState` / `hovered` / `pressed` / `focused` / `error` / `enabled`             | 状态读取                                                                    |
| `setEnabled(v)` / `setError(v)`                                                     | 改状态（会重绘并 emit `widget:state`）                                      |
| `setVisible(v)`                                                                     | 隐藏＝退出布局流（`inFlow = false`，见 [02 §3](./02-layout.md)）            |
| `focus()` / `blur()`                                                                | 键盘/手柄焦点（需要焦点管理器，见 07 章）                                   |
| `activate(source?)`                                                                 | 触发激活（`'pointer'`/`'keyboard'`/`'gamepad'`），`disabled` 时返回 `false` |
| `onActivate`                                                                        | 激活回调；`bindCommand` 会**链式**接在它后面                                |
| `addWidget(child)` / `removeWidget(child, destroy?)` / `removeAllWidgets(destroy?)` | 维护 widget 树（不是 `container.add()`）                                    |
| `getWidgetChildren()`                                                               | 参与布局的子控件副本                                                        |
| `markDirty()`                                                                       | 内容变化后让布局重算                                                        |
| `scope`                                                                             | 该控件的 `EffectScope`（绑定都挂在里面，销毁时统一停止）                    |
| `theme`                                                                             | 当前主题（只读；切换主题时控件自己重绘）                                    |
| `name`                                                                              | 调试名，也是 `scene.children.getByName` 的名字                              |

事件（`Phaser.Events.EventEmitter` 语义）：

| 事件名            | 触发         | 载荷                                           |
| ----------------- | ------------ | ---------------------------------------------- |
| `widget:activate` | 激活成功     | `source: 'pointer' \| 'keyboard' \| 'gamepad'` |
| `widget:state`    | 视觉状态变化 | `WidgetState`                                  |

```ts
// 事件名就是字符串常量，直接用字面量最省事
button.on('widget:activate', (source) => console.log('activated by', source));
button.on('widget:state', (state) => console.log('state →', state));
```

### 1.4 工厂键一览

| 工厂                   | 具名函数                                        | 控件         |
| ---------------------- | ----------------------------------------------- | ------------ |
| `this.add.uiLabel`     | `label(scene, opts, children?)`                 | `Label`      |
| `this.add.uiPanel`     | `panel(scene, opts, children?)`                 | `Panel`      |
| `this.add.uiButton`    | `button(scene, opts, children?)`                | `Button`     |
| `this.add.uiImage`     | `uiImage(scene, opts, children?)`               | `Image`      |
| `this.add.uiSpacer`    | `spacer(scene, opts, children?)`                | `Spacer`     |
| `this.add.uiDivider`   | `divider(scene, opts, children?)`               | `Divider`    |
| `this.add.uiTextField` | `textField(scene, opts, children?)`             | `TextField`  |
| `this.add.uiTextArea`  | `textArea(scene, opts, children?)`              | `TextArea`   |
| `this.add.uiRepeat`    | `uiRepeat(scene, opts)` / `repeat(scene, opts)` | `Repeat`     |
| `this.add.uiScroll`    | `scrollView(scene, opts, children?)`            | `ScrollView` |

（`vbox`/`hbox`/`uiGrid`/`uiStack`/`uiAbsolute`/`uiRect` 由 `@phaser-mvvm/phaser` 的 `installFactories()` 注册。）

---

## 2. `Label`：一块主题化文本

**它是什么**：包了一个 `Phaser.GameObjects.Text` 的控件。文本对象**不是**布局子节点 —— `Label` 自己测量它、自己把它摆在内容盒里，因此对齐、换行、截断都是可控的。

```ts
this.add.uiLabel({ text: '账户设置', style: { fontSize: '20px' } });
this.add.uiLabel({ text: '这是说明文字', tone: 'muted' });
this.add.uiLabel({ text: '很长很长的一段话…', width: 260, maxLines: 2, ellipsis: true });
```

### 选项

| 选项         | 类型                                                                      | 默认        | 说明                                                                |
| ------------ | ------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| `text`       | `string`                                                                  | `''`        | 逻辑文本；`\n` 强制换行（即使关闭自动换行）                         |
| `style`      | `Phaser.Types.GameObjects.Text.TextStyle`                                 | —           | 覆盖在主题样式**之上**（字体、颜色、描边、阴影…）                   |
| `wrap`       | `boolean`                                                                 | `true`      | 在可用宽度内换行                                                    |
| `align`      | `'left' \| 'center' \| 'right'`                                           | `'left'`    | 内容盒内的水平对齐（同时作用于文本样式与对象位置）                  |
| `maxLines`   | `number`                                                                  | 不限        | 最多显示几行，超出部分丢弃                                          |
| `ellipsis`   | `boolean`                                                                 | `false`     | 被截断时在最后一行补 `…`                                            |
| `tone`       | `'default' \| 'muted' \| 'danger' \| 'success' \| 'warning' \| 'primary'` | `'default'` | 语义色，映射到主题令牌（见 §8）                                     |
| `selectable` | 只能传 `false`                                                            | —           | 为了表单模板能统一传 `selectable: false`；Canvas 文本本来就不可选中 |

### 方法

| 方法              | 说明                                                  |
| ----------------- | ----------------------------------------------------- |
| `getText()`       | 逻辑文本（**不是**被截断后的显示文本）                |
| `setText(value)`  | 改文本，自动重新测量并标脏                            |
| `setTone(tone)`   | 换语义色                                              |
| `get truncated()` | 当前显示是否因为 `maxLines`/`ellipsis` 被裁剪         |
| `textObject`      | 底层 `Text`，用于高级样式（**不要**拿它当布局子节点） |

### 坑

- **宽度从哪来**：`wrap: true` 时按「测量时拿到的最大宽度」换行。放在 `vbox` 里因为默认 `stretch`，它会拿到整行宽度 —— 想让长文案按固定宽度换行，**显式写 `width`**。
- **`maxLines` 的实现**：先在 `Text` 上换行，再由 `text-truncate.ts` 裁掉多余行并可选补省略号，然后写回显示文本。所以 `getText()` 永远返回完整原文。
- **主题切换会重新裁行**：字体或字号变了，换行结果也会变，`Label` 已经处理了这一点。

---

## 3. `Panel`：主题化容器（页面的骨架）

**它是什么**：一个 `box` 布局容器 + 程序化绘制的背景。默认 `direction: 'vertical'`，所以 `Panel` 天然就是「一块竖着排内容的卡片」。

```ts
this.add.uiPanel({ direction: 'vertical', gap: 12, padding: 16, variant: 'surface', radius: 10 }, [
  this.add.uiLabel({ text: '卡片标题' }),
  this.add.uiLabel({ text: '内容', tone: 'muted' }),
]);
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
const save = this.add.uiButton({
  text: '保存',
  variant: 'primary',
  size: 'md',
  onClick: (button) => console.log('clicked', button.getText()),
});

// 开关型
const toggle = this.add.uiButton({ text: '通知', toggle: true, value: false });
toggle.on('change', (value: boolean) => toggle.setText(`通知: ${value ? '开' : '关'}`));

// 加载态
save.setLoading(true);
```

### 选项

| 选项       | 类型                                                 | 默认          | 说明                                                                |
| ---------- | ---------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `text`     | `string`                                             | `''`          | 文案                                                                |
| `icon`     | `string`（贴图键）\| `Phaser.GameObjects.GameObject` | —             | 图标；贴图键会自动建一个左上原点的 `Image`，传入对象则原样使用      |
| `variant`  | `'primary' \| 'secondary' \| 'ghost' \| 'danger'`    | `'secondary'` | 视觉风格                                                            |
| `size`     | `'sm' \| 'md' \| 'lg'`                               | `'md'`        | 决定默认高度与水平内边距                                            |
| `disabled` | `boolean`                                            | `false`       | 初始禁用（等价于 `setEnabled(false)`）                              |
| `toggle`   | `boolean`                                            | `false`       | 开关模式：激活时翻转 `value` 并 emit `change`，**不调用** `onClick` |
| `value`    | `boolean`                                            | `false`       | 开关初值                                                            |
| `loading`  | `boolean`                                            | `false`       | 加载态：忽略激活，文案后补省略号                                    |
| `onClick`  | `(button: Button) => void`                           | —             | 非开关按钮的激活回调                                                |

`size` 与主题的关系：默认高度 `theme.controlHeight[size]`（sm=28 / md=36 / lg=44），水平内边距 `theme.spacing[size]`（sm=8 / md=12 / lg=16）。**写了 `height` 就用你的**。

### 方法

| 方法                                                 | 说明                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `getValue()` / `setValue(v)`                         | 开关值；`setValue` **不** emit `change`            |
| `getText()` / `setText(t)`                           | 文案                                               |
| `setVariant(v)` / `setLoading(v)` / `setDisabled(v)` | 改状态                                             |
| `setIcon(icon)` / `clearIcon()` / `get icon`         | 换/清/读图标                                       |
| `activate(source?)`                                  | `loading` 时**直接返回 `false`**（不吞掉这次交互） |

### 事件

| 事件              | 触发         | 载荷             |
| ----------------- | ------------ | ---------------- |
| `change`          | 开关被激活   | `value: boolean` |
| `widget:activate` | 任意成功激活 | `source`         |

### 坑

- **`toggle: true` 时 `onClick` 不会被调用**，请监听 `change`。
- **图标对象的原点**：传字符串最省事；传自定义对象时请确保它是左上原点（`Image`/`Sprite` 记得 `setOrigin(0,0)`），否则居中算法会偏。
- **`loading` 的按钮仍然可聚焦、可被点击**，只是 `activate()` 返回 `false`。如果你的业务需要它在加载期间也不接收焦点，请自己 `setEnabled(false)`。

---

## 4.5 `Slider`：拖动取值（触摸优先）

```ts
// 工厂写法
const volume = this.add.uiSlider({ min: 0, max: 100, value: 40, width: 200 });
volume.on('change', (v: number) => console.log('volume', v));

// DSL（推荐）：`value` 可以直接绑 ref，双向生效
const volume = ref(40);
Slider({ value: volume, min: 0, max: 100, width: 200 });
Text(() => `volume=${Math.round(volume.value)}`); // 拖动时实时跟着变
```

### 选项

| 选项             | 类型                                      | 默认         | 说明                                                                                |
| ---------------- | ----------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `value`          | `number`                                  | `min`        | 初值；会先按 `min`/`max`/`step` 归位                                                |
| `min` / `max`    | `number`                                  | `0`/`100`    | 取值区间；`max < min` 时按 `min` 处理                                               |
| `step`           | `number`                                  | `0`          | 量化步长，`0`（默认）为连续；网格**以 `min` 为锚点**（`min:5, step:10` → 5/15/25…） |
| `disabled`       | `boolean`                                 | `false`      | 初始禁用（拖不动、拿不到焦点）                                                      |
| `trackThickness` | `number`                                  | `6`          | 轨道厚度（设计像素）                                                                |
| `knobRadius`     | `number`                                  | `9`          | 滑块半径（拖拽中会 +1，作为触摸反馈）                                               |
| `onChange`       | `(value: number, slider: Slider) => void` | —            | **用户**改变时回调（`setValue` 不触发）                                             |
| `width`/`height` | —                                         | `180`/`2r+4` | 常规布局参数；不写时用默认尺寸                                                      |

### 方法 / 事件

| 成员                         | 说明                                            |
| ---------------------------- | ----------------------------------------------- |
| `getValue()` / `setValue(v)` | 读写值；`setValue` 会归位但**不** emit `change` |
| `value`（get/set）           | 同上，属性形式                                  |
| `setRange(min, max)`         | 改区间，当前值重新归位                          |
| `setStep(step)`              | 改步长（`0` 为连续），当前值重新归位            |
| `change`（事件）             | 用户拖动/点击时 emit，载荷 `value: number`      |

### 坑

- **键盘暂不支持**：方向键被焦点管理器用于导航，滑杆的键盘操作需要先和它达成约定（见 `docs/DEFECT-BACKLOG.md`）。鼠标与触摸是当前支持的输入。
- **拖动会跟出控件**：手指/指针滑出滑杆范围时仍继续控制（超出两端按端点钳制），这是刻意的触摸行为；不要用 `pointerleave` 之类的逻辑去打断它。
- **`step` 不是"只允许这些值"**：调用方 `setValue(37)` 时若 `step=10` 会被吸附到 40，绑定到 `ref` 的值永远是网格上的值。
- **值永远是有限数**：`NaN`/`±Infinity` 会被归位到 `min`，不会传到绑定的 `ref` 里。

---

## 5. `Image`：把贴图放进矩形

```ts
this.add.uiImage({ texture: 'demo-tile', fit: 'contain', width: 120, height: 64 });
this.add.uiImage({ texture: 'avatar', frame: 'idle' }); // 用贴图自然尺寸
```

| 选项      | 类型                                       | 默认        | 说明                       |
| --------- | ------------------------------------------ | ----------- | -------------------------- |
| `texture` | `string`                                   | **必填**    | `scene.textures` 里的键    |
| `frame`   | `string`                                   | —           | 贴图内的帧名               |
| `fit`     | `'none' \| 'contain' \| 'cover' \| 'fill'` | `'contain'` | 贴图如何映射到分配到的矩形 |

`fit` 语义（`computeFit`）：

| 值          | 行为                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `'contain'` | 等比缩放到**完整可见**（默认，宁可留白也不裁）                         |
| `'cover'`   | 等比缩放到**铺满**（溢出的部分居中、留在矩形之外；`Image` 自己不裁剪） |
| `'fill'`    | 不保持比例，拉伸到正好填满                                             |
| `'none'`    | 不缩放，按原始像素居中原样绘制                                         |

方法：`setTexture(texture, frame?)`、`setFit(fit)`、`get naturalSize`（当前帧的原始尺寸）、`get imageFit`、`image`（底层 `Phaser.GameObjects.Image`，用于 tint 等）。

要点：

- **内在尺寸 = 贴图尺寸**，所以不写 `width`/`height` 也能正确测量。
- 分配到的矩形如果是 0 面积（例如控件不可见、已退出布局流），图片会被**隐藏**而不是溢出绘制。
- **`Image` 的名字与 `Phaser.GameObjects.Image` 冲突**：`@phaser-mvvm/widgets` 里它就叫 `Image`，同时也导出别名 `UIImage`。工厂只能叫 `uiImage`（`image` 被 Phaser 占了）。

---

## 6. `Spacer`：纯布局填充

```ts
this.add.hbox({ gap: 8, alignItems: 'center' }, [
  this.add.uiLabel({ text: '标题' }),
  this.add.uiSpacer({ flex: true }), // 把后面的按钮推到最右
  this.add.uiButton({ text: '操作' }),
]);
```

| 选项   | 类型      | 默认    | 说明                                                                        |
| ------ | --------- | ------- | --------------------------------------------------------------------------- |
| `flex` | `boolean` | `false` | 等价于 `grow: 1`；显式 `grow` 优先，所以 `{ flex: true, grow: 2 }` 用权重 2 |

特点：不画任何东西、`measureContent` 为 `0×0`、没有子容器、不参与命中测试。想固定间距就直接写 `gap` 或 `width`/`height`，不必用 `Spacer`。

---

## 7. `Divider`：一条分隔线

```ts
this.add.uiPanel({ direction: 'vertical', gap: 10, padding: 16 }, [
  this.add.uiLabel({ text: '第一段' }),
  this.add.uiDivider({}), // 横向，自动撑满宽度
  this.add.uiLabel({ text: '第二段' }),

  this.add.hbox({ gap: 8, height: 20 }, [
    this.add.uiLabel({ text: '左' }),
    this.add.uiDivider({ orientation: 'vertical' }), // 纵向，自动撑满高度
    this.add.uiLabel({ text: '右' }),
  ]),
]);
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
  const row = (label: string, control: Phaser.GameObjects.Container) =>
    this.add.hbox({ gap: 12, alignItems: 'center' }, [
      this.add.uiLabel({ text: label, tone: 'muted', width: 120 }),
      control,
    ]);

  const card = this.add.uiPanel(
    { direction: 'vertical', gap: 14, padding: 18, variant: 'surface', radius: 12, width: 460 },
    [
      this.add.uiLabel({ text: '通知设置', style: { fontSize: '20px' } }),
      this.add.uiDivider({}),

      row('邮件通知', this.add.uiButton({ text: '开启', toggle: true, name: 'mail' })),
      row('头像', this.add.uiImage({ texture: 'demo-tile', fit: 'cover', width: 48, height: 48 })),

      this.add.uiDivider({}),
      this.add.hbox({ gap: 8, justifyContent: 'end' }, [
        this.add.uiSpacer({ flex: false }),
        this.add.uiButton({ text: '重置', variant: 'ghost' }),
        this.add.uiButton({ text: '保存', variant: 'primary', onClick: () => console.log('saved') }),
      ]),
    ],
  );

  this.mvvm.mount(card);
}
```

练习方向：

1. 把 `card` 的 `width` 改成 `'50%'`，观察它在 `UIRoot` 居中时的表现，并解释为什么内层 `hbox` 仍然撑满（提示：`alignItems` 默认 `stretch`）。
2. 给「头像」那行加一个 `elevation: 4` 的 `Panel` 包一层，体会 `elevation` 是模拟投影而不是真实阴影。
3. 把按钮的 `onClick` 换成 `toggle` + `change`，再用 `bindTemplateText` 把开关状态显示到 `Label` 上（进 [06 章](./06-data-and-theme.md)）。

---

## 10. 小结

- 六个控件的选项都是「节点参数 + 控件选项」的扁平合并，未知键会被静默忽略。
- 状态机只有六个状态，全部由主题驱动；`disabled`/`error` 优先级最高。
- `Label` 负责文本的换行/截断，`Panel` 负责骨架与拦截，`Button` 负责激活与开关，`Image` 负责贴图适配，`Spacer`/`Divider` 负责排布里的「空白」与「线」。

下一篇 [04 文本框与表单](./04-text-inputs.md)：`TextField`/`TextArea`、DOM 输入桥（中文输入法）、校验与错误态。
