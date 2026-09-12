# 06 · 数据绑定与主题

本章目标：不再手写「改数据 → 找到控件 → 改文本」，改完数据界面自己变；并且能一键换肤。

> 对应示例：[`apps/examples/src/scenes/bindings.ts`](../../apps/examples/src/scenes/bindings.ts)（`#/bindings`）、[`apps/examples/src/scenes/list.ts`](../../apps/examples/src/scenes/list.ts)（`#/list` 里的模板与命令绑定）、[`apps/examples/src/scenes/dashboard.ts`](../../apps/examples/src/scenes/dashboard.ts)（`#/dashboard` 的换肤）。

> **本章的主题是绑定本身**：`bind*` 系列是命令式那一层（数据在 store 里、或者要挂到已有控件上时用它），页面代码用它写也是合法的；但**日常写页面优先用 Compose 风格 DSL 的数据槽**——`Text(() => vm.title.value)`、`TextField({ value: ref })`、`Button({ disabled: () => !canSave.value })`——它内部就是这些 `bind*`，你不用逐个接线（[09 章](./09-compose-dsl.md)）。本章的示例代码用 DSL 写，同时标注等价的命令式写法。

---

## 1. 三层结构：先建立心智模型

```
@phaser-mvvm/core      ref / reactive / computed / watch / makeObservable / BindingContext
        ↓   （不依赖 Phaser，可在 Node 单测）
@phaser-mvvm/phaser    bindValue / bindText / bindCommand / bindModel …  ← 把状态接到控件上
        ↓
@phaser-mvvm/widgets   控件：只暴露 setText / setValue / setEnabled / setVisible 之类的命令式方法
```

关键点：**绑定就是「读一个 getter，把结果写进控件」的 effect**。控件本身完全不认识响应式系统，所以你可以：

- 只用响应式做数据层，手动调 `setText`；
- 或者用绑定把两者接起来；
- 两种方式混用也没问题（同一个控件不要既绑又手写同一个属性）。

---

## 2. 响应式最小集

```ts
import { computed, makeObservable, reactive, ref, watch } from '@phaser-mvvm/core';

const count = ref(0);
count.value++; // 写
console.log(count.value); // 读

const doubled = computed(() => count.value * 2); // 惰性 + 缓存，依赖变化才重算

const user = reactive({ name: 'Ada', tags: [] as string[] }); // 深度 Proxy
user.name = 'Grace';
user.tags.push('math');
```

也可以写**普通类 + `makeObservable`**（推荐的 ViewModel 形态，不用继承任何基类）：

```ts
class LoginVM {
  email = '';
  password = '';
  busy = false;

  get canSubmit(): boolean {
    // 注意：getter 不会被 makeObservable 改写
    return this.email.includes('@') && this.password.length >= 6 && !this.busy;
  }

  constructor() {
    makeObservable(this); // 把数据字段变成跟踪访问器
  }
}
```

| API                                           | 一句话                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ref(v)` / `shallowRef(v)`                    | 单值容器，读写走 `.value`                                                          |
| `reactive(obj)` / `shallowReactive(obj)`      | 深度/浅层响应式代理                                                                |
| `computed(fn)`                                | 派生值，惰性求值 + 缓存                                                            |
| `makeObservable(obj, spec?)`                  | 把类实例的自有数据字段变成访问器（`spec` 可指定 `'ref'`/`'reactive'`/`'shallow'`） |
| `watch(src, cb, {immediate, deep, flush})`    | 值变化时执行副作用                                                                 |
| `watchEffect(fn)` / `effect(fn)`              | 立即执行并自动收集依赖                                                             |
| `effectScope()`                               | 副作用容器；**控件的 `scope` 就是它**，销毁控件即停止一切订阅                      |
| `nextTick()` / `flushSync()` / `flushFrame()` | 手动控制刷新时机（一般不需要）                                                     |

**刷新时机**：**绑定**的默认 `flush` 是 `'frame'`，由场景插件在每帧 `PRE_UPDATE` 调 `flushFrame()` 触发（[01 §6](./01-quick-start.md)）。所以一帧里改 N 次数据只重绘/重排一次。（`watch`/`watchEffect` 的默认档位是 `'pre'`，走微任务队列，和 UI 刷新是两条独立队列。）

> ⚠️ 所有绑定都挂在**目标控件的 `scope`** 上。控件 `destroy()` 时 `scope.stop()`，订阅随之消失 —— 这是「场景创建→销毁 100 次后计数归零」能成立的原因。所以不要自己在外层用裸 `effect()` 去监听 UI，把它写成绑定。

---

## 3. 绑定函数：先用最省事的几个

```ts
import {
  bindText,
  bindTemplateText,
  bindVisible,
  bindEnabled,
  bindError,
  bindValue,
} from '@phaser-mvvm/phaser';

