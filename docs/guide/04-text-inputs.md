# 04 · 文本框与表单：`TextField` / `TextArea`

本章目标：做出一个**真正能用**的表单 —— 中文输入法能出候选、能校验、能提交。

> 对应示例：[`apps/examples/src/scenes/form.ts`](../../apps/examples/src/scenes/form.ts)（`#/form`）。
> 设计背景：Canvas 文本输入拿不到输入法候选框和移动端软键盘，所以框架用一层**隐藏 DOM 元素镜像**（[ADR-0004](../adr/0004-dom-input-bridge.md)）。光标与选区仍然画在 Canvas 里，保证视觉一致与 z-order 可控。

> **本章代码用 Compose 风格 DSL 书写**（[09 章](./09-compose-dsl.md)，可运行示例 `#/compose`）：`TextField({ … })`、`TextArea({ … })`。DSL 直接构造同一个控件类，选项表与工厂写法（`this.add.uiTextField(...)`）完全通用。最关键的一点：`value` 是**数据槽**，绑一个 `ref` 就是双向的——本章第 7 节那个登录表单因此从四十多行变成十几行。

---

## 1. 先做一个最小的输入框

```ts
const name = ref('');
TextField({ value: name, placeholder: '请输入姓名', width: 320 });

// 想只在"用户改了"时做点什么（而不是每次值变化）：
const runSearch = (value: string) => console.log('search', value);
TextField({ placeholder: '搜索', onValueChange: runSearch });

// 需要拿控件本体时（聚焦、手动校验、读 bridged…）：
const email = TextField({ label: 'Email', placeholder: 'you@example.com', width: 320 });
email.focus();
```

就能点了：点击聚焦、出现闪烁光标、可以输入、可以选区 —— 这部分是控件自己在 Canvas 里实现的，不依赖 DOM。**中文输入法候选框与移动端软键盘**才需要游戏开 DOM 容器（下一节）。

---

## 2. 打开 DOM 输入桥

```ts
new Phaser.Game({
  // …
  dom: { createContainer: true }, // ← 这一句
});
```

