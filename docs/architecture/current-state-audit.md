# RT-ResearchFlow 源码架构现状盘点

日期：2026-10-08。角色：源码盘点执行者，供主代理制定目标架构；本文不代替最终架构决策。

任务提供的开发源基线：`ca6b9455bd27e6ec0ee775dc85a72ee5ce7061cb`。读取工作区：`K:\AI\person\money\RT-ResearchFlow`。按要求未使用 Git，因此未核实本地文件与该提交逐字一致；定位证据以本次实际读取的本地源码为准，主代理合并时须注意分支差异。

唯一写入文件为本报告。未修改运行代码、AGENTS、OpenSpec 或工作流，未运行测试、构建、应用、数据库查询或任何券商操作，未读取用户数据库、配置文件内容或密钥。文件内行号仅用于本次定位，后续改动应优先按函数和频道名定位。

## 1. 结论口径与范围

“已证实”表示源码可以直接证明结构或某个条件分支；不等于已在安装包中复现故障。“待运行验证”表示可能影响，需要研发自行在临时数据目录、假服务或离线环境验证。“架构改进”表示边界不清或维护成本，不应直接登记为线上 bug。

严重性为建议优先级：P1 涉及数据恢复、敏感操作边界或生命周期可靠性；P2 涉及常规功能、契约和诊断可靠性；P3 涉及维护性。此次没有足够证据登记已发生的 P0 故障。

阅读集中在 main/preload/renderer 入口、少量代表性 IPC、共享契约、数据库初始化和迁移执行器、配置保存、诊断、备份、调度和退出。大型文件只抽取相关段落；最初两组输出截断后，仅恢复缺失的关键证据。未穷尽所有 IPC 和数百项服务，不据此声称所有模块都缺少某项能力。

投组、策略和回测部分使用任务已有证据，没有重读 `portfolioRepository`、`portfolioDashboardService`、`strategyLabService`、`strategyLabRunService` 和 backtest 下 `types`、`tradeSimulator`、`credibility`、`strategyBacktestEngine`。

## 2. 入口与依赖现状

| 部位 | 路径 / 函数 | 已证实的职责和依赖 | 建议目标边界 / 优先级 |
| --- | --- | --- | --- |
| 主进程入口 | `electron/main/index.ts::bootstrap/createWindow/triggerAIAnalysisIfAvailable` | 初始化数据库、种子、研究访问服务，逐项注册业务 IPC，绑定扫描事件，创建窗口，启动心跳和清理，等待 renderer ready 后补漏和启动调度；入口还执行资讯评级筛选和 AI 配置/密钥可用性判定 | 入口保留组合与生命周期，业务判断移交对应应用服务，P2 |
| 窗口权限 | `electron/main/security/navigationPolicy.ts`；`index.ts::createWindow` | sandbox、contextIsolation 开启，Node 和 webview 关闭；拒绝 renderer 权限；限制导航；新窗口被拒绝，符合规则的 HTTP(S) URL 转外部浏览器 | 保留现有防护，将窗口身份检查与 IPC 授权统一，P1 |
| Preload | `electron/preload/index.ts::api`，末尾 `contextBridge.exposeInMainWorld('api', api)` | 约 4151 行，集中声明业务类型、invoke 和订阅；引用 shared，也引用 main 的 repository/service/handler 类型 | 按领域拆 preload API，纯 DTO 和频道契约放 shared；不把 main 实现类型当跨进程协议，P2 |
| Renderer 入口 | `src/main.tsx`；`src/App.tsx::App` | React StrictMode；App 同时处理导航、初始数据加载、ready 通知、初始化队列、订阅、消息中心、后台研究进度和行情恢复 | 启动协调、任务状态、通知与页面各自有拥有者，P2 |
| Shared | `electron/shared/macThsTypes.ts`、`appUpdateTypes.ts`、`dataSourceTypes.ts` | 已有交易请求验证、交易安全诊断投影、更新 DTO、多数据源 DTO；诊断类型又在服务、preload 和 UI 分别维护 | 复用现有纯契约，逐步收敛重复类型；契约同时定义运行时校验和错误结果，P2 |
| 数据持久化 | `electron/main/database/db.ts::initDb/getDb/runMigrations` | 全局数据库实例，WAL；大量内联迁移；多数业务经 repository，也有入口与服务直接 SQL | 数据库生命周期明确；领域 repository 与应用服务分离；迁移执行器独立于迁移定义，P1/P2 |
| 调度 | `electron/main/services/schedulerService.ts::startScheduler/stopScheduler` | 调度服务直接依赖扫描、行情供应商、众多 repository、竞价、盘前、回测、投组预测和 BrowserWindow；定时器与部分 Promise 用模块级变量登记 | 调度器负责触发与任务登记，任务通过接口使用领域服务；窗口推送交给事件桥，P1/P2 |
| 诊断与数据安全 | `diagnosticsService.ts`、`dataSafetyService.ts` 及各自 IPC/UI | 已有健康快照、数据质量、补齐动作、手动一致性备份和业务数据导出 | 业务健康检查与技术故障证据分开；反馈包使用独立脱敏白名单，P1/P2 |

