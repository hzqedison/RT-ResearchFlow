# Astra 独立验收：持久化订单意图 store（1.2 待集成）

日期：2026-10-08。最新结论：**R1/R2 独立复验通过，基础业务契约可交 Sol 按已定独立 SQLite/F3 设计继续实现；不放行接线、恢复功能或 1.2 包发布。** 模块尚未接线，runtime 1.1 / target 1.2 为父任务提供的版本状态，本次未重读版本文件、查询 Git 提交或验收安装包。保留历次失败、原始现场及历史 EPERM 未解释事实；本报告不是实盘成功声明。

## 最新复验：R1/R2 修复定案（2026-10-08，Node 20）

### 结论与放行边界

本次有界审查和独立测试未发现新的 R1/R2 阻断项，关闭前轮 R1、R2。F1 继续通过；F2 的提交/解锁超时与跨会话旧行情边界均通过本轮所列反例；F4 的显式 null 和审核会话回放未出现回归。允许 Sol 以这些已验基础业务语义继续实现既定 SQLite/F3，不再要求为已关闭的 R1/R2 重做同轮修复。

**这不是现有 JSON store 可直接接线的批准。** F3 尚未实现：可用的逐笔未知核查、无活动写者证据、受控恢复、旧 lock/pending/candidate 审计、永久 tombstone、恢复事务再次崩溃收敛仍须按 [F3 定案](K:/AI/person/money/RT-ResearchFlow/docs/architecture/recovery-design.md) 实现并由 Astra 另行验收。未读取、验收或修改父任务可能并行新增的 SQLite 文件。

### R1：原始数据拒绝发生在有损转换前，未知隔离不被清除

当前 [copy 原始数据验证](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:188) 先检查有限 number、普通对象/数组及每个属性描述符，用 `util.types.isProxy` 拒绝 Proxy，不执行 getter、toJSON 或隐式转换；验证后才 structuredClone。[recordOutcome](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:761) 沿用该入口。不会再由 JSON stringify 把 NaN/Infinity 归一成 null 后放行。

独立探针对两个数量字段分别覆盖 NaN、正负 Infinity、undefined、缺失、负数、小数、超订单数量、不安全整数、字符串、布尔、装箱数字、BigInt、Symbol、隐式转换对象、嵌套 Proxy 和 getter；另测顶层/撤销 Proxy、自有/继承 toJSON、隐藏字段、Symbol 字段和循环对象，共 **41 个拒绝场景**。

每一例均断言 INVALID_DATA、回调执行数为 0、完整 data 文件原字节不变、原 intent/事件/revision 不变、requestCount 不变、UNKNOWN 与 unknownPending=true 保留；预先准备的另一合法意图仍被 UNKNOWN_PENDING 阻断，拒绝不是只保留一个状态字符串。所有现场保留。原始 NaN/Infinity 反例现在均被拒绝。

随后在同一 store 写入显式 null/null 的合法回报，原样持久化并跨 open 回放，新增且仅新增一条 outcome，合法解除未知门禁，后续已确认的新笔可 claim；旧笔仍不可重放。独立撤单/部分撤单 null 正向路径亦通过，不填 0、不臆测成交数量、不将 UI 观察升级为 FILLED。完整 suite 还覆盖输入快照、hash、确认、上下文、追加关联、人工审核入口，以及 reviewingSessionId 的 store 生成与历史回放。

### R2：旧行情意图不恢复执行资格，新行情业务仍可用

当前 [quoteAuthority](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:443) 是会话内存状态；仅 [真正新建记录的分支](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:663) 在持久化提交后授予资格。命中原 requestId 或已有 intentId 的别名创建路径不会补发资格；[confirm](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:692) 和 [claim](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:728) 都检查它。格式仍为 schemaVersion=1，未通过重写旧快照、ID 或历史来“恢复”。

