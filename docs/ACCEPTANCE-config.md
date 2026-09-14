# 验收记录 · 插件选项（`MVVMPlugin.configure`）

- **验收场**：[`#/config`](../../apps/examples/src/scenes/config.ts)（`window.config` 暴露补丁与读数）
- **被测实现**：[`packages/phaser/src/plugin.ts`](../../packages/phaser/src/plugin.ts) 的 `MVVMPlugin.configure()`（静态，游戏级默认值）、`mvvm.configure()`（实例，运行期补丁）、`mergePluginConfig()`，以及 `a11y.ts` 的 live 区域开关
- **第 66 轮**：把"插件选项传不进去"这个**写在指南四处**的限制去掉
- **验收方式**：Playwright MCP（真实鼠标/键盘）+ 全量示例扫描

---

## 1. 之前为什么传不进去，现在怎么办

Phaser 用 `new Plugin(scene, pluginManager, mapKey)` 实例化场景插件，**Game Config 条目里的第 4 个参数（config）永远不会被传进来**，所以 `MVVMPluginConfig`（`themeBackground`/`navigation`/`onBack`/`input`/`focus`/`a11y`）只能运行期一个场景一个场景地设。指南 01/06/07/08 都写着这条限制。

现在有两条正规入口：

```ts
// 1) 游戏级默认值：在 new Phaser.Game(...) 之前调用一次，之后创建的每个场景插件都继承它
MVVMPlugin.configure({
  themeBackground: false, // UI 场景叠在游戏画面上：不要主相机跟随主题背景
  a11y: { politeness: 'assertive' },
  input: { dragThreshold: 12 },
});

// 2) 运行期补丁：只改这个场景，立即生效（订阅类/活对象类选项当场应用，建树类选项留给下次建根）
this.mvvm.configure({ navigation: false });
```

`mergePluginConfig()` 把 `input`/`focus`/`a11y`/`layout` 这几个**子选项包做一层深合并**——只写 `focus.wrap` 不会把 `input.dragThreshold` 一起清掉（浅拷贝会，这正是它存在的理由）。

| 选项                                                       | `configure()` 之后的行为                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `navigation`                                               | 立刻挂钩/摘掉键盘监听（Tab、方向键、Enter 立刻受控）                                                                                                                                                                                                         |
| `themeBackground`                                          | 立刻订阅/退订主题变化；关掉后**不再改相机颜色**（颜色归应用自己管）                                                                                                                                                                                          |
| `a11y`                                                     | `false` 立刻把镜像层从 DOM 移除；`{ politeness }` 立刻改写 live 区域                                                                                                                                                                                         |
| `input.dragThreshold`                                      | 直接写活动路由器                                                                                                                                                                                                                                             |
| `focus.wrap`/`trapFocus`/`ring`                            | 直接写活动焦点管理器；**`ring` 第 113 轮起真的生效**（此前只写不读、是个死选项 = V79）：它**立刻重画当前持有焦点的那个控件**，只抑制焦点环、不动焦点与光标（`#/states` 实测 `{focused:true,ringOn:false}`，见 [ADR-0012](./adr/0012-focus-visible-ring.md)） |
| 其它（`align`/`depth`/`snapMode`/`container`/`safeArea`…） | 存储，下次建 UI 根时生效                                                                                                                                                                                                                                     |

### 安全区（第 72 轮追加）

`safeArea`（默认 `true`）是这批选项里唯一**值来自设备**而不是 config 对象的：`UIRoot` 读 `env(safe-area-inset-*)` 并把它设成根自己的 padding。它与别的选项一样是**建树类**（`safeAreaEnabled` 在构造时定下），所以运行期 `configure({ safeArea: false })` 不会移动已经建好的根。