bindText(titleLabel, () => this.title.value); // string → setText
bindTemplateText(hintLabel, this.pageContext, '共 {{ total }} 项'); // 模板 → setText
bindVisible(warningPanel, () => this.error.value !== null); // boolean → setVisible
bindEnabled(saveButton, () => this.canSave.value); // boolean → setEnabled
bindError(emailField, () => this.emailError.value !== null); // boolean → setError
```

| 函数                                               | 写入目标                             | 说明                                             |
| -------------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `bindValue(host, read, apply, {flush})`            | 你自定义的 `apply(value, host)`      | **最底层**，其它都是它的包装；值不变时不会写回   |
| `bindText(host, read)`                             | `host.setText(String(value))`        | 用于任何有 `setText` 的控件（`Label`/`Button`…） |
| `bindTemplateText(host, context, template)`        | `host.setText(格式化结果)`           | 模板见 §5                                        |
| `bindVisible(host, read)`                          | `host.setVisible(value !== false)`   | 顺带触发布局重算（隐藏＝退出流）                 |
| `bindEnabled(host, read)`                          | `host.setEnabled(value !== false)`   | 驱动 `disabled` 状态与输入屏蔽                   |
| `bindError(host, read)`                            | `host.setError(value === true)`      | 驱动 `error` 状态                                |
| `bindPath(host, context, path, apply)`             | 自定义                               | 直接读某条路径，不需要手写闭包                   |
| `bindTemplate(host, context, template, apply)`     | 自定义                               | 模板 + 自定义写入                                |
| `bindCommand(host, read \| context, source, opts)` | `host.onActivate`                    | 命令绑定，见 §4                                  |
| `bindModel(host, read, write)`                     | 双向：`setValue` 向下、`change` 向上 | 见 §4                                            |

返回值全都是 `StopBinding`（一个函数），调用它即可手动解绑；不调也没关系，控件销毁时会自动停。

`flush` 选项接受 `'sync' | 'pre' | 'post' | 'frame'`，默认 `'frame'`。**不要为了「立刻生效」改成 `'sync'`**：那会让一帧内多次数据变化触发多次布局，正是 ADR-0008 要避免的。

---

## 4. 命令绑定与双向绑定

> **DSL 对应写法**：下面的四个 `bind*` 在 DSL 里都有数据槽替身——`bindText` ← `Text(() => …)`，`bindModel` ← `TextField({ value: ref })`，`bindEnabled`/`bindVisible`/`bindError` ← `disabled`/`visible` 槽与 `setEnabled`，`bindCommand` ← `onClick` + `disabled` 槽。需要 `canExecute` 那种"命令对象"语义、或控件已经建好之后再接数据时，才直接用 `bind*`（`#/bindings` 是这一层的示例页）。

### 4.1 `bindCommand`：按钮 ↔ 命令

命令就是 ViewModel 上的一个方法，`canExecute` 就是「能不能点」。

```ts
class PageVM {
  rows = ref<Row[]>([]);
  get hasItems(): boolean {
    return this.rows.value.length > 0;
  }
  clear = (): void => {
    this.rows.value = [];
  };
}

const ctx = new BindingContext(vm);

// 形态 A：context + 路径（命令与 canExecute 都是路径）
bindCommand(clearButton, ctx, 'clear', { canExecute: 'hasItems' });

// 形态 B：getter（不需要 context）
bindCommand(saveButton, () => (vm.canSave ? () => vm.save() : null), {
  canExecute: () => vm.canSave,
});
```

语义：

