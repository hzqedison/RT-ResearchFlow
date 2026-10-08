# 1.3 订单意图产品接线：最小完整设计

状态：Astra 设计交付，可据此实现；不是实现完成或产品验收通过。**真实 native 观察、逐笔确认与回报协议是本轮必做实现，不得以永久 blocked 的 mock 接线代替。保留已发布 1.2 不动；不急于发布降级的 1.3。**

## 1. 范围、事实与冻结边界

用户提供的发布基线为 **1.2.0 / source `7e6cfa6`，未纳入 F3**。本任务不联网复核发布；发布基线与入口总盘点由父代理负责。这里依据当前工作区实际入口及已独立验收的 F3 字节设计 1.3 接线，不把工作区等同于发布提交。

本轮仅创建本文件，没有改产品、运行旧 129 套件、启动应用/安装器、访问券商或安装版数据，也没有新增 T1/D0 或另一套独立实验设施。

2026-10-08 只读重新计算六文件 SHA256，全部与 F3 二审一致；API/实现细节复用已验收快照及其转译缓存。原结论见 [F3 独立报告](K:/AI/person/money/RT-ResearchFlow/docs/quality/astra-sqlite-recovery-1.2.md)。

| 当前文件 | SHA256 |
| --- | --- |
| `electron/main/services/macThsIntentStore.ts` | `1f81a7925f9821d6a181914017b2e7b7f0c79a027c0752607358ba3ab23cc55d` |
| `electron/main/services/macThsIntentRecovery.ts` | `8be1d83637bab6eb85320a92021f97b17ca7e346b7feba742aea6a2bf5ba7616` |
| `electron/main/services/macThsRecoveryCoordinator.ts` | `0ef172c8a9ea73698a131a94ed1df5c660d8188e909fe55f6b6f2f8f4b136ccf` |
| `tests/unit/macThsIntentStore.test.ts` | `aeb099b8f3e4e3a1170529ff4684e1884eb25df920517499c238456685c9f6fd` |
| `tests/unit/macThsIntentRecovery.test.ts` | `50866e38451ae960753b15b7e513baaafee9346c0cb1b25afa64a2d52713130f` |
| `tests/unit/macThsRecoveryCoordinator.test.ts` | `ce59d3688a1913c36bdaf62a4458c69ac646d8d324df1c9f26378461f58bfb97` |

### 1.1 实际产品入口

| 已读入口 | 当前事实 | 1.3 必须改变的部分 |
| --- | --- | --- |
| [index.ts:277](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:277)、[index.ts:348](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:348) | `bootstrap()` 初始化主库、注册 `registerMacThsHandlers(getTrustedWindow)`，之后创建窗口；已有单实例、重新启动、`before-quit` 入口 | 主进程创建唯一订单服务，接入既有启动/退出链，不随页面重建 |
| [macThsHandlers.ts:11](K:/AI/person/money/RT-ResearchFlow/electron/main/ipc/macThsHandlers.ts:11) | 会话开关和确认票在 handler 闭包；`userData/mac-ths-experiment-journal.json` 保存 `unknownPending` 与截断至 256 项的旧 ID；直接 `execFile('/usr/bin/osascript', ...)` | 取消 JSON 交易写者及直接交易执行分支，改为服务调用；失败不回退旧分支 |
| [macThsHandlers.ts:94](K:/AI/person/money/RT-ResearchFlow/electron/main/ipc/macThsHandlers.ts:94)、[macThsHandlers.ts:160](K:/AI/person/money/RT-ResearchFlow/electron/main/ipc/macThsHandlers.ts:160) | 应用内一次性确认后，真实买卖/撤单再弹默认取消的 Electron 原生确认框 | 保留两级确认，绑定持久 intent、版本、快照、会话及发送窗口 |
| [macThsHandlers.ts:147](K:/AI/person/money/RT-ResearchFlow/electron/main/ipc/macThsHandlers.ts:147) | `resolveUnknown` 直接清除全局布尔保护 | 移除解除保护捷径，改为逐条持久人审；旧调用只返回需核对状态 |
| [macThsScripts.ts:250](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsScripts.ts:250)、[macThsScripts.ts:281](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsScripts.ts:281) | 脚本填写/回读后点击交易按钮；遇真实同花顺确认弹窗即返回，由本人操作；输出为状态码或 `LIVE_ACCEPTED|编号` | 保留不代点券商确认；补事实适配协议，不把旧字符串伪装成完整 F3 证据 |
| [index.ts:1555](K:/AI/person/money/RT-ResearchFlow/electron/preload/index.ts:1555) | 仅 `window.api.macThs.execute()`；API 类型由 `typeof api` 导出 | 增加固定状态/恢复/人审接口，不暴露任意 IPC/进程/路径 |
| [QuantTradingOnboarding.tsx:148](K:/AI/person/money/RT-ResearchFlow/src/components/QuantTradingOnboarding.tsx:148)、[MacTradingPanel.tsx:45](K:/AI/person/money/RT-ResearchFlow/src/components/MacTradingPanel.tsx:45) | 引导第 4 页挂载交易面板；页面仅保留上次结果，每次 `run()` 新建请求 ID，初始不读持久状态 | 挂载先读后端；请求不因错误/重挂载自动换号；恢复、待核对和禁止重试可见 |

### 1.2 两个不能伪造的能力缺口

