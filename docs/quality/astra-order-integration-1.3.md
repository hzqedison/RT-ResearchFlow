# Astra：1.3 订单意图核心产品接线独立验收

日期：2026-10-08。审查角色：Astra。结论：**LIMITED PASS（限定通过）**。

## 1. 签署范围与结论

本轮未发现冻结 core 范围内的实质阻断项。新域初始化、两级确认、真实持久意图与受监督执行、掉回报后查看及人工核对、新意图、可信 legacy 显式建库与导入、重开不重发、退出等待真实进程证明的隔离合同通过。

这不是 1.3 发布批准、真实交易批准、完整旧用户升级验收或全应用原生 E2E。未知且未受监督的 1.2 journal 仍受保护，不能通过换目录、收紧权限、PID 或人工勾选伪造停写证明。未签署真实 Mac 权限/fsync、Electron/Mac ABI、AX、券商回报或断电恢复。

审查绑定用户最终原字节清单与本轮只读快照；不绑定之后变更的工作区字节。未修改产品实现、既有测试或依赖；仅创建本报告和 K 盘隔离证据。未使用 Git、网络、安装器、真实 THS、券商、Keychain、主库或已安装数据。

## 2. 独立执行结果

| 执行 | 结果 | 用时 | 口径 |
| --- | --- | --- | --- |
| 目录、service、handler 三文件 | 74 通过，0 失败，0 跳过 | 32.420 秒 | 目录 27、service 36、handler 11；独立运行，不引用开发绿灯代替 |
| Astra 12 个组合场景首轮 | 6 通过，6 失败 | 16.655 秒 | 失败均保留，不删日志、不改产品 |
| 仅受影响六例修订补跑 | 6 通过，0 失败 | 9.962 秒 | 其余六例被名称过滤，未重复运行；JSON 的 pending=6 是未选中，不是环境跳过 |

12 个独立场景的最终覆盖由首轮六项通过和受影响六项补跑组成，**不是最终同一轮 12/12 的表述**。未重跑旧 F3 129 项，未重新验收 native/UI 切片，未运行全局类型检查。开发 strict 结果没有计作本轮独立证据。

运行环境：显式 Node v20.20.2 Windows x64，ABI 115；既有 better-sqlite3 隔离 nativeBinding。TEMP/TMP 均指向 K:/AI/person/money/.tmp。

## 3. 真实行为证据