- `canExecute` 为假 → 控件 `setEnabled(false)`，按钮自动变灰且**不再接收激活**。
- `bindCommand` **链式**接在已有的 `onActivate` 后面，不会覆盖你在构造选项里给的 `onClick`。
- 命令 getter 返回 `null`/`undefined` 表示这次激活什么也不做。

### 4.2 `bindModel`：文本框的双向绑定

```ts
import { bindModel } from '@phaser-mvvm/phaser';

bindModel(
  filterField, // TextField / TextArea
  () => this.filter.value, // 读
  (value) => {
    this.filter.value = value;
  }, // 写回
);
```

两条方向不对称，这是防回环的关键：

| 方向        | 机制                            | 为什么安全                                        |
| ----------- | ------------------------------- | ------------------------------------------------- |
| 模型 → 视图 | 调控件的 `setValue`（**静默**） | `setValue` 不 emit `change`，循环在这里断掉       |
| 视图 → 模型 | 监听控件的 `change` 事件        | `change` 只对**用户编辑**触发，程序化写入不会触发 |

另外：**输入法组合期间 (`composing === true`) 会暂停写回**，避免把「拼字中间态」写进模型（中文输入必需）。写入前还会比较一次当前值，相等就跳过。

---

## 5. 作用域与模板

### 5.1 `BindingContext`

```ts
import { BindingContext } from '@phaser-mvvm/core';

const root = new BindingContext(vm); // 根作用域
const row = root.child({ vm: item, item, index: 3 }); // 子作用域（Repeat 内部就是这么做的）

root.resolve('user.name'); // 读路径
root.set('user.name', 'Ada'); // 写路径（返回是否成功）
row.resolve('$index'); // 3
row.resolve('$root'); // 指回根
```

| 路径前缀  | 指向                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| 无前缀    | 当前作用域的 `vm`                                                                          |
| `$vm`     | **内部标记键**，不是路径前缀：它只是指明「无前缀路径从哪个对象开始」，`{{ $vm }}` 取不到值 |
| `$item`   | 当前项（`Repeat` 的行数据）                                                                |
| `$index`  | 当前下标                                                                                   |
| `$root`   | 根作用域的 `vm`                                                                            |
| `$parent` | 父作用域的 `vm`                                                                            |

路径编译（`compilePath`）是**纯字符串解析 + getter/setter 闭包**，不使用 `eval`/`new Function`，因此 CSP 环境可用（PLAN §4.4 的硬约束）。

### 5.2 模板与转换器

模板字符串里的 `{{ 路径 }}` 会被解析并**逐个路径编译一次**，之后每次刷新只做取值 + 拼接：

```ts
bindTemplateText(counter, ctx, '已渲染 {{ rendered }} / {{ total }}');
bindTemplateText(price, ctx, '{{ amount | money("$", 2) }}');
bindTemplateText(nickname, ctx, '{{ name | default("(未设置)") }}');
```

内置转换器（`BUILT_IN_CONVERTERS`）：

| 名称                       | 用法                                  | 行为                                             |
| -------------------------- | ------------------------------------- | ------------------------------------------------ |
| `upper` / `lower` / `trim` | `{{ name \| upper }}`                 | 大小写 / 去空白                                  |
| `number`                   | `{{ n \| number(2) }}`                | 解析为数字；给位数就 `toFixed`，解析失败输出空串 |
| `money`                    | `{{ n \| money("¥", 2) }}`            | 货币格式（符号默认 `$`，位数默认 2）             |
| `join`                     | `{{ tags \| join("、") }}`            | 数组连接（默认分隔符 `, `）                      |
| `default`                  | `{{ v \| default("—") }}`             | 空值（`null`/`undefined`/`''`/`NaN`）时回退      |
| `date`                     | `{{ d \| date("YYYY-MM-DD HH:mm") }}` | 日期格式化（`YYYY YY MM DD HH mm ss`）           |

自定义：

```ts
import { registerConverter } from '@phaser-mvvm/core';

registerConverter('percent', (value) => `${(Number(value) * 100).toFixed(1)}%`);
// {{ ratio | percent }}
```

---

## 6. 主题：令牌驱动，一键换肤

### 6.1 用内置主题

```ts
this.mvvm.setTheme('light'); // 'dark'（默认）| 'light'
console.log(this.mvvm.theme.name); // 当前主题
```