1. **1.2 旧 JSON 写者不受 F3 监督。** 当前旧 handler 不读取 F3 退役 lock；单实例锁释放、PID 不存在或一个新空 writer 退出，均不能证明旧脚本已经结束。`createLegacySource()` 只能创建不存在的新目录，不能用于认领既存 `userData`。本轮不发明迁移证明。
2. **当前原生输出不足以填满 F3 合同。** `brokerLabel()` 的“中信证券”前缀及脚本内前后相等，不等于能区分两个账户；当前输出没有可信账户摘要、交易日、完整撤单目标及完整 `AdapterEvidence`。不能把勾选风险提示转换成 `distinguishable: true`，也不能把本机日期或请求参数冒充观察事实。

因此，隔离接线必须同时实现实际 native 观察代码、合法正向链与明确的能力不足/旧源阻断链；不能用“所有交易都拒绝”冒充目标完成，也不能用注入的账户/日期正控宣称新来源已经在真实设备可用。隔离行为通过、native 实现完整、真实设备兼容通过是三个不同结论。

## 2. 唯一调用链与文件任务

```text
MacTradingPanel / AppConfirmDialog
  -> preload 固定 macThs 接口
  -> macThsHandlers：调用者、运行时解码、原生人工确认
  -> MacThsOrderService：唯一会话、操作串行、状态与业务编排
       -> MacThsIntentStore -> MacThsIntentRecovery -> 独立订单 SQLite
       -> MacThsExecutionAdapter -> MacThsRecoveryCoordinator -> owned osascript
```

这里的适配器是窄接口，不引入通用交易框架、任务平台或账户账本。生产不提供“旧实现/F3”双写或降级开关。

| Sol 文件范围 | 明确职责 |
| --- | --- |
| 新增 `electron/main/services/macThsOrderService.ts` | 唯一服务；启动检查、会话开关、准备/确认/提交、恢复/人审、状态投影、退出协作 |
| 新增 `electron/main/services/macThsExecutionAdapter.ts` | 可信账户/撤单目标事实读取，静态脚本准备，真实 owned 子进程输出/退出管理，证据解码；禁止绕开 store 启动交易 |
| 修改 `electron/main/services/macThsScripts.ts` | 最小结构化事实输出及账户/目标见证检查；保留静态参数校验、原 MIT 署名和真实确认弹窗不代点规则 |
| 修改 `electron/main/ipc/macThsHandlers.ts` | 注入上述单例，删除旧 JSON 写入与通用 `resolveUnknown` 解锁；原生确认入口保留 |
| 修改 `electron/shared/macThsTypes.ts` | 新增产品状态 DTO、恢复/人审请求及明确错误码；不向 renderer 导出后端能力对象 |
| 修改 `electron/preload/index.ts` | 固定桥接方法及可注销状态通知；复用已有 `API = typeof api` 类型链 |
| 修改 `electron/main/index.ts` | 创建/注入/停止服务；纳入已有单实例、窗口失效、退出及重启链，不另建第二套生命周期 |
| 修改 `src/components/MacTradingPanel.tsx`；必要时同名 CSS | 持久状态首次加载、逐条核对/恢复、确认绑定和禁止重试展示；复用 `AppConfirmDialog` |
| F3 原三实现及原三测试 | 默认不改；schema 仍为 2。不为接线引入后门、放宽旧源认领、续期或重发规则 |

`QuantTradingOnboarding.tsx` 的现有挂载方式可保持；开通登记、引导重置、策略及 AI 都不得获得订单授权。父代理集成版本号/发行信息，本设计不触碰它们。

## 3. app startup、目录与生命周期

### 3.1 唯一执行域和初始化

- 以主进程既有、已确定的 `app.getPath('userData')` 为订单执行域，订单文件为其中独立的 `mac-ths-orders.v2.sqlite`，不接到 `initDb()` 的主业务连接。不换一个新目录躲开原 JSON、旧 ID 或未决意图。
- `directory`、平台、executable、脚本、`initialize` 和 nativeBinding 都不得来自 renderer。生产遵循 F3 对真实本地路径、私有权限和非网络文件系统的检查；权限不符即阻断，不顺手递归改权限或改用户目录。
- 取得既有应用单实例所有权、确定数据目录后，创建一个服务。Mac 才打开订单库；其他平台返回 `UNSUPPORTED_PLATFORM`，不载入/初始化订单原生执行。模块载入、ABI、存储异常都转为交易不可用状态，不导致投研页面退出。
- 正常启动使用 `open({ directory, initialize: false, ...可信封存能力 })`。打开后先 `inspectRecovery()`；仅恢复检查允许时调用 `inspect()`。启动不自动 `applyRecovery`、人审、确认、claim、执行或启用真实会话。
- 没有订单库、启用标记以及任何旧源/临时残件时，显示 `NOT_INITIALIZED`。仅首次明确的“初始化本机委托记录”动作，经主进程再检查并原生确认后使用 `initialize:true`。这不是“重置保护”按钮，已有库异常、曾启用后库丢失、未知目录或旧残件都不走此分支。
- 预检查包含旧 journal、`mac-ths-experiment-journal.json.tmp`、F3 已知旧 v1/pending/lock/启用/临时文件、SQLite 本体及旁文件。旧 handler 的 `.json.tmp` 不能忽略，不能只检查正式 JSON。未知残件保留原字节并阻断，不自动删除或生成空库。
- 初始化创建数据库属于显式 provisioning；事务/标记写入中断按 F3 恢复规则处理。覆盖说明仍为 `earlierIds: unavailable`，不宣称恢复了旧 handler 已截断的历史 ID。
- 订单库及永久 ID 不能被普通“重置引导”、缓存清理或旧版本数据还原覆盖。涉及执行域的数据迁移/还原必须先停止本服务并重新走所有权与恢复检查；不能在服务存活时复制回滚订单文件。本轮不扩展通用备份框架，也不提供订单清空入口。

