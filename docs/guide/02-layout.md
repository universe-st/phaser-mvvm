# 02 · 布局：约束怎么变成矩形

本章目标：让你能**预判**每个控件最终落在哪里、多大。看完你应该能在脑子里跑一遍 `measure → arrange`。

> 布局引擎在 `@phaser-mvvm/layout`，它**零 Phaser 依赖**：算法只认 `LayoutNode` 接口（`measureContent` / `applyRect` / `layoutParams`），渲染是适配层的事（[ADR-0002](../adr/0002-two-pass-layout.md)、[ADR-0003](../adr/0003-layout-is-renderer-agnostic.md)）。所以布局行为可以在 Node 里单测，也可以被别的渲染后端复用。

> **本章代码用 Compose 风格 DSL 书写**（[09 章](./09-compose-dsl.md)，可运行示例 `#/compose`）：`Column`/`Row`/`Grid`/`Stack`/`Absolute`。布局参数与容器选项**和工厂写法完全通用**（`this.add.vbox(opts, children)` ↔ `Column(opts, () => { children })`），所以本章讲的所有规则对两种写法都成立。

---

## 1. 两阶段模型：为什么值得先懂

每一帧（或在脏的时候）引擎对整棵树跑两遍：

```
① measure  约束向下传，尺寸向上回
   父: "你最多 300×∞"  →  子: "我量出来 120×36"
   容器用自己的算法汇总子尺寸：vbox 是高度求和，grid 是行列求和……

② arrange  父的内容盒被分给子节点
   每个子节点先按「最终（通常是紧的）约束」重新测量一次，
   然后 applyRect(rect) 把矩形写到渲染对象上
```

三个直接后果，会解释你后面遇到的大部分现象：

1. **`auto` 尺寸是量出来的，不是猜的**：`Label` 量的是文本、`Image` 量的是贴图、`Button` 量的是文本 + 图标 + 内边距。所以「写内容就够，不用写宽高」。
2. **父容器可以在 arrange 时改写子尺寸**：这就是 `fill`、`grow`、`alignItems: 'stretch'`、grid 单元格拉伸能生效的原因 —— 子节点里的 `measureContent` 只回答「内容想多大」，最终多大由父节点说了算。
3. **测量结果按 `(约束, 内容修订号)` 缓存**：没变的东西不重量。代价是**内容变了必须 `markDirty()`**，否则 UI 不更新（§13）。

`Widget` 已经实现了这套接口，你写自定义控件时只需要覆盖 `measureContent` 与 `onRectChanged`。

---

## 2. 五种容器：先选对算法

| 容器               | DSL（推荐） / 工厂                                                  | 排布规则                                                           | 典型用途                                         |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| **box**（纵向）    | `Column(opts, () => {…})` / `this.add.vbox(opts, children)`         | 主轴=`y`，交叉轴=`x`，可选换行                                     | 页面骨架、表单、卡片内部                         |
| **box**（横向）    | `Row(opts, () => {…})` / `this.add.hbox(opts, children)`            | 主轴=`x`，交叉轴=`y`                                               | 工具栏、一行按钮、卡片行                         |
| **grid**           | `Grid(opts, () => {…})` / `this.add.uiGrid(opts, children)`         | 固定/自动列数的单元格网格，支持跨行列                              | 卡片矩阵、键值对显示、图标墙                     |
| **stack**          | `Stack(opts, () => {…})` / `this.add.uiStack(opts, children)`       | 子节点互相层叠，按 `align` 对齐（默认 `center`）                   | 对话框/遮罩、角标、状态覆盖层                    |
| **absolute**       | `Absolute(opts, () => {…})` / `this.add.uiAbsolute(opts, children)` | 只摆放 `position: 'absolute'` 的子节点，按 `left/top/right/bottom` | HUD、固定定位元素                                |
| **scroll**（端口） | 不直接暴露；`ScrollView` 内部使用                                   | 把滚动轴的最大值解除限制，内容可以比视口长                         | 滚动容器（见 [05 章](./05-lists-and-scroll.md)） |

两个容易忽略的点：

- **`position: 'absolute'` 的子节点可以混在任意容器里**。引擎在每个容器排布完之后都会再跑一遍绝对定位，所以 `stack` 里可以同时有「层叠的流式子节点」和「贴右上的绝对子节点」（示例 `#/stack` 就是这么做的）。
- **`absolute` 容器只排绝对子节点**：里面没写 `position: 'absolute'` 的流式子节点不会被摆放（它们仍在测量里），所以 `absolute` 容器请配合绝对参数使用。
- **工厂键叫 `uiGrid` 而不是 `grid`**：Phaser 已经占了 `this.add.grid`（调试网格），具名函数仍叫 `grid(scene, ...)`。DSL 里没有这个问题：它叫 `Grid`。