`#/config` 因此提供两条读数：`window.config.safeArea()`（`enabled` + 四个 inset + 根的实际 padding）与 `window.config.resize()`（强制重读——inset 只在 resize 时重新测量），`#demo-state` 逐帧发布 `safeArea.*` 与 `root.padding.*`。逐设备矩阵（桌面 0 / 刘海 47-34 / 横屏侧边 / 极端值夹取）见 [`ACCEPTANCE-mobile.md`](./ACCEPTANCE-mobile.md) §2.3。

---

## 2. 验收矩阵（第 66 轮实测）

| #   | 行为                    | 判据                                                                                                                                                                                                                                               |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | 游戏级默认值到达场景    | `main.ts` 里 `MVVMPlugin.configure({ a11y: { politeness: 'assertive' } })` → `#/config` 读出 `defaults.a11y={"politeness":"assertive"}`，live 区域 `aria-live="assertive"`                                                                         |
| C2  | 默认值可读              | `MVVMPlugin.defaults` 返回合并后的默认值（只读拷贝）                                                                                                                                                                                               |
| C3  | 关闭键盘导航            | `configure({ navigation: false })` 后 `Tab` **不再移动焦点**；同一场景的鼠标点击照常工作（`patched` +1、焦点跟随）                                                                                                                                 |
| C4  | 子选项包一层深合并      | `configure({ input: { dragThreshold: 20 }, focus: { wrap: false } })` → 阈值 8 → **20**，且其余选项未被清空                                                                                                                                        |
| C5  | 相机背景跟随/不跟随主题 | `themeBackground: true` + 切 light → 相机 `#0d1117` → **`#f6f8fa`**；`themeBackground: false` + 切回 dark → 相机**保持** `#f6f8fa`                                                                                                                 |
| C6  | a11y 运行期开关         | `configure({ a11y: false })` → DOM 里 0 个镜像根；再 `configure({ a11y: { politeness: 'polite' } })` → 1 个根且 `aria-live="polite"`                                                                                                               |
| C7  | 日志                    | dev 模式：`configure: applied navigation, themeBackground`；`setDevMode(false)` 后同样补丁 **0 行**                                                                                                                                                |
| C8  | 动效策略（第 74 轮）    | `patch({ transition: { exit: 0 } })` → `motion.enter` 仍 **160**（子选项包深合并）；再 `patch({ transition: { enter: 250 } })` → `exit` 仍 **0**；`patch({ transition: false })` → 两个都 **0**；补丁打在别的包上（`focus`/`input`）时动效不受影响 |

### 实测读数

```
defaults            { a11y: { politeness: 'assertive' } }
live                aria-live="assertive"
Tab（导航开）        config.button1 → config.button2
Tab（导航关）        config.button2（不动）
鼠标点击（导航关）   patched 0 → 1，焦点 config.button2
merge               { input: { dragThreshold: 20 }, focus: { wrap: false } } → dragThreshold 8 → 20
themeBackground:true  切 light  → camera #f6f8fa
themeBackground:false 切 dark   → camera #f6f8fa（保持，不再跟随）
a11y:false           roots 0 → 再开 → roots 1 + aria-live="polite"
motion（初值）       { enter: 160, exit: 120, reduced: false }；#demo-state 的 motion.enter/motion.exit/motion.reduced 同步
patch transition.exit = 0     → { enter: 160, exit: 0 }
patch transition.enter = 250  → { enter: 250, exit: 0 }
patch focus.wrap=false + input.dragThreshold=14 → 动效仍 { enter: 250, exit: 0 }，dragThreshold 14
patch transition = false      → { enter: 0, exit: 0 }
恢复                           → { enter: 160, exit: 120 }
```

---

## 3. 未覆盖 / 有意不做