### 3.2 旧源分支

| 检测结果 | 处理 |
| --- | --- |
| 新域，无任何旧交易残件 | 显式 provisioning 后正常 F3 流程；不制造 legacy writer |
| 已有 F3 库，无恢复需求 | 会话默认关闭，显示持久意图及禁止重试状态 |
| 已有完整可信 retirement/supervision 封存 | `restoreLegacyQuiescence(directory)` 得到私有能力，再 `open`/检查/显式恢复；保留原 JSON/lock/封存文件 |
| 旧 1.2 JSON、`.tmp` 或 lock 存在，但没有可信封存 | `LEGACY_WRITER_UNFENCED` 或更具体的旧残件不支持状态；`canApply=false`，不得认领、绕目录、无条件导入或退回旧 live handler |
| seal 损坏、来源改写、新旧残件冲突 | 保留证据并阻断，即使之前已有 recovery receipt 也不跳过来源检查 |

**真实旧 1.2 未受监督来源的无损可用迁移不在现有 F3 能力内。** 必须由后续单独审定的可信冷交接方案解决，不能由 Sol 用 PID/mtime/单实例锁或删除旧文件“补齐”。这不影响本轮完成安全阻断及新域/可信封存来源的产品接线，但不得标为所有 1.2 交易用户升级后已恢复可用。

### 3.3 会话、窗口和停止顺序

服务与 store/coordinator 随主进程存活，不能按 IPC 请求打开/关闭，也不能随面板卸载关闭。SQLite EXCLUSIVE 所有权必须跨所有 COMMIT 和原生确认等待保持。

1. 状态先为 `STARTING`；完成检查再给 renderer 状态。全部交易写操作使用一个服务操作通道，第二次提交明确返回忙，不排队等待未来执行；状态查询不与一个长时间原生确认一起排队。
2. 真实授权由原生风险确认和新鲜可信账户上下文触发 `enableLiveSession({ accountDigest, observedAt })`。页面 checkbox、上次 `LIVE_ENABLED`、重启/恢复成功都不能自动调用它。
3. 服务维护独立 `generation`、会话开关及一次性确认票。窗口销毁/导航/renderer 崩溃、关闭真实授权或应用停止立即递增 generation、撤销票和关闭服务入口；不能因为 store 内部没有公开 disable 方法而继续接单。
4. 异步确认/事实读取前后都检查 generation、当前 trusted main frame、会话及持久门禁。claim 到 `store.launchExecutor()` 必须同一同步段完成，不在中间等待对话框、IPC 或读取账户。
5. 在既有 `before-quit`/重启链最前面同步进入 `STOPPING`，拒绝新操作并撤票；等待正在返回的确认/事实读取失效，停止本服务 owned 子进程，再通过 `store.shutdown(coordinator)` 完成真实退出证明与关闭。正常关闭之后才允许既有退出/重启动作继续。
6. 不能用 `finally(app.quit)` 无条件吞掉订单 shutdown 失败；不能把 `kill()` 返回或超时当作 `close`。建议产品等待提示界限为 5 秒，仅用于显示“退出未完成”，不是判定退出成功的时限；晚到的成功仅能完成同一次停止流程。
7. `EXECUTOR_EXIT_UNPROVEN`、无 instance 的 `launch_pending`、孤立 executor、停止失败或存储错误：保持禁止交易和恢复提示，不写 clean session，不删除 attempts。受控退出失败保持窗口可见；OS 强制结束仍由下次恢复处理，不能记录为正常退出。

## 4. 服务与 IPC 合同

### 4.1 主进程服务接口

以下为待实现接口名，不伪称已有导出。服务注入受信配置、适配器和确认回调，不直接依赖 renderer。

```ts
interface MacThsOrderService {
  start(): Promise<MacThsProductState>
  getState(): MacThsProductState
  execute(request: MacThsRequest, caller: TrustedCaller): Promise<MacThsResult>
  recover(request: RecoveryCommand, caller: TrustedCaller): Promise<MacThsProductState>
  reviewIntent(request: ReviewCommand, caller: TrustedCaller): Promise<MacThsProductState>
  revokeCaller(callerId: number): void
  beginStop(): void
  shutdown(): Promise<void>
}
```

复用现有后端调用：`open/inspectRecovery/inspect`、`createIntent/getIntent`、`confirmIntent/abandonIntent`、`claimExecution/launchExecutor`、`recordOutcome/recordExecutorExit`、`applyRecovery/getRecoveryReceipt/recordHumanReview`、`shutdown`。所有 store/recovery 抛出的具体拒绝码保留分类；不知道如何映射时返回受限 `STORAGE_UNAVAILABLE`，不能把它变成 READY。

### 4.2 固定桥接

