# 09 · Compose 风格 DSL：把视图写成嵌套调用

本章目标：让你写界面的手感和 Jetpack Compose 一样——**没有 `this.add`，没有 children 数组，没有 scene 参数**，嵌套就是缩进。

```ts
import { ui, Column, Row, Text, Button } from '@phaser-mvvm/widgets/compose';

const page = ui(this, () => {
  Column({ gap: 12, padding: 20, width: 520 }, () => {
    Text('Hello phaser-mvvm', { alignSelf: 'start' });
    Row({ gap: 8, justifyContent: 'end', width: 'fill' }, () => {
      Button('取消', { variant: 'ghost' });
      Button('确定', { variant: 'primary', onClick: save });
    });
  });
});
this.mvvm.mount(page);
```

> 可运行示例：[`apps/examples/src/scenes/compose.ts`](../../apps/examples/src/scenes/compose.ts)（`pnpm dev` 后打开 `#/compose`）。该场景的每一个控件、每一种容器都用 DSL 搭建，并在 `#status` / `#demo-state` 输出可断言的几何与状态。

---

## 1. 它解决了什么

对比同一张卡片（`#/showcase` 里的写法 vs `#/compose`）：

```ts
// 工厂 API：树是数组字面量，每个控件都要带上 this.add
const card = this.add.uiPanel({ direction: 'vertical', gap: 6, padding: 12 }, [
  this.add.uiLabel({ text: '标题', tone: 'muted' }),
  this.add.uiDivider({}),
  this.add.uiButton({ text: '确定', variant: 'primary' }),
]);

// DSL：树是缩进，scene 由 ui() 提供
const card = ui(this, () => {
  Panel({ direction: 'vertical', gap: 6, padding: 12 }, () => {
    Text('标题', { tone: 'muted' });
    Divider({});
    Button('确定', { variant: 'primary' });
  });
});
```

三点差别：

1. **嵌套即结构**：容器的最后一个参数是内容 lambda，里面创建的控件自动成为它的子节点。同级顺序 = 源码顺序，不需要再对齐数组的括号。
2. **不需要 scene**：`ui(scene, …)` 打开作用域，之后所有 composable 从作用域里取 scene。
3. **选项对象不变**：`Column`/`Text`/`Button` 收的就是 `BoxWidgetOptions`/`LabelOptions`/`ButtonOptions`，即 [02](./02-layout.md)、[03](./03-widgets.md) 里的选项表**照用**——DSL 只换结构，不造第二套词汇。

**它不是替代品，而是同一套控件的另一种写法**：`#/compose` 的 `parity` 演示会把同一个卡片分别用工厂 API 和 DSL 各搭一次，逐节点比较 `appliedRect`，几何必须完全一致（`#demo-state` 里 `parity=ok`）。

---

## 2. 导入与入口

```ts
import {
  ui,
  Column,
  Row,
  Grid,
  Stack,
  Absolute,
  Panel,
  Scroll,
  List,
  Text,
  Button,
  Image,
  Spacer,
  Divider,
  TextField,
  TextArea,
} from '@phaser-mvvm/widgets/compose';
```

DSL 是**独立入口**（`@phaser-mvvm/widgets/compose`），不在包根导出：根入口已经导出了 `Panel`/`Button`/`Image`/`Spacer`/`Divider`/`TextField` 这些**控件类**，同名函数放一起会互相覆盖。需要类本身（做类型标注、写自定义控件）时从根入口导入，写视图时从 `/compose` 导入。

`ui(scene, content)` 返回**根控件**，它只负责「搭出来」，不负责挂载：

| 你要做的                 | 写法                                                         |
| ------------------------ | ------------------------------------------------------------ |
| **整页：建树 + 挂载**    | `render(this.mvvm, () => { … })`                             |
| 搭出页面并挂到 UI 根     | `const page = ui(this, () => { … }); this.mvvm.mount(page);` |
| 搭一段子树（切页、弹窗） | `const card = ui(this, () => { … }); host.addWidget(card);`  |
| 不挂载，交给别的树       | 同上，`addWidget` 会重新认父                                 |

