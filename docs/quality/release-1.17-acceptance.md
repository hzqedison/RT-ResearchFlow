# 1.17 发布验收

结论：组合资金回测可以随统一产品正式发布，不等于全部量化功能、真实成交或所有历史升级组合已经验收。

应用源码及标签：`7c303ce8577e5fcb1acc84d170959aaad8597bec`、`v1.17.0`。正式发布 ID `409957308`，非草稿、非预发布，最新版本指向 1.17；十个附件已由 GitHub 服务器确认。发布复用已验收原文件，没有重新构建应用或覆盖历史包。

## 实际证据

- [三端原生验收 38179126559](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38179126559)：Windows x64 5 分 15 秒、Mac Apple 7 分 14 秒、Mac Intel 11 分 53 秒，均成功。真实原生程序检查启动、扩展首次安装、系统凭证存储、账户账本和共享资金报告持久化；三份原生证明的 `localPortfolioSimulationPersistenceVerified` 均为 true。
- [Windows 安装生命周期 38179149373](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38179149373)：默认非系统盘路径、同目录重装保留数据、卸载保留数据、共享 Python 不变通过；使用相同 Windows 文件摘要及源码。隔离同版本重装不代表所有历史升级组合。
- [同字节发布 38180020855](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38180020855)：成功核对源码、三端证明、安装生命周期和文件摘要后正式发布。
- 本地资金引擎 23、实际 SQLite 服务 8、可信 IPC 3，共 34 项测试通过。Node/Web 类型检查、生产构建及 Windows 打包目录生成成功。
- 本地实际候选程序的账本、共享资金回测、启动/设置/退出三项通过（40.4 秒），初始化兼容一项通过（9.3 秒）。夹具在隔离用户目录，不写生产账户或券商。
- 首轮负现金边界、测试导入与语法失败保留在[候选记录](capital-1.17-candidate.md)，修复后实际重跑通过。初始化漏设隔离标志时保护正常拒绝，未降低保护。
- 本机自动覆盖安装命令被环境策略拦截，未执行；`D:/Program Files/RT-ResearchFlow` 不能报告为已升级。没有本轮生产安装前后数据摘要或启动结果，也没有清理共享 C 盘 Python。
- 本地无配置的 pre-commit hook；显式类型、测试和差异空白检查已执行，提交未绕过现有 hook。

## 安装包摘要

| 安装包 | 字节数 | SHA256 |
|---|---:|---|
| RT-ResearchFlow-Setup-1.17.0-x64.exe | 176019693 | 9af002122c2c0a70e5223cc7fbc694c8b389943b03e5006b469fd6827c6ee321 |
| RT-ResearchFlow-macOS-1.17.0-arm64.dmg | 201806708 | e3f34b6d12df70d89f25e39a1571e15e30026aeed16f3032eeaf5181a41d3500 |
| RT-ResearchFlow-macOS-1.17.0-x64.dmg | 209904786 | df0fd31584efed54a06e7e405b008aff58e35394d7afebac4aca1e6bcf949994 |

## 验证边界

Tushare Key 入口位于配置中心的数据源页，不被免费来源隐藏。暂无有效用户 Key，未验证真实线上认证或付费接口权限。原生凭证测试使用合成密钥与回环服务器，并非真实数据源账号。

资金回测为人民币研究模型，资金、单位、费用、滑点与日线撮合为明示假设。缺失市值不伪造，观察到未支持的公司行动时停止；缓存价格口径和历史信号当时可得性仍未完整核验。没有连接真实券商或提交订单，没有 Apple 公证、全部交易客户端兼容或零缺陷保证。完整 OpenSpec 5.3 保持未完成。
