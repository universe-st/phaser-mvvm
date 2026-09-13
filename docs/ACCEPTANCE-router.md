# 验收记录 · 路由表（`this.mvvm.router`，M8 收尾）

- **验收场**：[`#/router`](../../apps/examples/src/scenes/router.ts)（`window.routerDemo` 暴露全部探针）
- **被测实现**：[`packages/phaser/src/router.ts`](../../packages/phaser/src/router.ts)（`Router`）、[`packages/phaser/src/route-plan.ts`](../../packages/phaser/src/route-plan.ts)（纯匹配逻辑）、[`packages/phaser/src/plugin.ts`](../../packages/phaser/src/plugin.ts) 的 `get router()`
- **本轮（第 75 轮）新增**：`Router`（`routes`/`route()`/`navigate`/`replace`/`back`/`current`/`history`/`depth`/`dispose`）、`matchRoute`/`normalizeRoutePath`/`routeNames`/`routeParams`/`UnknownRouteError`、`RouterPageStack`/`RouterHost`（结构化宿主，让簿记逻辑可在 Node 单测）
- **验收方式**：Playwright MCP 真实鼠标 / 真实触摸（`Input.dispatchTouchEvent`）+ 真实 `Escape`，页面先 `bringToFront()`
- **测试**：`packages/phaser/test/route-plan.test.ts`（**16** 条）+ `packages/phaser/test/router.test.ts`（**16** 条）；全仓 `pnpm -r run test` = **1219 passed**（core 281 / layout 313 / phaser 284 / widgets 341）
- **体积**：min+gzip `core`+`layout` **18.5 KB**、`phaser`+`widgets` **24.6 KB**（预算 25 / 45）

---

## 1. 被测行为与判据

路由表只做一件事：把「哪一页」变成数据。所以每条判据都在问「这层数据有没有和真实的页面栈说一样的话」。

| #   | 行为             | 判据                                                                                                                                            |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 启动就是一条路由 | `navigate('home')` 之后 `current={key:'home',path:'home',params:{}}`、`depth=1`、页名 `route:home`                                              |
| R2  | 路径参数         | `navigate('user/42')` → `key='user/:id'`、`params={id:'42'}`、页面上的文字用的是这个 id                                                         |
| R3  | 显式参数合并     | `navigate('settings', { tab: 'profile' })` → `params={tab:'profile'}`（与路径捕获合并，显式优先）                                               |
| R4  | 字面量优先       | 表里同时有 `settings` 与 `settings/advanced` 时，`navigate('settings')` 命中前者、后者命中自己                                                  |
| R5  | 逐层历史         | `home → user/42 → user/42/posts` 时 `history` 的三项分别是 `home` / `user/42` / `user/42/posts`，`keys` 是模式串                                |
| R6  | 焦点跟着页       | 推入后 `focusables` 只剩新页的控件（`pages.push` 的既有行为，经路由不退化）                                                                     |
| R7  | 未知路由报错     | `navigate('nope/1')` 抛 `UnknownRouteError`，消息列出全部 key；**栈深度与 `current` 不变**（没有半推入状态）                                    |
| R8  | `replace` 换页   | 深度 2 时 `replace('settings/advanced')` 之后深度仍是 2、`history=[home, settings/advanced]`                                                    |
| R9  | `replace` 兜底   | 只剩基页（深度 1）时 `replace` 退化成推入（深度 2）——基页不能弹，这是 `PageHost` 的既有规则                                                     |
| R10 | 跟随真实栈       | 用 `pages.pop()` 直接弹页（不经过路由）后，`current`/`history` 立刻反映栈顶那一页的真实来源                                                     |
| R11 | 未受管的页       | 直接 `pages.push()` 的页面 `current` 为 `null`、不在 `history` 里，但 `depth` 照数                                                              |
| R12 | 运行时加路由     | `router.route('late', …)` 之后 `navigate('late')` 可用，原有 key 不丢                                                                           |
| R13 | 生命周期转发     | `navigate(path, params, { onResume, onDispose })` → 页面与 `pages.push` 一样收到回调（`resumes`/`disposes` 各 +1）                              |
| R14 | 每页状态独立     | 同一个 `user/:id` 的两次访问（`user/1`、`user/2`）各有自己的备注，来回切换互不覆盖                                                              |
| R15 | 真实输入         | 鼠标点 `pt.home.user.2` → `user/2`；点"他的帖子" → `user/2/posts`；点"返回" → `user/2`；`Esc` → `home`；基页再按 `Esc` 到应用层（`appBacks=1`） |
| R16 | 触摸             | 触摸点 `home.user.3` → 进入 `user/3`（与鼠标同一条路径）                                                                                        |
| R17 | 泄漏             | `churn(30)`（每次推入再弹出）前后四类计数一致，`history` 回到 `[home]`，深度回到 1                                                              |
| R18 | 探针只指可见页   | 被盖住的页仍然是活的，但它的 `pt.*` 必须变成 `gone`（否则验收会点到看不见的控件）                                                               |