整页最常用的形态是 **`render(this.mvvm, () => { … })`** —— 建树与挂载合成一次调用（`setContent { }` 的对应物）；用了 DSL 就**不需要** `installFactories()` / `installWidgetFactories()`（那两个只注册 `this.add.*` 工厂方法，DSL 直接构造控件类）。

内容里一个控件都没建 → 直接抛错（空页面几乎总是 bug）；建了多个根 → 自动包一层纵向 `Column` 并给出 dev 警告（对应 Compose `setContent` 的宽容度，但方向必须显式时才最好）。

---

## 3. 容器

| Composables      | 对应控件                | 备注                                                                        |
| ---------------- | ----------------------- | --------------------------------------------------------------------------- |
| `Column` / `Row` | 透明盒子（`BoxWidget`） | 与 Compose 一致：它们自己不画背景                                           |
| `Panel`          | `Panel`                 | 会画背景的容器（Compose 里对应 `Surface`/`Card`），卡片／对话框／页面根用它 |
| `Grid`           | `GridWidget`            | `columns` / `columns: 'auto'` / `gap` / `span`                              |
| `Stack`          | `StackWidget`           | 子节点重叠，`align: 'start' \| 'center' \| 'end'`                           |
| `Absolute`       | `AbsoluteWidget`        | 子节点用 `position: 'absolute'` + `left/top/…`                              |
| `Scroll`         | `ScrollView`            | 内容 lambda 必须建**恰好一个**根控件                                        |
| `List`           | `Repeat`                | keyed、可虚拟化，见 §6                                                      |

两种调用形式都支持，内容和选项的顺序随你：

```ts
Column({ gap: 8 }, () => { … });   // 有选项
Column(() => { … });               // 只有内容（gap 用默认值）
```

没有内容 lambda 时容器就是空的（可以先把容器建出来，之后再 `addWidget`）。

---

## 4. 叶子控件与反应式参数

```ts
Text('常量文本');
Text(() => `计数：${counter.value}`); // getter：计数变，文本跟着变
Text(title); // ref：等价于上一行
Button(() => (on.value ? '开' : '关'), { toggle: true });
Image({ texture: 'tile', fit: 'cover', width: 72, height: 64 });
Rect({ color: 0x3fb950, width: 24, height: 24 }); // 纯色块（适配层的 RectWidget）
Spacer({ flex: true }); // 等价 Compose 的 Modifier.weight(1f)
Divider({ orientation: 'vertical', height: 'fill' });
```

**数据槽位**（`Text` 的字符串、按钮文本、输入框的 `value`、滑杆与开关型按钮的 `value`）接受三种形态：

| 形态                   | 含义                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `'保存'`               | 常量，不建立任何绑定                                                         |
| `ref('保存')`          | 跟踪；**有值可写回**的控件（`TextField`/`TextArea`/`Slider`/开关按钮）是双向 |
| `() => vm.title.value` | 跟踪；单向（值变化的那一帧重新求值），有值控件把它当"只读回显"               |

注意：只有**数据槽位**接受函数——`onClick` 这类本来就是函数，不会被当成 getter。

**状态槽位**也跟着状态走（第 84 轮补齐）：`disabled`、`error`、`variant` 与 `value` 一样接受常量 / `ref` / getter。"能不能编辑"、"是不是错的"、"这块面该是什么颜色"本来就是状态，不必为了让它们变化而绕到命令式 API：

```ts
const saving = ref(false);
const problem = ref<string | boolean | null>(null);

TextField({ value: name, disabled: () => saving.value, error: () => problem.value });
Slider({ value: volume, disabled: () => saving.value });
Panel({ variant: () => (problem.value ? 'danger' : 'surface') }, () => Text('表单区域'));
```

