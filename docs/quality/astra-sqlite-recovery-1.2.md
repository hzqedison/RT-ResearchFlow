# Astra 独立验收：SQLite 订单意图恢复 F3（1.2 待集成）

日期：2026-10-08。验收人：Astra。结论：**F3 后端完整合同 FAIL，不放行接线或产品验收。**

六文件原字节与交付 SHA 全部一致。Astra 独立执行的冻结正式套件 **118/118 通过，0 skip，退出 0**；另行编写的真实文件/受控进程探针 **11 通过、3 失败，退出 1**。三个失败归为两个 P1 阻断：冷交接证明缺少实际写者来源与永久入口退役约束；执行器启动在持久化耗时后不复查有效期。不能用正式套件全绿覆盖这些行为反例。

本次完全不继续 D0，不运行安装器。实现和正式测试只读，未进行 Git、push、publish、依赖安装或重建。仅新增本报告及 K 盘独立副本、探针、日志和数据库 fixture；历史报告、失败现场和 rename EPERM 未知原因均保留。

## 1. 阻断发现与最小修复范围

### P1 / F3-A：退出能力证明的是无关子进程，不是来源目录的全部旧写者；保留旧 lock 时入口也未永久退役

代码位置：[能力签发](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:117)、[保留已有 lock](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:130)、[入口重新启动判断](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:104)、[能力验证](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:61)、[恢复消费能力](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentRecovery.ts:105)、[已导入后停止读取旧来源](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentRecovery.ts:80)。

`WeakMap` 能拒绝 JSON 伪造能力，但能力签发仍只要求“这个 coordinator 至少启动过一个子进程，且自己的子进程都退出”。构造新 coordinator 不需要证明自己拥有该来源的旧写入口。`entryName` 是调用方给的名称，目录身份和 lock hash 不能补足实际写者来源。`retired` 只属于当前对象；已有普通 lock 被保留时，新对象又只识别 `mac-ths-retired-v1`，因此也能重新启动同一入口。

**独立反例 A1：仍活着的实际旧写者被无关退出证明覆盖。**

1. 在全新隔离目录中，通过 coordinator A 启动真实受控 Node 写者 PID `46632`，写入旧 experiment journal 和普通 lock，然后等待 IPC 命令；未修改任何生产代码或伪造能力。
2. 同目录创建 coordinator B，只运行 `process.exit(0)`，PID `46352`。B 的 `retireLegacyEntry()` 正常签发能力；私有持久 proof 的 `instances` 只有 `46352`，`retiredEntry=unrelated-entry`，不含仍活着的实际写者。
3. 将这个真能力交给真实 SQLite store，得到 `ownerProof=sqlite_and_legacy_quiesced`、`evidence=verified`、`canApply=true`；恢复提交的 `sourceComplete=true`、`requestCount=1`。
4. 通过仍持有的实际 ChildProcess 对象向 A 发 IPC，A 确实继续写入第二个旧 requestId `91f7ef34-4dbc-41d3-b1da-bb254eaf7025` 并确认写入。SQLite 没有这个 tombstone，但此 ID 随后被 `createIntent` 接受为新意图；恢复检查仍为 `READY`。
5. 仅在探针清理阶段强杀 A 并等待它的 `close`，因此不存在“把已退出写者误报为活着”的推断。

该反例已经穿过真实恢复事务与公开业务 API，不只是 capability 字符串检查。证明中的实例退出是真的，**把该实例等同于来源目录已经停写才是错误**。这会漏掉旧请求永久并集，而非仅影响展示。

证据：[反例 A1 完整结果](K:/AI/person/money/.tmp/astra-f3-ovkWzW/cold-source-not-unrelated-exit-FRh9EK/result.json)。

**独立反例 A2：保留原 lock 后，新 coordinator 能重新打开已退役入口。**

同一隔离目录预放普通 `retained-original-lock`，通过受控实例正常退出和 retire；原 lock 按合同保留。随后创建同目录、同入口名的新 coordinator，`launchLegacy` 未拒绝，真实 PID `44316` 成功写出 `reopened-entry`。原 lock 原样保留，但入口永久退役并未成立。

证据：[反例 A2 完整结果](K:/AI/person/money/.tmp/astra-f3-ovkWzW/retirement-survives-new-coordinator-ejpKru/result.json)。

**交 Sol 的最小修复范围：** coordinator 的可信来源、签发条件、跨对象/进程入口生命周期，以及恢复侧必要的能力消费检查和对应回归。不能把“任意现有目录 + 一个新启动进程退出”当作冷封存来源；必须由拥有该来源写入口的受控监督链证明相关生产者均退出、入口均退役，未知来源返回 `LEGACY_WRITER_UNFENCED`。保留原 lock 时，可采用独立持久退役证据/入口约束，但不能覆写旧原件或只依赖内存布尔值。修复须同时保留真正受控来源可导入、人审后可创建新意图的正向路径；不能简单禁用全部恢复来宣称通过。

### P1 / F3-B：`launch_pending` 的同步持久化越过行情截止后，仍会启动执行器

代码位置：[启动许可时限检查](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:737)、[先写 launch_pending 再启动](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:748)、[生产 coordinator 的实际 spawn](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:90)。对照：[claim 返回前的期限复查](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:933)。