| 情况                        | 结果                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dom.createContainer: true` | `field.bridged === true`，中文 IME、候选框、移动端软键盘、浏览器剪贴板全部可用                                                                    |
| 没开                        | `bridged === false`，控制台打印一次 `[phaser-mvvm] TextField 需要 dom.createContainer: true`，退化为纯 Canvas 键盘输入（英文/数字够用，中文不行） |
| `dom: false`（控件选项）    | 显式要求纯 Canvas 路径，即使游戏开了 DOM 容器                                                                                                     |

自检用属性：

```ts
console.log(field.bridged); // 是否真正走 DOM 桥
console.log(field.bridgeElement); // 隐藏的 <input>/<textarea>，纯 Canvas 模式下为 null
console.log(field.composing); // 输入法组合期是否为 true
```

**局限**（写进 ADR-0004，使用前请知悉）：

- DOM 桥按控件矩形 + 画布偏移定位，画布被 CSS 缩放/极端 DPR 时需要校准（框架每次布局与窗口 resize 都会重新定位）。
- 不要在同一个页面里再混用 Phaser 的 `DOMElement` 类控件，层叠关系会打架。
- 一个控件对应一个隐藏元素，极端大量的输入框（几百个）不适合同时存在。

**纯 Canvas 路径（`dom: false`）额外说明**——它由自己负责光标、选区和权限，几条自测过的边界：

| 能力                                           | 纯 Canvas 路径                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 英文/数字输入、`Backspace`/`Delete`            | 支持（`maxLength` 也由控件自己截断）                                                                                                                                  |
| 光标/选区绘制、`Home`/`End`/跨行上下、`Ctrl+A` | 支持（多行软换行后点击定位也对）                                                                                                                                      |
| `Ctrl+C`/`Ctrl+X`/`Ctrl+V`                     | 支持（走 `navigator.clipboard`；剪贴板被拒绝时剪切仍会删除）                                                                                                          |
| `readOnly` / `disabled`                        | 支持：`readOnly` 字段可以聚焦、可以选中、可以复制，但**任何编辑都不生效**（V59 之后由唯一漏斗 `canEditValue()` 判定）                                                 |
| 鼠标/触摸点击定位光标                          | 支持（点哪光标落在哪，触摸与鼠标同一路径）                                                                                                                            |
| 拖动选择                                       | 支持：按住拖动即选中（鼠标与触摸同一条路径），并且**外层滚动容器会让出这个手势**——文本域先"认领"这次按下，滚动口在真的要动之前再问一句（见 `docs/PITFALLS.md` §8.53） |
| 双击选词                                       | **不支持**（V58 的剩余部分：只有键盘与拖动能选）                                                                                                                      |
| 中文 IME、移动端软键盘、原生右键菜单           | 不支持——需要它们就用 DOM 桥                                                                                                                                           |

---

## 3. `TextField` 选项

```ts
TextField({
  label: 'Email',
  placeholder: 'ada@example.com',
  inputType: 'email',
  maxLength: 64,
  clearable: true,
  validate: (value) => (value.includes('@') ? null : '邮箱格式不正确'),
  width: 360,
});
```

| 选项            | 类型                                                      | 默认     | 说明                                                                                    |
| --------------- | --------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `label`         | `string`                                                  | `''`     | 字段标签。**不会**渲染成可见文字，只作为隐藏元素的 accessible name（无障碍读屏用）      |
| `value`         | `string`                                                  | `''`     | 初始值（会先过一遍输入类型过滤与 `maxLength`）                                          |
| `placeholder`   | `string`                                                  | `''`     | 值为空时以弱化色显示                                                                    |
| `maxLength`     | `number`                                                  | 不限     | 最大**码点**数（emoji 不会被截成半个）                                                  |
| `inputType`     | `'text' \| 'number' \| 'password' \| 'email' \| 'search'` | `'text'` | `password` 显示 `•`；`number` 过滤掉非数字字符；`email`/`search` 只影响移动端键盘       |
| `align`         | `'left' \| 'center' \| 'right'`                           | `'left'` | 文本水平对齐                                                                            |
| `readOnly`      | `boolean`                                                 | `false`  | 保留文本但拒绝一切编辑（仍可聚焦选中）                                                  |
| `disabled`      | `boolean`（**DSL 里可以是 `ref`/getter**）                | `false`  | 不可聚焦、不可编辑，显示 `disabled` 状态；`disabled: () => saving.value` 会跟着状态翻转 |
| `error`         | `string \| boolean \| null`（**DSL 槽位**）               | `null`   | 直接给错误文案（显示在字段下方）；`null`/`false` 清除                                   |
| `clearable`     | `boolean`                                                 | `false`  | 右侧出现可点击的 `×`，点它清空                                                          |
| `dom`           | `boolean`                                                 | `true`   | 是否允许使用 DOM 输入桥                                                                 |
| `validate`      | `(value: string) => string \| null`                       | —        | 校验器：返回错误文案即进入 `error` 状态，返回 `null` 表示通过                           |
| `onChange`      | `(value, field) => void`                                  | —        | **用户**编辑后回调（`setValue` 不触发）                                                 |
| `onValueChange` | `(value, field) => void`（**DSL 槽位**）                  | —        | 值变化的回调：`value` 传 `ref` 时它是写回通道，传 getter 时它是唯一的写回出口           |
| `onSubmit`      | `(value, field) => void`                                  | —        | 提交时回调（Enter，`TextArea` 见 §5）                                                   |
| `onFocus`       | `(field) => void`                                         | —        | 获得焦点时回调                                                                          |
| `onBlur`        | `(field) => void`                                         | —        | 失焦时回调（**在校验之后**执行）                                                        |

默认尺寸与内边距：高度 `theme.controlHeight.md`（36），内边距 `[8, 12, 8, 12]`；写了 `height`/`padding` 就用你的。宽度 `auto` 时按内容量宽（内容宽度下限 96，再加内边距才是控件宽度），所以**表单里通常显式写 `width`**（或 `'fill'`）。

---

## 4. 方法、事件与快捷键

### 方法

| 方法                                                                                     | 说明                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `getValue()`                                                                             | 当前值                                                                                                |
| `setValue(value)`                                                                        | 程序化写入：值/显示/DOM 镜像/**模型绑定**全部跟上，但**不调 `onChange` 选项**（"用户编辑"才算数）     |
| `insertText(text)` / `deleteText(dir)` / `setCaretIndex(i)`                              | 按"一次编辑"写入（与真实按键同一条 `applyEdit` 路径，`maxLength`/数字过滤照常生效）——屏幕键盘用这三个 |
| `clear()`                                                                                | 清空（保留焦点、选项与校验状态）                                                                      |
| `getSelection()` / `setSelection(a, b)`                                                  | 选区 `[start, end)`（码元偏移，与 `HTMLInputElement.selectionStart` 同口径）                          |
| `caretIndex` / `selectionAnchor`                                                         | 光标位置 / 选区锚点                                                                                   |
| `isFocused()`                                                                            | 是否持有框架焦点                                                                                      |
| `getError()` / `setError(v)`                                                             | 读/写错误状态；`setError('文案')` 显示消息，`setError(null)` 清除                                     |
| `validateNow()`                                                                          | 立刻跑一次 `validate`                                                                                 |
| `focus()` / `blur()`                                                                     | 聚焦/失焦（会联动 DOM 桥与校验）                                                                      |
| `composing` / `bridged` / `bridgeElement`                                                | 输入法组合中 / 是否走 DOM 桥 / 隐藏元素                                                               |
| `inputType` / `align` / `maxLength` / `readOnly` / `clearable` / `placeholder` / `label` | 只读配置项                                                                                            |

### 事件

| 事件     | 触发                                                      | 载荷            |
| -------- | --------------------------------------------------------- | --------------- |
| `change` | 值真的变了（用户编辑**或** `setValue`/`insertText` 写入） | `value: string` |
| `submit` | 提交                                                      | `value: string` |

> `change` 是**模型通道**：DSL 的 `value: ref` 与 `bindModel()` 都靠它把值写回数据源，所以 `setValue('')` 之后 `ref` 也会变成 `''`（否则字段与状态会各说各话）。页面的 `onChange` **选项**与 `onValueChange` 的语义分工是：前者只在用户编辑时调（"谁动了这个字段"），后者跟着值走（"值是多少"）。

```ts
import { TEXT_INPUT_EVENTS } from '@phaser-mvvm/widgets';