`setTheme` 之后**不需要你做任何事**：每个 `Widget` 都订阅了主题变化，会重绘并按新字体重新测量；场景插件还会把主相机的背景色同步成 `theme.colors.background`（这就是换肤时整页背景一起变的原因）。

> ℹ️ **插件选项有两种正规写法**（第 66 轮起）：**游戏级默认值**在创建游戏前调一次 `MVVMPlugin.configure({ … })`，之后每个场景插件都继承它；**运行期补丁**用 `this.mvvm.configure({ … })`，订阅类选项（`navigation`/`themeBackground`/`a11y`）立即生效，建树类选项（`align`/`container`…）留给下次建 UI 根。**Game Config 里 `plugins.scene[].config` 传不进去**——Phaser 用 `new Plugin(scene, pluginManager, mapKey)` 实例化，第 4 个参数永远为空，所以别再写它了。返回键仍然用 `this.mvvm.onBack = …`（`focus.onBack` 是插件的路由钩子，见 07 章）。

```ts
// 想让 UI 叠在游戏画面上、且不要主题背景色：拿到插件后自己处理
this.mvvm.onBack = () => this.closeDialog(); // 应用级返回处理（运行期可写属性）
this.mvvm.configure({ themeBackground: false }); // 运行期补丁：这台场景的相机不再跟随主题背景
this.scene.cameras.main.setBackgroundColor('rgba(0,0,0,0)'); // Phaser 支持 rgba 字符串
// 注意：插件每次换肤都会用主题色重写它，所以自定义背景要在换肤时再覆盖一次
```

### 6.2 自定义主题

`Theme` 就是一个完整对象（字段见 [03 §8](./03-widgets.md)），从暗色改起就行：

```ts
import { DARK_THEME, setTheme, type Theme } from '@phaser-mvvm/phaser';

const brand: Theme = {
  ...DARK_THEME,
  name: 'brand',
  colors: { ...DARK_THEME.colors, primary: 0x7c3aed, focusRing: 0xa78bfa },
  radius: { ...DARK_THEME.radius, md: 10 },
};

setTheme(brand); // 也可以：this.mvvm.setTheme(brand)
```

订阅变化（例如把选中的主题名写进存档）：

```ts
import { onThemeChange } from '@phaser-mvvm/phaser';

const off = onThemeChange((theme) => console.log('theme →', theme.name));
off(); // 取消订阅
```

> 控件的重绘**永远读当前主题**，不会缓存颜色字面量。所以在构造选项里传的字面量颜色（如 `Divider` 的 `color: 0xff0000`）在换肤后**不会**跟着变 —— 想跟随主题就传令牌名（`color: 'border'`）。

---

## 7. 实战：把仪表盘接上数据 + 换肤

```ts
import Phaser from 'phaser';
import { computed, ref } from '@phaser-mvvm/core';
import { Button, Grid, Panel, Row, Spacer, Text, render } from '@phaser-mvvm/widgets/compose';

interface Metric {
  key: string;
  label: string;
  value: number;
}

/** ViewModel：纯 TS，不继承任何基类。 */
class OpsVM {
  metrics = ref<Metric[]>([
    { key: 'revenue', label: 'Revenue', value: 128_400 },
    { key: 'users', label: 'Active users', value: 8_921 },
  ]);
  selected = ref<string | null>(null);
  total = computed(() => this.metrics.value.reduce((sum, m) => sum + m.value, 0));
}

export class OpsScene extends Phaser.Scene {
  private vm = new OpsVM();

  constructor() {
    super('ops');
  }

  create(): void {
    render(this.mvvm, () => {
      Panel({ gap: 12, padding: 16, variant: 'plain', width: 'fill' }, () => {
        Row({ gap: 12, alignItems: 'center' }, () => {
          Text('Ops dashboard', { style: { fontSize: '20px' } });
          Spacer({ flex: true });
          // 一个 computed 驱动一段文本：数据变了，下一帧自动更新（等价于 bindTemplateText(label, ctx, '合计 {{ total }}')）
          Text(() => `合计 ${this.vm.total.value.toLocaleString()}`, { tone: 'muted' });
          // 换肤按钮：文案跟着主题走，切主题时两个控件（含被量过的文本尺寸）都自己更新
          Button(() => `Theme: ${this.mvvm.theme.name}`, {
            size: 'sm',
            onClick: () => this.mvvm.setTheme(this.mvvm.theme.name === 'dark' ? 'light' : 'dark'),
          });
        });

        // 卡片是数据驱动的：`for` 直接写在内容 lambda 里，跑到的分支就是存在的分支
        Grid({ columns: 'auto', minColumnWidth: 180, columnGap: 12, rowGap: 12 }, () => {
          for (const metric of this.vm.metrics.value) {
            Panel({ gap: 6, padding: 16, variant: 'surfaceAlt', radius: 10 }, () => {
              Text(metric.label, { tone: 'muted' });
              Text(metric.value.toLocaleString(), { style: { fontSize: '26px' } });
            });
          }
        });
      });
    });
  }
}
```

