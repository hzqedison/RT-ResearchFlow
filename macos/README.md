# macOS 安装与源码编译

产品介绍见[首页](../README.md)。当前产品源码版本为 **1.0**，内部构建编号为 **1.0.0**；安装包以[GitHub 发布页](https://github.com/hzqedison/RT-ResearchFlow/releases)实际附件为准。

## 安装

最低 macOS 12。Apple 芯片下载 `arm64.dmg`，Intel 下载 `x64.dmg`。直接打开 DMG，将应用放入 Applications；升级时替换原应用，不选择保留多个副本，也不要删除用户数据目录。

安装包无需单独安装 Node.js、pnpm 或 SQLite。通达信、AKShare、i问财等可选扩展有独立依赖，见[数据源说明](../docs/data-sources.md)。

当前测试构建未配置 Apple Developer ID 签名或公证。遇到系统拦截时，确认下载来源后使用“系统设置 > 隐私与安全性”对单个应用授权，不全局关闭 Gatekeeper。

## 数据与退出

数据保存在本机用户数据目录，不写进应用包。更新前备份，替换应用时保留数据与配置；具体路径以诊断显示为准。

关闭最后一个窗口后可以从 Dock 重新打开；彻底退出使用 `Command+Q`。交易授权在重启后关闭，结果未知的重复请求保护不会因此自动解除。交易范围和去敏反馈流程见[交易说明](../docs/trading.md)。

## 从源码运行

完整产品源码使用 `codex/macos-support` 分支；分支名是开发沿用名称，不代表另一款 Mac 专属产品。Windows 与 Mac 的产品版本一致。

需要 Node.js 20、pnpm 10.14.0 和 Xcode Command Line Tools：

```sh
xcode-select --install
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm install --frozen-lockfile
pnpm run dev
```

在目标架构 Mac 上打包：

```sh
node macos/build.mjs
```

生成的 DMG 和 ZIP 位于 `release/`，不能复用 Windows 的 `node_modules` 或 SQLite 原生文件。发布页向普通用户提供直接可安装的 DMG，不要求下载构建产物 ZIP。

## 构建检查

```sh
node --test macos/sync-upstream.test.mjs
pnpm run verify
```

原生构建流程分别检查两种架构、DMG 安装、SQLite、设置、窗口恢复及退出。使用隔离数据，不读取个人 Key，不连接券商账户、不提交订单。这不能代替实际同花顺客户端兼容验证。

版本按 **1.0、1.1、1.2** 递进，内部对应 **1.0.0、1.1.0、1.2.0**，具体见[发布约定](../docs/versioning.md)。

<details>
<summary>维护者：基础代码同步</summary>

保留现有提交历史及许可证。origin 指向自己的仓库，upstream 用于基础代码更新，不强行覆盖本项目迭代。

```sh
git switch codex/macos-support
node macos/sync-upstream.mjs --check
node macos/sync-upstream.mjs --apply
pnpm install --frozen-lockfile
pnpm run verify
node macos/build.mjs
```

检查仅获取状态；应用更新使用普通合并，有未提交修改、分支错误、地址不符或冲突时会停止。定时同步只有在相关工作流合入默认分支并启用后才生效，不把尚未运行的工作流当作已完成同步。

来源与许可证统一见 [NOTICE](../NOTICE.md)。

</details>