---

## 2. 实测（第 75 轮，全部为本机实跑数字）

### R1–R5 表、参数与历史

```
启动               { path: 'home', key: 'home', params: {}, depth: 1, names: ['route:home'], focus: 'none' }
表（5 条）          home, user/:id, user/:id/posts, settings, settings/advanced
navigate('user/42')→ { path: 'user/42', key: 'user/:id', params: { id: '42' }, depth: 2 }
  focusables        ['user.field', 'user.posts', 'user.next', 'user.back']   // 只剩新页
  page name         'route:user/42'
→ 'user/42/posts'  { path: 'user/42/posts', key: 'user/:id/posts', params: { id: '42' }, depth: 3 }
  history           ['home', 'user/42', 'user/42/posts']
  keys              ['home', 'user/:id', 'user/:id/posts']
back()             { path: 'user/42', depth: 2 }，history ['home', 'user/42']
```

### R3/R4 参数与优先级

`navigate('settings', { tab: 'profile' })` → `key='settings'`、`params={tab:'profile'}`；随后 `navigate('settings/advanced')` → `key='settings/advanced'`、`params={}`（两条都是字面量 key，各自的参数互不串味）。

### R7 未知路由

```
window.routerDemo.unknown('nope/1')
→ 'UnknownRouteError: Unknown route "nope/1" — the table has: home, user/:id, user/:id/posts,
   settings, settings/advanced. Add it to `this.mvvm.router.routes`, or check the spelling.'
navigate 前后：depth 2 → 2，current 仍是 user/42（没有半推入状态）
```

### R8/R9 `replace`

```
深度 2：popToRoot → navigate('user/3')（depth 2）→ replace('settings/advanced')
        → depth 2，history ['home', 'settings/advanced']
深度 1：popToRoot（depth 1）→ replace('settings/advanced') → depth 2（退化为推入，已记录）
```

### R10/R11 跟随真实栈

```
navigate('settings/advanced')（depth 2）→ navigate('user/7')（depth 3）→ pages.pop()（depth 2）
→ current = { path: 'settings/advanced', key: 'settings/advanced' }     // 路由没被告知，自己算对了
直接 pages.push() 的页面：current = null，history 不含它，depth 照数
```

### R13 生命周期转发

```
popToRoot → navigateWithLifecycle('user/9') → back()
route.resumes = 1，route.disposes = 1     // 与 pages.push 的 onResume/onDispose 行为一致
```

### R14 每页状态独立

```
navigate('user/1') → note('user/1') = ''
setNote('user/1', '一号的草稿') → navigate('user/2')
  note('user/2') = ''，note('user/1') = '一号的草稿'，history ['home','user/1','user/2']
setNote('user/2', '二号的草稿') → back()
  current = user/1，页面上是「一号的草稿」，note('user/2') 仍是「二号的草稿」
```

### R15/R16 真实输入（鼠标 / 键盘 / 触摸）

```
鼠标 click pt.home.user.2      → user/2（params id:2），home 的探针全部 gone
鼠标 click pt.user.posts       → user/2/posts（depth 3，history 三项）
鼠标 click pt.posts.back       → user/2（depth 2）
Escape                         → home（depth 1，history ['home']）
基页再 Escape                  → route.appBacks = 1（`back` 逐层路由的最后一层仍是应用）
触摸 tap  pt.home.user.3       → user/3（`Input.dispatchTouchEvent`，一次验收只用一种输入设备）
全程 0 个 pageerror
```

### R17 泄漏

```
churn(30) before { widgets: 14, themeListeners: 16, pointerTargets: 9, focusables: 8 }
          after  { widgets: 14, themeListeners: 16, pointerTargets: 9, focusables: 8 }
churn 之后 depth 1、history ['home']、route.visited 32
```

### R18 探针与可见页

`#demo-state` 的 `pt.<key>` 只对**可见页**里的控件给坐标（走 `parentContainer` 链判断是否在 `pages.top` 的子树里），其余为 `gone`：

```
home          pt.home.user.2=@494,434      pt.user.posts=gone        pt.posts.back=gone
user/2        pt.home.user.2=gone          pt.user.posts=@445,418    pt.posts.back=gone
user/2/posts  pt.home.user.2=gone          pt.user.posts=gone        pt.posts.back=@459,392
```