要点：数据只改 `ref`/`computed`，视图侧只写数据槽或绑定；换肤只调 `setTheme`，所有控件（含被量过的文本尺寸）都会自己更新。用 `bind*` 写同样的页面时，`Text(() => …)` 换成 `bindText(label, () => …)`、`for` 循环换成先建好数组再传给 `Grid`——两者的刷新时机完全一样（都是 `flush: 'frame'`）。

---

## 8. 什么时候仍然需要手动 `markDirty()`

绑定负责「值 → 控件方法」，但**控件方法是否让布局重算**是另一回事：

| 操作                               | 需要额外 `markDirty()` 吗                            |
| ---------------------------------- | ---------------------------------------------------- |
| `Label.setText` / `Button.setText` | 不需要（内部已经 `markDirty`）                       |
| `Button.setVariant` / `setLoading` | 不需要（内部处理）                                   |
| `setLayoutParams` / `setVisible`   | 不需要                                               |
| 你直接改 `widget.layoutParams.xxx` | **需要**，而且要改成 `setLayoutParams({ xxx })` 才对 |
| 自定义控件里改了影响尺寸的内部对象 | **需要**（在改动处调 `this.markDirty()`）            |
| 换了全局字体（不通过主题系统）     | 需要 `layoutEngine.reset()` 丢缓存                   |

---

## 9. 常见坑

| 现象                           | 原因                                                        | 修法                                                      |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| 改了数据界面不变               | 读的不是响应式对象，或读的时机不在 effect 内                | 数据用 `ref`/`reactive`/`makeObservable`；绑定用 `bind*`  |
| 文本框输入时模型被写坏（中文） | 没等输入法提交就写回                                        | 用 `bindModel`（内部已按 `composing` 暂停写回）           |
| 双向绑定来回抖                 | 手写了 `on change → setValue` 又叠了 `bindModel`            | 只保留一套方向的实现                                      |
| 换成 `flush: 'sync'` 后掉帧    | 每次写数据都立刻重排                                        | 保持默认 `'frame'`                                        |
| 换肤后某些颜色没变             | 那些颜色是构造时写的字面量                                  | 传主题令牌名（`tone`、`color: 'border'`）                 |
| 场景切换后旧页面还在响应       | 手动 `addWidget` 到了根之外，或者在控件外用裸 `effect` 订阅 | 用 `this.mvvm.mount()`；副作用放进 `widget.scope`         |
| `computed` 每次读都重算        | 依赖的其实是每次新建的对象                                  | 让依赖保持稳定引用；必要时用 `watchEffect` 看依赖收集情况 |
| 模板里写 `{{ a + b }}` 报错    | 模板**不支持表达式**，只有路径 + 转换器                     | 在 ViewModel 里写 `computed`，模板只引用它                |

---

## 10. 小结

- 绑定 = 「读 getter → 写控件」的 effect，默认按帧 flush，挂在控件的 `scope` 上。
- 常用四个：`bindText`（文本）、`bindVisible`/`bindEnabled`/`bindError`（状态）、`bindCommand`（命令 + `canExecute`）、`bindModel`（双向，输入法安全）。
- 模板只支持「路径 + 转换器」，复杂逻辑放进 `computed`。
- 主题全令牌化：`setTheme` 一处切换，控件自己重绘；自定义主题就是换一个 `Theme` 对象。

下一篇 [07 交互：指针、焦点与导航](./07-input-focus-nav.md)：让页面在纯键盘和手柄下也能跑通。
