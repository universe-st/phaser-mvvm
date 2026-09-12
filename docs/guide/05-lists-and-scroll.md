# 05 · 列表与滚动：`ScrollView` 与 `Repeat`

本章目标：做出一个 **220 行、只挂载可见窗口、能拖能滚能甩**的列表，并搞清楚「滚动」和「虚拟化」这两件事是怎么拼在一起的。

> 对应示例：[`apps/examples/src/scenes/scroll.ts`](../../apps/examples/src/scenes/scroll.ts)（`#/scroll`，纵向 + 横向 + 嵌套三种）与 [`apps/examples/src/scenes/list.ts`](../../apps/examples/src/scenes/list.ts)（`#/list`，虚拟化 + 键控复用 + 筛选）。

> **本章代码用 Compose 风格 DSL 书写**（[09 章](./09-compose-dsl.md)，可运行示例 `#/compose` 的 list 段与 `#/scroll`）：`Scroll({ … }, () => { … })`、`List({ … }, (row, index) => { … })`。DSL 直接构造同两个控件类，选项表与工厂写法（`this.add.uiScroll` / `this.add.uiRepeat`）完全通用；`List` 就是 `Repeat`，模板从 `template:` 选项变成第二个参数（`LazyColumn` 的写法）。

---

## 1. `ScrollView`：先做最简单的一个

```ts
const scroll = Scroll({ width: 360, height: 240, direction: 'vertical', scrollbar: 'auto' }, () => {
  Panel({ direction: 'vertical', gap: 8, width: 'fill' }, () => {
    Text('第一行');
    Text('第二行');
    // …很多行
  });
});
```

**最重要的一条**：`ScrollView` 自己**没有内容尺寸**（`measureContent` 返回 `0×0`），视口尺寸必须由你给（`width`/`height` 数字或 `'fill'`）。内容是「里面可能比视口长」的那棵树。

---

## 2. 选项

| 选项            | 类型                                   | 默认         | 说明                                                                    |
| --------------- | -------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `direction`     | `'vertical' \| 'horizontal' \| 'both'` | `'vertical'` | 滚动轴；交叉轴内容会被视口宽度/高度约束                                 |
| `content`       | `Widget`                               | —            | 初始内容（等价于构造后调 `setContent`）                                 |
| `scrollbar`     | `boolean \| 'auto'`                    | `'auto'`     | `'auto'` 只在内容溢出时画；`true` 常显；`false` 不画                    |
| `zoom`          | `boolean \| { min?, max? }`            | `false`      | 双指捏合缩放（默认关闭）；缩放时内容 holder 直接 `setScale`，不触发布局 |
| `scrollbarSize` | `number`                               | `8`          | 滚动条粗细（设计像素，最小 2；会被夹到短边的 1/3）                      |
| `wheelSpeed`    | `number`                               | `1`          | 滚轮增量倍率                                                            |
| `drag`          | `boolean`                              | `true`       | 是否允许拖拽滚动                                                        |
| `inertia`       | `boolean`                              | `true`       | 松手后是否继续滑行（甩动）                                              |
| `bounce`        | `boolean`                              | `false`      | 越界橡皮筋回弹（默认到边界就停）                                        |

内部常量（也导出，方便你写测试）：拖拽判定阈值 `SCROLL_DRAG_THRESHOLD = 10`、起甩最小速度 `FLING_MIN_VELOCITY = 0.08`、键盘行步长 `KEY_LINE_STEP = 40`、最小滑块长 `MIN_THUMB = 28`。

---

## 3. 方法、属性与事件

| 成员                                    | 说明                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `setContent(widget)`                    | 换内容（**旧内容会被销毁**），偏移归零，重新解析虚拟化目标                                       |
| `setScrollOffset(number \| {x, y})`     | 设置偏移（数字只作用于主轴），会按边界夹取/回弹                                                  |
| `scrollBy(dx, dy)`                      | 相对移动（不滚的轴会被忽略）                                                                     |
| `scrollTo(number \| 'top' \| 'bottom')` | 绝对定位到某个偏移或两端                                                                         |
| `stopScroll()`                          | 立刻结束甩动                                                                                     |
| `get offset` / `get maxOffset`          | 主轴当前/最大偏移                                                                                |
| `get offsetX/Y` / `get maxOffsetX/Y`    | 分轴偏移                                                                                         |
| `get viewport` / `get contentSize`      | 视口尺寸 / 内容尺寸（普通内容由已排布矩形汇总；内容是虚拟化列表时取列表的 `maxOffset + 视口高`） |
| `get scrollable`                        | 主轴上内容是否比视口长                                                                           |
| `get isDragging`                        | 是否正在拖拽                                                                                     |
| `get content` / `get scrollTarget`      | 内容控件 / 被驱动的虚拟化列表（如果有）                                                          |