| 独立场景 | 结果与不变量 |
|---|---|
| 同进程重开，原 PREPARED / CONFIRMED 行情意图 | 单调时间推进 1000ms、墙钟只推进 100ms，而原行情有效期为 500ms；新 store 的重签返回 QUOTE_SESSION_REQUIRED，CONFIRMED 的直接 claim 同样拒绝。打开和拒绝均不改 data 字节/旧记录/未知门禁。 |
| 原 requestId 重放 / 新 requestId 指向旧 intentId | createIntent 返回已有记录，不提供新行情资格；后续确认返回 QUOTE_SESSION_REQUIRED。原 ID 重放不写数据；显式别名创建按原契约只增加永久 request tombstone，其后的拒绝不再写入，旧 intent/快照/hash/状态/历史保持原值。不能误称别名注册本身是“零写入”。 |
| 同会话重签和原/别名请求重放 | 不刷新原单调截止，claim 为 QUOTE_EXPIRED；拒绝不写 UNKNOWN 或 attempt，未禁用仍在有效期内的新行情意图。 |
| 同进程重开后的最新 quote 新 intent | 新 ID、新快照 hash、本会话新确认后 claimed=true；旧笔记录不变。 |
| 受控真实子进程顺序重启 | 前一 PID 40644 正常退出，后一 PID 14928 启动，sessionId 也不同。旧行情真实经过 977ms，第二进程将墙钟置于 capturedAt+100ms；重签、直接 claim、原 request 重放后重签、别名后重签四项均为 QUOTE_SESSION_REQUIRED。新采集时点的 quote 新 intent 经新确认后 claimed=true。 |
| UNKNOWN 持久化/解锁期间过期 | temp_synced、pending_removed、实际 lock-release sync，各测试正常墙钟与回退，共六例；claimed=false、attemptId=null，但持久 UNKNOWN、attempt、原始及别名 tombstone 保留，重开后不可再发。 |
| F1 三个旧绕过反例 | submit 改 maxNotional、cancel 只改价格、只改数量均为 DUPLICATE_ISOLATED；字节和 UNKNOWN 不变。 |

上述真实子进程证据是 **Node store 进程正常退出后的重启**，不是 Electron 主进程集成、强杀/断电恢复、真实行情或真实下单。时间回退由测试替换 Date.now 模拟，未改系统时钟。同进程时间边界另用可控 performance.now，二者证据分开保留。

### 独立运行、原字节绑定和保留证据

- 平台：Windows x64，Node **v20.20.2**，Node modules ABI 115；实际使用用户指定的 `K:/AI/person/money/.tmp/rt-node20-test-Q3NSRB/unpacked/node-v20.20.2-win-x64/node.exe`。TEMP/TMP 均为 `K:/AI/person/money/.tmp`，子进程继承同环境与同 Node。
- 原完整 suite：**87/87，退出 0，Vitest 121.78 秒**（外层计时 123.075 秒），Vitest 2.1.9。260 笔永久索引用例累计 75.141 秒，不是单笔交易耗时，也不是新性能承诺。
- Astra 自写、独立于正式测试文件的探针：**57/57，退出 0，15.157 秒**。41 个非法证据、3 个显式 null 正向、3 个同进程行情会话场景、6 个落盘/解锁期限、3 个 F1 反例及 1 个真实子进程重启。
- 同 Node 的双文件 strict tsc：**退出 0，2.312 秒**。未运行全主进程 tsc 或 Node 24 二次 suite，未将 Dewey 的对应开发结果计为本次独立证据。
- 一次读取停写后的源文件**原字节**，原样写入本轮专属证据目录；探针先核验其 SHA-256，再由 TypeScript 5.9.3 转译。主探针与两个子进程均核验并载入同一产出模块 hash，未引用旧探针的内嵌旧实现。下列为原字节 hash，不再采用上一轮“统一末尾换行的文本 hash”口径。
- 未查询源提交；以当前两文件原字节绑定审查对象。没有安装包或发布字节验收。正式源码/测试均未修改，仅更新本报告；探针和所有测试产物位于隔离 `.tmp`。

```text
source bytes 42455
macThsIntentStore.ts
277c77fc4694a66111915936d3603ad84b69e27c1f9bfbf914c6f0be4c71cf18

test bytes 58728
macThsIntentStore.test.ts
4bc22bc95849fb2860e6f50669a0f7bd302b09a1f5a936eddd516cd60427af9b

isolated compiled current-store.cjs
c567263bedc981855791dcdd41745a0f34285c0a65ac3e788ea3363ffca28804
```

证据入口：[suite 日志](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/suite.log)、[外层运行结果](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/suite-result.json)、[独立探针结果](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/probe-results.json)、[探针程序](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/probe.cjs)、[原字节/转译绑定](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/byte-binding.json)、[strict 结果](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/strict-tsc-result.json)。原样源文件副本：[store](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/macThsIntentStore.ts)、[正式测试](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/macThsIntentStore.test.ts)。

