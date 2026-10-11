# 1.15 正式发布验收

公开版本：[v1.15.0](https://github.com/hzqedison/RT-ResearchFlow/releases/tag/v1.15.0)。GitHub Release `409918034`，已核对 `draft=false`、`prerelease=false`，应用源码及标签目标为 `b37a607595ff74030dfd446c0abc4d2f0aabbee1`。后续仅文档提交不是安装包源码。

## 放行证据

- [三端原生构建和安装检查 38173406278](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38173406278)：Windows x64、Mac arm64、Mac x64 均成功。
- [Windows 生命周期 38174045304](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38174045304)：复用该 Windows EXE，默认非系统盘安装、同目录重装保留合成数据、卸载保留数据和共享 Python 未变均成功；不是所有历史版本的跨版升级证明。
- [复用产物发布 38174389428](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/38174389428)：不重新构建，核对来源、运行编号、每个产物本地 SHA256 和 GitHub 公开附件摘要，再公开同一批字节。
- 源码侧七个定向文件 64 项、Node/Web 类型检查和生产构建通过。本地候选实际 UI 两项通过（18.4 秒），不是 NSIS 安装证据。
- 本机覆盖安装后版本为 `1.15.0.0`，六个数据库/配置文件安装前后摘要一致；已安装程序启动、设置及正常退出一项通过（13.7 秒）。本地原始快照留在 D 盘私有验收目录，不提交用户配置或数据库。
- 原生产物含实际系统凭证存储、重启、读取和清除检查；使用合成无效 Key，不能推断任何供应商的在线认证。发布时每份原生验收记录仍保持 `published=false`，因为它记录的是发布前验收；公开状态由 Release API 证明，不能改写原有记录。

## 公开安装包字节

| 安装包 | 字节数 | SHA256 |
| --- | ---: | --- |
| RT-ResearchFlow-Setup-1.15.0-x64.exe | 175944958 | b89742c066d96522f78fd1fe8f52ca944d8c72034117a1575742b385092d1659 |
| RT-ResearchFlow-macOS-1.15.0-arm64.dmg | 201802764 | 135e98c597701d0178f14e31dddc02134bd3aefebe49beb28dfc8be8baefa666 |
| RT-ResearchFlow-macOS-1.15.0-x64.dmg | 209898660 | 14fce795a78a70efccc5f926b852e99d56cf8b3e7ee3a4d015ba6f9273b47e46 |

## 结论及未验证范围

放行 1.15 的数据范围一致性改进及对应三端安装包，不表示整体产品目标已经完成。完整短线策略数据、账户账本、资金约束组合回测、全部历史版本升级、Apple 公证和真实同花顺/中信客户端兼容仍未全面验收。本轮未提供有效 Tushare Key、未操作真实账户、未提交订单。共享 C 盘 Python 没有删除，历史清理事项没有据此冒充完成。