field.on(TEXT_INPUT_EVENTS.CHANGE, (value: string) => {
  /* … */
});
field.on(TEXT_INPUT_EVENTS.SUBMIT, (value: string) => {
  /* … */
});
```

> ⚠️ **聚焦/失焦没有事件**。请用构造选项 `onFocus` / `onBlur` 回调（`field.on('blur', …)` 不会触发）。

> ⚠️ **`submit` 要自己订阅**：`Enter`（单行）与 `Ctrl/Cmd+Enter`（`TextArea`）会 emit `TEXT_INPUT_EVENTS.SUBMIT`，框架只负责**发出**这个事件——不订阅它就只是"按了没反应"。`#/form` 的 placeholder 一度承诺了 `Ctrl/Cmd+Enter` 提交却没有订阅，正是这个坑（[`ACCEPTANCE-form.md`](../ACCEPTANCE-form.md) §3）。

### 快捷键矩阵

| 按键                       | 行为                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `←` / `→`                  | 移动光标；按住 `Shift` 扩展选区                                                                                               |
| `↑` / `↓`                  | 仅 `TextArea`（多行）：上下移动并保持列位置；单行输入框**不消费**这两个键，交给焦点导航                                       |
| `Home` / `End`             | 行首/行尾；加 `Ctrl`/`Cmd` 为文档首/尾                                                                                        |
| `Backspace` / `Delete`     | 删除（有选区时删选区）                                                                                                        |
| `Enter`                    | 单行：提交；多行：插入换行（`submitOnEnter: true` 时改为提交）                                                                |
| `Ctrl`/`Cmd` + `Enter`     | 一律提交（`TextArea` 的常用提交手势）                                                                                         |
| `Escape`                   | 回滚到聚焦时的值，然后失焦；**在模态对话框里失焦被拒绝**，于是这次 `Escape` 转交给 `FocusManager` 的 `back`（对话框因此关闭） |
| `Tab` / `Shift+Tab`        | 不被输入框消费：遍历交给焦点链（DOM 桥路径下由输入框直接转交，见下）                                                          |
| `Ctrl`/`Cmd` + `A`         | 全选                                                                                                                          |
| `Ctrl`/`Cmd` + `C`/`X`/`V` | 复制/剪切/粘贴（有 DOM 桥时由浏览器处理）                                                                                     |

