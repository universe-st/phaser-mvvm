# ADR-0007：Phaser 4 WebGL 约束与适配层隔离

- 状态：Accepted
- 日期：2026-09
- 决策来源：PLAN.md §2 技术基线、§4.5（`ScrollView`/`TextArea`）、§9 风险
- 影响范围：`packages/phaser`（遮罩/裁剪相关全部代码）、`packages/widgets` 的 `ScrollView`/`TextArea`、M7 里程碑

## 背景

Phaser 4 把 FX 与 Mask 统一进 **Filter** 体系，这对「滚动裁剪」这一最常见需求影响最大。以下结论均已核对本机 Phaser 4.2.1 源码（`/Users/kuangshensheng/codes/phaser` 为**可选只读参考**，见 ADR-0005）：

| 结论                                                                                                                       | 源码依据                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GeometryMask` 在 v4 **仅 Canvas 渲染器可用**；WebGL 下必须改用 `FilterList#addMask`                                       | `src/display/mask/GeometryMask.js` 类文档原文：「GeometryMask is only supported in the Canvas Renderer. If you want to use geometry to mask objects in WebGL, see `Phaser.GameObjects.Components.FilterList#addMask`」 |
| 所有 GameObject 都混入了 `Components.Filters`，因此任意对象都能挂 filter                                                   | `src/gameobjects/GameObject.js` 的 `Mixins: [Components.Filters, Components.RenderSteps]`                                                                                                                              |
| `addMask` 的签名与语义（含 `viewTransform`/`scaleFactor` 校准参数）                                                        | `src/gameobjects/components/FilterList.js#addMask(mask, invert, viewCamera, viewTransform, scaleFactor)`，返回 `Phaser.Filters.Mask` 控制器                                                                            |
| v3 的 FX/Mask 用法整体失效：`BitmapMask` 移除，filter 分 internal/external 列表，filter 可作用于任意 GameObject 与场景相机 | `changelog/v4/4.0/MIGRATION-GUIDE.md` 第 3 节「FX and Masks are now Filters」                                                                                                                                          |
| Canvas 渲染器已弃用                                                                                                        | PLAN.md §2（依据同一 MIGRATION-GUIDE）                                                                                                                                                                                 |

因此 v3 时代最常见的裁剪写法 `gameObject.setMask(graphics)` 在 WebGL 下**不可用** —— 而 WebGL 正是我们要保证的唯一路径。

## 决策

### 1. 裁剪一律走 Mask filter

- `ScrollView` 内容裁剪、`TextArea` 内部滚动裁剪，统一使用 `enableFilters().filters.internal.addMask(...)`（即 `FilterList#addMask`），**不使用** `GeometryMask`；
- 需要按 `viewCamera` / `viewTransform`（`'local' | 'world'`）/ `scaleFactor` 显式校准，避免遮罩与内容错位（PLAN §9 已登记该风险）；
- 备选降级路径：**独立相机视口裁剪**（把滚动内容放进一个受相机 `viewport` 限制的容器/相机），M7 保留该路径并在文档中写明取舍。

### 2. 只保证 WebGL 路径正确

- Canvas 渲染器已弃用，框架只承诺「不崩溃」（冒烟测试级别），不承诺视觉正确；
- 所有 filter/mask 相关代码集中在 `packages/phaser` 的单一模块内，控件层只调用框架自己的抽象（例如 `applyClip(rect)` / `clearClip()`），不得直接出现 `addMask` 调用。

### 3. filter 控制器化：以「控制器对象」而非「布尔开关」建模

- v4 中 filter 是**对象**（`addMask` 返回 `Phaser.Filters.Mask`），需要显式 `enableFilters()`、并被 internal/external 列表管理；
- 适配层保存返回的控制器引用，在矩形变化时更新控制器参数、销毁时移除，**不做「每次布局都 add 一个新的 filter」**（否则一帧内多次布局会累积 filter）。

### 4. 适配层隔离 4.x 漂移

- `packages/phaser` 是唯一 `import phaser` 的包（ADR-0001/0005），且所有 4.x 特有 API 只允许出现在该包的少量「适配模块」中；
- 公开给 `widgets`/使用者的接口使用框架自己的类型（`ClipRegion` 之类），不泄漏 `Phaser.Filters.*`；
- 升级到新的 4.x 时，唯一需要改动的区域是适配模块，`widgets`、示例与快照测试不受影响（截图回归作为兜底门禁）。

### 5. M7 的最小验证先行

按 PLAN §9 对策：M7 先做「10 项滚动列表 + 性能采样」的最小验证，确认 `addMask` 的开销与精度可接受；不达标则切换到相机视口方案并文档化。

## 理由与权衡

- **没有选择**：WebGL 下 `GeometryMask` 根本不可用，`addMask` 是官方指定路径，也是唯一能同时满足「矩形裁剪 + 与 z-order/嵌套容器协作」的方案。
- **为什么保留相机视口备选**：`addMask` 需要把 GameObject 渲染进 `DynamicTexture`，在长列表高频滚动下有额外开销；相机视口是「零额外纹理」的方案，作为性能兜底。
- **代价**：
  - filter 控制器需要额外的生命周期管理（创建/更新/移除），是泄漏的高风险点 → 纳入 §7 的泄漏回归（场景创建/销毁 100 次后计数归零）；
  - `scaleFactor`/`viewTransform` 的校准容易出错，需要专门的校准用例与文档（PLAN §9）。

## 后果

### 正面

- 滚动裁剪在 WebGL 下可用，且与 `Container` 嵌套、焦点环 filter 等其他 filter 并存（同一体系，互不冲突）。
- 4.x 漂移被限制在一个包的一个模块里，升级不再等于全量返工。

### 负面

- 与网络上的 Phaser 3 教程不兼容，遇到问题不能直接照搬 `setMask` 写法（PLAN §1.2 已声明不兼容 Phaser 3）。
- Canvas 降级路径仅保证不崩溃，使用者若强行使用 Canvas 渲染器，滚动裁剪可能显示异常。
- filter 引入的纹理开销需要靠 M7 的基准数据说话，目前是「待验证」状态，不能提前宣称性能达标。

## 相关

- PLAN.md §2 技术基线（`Filters` 混入、`GeometryMask` 仅 Canvas、Canvas 弃用、`addMask`）
- PLAN.md §4.5（`ScrollView`、`TextArea` 的裁剪依赖）、§9 风险（Mask filter 开销与精度）
- PLAN.md §6 里程碑 M7、§7 测试策略（截图回归 + 泄漏测试）
- ADR-0001（只有 `packages/phaser` 依赖 Phaser）、ADR-0005（依赖版本与升级策略）
