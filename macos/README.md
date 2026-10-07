# Mac 适配与上游同步

原仓库：<https://github.com/caoritian002-wq/RT-ResearchFlow>。
Mac 改动保存在独立分支 `codex/macos-support`，保留原仓库的提交历史，不复制成无法同步的新项目。

## 安装和编译

当前依赖 Electron 41，最低 macOS 12。Apple 芯片使用 `arm64` 包，Intel 使用 `x64` 包。
安装包不需要单独安装 Node.js、pnpm 或数据库。源码开发需要 Node.js 20、pnpm 10.14.0 和 Xcode Command Line Tools。

在 Mac 的项目目录执行：

```sh
xcode-select --install
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile
pnpm run dev
```

打包本机架构：

```sh
node macos/build.mjs
```

生成的 DMG 和 ZIP 位于 `release/`。必须在对应架构的 Mac 上编译，不能复用 Windows 的 `node_modules` 或 SQLite 原生文件。
GitHub Actions 的 `macOS build and smoke test` 分别使用 Apple Silicon 和 Intel Mac，生成两种架构的安装包；只有 DMG 安装、数据库、设置、窗口重开和退出检查通过后才上传安装包。
在成功的运行页面下载对应架构的 Artifacts，解压后打开 DMG，将应用拖入 Applications。

这是个人使用的临时签名版本，不是 Apple Developer ID 签名或公证版本。
从网络下载后可能遇到 Gatekeeper 提示：确认来源是自己的构建后，使用 macOS“系统设置 > 隐私与安全性”里的单个应用打开授权。
不要全局关闭 Gatekeeper，也不要把“临时签名通过”当作 Apple 公证通过。

## 数据与退出

Mac 数据使用 Electron 的用户目录（通常在 `~/Library/Application Support/`），不写入应用包。
换新版本时替换 `.app`，不要删除用户数据目录；设置和研究数据应保留。
关闭最后一个窗口后应用继续运行，可从 Dock 重新打开；彻底退出使用 `Command+Q`。
系统通知需要允许应用的通知权限。大模型和 Tushare Token 的含义与 Windows 版相同，Mac 适配不提供共享 Token。

## 本地同步原仓库

`origin` 应指向自己的 Fork，`upstream` 指向作者原仓库。
提交自己的改动后在适配分支执行：

```sh
git switch codex/macos-support
node macos/sync-upstream.mjs --check
node macos/sync-upstream.mjs --apply
pnpm install --frozen-lockfile
pnpm run verify
node macos/build.mjs
```

`--check` 只获取更新，不合并代码；`--apply` 使用普通合并，保留自己的提交。
有未提交改动、分支不对或 `upstream` 地址不符时会拒绝操作。
出现冲突时脚本停止，保留冲突供处理；解决并提交，或者用 `git merge --abort` 取消本次合并。不会强行覆盖自己的修改。
上游修改 Node.js、pnpm、Electron 或构建命令时，应同步检查 Mac 工作流和此目录，不要只合并源码后忽略依赖要求。

## GitHub 持续更新

Mac 适配开发位于 `codex/macos-support`，原仓库保持独立。相关更新工作流需合入自己的默认分支后，定时检查才会生效；不要把尚未合入的工作流视为已经运行。
在 Fork 的 Actions 页面启用工作流，并在 Settings > Actions > General 允许工作流创建 Pull Request。
`Check upstream for Mac fork` 每天检查一次，也可手动运行；有更新时创建合并 PR，并明确触发 Mac 和 Windows 检查。
PR 需要检查后合并，合并到自己的 `main` 后会再次生成 Mac 包。它不会自动解决冲突或覆盖魔改。
GitHub 定时任务可能延迟，长期没有活动时也可能暂停；急需同步时使用本地脚本或手动触发工作流。

## 验证范围

```sh
node --test macos/sync-upstream.test.mjs
pnpm run verify
```

本地 Windows 上的检查不能证明 Mac 安装包可用；应以两种架构的 Mac 构建和安装后冒烟测试结果为准。
Mac 冒烟测试使用 CI 临时账号与数据，不要求用户提供大模型密钥，不会访问个人数据库。

## 当前一体化版本

当前版本 v0.1.0-beta.5 将投研、AI、策略验证、量化开通与真实交易放在同一款应用里，不分成两个功能版本。Apple 芯片与 Intel 下载项只是同一应用的不同架构。

发布页：https://github.com/hzqedison/RT-ResearchFlow/releases/tag/v0.1.0-beta.5
完整产品说明见根目录 README.md。

从“量化开通 > 真实交易”进入，本人手动登录并选择中信账户，先检查连接和表单回读，再明确启用本次会话。每笔真实买卖和单笔撤单均须应用核对及主进程系统确认，系统默认取消；同花顺自己的弹窗仍由本人核对后确认或取消，不自动点击。

买卖受理不等于成交；单笔撤单不能撤销已成交部分。待本人确认、超时或回报不明时，重复请求被锁住；先到同花顺核对，再显式解除保护，不能自动重发。重启后交易授权关闭，但结果不明锁继续保留。

本版不是券商官方 API，也不是无人值守交易服务。尚未在她的当前同花顺版本与中信账户上验证真实受理或撤单成功；构建和隔离检查不提供此保证。数据源、AI Key 与券商权限仍由本人分别配置和核实。

只反馈去敏运行结果，不发送账号、密码、Key、资金、持仓、订单编号、确认凭据或原始日志。参考代码、原作者署名和开源许可保留，移除赞赏入口不改变原许可证。

## 版本递增

应用版本来自 package.json，不会随代码提交自动增加。新的测试发布递增 beta.N，同步应用版本、发布标签和文件名，不改名冒充新构建、不覆盖旧包。当前从 0.1.0-beta.4 递进到 0.1.0-beta.5。