两条实现细节，解释了为什么输入框不会「吃掉」页面的键盘导航：

- 纯 Canvas 路径下，输入框只在**自己持有焦点**时挂一个捕获阶段的 `window` keydown 监听，消费掉的键会 `stopPropagation`，避免场景插件把方向键当成焦点移动。
- DOM 桥路径下浏览器自己完成编辑，框架只负责「声明这个键归我」（同样是为了不让空格被导航当成激活）。这里有个容易踩的细节：**Phaser 的键盘管理器会丢弃 `defaultPrevented` 的按键**，所以输入框若只是 `preventDefault()` 再指望场景插件处理 `Tab`，那个键就谁也收不到（第 60 轮修复的 V17）。现在 `Tab`/`Shift+Tab` 与「无处可失焦时的 `Escape`」由输入框**直接交给 `FocusManager.handleAction()`**，因此输入框里的 `Tab` 会正常走到下一个控件，模态框里的 `Escape` 也仍然能关闭对话框。

---

## 5. `TextArea`：多行输入

`TextArea` 继承 `TextField`，只改「行策略」，额外三个选项：

| 选项            | 类型      | 默认    | 说明                                                                                                    |
| --------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `rows`          | `number`  | `3`     | 可见行数，用来推导默认高度**和最大高度**                                                                |
| `wrap`          | `boolean` | `true`  | 在内容宽度处自动换行（由控件自己的换行器完成，保证光标位置精确）                                        |
| `submitOnEnter` | `boolean` | `false` | 交换 Enter 绑定：`true` 时 Enter 提交、`Shift+Enter` 换行；`false` 时 Enter 换行、`Ctrl/Cmd+Enter` 提交 |

```ts
TextArea({
  placeholder: '备注…（Enter 换行，Ctrl/Cmd+Enter 提交）',
  rows: 4,
  maxLength: 200,
  width: 360,
});
```

行为差异：

- 桥元素是 `<textarea>`，移动端软键盘会给出回车键。
- 高度 = `rows × 行高 + 内边距`；**同时**把 `maxHeight` 设成同一个值，所以按 `rows` 定尺的输入框不会悄悄长高。想让它继续长高，请显式写 `maxHeight`。
- 内容超出时内部纵向滚动，光标所在行始终可见；选区跨行会逐行高亮。
- `↑`/`↓` 在行间移动光标并**保持起始列**（列提示），跟编辑器习惯一致。

---

## 6. 校验与错误态

```ts
TextField({
  label: 'Email',
  width: 360,
  validate: (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : '请输入有效邮箱'),
  onBlur: (field) => console.log('error =', field.getError()),
});
```

规则：

