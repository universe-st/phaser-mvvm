# ADR-0006：Phase 1 范围（含 UIScene/Page/Modal/Router 与受限 a11y、手柄导航）

- 状态：Accepted
- 日期：2026-09
- 决策来源：PLAN.md §10.2（决策 5/6/7）、§1.2 非目标、§10.1 决策 1、§4.3、§4.4
- 影响范围：里程碑 M8 / M9 的交付内容、`packages/phaser/src/scene/*`、`packages/phaser/src/{input,a11y}/*`、`packages/widgets/src/modal`

## 背景

框架最初可以把范围压缩到「控件 + 布局」，但实务上会立刻遇到三个问题：

1. 没有 UI 场景与页面体系，使用者的游戏场景会被 UI 代码污染（键盘、`scale.resize`、销毁逻辑）；
2. 没有模态与焦点陷阱，弹窗打开后底层控件仍可被点击/键盘到达；
3. 只有鼠标可用时，手柄/键盘用户无法完成表单流程；同时屏幕阅读器完全读不到 Canvas 内容。

PLAN §10.2 已二次评审确认：这三项**在 Phase 1 全做**，但 a11y 限定为受限范围。

## 决策

### 1. Phase 1 做（已冻结）

| 项                     | 交付物                                                                                                                                                                                                                                                                                                                                                               | 里程碑             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 独立 UI 场景与页面体系 | `UIScene` 基类（自动挂载 `MVVMPlugin`、创建 `UIRoot`、处理设计分辨率与安全区，提供 `ui.show(page)` / `ui.back()`）；`Page`（一个 ViewModel + 一个视图工厂 + `onEnter/onLeave/onPause/onResume` 生命周期，支持传参与 `keepAlive` 缓存策略）；页面栈；`ModalStack`（`StackArranger` + 遮罩 + 焦点陷阱 + ESC/返回键关闭 + `closable` 遮罩策略 + 多层级 + 开闭动效钩子） | **M8**             |
| 轻量路由               | `Router`：路由名 → Page 类 + 参数 的映射，供多页面导航项目使用                                                                                                                                                                                                                                                                                                       | **M8**（可选使用） |
| 受限 a11y              | `A11yBridge`：为每个可交互控件维护隐藏 DOM 镜像节点（`role`/`aria-label`/`aria-valuenow` 等）；焦点变化与状态播报走 `aria-live` 区域；**键盘全可达**                                                                                                                                                                                                                 | **M9**             |
| 手柄导航               | `NavSource` 抽象：把方向键 / Tab / 手柄 D-Pad + 摇杆 / 鼠标悬停统一为焦点移动语义；手柄按键映射为 `activate / back / next / prev`，由 `FocusManager` 消费，**控件无需感知输入设备**                                                                                                                                                                                  | **M9**             |

### 2. Phase 1 明确不做

- **不做 URL 路由**：`Router` 只映射「路由名 → Page」，不读写 `location`/`history`，不做深链接与刷新恢复。
- **不做 WCAG 全量合规**：不做合规认证，不复刻浏览器原生语义（无完整 ARIA 语义树、无 `tabindex` 全序模型、不做对比度自动校验）。
- 不做 HTML/CSS 引擎、可视化编辑器、3D/物理控件、Phaser 3 兼容层（PLAN §1.2）。

### 3. a11y 层的边界

- 镜像层的**读**能力（屏幕阅读器朗读控件名称/状态/错误）与**键盘可达**是承诺项；
- 镜像层的**视觉/交互精度**不是承诺项（它不是可操作的 DOM 控件，只是一个播报与查询用的影子节点）；
- overlay 容器与 DOM 输入桥共用同一个，由 `UIScene` 统一创建/销毁（ADR-0004、PLAN §10.3）。

## 理由与权衡

