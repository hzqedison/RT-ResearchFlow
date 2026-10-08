# 1.0 交付基线

记录日期：2026-10-08。此记录把已交付产品与后续架构工作区分，便于测试反馈定位。

| 项目 | 已确认事实 |
| --- | --- |
| 展示版本 / 内部版本 | 1.0 / 1.0.0 |
| 发布状态 | GitHub 公开测试发布，非草稿 |
| 发布标签 | v1.0.0 |
| 应用源码 | 41f8429149f646c7dec7f1610082702e7d9cce48 |
| 成功发布流程提交 | 1d5fe3f0719fbcadce7a8c33881831707982bacc |
| Windows 安装测试来源 | Actions run 37653940356 |
| Mac 两架构安装测试来源 | Actions run 37659004838 的两个 build job 均成功；该次最后发布步骤失败，随后单独恢复 |
| 恢复发布记录 | Actions run 37662317820，结论 success；复用已测二进制 |

## 直接下载

| 系统 | 文件 | 字节数 |
| --- | --- | ---: |
| Windows x64 | [EXE](https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.0.0/RT-ResearchFlow-Setup-1.0.0-x64.exe) | 166547210 |
| Mac Apple 芯片 | [arm64 DMG](https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.0.0/RT-ResearchFlow-macOS-1.0.0-arm64.dmg) | 201578904 |
| Mac Intel | [x64 DMG](https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.0.0/RT-ResearchFlow-macOS-1.0.0-x64.dmg) | 209343420 |

[发布页](https://github.com/hzqedison/RT-ResearchFlow/releases/tag/v1.0.0) · [校验清单](https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.0.0/SHA256SUMS.txt) · [发布记录](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37662317820)

## 测试范围

三个产物有对应隔离安装与启动检查。真实同花顺、中信账户兼容性仍需账户本人设备上的去敏结果补充；不能将隔离检查扩大解释为实盘成功。

确认包不包含后续开发分支的更新下载、免 Key 日历接入或本轮架构基础模块。下一次运行行为迭代使用 1.1 / 1.1.0；不得覆盖本页记录的 1.0 安装包。