现有主要依赖方向为 `renderer -> preload -> IPC -> services/repositories -> SQLite/外部供应商`。偏离该方向的可见例子包括 preload 直接引用 main 类型、主入口执行领域 SQL、diagnosticsService 调用 schedulerService 的任务函数、schedulerService 自行选窗口推送。它们是维护边界问题，不自动意味着功能错误。

## 3. 已证实的缺口与研发定位

### A01. IPC 授权策略没有统一覆盖代表性敏感入口

- 严重性：P1；状态：已证实策略不一致，攻击可达性待验证。
- 证据：`electron/main/ipc/macThsHandlers.ts::authorized`（41 行）和 `appUpdateHandlers.ts::run`（10 行）同时检查主窗口 webContents 与 mainFrame。`index.ts` 的 `system:openExternal` 只检查 sender。`settingsHandlers.ts::registerSettingsHandlers`、`aiHandlers.ts` 的 `ai:saveConfig`、`diagnosticsHandlers.ts::registerDiagnosticsHandlers` 和 `dataSafetyHandlers.ts::registerDataSafetyHandlers` 所读入口没有同等 sender/mainFrame 检查；存在配置写入、同步、备份和数据导出入口。
- 已有边界：renderer 无 Node、窗口导航受控；不能由缺少检查推断远程网页当前可直接调用这些接口。
- 建议目标边界：集中注册包装器校验调用窗口、主 frame、请求 schema 和操作权限；业务 handler 不重复实现身份判断。读、写、文件导出和交易能力明确分组。
- 研发验证：用假 event 分别构造非主窗口、非主 frame、已销毁窗口和合法主窗口；验证服务是否在拒绝前未执行。无需真实账户或用户数据。

### A02. 退订函数会误伤同频道其他订阅者

- 严重性：P2；状态：已证实实现语义，用户可见影响待验证。
- 证据：`electron/preload/index.ts::api.on`（4127 行）退订执行 `removeAllListeners(channel)`；`api.off` 接受任意 string 并执行同样操作。`api.ai.onAnalyzeProgress/onTushareNotConfigured`（1839、1843 行）也移除整频道。相邻的 updates、strategyLab、industryResearch 等订阅则保存 handler 并执行 `removeListener(channel, handler)`。
- 条件影响：同频道有两个消费者时，一个组件卸载会移除另一组件的监听器。单一消费者不能据此认定已有故障。
- 建议目标边界：每个订阅拥有自己的 disposer；事件频道运行时白名单；跨页面长期监听由统一消息服务拥有。
- 研发验证：两个独立消费者订阅同频道，退订一个后另一仍收到事件；覆盖 StrictMode 挂载/卸载和抽屉开关。

### A03. 跨进程错误契约不一致，缺少共同的定位标识

- 严重性：P2；状态：已证实抽样契约不一致。
- 证据：`appUpdateTypes.ts::AppUpdateResult` 为 `{ok:false,code,message}`；`diagnosticsHandlers.ts` 为 `{ok:false,error,message}`；`settings:update` 直接返回 row 并允许异常传播；`ai:saveConfig` 返回成功结果但异常直接抛出；`macThsTypes.ts::MacThsResult` 是专用状态结构。`industryResearchError.ts::IndustryResearchError` 仅含 code 和 message。所读契约均无共同 requestId/incidentId。
- 条件影响：UI 需要分别处理拒绝 Promise、error 字符串和 code 字段；日志和用户反馈无法通过共同标识自动关联。交易专用 outcome 有必要保留，不能机械抹平。
- 建议目标边界：共享基础错误对象包含稳定 code、可显示 message、requestId、可重试性；交易附加自己的 outcome。底层异常原因仅进脱敏技术证据，不原样塞给用户。
- 研发验证：对配置、诊断、导出和交易假服务分别注入失败，核对 UI 呈现及日志中的关联标识，无需用户截图翻译。