真实子进程单独留档：[重启前](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/016-process-restart/before.json)、[重启后](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/016-process-restart/after.json)、[前进程退出](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/016-process-restart/before.process.json)、[后进程退出](K:/AI/person/money/.tmp/astra-r1r2-20261008-1424fc4a8e6f4f47abe235ae54571215/016-process-restart/after.process.json)。同进程两种旧状态的 sessionId、时间模型和不变量见探针结果中的具名场景；对应 fixture 是本轮证据目录的 `004-reopen-PREPARED` 与 `005-reopen-CONFIRMED`。

### 残余风险与交 Sol 的最小边界

1. **下一步允许：独立 SQLite/F3 实现，不是产品接线。** 保留 R1 原始输入拒绝、F1 动作身份、不可变快照、持久 UNKNOWN/CAS、永久请求隔离、R2 不可恢复的 quote 会话资格、显式 null、store 审核会话归属等已验语义。新后端或迁入不得从旧记录反推并重建 quote 执行资格；受控恢复后的原意图，包括手动输入意图，都必须按 F3 永久丧失执行权。当前 JSON 对普通未 claim 手动意图重新确认的旧行为不构成 F3 已实现。
2. **真实业务输入仍需主进程负责。** store 的“当前会话新建”只证明 API 创建分支和时限，不认证上游真的获取了最新行情，不能把复制旧行情包装为新意图；之后集成必须从可信主进程新观察输入生成快照。测试里的 native_dialog 字段是结构化确认记录，不是实际弹窗证明；本人逐笔原生确认、发送者/主 frame、TTL、可区分但非券商认证的账户 UI 上下文复核与真实脚本协议必须沿用接线契约。绝不改成 simulation-only 或自动确认。
3. **存储及平台未验边界不变。** Windows fixture 显式模拟目录 sync，真实文件 fsync 仍运行，生产默认不跳过失败；无真实 Mac 耐久、F_FULLFSYNC、硬件断电、SQLite/Electron 原生 ABI、迁移/孤儿执行器恢复保证。完整 suite 的故障注入验证阻断，不等于可用恢复。未连接客户端/券商、运行 osascript、访问用户数据/安装版、重建依赖、触发 CI 或发布。
4. **历史 EPERM 仍未知。** 本轮未观察到自发 rename EPERM；这只能描述本轮，不能证明历史根因修复。既有故障现场、前轮失败报告和新 fixture 全部保留，不自动删 lock/pending，不用最后成功掩盖历史失败。

下一轮 Astra 应验收 SQLite/F3 的实际恢复实现与原语，并在该后端上重跑上述业务反例和新增崩溃/恢复矩阵，再单独决定接线；最终 1.2.0 安装包、目标 Mac 与真实本人确认业务验收仍未完成，不得覆盖已发布 1.1.0。

---

## 前轮复验：F1/F2/F4 修复（历史证据，以下 R1/R2 为本轮修复前状态）

**结论：F1 通过并关闭；F2 的单会话修复通过但跨新会话边界未闭合；F4 的显式 null/会话归属通过，但发现非有限数值被转换后接受的新缺陷。整体仍不放行接线或发布。** F3 只有设计，未实现；未审查父任务可能并行新增的 SQLite 后端。以下为本次独立证据，后面的首轮记录保留为历史，不以最新通过结果覆盖旧失败。

### R1 / P1：NaN、Infinity 被克隆为 null，非法回报可解除未知门禁

位置：[copy](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:183)、[recordOutcome 克隆](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:718)、[数量校验](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:273).

实际链路先经过 JSON.stringify/parse，再校验 evidence；JSON 序列化将非有限 number 变成 null。F4 新增允许 null 后，两个独立反例均被接受：filledQuantity=NaN、cancelledQuantity=Infinity。输入并不是显式 null，但结果均为 ACCEPTED_OBSERVED、unknownPending=false，落盘数量为 null，未抛校验错误。没有调用外部适配器；问题是 store 将不合法证据当成“明确未观察到数量”并推进终态。

最小修复仍限定 store/test：在有损 JSON 克隆前验证原始数量，或改为保持数值语义的拷贝再校验；只接受显式 null 或合法有限整数，不得把 NaN/正负 Infinity 当未知数量。补测上述输入、缺失值、负数/小数，并断言拒绝后原 UNKNOWN、事件和门禁不变，同时保留显式 null 的正向路径。这不是建议把未知数量强填 0。