- **一次做对生命周期**：页面栈、模态焦点陷阱、`UIScene` 三者耦合紧密；如果 M8 只做半套（例如先做弹窗不做页面栈），后续接入会重写销毁路径，成本高于一次做完。
- **a11y 走 DOM 镜像而非重构渲染**：Canvas 没有语义层，唯一可行路径是并行维护一个隐藏 DOM 树；这与输入桥共用基础设施，边际成本低。
- **手柄与键盘共用 `NavSource`**：避免控件里出现 `if (gamepad)` 分支；新增输入设备（例如遥控器）只是新增一个 `NavSource` 实现。
- **范围控制**：URL 路由会引入「浏览器前进/后退 → 页面栈同步」的复杂一致性模型，且对游戏内 HUD 无意义，收益与成本不成比例，故排除。

## 后果

### 正面

- 使用者能把 UI 完全放进独立 `UIScene`，游戏场景保持干净（推荐用法：`scene.launch` 叠加）。场景 `SHUTDOWN/DESTROY` 时自动卸载全部页面与绑定（PLAN §4.3）。
- 弹窗与页面栈的焦点陷阱有明确验收标准（M8：弹窗打开时焦点不逃逸、下层不可点；反复开关 100 次无泄漏）。
- 纯手柄/纯键盘可以完成完整表单流程（M9 验收）。

### 负面

- M8 + M9 合计 7–11 个工作日（PLAN §6），是 Phase 1 中风险最高的两块，且依赖 M3 的 `FocusManager`/`InputRouter` 先就位。
- a11y 是「受限范围」，使用者若需要合规认证，仍需自行补充 —— 该限制必须在使用文档中明确写出，避免误解。
- `Router` 不做 URL 路由意味着刷新页面会丢失导航状态，这是刻意的取舍。

## 相关

- PLAN.md §10.2 决策 5/6/7、§1.2 非目标
- PLAN.md §4.3（场景与页面体系、手柄导航、无障碍）、§4.5（`Modal` 控件）
- PLAN.md §6 里程碑 M8 / M9、§7 验收（泄漏归零、手柄完成完整流程）
- ADR-0004（DOM 输入桥与 a11y 共用 overlay）、ADR-0007（Phaser 4 约束）

## 现状校正

> 上面的正文写于决策当时，范围与取舍未变；下面是**落地后的实际名字**（正文里的草案名不要在写代码时照抄）。

- **影响范围里的目录不存在**：`packages/phaser/src` 是扁平的（`UIScene.ts`、`modal.ts`、`pages.ts`、`router.ts`、`input.ts`、`focus.ts`、`nav.ts`、`a11y.ts`…），没有 `scene/`、`input/`、`a11y/` 子目录；模态层也不在 widgets，而在 `packages/phaser/src/modal.ts`。
- `UIScene` **不自动挂载**插件：它用 `requireMVVMPlugin()` 取 `this.mvvm`，缺插件时在 `create()` 里抛出带 Game Config 片段的错误；设计分辨率与**安全区**由 `UIRoot` 负责（`safeArea` 默认开启）。没有 `ui.show(page)` / `ui.back()`：`ui(scene, content)` 只建视图，返回键走 `UIScene.onBack()` + `planBack()`。
- **没有 `Page` 类**：页面体系是 `pages.ts` 的 `PageHost` + `PageOptions`（钩子为 `onResume`/`onPause`/`onDispose`/`onBack`），没有 `onEnter`/`onLeave`/`keepAlive`。
- **没有 `ModalStack`/`StackArranger`**：模态是 `modal.ts` 的 `ModalHost`，经 `this.mvvm.modal` 使用（遮罩/焦点陷阱/`Esc`/叠层/动效都在这里）。
- **没有 `NavSource` 这个符号**：交付的是 `nav.ts`（`NavRepeat`、`keyboardActionOf`、`gamepadActionsOf`、`heldDirectionsOf`、`GAMEPAD_BUTTON_ACTIVATE/BACK`）由 `FocusManager` 消费；PLAN §10 至今仍把「`NavSource` 抽象命名」列为未开始。