### A04. 停止调度不阻止运行中回调再次登记定时器

- 严重性：P1；状态：已证实条件性生命周期缺口，未运行复现。
- 证据：`schedulerService.ts::stopScheduler`（226 行）清除已登记句柄和分钟订阅；`scheduleNext`（310 行）在 `await runScan` 后无运行状态检查地调用 `scheduleNext()`；`scheduleBacktestCron`（329 行）同样在 await 后重新登记；盘前 capture/scenario 的 finally 也可重新登记。`reschedule`（288 行）清除 `_timer` 后直接安排下一轮。
- 条件影响：stop 或重排发生在旧回调等待期间，旧回调完成后仍可能登记下一轮。不能把 clearTimeout 等同于取消已经开始的 Promise；调度停止后是否持续运行、是否出现重复链，需隔离验证。
- 建议目标边界：SchedulerHost 拥有运行状态或 generation，回调完成前后检查代次；任务具有停止接纳、取消信号和可等待的完成句柄。重排只变更下一次触发，不复活旧代次。
- 研发验证：假扫描服务返回可控 Promise；启动回调、调用 stop/reschedule、再放行 Promise；观察没有旧代次再次注册或重复触发。

### A05. 应用退出、重启和致命错误使用不同的清理路径

- 严重性：P1；状态：已证实调用路径差异，资源残留后果待验证。
- 证据：`index.ts` 的 `before-quit`（445 行）停止心跳和调度、记录关闭时间，但对 `stopResearchAccessTransport()` 使用 void，未等待，也未调用已有 `db.ts::closeDb`。`app:relaunch`（252 行）调用 `app.relaunch()` 后 `app.exit(0)`，该 handler 内未复用清理流程。`fatalErrorWindow.ts::showFatalErrorWindow` 的 closed（108 行）调用 `app.exit(1)`。`researchAccessTransport.ts::stopResearchAccessTransport`（105 行）本身是等待 server.close 的异步操作，活动 socket 设置五分钟超时。
- 不能推断：没有证据证明 SQLite 已损坏、socket 必然残留，或所有 exit 都需要无限等待。正常退出顺序与异常硬退出需分别定义。
- 建议目标边界：正常退出/重启共用有超时的 ShutdownCoordinator，先停止接纳任务，再停止/等待任务与 transport，最后关闭 DB；致命退出保留可控降级路径。Mac 关窗继续后台运行、Command+Q 退出是两种已明确的产品语义。
- 研发验证：以假 transport 和临时 DB 记录关闭顺序；覆盖正常退出、重启、启动中失败、活动连接和清理超时。主代理决定是否允许这些隔离执行，本报告未执行。

### A06. 部分后台 interval 没有可清理的拥有者

- 严重性：P2；状态：已证实句柄未登记。
- 证据：`index.ts::bootstrap`（385 行）网络监控 setInterval 未保存句柄；`cleanerService.ts::scheduleDailyCleanup`（27 行）小时清理 interval 未保存句柄，也无 stop API。`catchUpService.ts::startHeartbeat/stopHeartbeat` 则有明确句柄。
- 条件影响：不便在重启协调、部分启动失败和隔离实例 teardown 时统一停止。整个 OS 进程结束会回收 timer，不能据此称退出后一定仍运行。
- 建议目标边界：后台服务 start 返回 disposer 或提供幂等 stop；生命周期注册表拥有网络监控、清理、心跳和调度。
- 研发验证：假计时器覆盖重复 start、部分启动失败和 shutdown 后零活动句柄。

### A07. WAL 自动备份与手动备份采用不同的一致性机制