| 槽位       | 控件                                     | 说明                                                          |
| ---------- | ---------------------------------------- | ------------------------------------------------------------- |
| `disabled` | `TextField`/`TextArea`/`Slider`/`Button` | 翻转即失效/恢复：不可聚焦、不可点、DOM 桥同步禁用             |
| `error`    | `TextField`/`TextArea`                   | 传错误**文案**（显示在字段下方）或 `null`/`false` 清除        |
| `variant`  | `Button`/`Panel`                         | 变体名就是主题令牌；换令牌会连带重绘面板的默认描边            |
| `loading`  | `Button`                                 | 加载中：拒绝激活但**仍可聚焦**（不要把焦点丢掉）              |
| `tone`     | `Text`                                   | 语义色                                                        |
| `offset`   | `Scroll`                                 | 滚动位置；传 `ref` 是**双向**（滚动写回状态，写状态滚动视图） |

滚动位置也是状态 —— Compose 的 `rememberScrollState()`：

```ts
const offset = ref(0);
Scroll({ offset, height: 260, width: 'fill' }, () => {
  List({ items: () => rows.value, key: (row) => row.id }, (row) => Text(row.label));
});

Button('回到顶部', { onClick: () => (offset.value = 0) }); // 不用碰任何控件 API
Text(() => `当前位置：${Math.round(offset.value)}px`);
```

拖动、滚轮、甩动惯性、捏合缩放、焦点滚进视野、内容替换与尺寸变化**都会写回**这个 `ref`（实现上每个偏移写入都走同一条 `commitOffset()`，`'scroll'` 事件因此是诚实的读数）；写 `ref` 则直接移动视图，并且**会先停掉进行中的惯性**（否则「回到顶部」会被上一次甩动带走，落点不在 0）。传 getter 时是单向：状态驱动视图，视图不写任何地方。

`#/compose` 的 **State slots** 分区把这三个槽位摆在一起（锁定 / 标记错误 / 换变体三个按钮改的都是 `ref`），逐帧发布 `state.locked`/`state.error`/`state.variant` 与每个控件的 `st.state.*`；`window.compose.setState({…})` 与 `slots()` 是它的读写入口。矩阵见 [`ACCEPTANCE-compose-dsl.md`](../ACCEPTANCE-compose-dsl.md) §3.2。

**双向**的意思是两边都能当源头：

```ts
const notify = ref(false);
Button(() => `通知：${notify.value ? '开' : '关'}`, { toggle: true, value: notify });

notify.value = true; // 代码写 ref → 按钮自己翻过去
// 用户点击按钮 → 事件写回 `notify`，派生出来的文案同一帧更新
```

单向 getter 想接住用户操作就用 `onValueChange`（`TextField`/`Slider`/开关按钮都有）。

### 4.1 控制流就是 TypeScript

建树是同步的，所以容器的内容 lambda 里可以直接写 `if` / `for` / `switch`——**跑到的分支就是存在的分支**，形状和 Compose 里的 `if (cond) { Text(…) }` 一模一样：

```ts
Column(() => {
  if (rows.value.length > 0) Text('有数据'); // 静态条件
  for (const item of rows.value) Text(item.label); // 静态循环
  switch (mode.value) {
    case 'a':
      Text('A');
      break;
  } // 静态分支
});
```

区别只在**反应式**条件：上面的 `if` 只在建树那一刻判断一次。数据变化时要收起/显示，用 `visible` 槽位——节点不重建，直接退出布局流：

```ts
Text('仅在开启时出现', { visible: () => on.value });
```

`#/compose` 的 `Flow` 分区把两种写法都做成了可点按的演示（实测：关闭时同一行里后面的分隔线 x 由 224 移到 88）。

**第三种：结构性切换（`Branch`）**。`visible` 保留节点、只藏起来；如果两个分支要**换成完全不同的树**（不同容器、不同控件种类），把它们都建出来再藏一个就浪费了。这时用 `Branch`——按 key 建**一个**分支，切 key 时把旧分支**销毁**、建新分支：

```ts
Branch(
  () => tab.value, // ref 或 getter；传常量就是建一次、永不切换
  {
    profile: () => {
      Panel({ padding: 12 }, () => {
        Text('资料页');
        TextField({ value: name });
      });
    },
    settings: () => {
      Row({ gap: 8 }, () => {
        Slider({ value: volume });
        Button('重置', { onClick: reset });
      });
    },
  },
);
```

