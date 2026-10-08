# 1.1 可靠性证据摘要

## 已证实

- 本轮交易日历覆盖改为逐日检查；显式 `null` 前驱保留为未知；新补日期依照已有闭市数据处理，且不跨越数据缺口推断前驱。`tradeCalSync.service` 与 `officialSseCalendar.integration` 共 30 项测试已在 Electron 实际通过，相关四文件 ESLint 通过。
- 核心基准质量按 `asOf` 排除未来日期后再判定；仅有未来数据不再误报覆盖或新鲜度问题。`benchmarkAsOfQuality` 4 项与 `dataQuality.service` 5 项共 9 项测试通过，目标 ESLint 和 Node 类型检查通过。
- 诊断同步无论成功、`empty` 或失败，均先持久化刷新质量快照再返回或报错；无 Token 时仍可使用官方年度日历。`diagnostics.dataQualityActions` 5 项、`diagnostics.dailyCloseQuality` 2 项和 `supportDiagnosticsPreload` 1 项共 8 项刚通过。
- 当前源码完整生产构建（`electron-vite`、research-access Vite 与 size report）退出码 0。真实 Electron `runtime-reliability` E2E 最终 1 项通过（22.9 秒）。首次失败仅因测试脚本在 Playwright 销毁后调用 `running.process()`；缓存关闭前的 process 对象后重跑通过。
- 上述 E2E 使用隔离 K 盘 profile、阻断 HTTP 且不涉及交易，实际通过 UI 启动、无 Key 的 DeepSeek 配置保存、真实 IPC 诊断错误关联 ID、脱敏预览与本地导出一致、正常退出（进程码 0）、同 profile 重启后配置保留、旧 in-memory 事件不跨重启，以及二次正常退出。
- 当前源码 Node 与 Web 两类类型检查、目标 lint、完整生产 build 均退出码 0。首次全量测试为 251 个文件：249 passed、2 failed；2345 项：2339 passed、3 failed、3 skipped，用时 594.71 秒。3 项失败均为两个旧源文本契约文件：`afterCloseScheduler.contract` 2 项、`zeroKeyFirstValue.contract` 1 项。
- 仅修改上述两个测试文件，改用 TypeScript 语法树精确识别函数及受信 IPC 结构，并保留扫描仅替换自身代次、不依赖 Token 的盘后补漏、可信窗口通道和免费数据 fallback 等行为断言；未削弱或跳过断言。修复后这两个文件连同 `trustedIpcHandlers`、`schedulerGenerationProtection` 共 4 文件 1001 项通过（3.89 秒），相关测试文件 lint 通过。没有重跑完整 251 文件，因此不能称单次全量全绿；生产源码字节不变。
- Windows electron-builder 1.1.0 候选 EXE 构建退出码 0。将 `win-unpacked` 复制到 K 盘临时目录并排除原 `data` 后，`packaged-app-smoke` 与 `windows-integrated-app` 两项打包程序测试通过（26.4 秒），覆盖版本、无 Key AI 保存、SQLite 沙箱和非 Mac 交易禁用；不是 NSIS 安装或升级证明。本机生产 app、用户数据及账户未动。
- 发布管线新增三平台同 tag 原生构建、隔离安装及原字节发布门禁，目前仅离线语法验证，未云端执行。
- 先前隔离主可靠性测试 1115 项通过、1 项跳过，以及更新器 24 项测试通过，保留为历史证据；不可与本轮结果简单相加并宣称全部现状通过。
- 故障反馈仅保存在当前进程内，最多 64 条；记录为静态分类、UUID、时间、模块及白名单版本/系统信息。能力列表为空、`buildId` 为 `unknown`，不会自动上传，也不包含凭证、账户或路径。
- 已发布的 1.0 测试版本仍可供测试者使用：[GitHub v1.0.0](https://github.com/hzqedison/RT-ResearchFlow/releases/tag/v1.0.0)。

## 未通过或未验收

- 更新页 `openExternal` 返回类型适配和中文操作提示已修复；相关 4 项隔离检查通过，尚无真实界面验收结果。
- 本轮真实 Electron E2E 已覆盖并通过上述狭义运行时、诊断关联、脱敏预览/导出及 profile 重启行为；不据此宣称所有运行时或发布验收完成。
- 更新文件采用原子硬链接保存；不支持硬链接的下载目录会提示更换目录，没有退回可能留下半截安装包的复制方式。更新模块的隔离检查不代表所有外置盘或实际下载安装流程已验收。
- 调度等待仅覆盖已登记任务，不覆盖所有旧业务后台任务；退出时数据库保留到进程结束。因此不能称完整任务生命周期迁移已完成。
- 首次全量测试出现上述 3 项旧文本契约失败；定向修复回归通过，但完整 251 文件未重跑。Windows 候选 EXE 和隔离目录打包程序测试已通过，仍无 NSIS 安装/覆盖升级证据；Mac Apple Silicon 与 Intel 两架构验收，以及 1.1 发布均未完成。1.1.0 未发布，继续复用同一版本号。
- 构建完成不等同于安装、升级或端到端验收通过；本轮通过的隔离测试也不能证明实盘可用。
- 先前报告的三项日历/基准测试阻塞已修复并通过对应测试，详见 `reliability-1.1-release-blockers.md`；这不解除运行时、安装包或发布阻断。