- 严重性：P1；状态：已证实实现差异，备份实际恢复结果待验证。
- 证据：`db.ts::initDb`（26、31、39 行）先开启 WAL、执行迁移，再使用 `copyFileSync(dbPath, bakPath)` 复制单个主文件，每 24 小时一次；catch 静默忽略失败。`dataSafetyService.ts::createDatabaseBackup`（148 行）使用 `await db.backup(backupPath)` 并维护最多十份历史备份。
- 条件影响：主文件拷贝不包含尚在 WAL 中的提交；启动迁移发生在自动备份之前，因此该 `.bak` 不能被描述为可靠的“本次升级前快照”。不推断实际 `.bak` 已损坏或迁移一定失败。
- 建议目标边界：统一 DatabaseBackupService，采用 SQLite 一致性备份；明确升级前快照、运行中快照和导出的不同用途；失败有状态与脱敏证据。迁移前恢复点和恢复验证由执行器协调。
- 研发验证：临时 WAL 数据库写入未 checkpoint 的记录后生成两类备份，比较恢复后的行数、迁移版本和 integrity_check；不打开用户数据库。

### A08. 通用配置保存的运行时校验覆盖不一致

- 严重性：P2；状态：已证实校验边界差异，具体非法值后果待验证。
- 证据：`settingsRepository.ts::updateSettings`（58 行）有字段白名单，显式值校验集中在 `decision_notify_in_app_enabled`；`settingsHandlers.ts::settings:update` 对 scanIntervalMinutes 有值即 reschedule；`schedulerService.ts::scheduleNext` 将其直接乘 60000。`setTheme/setMarketHeatmapProvider` 使用 TS union，但所读 handler 没有运行时 schema。`ai:saveConfig` 有若干上下限处理，没有共同请求校验层。
- 不能推断：数据库 CHECK、UI 输入限制和未读服务可能提供其他防护；TS 类型不等于 IPC 收到值的运行时验证，但此处没有证明所有非法值都能落库。
- 建议目标边界：ConfigApplicationService 校验完整 DTO、数值有限性和范围；repository 接受已规范化字段；IPC 只负责鉴权与解码。配置保存后的调度变更应有明确失败语义。
- 研发验证：假请求覆盖 null、非对象、零/负值/超大间隔、未知枚举和非法字段；记录拒绝位置，确保没有保存成功但重排失败的模糊结果。

### A09. Renderer 启动没有等待初始加载结果形成统一状态

- 严重性：P2；状态：已证实入口调用方式，拒绝传播及可见影响待验证。
- 证据：`src/App.tsx::App` 的启动 useEffect（283 行）发起 Promise.all 加载初始数据，但未在该处 await 或 catch；紧接着调用 `window.api.notifyReady()`，也未处理其 Promise。`src/main.tsx` 根节点为 StrictMode + App，入口本身无错误边界。main 的 `renderer:ready` 有一次性守卫（335 行），这是已有保护。
- 条件影响：某个 store loader 若拒绝且未内部处理，入口无法统一呈现哪个加载步骤失败；ready 表示已挂载通知，而不保证配置加载完成。不能在未读全部 store 的情况下宣称所有 loader 会产生未处理拒绝。
- 建议目标边界：RendererBootstrap 明确 loading/ready/degraded/failed 与重试；每个初始任务返回结构化结果；App 专注组合页面。根级错误边界及异步错误入口分别负责渲染异常和任务异常。
- 研发验证：假 API 使一个 loader 或 notifyReady 失败，覆盖 StrictMode 和热重载，确认仍有可操作界面及带定位标识的错误。

### A10. 已有健康诊断不等于研发故障反馈包

- 严重性：P2；状态：在所读链路中已证实信息粒度不足，全项目是否有其他日志管线待确认。
- 证据：`diagnosticsService.ts::DiagnosticsHealthSnapshot` 和 `DiagnosticItem` 包含状态、检查时间、表覆盖、动作，但无应用构建标识、技术故障关联 ID 或任务失败因果链。`diagnosticsHandlers.ts::toErrorCode` 使用显式 code 或消息包含字符串映射错误。`DiagnosticsPanel.tsx::loadHealth/runAction` 显示 message。`index.ts`、scheduler、IPC 多处 console 输出；`applicationDataPathService.ts::configureApplicationDataPaths` 配置 logs 目录，而 `db.ts::initDb` 仅把 `trade-watch.log` 路径附加到异常。设置目录不证明该文件正在持久写入。
- 已有基础：资讯扫描有 runId，盘后同步/研究任务有自己的记录，诊断有面向用户的修复动作；不应重做或声称完全无可观测性。
- 建议目标边界：SupportDiagnostics 独立收集白名单运行信息、应用版本/构建、任务 ID、最后失败步骤、稳定错误码及脱敏堆栈；本地持久日志采用轮转和保留期。用户可生成预览后的诊断文件，研发靠 ID 和自动上下文定位。
- 研发验证：临时环境注入配置保存、网络同步、迁移和关机错误，研发仅凭脱敏包能找到模块和操作；另行确认已有日志库/打包入口，不能依据文件名检索缺失就断言没有。