| 通道 / preload 方法 | 输入 | 权限与副作用 |
| --- | --- | --- |
| 现有 `macThs:execute` / `execute` | 原 probe/authorize/preview/query/授权开关/submitLive/cancelLive/dismiss；提交增加服务发出的 intent 绑定返回值 | 同一 trusted 主窗口主 frame；交易只走服务；`resolveUnknown` 不再解除任何门禁 |
| 新 `macThs:status` / `getState` | 无 | 只读持久投影，不启动脚本、不产生新 ID、不修复数据库 |
| 新 `macThs:recover` / `recover` | `{kind:'apply', recoveryId, manifestHash, expectedRevision}` 或 `{kind:'initialize'}` | 显式用户动作；主进程展示并确认当前计划；apply 使用同一三元组，不替用户改为更新版本 |
| 新 `macThs:reviewIntent` / `reviewIntent` | `{intentId, snapshotHash, expectedRevision, recoveryId?, reviewRequestId, observation}` | 主进程解码、固定 scope/statement 白名单和原生确认；由当前 store 填 reviewingSessionId，不信 renderer 的 method/session/time |
| 新 `macThs:stateChanged` / `onStateChanged` | 主进程通知 `{sessionId, stateSequence}` | 仅通知重新读取状态，不在事件中推送原始账户/订单/审计；注销只移除自己的 listener |

`TrustedCaller` 由 handler 建立，不是客户端参数；每个新增通道复用当前 `event.sender === window.webContents && event.senderFrame === mainFrame` 的检查，并在 await 后再次确认窗口仍有效。严格验证字段、UUID、大小、枚举和未知字段；任何 renderer 提供的路径、spawn 参数、恢复 capability、nativeBinding、账户摘要、时间戳或原始证据都不得传给后端。

`MacThsProductState` 至少包含：协议版本、主进程 sessionId、单调递增 stateSequence、serviceState、具体 code/recoveryReason、liveEnabled、executorState、unknownPending、canPrepare/canConfirm/canRecover/canReview、coverage，以及仅本机显示的意图摘要。摘要含 intentId、snapshotHash、revision、state、gateReleased、executionForbidden、recoveryQuarantine、恢复绑定及脱敏账户标签/必要订单参数；不向 renderer 暴露原始 BLOB、私有 proof、完整账户标识、SQLite 句柄、文件路径或 secret。

`MacThsResult` 保留现有 action/code/confirmation 文案兼容，增加权威产品状态投影，适配器版本升级为 `3`。`canSubmitLiveOrders` 必须由完整门禁计算，不再只等于内存 liveEnabled。`safeMacThsDiagnostic` 继续重建严格白名单；新增状态/原因/计数即可，不导出整个 DTO，不导出摘要中的订单、ID、hash、账户 digest、确认票、委托编号或原始异常。

## 5. 一笔真实人工委托的精确顺序

### 5.1 准备和确认

1. 面板首次点击生成一个稳定 requestId，同一业务操作的顶层 ID 与 `order.requestId` 必须相等。得到回报前不因超时/错误自动再生成 ID；主进程拒绝二者不一致。查询/展示不创建意图。
2. 服务首先检查存储/恢复、未释放 UNKNOWN/LEGACY_UNKNOWN、隔离记录、未退出 executor、STOPPING、平台和 live 会话。已存在同 requestId 的查询/重复请求返回已有记录或精确冲突，不重新采样并生成不同 createdAt 的“同请求快照”。新 ID 也不能越过未决门禁。
3. 在当前可信适配器观察到可区分账户之后，由主进程构建 `IntentSnapshot`，`createIntent(requestId, snapshot, additionalOrder)` 持久化 PREPARED，再发应用内确认票。票绑定 action、intentId、snapshotHash、revision、sender/frame、sessionId、generation 和最晚到期时间；renderer 只能拿票，不能重新提供已确认的快照。
4. 1.3 只接现有手工限价输入：`input.source='manual'`，主进程在本次准备时记录 capturedAt。以整数分计算金额，沿用现有普通主板/数量/上限校验；不连接报价自动下单，不把手工限价标成实时行情。建议快照与首次确认票最多 120 秒；后续步骤只能收紧期限，不能从“此刻”续满 120 秒。
5. 撤单不能拿当前买卖表单或默认值填快照。适配器必须先读取唯一目标的账户、实际交易日、证券/市场/方向/价格/数量和 contractNo，完整展示后确认；目标 notional 仅作撤单快照一致性上限，不授予新买卖额度。仅有当前 UI 的编号字符串时返回目标未证实，不执行撤单。
6. 应用内确认票消费后再展示现有 Electron 原生对话框，默认/取消均为取消，显示同一持久快照的账户标签、买卖/撤单、证券、价格、数量和金额。两个确认框都不能由策略、timer、renderer 初始化或恢复回调自动接受。
7. 原生确认返回后重新检查窗口/generation、过期与门禁，并读取新鲜账户事实；与快照不符即拒绝。随后 `confirmIntent(..., {method:'native_dialog', sessionId:store.sessionId, confirmedAt, expiresAt, additionalOrderAcknowledged})`；expiresAt 不大于原快照/票期限。取消或到期使用 `abandonIntent`，不删 ID。
8. `claimExecution(..., requestId, observedAccountContext)` 成功会先持久转 UNKNOWN/attempt，再同一同步段 `store.launchExecutor(attemptId, coordinator, '/usr/bin/osascript', fixedArgs)`。`claimed:false`、存储拒绝或未知返回不能 spawn。原确认版本在 confirm 后已变，claim 使用 confirm 返回的新 revision。

