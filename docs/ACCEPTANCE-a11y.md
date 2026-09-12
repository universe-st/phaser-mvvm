# 验收记录 · 无障碍镜像（`A11yBridge`，M9 切片）

- **验收场**：[`#/a11y`](../../apps/examples/src/scenes/a11y.ts)（`window.a11y` 暴露 DOM 读数）
- **被测实现**：[`packages/phaser/src/a11y.ts`](../../packages/phaser/src/a11y.ts)、`Widget.a11y` / `Widget.describeA11y()` / `Widget.a11yLabel`、各控件的描述符（`Button`/`Slider`/`TextField`/`TextArea`/`ScrollView`/交互式 `Panel`）
- **范围**（PLAN §1.2、§4.3、决策 6）：**键盘全可达 + 手柄导航 + 隐藏 DOM 镜像 + `aria-live` 播报**；不做 WCAG 全量合规认证，也不复刻浏览器原生语义
- **验收方式**：Playwright MCP —— **所有断言都读真实 DOM**（`querySelectorAll('[data-mvvm-a11y]')` 与节点属性），不读控件树；只有这样才能抓到"对象里对、DOM 里错"
- **全仓门禁**：`pnpm -r run test` 1096 passed、`typecheck` 5/5、`prettier --check .`、`docs:check`、`size` 18.4 KB min+gzip、`build:examples`、`visual-check` 5 场景

---

## 1. 它是什么，不是什么

画布对屏幕阅读器是一块不透明的东西，所以框架给**每个可交互控件**放一个视觉隐藏的 DOM 镜像节点（`role`/`aria-label`/`aria-valuenow`/`aria-checked`/`aria-disabled`/`aria-invalid`），焦点变化与应用消息通过一个 `aria-live` 区域播报。

三条刻意设计（都写进代码注释与指南）：

1. **镜像节点不可聚焦**（没有 `tabindex`）：键盘控制权留在框架里（方向键/`Tab`/手柄），屏幕阅读器用户在浏览模式里读镜像，按键仍然由游戏处理；
2. **镜像跟着"可交互集合"走**（`InputRouter` 的注册集合）：`Label`、装饰性 `Panel` 这类没有描述符的控件**不产生节点**，而**禁用控件有节点**并带 `aria-disabled="true"`（它在画面上存在，用户应该听到）；
3. **默认开启**：任何页面在第一次结构变化时就会建出镜像层；不想要就 `this.mvvm.a11y.enabled = false`（运行期，会把整层从 DOM 移除）或配置 `a11y: false`。

---

## 2. 验收矩阵（第 64/65 轮实测）

### 2.1 节点与属性（`#/a11y`，14 个节点）

| 控件                 | 镜像节点                                                          |
| -------------------- | ----------------------------------------------------------------- |
| `Button('普通按钮')` | `button "普通按钮"`                                               |
| `Button(toggle)`     | `checkbox "接收通知" checked=true`                                |
| `Button(disabled)`   | `button "不可用按钮" **disabled**`（**禁用控件也在镜子里**）      |
| `Slider`             | `slider "音量" v=40`                                              |
| `TextField`          | `textbox "名字"`（`label` 选项 → 可访问名；无则退到 placeholder） |
| `TextArea`           | `textbox "备注"`                                                  |
| 交互式 `Panel`       | `button "可点击的卡片"`                                           |
| `Scroll`             | `region "按钮区域" v=0`，`hint` 说明"纵向滚动区，可滚 0px"        |
| 滚动区里的 6 个按钮  | 6 个 `button`，各带自己的文本                                     |
| `Text`（非控件）     | **没有节点**（`Label` 由拥有它的控件读出，不单独播报）            |

`Label`（`a11y.title`/`a11y.hint`/`a11y.tail`）与两个纯布局容器都不在镜像里：节点数 14 = 可交互控件数，`focusables` 13（不含禁用按钮）。

### 2.2 焦点播报（`aria-live`）

| 动作                       | 实时区域文本（DOM 读出）                               |
| -------------------------- | ------------------------------------------------------ |
| 聚焦「普通按钮」           | `普通按钮`                                             |
| 聚焦滑杆                   | `音量, 40`                                             |
| 聚焦开关                   | `接收通知, checked`                                    |
| **鼠标点开关**（真实交互） | `接收通知, not checked`，且节点 `aria-checked="false"` |