### A11. “业务数据导出”不能直接作为安全反馈附件

- 严重性：P1；状态：已证实导出范围含个人业务数据，泄露是否发生未证实。
- 证据：`dataSafetyService.ts::exportData`（215 行）默认 all；`exportPortfolio`（190 行）包含股票和成本价；`exportForecasts`（195 行）导出预测及输入快照；`exportDecisionSignals`（201 行）导出原因和来源。`exportSettingsSummary`（207 行）只输出 Key 是否存在，不导出密钥字段，这是已有防护。`macThsTypes.ts::safeMacThsDiagnostic`（75 行）只输出白名单诊断，不带委托号、订单价格和数量。
- 建议目标边界：SupportDiagnostics 不复用 all 导出或完整数据库备份；采用交易诊断的白名单投影思路，不包含账户、成本、持仓明细、凭据、提示词或原始输入快照，默认本地生成并供用户预览。
- 研发验证：合成含测试标记的敏感字段，检查反馈包不包含标记；业务数据备份仍保留其独立用途。禁止把本报告建议解释为可以自动上传用户数据。

### A12. 交易错误分类和结果状态适合单独拥有诊断证据

- 严重性：P2；状态：已证实 handler 错误归类过宽；实际交易适配结果未验证。
- 证据：`macThsHandlers.ts::registerMacThsHandlers`（196 行）最外层 catch 将不同异常统一映射为 `JOURNAL_UNAVAILABLE`；`execute`（46 行）将子进程错误缩成权限类或 SCRIPT_ERROR。已有主 frame 检查、单次 token、系统确认、busy、金额边界、request 去重及 unknownPending 日志，这些应保留。查询动作经 script 返回结果，但共享 `MacThsResult` 本身没有订单/成交明细 DTO。
- 建议目标边界：交易适配器只负责界面操作和回读；交易应用服务拥有状态、确认、幂等和未知结果协调；内部错误保留阶段与 incidentId，外部安全结果保持稳定。查询打开页面与取得可对账明细应是两种能力。
- 研发验证：假脚本、假 journal、假系统对话框覆盖写文件失败、脚本失败、超时、确认过期与未知回报；不连接券商、不自动点击交易软件。实际 Mac UI 是否可用仍需使用者本机验证，不能把上述防护当作实盘成功证据。

## 4. 已有防护和不能重复登记的旧问题

