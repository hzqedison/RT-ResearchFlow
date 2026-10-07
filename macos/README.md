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

自己的 Fork 的 `main` 应包含本次 Mac 适配；原仓库仍保持独立。
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

## 非交易功能测试版

测试版发布页：<https://github.com/hzqedison/RT-ResearchFlow/releases/tag/mac-preview-2026-10-07-f9efe4e>。
这是个人试用版本，不是已经接通真实自动下单的交易版本。发布页提供两个可直接下载的 DMG，不需要先登录 GitHub 下载构建附件。

1. 在“关于本机”查看芯片：Apple M 系列选择 `arm64.dmg`，Intel 选择 `x64.dmg`。
2. 打开 DMG，将应用拖入 Applications；首次启动如被系统阻止，只针对来源可信的该应用授权打开，不关闭系统安全保护。
3. 配置她自己的大模型 Key 和所需数据源。安装包保留原产品的非交易功能，但不附带个人配置、数据权限或真实账户资料。
4. 先测试启动、页面操作、设置保存、窗口重开与退出。量化引导页仅记录开通进度，不会因此解锁真实交易。

反馈只需给出：Apple/Intel、系统版本、哪个步骤成功/失败，以及去敏后的错误描述。
量化引导可导出受限字段的诊断结果；不要发送账号、密码、Key、资金、持仓、完整日志或个人数据库。
构建环境检查不等于已经验证全部真实行情接口与 AI 调用，仍需她本机配置后试用。

发布流程只在自己的 Fork 中运行，固定使用已通过双架构检查的源码与构建附件，先核对文件校验值再公开发布。不会访问她的 Mac 或个人数据，也不会重新构建未经测试的应用。