`claimExecution` 已覆盖提交后的期限，但新增加的 `launchExecutor` 只在写 `launch_pending` **之前**检查许可。该同步 SQL 写入结束后直接调用 `coordinator.launchExecutor`，没有重新检查单调期限、行情/确认截止或墙钟回退。

**独立反例：** 在真实独立 SQLite 连接上安装测试专用 TEMP trigger 和同步 SQL 函数，仅让 `launch_pending` 的 UPDATE 等待到行情截止后 120ms；没有替换 claim、UPDATE、coordinator 或 spawn，也没有修改系统时钟。行情有效期 1800ms，claim 正常返回许可，启动入口调用时尚余约 1402ms。

| 实际观察 | 值 |
|---|---|
| 行情截止，Unix ms | `1791444960012` |
| 调用 launchExecutor，Unix ms | `1791444958610` |
| 真实受控子进程 PID | `48936` |
| 子进程写出启动证据，Unix ms | `1791444960413`，已超过行情截止 `401ms` |
| 启动拒绝 | 无，`rejection=null`、`launched=true` |
| 持久状态 | `UNKNOWN` 和唯一 attempt 保留；子进程自然退出后以真实退出能力写入 `exited` |

这证明真实启动路径的检查顺序有缺口。延迟由探针注入真实 SQL 执行，不是一次自然磁盘故障的根因诊断；子进程只写隔离 marker，绝无真实交易。这是 F2 的新增启动边界遗漏，不能因旧 claim 测试通过而宣称整个执行链不回归。

证据：[反例 B 完整结果](K:/AI/person/money/.tmp/astra-f3-ovkWzW/launch-rechecks-post-storage-deadline-j0nACs/result.json)。

**交 Sol 的最小修复范围：** `launchExecutor` 在所有启动前持久化完成后、实际 spawn 紧前，再验证同一份不可续期许可；覆盖行情、确认、单调时间和墙钟回退。失败时烧掉许可，保留 UNKNOWN/attempt/tombstone。对于确知从未 spawn 的分支，应有可靠的未启动处置，不能让一次过期永久卡在 `launch_pending`；对于可能已 spawn 的分支仍不得猜测退出。增加真实 owned 子进程与慢存储边界的拒绝/正常成功两侧测试。

## 2. 已实际通过的有界行为

下表是已取得的证据，不构成在上述阻断未修复时的整体 PASS。

| 合同项 | 独立执行结果及证据边界 |
|---|---|
| 会话独占跨 COMMIT | 自写探针的 owner PID `42456` 已提交 claim 后继续存活，第二 store 得到 `ACTIVE_OWNER`；通过持有的 ChildProcess 强杀并等 `close` 后，新 owner 才能打开。新旧 session 不同，无 PID 存活猜测或超时抢锁。正式套件也通过真实子进程争锁。 |
| 旧意图永不重新执行 | 自写探针恢复 PREPARED、CONFIRMED、ABANDONED、UNKNOWN 后，原事件不变，均 `executionForbidden=true`。旧 PREPARED/CONFIRMED 重签被拒；旧已认领笔 `claimed=false`。原 87 用例覆盖终态、原请求/别名、行情重启与重复认领。 |
| 原始 BLOB 和永久并集 | 真正受控 fixture 写者退出后导入 310 个 requestId；旧 ID 不能作为新请求复用。13697 字节含空白/CRLF 的 JSON 和 6 字节含 `00 ff 80` 的 opaque lock，数据库 `typeof(raw)=blob`，size/hash/原文件逐字节相符；不经过文本归一化。正式套件另覆盖正式 JSON、activated、pending、所有匹配 tmp、分支映射冲突及原件保留。此正向存储证据不补足 F3-A 的任意来源证明。 |
| 恢复单事务、重复与真实 kill | 自写探针在 audits、tombstones、projections、receipt、COMMIT 前、COMMIT 后六处通过 IPC 到达点强杀真实 owner。前五处 reopen 无回执且相同 recoveryId 可重试；后提交处原回执已存在。重复 apply 不加第二 case、不重复事件/attempt，旧笔均不重发。自写六例是既有 SQLite 会话恢复，artifactCount=0；含实际导入 BLOB 的六处 kill 由本次独立执行的正式 recovery 套件覆盖，不能混称同一探针。 |
| 人审原子/幂等与绑定 | 自写探针拒绝错误 snapshotHash、revision、recoveryId；同 reviewRequestId 同输入只返回原结果，异输入冲突，human_reviews 只有一行。事件由 store 写当前 reviewingSessionId。正式套件另通过 review COMMIT 前后真实 kill、回执丢失重试、另一未知未核实仍阻断、renderer 会话字段拒绝。 |
| 核实后可以继续新意图 | 在 310-ID 导入、普通重启和真实 owner 强杀恢复三条正向路径，旧笔保持禁止执行；完成所需核实后，新账户观察、重新 enableLiveSession、新 ID/新确认才能 `claimed=true`。同参数旧 UNKNOWN 仍须关联旧 intent 并确认叠加风险。未 enable 时为 `LIVE_SESSION_REQUIRED`；这不是永久禁用实盘换取通过。这里验证的是后端许可，不是 THS 下单。 |
| 本会话 executor 退出能力 | 自写真实子进程运行时 `close=EXECUTOR_EXIT_UNPROVEN`，第二 owner 仍被 SQLite 锁阻断。伪造退出对象和错误 instanceId 均拒绝；真实 stop + wait 后方可记录退出、关闭 store。退出事实不清除交易 UNKNOWN。 |
| 孤立 executor | 本次独立执行的正式 orphan 用例中，owner 被强杀后 executor PID `18340` 心跳继续增加；新会话恢复并人审后，enable 和 close 都仍返回 `EXECUTOR_EXIT_UNPROVEN`。退出 marker 只作 fixture 清理，不当作 store 的可信退出能力。未证明新主进程已经具有可安全解除孤立 executor 的生产接线。 |
| SQLite 故障与 ABI | 正式套件真实 `SQLITE_FULL` 在 claim 和 BLOB 导入路径均不发许可、不落半笔；导入回滚后同计划可重试。BUSY、损坏结构/历史、丢失已启用库、缺 nativeBinding 均不回退空库或 JSON。IOERR 用例为显式注入，不是真实介质故障。 |
| R1/R2/F1/F4 | 原业务 suite 87/87 通过。自写 R1 再覆盖 25 个拒绝场景，含 NaN/Infinity/undefined/装箱/Proxy/getter，回调数 0、库原字节和 UNKNOWN 保留；随后 null/null 合法回报跨 reopen 仍为 null。R2 的旧行情、原/别名请求、真实子进程重启均在正式套件通过。F2 仅原 claim 边界通过，新增 launch 边界仍由 F3-B 阻断。 |