---

## 3. 尺寸：`Length` 的四种写法

所有尺寸字段（`width`/`height`/`minWidth`/`maxHeight`/`basis`/`left`…）都接受同一种类型：

```ts
type LengthUnit = number | 'auto' | 'fill' | `${number}%`;
type Length = LengthUnit | { value: LengthUnit; min?: number; max?: number };
```

| 写法                  | 含义                                                | 解析基准                                                 |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `120`                 | 固定设计像素                                        | —                                                        |
| `'auto'`（默认）      | 由内容决定（叶子量内容，容器算子节点）              | —                                                        |
| `'fill'`              | 撑满父容器的**内容盒**（父容器 padding 之后的区域） | 父内容盒；box 主轴上的 `fill` 等价于 `grow: 1`（基准 0） |
| `'50%'`               | 父容器内容盒的百分比                                | 父内容盒；基准不确定时退化为 `auto`                      |
| `{ value, min, max }` | 在基础长度上再夹一层该轴专有的上下限                | 同 `value`                                               |

```ts
Panel({ width: 'fill', height: 240 }, () => { … });       // 横向撑满，高固定
Panel({ width: '50%', minWidth: 200 }, () => { … });       // 一半宽，但不小于 200
Panel({ width: { value: 'fill', min: 80, max: 240 } }, () => { … });
```

还有一组**独立的、全局的**上下限字段（不是写在 `Length` 里）：

```ts
{ minWidth: 120, maxWidth: 480, minHeight: 0, maxHeight: 600 }
```

> ⚠️ **`minWidth`/`maxWidth`/`minHeight`/`maxHeight` 请只写数字。** 它们在归一化时以基准 `0` 解析，写 `'50%'` 会得到 `0`（等于把尺寸夹死），写 `'fill'` 同样是 `0`。要「不限制」就留空或写 `'auto'`。

### 主轴伸缩：`grow` / `shrink` / `basis`

box 容器在排布时，把主轴上的剩余空间按权重分配：

| 字段     | 默认 | 作用                                                                                          |
| -------- | ---- | --------------------------------------------------------------------------------------------- |
| `grow`   | `0`  | 剩余空间的分配权重。`grow: 1` 抢一份，`grow: 2` 抢两份                                        |
| `shrink` | `0`  | 空间不够时的收缩权重（按 `shrink × 基准尺寸` 比例扣减，不会小于 0）。默认**不收缩，允许溢出** |
| `basis`  | 无   | 参与 grow/shrink 之前的初始主轴尺寸，可写百分比                                               |

```ts
Row({ gap: 8 }, () => {
  Text('左侧固定', { width: 120 });
  Spacer({ flex: true }); // = grow: 1，吃掉中间的空白
  Button('确定');
});
```

`Spacer` 的 `flex: true` 只是 `grow: 1` 的语法糖（显式 `grow` 优先）；它不画任何东西，也不参与命中测试，专门用来「把兄弟节点推开」。

### 宽高比与隐藏

| 字段          | 说明                                                              |
| ------------- | ----------------------------------------------------------------- |
| `aspectRatio` | `width / height`；给定一边后另一边自动推导                        |
| `hideMode`    | 隐藏时是否退出布局流：`'collapse'`（默认）退出，`'keep'` 保留占位 |
| `order`       | 在 box/grid 里的排序提示（升序，相同值保持声明顺序）              |

`setVisible(false)` 默认让节点 `inFlow = false`，在 `vbox` 里表现为「这一行消失了，后面的顶上」—— 这正是 `visible: () => cond` 想要的效果（等价于 Compose 的 `if`，但不重建子树）。

想在**隐藏时保留占位**（CSS 的 `visibility: hidden`）就写 `hideMode: 'keep'`：

```ts
Row({ gap: 8, alignItems: 'center' }, () => {
  Text('前');
  Panel({ width: 56, height: 18, visible: () => on.value, hideMode: 'keep' }); // 槽位一直在
  Text('后'); // 不会跟着移动
});
```

它的实现只有一句：`Widget.inFlow` 现在等于 `inFlowOf(visible, hideMode)`（`packages/layout/src/params.ts`）。因此

