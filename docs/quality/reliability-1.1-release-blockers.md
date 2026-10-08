# 1.1 数据可靠性发布阻断清单

记录日期：2026-10-08。当前版本仍为开发中的 1.1.0，本文不表示安装包已经发布。以下检查使用临时 SQLite 或内存数据库、虚构行情及模拟提供方，不读取用户账户、持仓或密钥，不提交订单。

## 已修复并通过对应测试的阻塞

| 问题 | 实际证据 | 修复要求 |
| --- | --- | --- |
| 远期孤立记录掩盖日历缺口 | 已改为逐日检查交易日历覆盖，不以最大日期代替完整性 | `tradeCalSync.service` 与 `officialSseCalendar.integration` 对应测试通过；补充日期遵从已有闭市数据，不跨越缺口推断 |
| 新补入日期的前驱错误 | 显式 `null` 前驱保留为未知；新日期前驱按已有有效开市记录确定 | 同上，两组测试合计 30 项在 Electron 实际通过 |
| 未来基准数据被误判为可用或误报质量问题 | 按 `asOf` 排除未来日期后计算质量；仅有未来数据不再误报覆盖/新鲜度 | `benchmarkAsOfQuality` 4 项与 `dataQuality.service` 5 项通过，合计 9 项 |

## 本轮相关测试与检查结果

- 日历两组测试共 30 项通过；相关四文件 ESLint 通过。
- 基准质量 9 项通过；目标 ESLint 与 Node 类型检查通过。
- 诊断质量快照刷新相关 `diagnostics.dataQualityActions` 5 项、`diagnostics.dailyCloseQuality` 2 项、`supportDiagnosticsPreload` 1 项通过，共 8 项。成功、`empty`、失败路径均先持久化快照；无 Token 仍可用官方年度日历。
- 此前 1115 项通过、1 项跳过的隔离主可靠性测试，以及更新器 24 项测试是历史证据，不与本轮相加作为全部当前状态的通过结论。
- 更新页中文错误提示已完成，相关 4 项隔离检查通过。这些检查并不覆盖真实界面、下载网络、安装或升级。
- 当前源码完整生产构建（`electron-vite`、research-access Vite、size report）退出码 0。真实 Electron `runtime-reliability` E2E 最终 1 项通过（22.9 秒）。首次失败是测试脚本在 Playwright 销毁后调用 `running.process()`；缓存关闭前 process 对象后重跑通过。
- E2E 在隔离 K 盘 profile、阻断 HTTP、无交易条件下，通过 UI 启动、无 Key 的 DeepSeek 配置保存、真实 IPC 诊断错误关联 ID、脱敏预览/本地导出一致、正常退出进程码 0、同 profile 重启保留配置、旧 in-memory 事件不跨重启及二次正常退出。此证据仅覆盖这些明确场景。
- 当前源码 Node 与 Web 类型检查、目标 lint、完整生产 build 均退出码 0。首次全量为 251 文件（249 passed/2 failed）、2345 项（2339 passed/3 failed/3 skipped），594.71 秒；3 项失败均为旧文本契约（`afterCloseScheduler.contract` 2 项、`zeroKeyFirstValue.contract` 1 项）。
- 仅改两个测试文件为 TypeScript 语法树识别函数/受信 IPC，保留代次扫描仅替换自身、不依赖 Token 的盘后补漏、可信窗口通道、免费数据 fallback 行为断言，未削弱或跳过。两个契约文件加 `trustedIpcHandlers`、`schedulerGenerationProtection` 共 4 文件 1001 项通过（3.89 秒），相关测试 lint 通过。未重跑完整 251 文件，不宣称单次全量全绿；生产源码字节不变。
- Windows electron-builder 1.1.0 候选 EXE 构建退出码 0。K 盘临时目录中的 `win-unpacked`（排除原 `data`）运行 `packaged-app-smoke` 与 `windows-integrated-app` 共 2 项通过（26.4 秒），覆盖版本、无 Key AI 保存、SQLite 沙箱、非 Mac 交易禁用；不构成 NSIS 安装/覆盖升级证据。本机生产 app、用户数据及账户未动。
- 发布管线的三平台同 tag 原生构建、隔离安装、原字节发布门禁仅通过离线语法验证，尚未云端执行。Windows 覆盖安装/升级、Mac Apple Silicon 与 Intel 设备验收以及 1.1 发布仍未完成；上述结果也不证明实盘可用。

## 仍需完成的验收

1. 已完成本轮真实 Electron E2E 所覆盖的界面启动、诊断错误关联、脱敏预览/导出、配置重启保留及退出场景；未覆盖范围仍须单独验收。
2. 当前源码完整生产构建已完成且退出码 0；首次全量有 3 项旧文本契约失败，定向 4 文件回归通过，但未重跑完整套件，不能标记全量全绿。
3. 对 Windows、Mac Apple Silicon 和 Mac Intel 安装包分别验收，并检查覆盖升级、避免另装一份应用及用户数据保留。当前 Windows 仅有候选 EXE 与隔离目录打包程序测试证据。
4. 完成上述平台验收后再评估 1.1 放行；1.1.0 未发布，继续复用同版本号。

修复与验收完成前，不能将 1.1 标为可交付版本，也不能将旧 1.0 安装包重命名为 1.1。测试者已交付的 1.0 与当前开发工作分开管理。

## 官方年度数据核对

内置休市区间、公告复市日和明确列出的补班周末，已与以下一手公告逐项核对一致：

- [上交所 2024 年年度休市安排](https://www.sse.com.cn/disclosure/announcement/general/c/c_20231226_5733939.shtml)，2023-12-26 发布。
- [上交所 2025 年年度休市安排](https://www.sse.com.cn/disclosure/announcement/general/c/c_20241223_10767108.shtml)，2024-12-23 发布。
- [上交所 2026 年年度休市安排](https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml)，2025-12-22 发布。

核对仅证明年度计划与本地静态数据一致，不证明临时停市、个股停牌、竞价行情、其他交易所安排或真实交易权限。不能把实际全年计划解释为临时休市，也不能声称所有证券均已验证。