孤立执行器原始证据：[orphan-reopen-result.json](K:/AI/person/money/.tmp/mac-ths-f3-recovery-tests/case-IPupI5/orphan-reopen-result.json)、[该用例结果](K:/AI/person/money/.tmp/mac-ths-f3-recovery-tests/case-IPupI5/test-result.json)。清理 marker 不能证明 OS handle 已 signaled，本报告不将它升级为原生退出能力通过。

## 3. 运行环境、方法与结果

- 使用指定 Node `v20.20.2`，Windows x64，`process.versions.modules=115`；TEMP/TMP 均为 `K:/AI/person/money/.tmp`。
- 现有 `better-sqlite3` wrapper `12.8.0`；所有 store 显式使用 `K:/AI/person/money/.tmp/rt-sqlite-node20-kDV3Cq/better_sqlite3.node`。绑定 SHA-256：`7882c572409db26eaaa8f382bd583169e387813e03adfeafe35d50f43e58e6f9`。
- 实际 SQLite `3.51.3`，`journal_mode=delete`、`locking_mode=exclusive`、`synchronous=3`、Windows `fullfsync=0`。没有把 Windows 配置写成 Mac F_FULLFSYNC 通过。
- Vitest `2.1.9`、TypeScript 转译器 `5.9.3`。从一次捕获的原字节建立独立 snapshot；三份正式测试及其子进程转译都使用该 snapshot，未改测试文本。依赖只读引用原有 node_modules，Vitest 配置/缓存输出在独立目录。
- Astra 正式 suite：开始 `2026-10-08T07:31:32.412Z`；3 文件分别 **87、23、8** 用例，全通过，共 **118/118，0 skip**。Vitest **273.87 秒**，外层 **274929ms**，退出 **0**。这不是引用 Sol 的 277.96 秒开发日志。
- Astra 自写探针：14 个顶层场景，**11 PASS、3 FAIL**，含一个场景内的 25 个 R1 非法输入检查；外层 **25645ms**，结束 `2026-10-08T07:36:21.052Z`，退出 **1**。三个失败均为预期安全不变量被真实行为反例击穿，不是缺模块、ABI 错误或测试 skip。
- 本次未另跑 strict tsc 或全 main typecheck；Sol 提供的六文件 strict0 不作为独立类型验收。未读取或修改范围外 `diagnosticFactSyncService.ts`。

证据主目录：`K:/AI/person/money/.tmp/astra-f3-ovkWzW`。所有 fixture 保留，不删除历史数据。

| 证据 | 文件 |
|---|---|
| 原字节及转译产物身份 | [manifest.json](K:/AI/person/money/.tmp/astra-f3-ovkWzW/manifest.json) |
| 独立正式套件配置 | [vitest.config.mjs](K:/AI/person/money/.tmp/astra-f3-ovkWzW/vitest.config.mjs) |
| 完整正式运行 | [unified.log](K:/AI/person/money/.tmp/astra-f3-ovkWzW/unified.log)、[unified.json](K:/AI/person/money/.tmp/astra-f3-ovkWzW/unified.json)、[退出和计时](K:/AI/person/money/.tmp/astra-f3-ovkWzW/unified-exit.json) |
| 本轮 118 个正式测试现场索引 | [vitest-fixtures.json](K:/AI/person/money/.tmp/astra-f3-ovkWzW/vitest-fixtures.json)，含路径、用例名、Node、结果记录 SHA |
| 独立探针源码 | [independent.cjs](K:/AI/person/money/.tmp/astra-f3-ovkWzW/independent.cjs) |
| 独立完整结果和现场 | [independent-results.json](K:/AI/person/money/.tmp/astra-f3-ovkWzW/independent-results.json)、[independent.log](K:/AI/person/money/.tmp/astra-f3-ovkWzW/independent.log)、[退出和计时](K:/AI/person/money/.tmp/astra-f3-ovkWzW/independent-exit.json) |

复现使用同一冻结副本和已有环境；探针自身会新建独立 case 目录，不连接产品库：

