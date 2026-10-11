# F3 定案：独立订单库的受控恢复

日期：2026-10-08。状态：Astra 架构决策，待实现与独立验收。本轮仅设计，不读取 Sol 正在修改的文件，不执行存储/客户端测试。依据为此前已审 store、脚本、handler 和 package.json 快照。本文替代 `durable-order-intents.md` 中继续扩展 JSON 持久化及未定的 F3 恢复部分；本人确认、账户上下文、UNKNOWN 先行、F1/F2/F4 修复契约继续有效。

## 1. 决策与范围

**采用已有 better-sqlite3 依赖创建独立订单 SQLite 库，不继续扩张自制 JSON 锁协议。** 保留当前 store 的业务校验和公开用例语义，替换持久化内核；不接入或迁移主业务数据库，不重写产品，不修改本轮版本。未来运行时发布仍是 1.2.0，不覆盖 1.1.0。

| 方案 | 为完成 F3 必须承担的成本 | 决定 |
|---|---|---|
| 原 JSON + wx 锁 | 需另造活动写者证明、锁接管、多个文件的原子恢复、恢复中再次崩溃的提交记录、候选分支合并与永久索引；原随机 owner 文本不具备进程身份，文件存在不是存活证据。 | 不再作为正式运行后端；保留其格式读取与证据导入。 |
| 独立 SQLite | 复用事务、内核文件锁、唯一约束和日志恢复；仍须定义会话所有权、业务隔离、旧格式交接和原生 ABI 验收。 | 选定。没有承诺 SQLite 可以替代券商对账或解决硬件失信。 |

只用短事务是不够的：claim 提交后旧进程可能仍在操作 UI，另一个进程不能因此把它当作已死亡。因此选用**单库、单连接、整个交易会话持有排他锁**，不增加另一个自制 lease 文件或独立锁服务。