1. `validate` **在失焦时自动跑**，也可以随时用 `validateNow()` 手动跑。
2. 返回值是字符串 → `error` 状态 + 该消息（`getError()` 可读）；返回 `null` → 清除错误。
3. `error` 状态在状态机里优先级很高（仅次于 `disabled`）：边框会变成 `danger` 色，**并且不再画焦点环**（避免「又是错误又是焦点」的混乱）。
4. 想手动控制：`setError('文案')` / `setError(null)`。

> 校验消息目前**不会自动渲染成文字**，需要你自己放一个 `Label` 显示（见下面的实战）。输入框只负责状态与消息存储。

---

## 7. 实战：一个带校验的登录表单

```ts
import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { Button, Divider, Panel, Text, TextField, render } from '@phaser-mvvm/widgets/compose';

export class LoginScene extends Phaser.Scene {
  // 表单状态就是这个页面的全部状态：两个输入、一个忙碌标记，其余都是派生值
  private email = ref('');
  private password = ref('');
  private busy = ref(false);

  private emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.value));
  private canSubmit = computed(
    () => this.emailValid.value && this.password.value.length >= 6 && !this.busy.value,
  );
  private hint = computed(() => {
    if (this.busy.value) return '提交中…';
    if (!this.emailValid.value) return '邮箱格式不正确';
    if (this.password.value.length < 6) return '密码至少 6 位';
    return '可以提交';
  });

  constructor() {
    super('login');
  }

  create(): void {
    let emailField: ReturnType<typeof TextField> | null = null;

    render(this.mvvm, () => {
      Panel(
        { gap: 12, padding: 22, variant: 'surface', radius: 12, width: 420, alignItems: 'stretch' },
        () => {
          Text('登录', { size: 'lg' });

          // `value: this.email` 就是双向绑定：用户输入写回 ref，代码写 ref 更新输入框
          emailField = TextField({
            value: this.email,
            label: 'Email',
            placeholder: 'you@example.com',
            inputType: 'email',
            clearable: true,
            width: 'fill',
            validate: (value) => (value === '' || this.emailValid.value ? null : '邮箱格式不正确'),
          });

          TextField({
            value: this.password,
            label: 'Password',
            placeholder: '至少 6 位',
            inputType: 'password',
            width: 'fill',
          });

          // 派生数据就是一行 Text：hint 变了它自己重绘
          Text(() => this.hint.value, { tone: 'muted' });

          Divider({});

          // 禁用态也可以派生：canSubmit 一变，按钮自己变灰、也不再响应
          Button('登录', {
            variant: 'primary',
            width: 'fill',
            disabled: () => !this.canSubmit.value,
            loading: () => this.busy.value,
            onClick: () => {
              this.busy.value = true;
              void this.login();
            },
          });
        },
      );
    });

    emailField?.focus(); // 打开页面就聚焦第一个字段
  }

  private async login(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    this.busy.value = false;
  }
}
```

这个例子里几个值得注意的点：

- **没有一处手写的双向同步**：`TextField({ value: this.email })` 一个参数同时管两个方向（DSL 内部用 `bindModel`），`Text(() => this.hint.value)` 管派生显示，`Button({ disabled: () => !canSubmit.value })` 管禁用态。要自己接线时（例如把控件接到 store 而不是 `ref`）才用命令式 API：`bindModel` / `bindValue` / `bindText` / `bindEnabled`，见 [06 章 §4](./06-data-and-theme.md)。
- **禁用是视觉 + 交互一起生效的**：`disabled` 数据槽最终落到 `setEnabled(false)`，按钮既变灰也拒绝按下与焦点。
- `computed` 每个依赖变化都会重算，但**每帧只刷一次**（`flush: 'frame'`），所以输入时不会每敲一个字符就重排一次页面。

---

## 8. 手柄与触摸：`VirtualKeyboard`