| 事件      | 触发                | 载荷                               |
| --------- | ------------------- | ---------------------------------- |
| `scroll`  | 偏移变化            | `{ x, y, maxOffsetX, maxOffsetY }` |
| `content` | `setContent` 生效后 | 新的内容 `Widget`                  |

```ts
scroll.on('scroll', ({ y, maxOffsetY }) => {
  console.log(`${Math.round((y / Math.max(1, maxOffsetY)) * 100)}%`);
});
```

---

## 4. 手势、滚轮与嵌套

| 输入     | 行为                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 指针拖拽 | 内容跟随指针；达到 10px 才算拖拽（所以**拖列表不会误点按钮**）；松手按速度决定是否甩动                                    |
| 滚轮     | 挂在画布上的 `wheel` 监听；命中视口才处理，并按 `deltaMode`（像素/行/页）归一化                                           |
| 滑块拖拽 | 抓滑块本身：按比例移动，抓边缘不会跳；点轨道空白：滑块中心跳到指针位置（原生滚动条行为）                                  |
| 键盘     | 需要**控件持有焦点**：`Home`/`End` 到两端；`↑↓`（纵向）、`←→`（横向）、`PageUp/PageDown`；`Tab`/`Enter`/`Escape` 从不消费 |
| 触摸     | 走同一条指针路径（Phaser 的 pointer 抽象）                                                                                |

**嵌套滚动的规则**（`scroll.ts` 与 `list.ts` 里的真实场景）：

- **最内层的可滚动视口赢得手势**：指针下面是内层列表时，外层页面不动（拖拽和滚轮都遵循这条）。
- **滚轮会向上链式传递**：内层已经到头、或者根本不在该轴上滚（比如纵向页面里的横向条带），剩下的增量交给外层 —— 列表滚到底后继续滚会接着滚页面，而不是「卡住」。
- **测量也尊重嵌套边界**：外层视口计算内容长度时会**停在内层 `ScrollView`**，只算内层视口的大小，不会把内层那几千像素的内容算成自己的长度。

> 拖拽冲突是这类组件最容易出 bug 的地方，框架的取舍写在了源码注释里；如果你要实现自定义滚动，务必把 `ScrollView` 的这两个判定（`innermostAt` / `collectRects` 的提前返回）作为参考。

---

## 5. 裁剪是怎么实现的（以及为什么要知道）

| 渲染器     | 方案                                                                                              | 备注                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **WebGL**  | `Components.Filters`：开滤镜 → 加一个 `__WHITE` 内部 `Mask` 滤镜 → **手动**把滤镜相机对准自身矩形 | Phaser 4 里滤镜渲染到「与对象同尺寸的 framebuffer」，超出的部分不渲染，这就是裁剪                         |
| **Canvas** | `GeometryMask`（一个白色矩形，随视口每帧重绘）                                                    | Phaser 4 的 `GeometryMask` **仅 Canvas 可用**，正好和滤镜互补；会 `console.warn` 一次说明当前走的是哪条路 |

对使用者的实际影响：

- **不要用 `setMask(graphics)` 那套 Phaser 3 思路做裁剪**：WebGL 下无效（[ADR-0007](../adr/0007-phaser4-webgl-constraints.md)）。
- 视口尺寸为 0（还没布局，或父容器给到 0 尺寸）时裁剪会被撤销，等它有尺寸后自动重建。（被隐藏的节点拿不到 `applyRect`，不会触发这次重建。）
- **视口自身不能在滚动时移动**：裁剪框跟着控件矩形走，所以滚动移动的是「内容 holder」而不是视口。这也是为什么滚动偏移写进 holder 的 `left`/`top`，而不是改视口位置。

---

