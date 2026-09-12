# 验收记录 · `UIScene`（框架的 `setContent { … }`）

- **验收场**：[`#/uiscene`](../../apps/examples/src/scenes/uiscene.ts)（`window.uiscene` 暴露全部驱动与读数）；**回归场**：[`#/a11y`](../../apps/examples/src/scenes/a11y.ts)（第 68 轮把这一页改成 `UIScene`，读数必须逐项不变）
- **被测实现**：[`packages/phaser/src/UIScene.ts`](../../packages/phaser/src/UIScene.ts)（`content()` / `setContent()` / `page` / `contentInfo` / `onBack()`）、[`require-plugin.ts`](../../packages/phaser/src/require-plugin.ts)（缺插件时的指名错误）、[`plugin.ts`](../../packages/phaser/src/plugin.ts) 的 `back` 逐层路由多了一层"场景先否决"
- **第 68 轮**（M8 第一项"仍未开始"的交付：`UIScene` 基类）
- **验收方式**：Playwright MCP（真实鼠标点击 / `Tab` / `Escape`）+ Node 单测（缺插件守卫）+ `node scripts/visual-check.mjs`（新增 `uiscene` 场景，几何 + 像素）
- **相关**：[`guide/01`](./guide/01-quick-start.md) §3（入口选择）、[`guide/08`](./guide/08-lifecycle-and-pitfalls.md)（销毁与重建）、[`guide/07`](./guide/07-input-focus-nav.md)（`back` 的顺序）

---

## 1. 为什么要有它

一个"只为显示一页 UI"的场景，此前必须写四行仪式：

```ts
export class HelloScene extends Phaser.Scene {
  constructor() {
    super('hello');
  }
  create(): void {
    render(this.mvvm, () => {
      /* …视图… */
    });
  }
}
```

`UIScene` 把仪式收进基类，剩下的就是视图本身：

```ts
export class HelloScene extends UIScene {
  constructor() {
    super('hello');
  }
  content(): void {
    Panel({ padding: 20 }, () => {
      /* …视图… */
    });
  }
}
```

三件事除了省字以外还有实际作用：

| 能力                 | 说明                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `content()`          | 由 `buildUiPage()` 建树并 `mount()`，规则与 `ui()`/`render()` **完全相同**：0 个根是错误（消息里给出建议），多个根警告后包一层容器    |
| `setContent()`       | **替换整页**：旧树销毁、新树建立、焦点/指针/无障碍镜像经插件的结构变化通道重新收集（这是"页面形状真的变了"的用法，值变化用 `ref` 槽） |
| `onBack()`           | `back`（Esc / 手柄 B）**先由场景否决**，再落到应用层处理                                                                              |
| `page`/`contentInfo` | 当前根控件，以及最近一次建树的结果（控件数 / 层级 / 根数），后者让"这页是一棵树"变成可断言的事实                                      |

**什么时候不用它**：UI 只是场景工作的一部分时（钉在世界上的 HUD、两棵互不相干的根、要交给 `mvvm.modal.open()` 的子树），继续用 `Phaser.Scene` + `render()`/`ui()`。

---

## 2. 验收矩阵（第 68 轮实测）

### 2.1 建树与挂载

| #   | 判据                             | 实测                                                                                                                       |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| U1  | `content()` 自动建树 **并挂载**  | 打开 `#/uiscene` 即出现页面；场景里没有任何 `render()`/`mount()` 调用；`contentInfo = { widgets: 22, depth: 4, roots: 1 }` |
| U2  | 一页就是一棵树（没有被隐式包壳） | `roots=1`、`container=Panel`（若是被包的会变成 `BoxWidget`）                                                               |
| U3  | 多个根被包住而不是报错           | `show('multi')` → `roots=3`、`container=BoxWidget`、`built=3`，控制台一条 `wrapped 3 roots` 警告                           |
| U4  | 新页立刻可交互                   | `Tab` 顺序即新树的顺序：`show.a → show.b → show.multi → hook.toggle → dialog.open → a.click → a.name`                      |
| U5  | 开发轨迹                         | `UIScene.content(): built 22 widget(s), 4 level(s) deep` → `mount: page attached and laid out (22 widget(s))`              |

### 2.2 `setContent()`：销毁与重建

| #   | 判据                         | 实测                                                                                                                            |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| U6  | 旧页**真的被销毁**           | 点一次 `show.b`（那个按钮销毁的正是它自己）：`prev.destroyed=1`，`view=b`，`swaps=1`，点击正常完成、无报错                      |
| U7  | 新页是**另一棵树**           | `built` 22 → **23**、`focusables` `…+a.click+a.name` → `…+b.volume+b.reset+b.full`、`container` 仍是 `Panel`                    |
| U8  | 场景（与它的 ViewModel）活着 | 真实点击 `a.click` 两次 → `a.clicks=2`；B → A 往返后仍是 `2`，而 `swaps=25`、`prev.destroyed=1`（视图重建、数据保留）           |
| U9  | **反复替换不泄漏**           | `swap(20)` 前后逐项相同：`widgets 22`、`themeListeners 24`、`displayList 1`、`focusables 7`、`pointerTargets 11`、`a11yNodes 7` |

> U9 是这一轮最重要的一条：`setContent()` 是"整棵树销毁 + 重建"的入口，任何一处漏掉（主题订阅、输入注册、镜像节点、显示列表）都会在这里累积。计数用的是 `#/lifecycle` 的同一组指标。