```powershell
$env:TEMP = 'K:/AI/person/money/.tmp'
$env:TMP = $env:TEMP
$node = 'K:/AI/person/money/.tmp/rt-node20-test-Q3NSRB/unpacked/node-v20.20.2-win-x64/node.exe'
Set-Location 'K:/AI/person/money/.tmp/astra-f3-ovkWzW/snapshot'
& $node 'K:/AI/person/money/RT-ResearchFlow/node_modules/vitest/vitest.mjs' run --config 'K:/AI/person/money/.tmp/astra-f3-ovkWzW/vitest.config.mjs'
& $node 'K:/AI/person/money/.tmp/astra-f3-ovkWzW/independent.cjs'
```

上面命令是复现说明，不表示已进行第二次运行。再次运行前应另存本轮汇总证据，避免覆盖同名汇总日志。

## 4. 冻结身份

以下均为实际捕获的原文件字节 SHA-256，不做 EOL 归一化；结论只绑定这些字节，不绑定之后可能变动的 canonical 文件或未查询的 Git commit。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `electron/main/services/macThsIntentStore.ts` | 58426 | `52c172b6f3ab4e989de32d37b43d531c9bdc1d495fb2f6932f370d761aabb5fd` |
| `electron/main/services/macThsIntentRecovery.ts` | 23463 | `5738bc25aa86c1cce0c5ca7620b0108e51e69f640b0e3c9563e5ffb5ab94ec26` |
| `electron/main/services/macThsRecoveryCoordinator.ts` | 9206 | `c379556ede243476041e60f38f0e250e758eeac029774769b800c13c8d54df8f` |
| `tests/unit/macThsIntentStore.test.ts` | 53883 | `aeb099b8f3e4e3a1170529ff4684e1884eb25df920517499c238456685c9f6fd` |
| `tests/unit/macThsIntentRecovery.test.ts` | 33198 | `b942466c736a96a5516b17b17c71d2dd7f5b6b1ef42fce2b4d5afc43aa48f21f` |
| `tests/unit/macThsRecoveryCoordinator.test.ts` | 9833 | `e0cc2140addc62f12a88dd8fe36218741a70bcc05bf70a61af308b864e0fdad4` |
| `docs/architecture/recovery-design.md` | 19136 | `29289ae35de246694523df7e7cb4b02f1e52bf5121cc6b0d6d4532d421135982` |
| `docs/quality/astra-durable-order-intents-1.2.md` | 31409 | `9c0847de1354a32ba76fa32ccf1c9d0c2683a601ee734e6124ce5e857f8422d6` |

## 5. 残余风险与接线前清单

1. 先修复 F3-A/F3-B 并重新交独立验收；不得先将本轮部分通过项转述为 F3 后端完整 PASS。
2. 尚未接 IPC/app-startup。主进程必须固定唯一私有执行域路径，拒绝 renderer 提供目录/副本绕过；统一持有 owner、执行器、恢复和关闭生命周期，不能把 SQLite 锁当成旧 JSON 停写证明。
3. 原生审核/账户观察/逐笔确认必须由可信主进程入口绑定 sender、窗口、当前 session、版本和请求，不能只信 renderer 的 `native_dialog`/`distinguishable` 字符串。当前测试证明存储绑定，不证明用户实际进行了核实。
4. 孤立 executor、启动结果不明与 `launch_pending` 的生产收敛路径仍需应用级监督机制；不能拿 PID 消失、心跳、清理 marker 或人工解除 UNKNOWN 代替具体实例退出证据。当前安全阻断通过，不代表跨进程可用性已经完成。
5. Node ABI115 真实文件 SQLite 通过不等于 Electron 41 Windows/Mac ABI、Mac 文件锁/权限/fullfsync、原生 UI/THS 或真实断电恢复通过。实际电源中断、硬件/驱动写缓存、目录切换竞争未覆盖。
6. 原 87 业务套件通过不能消除历史 85/87、21/22、114/115、117/118 和 rename EPERM 未知原因；没有删除这些历史现场，也没有为其补造根因。
7. 未接券商、THS、Keychain、真实账户或主库，所有订单和账户字段为 fixture。没有真实交易或安装包验收；不签 1.2 产品实盘/原生完成。

**最终签字：Astra，F3 后端完整合同 FAIL。允许将本报告中的最小修复范围交 Sol 处理；本报告不授权实现者代签、不授权发布或真实交易。**

---

## 6. 二审阶段记录：F3-A/F3-B 修复复验（2026-10-08）

**本轮状态：最终签字暂缓，待修正 Astra 自写探针的预期后补验。不是新增实现 FAIL，也不把尚未跑完的增强场景签成 PASS。** 上述首轮 FAIL 及其冻结身份、原始反例继续保留，不以本轮结果覆盖历史。

本轮未发现新的可复现实质源码阻断。新冻结正式套件由 Astra 独立运行 **129/129 通过、0 skip、退出 0**，六文件独立 strict 检查退出 **0**。新增自写探针 **21 PASS、1 FAIL，退出 1**；唯一失败是探针错误码预期过严，而非实际放行了危险操作。A1 增强场景在该断言处中止，后半段不能计为已执行。没有修改实现、正式测试或探针后重跑来隐藏失败。

### 6.1 唯一自写探针失败的归属与待补项

失败文件：[independent-r2.cjs](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-r2.cjs:133)。原始现场：[A1 result.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/A1-owned-source-two-writers-cross-process-BNAMlM/result.json)。