主机/电视/纯手柄场景里**根本没有键盘**：方向键能移动焦点、`A` 能按下按钮，但打不出一个字。`VirtualKeyboard` 就是给这种情况的屏幕键盘——它不是新控件类型，而是**一把普通 `Button`**：所以 D-Pad/左摇杆/`Tab` 走查、`A` 激活、指针悬停与点击、焦点环、按下态、无障碍镜像（每键一个可访问名）全部自动成立，键盘本体只管"这个键是什么、按下它改什么"。

```ts
import { TextField, VirtualKeyboard, Column, Text } from '@phaser-mvvm/widgets/compose';
import { ref } from '@phaser-mvvm/core';

const name = ref('');

Column({ gap: 12, padding: 16 }, () => {
  const field = TextField({ label: '玩家名', value: name, maxLength: 12, width: 'fill' });
  Text(() => `已输入 ${name.value.length} 个字符`);
  VirtualKeyboard({
    target: () => field,
    onSubmit: () => this.submit(name.value),
  });
});
```

写值走的是**和真实按键同一条路**（`insertText`/`deleteText`）：`maxLength`、`inputType: 'number'` 的过滤、清洗、`change`、校验全部照旧，所以"手柄输入的字段"和"键盘输入的字段"在页面看来没有区别。

| 选项       | 说明                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| `target`   | `() => field`（**getter**：键盘通常写在字段之前，页面也可能换字段）；返回 `null` 时按键不做事 |
| `kind`     | `'text'`（默认，字母 + `123` 符号页）/ `'numeric'`（`1..9`、`0`、`.`、`⌫`、`Enter` 的九宫格） |
| `onSubmit` | `Enter` 键（提交键是 `primary` 变体，玩家一眼能找到）                                         |
| `onChange` | 每次按键产生的编辑之后（页面刷新自己的读数用）                                                |
| `name`     | 键的调试名前缀，默认 `keyboard`（`keyboard.q`、`keyboard.enter`…）                            |
| 其余       | 面板选项：`width`/`variant`/`radius`/`padding`/`gap`…（默认 `surfaceAlt`、圆角 12、键距 6）   |

**大小写**：`⇧` 按一次只大写**下一个字符**（打完自动松开，`⇧` 变回普通字形），连按两次**锁定**（`⇪`），按第三次全部放开——和手机键盘一致。**符号页**：`123` 换到数字/符号页（该页没有 `⇧`，没有可大写的东西），页码键变成 `ABC`。

**换键集是状态，不是重建**：`kind` 是一个数据槽，写 `ref` 就等于换键盘——键盘自己会重建键，**没有第二条构建路径**，也就没有"重建时忘了传 `onSubmit`"这种事（第 81 轮的 V48 正是它）：

```ts
import { ref } from '@phaser-mvvm/core';
import { TextField, VirtualKeyboard, Row, Button } from '@phaser-mvvm/widgets/compose';

const pin = ref(false); // 或者其它任何"要不要数字键盘"的状态
const field = TextField({ label: 'PIN', value: pinValue, inputType: 'number', width: 240 });

VirtualKeyboard({
  target: () => field,
  kind: () => (pin.value ? 'numeric' : 'text'), // 字面量 / ref / getter 都行
  onSubmit: () => this.submit(),
});

Button('切数字键盘', { onClick: () => (pin.value = !pin.value) }); // 就这一行
```

换键集时**焦点会跟着走**：同一个键 id 还在（`enter`、`backspace`、`space` 两种键盘都有）就落在同一个键上，不在了就落在新键集的第一个键上——手柄玩家不会因为换了个键盘就"焦点消失、要重新找"。页码切换（`123`）同样是换键集：符号页真的**没有** `⇧`，数字键盘真的没有字母，而不是留一排按不动的假键。

> 「在构建趟之外造控件」这条一般规则仍然成立（点击回调、`Repeat` 行模板）：那种情况下用 `buildUiSubtree(scene, () => …, '…')`，裸调 DSL 会因 `currentUiScene()` 抛错。`VirtualKeyboard` 现在不需要它，因为它自己造自己的键。