仅在前一相关意图已经允许继续后，才能由本人明确选择“另下一笔独立委托”，传 `AdditionalOrder.previousIntentId` 并在原生确认中确认 `additionalOrderAcknowledged:true`。它不是重试按钮，更不能解锁未决记录；普通按钮不悄悄替用户添加这个关系。

### 5.2 适配器事实与子进程

最小适配器事实接口为 `observeAccount()`、`observeCancelTarget(contractNo)`、`prepareExecution(immutableSnapshot)`、`decodeEvidence(boundedOutput, expectedSnapshot)`，返回明确的能力不足或结构化事实，不返回猜测的成功。

- 账户 digest 来自主进程对可区分的稳定账户见证进行域分离摘要；label 只保留掩码后缀。摘要不是匿名化保证，不导出；原始账户文本只在本地适配器短暂使用，不写日志/SQLite。仅券商名、不可区分的掩码或用户勾选不能作为该见证。
- 同一执行脚本必须在交易按钮前重新读取并匹配**主进程确认的账户见证**和不可变参数；不能只比较该脚本启动后才采样的 originalBroker。不支持的 UI 字段/版本、歧义或账户切换一律停止。实际编码/布局支持无法可靠实现时返回能力不足，不放宽定义。
- 提交后证据必须满足现有 `AdapterEvidence`：可信账户摘要、观察时间、真实交易日、匹配的完整参数、唯一新编号/唯一撤单目标、实际观察状态；未观察的成交/撤单数量为 `null`，不能填 0。旧 `LIVE_ACCEPTED|编号`、`LIVE_CANCELLED` 或 `READY` 单独均不够。
- 只有可证明在触碰提交按钮前终止且账户/阶段匹配的 `source:'adapter', effectPhase:'before_submit'` 才能成为 NOT_SUBMITTED。超时、取消进程、退出码、解析失败、原生权限错误等不能被映射成“肯定没送出”。
- 生产只用静态、严格转义的模板和固定 executable，不接受 renderer 的 script/argv。真实同花顺确认弹窗仍由本人处理；`NATIVE_CONFIRMATION_REQUIRED` 表示结果未决，而不是 `USER_CANCELLED` 或已成交。
- 当前 `coordinator.launchExecutor()` 返回 `{instanceId, child}`，可以直接管理 stdout/stderr；不需要第二次 execFile。适配器可用一个局部 coordinator 子类，覆盖该方法但原样转交 `beforeSpawn` 给 `super`，立即登记返回的 owned handle 并挂输出监听，再原样返回。此最小包装保证即使 store 在 spawn 后写 running 失败，服务仍知道自己创建的具体实例；不得改写 F3 私有字段或制造退出 capability。
- 输出每路上限 4096 字节，解析白名单协议，不记录原始 stderr。运行等待上限沿用 20 秒并受原授权剩余时间进一步约束；计时起点不因重试读取/慢持久化/参数准备重置。超限只停止这次 owned 实例，并保留 UNKNOWN。
- 用 `coordinator.waitExecutor/stopExecutor` 得到实际 `close` 的私有 proof，再 `store.recordExecutorExit`。单独的 child PID、退出码或人工声明都不能代替 proof。证据与退出都落盘之后才允许后续交易。
- spawn 已可能发生但 store 的 attempt 仍为 `launch_pending`、instance 未可靠持久化时，即使服务停止了其内存中拥有的 child，也不能手工把数据库写成 `not_started/exited`。F3 的 `EXECUTOR_EXIT_UNPROVEN` 继续阻断，交恢复/处置分支。
- `store.launchExecutor` 的 B 修复仍负责实际 spawn 紧前检查，必须保留同一哨兵对象判定；只有它确认没有 spawn 时可以回写 not_started。该意图仍 UNKNOWN，attempt 与 ID 仍保留，不自动执行旧票。

### 5.3 本轮必须实现的 native 观察协议

现有源码只证明下列 AX 读取位置已经被编写，**不证明它们在测试者的客户端版本上可用**。Sol 必须在生产脚本中实现真实读取、结构化输出和严格解码，不得让生产 `observeAccount/observeCancelTarget` 永远返回固定 unsupported、而仅在测试注入完整事实。