跨进程观察者先对非拥有者调用 `retireLegacyEntry()`，它安全拒绝为 `LEGACY_WRITER_UNFENCED`，但该对象的内存 `retired` 已被置为 true；之后再调用同对象的 `launchLegacy`，正确返回 `LEGACY_ENTRY_RETIRED`。探针把四个返回值都强制预期为 `LEGACY_WRITER_UNFENCED`，因此断言失败。

这与首轮的“真能力覆盖活写者”不同：本轮没有签发能力或启动无关 legacy 子进程。中止前，同/不同入口名的新对象以及 create/restore 的拒绝检查已执行；但是该自写场景后续的晚到 ID、两个受控写者全部退出后封存、BLOB 与新意图整段未执行，不能追认通过。实际旧写者 PID `37740` 由探针持有的 ChildProcess 在清理阶段强杀并等待关闭，另一受控实例 PID `11368` 正常退出，观察进程 PID `45128` 正常退出。

本轮独立执行的正式 A1 用例完整通过，证据：[正式 A1 结果](K:/AI/person/money/.tmp/mac-ths-f3-coordinator-tests/case-0QtFMs/owned-source/test-result.json)。这可支持修复有效，但不冒充自写增强场景已完整执行。

另已发现自写双进程竞争用例的就绪消息监听存在潜在漏收时序风险；本次它实际通过，没有发生超时。该风险属于探针，不是产品源码问题。待用户确认后，仅修正这两处探针问题，并补跑 A1 与竞争两例；不要求 Dewey/Sol 为此修改实现，不重跑整个 129 套件，不弱化原来的安全不变量。

### 6.2 已取得的第二轮行为证据

| 检查 | 本轮实际结果 |
|---|---|
| 新建源监督权 | [createLegacySource](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:178) 只通过独占 mkdir 创建不存在的新目录；已存在的空目录和未知 journal 目录均拒绝 create、launch、retire、restore。自写真实双进程竞争中 PID `31592` 创建成功，PID `48116` 被 `LEGACY_WRITER_UNFENCED` 拒绝。该次结果有效，但监听实现的潜在风险仍如上保留。 |
| A2：旧 lock 保留与跨进程永久退役 | 同对象之外的新对象、不同入口名以及新进程均不能重启 legacy 入口，返回 `LEGACY_ENTRY_RETIRED`。[独立 A2 结果](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/A2-sealed-restore-cross-process-new-intent-WGRrKC/result.json)。原 JSON 的空白/CRLF、含二进制字节的普通 lock 原样保留。 |
| restore 正向与业务可用 | 新进程仅通过 [restoreLegacyQuiescence](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:201) 恢复已有封存证明，成功导入四份 BLOB；旧 LEGACY_UNKNOWN 人审后仍 `executionForbidden=true`，新意图 claim 成功，且真实受控新 executor PID `16000` 执行了隔离 marker 并正常退出。不是全面禁用恢复换取通过。 |
| supervisor 崩溃不能冒认 | 自写 supervisor PID `39852` 在受控写者正常退出、但尚未写封存证据时被真实强杀；新 coordinator 的 create/launch/restore 均拒绝，没有借新 no-op 重新证明旧来源。 |
| 封存篡改和导入后来源变化 | 六个独立 fixture 分别改 journal、旧 lock、监督记录、退役记录，新增 tmp，或移走 journal 并保留原件。restore 和原能力验证均拒绝；已导入 store 及 reopen 均为 `LEGACY_WRITER_UNFENCED`，晚到 ID 不能新建，requestCount 仍为 1，已存原 BLOB 不变。[恢复侧持续校验](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentRecovery.ts:101)。 |
| B：真实慢 SQL 越过 quote/confirmation | 在真实 SQLite 的 `launch_pending` UPDATE 上注入同步等待；quote 截止 `1791447457646`，UPDATE 返回时 `1791447457760`；confirmation 截止 `1791447461987`，UPDATE 返回时 `1791447462090`。两者均在实际 spawn 前拒绝，coordinator owned executor 表为空，未写禁发 marker。原 UNKNOWN/attempt/ID 保留。 |
| B：时钟和参数准备 | 固定墙钟、单调时间推进 30000ms；或 launch 过程中墙钟回退 1000ms，仍晚于确认时刻；或参数 getter 等到原行情截止之后。三种场景均 `EXECUTION_PERMISSION_EXPIRED`，没有续期或启动旧 executor。[同票有效期](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:741)、[参数准备后紧前检查](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:218)。时钟替换仅在探针进程内，未修改系统时钟。 |
| B：not_started 可用性 | 上述五个拒绝场景均持久为 `not_started`、instance=null，旧票再次 launch 被拒、旧 claim=false；每例随后 close/reopen/recover/人审并创建新关联意图，真实新 executor 均成功运行，PID 分别为 `48276`、`35316`、`29152`、`35088`、`33060`。旧 attempt 不被重新启动，未形成永久锁死。 |
| B：不得用错误码伪装未启动 | 真实 executor PID `38748` 已启动后注入 running 状态 SQL 错误；另一次 PID `34772` 已启动后由测试包装器抛出同名 `EXECUTION_PERMISSION_EXPIRED`。两者均保留 `launch_pending`，不因错误码相同而写 not_started；[本地 sentinel 身份判断](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:768) 生效。新进程恢复并人审后 enable/close 仍为 `EXECUTOR_EXIT_UNPROVEN`。 |
| 拒绝后的清理写入失败 | 确知没有 spawn，但写回 not_started 的 SQL 被注入失败，返回 `STORAGE_IO`，保留 `launch_pending`；reopen 与人审不把不完整的持久证据改成成功。该保守状态的生产恢复可用性仍属于后续应用级接线，不等于已完成。 |
| 封存恢复强杀收敛 | 自写两个真实 owner 分别在恢复 COMMIT 前、后被强杀，PID `23084`、`43532`。重开使用原封存 restore，不另造写者；前者 BLOB/case 回滚、原 recoveryId 可重试，后者原回执已在。最终均为四份原字节 BLOB、一个旧 request，重复 apply 幂等；人审后真实新 executor PID `45244`、`45096` 成功。正式 recovery 套件另完整覆盖六个恢复 kill 点。 |
| 原业务及孤立执行器 | 原 store 测试字节不变，87/87 独立通过；恢复 24/24、coordinator 18/18。含 R1/R2、旧意图禁执行、永久并集、人审绑定/重复及孤立 executor 阻断。孤立用例结果：[test-result.json](K:/AI/person/money/.tmp/mac-ths-f3-recovery-tests/case-hw3nUO/test-result.json)。 |