| 事项 | 证据 / 函数 | 现状与建议边界 | 优先级 |
| --- | --- | --- | --- |
| DeepSeek 保存的 NOT NULL 错误 | `db.ts::MIGRATION_022/023`；`aiConfigRepository.ts::setProviderConfig`（47 行）；`apiKeyEncryption.ts::encryptRequiredApiKey`（28 行）；`aiHandlers.ts::ai:saveConfig`（974 行） | 表中 Key 列确有 NOT NULL，但新建未配置厂商写空 Buffer、更新 null 转空 Buffer；必填 Key 加密失败会抛清晰错误；全局和厂商保存包在 transaction 中。不能再认定截图证明当前路径仍写 null。用配置服务统一保留/清空/加密失败语义 | P2，历史回归待验证 |
| 数据迁移事务 | `db.ts::runMigrations`（4651 行） | 已有 schema_migrations 记录；普通迁移的 SQL 和版本记录位于同一 transaction；特殊外键隔离迁移使用 BEGIN IMMEDIATE/COMMIT/ROLLBACK 并恢复外键状态。不能称迁移完全无事务；跨多版本升级整体恢复仍需独立设计 | P1，恢复边界 |
| 原数据保护 | `applicationDataPathService.ts::prepareApplicationDataRoot/prepareSessionDataRoot` | 已有 staging、复制校验、冲突检测、marker 和原目录保留；session profile 有 Local Storage 与 Local State 迁移处理。Windows 安装版设置独立 userData/session/logs，Mac 保留平台默认目录。不要通过重建数据目录解决配置故障 | P1，保留行为并验证升级 |
| 免 Key 日历 | `schedulerService.ts::startScheduler`（162 行）；`diagnosticsService.ts::runDiagnosticAction` 的 syncTradeCalendar（519 行） | 本地源码已接官方日历 seed 和无 Token 路线，诊断文案声明 2024-2026 有界覆盖；不应把旧截图当作新路径失效证据。实际安装包与日历覆盖需主代理确认 | P2，安装包回归待验证 |
| Mac 关窗 | `index.ts::window-all-closed/activate`（430、439 行） | 关窗保留应用及后台服务，activate 再建窗口；与退出不同，是代码明确行为。不要按 Windows 语义直接判为 bug | P2，生命周期需求 |
| 手动一致性备份 | `dataSafetyService.ts::createDatabaseBackup`（148 行） | 使用 SQLite backup API；优先收敛自动备份实现，而不是取消现有备份 | P1，保留并复用 |

## 5. 已有领域证据的边界说明

以下内容来自任务上下文，不是本次重新读取或运行的结论。

| 证据路径 / 函数 | 已有证据 | 对目标架构的建议边界 / 严重性 |
| --- | --- | --- |
| `electron/main/database/portfolioRepository.ts`；`services/portfolioDashboardService.ts` | 投组保存代码、名称、添加时间、成本价；仪表盘有观点、趋势、新闻等 | 投研投组不等同于券商账户账本；新增账户数量、资金、成交对账应独立拥有数据和导入来源，P1 产品能力边界 |
| `services/strategyLabService.ts`；`strategyLabRunService.ts` | 有策略配置、版本快照、筛选和条件块运行、进度、信号与回测联动；动作不是实盘执行器 | 策略产生信号；逐笔交易确认与执行由交易应用服务处理，不能直接串接自动下单，P1 |
| `services/backtest/strategyBacktestEngine.ts`；`types.ts`；`tradeSimulator.ts` | 以信号交易评估为主；有 T+1 卖出纪律、费用估计、保守同 bar 止损/止盈处理；曲线为等权退出日复合，非完整资本分配账户 | 保留已有信号评估；资金账户回测、同时持仓、真实费用/流动性等另定义模型，P2 |
| `services/backtest/credibility.ts` | 已明确说明未完成滚动/样本外验证、未逐笔模拟涨跌停/停牌/流动性 | UI 与报告继续暴露可信度边界；不能将局部统计当完整策略可交易证明，P2 |

## 6. 主代理可直接分派的收敛顺序

| 顺序 | 收敛范围 | 本报告依据 | 独立完成判据（建议，未执行） |
| --- | --- | --- | --- |
| 1 | 数据备份和生命周期 | A04-A07 | 临时 WAL 备份可恢复；停止后旧任务不复活；正常退出/重启按明确顺序关闭资源，超时可诊断 |
| 2 | IPC / shared 契约和配置服务 | A01-A03、A08 | 非授权调用拒绝；所有入口运行时校验；错误关联 ID 一致；订阅退订互不影响；Key 保存保留历史防护 |
| 3 | 本地故障反馈闭环 | A10-A12 | 一份脱敏反馈文件包含构建、模块、阶段、任务 ID 和稳定错误码；无需用户解释红字或发送账户数据 |
| 4 | Renderer 启动和任务状态 | A09，入口依赖表 | 首次加载与 ready 语义明确；失败有重试和部分可用状态；App 不承担所有任务编排 |
| 5 | 领域能力扩展 | 第 5 节及已准备竞品分析 | 主代理先确认产品优先级，再制定账户、真实订单生命周期、资本回测等独立设计；不在本盘点中追加运行代码 |

此顺序是基于证据的分派建议，由主代理决定最终架构与实施批次。审核报告、处理普通源码任务与真实账户交易授权是不同事项；本文没有发起新的授权流程。

## 7. 阅读覆盖与残余不确定性

