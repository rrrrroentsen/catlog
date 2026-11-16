# CatLog 猫咪日志：开发和测试工具

这个文件夹是改代码、跑测试用的。平时使用不需要它，部署只用发布包。

## 目录

- `app/`：发布包的内容，和 GitHub Pages 上的文件一模一样（16 个文件，平铺）。
- `src/`：`app/app.js` 的七段源码。改界面改这里，然后 `node dev/build.js` 拼回去。
  - `00-guard.js` 打开页面时先对版本：`app.js` 和 `core.js` 不是同一版就不往下跑（见下面「升级」）
  - `10-base.js` 环境、本机存储、状态、图标
  - `20-sync.js` 同步、离线队列、照片和文件的上传和缓存
  - `30-demo.js` 演示模式（浏览器里的假后端、示例数据、画出来的猫）
  - `40-views.js` 各个页面
  - `50-sheets.js` 面板、表单、看大图
  - `60-actions.js` 点击和输入、启动
- `app/core.js`：计算和数据规则，不碰界面，Node 里可以直接 `require`。
- `app/charts.js`：体重曲线。
- `app/Code.gs`：后端。
- `dev/`：构建和测试。
  - `dev/fixtures/`：上一个版本的东西，升级测试要用。`Code-1.0.0.gs` 是 1.0.0 的后端，`web-1.0.0/` 是 1.0.0 发布包里的网页文件（原样，不要改）。
- `tools/`：生成图标和字体的脚本。

## 常用命令

需要 Node 18 以上和 Playwright（`npm i playwright && npx playwright install chromium`）。

```
node dev/build.js            # 把 src/ 拼成 app/app.js，顺便查看不见的字符和撞名
node dev/test-core.js        # core.js 的单元测试
node dev/test-backend.js     # 后端：在模拟的 Apps Script 环境里跑真实的 Code.gs
node dev/test-e2e.js         # 端到端：Chromium 模拟两部 iPhone + 模拟后端
node dev/test-e2e.js 离线     # 只跑名字里带「离线」的
node dev/build-preview.js    # 生成单文件的预览版（preview/catlog-preview.html）
node dev/test-preview.js     # 预览版的测试
node dev/mutate.js           # 故意改坏 97 处，看测试能不能抓到（全部跑完要十几分钟；node dev/mutate.js 17 31 只跑第 17、31 条）
node dev/server.js           # 本地开着看：打印页面地址和两条接上模拟后端的初始化链接
node dev/shots.js light      # 截图到 shots/
```

测试别的文件夹里的发布包（比如解压出来的）：`CATLOG_APP=/那个/文件夹 node dev/test-e2e.js`。

## 测试环境是怎么搭的

- `dev/gas-mock.js` 模拟 Apps Script：表格（按「用户输入」的方式转换格子内容、纯文本格式、单格 5 万字上限、等号开头变公式）、脚本属性、锁、缓存、Drive 文件夹和文件、Utilities、弹窗和菜单。每次请求都重新跑一遍 `Code.gs`，和真实环境一样没有跨请求的全局状态。
- `dev/server.js` 开三个端口，模仿三个域名：网页（放在 `/catlog/` 子路径下）、接口（POST 后回 302，不处理 OPTIONS）、回显（给结果）。
- 这些都是模拟：Chromium 不是 Safari，模拟的表格不是真的 Google 表格。

## 改代码时值得留意的

- 写文件的工具有时会把「反斜杠 u 加四位十六进制」的转义直接写成那个字符。源码里不要写这种转义，需要时用 `String.fromCharCode`。`dev/build.js` 会检查。
- `src/` 里顶层的函数名不要和浏览器自带的全局名字撞上（曾经有个叫 `history` 的函数把 `history.replaceState` 挡住了）。`dev/build.js` 会检查常见的那些。
- 同一个 github.io 域名下还有别的工具：本机存储的键都带 `catlog:` 前缀，IndexedDB 叫 `catlog`，离线缓存叫 `catlog-cache-v1`，都有测试看着。
- 表格的列名 `value` 已经被 `settings` 表用作文字；数字列用别的名字（体重是 `kg`）。数字列登记在 `Code.gs` 的 `NUM_COLS` 里，按列名而不是按表区分。
- 预览版里没有「打开 / 保存文件」的代码：`/*<save>*/ … /*</save>*/` 之间的内容在构建预览版时去掉。
- 测试里比较页面元素要小心：`eq(await p.$(…), null)` 一旦对不上，Node 的 assert 会把句柄连着的整个浏览器对象展开来写报错，内存吃光，测试进程被系统直接杀掉，一句话都不留。`test-e2e.js` 的 `eq` 已经先把句柄换成一个记号再比；新写的测试不要绕过它直接用 `assert` 比句柄。

## 升级（加新功能时要想的）

1.1.0 是第一次升级，下面这些是为它加的，以后每次加表、加列都用得上：

- **版本号只写在两处**：`app/core.js` 的 `VERSION` 和 `app/Code.gs` 的 `VERSION`（`dev/pack.js` 会查两处一样）。`dev/build.js` 把 `core.js` 的版本号抄进 `app.js`（`BUILD`）。
- **新旧文件混在一起**：手机上可能 `app.js` 已经是新的、`core.js` 还是缓存里旧的（或者仓库里只传了一部分）。`00-guard.js` 在最前面比 `BUILD` 和 `CL.VERSION`：对不上就绕过缓存把几个文件重新取一遍、自动重新加载一次；还对不上就停在说明页。
- **新加的表**：登记在 `core.js` 的 `CL.TABLE_SINCE`（表名 → 从哪个版本起后端才认识）。旧后端收到不认识的表会回「收到了」然后什么也不做，所以网页在知道后端够新之前，不会把这些表的改动发出去（`20-sync.js` 的 `sendable`），先留在队列里，界面上提示「后端要先更新」。
- **新加的列**：加在 `Code.gs` 的 `TABLES` 和 `WRITABLE` 里就行，旧表格会在最右边自动补列；数字列还要登记 `NUM_COLS`（整数再登记 `INT_COLS`）。
- **演示数据**：加了新的示例就把 `60-actions.js` 的 `DEMO_SEED` 加一，并在 `30-demo.js` 的 `topUp` 里把新示例补进旧的演示数据（预览版的访客也是走这条路看到新示例的）。
- **升级测试**：`dev/fixtures/` 里放着上一个版本的后端和网页。端到端测试里有「从 1.0.0 升级网页」「升级时先换后端」「后端还是 1.0.0」「演示数据升级」「更新到一半」几项，用的是真的旧文件。发下一个版本之前，把这一版的发布包也存一份进 `dev/fixtures/`。
