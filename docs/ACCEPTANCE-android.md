# 验收记录 · Android（模拟器 + Cordova）

- **验收场**：`apps/examples` 的**全部 23 个场景**（本轮逐场景走查 9 个：`showcase` / `states` / `list` / `config` / `form` / `a11y` / `lifecycle`）
- **被测实现**：`packages/{core,layout,phaser,widgets}` 的构建产物（`pnpm --filter @phaser-mvvm/examples build`）
- **承载壳**：Cordova 13.0.0 + `cordova-android` 15.1.0，`www/` 就是 Vite 的构建产物
- **设备**：Android 模拟器（android-cli 自建 AVD，见 §1）
- **轮次**：第 112 轮（android-cli + Cordova 的 Android 模拟器验收）
- **门禁脚本**：[`scripts/android-check.mjs`](../scripts/android-check.mjs) —— 用 `adb shell input` 产生**真实 `MotionEvent`**，用 WebView 的 DevTools 协议读应用自己的读数（`#status` / `#demo-state` / `window.<scene>.*`）
- **判据来源**：仓库自己的 Android 相关条目（[`PLAN.md`](./PLAN.md) §1.2 的范围、[`ACCEPTANCE-mobile.md`](./ACCEPTANCE-mobile.md)、[`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md)、[`ACCEPTANCE-scale.md`](./ACCEPTANCE-scale.md)、[`ACCEPTANCE-list.md`](./ACCEPTANCE-list.md)、[`ACCEPTANCE-a11y.md`](./ACCEPTANCE-a11y.md)、[`ACCEPTANCE-lifecycle.md`](./ACCEPTANCE-lifecycle.md)）
- **第 111 轮的范围决定**：真机验收只保留 Android；iOS / 桌面真机、真实屏幕阅读器、真实手柄硬件都在范围外（见 PLAN §1.2）。**本记录把其中的 Android 一条从"待做"变成"已做（模拟器）"**，物理设备仍未跑（§5）。

---

## 1. 工具链与设备（实测）

| 项             | 值                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------- |
| 主机           | macOS 26.6.2 / arm64                                                                        |
| JDK            | Homebrew `openjdk@21` 21.0.11（`/usr/bin/java` 只是 macOS 桩，不能用来构建）                |
| Android SDK    | `cmdline-tools;latest`、`platform-tools` 37.0.0、`emulator` 36.5.11、`platforms;android-36` |
| 系统镜像       | `system-images;android-36;google_apis;arm64-v8a`（由 `sdkmanager` 安装）                    |
| AVD            | `pmvvm_api36`（`-d pixel_6`）→ 1080×2400、density 420                                       |
| 系统           | Android 16（API 36）、`sdk_gphone64_arm64`、arm64-v8a                                       |
| WebView        | `com.google.android.webview` **133.0.6943.137**（DevTools 里报 Chrome/133）                 |
| Cordova        | CLI 13.0.0、`cordova-android` 15.1.0、Gradle 8.14.2                                         |
| APK            | `app-debug.apk`，7 226 870 字节（debug 构建 ⇒ WebView 远程调试打开）                        |
| 模拟器图形后端 | gfxstream + swiftshader（`-gpu swiftshader_indirect`，无窗口）                              |

**DPR 的由来**：density 420 ⇒ `devicePixelRatio = 420 / 160 = 2.625`；CSS 视口 412.19×842.29 × 2.625 = 1080×2209，与 WebView 自己的屏幕矩形（`screenX=0, screenY=128`，128 是状态栏）逐像素相符 —— 这条换算是所有 `adb input` 坐标的基础。

## 2. 复现步骤

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

# 1. 设备（一次即可）
yes | sdkmanager --licenses
sdkmanager "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n pmvvm_api36 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_6
emulator -avd pmvvm_api36 -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -netdelay none -netspeed full &

# 2. 示例应用 → Cordova 的 www（**必须 `--base ./`**：默认的绝对路径在壳里会 404）
pnpm --filter @phaser-mvvm/examples exec vite build --base ./ \
  --outDir .tmp/android/www --emptyOutDir
cordova create .tmp/android/cordova-app com.example.phasermvvm PhaserMVVM
cp -R .tmp/android/www/. .tmp/android/cordova-app/www/
(cd .tmp/android/cordova-app && cordova platform add android && cordova build android --debug)

# 3. 门禁
node scripts/android-check.mjs device-info
node scripts/android-check.mjs install --scene states
node scripts/android-check.mjs verify          # 全矩阵，9 项
node scripts/android-check.mjs verify --only A2,A5
```

产物：`.tmp/android/out/report.json`（每个判据的读数与原始数据）与 `.tmp/android/out/*.png`（`adb exec-out screencap -p` 的设备帧缓冲截图，**设备像素**，不是 CDP 截图）。

## 3. 判据矩阵（第 1 轮实测：9/9 通过）

| #   | 判据                                                                        | 实测读数                                                                                                                                                                                                                                               | 依据                                                                 |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A1  | 应用在 Android WebView 里启动，走 WebGL，画布等于视口，无页面错误           | `renderer=webgl size=412.19049072265625x842.2857055664062 dpr=2.625 errors=0`（`Scale.RESIZE` 给的是**小数** CSS 尺寸，所以断言按容差 ±1）                                                                                                             | `ACCEPTANCE-mobile.md`                                               |
| A9  | 设备帧缓冲上真的画出来了：画布是**相机背景**而不是页面底色，且有主题令牌    | `canvas.clear=#0d1117`（`index.html` 的 body 是 `#05070a`，两者不同 ⇒ 表面确实绘制过）、`slider.fill=#2f6feb`（`primary` 令牌）                                                                                                                        | `ACCEPTANCE-theme.md`、`visual-check` 的 `canvas.clear` 约定         |
| A2  | **真实触摸**（`adb shell input tap`）激活控件                               | `clicks 0 → 1`，`activation=button.default/touch`（`ActivationSource` 是 **`touch`**，不是 `pointer`），触摸指针 `wasTouch=true`；坐标：CSS `@72,247` + origin `screenY=128`                                                                           | `ACCEPTANCE-touch.md`、[ADR-0010](./adr/0010-pointer-event-chain.md) |
| A3  | 真实拖动滚动 `ScrollView`，`Repeat` 惰性建行、只挂一个窗口                  | `offset 0 → 438`、`created 14 → 25`、**挂载行 14 → 17 / 共 220 行**、`visibleKeys=11`                                                                                                                                                                  | `ACCEPTANCE-list.md`、`ACCEPTANCE-scroll.md`                         |
| A4  | 设备形态：`DPR = density/160`，CSS 视口按 DPR 缩放后正好落在 WebView 盒子上 | `dpr=2.625`、`css 412x842`、`webview box=1080x2209 @screen 0,128`、`canvas=@0,0 412x842`、`safeArea={top:0,bottom:0,left:0,right:0}`（Pixel 6 无挖孔；安全区全 0 **不是**缺陷，见 §5）                                                                 | `ACCEPTANCE-mobile.md`、`ACCEPTANCE-scale.md`                        |
| A5  | 软键盘：点 DOM 桥字段 → **系统 IME 真的弹出** → 输入进得去                  | `focus=name`、`value="android"`、**`ime inputShown false → true`**（`dumpsys input_method`）、`visualViewport 842 → 530`（`innerHeight` 同步 842 → 530）、`activeElement=INPUT`                                                                        | `ACCEPTANCE-form.md`、`ACCEPTANCE-mobile.md` §4                      |
| A6  | 无障碍树与桌面门禁**逐条一致**：成员、属性、包含关系、`Tab` 焦点            | 14 个控制节点「恰好」、2 条包含关系（`region:按钮区域` 内 6 个 button、`group:字段区域` 内 2 个 textbox）、真实 `KEYCODE_TAB` 之后 `focused=普通按钮`（恰好 1 个）；复选框 `checked`、禁用按钮 `disabled`、滑杆 `valuenow=65`、字段 `invalid` 全部相符 | `ACCEPTANCE-a11y.md` §11                                             |
| A7  | 泄漏门禁：连续 5 次场景重启后 10 项计数不漂移，只剩 1 页存活                | `drifted=[]`、`alivePages=1`、样本 `themeListeners=59 displayList=1 sceneObjects=1 focusables=8 pointerTargets=14 textures=29 tweens=0 timers=0 widgets=57 frameListeners=11`                                                                          | `ACCEPTANCE-lifecycle.md`                                            |
| A8  | 全程无页面错误、无 console error、无「拼错的选项」警告                      | 走过 9 个场景：`pageErrors=0 consoleErrors=0 unknownOptions=0`                                                                                                                                                                                         | AGENTS §6、`ACCEPTANCE-options.md`                                   |

### 3.1 A5 补上了仓库里挂得最久的那条"只能在真机上验"

`ACCEPTANCE-form.md` 与 `ACCEPTANCE-mobile.md` §4 一直写着「软键盘是否弹出只能在真机上验」。本轮在 Android 上把它量成了三件事：① 系统输入法确实被拉起（`mInputShown false → true`，设备侧读数，不是页面能自证的）；② `Scale.RESIZE` 下视口**真的被顶起来**（842 → 530，正好是键盘高度），页面因此重排 —— 这正是文档里担心的那条"可能与固定布局打架"，至少在这台设备上表现为**正常重排而不是压坏**；③ 输入经由隐藏 DOM 桥到达控件（`activeElement=INPUT`、`form.values().name="android"`）。

### 3.2 A6 不复制期望清单

A6 的期望表是从 [`scripts/visual-check.mjs`](../scripts/visual-check.mjs) 的 `AX_EXPECTATIONS.a11y` / `AX_STRUCTURE_EXPECTATIONS.a11y` / `AX_CONTROL_ROLES` **文本解析**出来的（连 `SCENE_SETUP.a11y` 的 `validate(); setVolume(65)` 也照做），所以桌面门禁改了期望、Android 门禁跟着改 —— **不存在第二份会漂移的清单**。解析器自带自检：漏解一条会在「恰好 14 个控制节点」这条硬断言上当场变红（本轮就是这么发现解析器被注释里的 `node's` 撇号带偏的）。

## 4. 阳性对照与门禁韧性

- **失败会红**：第一轮矩阵跑出 `5/8`，三项失败（A1 的 `size` 正则不接受小数、A2 断言 `ActivationSource === 'pointer'` 而真机报 `touch`、A6 用了自己的角色集把 `group` 也数进控制节点）——**三项都是门禁自身的错**，应用侧读数一直是对的。修的是门禁，不是应用；修完 9/9。
- **读数不会被"看起来对"糊弄**：A2 会依次尝试候选的设备坐标系原点（WebView 自报矩形 → `dumpsys` 窗口 frame → `mStableInsets.top` → 屏幕原点），**要求应用真的产生一次激活**才算命中 —— 否则"点空了"和"坐标错"无法区分。
- **A9 用的是设备帧缓冲**：`#0d1117`（相机背景）与 `#05070a`（页面底色）是刻意不同的两个色，所以"表面没画出来"会读成后者而不是碰巧相似的颜色。
- **A7 有真实副作用**：`window.lifecycle.churn(5)` 会**真的重启场景 5 次**（样本 `cycle` 走到 6），不是读计数快照。

## 5. 已知边界（模拟器 ≠ 物理设备）

1. **物理设备未跑**。模拟器覆盖不到：GPU/驱动差异（这里是 swiftshader 软件渲染，绝对帧率没有意义）、厂商 IME 与输入法行为、真机挖孔/手势条（本机 `safeArea` 全 0，因为 Pixel 6 profile 没有挖孔）、真实触摸硬件的抖动与多点差异。
2. **帧率未测**：`ACCEPTANCE-list.md` 的"真机帧率"一条**仍未做** —— 软件渲染的模拟器量不出可信的吞吐，这条要物理设备。
3. **手柄与真实屏幕阅读器不在范围**（PLAN §1.2）：手柄仍由假手柄夹具 + Node 单测覆盖，无障碍证据是 CDP 算出的可访问性树（桌面与 Android 两侧同一套期望）。
4. **Cordova 只是承载壳**：它不改变框架语义；本轮所有断言都读应用自己的探针，换壳（Capacitor/原生 WebView）应当同样成立，但**没有验过**。
5. **桌面门禁不受影响**：`node scripts/visual-check.mjs` 仍是像素与 AX 的常驻门禁（13 个场景、96 个像素检查 + 4 张 AX 表），本记录不替代它。

## 6. 与其它门禁的关系

| 门禁                              | 覆盖                                              | 与本文的关系                                     |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `scripts/visual-check.mjs`        | 桌面 Chrome：几何 + 像素 + AX 树                  | 期望表的**来源**；Android 侧复用它的期望，不复制 |
| `scripts/android-check.mjs`（新） | Android 模拟器：真实触摸 / IME / AX / 泄漏 / 像素 | 本记录的执行体；`verify` 全绿 = 9/9              |
| `pnpm -r run test`                | 1377 条 Node 单测                                 | 纯逻辑层；Android 侧验的是"在真设备上还成立"     |
| `#/lifecycle` 的 `churn()`        | 浏览器侧泄漏门禁                                  | A7 在 Android 上重跑同一套计数                   |

## 7. 提交

- 提交信息：`test(android): an emulator acceptance gate through Cordova`（正文列出 9 项判据与两次失败的门禁修正）。
- 提交前门禁：`pnpm exec prettier --check .`、`pnpm docs:check`、`pnpm api:check`、`pnpm -r run typecheck`、`pnpm -r run test` 全绿；Android 侧 `node scripts/android-check.mjs verify` 9/9。