### R2 / P1 边界：新 store 会话可在墙钟回退后重新接受过期行情

位置：[会话时间锚](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:402)、[确认时 quoteNow](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:647)。

独立反例：会话 A 保存并确认最大年龄 500ms 的行情意图，尚未 claim；单调时间推进 1000ms，但墙钟回到采集时刻后 100ms；重新 open 得到会话 B，再对同一持久意图作新的 native_dialog 确认记录。B 重建 openedAt/openedMonotonic 后计算行情仍新鲜，**claim 返回 true**。探针使用同一进程里的新 store 实例验证公开重开 API，不将其描述为已经跑过真实主进程重启。

原 F2 的 UNKNOWN 提交和解锁耗时缺陷已修好；本项是不能被“单会话单调时钟”覆盖的跨会话边界，也与 F3 已定案的旧意图不恢复执行权直接相关。最小闭合策略：旧会话行情意图在新会话不可重新锚定并取得执行许可，要求取得新行情、创建新意图并重新本人确认；不能把 open、重签确认或命中已有 requestId 当成一次新的行情观察。可由 F3 统一实现旧意图永久失效，但在实现和反例验收前，不能标记 F2 对跨会话/时钟回退也已通过。当前合法新行情和单会话正向交易路径不得被禁用来换通过。

### 本次已确认修复的行为

| 项目 | 独立反例/断言结果 |
|---|---|
| F1 submit 只改 maxNotional | snapshotHash 改变，但无追加关联的新意图被 DUPLICATE_ISOLATED 拒绝；旧笔保持 UNKNOWN。 |
| F1 cancel 只改价格 / 只改数量 | 同账户、日期、合同目标均被 DUPLICATE_ISOLATED 拒绝；不再由展示字段拆开身份。 |
| F1 合法追加 | 关联前笔但未确认追加风险仍拒绝；显式确认追加风险后新笔可 claim，旧笔仍不可重发。 |
| F2 提交/解锁期限 | temp_synced、pending_removed、lock release 各测试正常墙钟与回退，共六条路径：claimed=false、attemptId=null，但持久 UNKNOWN、原始及别名 request tombstone 全保留，重开后不可重发。 |
| F2 同会话回退 | 确认前/后分别让单调时间超过行情期限、墙钟只推进少量，均 QUOTE_EXPIRED；有效新行情仍能认领。 |
| F4 数量事实 | 七组 submit/cancel/partial 组合将显式 null 和已知整数原样持久化并回放，不填零、不推算另一数量，也不升级成 FILLED。非有限输入另见 R1。 |
| F4 交易日 | 缺失、null、非法日期及与撤单目标不符的日期被拒绝，UNKNOWN 保留；“语法有效”不代表已取得真实客户端日期证据。 |
| F4 reviewingSessionId | 输入伪造 sessionId/reviewingSessionId 均拒绝；由审核 store 自身生成会话归属；第三会话回放不改旧事件，再核实追加本次 sessionId；旧意图仍不可重发。 |

F4 的账户观察与真实目标行采集仍是后续接线职责，不能因 nullable 数量已支持就宣称真实脚本协议已经完整可用。旧未发布 JSON 快照与新校验格式的迁入兼容也须纳入 F3，不能把当前新建 fixture 的通过当旧数据迁移通过。

### 运行证据与残余范围

- 平台 Windows x64，Node v24.15.0，Vitest v2.1.9；与上轮相同。仓库声明 Node 20 范围，本次不冒充该运行时、Electron ABI 或 Mac 的验收。
- 独立执行现有测试文件：**79/79，退出 0，105.80 秒**；不是复述 Dewey 的 84.40 秒。260 笔永久索引用例累计 67.921 秒，不等于单笔交易耗时。
- 独立补充探针：**25 个场景，22 通过、3 失败，退出 2，13.113 秒**。失败对应 R2 一条与 R1 两条；探针内嵌本次已读源码快照，不依赖上一轮有缺陷的源码副本。
- 双文件 strict tsc 使用首轮相同参数，独立执行退出 0。没有运行全主进程 tsc，也未将其他并行新模块纳入此结论。
- 所有 store fixture 使用 mode=live 的业务数据但没有客户端/适配器执行；显式建模 Windows 目录 sync，真实文件 fsync 仍调用。未访问用户 profile、生产数据、安装版、券商或 osascript；未改产品代码或正式测试文件。
- 本轮未观察到自发 rename EPERM，但未定位历史根因，也没有修复或宣称消除它。现有单测保留 fixture、I/O trace 与子进程错误；本次额外 probe 也保留全部现场，不删除后用新目录的成功覆盖失败。