## 6. `Repeat`：列表渲染器

### 6.1 最小示例（不虚拟化）

```ts
const names = ['Alice', 'Bob', 'Carol'];

const list = List({ items: () => names, key: (name) => name, gap: 6 }, (name, index) => {
  Text(`${index + 1}. ${name}`, { height: 32 });
});
```

| 选项                   | 类型                                           | 默认       | 说明                                                                              |
| ---------------------- | ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `items`                | `() => readonly Item[]`                        | **必填**   | 数据源。**在 `flush: 'frame'` 的 effect 里读取**，所以一帧内多次变更只做一次 diff |
| `key`                  | `(item, index) => string \| number`            | **必填**   | 行身份。键相同就复用控件，键消失就卸载                                            |
| `template`             | `(item, index, ctx: BindingContext) => Widget` | **必填**   | 构造一行；`ctx` 提供 `$item`/`$index`/`$root`/`$parent`（06 章）                  |
| `update`               | `(widget, item, index) => void`                | —          | 键存活但**对象引用变了**时调用；不提供就整行重建                                  |
| `gap`                  | `number`                                       | `0`        | 行间距（`container: { gap }` 的简写；网格列表请用下面两个）                       |
| `rowGap` / `columnGap` | `number`                                       | `0`        | 换行流/网格的行列间距（同上，都是简写）                                           |
| `container`            | `BoxLayoutOptions \| GridLayoutOptions`        | 纵向 box   | 行的排布算法（网格列表就传 grid 选项）；显式字段优先于上面的简写                  |
| `virtualize`           | `boolean`                                      | `false`    | 只挂载可见窗口（见 §7）                                                           |
| `itemExtent`           | `number`                                       | —          | 单行长度，**包含行间距**（虚拟化必需）                                            |
| `overscan`             | `number`                                       | `2`        | 窗口上下各多挂几行                                                                |
| `empty`                | `(() => Widget) \| null`                       | `null`     | 空数据时显示的控件                                                                |
| `context`              | `BindingContext`                               | 空根作用域 | 行的**父作用域**；给了之后行模板能通过 `$root`/`$parent` 读到页面 VM              |

| 成员                                   | 说明                               |
| -------------------------------------- | ---------------------------------- |
| `getRenderedKeys()`                    | 当前挂载的键（视觉顺序）           |
| `getWidgetForKey(key)`                 | 某键对应的控件，未挂载时为 `null`  |
| `get renderedCount` / `get totalCount` | 已挂载行数 / 数据总数              |
| `setScrollOffset(offset)`              | 驱动虚拟窗口（非虚拟化时是空操作） |
| `get offset` / `get maxOffset`         | 虚拟窗口当前/最大偏移              |
| `get virtualizedEnabled`               | 虚拟化是否真的生效                 |
| `refresh()`                            | 丢弃全部行并按当前数据重建         |

### 6.2 键控复用：`Repeat` 到底做了什么

数据变化时它做一次 **keyed diff**，结论只有四类：

| 情况                     | 行为                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| 新键                     | `template(...)` 建一行并挂上                                                  |
| 旧键消失                 | 该行 `removeWidget(..., destroy)` 销毁                                        |
| 键存活、`index` 变了     | **不重建**：行的 `$index` 是响应式的，下一次 flush 时 `{{ $index }}` 自己更新 |
| 键存活、**对象引用变了** | 有 `update` 就调它（只改差异，最省）；没有就重建这一行                        |

因此 `Repeat` 只做「视觉顺序」的调整：追加是廉价的（逐个 `addWidget`），只有真正发生**重排**时才会先摘再挂。

```ts
// 220 行里删掉中间某几行：只有被删的行销毁，其它行原地复用
this.rows.splice(10, 3);
```

> 行的 `ctx` 里 `$item`/`$index` 是**响应式**的，所以一行「换了身份但键不变」时，模板里用 `bindTemplate` 写的东西会自动更新 —— 这就是「键控复用」的语义。

---

## 7. 虚拟化：只挂载看得见的行