- **保留的是布局槽位**：节点照常被测量与摆放（`measureContent` 仍会被调用），只是渲染器不画它；
- **不影响交互**：`collectFocusable` 要求 `visible !== false`（[`focus.ts`](../../packages/phaser/src/focus.ts)），输入路由走树时也整棵跳过 `visible === false` 的节点（`resolveTargetInTree`），而 Phaser 自己的命中测试同样跳过不可见对象——三道都拦着，所以「隐藏但占位」的节点既不能聚焦也点不到。它们**仍然留在路由的注册集合里**（`collectInteractive` 不看 `visible`），这是有意的：显示回来时不需要一次结构性刷新就能立刻恢复交互；
- 运行期示例见 `#/compose` 的 Flow 分区（同一行里并排演示 `collapse` 与 `keep` 的差别）。

---

## 4. 间距：`margin` / `padding` 简写

两个字段都接受四种写法：

```ts
padding: 16                                  // 四边 16
padding: [12, 16]                            // [上下, 左右]
padding: [8, 12, 8, 16]                      // [上, 右, 下, 左]
padding: { top: 8, right: 12, bottom: 8 }    // 缺省边为 0
```

语义区别（与 CSS 一致）：

- **`padding` 是容器自己的**：子节点的内容盒 = 容器 rect 减去 padding。容器宽高为 `auto` 时，padding 会被算进容器尺寸。
- **`margin` 是子节点自己的**：在父容器的流里占位（box 的主轴间距里算它，交叉轴对齐也把它算进去）。

```ts
Panel({ padding: 24, direction: 'vertical', gap: 12 }, () => { … });
```

---

## 5. 定位：绝对定位与偏移

```ts
Text('角标', {
  position: 'absolute',
  right: -12,
  top: -8, // 只写一个水平 + 一个垂直偏移即可
});
```

规则（`arrangeAbsolute`）：

- 水平方向优先 `left`，没有则用 `right`；两者都没有就贴内容盒左边。
- 垂直方向优先 `top`，没有则用 `bottom`；两者都没有就贴内容盒上边。
- `left`/`right`/`top`/`bottom` 也可以是百分比，基准是**父容器的内容盒**。
- 绝对定位节点**不参与**流式占位（不影响兄弟节点的位置），但**仍会被测量**，因此 `auto` 尺寸依然有效。

---

## 6. 对齐：box 的三层规则

box 容器（vbox/hbox）的对齐分三层，按下面的优先级生效：

1. **子节点自己的 `alignSelf`**（`start`/`center`/`end`/`stretch`；`auto` 表示听父容器的）
2. **容器的 `alignItems`**（默认 **`'stretch'`**）
3. 主轴方向则由容器的 `justifyContent` 决定

```ts
Row({ gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: 16 }, () => {
  Text('左');
  Text('右');
});
```

| 选项             | 取值                                                                           | 默认       |
| ---------------- | ------------------------------------------------------------------------------ | ---------- |
| `direction`      | `'vertical'` / `'horizontal'`                                                  | `vertical` |
| `gap`            | 主轴间距（`rowGap`/`columnGap` 覆盖它）                                        | `0`        |
| `justifyContent` | `start` / `center` / `end` / `space-between` / `space-around` / `space-evenly` | `start`    |
| `alignItems`     | `start` / `center` / `end` / `stretch`（`auto` 等同 `start`）                  | `stretch`  |
| `wrap`           | 主轴放不下时换行（flex-wrap 语义，**不是文本换行**）                           | `false`    |
| `alignContent`   | 换行后多行之间的交叉轴分配                                                     | `start`    |
| `reverse`        | 反转视觉顺序                                                                   | `false`    |

> **最常见的意外**：`vbox` 的默认 `alignItems` 是 `stretch`，所以子节点**默认横向占满整行**。如果你想让一个 `Label` 只占它文字的宽度，写 `alignSelf: 'start'`（或给容器 `alignItems: 'start'`）；想让长文本按某个宽度换行，直接给 `Label` 写 `width`（配合 `alignSelf: 'start'`，否则 `stretch` 仍然优先）。
>
> `stretch` 与 `fill` 都会让子节点拿到整行/整格的长度，但仍然受子节点自己的 `minWidth`/`maxWidth`（以及 `{ value, min, max }` 里的额外钳制）约束 —— 两趟测量与排布对同一个子节点的尺寸必须一致，所以 `maxWidth` 在拉伸容器里也照样生效。

换行（`wrap: true`）的几何：**按主轴换行，行沿交叉轴堆叠**。所以 `direction: 'vertical'` + `wrap` 会产生「一列一列」的效果（每列内是纵向排列），需要「一行一行」请用 `hbox` + `wrap`。