**它刻意不是输入法**：没有候选词、没有组合态，打不出中文/日文。需要中文的场景走真实键盘（DOM 输入桥，§2）；`VirtualKeyboard` 服务的是"这台设备上没有键盘"。按住 `A` 也不会连打（`activate` 是边沿触发，只有方向键才有连发节流）——自动重复打字几乎总是误输入。

完整的验收页是 `#/keyboard`：假手柄走查、鼠标/触摸按下、大小写与页码、换键集（`kind` ref 与页码）的焦点保持与泄漏门禁、37 个控制节点的可访问性树断言，矩阵见 [`ACCEPTANCE-keyboard.md`](../ACCEPTANCE-keyboard.md)。

---

## 9. 常见坑

| 现象                                | 原因                                                                                                        | 修法                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 打不出中文 / 没有候选框             | 没开 `dom.createContainer`，或用了 `dom: false`                                                             | 开 DOM 容器；用 `field.bridged` 自检                                                                                  |
| 在输入框里敲空格却激活了别的东西    | 空格在导航里等于 `activate`；框架在输入框聚焦时会消费该键，但你自己挂的全局 keydown 可能抢在前面            | 不要把全局快捷键挂在捕获阶段；需要时先判断 `document.activeElement` 或 `field.composing`                              |
| `setValue()` 之后 `onChange` 没触发 | 这是**设计如此**：`onChange` 选项 = "用户编辑了"，程序化写入不该触发它（否则"提交后清空"会再次跑校验/保存） | 想跟着**值**走就用 `onValueChange` 或绑 `ref`（两者都会收到）；想跟着**用户**走就监听 `change` 事件 + `onChange` 选项 |
| 清空/预填之后 `ref` 还是旧值        | 第 81 轮修掉的 V49（`setValue` 当时把 `change` 一起吞了）                                                   | 升级到第 81 轮之后即正常；`ref` 与字段现在永远一致                                                                    |
| `field.on('blur', …)` 从不触发      | 聚焦/失焦只有**回调选项**，没有事件                                                                         | 用 `onBlur` / `onFocus` 选项                                                                                          |
| 输入时整个页面在重排                | 用了 `width: 'auto'`。只有 auto 宽度才会因为内容变化而 `markDirty`                                          | 表单里给输入框写固定的 `width` 或 `'fill'`                                                                            |
| 失焦后校验没跑                      | 焦点没有真正转移（点击画布空白处会失焦，切到别的控件也会）                                                  | 明确调用 `field.blur()` 或 `validateNow()`                                                                            |
| `maxLength` 把 emoji 截断了         | 不会 —— 它是按码点计数的                                                                                    | 若确实发生，检查是不是自己在外层又做了 `slice`                                                                        |
| 输入框被其它控件挡住点不到          | 兄弟 `Panel` 的 `blockPointer` 拦了指针                                                                     | 关闭那个面板的 `blockPointer`，或调整层级顺序                                                                         |

---

## 10. 小结

- **要中文输入就必须开 `dom: { createContainer: true }`**，然后用 `bridged` 自检；纯 Canvas 模式只是降级路径。
- `setValue` 会同步模型（`change` 照发），但**不触发 `onChange` 选项**；"用户编辑"与"值变化"是两个不同的钩子 —— 这是双向绑定既准确又不回环的基础。
- 校验挂在 `validate` 上、失焦自动跑；错误消息要自己用 `Label` 展示。
- `TextArea` = `TextField` + 行策略（`rows`/`wrap`/`submitOnEnter`）。
- 没有键盘的设备（手柄/主机）用 `VirtualKeyboard`：键是 `Button`，于是导航、焦点、指针、无障碍全部复用；换键盘要在 `buildUiSubtree()` 里重建。

下一篇 [05 列表与滚动](./05-lists-and-scroll.md)：`Repeat` 的键控复用与虚拟化、`ScrollView` 的手势与裁剪。