证据文件：[完整单测日志](K:/AI/person/money/.tmp/astra-f124-1791437373446-df95c1587d8e4/suite.log)、[独立探针结果](K:/AI/person/money/.tmp/astra-f124-1791437373446-df95c1587d8e4/probe-results.json)、[探针日志](K:/AI/person/money/.tmp/astra-f124-1791437373446-df95c1587d8e4/probe.log)、[固定源码探针](K:/AI/person/money/.tmp/astra-f124-1791437373446-df95c1587d8e4/probe.cjs)。现有单测的逐例现场位于 `K:/AI/person/money/.tmp/mac-ths-intent-tests/`；本次未作清理或全目录枚举。

本次已读源码文本 SHA-256（UTF-8，文末单换行）：

```text
macThsIntentStore.ts       640dc7f06cf1011f99ab53c355590288e8a3afe12734c3c480ae76bb49d1ca6b
macThsIntentStore.test.ts  af7cf6976c64a0c1c8b08919cfddb7121f8e9a83590077e3195a40d70d7cd345
```

交接结论：R1 交 Sol 在 store/test 两文件有界修复；R2 由父任务明确纳入 F3 的会话失效门禁及回归，或先作同范围防护。F1 不重做。仍须 Astra 独立复验新增反例；无接线、升版、打包或发布授权来自本次通过数。

---

## 首轮验收记录（历史证据，以下行号及问题状态对应首轮源码快照）


## 一、发现，按严重性排序

### F1 / P1：非执行参数改变可绕过重复意图隔离

位置：[fingerprint](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:226)、[requireAssociation](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:559)。

实际指纹将 `maxNotionalCents` 纳入买卖身份；撤单也用证券、方向、价格、数量、金额上限等整组字段，而非仅账户/日期/目标合同。

独立复现 A：真实模式快照认领为 UNKNOWN → 本人核实事件解除门禁但保留 UNKNOWN → 新 requestId，仅将金额上限从 100000 分改成 100100 分 → 不传 additionalOrder，确认记录中的 additionalOrderAcknowledged=false → **再次返回 claimed=true**。证券、方向、价格、数量、账户均未改变，实际订单没有区别。

独立复现 B：同样先核实未知撤单 → 同账户、交易日、合同 TEST123，只把快照价格从 1000 分改成 900 分 → 不关联前笔且未确认追加风险 → **再次返回 claimed=true**。没有执行客户端订单；复现的是 store 发出了第二次执行许可。

最小修复：只改 store 与对应测试。保留 snapshotHash 对所有快照字段的绑定；另定义动作专属重复指纹。submit 使用执行端/模式/账户/市场/证券/方向/实际价格/数量，不包含金额上限和展示元数据；cancel 使用执行端/模式/账户/交易日/目标合同，不用可能变化的展示字段。增加以上两个反例，以及显式关联并确认追加风险才允许重复的正向用例。不要通过停用真实模式规避。

### F2 / P1：持久化耗时跨过行情期限后仍返回执行许可

位置：[认领前行情检查](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:673)、[认领返回前检查](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:683)。

认领前校验 quote.maxAgeMs，但提交及释放锁之后只重查确认/快照期限。独立故障时钟用例设行情最大年龄 500ms，在 UNKNOWN 已落盘的 pending_removed 检查点推进时间 1000ms：确认仍有效、行情已过期，**返回 claimed=true**，盘上状态 UNKNOWN。这不是行情查询测试，也没有真实行情连接。

最小修复：同两文件。将行情剩余有效期纳入单调执行期限，并在认领提交及释放锁之后共同检查；墙钟回拨不能延长行情权利。期限已过只返回 claimed=false，保留已消费 UNKNOWN，不恢复授权。增加落盘耗时、释放锁耗时与墙钟回拨的 quote 用例。当前 handler 尚未提供行情输入，但 store 已公开接受该输入分支，不能视作正确实现。

### F3 / P1 完整切片阻断：崩溃可安全锁死，但没有受支持的恢复入口

位置：[持久锁](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:457)、[load](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:494)、[save](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:509)。