---

## 7. 网格：`grid` 的规则

```ts
Grid({ columns: 'auto', minColumnWidth: 160, columnGap: 12, rowGap: 12 }, () => {
  for (const metric of metrics) {
    Panel({ gap: 6, padding: 12, variant: 'surfaceAlt' }, () => {
      Text(metric.label, { tone: 'muted' });
      Text(metric.display, { size: 'xl' });
    });
  }
});
```

| 选项                   | 取值                                    | 默认      |
| ---------------------- | --------------------------------------- | --------- |
| `columns`              | 数字 / `'auto'`                         | `'auto'`  |
| `rows`                 | 数字 / `'auto'`                         | `'auto'`  |
| `minColumnWidth`       | `columns: 'auto'` 时的最小列宽          | `120`     |
| `minRowHeight`         | 固定 `rows` 时的最小行高                | `100`     |
| `columnGap` / `rowGap` | 列/行间距                               | `0`       |
| `justifyItems`         | 单元格内水平对齐                        | `stretch` |
| `alignItems`           | 单元格内垂直对齐                        | `stretch` |
| `autoFlow`             | `'row'`（行优先）/ `'column'`（列优先） | `'row'`   |

子节点侧的网格参数：

```ts
Panel({ gridColumn: 1, gridRow: 1, gridColumnSpan: 2, gridRowSpan: 1 }, () => { … });
```

- `gridColumn`/`gridRow` 是 **1 起始**的下标；两者都写就是完全显式定位。
- 只写一个：另一个方向自动找空位（写 `gridColumn` 则在该列里向下找，反之亦然）。
- 两者都不写：走自动流（`autoFlow`），跳过所有被显式节点占用的格子。
- 显式**列**下标会被夹进 `[1, columns]`；**行**下标只修正下界，写大了会在下方补出新行（`rows` 取声明值与实际最后一行的较大者）。跨行列的尺寸 = `cellWidth × span + gap × (span − 1)`；跨行子节点比现有行高更高时，会把差值平均摊到它覆盖的几行上。
- `columns: 'auto'` 的列数公式：`max(1, floor((可用宽度 + columnGap) / (minColumnWidth + columnGap)))`；宽度不确定时退化为「每个子节点一列」。

---

## 8. 实战一：卡片页

```ts
create(): void {
  render(this.mvvm, () => {
    Panel(
      { direction: 'vertical', gap: 12, padding: 20, variant: 'surface', radius: 12, width: 560 },
      () => {
        Text('账户', { size: 'lg' });
        Divider({});

        Row({ gap: 10, alignItems: 'center' }, () => {
          Text('用户名', { tone: 'muted', width: 96 });
          TextField({ placeholder: '请输入', width: 'fill' });
        });

        Row({ gap: 8, justifyContent: 'end' }, () => {
          Button('取消', { variant: 'ghost' });
          Button('保存', { variant: 'primary' });
        });
      },
    );
  });
}
```

讲解：

- 最外层那个 `Panel` 宽度固定 560、高度 `auto` → 高度是「各行高度之和 + gap + padding 之和」。
- 第一行：`Label` 定宽 96，`TextField` 用 `width: 'fill'` 吃掉剩下的宽度。通常也可以换成 `grow: 1`，但两者**不完全等价**：主轴上的 `fill` 基准是 0（空间不够时会被压成 0），`grow: 1` 保留实测尺寸（空间不够时溢出，除非同时给 `shrink`）。
- 按钮行用 `justifyContent: 'end'`，不需要 `Spacer`。

---

## 9. 实战二：仪表盘（`grow` / `fill` / 百分比 / grid）

按窗口自适应，思路上参考 `#/dashboard`（注意那一页用的是固定 `columns: 4`，不是下面这种 `columns: 'auto'` + `minColumnWidth` 的写法）：

```ts
render(this.mvvm, () => {
  Panel(
    {
      direction: 'vertical',
      gap: 12,
      padding: 16,
      variant: 'plain',
      alignItems: 'stretch',
      width: 'fill',
    },
    () => {
      Row({ gap: 12, padding: 16, alignItems: 'center', width: 'fill' }, () => {
        Text('Ops dashboard', { size: 'lg' });
        Spacer({ flex: true }); // 把右侧内容推到最右
        Button('刷新', { size: 'sm' });
      });

      Grid(
        { columns: 'auto', minColumnWidth: 180, columnGap: 12, rowGap: 12, width: 'fill' },
        () => {
          for (const metric of metrics) {
            Panel(
              { direction: 'vertical', gap: 6, padding: 16, variant: 'surfaceAlt', radius: 10 },
              () => {
                Text(metric.label, { tone: 'muted' });
                Text(metric.display, { size: 'xl' });
              },
            );
          }
        },
      );
    },
  );
});
```