| 事实 | 当前读取位置 / 本轮明确支持条件 | 缺失或歧义时的处理 |
| --- | --- | --- |
| 客户端与交易模式 | 读取实际同花顺应用版本；现有 A股/模拟按钮的 `AXSelected` 或 `AXValue`，确认互斥；记录适配器内置 layoutProfile | 提示打开受支持 A 股交易页；未知版本/布局不能假装已经验证 |
| 券商标记 | 当前 `brokerLabel()` 从 `scroll area 1/table 1/row 1/UI element 2/button` 的 AXTitle 读取，或取得唯一静态候选 | 中信前缀仅证明券商候选，不证明账户；多个候选不选择第一个 |
| 可区分账户 | 从已识别的选中账户控件获取有明确账户语义的稳定标识，与其券商/选中状态绑定。现有 brokerTitle 只有在真实字段语义和格式确认含可区分账户标识时才可升级为 witness；泛化“后面有几个字符/数字”不合格 | `ACCOUNT_IDENTITY_UNAVAILABLE`，区分 missing/ambiguous/masked_only。目前没有真实设备证据确定完整账户字段，必须明确保留该差距；禁止写死 `distinguishable:true` |
| 买卖回读 | 现有 3 个 text field：1 为价格、2 为证券、3 为数量；方向按钮及 enabled 状态。仅匹配已知布局且逐项严格解析/回读一致时采用 | 显示具体缺失的字段类别，不猜列、不以输入值填观察结果 |
| 委托唯一标识及参数 | 现有 scroll area 4/5 的 table；精确表头白名单：合同编号/委托编号/合同号/委托号，证券代码/股票代码/代码，委托价格/委托价/价格，委托数量/委托股数/数量，买卖标志/买卖/操作/委托类别/委托类型/方向 | 当前模板已有读取基础，本轮返回唯一匹配行的结构化事实。撤单必须完整匹配目标，提交回报必须与提交前编号集合做差且只有一条匹配 |
| 实际交易日 | 新增读取明确标注的委托日期/交易日期列，或已选日期控件的完整年月日。仅“今天”按钮、操作系统日期和格式化当前时间不算来源 | `TRADING_DATE_UNAVAILABLE`，提示切到可显示日期的当日委托页面；新 selector 是待原生确认的支持配置，不伪称当前设备已有该字段 |
| 撤单状态与数量 | 状态列使用已识别的委托状态/状态/委托结果；精确枚举区分已撤/全撤/部分撤，不靠包含“撤”推断。可选成交数量/已成数量、撤单数量/已撤数量列只在真实读取且合法时填值 | 未观察数量为 null；状态/目标不确定保持 UNKNOWN，不把部分撤单写成全撤 |
| 券商确认弹窗 | 现有 `sheet 1` 存在性与 `submitTouched` 边界 | 返回待本人核对；不代点确认或取消，不把脚本结束当弹窗处理完毕 |

新增私有 `NativeObservationV1` 协议只允许 owned 原生子进程输出，按 `observe_context / observe_cancel_target / execute / observe_receipt` 区分动作。最小字段为协议版本、操作 nonce、action/phase、实际 clientVersion、内置 layoutProfile、观察字段状态、账户 witness、选中模式、实际日期、完整目标/回读/回报及 submitTouched；缺失项显式 unavailable，不放默认值。原始 witness 只在适配器内存完成绑定/摘要，不穿过 IPC、日志或导出。输出不是 F3 capability，退出证明仍只来自 coordinator。

模板负责 AX 事实读取和提交前后边界；TypeScript adapter 负责限长解码、字段关联、main 时钟采样和向 F3 证据的严格映射。`observe_receipt` 只能读取，不包含重新提交按钮操作；待核对后可由本人主动要求再次观察，结果不完整则继续人审，不定时重发。所有实际提交保留应用内确认、Electron 默认取消的原生确认以及券商弹窗由本人处理三层边界。

**测试者兼容反馈必须可操作：** 界面显示“客户端版本 / 布局配置 / 账户、日期、表头、回读、回报各自 recognized/missing/ambiguous/invalid”，并给“打开对应交易页、选中本人账户、本人处理已有弹窗、再点检查”的具体动作。可导出上述枚举、适配器版本、关联号和缺失字段类别；不导出原始 AX 文本、账号、表格、截图或订单。研发据此调整已识别布局，不要求测试者提供凭证或翻译错误栈，也不能让“再次检查”执行交易。

新来源的正向隔离必须穿过**生产模板选择、生产协议 decoder、真实 service/store/coordinator 和真实 owned 无害 child**。合成 AX/回报只检验这些规则；实际 Mac 字段可见性、账户区分能力和券商行为仍须后续设备证据，不能凭该正控签“新来源原生可用”。

### 5.4 状态转换，不混淆进程与业务事实

| 持久状态或事件 | UI/服务行为 |
| --- | --- |
| PREPARED -> CONFIRMED | 仅人工确认；恢复/页面重挂载不推进 |
| PREPARED/CONFIRMED -> ABANDONED | 本人取消或到期；保留 ID，不能复活旧票 |
| CONFIRMED -> UNKNOWN | claim 已持久成功，之后至多启动一次；展示“正在执行/结果待核对” |
| UNKNOWN -> NOT_SUBMITTED | 仅符合合同的提交前证据；与 generic failure 分开 |
| UNKNOWN -> ACCEPTED_OBSERVED/CANCEL_OBSERVED | 仅完整可验证的观察证据；不等于已成交/全撤 |
| UNKNOWN/LEGACY_UNKNOWN + 人审 | 追加 human_reported 事件；是否释放 gate 依合同；不改写为自动观察到成功 |
| executionForbidden/recoveryQuarantine | 原意图永不再执行；恢复和人审不是“再次提交”授权 |
| 进程退出但业务回报未知 | UNKNOWN 保持；不能从退出码或 absence 推断订单结果 |

网络/IPC 超时、renderer 崩溃、窗口重开，只读取原状态；重启后没有任何自动重发队列。若界面不知道上一次调用是否被接收，先全局状态同步，在确认完成前禁用新意图按钮。

## 6. 恢复、人审与 UI

### 6.1 恢复不是重发

`inspectRecovery()` 返回的 recoveryId、manifestHash、revision 是一次恢复计划绑定。UI 显示原因、证据完整性、涉及意图数量和禁止执行事实；本人确认后才 `applyRecovery()`。计划已变化则刷新并重新确认，不自动用新值重试。