独立注入 rename 完成后的进程中断：盘上最后事件为 claimed，lock 与 pending 留存；下一次 open 返回 LOCK_BUSY。所有 inspect/getIntent/recordHumanReview 都需要先正常 open，因而不能经现有 API 读取该笔供本人核实。已有测试也明确保证中断后留锁；这证明的是 fail closed，不是“重启后可恢复”。人工只删锁仍会触发 UNCERTAIN_PERSISTENCE，不得删 pending 当修复。

最小后续范围仍是 store/test，但先由 Astra 定义恢复契约：提供结构化 RECOVERY_REQUIRED 与只读恢复证据；任何恢复写入必须证明没有活动写者、保留原锁/pending/候选文件审计，保守隔离可能执行的意图，且永不返回可重放许可。锁目前只有随机 owner 文本，没有可用于判定活动写者的协议，不能简单按 PID/时间猜 stale 或自动 unlink。只读恢复入口可先交付，但不等于完整恢复验收通过。该项是缺少恢复能力，不是发现自动重发。

### F4 / P2：真实脚本证据与审核归属仍有接口缺口

位置：[AccountContext](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:23)、[AdapterEvidence 数量字段](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:83)、[HumanObservation](/K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsIntentStore.ts:86)。

- store 要求 tradingDate、filledQuantity、cancelledQuantity；此前已读取的真实脚本只返回简单状态/合同，其内部 orderSnapshot 也未采集成交/撤单数量和行交易日。以 null 表示未观察数量的独立探针被 INVALID_DATA 拒绝，状态保持 UNKNOWN，**安全行为正确，但不能直接接线到成功终态**。不得填零或用当前日期冒充实际观察。建议证据契约显式允许未知数量，仅对已观察值校验约束；合同日期则须在适配器确实观察到目标交易日/日期范围后填写，否则保留未知。撤单快照还必须先观察目标行的真实证券/方向/价格/数量，不能从仅含 contractNo 的旧请求填占位值。
- 人工核实事件没有核实会话归属。传入 sessionId 会因严格 keys 校验被拒绝；store 自身也不追加 reviewingSessionId。建议由 store 将当前 sessionId 记录在核实事件中，不从 renderer 相信身份字段。现有 still_uncertain + 三项 scope 可承载原生“本人已核实但结果仍不确定”，无需编造合同或成交事实。
- accountContext 只保留摘要及最多四位的遮罩尾号，这是有意缩减信息，不是已实现账户识别。接线时 raw/source 可留在主进程票的内存上下文，摘要须由真实 UI 观察计算并包含来源；重启后重新观察比对原摘要，不能反推原文或宣称摘要认证了账户。遮罩不可区分时必须增加真实可区分的本机展示能力，不能把 distinguishable=true 当检查结果。该能力尚未验收。

F4 的数量/审核事件类型若采用上述方案，由 Sol 限定修改 store/test；真实观察采集属于后续经批准的 scripts/handler/types 接线，不在本次修复中顺带实现。

## 二、已确认的基础能力与边界

| 审查点 | 本次独立结论 |
|---|---|
| 不可变快照/状态机 | 严格字段白名单、规范摘要、深拷贝/冻结、事件序号/时间/合法转移校验有效；终态不能改回执行态。没有把 UI 观察标作 FILLED。 |
| CAS/跨进程 | 每次事务重新读盘；wx 独占锁、owner/文件身份释放检查与事件 revision CAS 有对应运行证据。真实子进程竞争测试只有一次 claimed。不是券商 exactly-once 保证。 |
| UNKNOWN 先行 | claim 在返回权限前持久写入 claimed/请求墓碑；提交/锁释放失败不会给权限。终态落盘失败保留此前 UNKNOWN，并进入存储隔离。 |
| 锁/fsync 故障 | 失败不跳过、不吞错；损坏/缺失/不支持版本不初始化为空。崩溃检查点与写入/fsync/rename 错误用例通过，但恢复能力见 F3。 |
| 旧日志迁入 | 读旧 JSON，保留全部仍存在 ID，不再只取 256；unknown 迁成无伪造快照的 LEGACY_UNKNOWN，原文件未改。更早已丢 ID 明确 unavailable。接线时必须停用旧日志写者；本次未与旧 handler 混写。 |
| 永久去重 | 请求墓碑及历史不淘汰；超过 256 的原 ID 仍不可再次认领。业务指纹隔离另有 F1，不可混为已完整防重复。 |
| 人工核实 | 核实只追加事件/改变该笔门禁，不把 UNKNOWN 改成成交；未核实的另一笔仍保持门禁。核实 session 缺口见 F4。 |
| 信息保护 | 无 Electron/券商/网络调用；文件创建 0600，拒绝存储凭证/额外字段/完整账户标签，文件读取拒绝符号链接及多硬链接，异常只给代码。摘要不是加密，私有目录/本机权限是调用方前提；不能宣称防同用户篡改或已验证 Windows ACL。 |