这里的关键：

- **`width: 'fill'` 一层层往下传**：`UIRoot` 撑满屏幕 → 页面那个 `Panel` 撑满根 → 它里面的顶栏 `Row` 与卡片 `Grid` 撑满页面。
- `columns: 'auto'` + `minColumnWidth: 180` 让卡片数量随宽度变化，不用写媒体查询。
- 卡片不写宽高：grid 的 `justifyItems`/`alignItems` 默认 `stretch`，单元格决定卡片尺寸；高度由内容（两行文本 + padding）决定。

---

## 10. 实战三：层叠与角标（`stack` + `absolute`）

```ts
Stack({ width: 240, height: 140, align: 'center' }, () => {
  Panel({ width: 'fill', height: 'fill', variant: 'surfaceAlt', radius: 12 }, () => {
    Text('库存', { tone: 'muted' });
  });
  Text('+12', {
    position: 'absolute',
    right: -10,
    top: -10,
    tone: 'danger',
  });
});
```

- `stack` 的默认对齐是 `center`，所以两个子节点都居中；`absolute` 的子节点由偏移决定位置，`right: -10` 表示「比右边界再往外 10px」——角标就是这么做的。
- 想要遮罩 + 对话框，就用 `stack` 里放一个 `variant: 'overlay'`、`width/height: 'fill'` 的 `Panel`，再放一个居中的对话框 `Panel`（`Modal` 控件本身属 **M8，尚未实现**）。

---

## 11. 滚动端口：布局上的一个特例

`ScrollView` 内部把容器设成 `scroll` 端口，它做两件事：

1. **把滚动轴的最大值解除**：内容可以比视口长。如果沿用普通容器的规则（内容被父尺寸夹住），比视口高的内容会被压扁，后面所有流式位置都会错。
2. **把内容放在端口原点**：真正的滚动偏移不是布局，而是控件把 `-offset` 写进内容 holder 的 `left`/`top`（因为 holder 是 `position: 'absolute'`），所以滚动**不会**重新触发 measure 阶段。

对使用者的影响：**视口必须自己有确定尺寸**（写 `width`/`height` 或 `'fill'`），不要指望 `ScrollView` 靠内容撑高 —— 它的 `measureContent` 返回 `0×0`。

---

## 12. 像素对齐与清晰度

- 布局内部用**亚像素**计算，只在写入 `applyRect` 之前按 `dpr` + `snapMode` 取整一次。
- `UIRoot` 的两个选项控制它：

```ts
new UIRoot(scene, { dpr: 1, snapMode: 'round' }); // 默认 dpr=1, snapMode='round'
```

`dpr` 的含义是**绘制缓冲的像素 / 布局单位**，不是 `window.devicePixelRatio`：Phaser 把画布后备缓冲固定成 `gameSize`（它只在 CSS 像素上缩放画布），所以一个布局单位永远是一个缓冲像素，屏幕多密都一样。**把网格设得比缓冲更细不会变清晰**，只会让每条边的坐标落在半像素上、被光栅化成两个半亮的像素 —— 边框和文字框会因此发虚（V79，见 [`PITFALLS.md`](../PITFALLS.md) §8.72）。

什么时候**才**该设成 2：当你把内容渲染得**比布局空间更大**时（相机 `setZoom(2)`，或把一个容器 `setScale(2)`）—— 那时一个布局单位覆盖两个缓冲像素，`dpr: 2` 才是对的。

| `snapMode`           | 效果                               |
| -------------------- | ---------------------------------- |
| `'round'`（默认）    | 四舍五入到缓冲像素格               |
| `'none'`             | 保留亚像素（动画更顺，字可能发虚） |
| `'floor'` / `'ceil'` | 向下/向上取整                      |

### 12.1 文字清晰度：字形是按显示倍率烘焙的

`Phaser.GameObjects.Text` 的字形**只光栅化一次**：构造时按布局单位下的字号画进一张画布纹理。所以画布后备缓冲比屏幕稀时（`Scale.FIT` 把 450×900 的设计缩到 338.5 CSS 像素，浏览器再放大到 677 物理像素），屏幕上的字只能是对那张纹理的**放大**，相机和大缓冲都救不回来。