| 关注点 | 本轮实际证据 |
| --- | --- |
| 正常新域不是全 blocked | 无旧残件时启动仅展示 NOT_INITIALIZED；显式初始化后 READY_DISABLED。真实 service/store/coordinator/adapter decoder 与 owned Node 子进程完成授权、PREPARED、再次确认、持久 UNKNOWN/attempt、观察结果及退出记录。 |
| 实际目录布局 | 新增组合用例在同一 app 专属根目录放置真实合成 research SQLite 和 Browser 旁文件，建模 0755 到 0700 后仍成功执行新意图；旁库原字节、Browser 文件和子目录模式保持不变。权限/fsync 本身仍是 Windows 模型。 |
| 目录拒绝边界 | 独立目录 27 项覆盖非专属/默认来源不可信、后续路径覆盖、错属主、UID/EUID 不明或不同、owner 缺权限、真实根/祖先 junction、文件代目录、fd/path 身份变化、chmod/fsync 失败。没有递归收紧、放宽只读权限或换域避开旧 journal。 |
| IPC 与 DTO | 实际固定 handler 调用真实 service；非原 sender 对象和非主 frame 被拒绝，未知属性/原始 proof 等不能作为信任输入；通知只传 sessionId/stateSequence。确认票包含 sessionId、expiresAt、intentBinding，传输类型与服务结果一致。 |
| 确认等待失效 | 已持久 PREPARED 后暂停真实 native-confirmation 包装的异步返回，分别触发冻结 main 的导航撤权/关闭撤权、disableLive、shutdown，再返回批准。六例补跑中的四例均证明无执行子进程启动、无 attempt、意图持久 ABANDONED，授权不继续。 |
| UNKNOWN 后本人查看与核对 | 真实执行子进程只输出不可接受的旧字符串回报，服务保留 UNKNOWN。通过 handler 查询委托/成交只启动辅助查看，不增加执行次数；换新 requestId 仍被 REVIEW_REQUIRED 拒绝。 |
| 人审 CAS 与后续新单 | 错 revision、错 snapshotHash、错 recoveryId 被拒；still_uncertain 保持未决并使旧 revision 失效；正确当前绑定人审后旧意图仍 UNKNOWN、永久禁执行，新授权及显式关联的新意图可以真实执行。旧票重放被 EXECUTION_FORBIDDEN 拒绝。 |
| 可信 legacy 显式链路 | 真实受控 Node writer 写合成 JSON，coordinator 等真实退出后封存；服务先拒 initialize，再经 handler 显式 provisionLegacy、apply、逐条人审、重新授权，新意图可执行。旧 lock 与包含 CRLF 的 JSON 原字节保留，旧请求 ID 不执行。 |
| 重复恢复、重开与稳定 ID | 相同 apply 不重复变更意图版本；错误计划版本/摘要不应用。服务关闭后重开不启动 native command、不增加执行次数；恢复、人审、新授权后才执行新意图，旧 UNKNOWN 与禁执行事实保留。 |
| 退出必须有实际 proof | 使用真实 owned 延时 Node child，单独延迟或拒绝 proof 取得。期间 child 未退出、数据库仍打开，第二真实 service 被 ACTIVE_OWNER 拒绝，原 service 不再接受新执行。随后调用原生产 stopExecutor，只有获得真实退出并持久 executor_state=exited 后才关闭数据库；F3 重开投影仍 UNKNOWN。未用 PID 猜测或伪造 proof 作为正控。 |
| main 退出异常 | 对冻结 main 的原样 AST 提取函数体执行：订单 shutdown 拒绝时不 quit、不 relaunch，保留可见失败状态；再次显式退出成功后才继续。研究任务 8 秒宽限期到达不能替代待定订单退出证明；重复 before-quit 不并发启动第二条退出链。 |

原三项问题的本轮处置：DTO 缺字段已修；provisionLegacy 为显式可信封存入口且不接管未知来源；同会话已证明退出的 UNKNOWN 可以只查看，不再被交易门禁永久挡住。

## 4. 探针首轮失败及修订，不是产品修复

首轮失败源码、6 条失败断言、完整日志和 fixture 全部保留。

1. 两例窗口失效探针只改变 Electron 替身的窗口/frame，没有触发 main 原有撤权事件，因此“不再执行”已成立，但 liveEnabled=false 断言失败。修订将冻结 main 的原样事件回调绑定到替身事件入口，再触发导航或关闭；没有给产品增加补丁。
2. 四例在末尾把持久 JSON body 当成带 state 字段的投影，得到 undefined。源码事实是 F3 从事件历史推导状态，既不是 body.state，也不是独立 state 列。修订通过真实 F3 重开/inspect 读取状态；保留原有无 attempt、真实退出、数据库所有权和 UNKNOWN/ABANDONED 断言。
3. 窗口两例亦使用同一修订后的持久投影读取，因此仅补跑四种等待失效和两种退出证明场景，共六例。没有宽泛吞异常，没有通过删除安全断言制造绿灯。

## 5. 关键源码位置

以下位置均绑定第 7 节哈希，不表示后续修改已复审。