### 6.3 本轮运行与冻结身份

- Node `v20.20.2`、Windows x64、ABI115，沿用用户指定的既有 SQLite nativeBinding；TEMP/TMP 均为 K 盘 `.tmp`。未安装、升级或重建依赖。
- 本轮正式套件从原字节冻结副本执行，开始 `2026-10-08T08:10:56.917Z`，Vitest **272.41 秒**，外层 **273452ms**，退出 **0**。没有采用开发的 278.22 秒日志作为独立证据。
- 自写探针结束 `2026-10-08T08:18:07.944Z`，外层 **45113ms**，退出 **1**，实际统计严格保留为 **21 PASS / 1 FAIL**。
- 六文件 strict：`strict=true`、`noEmit=true`、ES2022、Bundler resolution、`skipLibCheck=true`（仅跳过依赖声明检查），退出 **0**，外层 **2305ms**。未运行全局 main tsc，未修改并行源。
- 本轮仅追加本报告和 K 盘独立证据，未改实现、正式测试、版本、IPC、应用启动入口或发布状态。

| 文件 | 本轮原字节 SHA-256 |
|---|---|
| `electron/main/services/macThsIntentStore.ts` | `1f81a7925f9821d6a181914017b2e7b7f0c79a027c0752607358ba3ab23cc55d` |
| `electron/main/services/macThsIntentRecovery.ts` | `8be1d83637bab6eb85320a92021f97b17ca7e346b7feba742aea6a2bf5ba7616` |
| `electron/main/services/macThsRecoveryCoordinator.ts` | `0ef172c8a9ea73698a131a94ed1df5c660d8188e909fe55f6b6f2f8f4b136ccf` |
| `tests/unit/macThsIntentStore.test.ts` | `aeb099b8f3e4e3a1170529ff4684e1884eb25df920517499c238456685c9f6fd` |
| `tests/unit/macThsIntentRecovery.test.ts` | `50866e38451ae960753b15b7e513baaafee9346c0cb1b25afa64a2d52713130f` |
| `tests/unit/macThsRecoveryCoordinator.test.ts` | `ce59d3688a1913c36bdaf62a4458c69ac646d8d324df1c9f26378461f58bfb97` |

证据目录：`K:/AI/person/money/.tmp/astra-f3-r2-tymw0R`。

- [manifest.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/manifest.json)：六文件原字节与转译产物身份，子进程加载前检查转译 SHA。
- [unified.log](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/unified.log)、[unified.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/unified.json)、[unified-exit.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/unified-exit.json)：独立 129 套件。
- [vitest-fixtures.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/vitest-fixtures.json)：本轮 129 个正式用例的现场路径、结果记录 SHA 与名称。
- [independent-results.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-results.json)、[independent.log](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent.log)、[independent-exit.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-exit.json)：21/1 原始结果，不覆盖。
- [strict 配置](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/tsconfig.strict.json)、[strict.log](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/strict.log)、[strict-exit.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/strict-exit.json)：仅六文件类型检查。

### 6.4 本轮放行边界

尚不签最终 F3 PASS，待用户确认修正自写探针并完成 A1 增强切片。本轮的证据缺口归属于验收探针，不能转写成源码缺陷，也不能据此要求实现者改成另一个错误码。

即使补验通过，也只限于可信主进程、独立本地 SQLite、从新目录建立的受控叶子写者及完整封存记录这一后端合同。封存记录是私有完整性证据，不是对恶意同用户重写的密码学证明；不支持认领任意旧目录、未知外部 writer 或任意 detached 写者树。此前列出的 IPC/app-startup、Electron/Mac ABI、Mac 权限/fullfsync、真实断电、原生确认/账户以及孤立执行器的生产恢复接线，仍不得宣称完成；不授权真实账户、THS、Keychain、主库、网络、安装或发布操作。

## 7. Astra 第二轮最终签字：F3 后端合同 PASS

签字依据截至 **2026-10-08T08:26:14.652Z** 的独立运行结果。本节完成第 6 节暂缓签字项；首轮 FAIL、原始增强探针失败及二审阶段记录全部保留，不作追溯性改写。