### 2.3 `onBack()`：先否决，再放行

| #   | 操作                              | 实测（`hook`/`app` 两个计数器）                                          |
| --- | --------------------------------- | ------------------------------------------------------------------------ |
| U10 | `Escape`，`onBack()` 返回 `true`  | `hook 0 → 1`，`app` **不变**                                             |
| U11 | `Escape`，`onBack()` 返回 `false` | `hook 1 → 2`，`app 0 → 1`（应用层的 `mvvm.onBack` 终于在钩子之后跑到了） |
| U12 | 有对话框时按 `Escape`             | `depth 1 → 0`、`closes=1`，**两个计数器都不动**（模态仍然优先）          |

顺序是 `modal → page → scene.onBack → app`；`hook.toggle` 按钮（真实点击）在两个分支之间切换。

### 2.4 缺插件时的错误（Node 单测，`test/require-plugin.test.ts`）

| #   | 判据                   | 实测                                                                  |
| --- | ---------------------- | --------------------------------------------------------------------- |
| U13 | 有插件时原样返回       | 返回同一个对象                                                        |
| U14 | 没插件时指名场景与修法 | 消息含 `"hello"`、`MVVMPlugin`、`mapping: 'mvvm'`（可直接照抄的配置） |
| U15 | 连 `sys` 都没有也不崩  | 仍抛 `/no MVVMPlugin/`                                                |

> `Phaser.Scene.mvvm` 在类型上**非可选**（这正是 `this.mvvm` 好用的原因），所以"游戏没注册插件"这件事只能运行期抓——此前它会以 `Cannot read properties of undefined (reading 'root')` 的形式出现在布局深处。

### 2.5 旧页面改写后的回归（`#/a11y` → `UIScene`）

| 读数         | 改写前（文档记录）                  | 改写后（实测）                        |
| ------------ | ----------------------------------- | ------------------------------------- |
| 镜像节点     | 14                                  | **14**                                |
| 焦点集合     | 13                                  | **13**                                |
| 指针目标     | 16                                  | **16**                                |
| 根控件       | `a11y.page`                         | **`a11y.page`**                       |
| 建树信息     | （原为手工 `ui()` + `mount()`）     | `{ widgets: 21, depth: 4, roots: 1 }` |
| `Tab` / 播报 | `a11y.toggle` + `接收通知, checked` | 同左                                  |

### 2.6 像素门禁

`scripts/visual-check.mjs` 的场景列表加入 `uiscene`（这是唯一能自动化发现"树建对了但没挂上"的检查）：

```
--- uiscene ---
page=@290,173 700x374
show.a=@318,201 65x28
canvas=@0,0 1280x720
OK       canvas.clear: #0d1117 at (4,4)
OK       show.a: #2f6feb at (326,215)      ← 当前视图的按钮是 primary 填充
```

---

## 3. 一个必须知道的约束：`content()` 里只能用**参与 UI 作用域**的写法

`this.add.vbox(...)` / `this.add.uiButton(...)` 这些工厂方法直接 `displayList.add()`，**不进 UI 作用域**，因此：

```ts
class Bad extends UIScene {
  content(): void {
    this.add.uiLabel({ text: 'hi' }); // ← 没有进入作用域，等于"一个根都没建"
  }
}
// → throw: UIScene.content(): the content built no widget. …
```

`content()` 与 `ui()`/`render()` 的 lambda 是同一种东西：里面应当调用 **DSL composable**（`Panel`/`Row`/`Text`/…），或者显式把工厂建出来的控件交给 `withUiParent()`。这也是 `#/m0`（纯工厂 API 的 M0 验收页）**保持** `Phaser.Scene` 的原因——它的目的正是验证工厂路径本身。

---

## 4. 门禁（第 68 轮实跑）

| 命令                            | 结果                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `pnpm -r run typecheck`         | 5/5 通过                                                              |
| `pnpm -r run test`              | **1122 通过**（layout 313 / core 281 / phaser **195** / widgets 333） |
| `pnpm exec prettier --check .`  | 通过                                                                  |
| `pnpm docs:check`               | 通过                                                                  |
| `pnpm run build:examples`       | 通过                                                                  |
| `pnpm size`                     | 预算内（见提交信息）                                                  |
| `node scripts/visual-check.mjs` | **6 场景**全绿（新增 `uiscene`：几何 + `primary` 填充色）             |
| 18+1 场景扫描（Playwright MCP） | 全部 `ok`、零 ERROR                                                   |

---

## 5. 未验证 / 已知边界

- **场景重启**：`scene.restart()` 会再跑一次 `create()` → `setContent()`；插件在 `SHUTDOWN` 已经把上一棵树销毁（`#/lifecycle` 的 100 次重启门禁覆盖的是那条路径）。本轮没有单独对 `UIScene` 跑 `churn`。
- **`setContent()` 的动效**：目前是瞬时的（PLAN M8 的"开闭动效钩子"仍未开始），切换没有过渡。
- **`content()` 抛异常时**：页面会停在"旧页已销毁、新页没建成"的状态（`page` 为 `null`）。错误会冒泡到 Phaser 的场景创建流程（示例应用装了 `installErrorReporting()` 会写进 `#status`），但框架没有做事务性回滚——本轮未验。
- **`onBack()` 的返回值语义**只有 `true` 才拦；返回 `Promise`、抛错等未定义行为未验。