- **`MVVMPluginConfig` 里的 `onBack`**：仍然推荐用 `this.mvvm.onBack = …`（第 61 轮的 V20：`focus.onBack` 是插件的路由钩子）。`configure({ onBack })` 也能写进去，但文档只教 `mvvm.onBack`——一个应用级回调没有必要走两条路。
- **`configure()` 影响已存在的页面布局**：`align`/`depth`/`container` 这类描述"根怎么建"的选项不会追溯修改已经建好的根（`depth` 会生效，因为它直接写渲染深度；`align` 不会）。这一点写进了 JSDoc。
- **Game Config 里的 `plugins.scene[].config`**：仍然是 Phaser 不会传递的字段（这是 Phaser 的行为，不是本框架能改的），所以文档不再提"可以传 config"，只教 `MVVMPlugin.configure()` 与实例 `configure()`。
- **多游戏实例**：静态默认值是**进程级**的；一个页面里跑两个 `Phaser.Game` 会共享它（`resetDefaults()` 只在测试里用）。真实项目不会这么做。

---

## 6. 第 110 轮追加：第三条通道 —— Game Config 条目的 `data`（并修掉 V78）

第 66 轮把"选项只能运行期设置"这件事解决了一半：`MVVMPlugin.configure()` 是**游戏级**的，一个页面里跑两个 `Phaser.Game`（或一个库想自己配置自己而不碰静态）就没有办法。本轮补上第三条通道：选项写在 `plugins.scene[]` 条目的 **`data`** 字段里。

为什么是 `data`：Phaser 只把 `key`/`plugin`/`mapping` 交给场景插件，第四个 `config` 参数恒为空（第 66 轮实测过），但**整个条目被原样保留**在 `game.config.installScenePlugins` 里（`Config.js` 直接引用 `plugins.scene` 数组）；而 `data` 是 `PluginObjectItem` 类型上唯一空闲的槽位——它文档里的用途是"传给插件 `init()`"，而 Phaser 只对*全局*插件这么做。

四个通道的强弱（`#/config` 常驻断言前三个）：

| 通道                                                     | 作用域       | `#/config` 实测                                                                    |
| -------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| ② `MVVMPlugin.configure({ transition: { enter: 120 } })` | 游戏级默认值 | `defaults()` → `{ a11y: { politeness: 'assertive' }, transition: { enter: 120 } }` |
| ① 条目 `data: { transition: { enter: 320 } }`            | 该插件注册   | `entry()` → `{ transition: { enter: 320 } }`；**压过 ②**                           |
| ④ 运行期 `patch({ transition: { enter: 50 } })`          | 单场景运行期 | `motion()` 320 → **50**；退出页面重进回到 320（补丁不持久）                        |
| ③ 构造函数第 4 参数                                      | 单实例       | Phaser 不传；测试与自定义宿主用                                                    |

`#status` 直接打出这条链：`entry.transition.enter=320 defaults.transition.enter=120 entryValueWins=1`。同级键**不被清掉**也已实测：改 `enter` 不动 `exit`（`motion.exit` 仍是 120），说明走的是 `mergePluginConfig` 的一层深合并。

**V78（MEDIUM，本轮修复）**：第一版按 `entry.key === pluginKey` 找条目，`#/config` 当场打脸——`entry()` 读得到 320 而 `mvvm.config` 仍是 120，**且没有任何报错**。根因是 Phaser 有两条实例化路径，第三个参数不是同一个东西：Game Config 走 `addToScene`（`new source.plugin(scene, this, mapKey)` → `mapping`），运行时/Loader 走 `installScenePlugin`（`new plugin(addToScene, this, key)` → `key`）。修法：同时比 `key` 与 `mapping`，并拒绝空 `pluginKey`；单测补两条（只给 `mapping` 的条目要读到、空键返回空配置）。完整说明见 [`PITFALLS.md`](../PITFALLS.md) §8.71、[`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.46。

**未覆盖**：`data` 里放一个**非对象**（Phaser 的 `data` 也可能承载别的东西）时按"没配置"处理，有单测；但"同一个 `key` 注册到多个场景"的合并顺序只做了 Node 单测（后写的赢），没有多场景实测。