**结论：在下述六份冻结字节及限定信任边界下，F3 后端合同 PASS。** 首轮 F3-A 的来源监督权/冷交接反例及 F3-B 的实际启动前期限反例已完成二审关闭。此次补跑未发现新的实现阻断项。这不是 IPC、现有应用接线、Mac/Electron 原生、断电或实盘验收通过。

### 7.1 探针修正，不是产品修复

用户明确批准后，仅另存修订版独立探针，并补跑受影响的 A1 与跨进程来源竞争两例；产品六文件未由 Astra 修改，129 正式套件未重复运行。

- 原 A1 错误发生在跨进程观察者已调用退役入口后，又尝试启动旧 writer：产品返回 `LEGACY_ENTRY_RETIRED` 是有效拒绝，原探针却只接受 `LEGACY_WRITER_UNFENCED`。原日志仍为 **21 PASS / 1 FAIL、exit 1**，不能改称原运行全绿。
- 修订版精确要求该次 `launch` 为 `LEGACY_ENTRY_RETIRED`；该观察者的 `create`、`restore`、`retire` 仍必须为 `LEGACY_WRITER_UNFENCED`。没有宽泛吞异常，也没有把任意错误都当作拒绝成功。
- 修订版继续执行原来被断言截断的完整后半段，并增加未授权操作前后原字节、拥有者集合与实例证明断言。竞争例仅修正就绪消息监听的挂接顺序，仍要求恰好一个创建成功、另一个被拒绝。

原探针：[independent-r2.cjs](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-r2.cjs)，SHA256 `2b9b2af5d9dc67b90ddbf90396e612a92abd76601353509625320e5ded7f44fa`。

修订探针：[independent-r2-recheck.cjs](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-r2-recheck.cjs)，SHA256 `346da7ffa958046068d79fc8596f3f0726ba557ea4653770bc1197b0d13c3781`。

变更记录：[probe-revision.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/probe-revision.json)。原始 [independent.log](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent.log)、[independent-results.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-results.json)、[independent-exit.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-exit.json) 均保留。

### 7.2 两例补跑的实际行为证据

环境仍为 Windows x64、Node **v20.20.2 / ABI 115**、既有隔离 `better_sqlite3.node`；实际文件 SQLite 和本次拥有的真实子进程，不接触真实业务系统。

**A1，PASS，3905 ms。** 独立现场 `A1-owned-source-two-writers-cross-process-S6qucO`：

- 两个真实旧 writer 为 **PID 18152、36088**。未授权对象及其他入口不能启动旧 writer，未授权 `legacy` 集合保持为空；跨进程观察者 **PID 47968** 回报 `ownedLegacyCount=0`，四项拒绝码与 7.1 精确匹配。
- 未授权尝试前后 journal、旧 lock、supervision 三份原始字节完全相同。随后真 writer 的受控追加确实发生；在其仍活动、尚未具备封存证明时，恢复仍被阻断，恢复记录及永久请求集合没有被这次拒绝尝试提前写入。
- 真拥有者退役等待真实 writer 退出，不以 PID 猜测或新建空 writer 替代。两实例均实际结束为 `code=0, signal=null`；封存证明列出两枚独立 instanceId、两个实际 PID、`retiredEntry=actual-entry`，并绑定原始 supervision 字节哈希。
- 原 lock 保持 `preserved-original-live-lock`，SHA256 `b85c3657b2472d25defa31e5db9d010d4aa7e7c2725d922f3ae8f3abf562fd28`；原 supervision SHA256 `8098c10437b5046a9867ade2cd138cdd07bbf15a2915d5be5877aff9ad10839c`。正常受控追加后的 journal 与封存记录一致，不把这次合法写入误记成“全程旧 JSON 未变”。
- 恢复 receipt 为 `STORAGE_RECOVERED_REVIEW_REQUIRED`，`sourceComplete=true`、`intentCount=1`、`requestCount=2`、`artifactCount=4`；两枚旧请求 ID 都被永久保留且不能重新创建执行。`recoveryId=e739d61fddb2bab775654e7fdaccc56894175582cb4e9b34fadcc6a9291cf45e`。
- 四份审计 BLOB 为旧 journal、旧 lock、supervision、retirement，逐份断言原始字节与哈希相等。旧意图仍在 `executionForbiddenIntentIds`，没有因人审复活旧票。
- 人审后新意图 `7f501760-6723-4ad3-b86d-1c6d011ffddb` 成功 claim，真实新 executor **PID 7128** 执行独立 marker，真实退出证明被登记；不是只检查“允许创建”的返回值。两 writer、观察者和新 executor 的最终清理记录全部为实际 `code=0, signal=null`。

**跨进程来源竞争，PASS，1102 ms。** 独立现场 `cross-process-exclusive-source-creation-8jSsw1`：**PID 41164** 创建成功，**PID 38604** 返回 `LEGACY_WRITER_UNFENCED`；没有第二个拥有者，两进程实际正常退出。

补跑整体 **2 PASS / 0 FAIL、exit 0、外层 5325 ms**，结束 `2026-10-08T08:26:14.6670047Z`。证据：[结果](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-recheck-results.json)、[日志](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-recheck.log)、[退出记录](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/independent-recheck-exit.json)。