## 三、独立执行证据

环境：Windows x64，Node v24.15.0，Vitest v2.1.9。仓库声明 Node >=20 <21；因此本次不是声明运行时或目标 Mac 的矩阵验收。没有运行应用入口、真实 UI、osascript、券商、安装器、CI 或 publish。

1. 独立执行 `node node_modules/vitest/vitest.mjs run tests/unit/macThsIntentStore.test.ts --reporter=verbose`：**52/52，退出 0，84.58 秒**，与 Sol 报告的 86.14 秒是不同一次运行。永久墓碑 260 笔用例累计 62.61 秒；这是批量测试总耗时，不能说单次交易卡住 62 秒，但全量同步日志的增长成本仍需后续评估。
2. 独立执行两个文件的严格类型检查：`tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck`，**退出 0**。本次未重跑全主进程 tsc；主任务转述的该项通过仅保留为外部报告。
3. 内存编译已读取源码快照的独立探针：六个场景完成，约 2.97 秒；前三个安全断言失败，分别为 F1 两条路径、F2 一条路径；另外确认 F3 重开受阻、F4 缺失证据保持未知及审核归属缺字段。执行宿主返回非零，不作为“全通过”。其 store 快照使用 mode=live，但没有任何适配器，只有临时目录文件操作。

探针与单测均使用显式 Windows directory-sync 模型，**真实文件 fsync 仍执行**。生产默认没有跳过目录 sync，现有负向测试验证 Windows 默认路径会拒绝打开，而非无声降级。未验证真实 Mac 目录持久性、断电耐久、F_FULLFSYNC 或真实券商归因。

已读取源码文本的 SHA-256（UTF-8，文末单换行）：

```text
macThsIntentStore.ts       18f0e4e66d807100be9f2af214077de54814952ac7eb18345b7e7b57e1151b46
macThsIntentStore.test.ts  baba194b820c31d0ce033d36d9ae2f7758aa67dd831d5c28b4098ab04dd6804a
```

未读取 Git 提交或安装包字节。本次源码/测试只读，未修改。额外探针位于工作区外的 `.tmp/astra-intent-audit-1791435997054-d9e5bfc5d3bbb.cjs`，内嵌本次源码快照，保留作离线反例证据，不是修改后版本的回归脚本；探针创建的独立数据目录已由其受限清理逻辑删除。Sol 应将反例写入正式测试，而不是拿旧源码探针验收新实现。

## 四、必须保留的 Windows EPERM 事实

主任务明确报告：Sol 中途曾出现一次 Windows rename EPERM，根因未知；换新隔离目录完整重跑通过。本次独立完整运行未出现同类报错，但**没有获取该次原始失败日志、没有定位触发条件，也没有修复或证明 EPERM 已消失**。不得归因杀毒软件、并发、系统偶发或目录权限而无证据。

现有故障注入证明 rename 报错时不会给执行许可，但留下锁/pending 的后续可用性仍见 F3。下一次若出现 EPERM，应保留该隔离目录和原始错误阶段/路径/运行环境再分析，不能清目录重跑后覆盖失败记录。不得用关闭 fsync、吞 rename 异常、删除未知记录或切换为模拟模式换通过。

## 五、交回 Sol 的最小范围与复验条件

修复写范围：`electron/main/services/macThsIntentStore.ts`、`tests/unit/macThsIntentStore.test.ts`。先处理 F1/F2 和已确认的 F4 类型对齐；F3 恢复写入须先由 Astra 对齐契约，不得自行删锁恢复。禁止顺带接 IPC/脚本、改版本、旧报告、发布文件或依赖。

复验需覆盖本报告反例、原 52 用例、跨进程竞争、迟到/失败的持久化，以及明确的恢复证据分支；保留所有失败与重跑记录。Sol 完成后由 Astra 独立复核实际 API/源码与运行证据，再决定接线。即使模块通过，也只表示存储边界通过，不代表本人原生确认、账户观察、真实客户端兼容或 1.2.0 已交付。
