# 验收记录 · 开发模式日志（第 50 轮）

> 需求第 3 条：**调试模式下多打日志，发布模式下关闭日志**。第 50 轮补齐了三条最常被用来追问"为什么没反应"的轨迹（激活、虚拟化窗口、滚动被钳制），并把"发布模式零日志"从口头约定变成可复跑的验收。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173，页面 `bringToFront()`。

---

## 1. 新增的三条轨迹

三条都发生在**低频路径**上（一次激活、一次窗口变化、一次越界请求），因此用 `if (isDevMode())` 包住插值——发布模式连字符串都不会拼。

| 轨迹                                           | 位置                                                           | 为什么值得打                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `activate: <name> (<source>)`                  | `Widget.activate()`（`packages/phaser/src/Widget.ts`）         | 控件"点了没反应"的第一个问题就是**它到底有没有被激活**。这里同时覆盖鼠标、键盘、手柄（`source` 直接给出设备），而且只在**成功**激活时打印 |
| `repeat: window [start, end) of N - mounted M` | `Repeat` 的行 diff（`packages/widgets/src/Repeat.ts`）         | 虚拟化是"设计上不可见"的，窗口算错时的症状只是"行不见了"。这一行让窗口可见，且只在挂载集合真的变化时打印                                  |
| `scroll: clamped (x, y) -> (nx, ny)`           | `ScrollView#setOffset`（`packages/widgets/src/ScrollView.ts`） | "列表滚不到底"的典型形态就是**请求值被上限纠正**（第 38 轮修的 offset 复钳制缺陷正是如此）。只在请求越界且未开回弹时打印                  |

原有的轨迹（第 3–6 轮加入）保持不变：`ui()` 建树规模、`render()`、`mount`、`focus`、`shutdown`，以及慢布局趟（≥ 200 节点或 ≥ 2 ms）。

## 2. 实测（`#/states` → `#/scroll`，控制台抓 `[phaser-mvvm]` 前缀）

```
repeat: window [0, 2) of 30 - mounted 0
ui(): built 107 widget(s), 8 level(s) deep
layout: measured 440 node(s) in 15.00 ms (skipped 0 subtree(s), 87 cache hit(s) so far)
mount: page attached and laid out (111 widget(s))
repeat: window [0, 8) of 30 - mounted 2
activate: button.default (pointer)
activate: button.default (keyboard)      ← 键盘激活同样可见
activate: vdown (pointer)
repeat: window [0, 3) of 220 - mounted 0
scroll: clamped (0, 771) -> (0, 529.5)   ← 拖到底之后继续拖：请求被上限纠正
scroll: clamped (0, 853) -> (0, 529.5)
scroll: clamped (0, 872) -> (0, 529.5)
```

## 3. 发布模式：一行都不打（可复跑）

示例应用暴露了 `window.mvvmDev.setDevMode(false)`（`apps/examples/src/main.ts`），于是这条契约可以在浏览器里直接验收：

| 步骤                                                         | 实测                                         |
| ------------------------------------------------------------ | -------------------------------------------- |
| 开发模式下一次按钮点击                                       | **8** 行 `[phaser-mvvm]`                     |
| 关掉开发模式后：点按钮 + 点滑杆 + 聚焦输入框并输入 `release` | **0** 行（功能不受影响：`text = "release"`） |
| 重新打开开发模式再点一次                                     | 轨迹立刻恢复（2 行）                         |

Node 侧另有 `packages/core/test/dev.test.ts` 的三个用例钉住同一契约：`devLog` 在开发模式带前缀打印、关掉后**一次都不打印**，以及 `isDevMode()` 可作为调用点跳过插值的依据（这正是热路径写法 `if (isDevMode()) devLog(...)` 依赖的约定）。

## 4. 怎么用

- 页面里想临时看轨迹：控制台 `window.mvvmDev.setDevMode(true|false)`；生产包请在最外层调用 `setDevMode(false)`（`@phaser-mvvm/core` 导出）。
- 阈值与开关：`packages/phaser/src/UIRoot.ts` 顶部的 `LOG_MEASURE_THRESHOLD` / `LOG_PASS_MS`（慢布局告警），以及 `packages/core/src/utils/dev.ts`。
- 改动日志时保持两条纪律：**调用点先判断 `isDevMode()`**（或用 `devLog` 自己的早退，但不要在热路径里先拼字符串），**发布模式零输出**（本文 §3 可复跑）。