三件事按页面的规则办（因为它就是"一个页面的入口"，只是小一号）：

- **入口规则相同**：0 个根报错、多个根警告后包一层容器（`#/compose` 的 `分支 三个根` 按钮就是这个用例）；
- **key 没有对应分支不会崩**：清空当前分支并打一条开发期警告（内部用的是 `hasOwnProperty` 查询，所以 `constructor`/`toString`/`__proto__` 这类 key 不会被误当成分支调用）；
- **状态放场景/ViewModel**：切分支会销毁分支里的一切（控件、绑定、订阅、文字纹理），焦点、指针目标与无障碍镜像会重新收集——**被销毁的焦点控件会被释放**（实测：焦点在分支 A 的按钮上时切到 B，`focus=none`，且镜像节点与指针目标里都不再有它）。

想读回状态（或写测试）就用 widget 自己的字段：`activeKey`、`builds`、`lastBuild`、`lastReplaced`。

> `#/compose` 的 `Flow` 分区有完整演示：四个按钮在 A / B / 三个根 / 未知 key 之间切换，`#demo-state` 逐帧发布 `branch.key`/`branch.builds`/`branch.widgets`/`branch.roots`/`branch.destroyed`。

### 4.2 外观也能是反应式的

除了数据，几个最常用的**外观槽位**同样接受 `Ref`/getter，改动会按帧重绘，而不是重建节点：

```ts
Text('状态', { tone: () => (ok.value ? 'success' : 'muted') });
Button(() => (on.value ? '关闭' : '开启'), {
  variant: () => (on.value ? 'primary' : 'ghost'),
  disabled: () => busy.value,
  loading: () => busy.value,
});
```

`visible` 是 DSL 的统一条件槽位（所有 composable 都支持）：

```ts
Text('仅在开启时出现', { visible: () => on.value });   // 相当于 Compose 的 if (on) { … }
Panel({ visible: () => hasError.value }, () => { … });
```

隐藏的节点默认会**退出布局流**（`hideMode: 'collapse'`），所以它后面的兄弟会跟着上移——这正是 Compose 里 `if` 的布局效果，只是不需要重建子树；想保留占位就写 `hideMode: 'keep'`（见 [02 §3](./02-layout.md)）。

---

## 5. 表单：双向绑定与状态提升

```ts
const name = ref('');
const notes = ref('');

TextField({ value: name, label: '姓名', clearable: true }); // ref → 双向
Text(() => `读出：${name.value}`);

TextArea({ value: notes, label: '备注', rows: 3 }); // 同样是双向

// 状态不在 ref 里（比如在一个 store 中）：用 onValueChange 提升状态
TextField({
  value: () => store.keyword, // 单向读
  onValueChange: (value) => store.setKeyword(value.toUpperCase()),
});
```

`value` 是 `Ref` 时走 `bindModel`：控件写入 ref、ref 变化写回控件，且 **IME 组合期间暂停写回**（[04 章](./04-text-inputs.md)）。`value` 是 getter 时只读，用户编辑会调用 `onValueChange`——把状态留在自己的 store 里而不必引入 ref。

`validate`、`inputType`、`placeholder`、`maxLength`、`clearable`、`onFocus`/`onBlur`/`onSubmit` 等选项原样透传。

---

## 6. 列表

```ts
List(
  {
    items: () => rows.value,
    key: (row) => row.id,
    width: 'fill',
    height: 260,
    container: { gap: 4 }, // 行容器的排列方式（这里是纵向盒子 + 4px 间距）
    virtualize: true,
    itemExtent: 34, // 虚拟化必需：一行的高度（含间距）
    overscan: 4,
  },
  (row, index) => {
    Row({ gap: 8, height: 30, alignItems: 'center', width: 'fill' }, () => {
      Text(`${index + 1}`, { width: 44, tone: 'muted' });
      Text(() => row.label); // 行模板里可以直接闭包捕获这一行
      Spacer({ flex: true });
    });
  },
);
```