框架因此按**显示倍率**烘焙字形（`Widget#textResolution` → `MVVMPlugin#textResolution`，值为 `devicePixelRatio × 画布 CSS 宽 ÷ gameSize`，取整到 ½ 档、上限 2）：

- `1.5`：450×900 的 `FIT` 设计在 2× 屏上按 0.75 缩放显示（就是上面那组数字）；
- `2`：`RESIZE` 游戏在任何 HiDPI 屏上；
- 想按自己的内存预算调（纹理面积是倍率的平方）：

```ts
MVVMPlugin.configure({ textResolution: 1 }); // 关掉加密（低端机内存紧）
MVVMPlugin.configure({ textResolution: 3 }); // 高 DPI 手机上换更锐的字（显式值不受上限 2 与 ½ 档约束）
```

`Phaser.GameObjects.Text` 的显示尺寸仍按布局单位算（渲染时除以 `source.resolution`），所以**测量、布局、命中测试都不动**；改动只影响**之后**创建的文本。要自己烘焙美术资源（棋子、筹码、棋盘）时读同一个倍率：

```ts
const scale = this.mvvm.renderScale; // 1.504，用它决定烘焙尺寸
```

### 12.2 连矢量线条一起变锐：设备分辨率渲染（`designResolution`）

12.1 只救得了**烘焙**出来的像素。面板描边、棋盘格线、任何每帧画的 `Graphics` 是在相机变换**之后**按**绘制缓冲**光栅化的，而缓冲永远等于 `gameSize` —— 用 450×900 的设计跑 `Scale.FIT`，在 2× 屏上就是一张 450×900 的位图铺在 780×1560 个物理像素上，整幅画面被放大 1.73 倍，`1px` 的线变成一条 3 设备像素的糊线。

要让它们也锐，就得把**游戏本身**做成设备分辨率，再用相机把设计空间放大回来：

```ts
const dpr = Math.min(window.devicePixelRatio, 3);

// ① UI 层知道"页面是按 450×900 排的，游戏比它大 dpr 倍"
MVVMPlugin.configure({ designResolution: { width: 450, height: 900 } });

// ② 游戏尺寸 = 设计 × dpr（画布 CSS 尺寸不变，变的只是后备缓冲）
const game = new Phaser.Game({
  scale: { mode: Phaser.Scale.FIT, width: 450 * dpr, height: 900 * dpr },
  // …
});

// ③ 每个场景：相机缩放 dpr，并且**对准设计框中心**
const camera = this.cameras.main;
camera.setZoom(dpr);
camera.centerOn(225, 450); // 少了这一行只会看到设计框的四分之一
```

第 ③ 步的两个操作缺一不可：Phaser 的 `worldView = midPoint ± (gameSize ÷ zoom)/2`，而 `midPoint = scroll + gameSize/2` —— **zoom 只决定看多大范围，不决定看哪一块**。所以缩放了却不居中，画面会偏到设计框的一角，而且命中测试会整体错位（实测症状：画面"看着还行"，但点击全部落空）。

`designResolution` 一次回答四个问题：

| 派生量                          | 公式                                  | 不设会怎样                                 |
| ------------------------------- | ------------------------------------- | ------------------------------------------ |
| 根的布局尺寸                    | `designResolution`（否则 `gameSize`） | 页面在 900×1800 里排版，整体缩小一半       |
| 吸附网格 `layoutEngine.dpr`     | `gameSize.width ÷ 设计宽`             | 回到 §12 的半像素问题                      |
| 字形烘焙倍率 `mvvm.renderScale` | `dpr × 画布 CSS 宽 ÷ 布局宽`          | 用 gameSize 当分母会少算一个倍率（字变糊） |
| 隐藏输入框的摆放（DOM 桥）      | `renderScale ÷ dpr`                   | 位置错一倍，IME 候选框飘走                 |

**相机放大不了细节，只能放大已有的像素**，所以凡是"烘焙过一次"的东西都要自己按倍率重做，否则开了设备分辨率反而更糊：

- `Graphics.generateTexture` 的贴图：在 `generateTexture` 之前 `graphics.setScale(倍率)` 即可，绘制代码一行都不用改（它内部走 `SetTransform`，会应用 `Graphics` 自己的变换）；
- `Phaser.Text`：只有 `style.resolution` 一个入口（Phaser 4 缺省强制成 1，没有 Game Config 通道），而且它**与 `setScale` 相乘**——`fontSize: 52` 又 `setScale(1.8)` 的标题需要 `resolution: 倍率 × 1.8`；
- **只给"消费者一定会 `setDisplaySize`"的贴图加密**：按原始尺寸显示的粒子会直接变大，而不是变清楚。