已读入口与共享：`electron/main/index.ts`、`electron/main/security/navigationPolicy.ts`、`electron/main/fatalErrorWindow.ts`、`electron/preload/index.ts`、`src/main.tsx`、`src/App.tsx`、`src/vite-env.d.ts`、shared 的 `macThsTypes.ts/appUpdateTypes.ts/dataSourceTypes.ts`。

已读 IPC 样本：`settingsHandlers.ts`、`aiHandlers.ts` 的配置保存及相关片段、`macThsHandlers.ts`、`appUpdateHandlers.ts`、`diagnosticsHandlers.ts`、`dataSafetyHandlers.ts`。

已读持久化与服务：`db.ts` 的初始化、关键 Key 表迁移和迁移执行器片段、`aiConfigRepository.ts`、`settingsRepository.ts`、`apiKeyEncryption.ts`、`schedulerService.ts` 的依赖/计时器/停止和重排片段、`cleanerService.ts`、`catchUpService.ts`、`researchAccessTransport.ts`、`diagnosticsService.ts`、`dataSafetyService.ts`、`applicationDataPathService.ts`、`scanEngine.ts`、`industryResearchError.ts`、`src/components/Diagnostics/DiagnosticsPanel.tsx` 的相关片段。

未覆盖：全部 handler 的鉴权、完整外部研究 gateway、所有供应商实现、所有配置 UI/store 的异常处理、全部迁移内容、更新下载 service 的实现、Mac AppleScript 全文、installer 行为和运行日志。上述边界都需要相应负责人补证，不可把未阅读或文件名未出现当作功能缺失证明。

特别注意：扫描有 `scanEngine.ts::stopScan` 的批次间停止标记，但本次所读应用退出入口没有调用它；不能声称扫描毫无取消能力。迁移执行器当前诊断只看已记录版本，完整版本/校验和/外键一致性规则本次未充分读取，不登记“必然漏校验”结论。已准备的竞品对比仅作为后续产品输入，本轮没有联网调研或实施竞品功能。

交付状态：源码证据盘点完成；所有运行影响仍按条目标注，未冒充已通过测试、已打包、已修复或已在实盘验证。

## 8. 面向目标架构的补充交付

主代理已告知目标设计位于 `openspec/changes/reliable-product-architecture/design.md`，并通过 OpenSpec 结构检查。本执行者未重新读取或评审该设计，以下仅交付可用于实施分派的既有源码证据。另一个执行者新增的 `electron/shared/supportDiagnostics.ts` 为未接 runtime 的纯逻辑契约，不属于本次已读基线，不作为已有线上能力，也未被本执行者读取或修改。

### 8.1 现有导出、脱敏和反馈入口可以复用到什么程度

| 能力 | 已证实入口 / 函数 | 可复用部分 | 当前不能宣称的能力 |
| --- | --- | --- | --- |
| 健康检查与补齐 | 配置中心诊断页 `src/components/Diagnostics/DiagnosticsPanel.tsx::loadHealth/runAction`；`diagnostics:getHealth/runCheck`；`diagnosticsService.ts::getDiagnosticsHealth/runDiagnosticAction` | 用户入口、状态呈现、检查动作、表覆盖与任务状态获取；稳定动作标识可作为反馈复现上下文 | 当前所读入口没有专用“导出技术诊断包”；不能称已有完整日志采集、故障编号或研发反馈闭环 |
| 文件导出 | `DiagnosticsPanel.tsx::handleExportData`；`dataSafety:exportData`；`dataSafetyService.ts::exportData` | 已有本地目录、文件结果和打开备份目录的交互，可借鉴其文件交付方式 | all/portfolio/forecasts/decisionSignals 是个人业务数据导出，不可默认用作反馈附件；不是完整通用脱敏器 |
| 配置摘要的密钥排除 | `dataSafetyService.ts::exportSettingsSummary` | SQL 只选 AI 摘要字段；厂商和数据源只导出 hasApiKey/hasTushareToken，实际 Key 不输出；这些布尔状态适合诊断白名单 | appSettings 使用 SELECT *，业务导出的其他部分仍含成本、预测输入等；未来新增字段不应靠“名字看似安全”自动纳入反馈 |
| 交易安全摘要 | `electron/shared/macThsTypes.ts::safeMacThsDiagnostic` | 白名单投影思路、运行平台/架构、阶段、结果码、未知结果保护状态；不带 contractNo、订单价格/数量 | 仅是交易领域纯函数，不能等同于通用支持中心、自动落盘、自动上传或完整事件追踪 |
| 备份 | `dataSafety:createBackup`；`dataSafetyService.ts::createDatabaseBackup` | 一致性备份、保留策略、备份目录打开入口，用于本地恢复 | 完整 DB 备份不具备反馈脱敏属性，不应默认提供给研发 |
| 启动故障展示 | `electron/main/fatalErrorWindow.ts::showFatalErrorWindow`；`index.ts` 启动 catch | 无需正常 renderer 可展示启动失败，是启动前诊断交付的潜在入口 | 当前仅显示 details 和退出，未见专用导出/反馈按钮；原始 details 可能包含本机路径，不能原样作为脱敏反馈 |