SQLite 的 EXCLUSIVE locking mode 可跨事务保留文件锁；rollback 模式的 BEGIN EXCLUSIVE 排斥其他连接，正常短事务仍用于每次业务提交。这是选型依据，不是本机运行证明。[SQLite locking_mode](https://www.sqlite.org/pragma.html#pragma_locking_mode)、[事务语义](https://www.sqlite.org/lang_transaction.html)

## 2. 无活动写者证明：两种来源，不能混用

### 2.1 SQLite 后端的强制会话所有权

1. 固定本机私有订单目录和规范化库路径，拒绝网络盘、路径别名和用户自选副本作为同一账户的并行执行库。一个交易执行域只能有一个配置的订单库，不能通过新建 profile 绕过未知门禁；跨设备/任意复制库的全局去重不在本地保证内。
2. 连接设置 rollback journal、`locking_mode=EXCLUSIVE`，显式取得 `BEGIN EXCLUSIVE` 后完成启动事务；实际持有排他锁才产生不可由 renderer 伪造的 `OwnerCapability`。同一连接跨 COMMIT 保持持有，后续短事务不释放会话所有权。设置项、实际锁行为及错误传播均须独立测试，不能只看 PRAGMA 返回值。
3. 所有 create/confirm/claim/outcome/review/recovery 写入都经该连接；禁止连接池、同进程第二连接、绕过门禁的数据库操作或在运行中切回 NORMAL。等待原生对话时不保持未提交业务事务，但仍持有会话锁。`SQLITE_BUSY` 只表示未取得所有权，不判断旧会话死亡。
4. 应用关闭先撤销内存票、禁止新执行，停止/等待本会话已启动的自动化子进程退出，再关闭连接。未完成此过程不能为了“恢复”先释放连接。异常退出由操作系统释放进程资源，下一进程必须重新实际取得排他锁，不依据 PID 数字、心跳、文件年龄或超时接管。
5. 恢复写入前再次检查该 capability 与当前连接/会话一致。连接关闭或持有状态失效即撤销能力；新的 store 对象不能复用旧能力。当前会话的唯一写者可执行恢复事务，但任何正常订单变更要等恢复门禁解除。

这个证明只覆盖遵守同一库协议的存储写者，不证明券商端没有订单，也不证明孤立 osascript 已结束。主进程死亡后可能遗留客户端弹窗/自动化，相关订单仍 UNKNOWN；应用必须记录执行器关联身份并管理其终止观察，不能用固定等待秒数冒充已退出。无法判明旧自动化是否仍活动时不解除执行门禁，应用负责引导和处理受控执行器，不让用户找进程或删文件。真实客户端的在途订单仍只能观察/本人核实，不能由进程退出推断撤销。

### 2.2 旧 JSON 来源的无写者证明

**新库排他锁不能约束旧 JSON 写者。** 因而禁止看到旧 lock/pending 就自动导入、改名或解锁。旧格式只允许走“应用控制的冷交接”：

- 启动/升级协调器关闭旧交易入口，获取相关旧应用进程的系统进程对象或等价的进程实例身份，等待操作系统报告这些**具体实例**退出；新进程尚未注册旧 handler/store，应用控制的旧写者启动入口已被关闭。`process.kill(pid, 0)`、两次相同文件摘要、用户勾选“已退出”都不是此证明。
- 协调器向导入器交付内部 `LegacyQuiescenceCapability`，含监督会话、已退出进程实例、被关闭的旧入口及来源目录身份；不能接受 renderer 上传的布尔值或可自行填写的 JSON 证明。此前启动/升级入口未审，**不能宣称现有代码已提供该能力**。必须在接线前实现并验收：受控子进程可用真实 exit/wait 事件；既有应用实例须由平台进程退出观察层确认身份与退出，不能把同 PID 的后继进程当作原实例。
- 已审 JSON store 尚未接线、未发布，因此不制造任意未知 Node 进程的线上接管协议。其开发数据只接受监督器已 wait 退出的离线 fixture，或上述冷交接封存的来源；无法证明来源无活动写者，返回 `LEGACY_WRITER_UNFENCED`，应用安排关闭已识别旧实例并重新走冷交接。任意外部写者不是可自动接管的来源。
- 原 JSON lock 存在则保留；不存在时，在取得冷交接证明后用原 wx 规则建立**永久退役栅栏**，阻止旧 JSON store 再开事务，记录其来源而不冒充旧锁。原 legacy experiment journal 的 handler 不遵守此锁，必须退役整个旧交易入口，不能把栅栏说成约束了它。同一 profile 并行运行不合作的旧版本不受新锁保护，启动/升级协调器必须拒绝该运行组合。

冷交接的进程协调属于最小迁移先决条件，不是让用户理解锁文件的运维步骤。若此先决层未实现，只能验收新 SQLite 后端，**不能签署旧数据迁入/恢复完整通过**。

## 3. 可观察契约与数据模型

```ts
type RecoveryRequired = {
  code: 'RECOVERY_REQUIRED'
  reason: 'ACTIVE_OWNER' | 'LEGACY_WRITER_UNFENCED' | 'IMPORT_REQUIRED'
    | 'INTERRUPTED_SESSION' | 'EVIDENCE_CONFLICT' | 'STORAGE_IO'
    | 'CORRUPT_STORE' | 'ABI_UNAVAILABLE'
  recoveryId: string | null
  evidence: 'unavailable' | 'verified' | 'partial' | 'conflicting'
  manifestHash: string | null
  ownerProof: 'none' | 'sqlite_exclusive' | 'sqlite_and_legacy_quiesced'
  canInspect: boolean
  canApply: boolean
  canSubmit: false
  nextAction: 'switch_or_close_instance' | 'controlled_restart'
    | 'inspect_and_recover' | 'retry_storage' | 'repair_environment'
}
```

新增用例：`inspectRecovery()`、`applyRecovery(recoveryId, manifestHash, expectedRevision)`、`getRecoveryReceipt(recoveryId)`。OwnerCapability 由内部会话持有，不是上述序列化状态里的字符串。inspect 不追加业务事件、不清门禁、不修改原件；得到一致证据需要由当前 owner 读取，或恢复进程先取得所有权。另一 owner 正活动且无法通过其受控只读接口获取快照时，诚实返回 evidence=unavailable，不能旁路读取变化中的库。

SQLite 自身可能在读前恢复 hot journal，这是取得内核锁后的数据库一致性恢复，不是“只读接口已对账”的业务事实；应用绝不自行删除 SQLite journal。[SQLite 日志恢复](https://www.sqlite.org/lockingv3.html)

独立库最小表组：`meta/session`、`intents/events`、`attempts`、`request_tombstones`、`human_reviews`、`recovery_cases/artifacts`。沿用 F1/F2/F4 修复后的快照、指纹和期限契约，不在本文重新定义。

- requestId 永久唯一，intentId 永久唯一，attempt 对 intent 唯一；事件使用 `(intentId, sequence)` 唯一键和 revision CAS。归档不删除 tombstone。约束冲突不是重试执行的理由。
- 每个恢复案例保存确定性 plan、来源格式/版本、完整文件清单、字节数、SHA-256、校验结果、来源证明及提交回执。旧 lock、pending、activated、正式 JSON 和**全部匹配的候选 tmp**原始字节以私有 BLOB 保存；原文件原名留存，不自动删、不用成功候选覆盖其他分支。
- 快照、历史和候选冲突不破坏性“修正”。原意图加永久 `executionForbidden` 和独立 `recoveryQuarantine` 投影；保留原状态/证据，使“曾观察成功但恢复存在冲突”可表达，不倒改历史事件。只有新 intent 能取得新的执行许可。
- 只读证据能验证内容一致性、约束与来源完整性，不是防同用户恶意篡改的签名。数据库、回滚文件、审计 BLOB 都限本机私有权限，禁止进入通用诊断、日志或云同步；面向本人只显示必要脱敏信息。

## 4. 恢复事务与再次崩溃的确定性收敛

**一次业务恢复只提交一个 SQLite 事务，不跨库、不依赖最后删除某个文件才算成功。** 原件不变，事务内的 backend/import 完成标记才是切换依据；失败不能退回启用 JSON 双写。使用同步事务回调，原生对话和异步观察在事务外，回来后重新校验 owner、revision 和摘要。[better-sqlite3 事务约束](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

1. 取得第 2 节证明，关闭正常执行门禁；读取并校验来源。普通 SQLite 重启先由引擎恢复一致状态，再校验 schema、完整性、外键及订单业务不变量。存在已启用库却丢失/损坏的情况不得当全新安装初始化。灾难性介质损失与正常进程中断分别报错，不能承诺从不存在的历史重建永久索引。
2. 在只读阶段生成稳定 recoveryId：摘要输入为算法版本、来源 storeId、最后业务 revision、按角色/文件名排序的原件字节摘要。新恢复进程的 sessionId/时间不进入该 ID。UI 展示逐笔计划，不因重启生成另一份“新恢复”。
3. JSON 只把通过 schema、checksum、快照及历史约束的材料作为可合并来源；正式文件有提交地位，tmp 只有“候选、可能未提交”地位。禁止按 mtime 或最大 revision 直接选赢家。将所有可验证来源中的 requestId 做保守并集，候选中的新增 ID 也永久消费；有不同映射的 ID 存冲突证据并禁止执行，不覆盖成一条看似确定的映射。
4. 任一来源出现 claim/UNKNOWN、存在不能解释的待提交分支，或提交历史相互矛盾，都保守隔离对应意图。无快照但 legacy unknown 为真则保存 LEGACY_UNKNOWN；只显示“原订单详情不可恢复”，不编造证券或账户。材料损坏且不能证明已完整保留索引/执行历史时，结构化 EVIDENCE_CONFLICT/partial，不能带着缺失 tombstone 的空库放行。
5. 所有进入恢复的旧意图永久失去执行权。旧 PREPARED/CONFIRMED 即使没有副作用证据也只能标记恢复失效/放弃，不恢复旧票或重签同一个 intent。旧 claim 保持未知；可信已落盘终态保留原观察证据，冲突则另加隔离。当前启动得到新的会话和票空间，liveEnabled 默认为 false。
6. 单个同步事务原子写入 recovery case、原件审计、tombstone 并集、隔离/失效投影、backend 标记和结果回执；`recoveryId` 唯一。提交错误不返回成功、不开放执行；重新打开后读回执判定事实，不能因调用抛错猜测“肯定没提交”。
7. 若恢复进程再次死亡，锁由系统处理，下次重新取得所有权。事务回滚则从同一原件/业务 revision 得到同一计划；事务已提交则读取同一回执，不重复插入事件或更改原件。恢复写入没有删除/改名旧证据的尾步骤，因而不存在“数据库已迁好但清文件未完成”需要猜测的分叉。

新 SQLite 会话正常重启也执行同样的失效/隔离规则：claim 未提交只能留下旧待确认意图，旧意图失效；claim 已提交但没有终态则 UNKNOWN；终态已提交就展示该证据。恢复从不生成 claimed=true。不能利用 reopen/重确认/新 requestId 把原 intent 变成可重放。

### 从存储恢复走到真正可用

存储恢复回执为 `STORAGE_RECOVERED_REVIEW_REQUIRED`，随后提供逐笔核查：显示已保存订单、账户观察、发生阶段及未知原因；保留现有打开同花顺委托/成交页的能力，由本人核对所有相关页面与弹窗。不存在可信自动查询时，只保存 human_reported，不能伪造机器成交事实。

每笔核实使用原生对话，绑定 recoveryId、intentId、snapshotHash、revision、核实会话与 reviewRequestId。原子追加核实事件及该笔 gate 决定，唯一 reviewRequestId 处理响应丢失；原 intent 的 executionForbidden 不变。只开页面、取消、旧票或未覆盖的另一笔均不能解除门禁。本人核实是业务风险决定，**不是无写者证明**。

恢复“完成”的验收含义：存储一致、原件与永久索引完整、未知逐笔可见可核实、全部需要核实的门禁已处理、所有权仍有效且已知自动化执行器不在途；这时允许本人重新启用会话并创建**新意图**，重新观察账户和逐笔原生确认。同参数新订单必须关联旧未知项并明确确认叠加风险。旧未知仍可保持 UNKNOWN，不冒充已成交/已取消。不能只展示只读列表就标注恢复完成。

## 5. 原生依赖、迁移和耐久性成本

此前 package.json 快照已有 `better-sqlite3 ^12.8.0`、Electron `^41.0.4` 和 install-app-deps 脚本，但未审 lockfile、实际 native 二进制或打包配置；**不声称现有安装物的 ABI 已兼容**。不增加新的数据库产品，不在本轮升级依赖。

Node 与 Electron 的原生 ABI 不能互相代证，需按产品实际 Electron 版本和 Windows x64、Mac arm64/x64 分别构建/加载验证；普通 Node v24 测试通过不能替代仓库声明的 Node 20 或打包后 Electron 验证。使用已有构建/重建路径前先确认其实际配置，不为本任务直接执行 install、rebuild、打包或覆盖原生模块。[Electron 原生模块说明](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

默认采用 rollback journal、`synchronous=EXTRA`；Mac 请求 `fullfsync=ON`，记录实际配置/SQLite 版本及能力。EXTRA/同步设置的含义与平台边界依据官方文档；参数读回不是物理断电耐久证明。禁止为 Windows 测试通过而在生产注入空 sync hook；ABI/IO 错误返回明确状态，不退回不可靠 JSON 实盘路径。[SQLite 同步设置](https://www.sqlite.org/pragma.html#pragma_synchronous)、[fullfsync](https://www.sqlite.org/pragma.html#pragma_fullfsync)

升级成本限定为一份订单库的 schema/import 版本及旧证据保留。主业务库不 ATTACH、不改 schema。正式启用 SQLite 后不支持降级为旧 JSON 写者；旧版本读取/写入组合须明确阻断。JSON 后端尚未发布，迁移工作主要服务隔离 fixture 和受控旧实验日志，不能借此声称已跑过真实用户升级。

## 6. 下一 Sol 的边界与最终 Astra 验收

待 F1/F2/F4 修复交付并审定后才开始恢复实现；本设计不干扰其当前两文件写范围。

| 后续文件 | 有界责任 |
|---|---|
| `electron/main/services/macThsIntentStore.ts` | 保留业务 API/校验，替换 SQLite 后端、持有 owner、事务与永久约束；不调用 UI/券商。 |
| `electron/main/services/macThsIntentRecovery.ts`（新增） | 只读计划、证据导入、确定性 recoveryId、原子回执与恢复隔离；不得接管未知 owner。 |
| `electron/main/services/macThsRecoveryCoordinator.ts`（新增） | capability 生命周期、受控冷交接、退出观察与执行器关闭协调。实际应用启动入口未读，接线前另行确认文件，不能在本文猜成已实现。 |
| `tests/unit/macThsIntentStore.test.ts`、`tests/unit/macThsIntentRecovery.test.ts`（新增）、`tests/unit/macThsRecoveryCoordinator.test.ts`（新增） | 业务回归、真实子进程所有权/中断恢复、冷交接拒绝与成功路径。 |

必要故障矩阵，先纯离线执行，不调用 osascript：

| 故障点/竞争 | 必须观察到的结果 |
|---|---|
| A 已提交 claim 但会话尚活，B 请求恢复；A 在原生对话等待 | B 无 owner、不可恢复写入；不能因没有当前 SQL 事务就接管。 |
| 杀死 A，重启 B；PID 被复用/旧心跳很久未更新 | 仅真实取得排他锁才可继续，PID/时间不能改变决策；原 intent 不再有执行权。 |
| JSON writer 仍在事务中、空闲但入口未退役、旧 experiment handler 未退出 | 冷交接 proof 不成立，导入零写入；用户确认不能越过。受控实际退出并封住旧入口后才导入。 |
| 读计划后原件或 manifest 改变、同 ID 多快照、多 tmp 分支 | 原计划不可应用；保留全部证据，隔离冲突，不按时间选赢家。 |
| audit BLOB、tombstone、隔离投影、回执提交前分别 kill；COMMIT 返回前后 kill | 只有整笔回滚或整笔提交两种业务结果；再次启动同 recoveryId 收敛，索引不缩小、原件不变、无新执行许可。 |
| human review 写前/写中/提交后响应丢失 | gate 与核实事件共同提交；重复 reviewRequestId 只得到原回执，不二次放行。 |
| SQLITE_BUSY/FULL/IOERR、ABI 不匹配、无法验证来源/损坏库 | 不回退空库或模拟实盘；结构化原因与应用下一步可见，外部副作用零新增。 |
| 恢复完成后本人新建订单 | 临时隔离适配器验证：仍需启用会话、最新账户上下文、有效逐笔原生确认；原意图执行次数不增加，新意图才可认领。 |

Astra 以真实子进程退出/锁竞争证据、SQL 提交前后 crash 矩阵、所有 ID/审计单调保留及最终“可逐笔核实后继续新交易”的完整离线切片验收，而不是仅看测试数。类型检查不能证明文件锁；模拟抛错不能代替 kill/reopen；内存 SQLite 不能代替本地文件库；SQLite 更换不能抹掉原 Windows rename EPERM 的未知根因。

Mac 文件锁、客户端账户标识/原生确认、孤立执行器管理、真实断电及 F_FULLFSYNC 效果分层验收。离线通过仅证明相应协议；必须本人在目标 Mac 在场确认真实交易，绝不以模拟-only、只预览或禁用实盘作为 F3 完成条件。