实测（揭棋，dpr 2 / 390×844）：后备缓冲 450×900 → **900×1800**（画布 CSS 不变），棋盘格线剖面从 `109,87,74,77,88,131`（没有实心像素）变成 `102,72,72,72,84,148`（有实心核），强边缘像素 3308 → **15281**，最锐梯度 86.2 → **121.7**。完整踩坑记录见 [`PITFALLS.md`](../PITFALLS.md) §8.73。

---

## 13. 脏标记与测量缓存：UI 不更新时先看这里

布局不会每帧重跑，它只在「有脏节点」时跑。让节点变脏的**唯一正确方式**：

```ts
widget.setText('新文本'); // 控件内部会 markDirty()
widget.setLayoutParams({ width: 240 }); // 部分更新：只改提到的字段，并 markDirty()
widget.setVisible(false); // 内部 markDirty()
widget.markDirty(); // 自定义控件里，改了影响尺寸的东西后手动调用
```

**不要**直接改：

```ts
widget.layoutParams.width = 240; // ❌ 引擎不知道要重算，界面不会变
```

`setLayoutParams` 是**部分合并**（`mergeParams`）：只覆盖你写到的键，没写的保持原值。所以 `setLayoutParams({ height: 100 })` 不会悄悄把 `position: 'absolute'` 或 `width: 'fill'` 重置掉。

容器还有对称的第二个入口 —— **`setContainerOptions(patch)`**：布局参数描述控件**自己的盒子**（`width`/`padding`/`grow`…），容器选项描述它**怎么摆子节点**（`gap`/`alignItems`/`columns`…）。两个都是部分合并、都会 `markDirty()`；对**有选项对象的容器**（box/grid/stack），键不认识时会在开发模式下指名告警（与建树时的选项审计同一条规则）。**两个例外**：非容器上调用会报「not a container，patch 被忽略」；而 `absolute` 容器**没有选项对象**（`{ type: 'absolute' }`），它的补丁会被静默丢弃——这类容器本来也没有可调的子节点排布选项。

### 声明式写法：间距与尺寸也是槽位（第 105 轮）

上面两条是命令式入口。**在 DSL 里你几乎不需要它们**——`LayoutParams` 与容器的选项接受 `Ref`/getter，和 `value`/`disabled`/`variant` 一样是数据槽：

```ts
const dense = ref(false);

Column({ gap: () => (dense.value ? 4 : 16), padding: () => (dense.value ? 6 : 18) }, () => {
  Text('第一行');
  Text('第二行');
});

Text('标题', { width: () => (dense.value ? 120 : 240) }); // 叶子控件自己的盒子同样是槽位
```

翻 `dense` 会让**引擎重跑这一小片的布局**，而不是重建子树——焦点、滚动偏移、子节点自己的状态（输入框里的文字、滚动位置）都留着，这正是槽位的意义。判据与实现：

- 能当槽位的键**恰好是** `LayoutParams` 的全部键 + 该控件容器的选项键；其它选项（`onClick`、`items`、`validate`…）保持字面量类型，因为它们没有运行期入口——类型上不承诺、运行期不静默（`check-doc-options` 与选项审计守着这条）。
- 建树时按**当前值**解析（`readReactive`），之后每次变化才走绑定——所以"第一次就是槽位形态、之后一直跟着走"。
- 手写顺序仍然是「改值 → `markDirty()`」；槽位只是把这一步替你做了（内部调用 `setLayoutParams`/`setContainerOptions`）。

### 缓存与 relayout boundary

- 测量结果缓存在节点上，键是「约束 + 该节点的 `revision`」。`revision` 由 `markDirty()` 递增。
- `invalidate()` 会沿 `parent` 链向上标脏，但遇到 **relayout boundary** 就停止向上**测量**（仍然会把上面的祖先记进 `dirtyPath`，让 arrange 能走下去）。`Widget` 的判定是：**宽高都是固定数字且没有 `aspectRatio`**。
- 因此 `UIRoot.flushLayout()` 检查的是 `engine.hasDirtyNodes`，而不是 `isDirty(root)` —— 固定尺寸面板内部的变化不会把根标脏。

> 推论：你的自定义控件如果**尺寸不受内容影响**（固定宽高），改内部内容后 `markDirty()` 只会重算它自己这一棵子树，页面不会重排。这正是性能预算里「无变化帧布局耗时 = 0」能成立的原因。

### 全局失效