行模板每个 key 跑一次，**必须建出恰好一个根控件**（多个 → 报错并列出名字，提示你用 `Column`/`Row` 包起来）。空列表用 `empty: () => { … }`。

把 `List` 放进 `Scroll` 里即可获得虚拟化联动——`ScrollView` 会找到它包裹的列表：

```ts
Scroll({ direction: 'vertical', height: 260, width: 'fill' }, () => {
  List({ items: () => rows.value, key: (r) => r.id, virtualize: true, itemExtent: 34 }, (row) => {
    Text(() => row.label);
  });
});
```

---

## 7. 作用域机制（写给自定义控件）

DSL 的「隐式父子关系」来自 `@phaser-mvvm/phaser` 的 `uiscope.ts`，它是一段**纯逻辑**（不 import Phaser 运行时），可以在 Node 里单测：

| API                                    | 作用                                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| `runInUiScope(scene, content)`         | 开一个隔离作用域跑内容，返回 `{ result, roots, widgets, depth }` |
| `withUiParent(widget, content?)`       | 把 `widget` 挂到当前作用域，并以它为父执行内容                   |
| `emitWidget(widget)`                   | 把 `widget` 挂到当前作用域（容器则成为子节点，根则收集）         |
| `buildUiSubtree(scene, content, what)` | 在隔离作用域里建出**恰好一个**根控件（供行模板／延迟内容用）     |
| `currentUiScene()` / `inUiScope()`     | 取当前 scene／判断是否在作用域内                                 |

自己的控件若想加入 DSL 树，只需实现一个「建实例 → `scene.add.existing` → `emitWidget`」的薄封装，或直接用 `withUiParent` 包住内容 lambda。真实例子见 [`#/showcase`](../../apps/examples/src/scenes/showcase.ts) 的 `Block()`：色块用 DSL 的 `Rect()`（纯色块），外层 `Row` 与里面的 `Text` 也都是 composable——三层各一个节点，全部由 DSL 组合出来。（需要完全自定义绘制时仍可退回 `emitWidget()`。）

调试期每次 `ui()` 都会打印一行构建摘要（`[phaser-mvvm] ui(): built 42 widget(s), 5 level(s) deep`）；发布模式调用 `setDevMode(false)` 后完全静默（[08 §7](./08-lifecycle-and-pitfalls.md)）。

---

## 8. 常见问题

| 症状                                | 原因与写法                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `xxx needs an open UI scope`        | composable 写在 `ui(scene, () => { … })` 之外了                                                                         |
| `ui(): the content built no widget` | 内容 lambda 里全是早退分支／忘了建控件                                                                                  |
| 行模板报「built 2 root widgets」    | `List` 的一行只能是**一个**控件，把多个包进 `Row`/`Column`                                                              |
| `Scroll` 内容不滚                   | 内容没建出来，或内容高度不超过视口（不是 bug）                                                                          |
| 设了 `width` 却被拉伸               | 父容器 `alignItems: 'stretch'` 优先于子节点的交叉轴长度；用 `alignSelf: 'start'` 退出拉伸（[02 §附录](./02-layout.md)） |
| 想给控件单独命名以便检查            | 传 `name: 'xxx'`，与工厂 API 一致                                                                                       |
| 条件显示某个控件                    | `{ visible: () => cond.value }`（退出布局流；配 `hideMode: 'keep'` 则保留占位）                                         |
| 想让 tone/variant/disabled 随状态变 | 这些槽位接受 `Ref`/getter（见 §4.1），无需重建节点                                                                      |

---

## 9. 下一步

- 需要**完全控制**（自定义控件、动态增删、直接操作显示列表）时，任何一层都可以退回工厂 API：DSL 建的是普通控件，`addWidget`/`removeWidget`/`setVisible` 一样能用。
- 本章没有覆盖的能力（模态、路由、无障碍镜像）在 PLAN 的 M8/M9，尚未实现——参考 [08 §5 差异清单](./08-lifecycle-and-pitfalls.md)。
