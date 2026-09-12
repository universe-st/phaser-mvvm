# 04 · 文本框与表单：`TextField` / `TextArea`

本章目标：做出一个**真正能用**的表单 —— 中文输入法能出候选、能校验、能提交。

> 对应示例：[`apps/examples/src/scenes/form.ts`](../../apps/examples/src/scenes/form.ts)（`#/form`）。
> 设计背景：Canvas 文本输入拿不到输入法候选框和移动端软键盘，所以框架用一层**隐藏 DOM 元素镜像**（[ADR-0004](../adr/0004-dom-input-bridge.md)）。光标与选区仍然画在 Canvas 里，保证视觉一致与 z-order 可控。

---

## 1. 先做一个最小的输入框

```ts
const name = this.add.uiTextField({
  placeholder: '请输入姓名',
  width: 320,
});

name.on('change', (value: string) => console.log('用户输入了', value));
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

---

## 3. `TextField` 选项

```ts
this.add.uiTextField({
  label: 'Email',
  placeholder: 'ada@example.com',
  inputType: 'email',
  maxLength: 64,
  clearable: true,
  validate: (value) => (value.includes('@') ? null : '邮箱格式不正确'),
  width: 360,
});
```

| 选项          | 类型                                                      | 默认     | 说明                                                                               |
| ------------- | --------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `label`       | `string`                                                  | `''`     | 字段标签。**不会**渲染成可见文字，只作为隐藏元素的 accessible name（无障碍读屏用） |
| `value`       | `string`                                                  | `''`     | 初始值（会先过一遍输入类型过滤与 `maxLength`）                                     |
| `placeholder` | `string`                                                  | `''`     | 值为空时以弱化色显示                                                               |
| `maxLength`   | `number`                                                  | 不限     | 最大**码点**数（emoji 不会被截成半个）                                             |
| `inputType`   | `'text' \| 'number' \| 'password' \| 'email' \| 'search'` | `'text'` | `password` 显示 `•`；`number` 过滤掉非数字字符；`email`/`search` 只影响移动端键盘  |
| `align`       | `'left' \| 'center' \| 'right'`                           | `'left'` | 文本水平对齐                                                                       |
| `readOnly`    | `boolean`                                                 | `false`  | 保留文本但拒绝一切编辑（仍可聚焦选中）                                             |
| `disabled`    | `boolean`                                                 | `false`  | 不可聚焦、不可编辑，显示 `disabled` 状态                                           |
| `clearable`   | `boolean`                                                 | `false`  | 右侧出现可点击的 `×`，点它清空                                                     |
| `dom`         | `boolean`                                                 | `true`   | 是否允许使用 DOM 输入桥                                                            |
| `validate`    | `(value: string) => string \| null`                       | —        | 校验器：返回错误文案即进入 `error` 状态，返回 `null` 表示通过                      |
| `onChange`    | `(value, field) => void`                                  | —        | **用户**编辑后回调（`setValue` 不触发）                                            |
| `onSubmit`    | `(value, field) => void`                                  | —        | 提交时回调（Enter，`TextArea` 见 §5）                                              |
| `onFocus`     | `(field) => void`                                         | —        | 获得焦点时回调                                                                     |
| `onBlur`      | `(field) => void`                                         | —        | 失焦时回调（**在校验之后**执行）                                                   |

默认尺寸与内边距：高度 `theme.controlHeight.md`（36），内边距 `[8, 12, 8, 12]`；写了 `height`/`padding` 就用你的。宽度 `auto` 时按内容量宽（内容宽度下限 96，再加内边距才是控件宽度），所以**表单里通常显式写 `width`**（或 `'fill'`）。

---

## 4. 方法、事件与快捷键

### 方法

| 方法                                                                                     | 说明                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `getValue()`                                                                             | 当前值                                                                                  |
| `setValue(value)`                                                                        | 程序化写入，**静默**：不 emit `change`、不调 `onChange`（双向绑定靠这条短路，见 06 章） |
| `clear()`                                                                                | 清空（保留焦点、选项与校验状态）                                                        |
| `getSelection()` / `setSelection(a, b)`                                                  | 选区 `[start, end)`（码元偏移，与 `HTMLInputElement.selectionStart` 同口径）            |
| `caretIndex` / `selectionAnchor`                                                         | 光标位置 / 选区锚点                                                                     |
| `isFocused()`                                                                            | 是否持有框架焦点                                                                        |
| `getError()` / `setError(v)`                                                             | 读/写错误状态；`setError('文案')` 显示消息，`setError(null)` 清除                       |
| `validateNow()`                                                                          | 立刻跑一次 `validate`                                                                   |
| `focus()` / `blur()`                                                                     | 聚焦/失焦（会联动 DOM 桥与校验）                                                        |
| `composing` / `bridged` / `bridgeElement`                                                | 输入法组合中 / 是否走 DOM 桥 / 隐藏元素                                                 |
| `inputType` / `align` / `maxLength` / `readOnly` / `clearable` / `placeholder` / `label` | 只读配置项                                                                              |

### 事件

| 事件     | 触发                              | 载荷            |
| -------- | --------------------------------- | --------------- |
| `change` | **用户**编辑（`setValue` 不触发） | `value: string` |
| `submit` | 提交                              | `value: string` |

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

### 快捷键矩阵

| 按键                       | 行为                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `←` / `→`                  | 移动光标；按住 `Shift` 扩展选区                                                         |
| `↑` / `↓`                  | 仅 `TextArea`（多行）：上下移动并保持列位置；单行输入框**不消费**这两个键，交给焦点导航 |
| `Home` / `End`             | 行首/行尾；加 `Ctrl`/`Cmd` 为文档首/尾                                                  |
| `Backspace` / `Delete`     | 删除（有选区时删选区）                                                                  |
| `Enter`                    | 单行：提交；多行：插入换行（`submitOnEnter: true` 时改为提交）                          |
| `Ctrl`/`Cmd` + `Enter`     | 一律提交（`TextArea` 的常用提交手势）                                                   |
| `Escape`                   | 回滚到聚焦时的值，然后失焦                                                              |
| `Tab` / `Shift+Tab`        | **不被输入框消费**，交给焦点链做遍历                                                    |
| `Ctrl`/`Cmd` + `A`         | 全选                                                                                    |
| `Ctrl`/`Cmd` + `C`/`X`/`V` | 复制/剪切/粘贴（有 DOM 桥时由浏览器处理）                                               |

两条实现细节，解释了为什么输入框不会「吃掉」页面的键盘导航：

- 纯 Canvas 路径下，输入框只在**自己持有焦点**时挂一个捕获阶段的 `window` keydown 监听，消费掉的键会 `stopPropagation`，避免场景插件把方向键当成焦点移动。
- DOM 桥路径下浏览器自己完成编辑，框架只负责「声明这个键归我」（同样是为了不让空格被导航当成激活）。

---

## 5. `TextArea`：多行输入

`TextArea` 继承 `TextField`，只改「行策略」，额外三个选项：

| 选项            | 类型      | 默认    | 说明                                                                                                    |
| --------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `rows`          | `number`  | `3`     | 可见行数，用来推导默认高度**和最大高度**                                                                |
| `wrap`          | `boolean` | `true`  | 在内容宽度处自动换行（由控件自己的换行器完成，保证光标位置精确）                                        |
| `submitOnEnter` | `boolean` | `false` | 交换 Enter 绑定：`true` 时 Enter 提交、`Shift+Enter` 换行；`false` 时 Enter 换行、`Ctrl/Cmd+Enter` 提交 |

```ts
const notes = this.add.uiTextArea({
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
const email = this.add.uiTextField({
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
import { bindEnabled, bindText, bindValue } from '@phaser-mvvm/phaser';
import type { TextField } from '@phaser-mvvm/widgets';

export class LoginScene extends Phaser.Scene {
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
    const emailField = this.add.uiTextField({
      label: 'Email',
      placeholder: 'you@example.com',
      inputType: 'email',
      width: 360,
      clearable: true,
      validate: (value) => (value === '' || this.emailValid.value ? null : '邮箱格式不正确'),
    });

    const passwordField = this.add.uiTextField({
      label: 'Password',
      placeholder: '至少 6 位',
      inputType: 'password',
      width: 360,
    });

    const hintLabel = this.add.uiLabel({ text: '', tone: 'muted', width: 360 });
    const submit = this.add.uiButton({
      text: '登录',
      variant: 'primary',
      width: 360,
      onClick: () => {
        this.busy.value = true;
        void this.login();
      },
    });

    // 用户编辑 → 写回 ViewModel（change 只在用户输入时触发）
    emailField.on('change', (value: string) => {
      this.email.value = value;
    });
    passwordField.on('change', (value: string) => {
      this.password.value = value;
    });

    // ViewModel → 视图（程序化写入走静默 setValue，不会打回环）
    bindValue(
      emailField,
      () => this.email.value,
      (value, w) => (w as TextField).setValue(String(value)),
    );
    bindValue(
      passwordField,
      () => this.password.value,
      (value, w) => (w as TextField).setValue(String(value)),
    );

    bindText(hintLabel, () => this.hint.value);
    bindEnabled(submit, () => this.canSubmit.value);

    const page = this.add.uiPanel(
      { direction: 'vertical', gap: 12, padding: 22, variant: 'surface', radius: 12, width: 420 },
      [
        this.add.uiLabel({ text: '登录', style: { fontSize: '20px' } }),
        emailField,
        passwordField,
        hintLabel,
        this.add.uiDivider({}),
        submit,
      ],
    );

    this.mvvm.mount(page);
    emailField.focus(); // 打开页面就聚焦第一个字段
  }

  private async login(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    this.busy.value = false;
  }
}
```

这个例子里几个值得注意的点：

- `change` 事件负责「视图 → 模型」，`bindValue` 负责「模型 → 视图」。两边都写是因为示例想同时展示两种方向；实际项目里更省事的是 `bindModel`（[06 章 §4](./06-data-and-theme.md)）：
  ```ts
  bindModel(
    emailField,
    () => this.email.value,
    (v) => (this.email.value = v),
  );
  ```
- `bindEnabled` 直接驱动按钮的 `disabled` 状态，所以「不能提交」是视觉 + 交互一起生效的。
- `bindText` 里的 `computed` 每个依赖变化都会重算，但**每帧只刷一次**（`flush: 'frame'`）。

---

## 8. 常见坑

| 现象                              | 原因                                                                                             | 修法                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 打不出中文 / 没有候选框           | 没开 `dom.createContainer`，或用了 `dom: false`                                                  | 开 DOM 容器；用 `field.bridged` 自检                                                     |
| 在输入框里敲空格却激活了别的东西  | 空格在导航里等于 `activate`；框架在输入框聚焦时会消费该键，但你自己挂的全局 keydown 可能抢在前面 | 不要把全局快捷键挂在捕获阶段；需要时先判断 `document.activeElement` 或 `field.composing` |
| `setValue()` 之后 `change` 没触发 | 这是**设计如此**（静默写入，防回环）                                                             | 想感知变化就监听用户输入，或在模型侧 `watch`                                             |
| `field.on('blur', …)` 从不触发    | 聚焦/失焦只有**回调选项**，没有事件                                                              | 用 `onBlur` / `onFocus` 选项                                                             |
| 输入时整个页面在重排              | 用了 `width: 'auto'`。只有 auto 宽度才会因为内容变化而 `markDirty`                               | 表单里给输入框写固定的 `width` 或 `'fill'`                                               |
| 失焦后校验没跑                    | 焦点没有真正转移（点击画布空白处会失焦，切到别的控件也会）                                       | 明确调用 `field.blur()` 或 `validateNow()`                                               |
| `maxLength` 把 emoji 截断了       | 不会 —— 它是按码点计数的                                                                         | 若确实发生，检查是不是自己在外层又做了 `slice`                                           |
| 输入框被其它控件挡住点不到        | 兄弟 `Panel` 的 `blockPointer` 拦了指针                                                          | 关闭那个面板的 `blockPointer`，或调整层级顺序                                            |

---

## 9. 小结

- **要中文输入就必须开 `dom: { createContainer: true }`**，然后用 `bridged` 自检；纯 Canvas 模式只是降级路径。
- `setValue` 静默、`change` 只对用户编辑触发 —— 这两条是双向绑定不回环的基础。
- 校验挂在 `validate` 上、失焦自动跑；错误消息要自己用 `Label` 展示。
- `TextArea` = `TextField` + 行策略（`rows`/`wrap`/`submitOnEnter`）。

下一篇 [05 列表与滚动](./05-lists-and-scroll.md)：`Repeat` 的键控复用与虚拟化、`ScrollView` 的手势与裁剪。