换了字体、改了全局主题导致所有缓存失真时，可以显式丢缓存：

```ts
root.layoutEngine.reset(); // 丢掉整棵树的测量缓存
root.layoutEngine.reset(someNode); // 只丢这个节点自己的缓存条目（子孙仍各用自己的缓存）
```

（普通主题切换不需要这么做：`Widget` 订阅了主题变化，会自己 `markDirty()` 重画。）

---

## 14. 调试布局：读计数器

```ts
const stats = this.mvvm.root.layoutEngine.stats;
console.table(stats);

// 或者只想看每个节点的最终矩形（父容器局部坐标）
console.log(widget.name, widget.appliedRect);
```

| 计数器            | 含义                                    | 健康表现                             |
| ----------------- | --------------------------------------- | ------------------------------------ |
| `passes`          | 跑过的完整布局次数                      | 静止时**不再增长**                   |
| `measureCalls`    | 真正执行的 `measureContent` 次数        | 与「变化量」同阶，不是与节点总数同阶 |
| `cacheHits`       | 命中测量缓存的次数                      | 表单类界面 > 95%                     |
| `arrangeCalls`    | 调用 `applyRect` 的次数                 | ≤ 节点数                             |
| `placedChildren`  | 被摆放到具体矩形的子节点数              | 同上                                 |
| `skippedSubtrees` | 因为「rect 没变且不脏」被整棵跳过的子树 | 静止后应大量增长（说明没有无谓重排） |
| `snappedRects`    | 做过像素取整的矩形数                    | `snapMode: 'none'` 时为 0            |

排查顺序建议：**先看 `passes` 是否在静止时还在涨**（说明有东西每帧 `markDirty`），再看 `measureCalls` 是否接近全树规模（说明 relayout boundary 没生效或约束每帧都在变）。

---

## 15. 常见布局错误对照表

| 现象                                | 原因                                                            | 修法                                                       |
| ----------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| 子节点横向意外占满整行              | `vbox` 默认 `alignItems: 'stretch'`                             | 给子节点 `alignSelf: 'start'` 或容器 `alignItems: 'start'` |
| 滚动视图停在空白处                  | 视口变大或内容变短后偏移越界（已修：每帧按最新 limit 重新夹取） | 升级到含该修复的版本；`bounce: true` 时由回弹接管          |
| 长文本不换行/不省略                 | `Label` 被 stretch 到很宽，或 `wrap: false`；也可能宽度不确定   | 给 `Label` 明确的 `width`，或 `maxLines` + `ellipsis`      |
| `width: '50%'` 没效果               | 父容器该轴尺寸不确定（`auto`），百分比无法解析 → 退化为 `auto`  | 让父级有确定宽度（数字或 `'fill'`，且一路有确定基准）      |
| `minWidth: '50%'` 之后元素消失/变 0 | 上下限以基准 `0` 解析百分比                                     | 上下限只写数字                                             |
| 内容比容器高，后面的东西重叠        | 普通容器会夹住子节点；想溢出请用 `ScrollView`（`scroll` 端口）  | 换 `ScrollView`，或让容器高度 `auto`                       |
| 改了 `layoutParams` 界面不更新      | 绕过 `setLayoutParams`/`markDirty`                              | 用 `setLayoutParams(patch)`                                |
| 换了数组内容但列表不更新            | `Repeat` 读的是响应式源；直接换普通数组引用不会触发             | 用 `reactive([...])` / `ref([...])` 持有数组（06 章）      |
| grid 里子节点没填满格子             | `justifyItems`/`alignItems` 被写成 `start`/`center`             | 用默认 `'stretch'`，或写 `width: 'fill'`                   |
| 绝对定位节点跑到左上角              | 忘了 `position: 'absolute'`（在 `absolute` 容器里也必须写）     | 补上 `position: 'absolute'`                                |

---

## 16. 小结

- 布局 = 两遍：**measure 向下传约束、向上回尺寸；arrange 分内容盒并写回矩形**。
- 尺寸只有四种：固定、`auto`（内容）、`fill`（撑满父内容盒）、百分比。主轴伸缩用 `grow`/`shrink`/`basis`。
- 五种容器各司其职，且 `position: 'absolute'` 可混入任何一种。
- 想改尺寸 → 走 `setLayoutParams` / `markDirty`；想知道为什么没重排 → 看 `LayoutEngine#stats`。

下一篇 [03 控件](./03-widgets.md)：把 `Label`/`Panel`/`Button`/`Image`/`Spacer`/`Divider` 的每个选项、方法和事件逐个过一遍。
