# 验收记录 · 命令绑定的指针可达性 + `#/showcase` DSL 迁移（第 8 轮）

> 目的：① 收掉缺陷登记簿里「疑似但未证实」的 V4（`bindCommand` 绑定的控件收不到指针输入）；② 把最后一个用工厂 API 写的大页面 `#/showcase` 迁到 Compose 风格 DSL，让「推荐写法」在最大的验收页上也成立。
> 环境：macOS，Node v24.18.1，pnpm 10.34.5，Playwright MCP（Chromium），dev server 5173。
> 结论：**V4 已复现并修复（A/B 实测：修复前 0 次点击、控件不在路由集合里也没有命中区；修复后进入路由、有命中区、点击生效）；`#/showcase` 已迁移到 DSL，各分区控件数与迁移前基线完全一致，交互无回归。**

---

## 1. V4：后来绑定的命令收不到指针输入（已复现 → 已修复）

### 1.1 复现方法（可重复）

在静态页面 `#/m0` 上用动态 import 拿到 `@phaser-mvvm/phaser`，然后：

```js
const label = scene.add.uiLabel({ text: 'CLICK ME', width: 200, height: 40 });
scene.mvvm.root.addWidget(label); // 先入树
await frame(); // 让路由器收集一次（此时它没有任何交互标记）
mod.bindCommand(label, () => () => clicks++); // 之后再绑命令
await frame();
// 读 router.widgets、label.input、并点它的中心点
```

### 1.2 修复前后（同一脚本，修复只 `git stash` 掉 `binding.ts` 一个文件）

| 读数                                   | 修复前    | 修复后   |
| -------------------------------------- | --------- | -------- |
| 绑定后是否在 `InputRouter.widgets` 里  | **false** | **true** |
| 是否有命中区（`widget.input != null`） | **false** | **true** |
| `onActivate` 是否已装                  | true      | true     |
| 点击中心点后的回调次数                 | **0**     | **1**    |

根因：`collectInteractive()` 靠 `onActivate !== null` 认出这类控件，但 ① 普通控件（`Label`/`Image`/`Divider`）本来没有命中区，② 路由集合只在**结构版本变化**时重建，而「绑一个命令」不改结构。于是在一个静止的页面上，后绑的命令永远收不到点击。

修法（`packages/phaser/src/binding.ts`）：`bindCommand()` 装好回调后补两件事——`host.enablePointerInput?.()`（补命中区）与 `host.structureListener?.()`（告诉根「交互集合可能变了」，插件下一帧重建）。调用方不必再写 `interactive: true`。

**注意**：在结构频繁变化的页面（例如带虚拟化列表的页面，挂载行本身就会让版本号跳动）这个缺陷会被掩盖——所以它此前只在「静止页面 + 后绑命令」下暴露。修复不影响那些页面（A/B 里 `#/states` 的点击行为在修复前后一致）。

### 1.3 常驻演示与回归测试

- `#/states` 新增探针 `cmd.label`：一个**普通 `Label`**（无 `interactive`、不可聚焦）在**挂载之后**绑定命令，逐帧把点击次数写进 `cmd.clicks`。实测点两下 → `cmd.clicks = 2`。
- 单测：`packages/phaser/test/input-order.test.ts` 新增「`collectInteractive` 会收集只带激活回调的控件 / 不会收集毫无标记的控件」两例（+2，phaser 121 passed）。

---

## 2. `#/showcase` 迁移到 DSL（1589 → 1740 行）

`apps/examples/src/scenes/showcase.ts` 是最后一个用 `this.add.ui*` 工厂写的大页面（1598→1740 行属于内容 lambda 的缩进与括号，不是功能增加）。迁移由子代理完成，父会话用 Playwright MCP 独立核对。

### 2.1 等价性（实测，与迁移前基线逐项比对）

| 检查                      | 结果                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 每个分区的 `widgets` 计数 | text **39** / buttons **43** / inputs **35** / decoration **71** / box **161** / grid **81** / stack **83** / params **110** / repeat **107** / focus **39** —— **与基线完全一致，零差异** |
| 启动几何                  | `page=@12,12 1176x619`、`nav=@24,62 232x595`、`stage=@268,62 908x595`（与基线一致）                                                                                                        |
| Show all                  | 751 个控件（与基线一致）                                                                                                                                                                   |
| `pt.*` 键                 | 全部保留：`header.showAll/next/theme`、`nav.<10 个分区>`、`section.<id>`、`buttons.toggle/click/reset`、`inputs.*`、`params.visibility`、`repeat.*`、`focus.*` 等                          |
| 真实交互                  | 主题按钮 dark → light → dark；反馈按钮点两次 `clicks=2`，Reset 归 0；滚动、chips 横滚、Add row、虚拟化 Reverse、`visible` 折叠均由子代理逐项驱动通过                                       |
| 控制台                    | 0 error                                                                                                                                                                                    |

### 2.2 迁移中的判断（已在子代理报告中逐条说明，非静默差异）

1. **透明面板 → `Row`/`Column`**：几何完全一致；差别是 `Panel` 默认装 `blockPointer` 命中区而 `BoxWidget` 不装。本页无人需要该命中区、UI 后面也没有游戏对象，因此节点数与交互读数都无变化。若日后要求指针拓扑完全一致，把这些换回 `Panel({ variant: 'plain', … })` 即可。
2. **色块**：DSL 没有 `Rect` composable（`RectWidget` 是适配层的 M0 探针控件），因此按指南 §7 的「自定义控件加入 DSL 树」协议写：`new RectWidget(...)` + `scene.add.existing` + `emitWidget()`，外层用 `Row`/`Text` 组合。
3. **模板绑定 → 反应式槽位**：头部摘要/底部读数/实时值标签改为 `Text(() => …)`；**唯一保留** `bindTemplateText` 的是列表行名标签（`{{ $index }}` 是活状态，重排后必须重算行号）。
4. **`setText`/`setVisible` → 反应式槽位**：`Button(() => …)`、`{ visible: () => … }`；发布键与取值不变，唯一理论差异是标签在帧刷新时重绘而不是在点击回调里同步重绘（不影响任何读数）。
5. **`onValueChange` 取代手写 `change` 监听**：同一事件、同一发布键。
6. `controls()` 的插入顺序被刻意保持（含 chips 端口先于行按钮这一处），以免 `pt.*` 顺序变化。

### 2.3 未验证

- 本页**未做像素级验收**：该环境里 `Page.captureScreenshot` 与 `canvas.toDataURL()` 对 WebGL 表面返回空白图（子代理报告），因此等价性证据是几何/状态/控件树层面的。`chromium` + `?capture=1` 的像素路径本轮未跑。

---

## 3. 已运行的命令与结果

| 命令                           | 结果                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `pnpm -r run typecheck`        | 5/5 包通过                                                    |
| `pnpm -r run test`             | **986 passed**：core 278、layout 306、phaser 121、widgets 281 |
| `pnpm exec prettier --check .` | 通过                                                          |

---

## 4. 提交

- V4：`fix(phaser): make a command-bound widget a pointer target`