### 7.3 最终独立验收统计与代码落点

| 独立执行项 | 结果 | 统计口径 |
| --- | --- | --- |
| 冻结六文件正式套件 | 129/129，0 skip，exit 0 | 87 store + 24 recovery + 18 coordinator；Vitest 272.41 s，外层 273452 ms |
| 六文件 strict | 0 diagnostics，exit 0，2305 ms | 仅六文件；依赖声明使用 `skipLibCheck`，未跑全局类型检查 |
| 原增强探针 | 21 PASS / 1 FAIL，exit 1 | 唯一失败为上述探针过严错误码断言，保留原始失败 |
| 修订后受影响两例 | 2 PASS / 0 FAIL，exit 0 | 完整 A1 + 已通过但修订监听顺序的竞争例 |
| 不重复计数的增强场景 | 22 个不同场景全部完成通过 | 竞争例重复执行不算第 23 个新场景；不把原 21/1 改写为一次 22/22 |

第 6 节的 A2 跨对象/跨进程封存 restore、未知目录禁止认领、六种封存/来源篡改拒绝、五种启动期限边界、三种不确定启动/持久化失败、COMMIT 前后 kill/reopen 收敛，以及正式孤立 executor 场景，仍作为本次最终结论的一部分。没有用开发 129 绿代替独立执行，也没有用 `not_started` 掩盖可能已启动的实例。

- 来源新建与独占监督：[macThsRecoveryCoordinator.ts:178](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:178)；既存未知目录不能认领。
- 持久封存验证与只读恢复能力：[macThsRecoveryCoordinator.ts:95](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:95)、[macThsRecoveryCoordinator.ts:201](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:201)；恢复证明不重新授予旧 writer 启动权。
- 真实 writer 退出后封存并保留旧 lock：[macThsRecoveryCoordinator.ts:243](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:243)；导入后来源再变化仍阻断：[macThsIntentRecovery.ts:101](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentRecovery.ts:101)。
- 持久化和参数准备之后、实际 spawn 紧前再查期限：[macThsIntentStore.ts:737](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:737)、[macThsRecoveryCoordinator.ts:218](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsRecoveryCoordinator.ts:218)。只有同次调用的确定 pre-spawn 拒绝哨兵可回写 `not_started`，未知启动保留保守状态。
- 原始 BLOB、永久 ID 并集与单事务恢复：[macThsIntentRecovery.ts:281](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentRecovery.ts:281)；人审版本/请求/会话约束：[macThsIntentRecovery.ts:327](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentRecovery.ts:327)。

### 7.4 最终绑定的六份原始字节

以下是本轮读取时逐项匹配用户 manifest、并捕获为隔离测试快照的 SHA256。补跑使用同一快照转译产物，不以正在变化的其他项目源码替代；本结论不自动适用于后续任何改动。

| 文件 | SHA256 |
| --- | --- |
| `electron/main/services/macThsIntentStore.ts` | `1f81a7925f9821d6a181914017b2e7b7f0c79a027c0752607358ba3ab23cc55d` |
| `electron/main/services/macThsIntentRecovery.ts` | `8be1d83637bab6eb85320a92021f97b17ca7e346b7feba742aea6a2bf5ba7616` |
| `electron/main/services/macThsRecoveryCoordinator.ts` | `0ef172c8a9ea73698a131a94ed1df5c660d8188e909fe55f6b6f2f8f4b136ccf` |
| `tests/unit/macThsIntentStore.test.ts` | `aeb099b8f3e4e3a1170529ff4684e1884eb25df920517499c238456685c9f6fd` |
| `tests/unit/macThsIntentRecovery.test.ts` | `50866e38451ae960753b15b7e513baaafee9346c0cb1b25afa64a2d52713130f` |
| `tests/unit/macThsRecoveryCoordinator.test.ts` | `ce59d3688a1913c36bdaf62a4458c69ac646d8d324df1c9f26378461f58bfb97` |

冻结映射：[manifest.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/manifest.json)。正式独立证据：[unified.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/unified.json)、[unified.log](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/unified.log)、[unified-exit.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/unified-exit.json)、[vitest-fixtures.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/vitest-fixtures.json)、[strict-exit.json](K:/AI/person/money/.tmp/astra-f3-r2-tymw0R/strict-exit.json)。

### 7.5 剩余接线与保证边界

- PASS 限定可信主进程、受保护私有状态、同一进程能力模型、真实本地 SQLite，以及从不存在的新目录建立的受控叶子 writer。封存 hash 不是抵抗同用户恶意伪造整套私有状态的密码学认证。
- 不能自动认领未知旧目录、任意外部 writer 或任意 detached 后代。生产旧源迁移必须先建立可证明的监督/停写来源；不得以本次 PASS 为理由放宽这些拒绝。
- IPC/app-startup、生产 owner/coordinator 生命周期、人审身份与请求接入、孤立 executor 的保守阻断及人工处置接线，仍需另外验收。此处的新意图可执行已由真实子进程证明，不代表现有应用已接线。
- Windows Node20/ABI115 的实际 SQLite 测试不等于 Electron/Mac ABI、Mac 权限与同步落盘语义、真实断电或原生产品通过。
- 本轮没有运行 THS、券商、真实账户、Keychain、主库、安装器或网络，没有安装/重建依赖、修改产品六文件、执行 Git/push/publish。**不签产品实盘或原生完成。**