```ts
const list = List<Row>(
  {
    items: () => this.rows,
    key: (row) => row.id,
    gap: ROW_GAP,
    virtualize: true,
    itemExtent: ROW_HEIGHT + ROW_GAP, // ← 注意：含行间距
    overscan: 3,

    // 虚拟化需要知道「看得到多高」：自身或某个祖先必须有确定高度。
    // 只写 virtualize + itemExtent 而不给高度时，窗口会塌成 overscan 行
    // （开发模式会告警），所以这里给它一个高度——实际项目里通常像 §8 那样放进 Scroll。
    height: 320,
  },
  (row, index, ctx) => this.rowWidget(row, index, ctx),
);
```

> 三个前提缺一不可：`virtualize: true`、正的 `itemExtent`、以及**能解析出高度**的容器（自身 `height`，或祖先/外层 `ScrollView` 的视口高度）。

两个硬性前提（不满足会通过 `warn()` 提示并**退化为渲染全部行**）：

1. `itemExtent` 是**正数**；
2. `container` 是**纵向 box**（`describeRepeatFlow` 的 `virtualizable` 判定）。

工作原理：

- 数据仍然是「全量」的，`Repeat` 只决定**挂载哪一段窗口**。
- 未挂载的行由**两个 filler 控件**占位：前 filler 高度 = 窗口起点之前的全部高度，后 filler = 剩余高度。于是挂载中的行依然落在它们**真实的滚动坐标**上（`index × itemExtent`），不需要额外偏移补偿。
- 窗口由 `setScrollOffset(offset)` 驱动；偏移会被夹在 `[0, maxOffset]`，`maxOffset = itemCount × itemExtent − gap − 视口高度`。
- 视口大小取「自身高度」与「父容器高度」里可用的那个；`applyRect` 里窗口变化会推迟到微任务再重算（避免在引擎遍历树的时候改树）。

对外可观测状态：`renderedCount` / `totalCount` / `getRenderedKeys()` / `offset` / `maxOffset`，示例页把 `first`/`last` 也发布到 `#demo-state` 便于断言。

> **不要**自己再给 `Repeat` 设 `overflow` 之类的概念：它就是一棵会自己增减子节点的树，滚动交给外面的 `ScrollView`。

---

## 8. 组合：虚拟列表 + 滚动视口

这是长列表的标准写法（来自 `#/list`）：

```ts
const listScroll = Scroll({ width: 'fill', height: 'fill', direction: 'vertical' }, () => {
  // 内容是一层普通容器，把列表包起来（也可以是 Panel，用于背景）
  Panel({ direction: 'vertical', width: 'fill', height: 'fill', variant: 'plain' }, () => {
    List<Row>(
      {
        items: () => this.visibleRows,
        key: (row) => row.id,
        gap: ROW_GAP,
        virtualize: true,
        itemExtent: ROW_HEIGHT + ROW_GAP,
        overscan: 3,
        context: this.pageContext, // 让行能读到页面 VM（$root/$parent）
        width: 'fill',
        height: LIST_HEIGHT,
        name: 'list.repeat',
      },
      (row, index, ctx) => this.rowWidget(row, index, ctx),
    );
  });
});
```

> `Scroll` 的内容 lambda 里**只能放一个**根控件（这里的 `Panel`），`List` 的第二个参数（一行）同理：两者都用 `buildUiSubtree`，**建出 0 个或 2 个以上根会直接抛错**（错误信息会告诉你用 `Column`/`Row`/`Panel` 包一层），而不是悄悄替你包一层。

**两者如何协同**（这是最容易搞混的一点）：

1. `ScrollView.setContent(...)` 时会向下查找虚拟化目标（`findVirtualTarget`），找到 `Repeat` 就记下来（`scroll.scrollTarget`）。
2. 滚动时 `ScrollView` 做两件事，**合起来才是一次滚动**：
   - 把内容 holder 的 `left`/`top` 设为负偏移 —— 这是屏幕上真正看到的移动；
   - 把同一个偏移转发给 `list.setScrollOffset(offset)` —— 这只是告诉列表「该挂载哪一段」。
3. 所以**不会出现「滚了两次」**：列表只负责「哪些行存在」，位置始终由 holder 平移决定。
4. 查找会**停在内层 `ScrollView`**：内层列表有自己的窗口，外层不允许越权驱动它。

想手动跳转就用 `scroll.scrollTo('bottom')` / `scroll.setScrollOffset(n)`，列表窗口会自动跟上。