- [macThsOrderDirectory.ts:29](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsOrderDirectory.ts:29)：捕获默认 app 专属域；47 开始校验当前路径/UID；81 打开目录 fd，93 仅对该 fd 收紧，96 同步，104 最终身份检查，111 关闭 fd。
- [index.ts:499](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:499)：在 configureApplicationDataPaths 前捕获来源；[index.ts:339](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:339) 的 service 启动早于 353 的 initDb。
- [index.ts:247](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:247)：保存 callerId，关闭/崩溃/销毁/主框架导航撤权。
- [macThsHandlers.ts:5](K:/AI/person/money/RT-ResearchFlow/electron/main/ipc/macThsHandlers.ts:5)：真实 sender/mainFrame 身份；34、40、46 三入口在 await 后重查 caller。
- [macThsTypes.ts:36](K:/AI/person/money/RT-ResearchFlow/electron/shared/macThsTypes.ts:36)：完整确认 DTO；[preload/index.ts:1555](K:/AI/person/money/RT-ResearchFlow/electron/preload/index.ts:1555)：固定 execute/status/recover/reviewIntent 桥接。
- [macThsOrderService.ts:277](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsOrderService.ts:277)：caller、generation、票期限重查；296 为独立查看门禁；392 为同步撤权。
- [macThsOrderService.ts:461](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsOrderService.ts:461)：稳定 ID 与旧票拒绝；507、511 后重查；523 到 531 持久确认、claim、单次 launch；537 先验证/记录退出，才处理观察证据。
- [macThsOrderService.ts:552](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsOrderService.ts:552)：initialize/provisionLegacy/apply 分支；590 在人工确认返回后重新验证旧来源证明；609 为绑定版本的人审。
- [macThsOrderService.ts:654](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsOrderService.ts:654)：等待 stopOwned、active、再次 stopOwned、store.shutdown，失败重抛且不标 closed。
- [index.ts:141](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:141)：宽限结束后仍等待订单 shutdown；[index.ts:563](K:/AI/person/money/RT-ResearchFlow/electron/main/index.ts:563)：仅成功分支 relaunch/quit，失败不在 finally 中退出。

## 6. 明确保留的限制

- Electron ipcMain、window、dialog 是对象替身；调用的是实际 handler 和服务，并非真实 Electron renderer-to-main 传输。未启动完整 app。
- main/window lifecycle 测试运行原样提取并留有哈希绑定的生产函数体，周边研究服务/窗口事件源为替身；不是完整主进程启动验证。
- SQLite 文件、跨连接排他所有权、F3、子进程与真实退出证明均为实测；账户、交易日、表格和回报内容是显式合成输入，不能证明新真实账户/native AX 观察可用。
- 目录实际路径、junction、fd、inode、旁文件与 SQLite 为真实 Windows 对象；POSIX owner/mode/fchmod/fsync 由测试钩子建模。真实 Mac 默认路径、ACL、权限收紧与目录 fsync 仍未验证。
- 重开后含旧会话 attempt 的查看路径仍保守返回 LIVE_SESSION_REQUIRED，见 service:304；需人工在 THS 原界面核对，随后按恢复/人审/重新授权继续。没有把未知 orphan 当成已退出，也不宣称所有恢复情形都已支持应用内辅助查看。
- 未受监督的旧 1.2 journal 迁移仍未完成；维持阻断不代表旧用户升级成功。
- native/UI 的 Euclid/Curie 限定结论为外部切片证据，本轮只绑定其清单字节，不代签、不重复其验收。
- 未验证 Electron/Mac ABI、真实 AX/券商、强制断电、发布安装与资产完整升级；1.2 发布标签和资产不在本轮操作范围。

## 7. 原字节身份

清单文件：[final-raw-sha256.json](K:/AI/person/money/.tmp/rt-i13-directory-check-9d1ff30e978848c9bd0c37cd498c2215/final-raw-sha256.json)。

清单原字节 SHA256：`457fba8abedd36786ca4de30f5d44851ada7ab956fff450533d0b93ae9a81c7f`。全部 14 项独立匹配；源码快照用于本轮执行，没有 EOL 归一化。