apply 后显示 `STORAGE_RECOVERED_REVIEW_REQUIRED`，读取 receipt，不自动 enable live、confirm 或 spawn。同计划重复 apply 必须复用原 receipt；导入前后原 BLOB、旧源、永久 ID 和禁止执行标记都不能清理。恢复过程中 UI 只读，受控退出不能在事务中间拆连接。

### 6.2 人审绑定和新意图可用性

- 人审对象必须是明确 intentId/snapshotHash/revision；恢复意图还绑定 recoveryId 和稳定 reviewRequestId。主进程在原生框展示此对象、覆盖范围及勾选陈述，回调后再次 CAS 检查。不能复用上一个页面/会话或另一个意图的确认票。
- `HumanObservation.method='native_dialog'`、`source='human_reported'`、reviewedAt 和 reviewingSessionId 均由主进程确定；renderer 的 statement/scope 只是待本人确认的输入，不是自动对账事实。
- `still_uncertain` 永不释放 gate。仅本人确认已查看委托、成交及仍开确认弹窗，且满足后端验证，才可申请 `releaseGate:true`；未完成明确核对或 executor 未退出时不开放新单。`no_order_seen` 是人工陈述，不是 NOT_SUBMITTED 的机器证据。
- 人审通过后重读全部持久门禁，旧意图状态/ID/attempt/executionForbidden 原样保留。没有其他未决项且实际 executor 全部有 proof 后，允许本人重新启用本次会话并创建新意图；同单另下需明确关联确认。没有“永久锁死一切”或“清空后任意重试”这两个捷径。
- 孤立 executor 或来源证明不明不在人审释放范围；按钮说明具体阻断原因，不以“本人核对过”伪造进程退出。

### 6.3 最小可见状态

| serviceState | 面板固定提示与可用动作 |
| --- | --- |
| STARTING / SYNCING | 正在读取防重复记录；禁提交；本地状态查询失败也停留保护状态 |
| NOT_INITIALIZED | 尚未初始化；仅无旧源的新域显示显式初始化，不提供清空旧库 |
| READY_DISABLED | 存储可用，真实会话关闭；可查看记录/明确授权，不自动启用 |
| READY_ENABLED | 完整门禁允许准备一笔新操作；每笔仍两级人工确认 |
| AWAITING_CONFIRMATION / EXECUTING | 显示同一意图；确认到期可取消，执行阶段禁止再次提交/排队 |
| REVIEW_REQUIRED | 展示每条待核对与“原意图禁止重试”；提供具体核对陈述，不显示泛化解除保护 |
| RECOVERY_REQUIRED | 展示具体原因及 canApply；可信计划可显式恢复，旧源未封存只显示阻断 |
| BLOCKED_STORAGE / EXECUTOR_UNPROVEN | 不允许新单/恢复假成功；允许只读状态、去敏导出和适当的退出说明 |
| STOPPING / UNSUPPORTED_PLATFORM | 禁用交易；不是订单取消/成交状态 |

状态优先级：平台/启动与存储故障、停止/退出未知、恢复要求、执行中、未释放待核对、人工确认中，最后才是 READY。`liveEnabled` 只是其中一项，不能覆盖更高优先级门禁。

面板挂载、重新获得焦点、每次动作结束/异常及 stateChanged 后读取权威状态；按 sessionId + stateSequence 丢弃旧响应，不能让迟到的 READY 覆盖 UNKNOWN。输入修改会作废本地确认展示并通知主进程撤票，不默默修改持久快照；没有稳定回报前不生成新请求 ID。pending 摘要始终可见，不依赖最后一次 probe 的结果。

`queryOrders/queryDeals` 实际会切换同花顺页面，`preview` 会填写表单，并非纯数据库读。它们只在没有运行中/未证实退出的 executor 时由本人主动调用；原生确认弹窗存在则保留脚本拒绝，不为查看页面自动关闭弹窗。状态查询/导出始终不能控制同花顺。

## 7. 隔离验收：只测新接线，不重复证明 F3

实现后由 Sol 提供变更字节、以下新链路证据，再由 Astra 独立定向验收。复用现有 Vitest/Playwright，不新增独立测试平台，不重跑未受影响的原 129 项。若 F3 三实现确需改变，先明确合同变更和受影响场景，再定向复验，不能沿用原 hash 的 PASS。

建议测试落点：扩展既有 `tests/unit/macThsHandlers.test.ts`、`tests/unit/macThsCore.test.ts`；新增正常产品接线测试 `tests/unit/macThsOrderService.test.ts`、`tests/unit/macThsExecutionAdapter.test.ts`；UI 检查沿用已有组件测试/Playwright 项目。既有 `tests/e2e/mac-ths-experiment.spec.ts` 是 Mac 安装态 smoke，不在本轮运行，也不能拿它代替恢复链路测试。