回答边界：已经有本地业务导出、配置摘要排除密钥，以及交易领域白名单诊断；所读链路还没有串成统一的“采集技术证据 -> 脱敏预览 -> 导出 -> 研发定位 -> 修复后复查”闭环。复用优先从现有诊断页和健康/任务检查函数开始，另设技术诊断导出；不要将业务 all 导出改名包装成安全诊断包。外部发送或自动上传不属于当前已实现能力。

### 8.2 schema / IPC / lifecycle 最优先的三个已证实问题

以下三个是可直接据源码立项的问题，排序考虑数据恢复和后台执行后果。条件影响尚未运行复现，不把它们描述为已发生的线上故障。

| 顺序与严重性 | 领域和已证实问题 | 精确证据 | 研发后续隔离验证点 |
| --- | --- | --- | --- |
| 1 / P1 | lifecycle：stop 清句柄，但正在 await 的旧回调可再次登记计时器 | `schedulerService.ts::stopScheduler` 清已登记句柄；`scheduleNext` await 后无运行代次检查地自调用；`scheduleBacktestCron` 同样重登记；`reschedule` 可与旧回调交错。详见 A04 | 假任务停在 await，先 stop 或 reschedule，再完成旧任务；检查旧代次不会重登记，重排只有一条链，退出阶段不会重新接纳任务。使用假计时器与假服务 |
| 2 / P1 | schema / 数据恢复：升级迁移后才复制 WAL 主文件的自动 `.bak`，不能保证是升级前的一致性恢复点 | `db.ts::initDb` 顺序为 WAL -> runMigrations -> copyFileSync 单主文件；手动路径 `dataSafetyService.ts::createDatabaseBackup` 已使用 db.backup。详见 A07 | 临时旧 schema + WAL 未 checkpoint 提交，执行升级和两种备份；检查恢复内容与版本；注入迁移失败验证升级前快照。当前无用户数据损坏证据，也不否定已有迁移事务 |
| 3 / P1 | IPC：敏感配置/导出/诊断入口的调用者检查与交易/更新入口不一致 | `macThsHandlers.ts::authorized`、`appUpdateHandlers.ts::run` 校验主窗口及 mainFrame；`settings:update`、`ai:saveConfig`、`dataSafety:exportData/createBackup`、`diagnostics:runCheck` 所读入口未有同等校验。详见 A01 | 假 event 覆盖子 frame、其他窗口、已销毁窗口；拒绝前服务调用次数须为零，合法调用不回归。现有窗口隔离仍保留，不能断言已存在远程可利用链 |

补充 schema 诊断的已证实限制：`diagnosticsService.ts::buildDatabaseGroup`（388 行）只要 currentVersion > 0 就将迁移项标为 ok；它在该函数中没有与目标迁移集合比较。因此“该项绿色”只能证明有迁移记录，不能证明完整符合当前目标 schema。建议在第 2 项恢复链路中定义完整性证据；验证时使用缺少一个目标迁移记录或目标列的临时库，确认诊断不会仅因存在历史版本就误给充分健康结论。其他迁移校验路径本轮未完整读取，不据此断言全系统均无校验。

交接信息已具备路径、函数、条件场景与验证方法。后续应由研发使用临时 fixture 和脱敏诊断直接定位，不再要求用户转述截图红字；主代理决定目标边界、实施批次与执行授权。