| 文件 | SHA256 |
| --- | --- |
| electron/main/services/macThsOrderDirectory.ts | `e1c35497aa6c85c5adf8e5e97be763ebe0165fd36b88394f33d63db90ee0444a` |
| tests/unit/macThsOrderDirectory.test.ts | `3dbd2efac34b612529554a5826a1d06faf6e3f7eb4d2b29844c84760b02d73f2` |
| electron/main/services/macThsOrderService.ts | `debbdea328ec84a1379a8631a6f9c035c77724839a41a393811e171421b9c7b9` |
| electron/main/index.ts | `6e75bf188809d947769bf7c53584fe8228672f71e30e46e148897fd323811528` |
| electron/main/ipc/macThsHandlers.ts | `e95f51e3ad83070d55eb7e5a2e65afb3971af2ba79e320b99257583b5f25f9b9` |
| electron/shared/macThsTypes.ts | `c1b550506bf9da63fc2e80e2742c394bf89c686bb8d29c7acb5dc96ec4da7ddb` |
| electron/preload/index.ts | `d6eb599a2054061575bbfc0a91eef4b759a11990980ab9e8d35fae67123d3906` |
| tests/unit/macThsOrderService.test.ts | `ba113cb1d95f6f056155fac2dc609d4992b4ddbc887d1f6db93e08cd0b992883` |
| tests/unit/macThsHandlers.test.ts | `571f88617f6f607416c19ef15152eee71af89706f9a5ef690df52cc5dae3b606` |
| tests/unit/macThsCore.test.ts | `b3bbfa1a4427df792e23f4a64e58c58954abdc8406be4c382d7f580d001d4923` |
| electron/main/services/macThsExecutionAdapter.ts | `536cf4cfa6bd1fe477a327d617c42666338a1c9ff5199d6dc027b1e874c3c473` |
| electron/main/services/macThsScripts.ts | `0bf657bd717a51265819f153f1d4066c9ba1e448f6590b557409fdf3950ee4c2` |
| electron/shared/macThsNativeProtocol.ts | `525325d9b44c74ecba2bf8cf9c50359debc382037ccd0b905d1639cdb2eeb4cf` |
| tests/unit/macThsExecutionAdapter.test.ts | `2e48b0d2cc2ed128f9ef1ba5ca248a4a95e3618d3e52d0d0b515f576e75d1365` |

F3 三实现仍是此前已验收身份，本轮只复用、未重跑 129 项：

| 文件 | SHA256 |
| --- | --- |
| electron/main/services/macThsIntentStore.ts | `1f81a7925f9821d6a181914017b2e7b7f0c79a027c0752607358ba3ab23cc55d` |
| electron/main/services/macThsIntentRecovery.ts | `8be1d83637bab6eb85320a92021f97b17ca7e346b7feba742aea6a2bf5ba7616` |
| electron/main/services/macThsRecoveryCoordinator.ts | `0ef172c8a9ea73698a131a94ed1df5c660d8188e909fe55f6b6f2f8f4b136ccf` |

## 8. 保留证据与复现入口

证据根目录：`K:/AI/person/money/.tmp/astra-core-i13-1pjrbm`。

- [verified-manifest.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/verified-manifest.json)：输入清单、逐文件哈希比对与 F3 绑定。
- [core-tests.log](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/core-tests.log)、[core-tests.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/core-tests.json)、[core-tests-exit.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/core-tests-exit.json)：74 项独立运行。
- [astra-core-i13.first.test.ts](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/astra-core-i13.first.test.ts)、[astra-tests.log](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/astra-tests.log)、[astra-tests.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/astra-tests.json)：首轮 6/6，原始失败保留。
- [修订探针](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/snapshot/tests/unit/astra-core-i13.test.ts)、[astra-tests-repair.log](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/astra-tests-repair.log)、[astra-tests-repair.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/astra-tests-repair.json)、[补跑退出记录](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/astra-tests-repair-exit.json)：只补受影响六例。
- [lifecycle-source-binding.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/lifecycle-source-binding.json)、[window-source-binding.json](K:/AI/person/money/.tmp/astra-core-i13-1pjrbm/window-source-binding.json)：原 main 函数/事件节点字节绑定。
- 快照含原始产品文件、三组原始测试、独立 fixture 和独立配置。实际 SQLite/child fixture 路径逐项保留在测试日志；没有自动删除失败现场。

复现配置位于快照目录，显式使用本轮 Node20 与既有 Vitest。主套件配置为 `vitest.config.mjs`；首轮组合配置为 `vitest.astra.config.mjs`；受影响六例配置为 `vitest.astra-repair.config.mjs`。本轮按用户催交要求已经收口，不追加重跑。

**签署：Astra，1.3 core 隔离产品接线合同 LIMITED PASS。**