| 场景 | 必须观察的真实接线结果 |
| --- | --- |
| 冷启动/重启/面板重挂载 | 临时 SQLite 中 PREPARED、CONFIRMED、UNKNOWN、LEGACY_UNKNOWN 逐类加载；startup/activate/status 的交易 spawn 次数全为 0，live 默认关闭 |
| 一次完整产品提交 | handler -> service -> 真 store -> 真 coordinator -> owned 无害子进程；人工确认后仅一次 spawn，副作用 marker 出现前 UNKNOWN/attempt/ID 已提交 |
| 恢复后合法新单 | 同一产品接口执行 inspect/apply/逐条 native review；旧 ID 不可再执行，新关联意图本人确认后真实 child marker 成功；不能只证明按钮变亮 |
| 双击/掉回报/renderer 异常 | 同 ID 返回原结果；改参数冲突；换 ID/改订单/切换面板仍不能跨未决门禁；延迟 READY 不覆盖保护状态 |
| 非法调用者与伪造字段 | 非主窗口、子 frame、已销毁窗口、伪造 capability/path/account/time/evidence，业务调用与 spawn 均为 0 |
| 确认 await 竞态 | 原生框挂起时禁用会话、关闭窗口、退出、改版本或到期；返回“确认”仍不能 claim/spawn，旧票不续期 |
| spawn 边界和未知结果 | 真 SQLite 慢持久化/参数准备跨期限不 spawn；真 child 已启动后持久失败仍 UNKNOWN/UNPROVEN，不被 not_started 或 generic failure 解锁 |
| owned 退出与 orphan | 停止仅自己创建的 child，等待真 close；kill-request-but-alive/未知实例/stop 失败不 clean-close、不启新单；同库 reopen 保留限制 |
| 执行中 kill/reopen | 在新服务 claim 后、spawn 后、证据写入前的接线边界杀 owned 测试宿主；新实例只恢复检查、不重发；不重新铺一套 129 后端测试 |
| 旧 1.2 来源 | 旧 journal、独立 `.json.tmp`、旧 lock 无 seal 均通过产品状态返回不可 apply；原字节保留；不调用 createLegacySource 认领、不换新目录 |
| 封存 restore 与改写 | 复用已验收结构的合成封存来源，从产品服务恢复；导入后改写来源仍阻断，证明 service 没有跳过 F3 来源校验 |
| 账户/撤单/回报不足 | 只给券商名、同后缀两账户、无交易日、缺字段的旧成功字符串、stdout 超限/解析错误均不能成为成功证据；完整合成事实走通正向 |
| UI 可见性与隐私 | 启动未加载、恢复、人审、原生弹窗待处理、退出未知都有独立提示；导出不含账户/订单/ID/路径/proof/BLOB/原始异常 |
| 非 Mac 与无 ABI | 真实平台分支拒绝交易；ABI/目录错误不启动原生脚本、不影响研究页面；生产不存在环境变量开启 fake/live 能力的后门 |

所有可执行测试只使用 K 盘全新 fixture、实际 SQLite 文件及真实 owned 无害子进程，不使用系统 osascript/THS/网络/券商/Keychain/主库。平台、对话框与事实观察可在构造依赖中隔离；不能让真实持久化、claim、launchExecutor、退出 proof 被 mock 绕过。UI mock 结果只证明展示；至少一条正式 service/IPC 链必须穿过真实后端和 owned child。

可继续使用既有 Node20 与隔离 ABI115 作后端接线检查；不得重建现有 native module。Electron 运行时 ABI 不兼容时记录该段未覆盖，不换绑定后冒称 Electron 已通过。

## 8. 实现完成与最终放行边界

最小交付顺序：先 service/lifecycle 与固定 IPC，再第 5.3 节真实 native 观察/执行/回报协议和现有人工确认替换，最后同一面板的持久状态/恢复/人审及第 7 节定向证据。三者未一起接通，不以“后端方法已被调用”宣布 1.3 完成。生产观察只留 stub、正向只靠依赖注入、或所有生产交易永久 blocked，均不满足本轮实现目标。

本轮可签的是：**1.3 产品入口的隔离订单意图接线合同**，并另列 native 观察协议的实现审查结果。必须同时证明正向新单与恢复后新单确实能走到唯一 owned 执行器，以及各种不确定状态不可绕过；不是增加一组只测 helper 的实验。没有真实设备兼容证据时，不签原生可用或发布完成；有旧 journal 未可信迁移时明确这些用户的路径尚未完成，不把保守阻断算升级完成。已发布 1.2 保持原字节，不为赶进度公开发布功能退化的 1.3。

尚未覆盖的真实差距：Mac arm64/x64 的 Electron SQLite ABI/打包路径、权限与 fullfsync、真实客户端账户可区分字段和版本兼容、真实交易日及唯一委托观察、券商确认弹窗之后的实际行为、真实断电、未知旧 1.2 来源的可信冷交接、孤立原生执行器的可用恢复方案，以及真实券商权限/受理/成交。当前无法证明的能力必须在产品显示不可用或待核对，不得用隔离合成事实替代。

这些缺口不要求用户回答技术问题，由实现与主代理按边界推进；任何真实交易仍须账户本人逐笔明确确认，不能由既有“自动修复/隔离验收”授权推导出来。

### 给 Sol 的执行交接

输入为第 1 节六 hash、当前产品入口及本设计；产品改动仅限第 2 节接线文件与第 7 节现有测试体系中的必要用例。第一批产出必须包括真实 native 观察协议，而不是只提交 service mock。F3 三实现默认保持不变，发现 API 缺口先给具体最小变更范围，不另建一套后端或修改安全语义。

开发证据分别列出：生产入口实际调用图、native 字段读取/解码实现、真实 SQLite/owned child 接线结果、UI 状态与去敏反馈、未完成旧源迁移及真实设备差距。不得操作本机已安装 data、NSIS、真实 THS/券商/Keychain，不安装或重建依赖，不自动发布；不用重跑原 129 项代替上述新链路证据。完成后交 Astra 定向独立验收，不代签产品或原生结论。