---

## 8.5 双指捏合缩放（移动端）

```ts
Scroll({ width: 320, height: 300, zoom: { min: 0.5, max: 2.5 } }, () => {
  Image({ texture: 'map', width: 600, height: 600 });
});
```

- **两指落下即开始**：距离决定缩放比，两指中点是锚点——**锚点下的内容点始终留在手指之间**（否则会朝视图角落缩放，手感立刻不对）。
- **可滚动范围随缩放变化**：内容在屏幕上的尺寸是 `extent × scale`，所以放大后可平移的范围同步变大（实测：内容 1276px、视口 300px，scale 0.75 时 `maxOffset = 1276×0.75−300 = 657`）。
- **单指仍然是滚动**：捏合结束后立刻回到拖动（这条曾经有缺陷——第二根手指的按下会顺手武装一个属于它的拖动，导致手势结束后视图「死了」，见 `docs/DEFECT-BACKLOG.md` V15）。
- **不触发布局**：只对内容 holder 做 `setScale`，测量结果不变，因此捏合过程零布局趟。
- 鼠标用户走 API：`scroll.setZoom(scale, focus?)`（`focus` 是视口坐标，默认视口中心），`get zoom` 读当前值；事件 `'zoom'` 带新 scale。
- **虚拟化列表不支持**：缩放后的列表需要把 `itemExtent` 也按比例映射才能算对窗口，因此 `zoom` 与虚拟列表同时配置时会 `warn` 一次并忽略手势。

---

## 9. 性能与坑

**性能预算**（PLAN §8 与 M7）：基准页跑 1000 节点布局与 1000 行虚拟列表，要求**无掉帧、无内存增长趋势**；无变化帧布局耗时为 0；连续滚动不应触发全量 `measure`。

| 坑                           | 原因                                                             | 修法                                                      |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| 视口高度是 0，什么都看不到   | `ScrollView` 不按内容撑高                                        | 给视口明确 `height`（或 `'fill'`，且父级有确定高度）      |
| 虚拟化没生效，220 行全挂上了 | 缺 `itemExtent`、或 `container` 不是纵向 box                     | 看控制台 `warn` 提示，补上两者                            |
| 行之间越来越错位             | `itemExtent` **没算上行间距**，或行高与 `itemExtent` 不一致      | `itemExtent = 行高 + gap`，并让模板真的产出该高度         |
| 拖列表时误触发了行内按钮     | 拖拽阈值 10px 已处理大部分情况；如果按钮很大且用户手抖           | 提高 `this.mvvm.input.dragThreshold`（07 章）或把按钮做小 |
| 列表在 `Repeat` 上滚不动     | 滚动必须由 `ScrollView` 承担；`Repeat` 只决定挂载窗口            | 用 §8 的组合结构                                          |
| 嵌套滚动时内外一起动         | 自定义滚动实现没有做「最内层优先」判定                           | 参考 `ScrollView.innermostAt` / `collectRects` 的写法     |
| 换数据后列表不更新           | 数据源不是响应式的（普通数组直接赋值）                           | 用 `reactive([...])` / `ref([...])` 持有数组（06 章）     |
| 数据变了但某几行内容没变     | 只改了 `index`，行靠响应式 `$index` 更新；若绑的是普通闭包则不会 | 行内容请通过 `ctx` 的 `$item`/`$index` 或 `bind*` 绑定    |
| 列表滚到底后继续滚，页面不动 | 滚轮链需要外层也是 `ScrollView`                                  | 把外层页面放进 `ScrollView`（参考 `#/scroll` 的嵌套示例） |

---

## 10. 小结

- `ScrollView` = **裁剪 + 手势 + 滚动条**，它不产生尺寸，视口尺寸由你给。
- 裁剪在 WebGL 走滤镜、Canvas 走 `GeometryMask`；视口不动、内容动。
- `Repeat` = **键控 diff**，可变的部分只有「哪些行存在」；`virtualize` 时用 filler 保持真实坐标。
- 两者组合时，滚动只发生一次：holder 平移负责视觉，`setScrollOffset` 负责窗口。

下一篇 [06 数据绑定与主题](./06-data-and-theme.md)：把这一章的列表、上一章的表单接到 `ref`/`computed` 上，并学会换肤。