> **验收技巧（本轮踩过一次）**：`#demo-state` 是**逐帧**写入的，所以输入之后立刻读会拿到上一帧的值——第 75 轮第一次跑"点返回"时看到深度没变、`appBacks` 还是 0，差点当成缺陷。正确做法是**等一帧**（`requestAnimationFrame` 两次）或用场景 API 按需计算（`window.routerDemo.point(name)` 会现算）。AGENTS.md §6 早有这条规矩，这里再记一次。

---

## 3. 单元测试（Node，无渲染器）

- **`route-plan.test.ts`（16 条）**：路径归一化、字面量命中、`:参数` 捕获与解码、**字面量优先于模式**、两个模式都匹配时**取声明在前**的、长度/字面量不匹配、空段不吞成参数、`constructor`/`toString`/`__proto__`/`hasOwnProperty`/`valueOf` 一律不命中（表里显式声明了才算）、显式参数覆盖路径参数、参数字典被冻结、`routeNames` 顺序、`routeParams` 是转换而非检查、`UnknownRouteError` 的字段与消息（空表也会说 `(empty)`）。
- **`router.test.ts`（16 条）**：`Router` 接受**结构化宿主**（`RouterHost`），所以整层簿记都在 Node 里跑——推入的页名是 `route:<path>`、视图拿到参数、未知路由抛错且**不推页**、别人弹页后 `current`/`history` 跟上、未被路由打开的页面 `current=null` 但 `depth` 照数、`history` 跳过未受管的页、`replace` 换页与兜底推入、**500 次推入/弹出后 `history` 仍只有 1 项**、**只读 `current` 也照样回收**（下面这条缺陷）、`options` 转发（`name` 仍由路由表给）、逐条注册与整表替换、路径归一化、`dispose()` 只清簿记不动页面、空表报 `(empty)`。

### 同轮修掉的实现缺陷（V41）

写假栈测试时发现的：`visits` 这张 `Map` 原来只在读 `history` 时清理，而 `current` 不清理——一个只 `navigate`/`back`、从不读 `history` 的应用会一直攒死条目（每轮 1 条）。修法是加 `prune()`，在 `open()`/`back()`/`current`/`history` 四处都调；`router.test.ts` 里两条用例把它钉住（500 次循环后 `history` 长度 1；只读 `current` 时内部 `visits.size` 也是 1）。登记在 [`DEFECT-BACKLOG.md`](./DEFECT-BACKLOG.md) §3.19。

### 同轮修掉的门禁缺口（不是产品缺陷，但同样会骗人）

`scripts/check-doc-snippets.mjs` 只把 `名字(` 当成调用，所以**带类型实参的调用**（`routeParams<{ id: string }>(params)`）根本没被扫描——本轮在指南里故意把 `routeParams` 改成 `routeParamsTYPO<…>`，`pnpm docs:check` 照样报 ok。补了一遍宽松正则（支持一层嵌套泛型），现在同样的错会报 `unknown: routeParamsTYPO`。

---

## 4. 未覆盖 / 有意不做

- **URL 路由 / 深链接**：PLAN 明确不做。`Router` 从不读 `location`，没有历史条目，浏览器后退键不会离开页面（示例应用里改哈希会整页重载，这是示例自己的约定）。
- **通配符、可选段、查询串、类型化参数**：不做。路由是「名字 + 字符串参数」，需要更多就该由应用自己解析。`routeParams<T>()` 只解决类型层的可选性问题，不做运行时校验。
- **守卫 / 重定向 / 懒加载**：不做。要拦一次导航就在 `navigate()` 之前判断——那是普通代码，框架不必发明 API。
- **页面转场（推入/弹出的动画）**：**已交付（第 78 轮）**——`RouteOptions = Omit<PageOptions, 'name'>`，`navigate()` 直接把选项交给 `pages.push()`，所以每次导航都走 `page-motion.ts` 的默认进出场（`PageOptions.transition` 可逐条覆盖），实测见 [`ACCEPTANCE-pages.md`](./ACCEPTANCE-pages.md) §5。路由自己不做第二套动效。
- **像素门禁**：`#/router` 没进 `scripts/visual-check.mjs` 的场景列表——首页由已被像素断言覆盖过的控件（`Panel`/`Button`/`TextField`/`Text`）组成，新增采样点不会带来新信息；它的几何仍写进 `#status`，行为由本文件的矩阵覆盖。
- **真机**：触摸用 CDP 触摸域验证（与 [`ACCEPTANCE-touch.md`](./ACCEPTANCE-touch.md) 同一套做法），**Android 上没跑本页**（第 112 轮的门禁走的是 `showcase`/`states`/`list`/`config`/`form`/`a11y`/`lifecycle`，见 [`ACCEPTANCE-android.md`](./ACCEPTANCE-android.md)）；物理设备未跑。