live 区域属性：`role="status"`、`aria-live="polite"`、`aria-atomic="true"`（`politeness` 可配 `'assertive'`）。

### 2.3 值变化与校验

| 动作                          | 结果                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `setVolume(85)` + `sync()`    | 滑杆节点 `aria-valuenow` 40 → **85**                                                                |
| 让必填字段校验失败 + `sync()` | 字段节点 `aria-invalid="true"`，文本 `名字, invalid, 名字不能为空`（错误消息进 `aria-description`） |
| `announce('测试播报')`        | live 区域文本变成 `测试播报`（同一条消息重复播报也会被读出：先清空再写入）                          |

### 2.4 生命周期与开关

| 场景                      | 结果                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `enabled = false`         | DOM 里 `[data-mvvm-a11y-root]` **0 个**、节点 0 个          |
| `enabled = true`          | 重新建出 1 个 root + 14 个节点                              |
| 场景 `restart()`          | 仍然只有 **1** 个 root、14 个节点（插件 teardown 里销毁）   |
| `#/lifecycle` `churn(10)` | 8 项计数全平 + 1 个 root + 9 个节点（**不累积**）           |
| 普通页面（`#/gallery`）   | 自动出现 1 个 root + 9 个节点，无需任何代码触碰 `mvvm.a11y` |

### 2.5 日志（开发模式）

```
[phaser-mvvm] a11y: mirrored 14 widget(s)
[phaser-mvvm] a11y: announce: 测试播报
```

`setDevMode(false)` 后同样的操作（refresh + announce + 改值）**0 行**。

---

## 3. 本轮修掉的两个设计缺口

做这个功能时，"先按最自然的实现跑一遍再看数字"暴露了两处：

### V29 · 禁用控件不在镜像里

第一版镜像从**焦点集合**（`FocusManager.focusables`）生成——那正好是"键盘能到达的东西"，听起来很合理，但那意味着**禁用按钮对屏幕阅读器完全不存在**：实测 `#/a11y` 的镜像只有 13 个节点，`a11y.disabled` 缺席。一个画面上看得见、鼠标点不动的按钮，用户至少应该听到"不可用按钮，disabled"。

修法：镜像改为从 **`InputRouter` 的注册集合**（"用户能作用的控件"）生成，并按控件名排序后保留树的顺序；没有描述符的控件（`Label`、装饰面板）自然被跳过。修后 14 个节点，禁用按钮带 `aria-disabled="true"`。

### V30 · 没有"可访问名"这个选项，无文字控件的名字是内部 id

`Slider`、`Scroll`、交互式 `Panel` 自己不画文字，于是镜像只能退到控件的 `name`（调试 id）：实测读出来的是 `"a11y.volume"`、`"a11y.card"`——一个屏幕阅读器用户会听到 `a11y.volume` 这种东西。

修法：`WidgetOptions` 新增 **`label`**（可访问名），`Widget.a11yLabel` 保存，控件描述符按 `label → 可见文字 → placeholder → name` 的优先级取名；`baseWidgetOptions()` 统一转发（这正是 V13 的教训：**没有代码读的选项等于骗人**）。`TextField`/`TextArea` 早在 M5 就有 `label`（当时用作 DOM 桥的可访问名），现在同一个选项两处都对。修后读出来的是 `"音量"`、`"可点击的卡片"`、`"按钮区域"`。

---

## 4. 未覆盖 / 有意不做

- **真实屏幕阅读器**（VoiceOver / NVDA / TalkBack）：本轮只断言 DOM —— 也就是"喂给屏幕阅读器的原料"；**没有用真实 SR 听过一遍**。这是本记录里最重要的未验证项。
- **浏览模式与焦点模式的交互**：镜像节点刻意不可聚焦，因此 SR 的"表单控件列表"里能看到控件、但 `Tab` 由游戏接管；这种分工**未在真实 SR 上验证过体验**。
- **`aria-activedescendant` / roving tabindex**：没有做（那是"复刻浏览器原生语义"的范畴，PLAN §1.2 明确排除）。
- **层级/角色语义**：没有 `aria-owns`、没有树形结构（列表 → 行 → 单元格只以平铺控件呈现）。
- **本地化播报文案**：`checked`/`disabled`/`invalid` 等词是英文常量，未走主题或 i18n。
- **`aria-live` 的节流**：连续快速变化（拖动滑杆）会连续播报；没有做合并/防抖。
