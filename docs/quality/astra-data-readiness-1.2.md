# Astra 数据就绪与初始化最小合同（目标 1.2）

日期：2026-10-08。范围：只读架构审查，不是实现验收或 Mac 1.1 安装包复验。仅新增本文，未改业务源码、测试或旧报告，未执行联网、生产数据库、账户、交易、依赖下载或 native 操作。

## 实施定案：本轮必须满足的六条合同

以下为交 Zeno 的最小验收合同，优先于后文的背景说明；不新增调研或扩大到策略、交易、native 模块。

1. **两项采集仅写事实。** syncAuctionSnapshot 只取一个明确交易日的竞价事实；syncLimitList 只取该竞价日精确前一交易日的涨跌停事实。复用现有 fetch 与 repository，不调用 morningAuction 快照生成/刷新、统一盘后任务、策略扫描、回测、题材同步或任何信号 emit/backfill。两项可以分别执行，竞价采集不得因 limitList 为空提前退出。允许重新读取诊断质量，不允许顺带生成策略结果。
2. **日历未知 fail closed。** 主进程解析目标日期，证明当前日、所需回溯区间及前一交易日开闭市安排已知。缺失、无效、越出已知范围时返回 CALENDAR_UNAVAILABLE，远端调用数和事实写入数均为 0；不得按周末、自然日倒推、已有行情 MAX 日期或 renderer 提供的日期猜测。已公布官方日历可作有来源的兜底，但不能补造未知安排或忽略冲突。
3. **auction 使用北京时间 09:30 截止。** 当天已知开市且时间 >=09:30，默认目标为当天；此前默认目标为上一已知交易日，并明确显示日期，不能显示“今日竞价已补齐”。明确请求当天但尚未到 09:30 时返回 NOT_DUE/waiting，不发请求、不写库。休市则取最近已知应有交易日。这里只规定本轮完整事实补齐动作，不修改既有 09:28 预热调度，也不声称 09:30 必然已获得上游数据。
4. **无权限、空结果都不假成功。** 配置缺失、权限未知、认证失败、已确认权限拒绝、限流、超时、空响应分别报告；Token 存在不证明权限。请求成功但无目标日有效数据返回 empty/UPSTREAM_EMPTY，而不是 success；目标日错配、无效事实或已知不完整批次返回 failed/partial。已有缓存仍可用与“本次补齐失败”可以同时成立，不能互相遮蔽。只有完成校验和事务落库才能报告本次采集成功，且成功不等于全市场覆盖或策略就绪。
5. **保留旧事实。** 失败、空响应、取消、无效批次不删除或替换已有记录；有效完整响应才交已有事务仓库处理。新 null 不得覆盖同主键已有非空事实，0 不得充当未知；冲突的非空事实须采用已有明确更新规则或报冲突，不静默拼成未经证明的事实。THS 批次不完整时不得用成功子集全量替换。重复点击 single-flight，重复有效采集主键幂等；不清 profile、不刷假数据。
6. **neutral 不等于正常可用。** 逐项新增 neutral 展示语义，用于未选源等“不参与本次能力判断”的项目；不映射为 ok/reliable，不计入正常可用数。保留既有健康汇总 ok/warning/error 字段，另加 neutral 与 evaluatedCount；totalCount = evaluatedCount + neutral，evaluatedCount = ok + warning + error。Panel、shared/preload 和汇总逻辑一起更新，旧字段不删除、不改名；总体健康沿用原枚举但只聚合参与评价项，并显示“已评估 N 项，另有 M 项未参与”。没有参与项时明确“无可评价数据”，不显示“全部正常”。数据质量 reliable/degraded/blocked 汇总遵循同一原则，缺失竞价仍计入真实 blocked，不靠排除来刷绿。

默认初始化事实：主代理已确认的现有任务模型中，快速初始化把历史日线和题材同步 defer，且**初始化任务列表不包含竞价、涨跌停、筹码、趋势任务**。所以“默认初始化完成”不能表述为这些数据已齐备。本轮保留快速流程，在诊断提供上述有界补齐；初始化完成文案必须披露未包含/已延后项。initTaskModel 当前选中源 skip 修复现已由主代理明确纳入 Zeno 范围，只有该源满足对应任务条件才可跳过，其他题材表的记录不得代替。

最小纵向验收：合成日历与空竞价/涨跌停表，分别执行两项动作，断言请求日期准确、原始事实落库、全部策略/信号入口调用数为 0；依次注入未知日历、09:29:59/09:30:00、配置缺失、权限拒绝、空响应、坏行、事务失败，断言正确 outcome 和旧事实不变；再用“选中 THS 空、KPL 有数据”证明不错误跳过，检查 neutral 未增加 ok/reliable 计数。完成后交 Astra 独立验收，不据此宣布已在用户 Mac 补齐。

### 主代理补充定案：真实请求取消、截止与分页上限

主代理已明确新增 Zeno 写范围：electron/main/services/tushareService.ts，仅限 fetchStkAuction、fetchLimitListDaily，以及为这两条调用链传递取消/截止所必需的真实请求与重试等待逻辑。本授权优先于本文先前较窄的范围说明；不因此修改其他调用者的默认行为，不下载依赖，不扩展为全行情客户端重构。Kant 不并行修改该文件，可在其正常入口切片中消费完成后的有界请求参数。

诊断两项动作显式传入 signal、deadline 和有限 page cap；底层参数保持向后兼容。实现必须同时约束真实 fetch、响应读取、下一分页和重试等待，不能只在最外层 Promise.race 返回 timeout 后让底层继续请求。对共享请求/重试 helper 的必要修改只在显式传入预算时启用，其他已有调用保留默认行为。

- 一个动作共享总截止预算，不能每次重试/翻页重新获得完整时限。若入口传入墙钟绝对截止，进入调用链时转换为剩余单调时间预算；墙钟回退不能延长任务。重试退避不得超过剩余预算；在请求、退避结束及翻页前再次检查取消/截止。
- 外部取消与截止应传递到真实 transport 使用的 AbortSignal；已在途请求/响应读取被终止，重试计时等待可被打断。取消/截止是终止结果，不按普通网络错误继续重试；完成或失败后清理定时器和监听器。Promise.race 本身不算请求已取消。
- page cap 按实际请求页数计，包括用于证明结束的页；已到上限但最后一页仍满、尚无结束证据时必须返回 PAGE_LIMIT 等稳定终止原因，不能把累计子集当完整返回。重复页或无新增主键的分页不前进应终止并报告 PAGE_REPEAT/NO_PROGRESS，不能无限循环或把去重后的子集称为完整覆盖。
- 完整性只在目标日/字段校验及分页结束证据都成立后确认；使用上游原始页长度/明确结束信息判断翻页，不能拿过滤后的行数误判末页。网络中断、取消、截止、重复页、上限、后续页失败均不得将之前累计的子集交给诊断写库。空首个正常终止页可以作为 empty 响应，但不是补齐成功。
- 诊断在取得完整、合法结果后再进行单次事实写入；写入前最后检查预算和取消状态。已经同步进入并成功提交的本地事务，不虚称被后续取消撤销；如取消在提交后到达，按实际提交结果报告，不能返回“无写入的取消”。零写入保证适用于采集未完整结束或提交前取消的路径。
- 新增终止原因须结构化保留，不能被统一转换成权限不足或成功。PAGE_LIMIT 等属于采集未完成，不等于“上游只有这些数据”；已有事实保留，不能用旧缓存非空掩盖本次失败。相关错误码的最终命名可沿用项目习惯，但上述区别不得丢失。

**Astra 必验真实 fake transport，而非只测外层超时：**

1. 假 transport 挂起直到收到实际传入 signal 的 abort 事件；分别触发用户取消与总截止，证明事件被观察、请求结束、后续 fetch 次数不再增加。
2. 首次请求返回可重试故障后进入退避，分别在退避前/期间取消或耗尽预算；推进假时钟后仍不得发生第二次请求，计时器/监听器无残留。另测调用前已取消和预算已耗尽均零请求。
3. 第一页满且合法、第二页挂起/失败/重复，以及连续满页命中 cap：验证相应终止结果、有限请求数、事务写入调用数为 0，旧缓存字节/事实不变。覆盖 fetchStkAuction 与 fetchLimitListDaily 的真实调用链，而不是绕开它们的假业务函数。
4. 正常多页完整返回、短末页/空终止页及正常零数据分别验证 success/empty；只有完整合法响应一次落库。首次重试成功也必须共享原总预算，不能因重试刷新截止。
5. 在响应读取阶段取消、截止与最后一页完成相邻、写入前取消等边界，证明没有迟到子集写入；重复点击 single-flight 不导致一次取消之后偷偷启动替代请求。
6. 不传新预算选项的既有调用保留默认行为的兼容测试；不以此次有界诊断测试声称所有未传预算的历史调用也已获得相同保证。Kant 正常入口需在其独立切片中显式使用预算后再验收其有界性。

本项是两项诊断事实采集的验收要求，不增加启动调度或交易模块范围。实现完成后提交实际 fake transport 请求/abort/重试/落库断言证据；仅“外层在 N 秒内返回”不能通过本轮验收。

### 产品边界与正常入口残余（本轮不扩大实现）

**诊断 fact-only 补齐提供用户主动恢复事实的路径，不等于默认初始化、启动调度或正常竞价入口已经自动恢复。** 即使两项按钮都成功、auction 质量由 blocked 改善，也只能说明各自目标日事实按规则落库；不能据此签署竞价正常使用或全部分池恢复。用户 Mac 的实际执行结果本轮尚无证据。

| 残余项 | 已读源码依据及最小后续方向 |
|---|---|
| R-DATA-ENTRY：正常入口仍把前日涨跌停当整个竞价快照的前置门槛 | morningAuctionService.ts 的 buildRealMorningAuctionSnapshot 在 prevDate/prevRows 为空时先返回，尚未读取本地竞价缓存或请求 fetchStkAuction。即使诊断只补好了 auction，正常入口仍可能是空快照。要承诺正常入口可用，后续必须拆开“竞价事实读取/获取”与“依赖前日涨跌停的分池计算”，只阻断缺输入的能力，不让分池依赖阻断原始竞价事实。不能简单删除 return 后继续拿缺失输入计算。 |
| R-DATA-CACHE：同日空快照不会因事实新增自动重建 | getOrCreateMorningAuctionSnapshot 仅在无 cachedSnapshot 或日期变化时调用 buildRealMorningAuctionSnapshot；同日提前返回的空快照也会缓存。之后补齐两类事实，再进入同日正常入口可能仍复用空池；refreshMorningAuctionSnapshot 才显式重建。后续最小修复须按依赖状态/事实版本失效或定向失效重建，不用反复联网轮询或要求用户重启来冒充自动恢复。诊断 fact-only 动作本轮不得为解决这个问题顺带计算或发信号。 |
| R-DATA-STARTUP：错过竞价窗口后的自动补偿未获证明 | 已读 scheduleMorningAuctionTimers 明确的启动补偿仅覆盖 09:15 至竞价确认时刻前，随后注册定时器。默认初始化列表也没有竞价任务。本轮未验证其他启动路径，不把两个手动按钮或正常刷新函数的存在当成晚启动、休眠唤醒或冷启动自动补齐的证明。 |

后续修复对“正常入口不依赖诊断按钮即可取得应有事实”的产品目标是必要的；不属于本轮 Zeno 已定实现范围。最小后续审查围绕 morningAuctionService 的依赖分层和同日缓存失效，启动自动补偿只有在明确纳入后续范围后再改，不泛化重写调度器。

后续风险必须保留：现有 prevDate 取 limit_list_daily 中较早的 MAX 日期，不能把任意旧日冒充精确前一交易日；日历未知应继续 fail closed。缺输入不得转换为零价/假候选或“运行后无机会”，事实缓存更新也不得回填未来信息。重建快照可能再次触发 emitMorningAuctionDecisionSignals，须验证既有去重与生命周期，不重复通知、不把历史日期重建冒充当前机会；网络请求需有界、同键去重并遵守发布截止。以上风险不要求本轮顺带修复，但必须在后续正常入口验收前闭合。

本轮可验收口径：状态分类真实、当前源 skip 正确、两项有界事实采集有效、失败保留旧事实、日历与截止正确、fact-only 无策略/信号副作用。**不接受的口径：默认初始化已补齐竞价、启动已自动恢复、正常入口/所有分池已修复、目标 Mac 已验证。** 后续须单独覆盖“无 limitList 时正常进入”“同日先空后补再正常进入”“错过窗口启动/唤醒”等用例，按钮成功不能替代这些证据。

neutral 与 on-demand no-data 只表示未参与当前评价或尚未按需获取，不表示已经具备数据、可计算或运行成功；页面、计数和交付说明都必须保留这一区别。

## 已授权正常入口合同（冻结版本，Kant 唯一实施依据）

**本节替代下方正常入口前版设计记录，包括此前“09:30 前正常入口一律不得 emit”的限制。** 09:28 是既有业务观察/确认时点，09:30 是诊断完整性检查的保守截止，两者不能混为一个全局可用开关。本节不改变 Zeno 的两项诊断 fact-only 合同。

授权文件精确限定：`electron/main/services/morningAuctionService.ts`、新增 `electron/main/services/morningAuctionEntryPolicy.ts`、新增 `tests/unit/morningAuctionEntry.service.test.ts`。Kant 不改 tushareService、scheduler、共享/数据库 types、Zeno 的 diag/dataQuality/Panel/init 或通用 helper。新 policy 为本服务专用纯策略 helper；内部类型和服务内增量元数据可定义在这两个授权服务文件，不改既有字段含义或要求其他类型文件配套修改。请求 opts 等待 Zeno 冻结后消费，不自行另造共享请求协议。

### 1. 固定执行顺序：先事实，后依赖池

1. 验证请求的 tradeDate 与日历，建立不可变日期上下文。目标日未知、未来日期、日历冲突未决时不请求、不发布；已知休市明确返回非交易日，建议日期不得偷换请求日期。精确前一交易日必须由完整已知区间的实际开市安排确定，不按 weekday、自然日倒推或行情表 MAX 日期猜测。
2. 目标交易日已知时先读取其 auction，必要时按第 2 节获取并保真持久化；不得因前日 limitList 为空在读取/获取 auction 前退出。若只是不足以确定精确前日，标记对应前日依赖未知，不据此抹掉已知目标日的有效 auction；目标日本身未知则整体 fail closed。
3. `threeOne.allMarket` 只按目标日真实竞价自身所需字段计算，沿用现有阈值。limitList、题材、名称缺失不能阻断它；名称不可得可用证券代码并标未知。没有有效价格/前收/金额等必要事实的股票不生成有效候选。
4. 其他 threeOne 池、weakToStrong、boardCategory 只用精确前日 limitList；缺失只阻断相应池，禁止用更早一日冒充前日。直接题材归因也用同一个精确前日，不保留另一条 MAX(limit date) 回退。日期敏感的题材查询传请求 tradeDate。
5. 保留真实缺口：auction 无事实、前日缺输入、有效事实存在但零命中是不同状态。0 值占位、isMock=false、未选源 neutral、按需无数据都不能充当 ready 证据。

### 2. 09:28 正常业务与 09:30 诊断截止兼容定案

| 时间/目标 | 正常 get/refresh 的约定 | 完整性与信号 |
|---|---|---|
| 当日 09:15 预热及 09:28 前 | 调用继续有效，读取本地已知事实与前日结构；没有当日有效竞价时返回 waiting/preview，不要求定时器改名或抛错。无需为填空表频繁请求竞价。 | 不把预热视为最终竞价事实，不产生当日竞价机会信号。 |
| 当日 09:28 至 09:30 | 既有 refresh 调用可实际获取目标日 auction，读取/保真落库后计算独立 allMarket 及具备依赖的其他池；不得因未到 09:30 返回“禁止调用”或强制清空合法候选。 | 标记 `observed_provisional`，含目标日、真实观察时间和来源。合格且有本窗口可追溯观察依据的新候选允许首次 emit；只称“竞价异动/当时观察”，不称“最终、完整、全市场已齐”。 |
| 当日 09:30 起 | 正常入口仍可使用此前真实有效事实；到期的进一步采集按已冻结预算执行。若诊断已写入截止后事实，下一次正常读取直接识别，无需再拉一次才可用。 | 没有截止后成功观察时保留 `due_unconfirmed` 或此前 provisional 来源，不因钟表跨点自动升级。截止后观察也只证明已观察到这些有效事实，不自动证明全市场完整覆盖。 |
| 已知历史交易日 | 保留既有按日期获取、缓存和展示能力，不用当前早盘时钟禁止历史查询；保持历史价格/题材投影。 | 所有 emit、dismiss 和机会通知均为 0。 |
| 目标日未知/未来/已知休市 | 返回明确原因，不偷换为最近行情日继续算。 | 无远端竞价请求，无信号副作用。 |

“本窗口可追溯观察依据”指 09:28 起真实请求成功并校验的观察，或本地保留的等价来源/观察时间证据；不能将更早预热缓存重打当前时间戳后冒充。当前首次发布可以基于已经持久化的这种真实候选，不要求整个数据集先获得“完整”评价；限流、空响应或增强数据失败也不自动否定未被推翻的旧事实，但必须披露本次失败和事实日期。

诊断单日采集仍使用 09:30 完整性截止且永不 emit；正常入口的 09:28 业务信号不是诊断采集副作用。scheduler 的 `auction_confirmed` 既有阶段名保持不变，本节只约束数据语义，不把阶段名称解释为完整性认证。

服务结果须携带不破坏原字段的阶段/依赖元数据（可复用已有元数据，缺少则在授权服务内增补）：目标日、精确前日或未知、auction 观察阶段/时间/来源、有效行数、各池缺口、完整覆盖是否有证据。不把缺证据默认为 true。若现有正常页面未消费这些元数据，本切片不能宣称页面阶段提示已全面修复，主代理须单独确认展示兼容；不得以假空数据或改变 isMock 含义规避这个边界。

### 3. 同日缓存：事实变化驱动本地重建

- 本地目标日 auction、精确前日 limitList、所需日历内容形成规范化内容指纹，包含影响计算及观察资格的字段。每次正常 get/refresh 检查，不能只比较行数、MAX 日期或同一连接不会可靠反映自身写入的 data_version。
- 空变有、同条数值修订、精确前日内容变化、日历修正均触发本地重建；同日先空后由 Zeno 补齐，下一次普通 get 即恢复，不要求 refresh、重启或让 Zeno 增加回调。
- 事实未变复用候选计算结果。单纯墙钟跨 09:30 只更新阶段判断/必要采集资格，不凭空确认或重新生成一套“更完整”候选；观察资格变化必须有实际新证据。
- 显式 refresh 可按请求预算采集；无论采集是否发生，都由最新已提交事实构建，不为了修复缓存再次无条件请求。失败/空响应不抹旧事实，新增 null 不覆盖旧非空；无效批次和落库失败不作为新确认依据。
- get/refresh 共享按日期的 single-flight；同一天的题材源变化不能重复并发取 auction。日期上下文、候选集合和异步增强结果绑定 generation，不再跨 await 反复读取可能被另一请求替换的全局 cachedSnapshot。
- 跨日迟到任务只可结束自己的请求，不覆盖较新活动日期/来源的缓存，不发布迟到的“当前机会”。发布前重新判断当前北京时间交易日，而不是只信开始请求时的今天。正在构建时本地事实被补入，最多一次本地追赶；仍变化则返回明确可重试非就绪状态，不无限循环。
- 返回隔离副本；只读缓存接口不新增请求、策略或信号副作用，发现依赖已变返回 null 或明确 stale，不能伪称就绪。题材增强缓存同时绑定 source 与候选集合，新增候选不能被旧日期缓存遗漏或污染。

single-flight 及内存缓存必须有界，不能按任意日期无限建队列。请求超时/取消必须使用 Zeno 完成后的 opts 进入真实 transport；未接入前属于待集成项，不用外层 race 宣称有界。此处不重复制定运输协议、不改其默认调用行为，也不声称已有跨诊断/正常入口的全局锁。

### 4. 信号发布：真实当前候选可用，持久去重

- 正常入口不是 fact-only：允许当前已知交易日、09:28 起有合格真实观察依据的 allMarket 新候选首次发布。缺前日 limitList 不妨碍独立候选；缺其自身关键字段、只有预热数据、日历目标未知或网络结果未成功落库则不能产生新确认信号。
- 历史查询整个副作用段禁止执行，包括 `dismissOneWordMorningAuctionSignals`；不可因查看历史撤销当前信号。未来、休市、跨日迟到及不合格阶段同样零 emit/dismiss/通知。
- 稳定键沿用 `short_term:morningAuction.allMarket:{tradeDate}:{tsCode}`。相同键已存在，无论 NEW/READ/WATCHING/DISMISSED 或其他既有状态，重复 get、refresh、重建及服务重新加载都不再次交 emit，不复活生命周期、不改写为“刚产生”。
- 可在授权服务内查询持久 decision_signals 已有键，过滤后将真正新键交既有 emit，并在本主进程串行化发布；只用内存 Set 不合格。新增合格股票仍允许一次新增，不能关闭全部信号来通过去重测试。
- 当前日真实新观察导致既有一字板处理时，保持原有明确规则且幂等；不能把“先前已 dismiss”又以重新入池为由 emit。事实修订不制造新的 dedupKey，不把缓存生成时刻当交易事实时刻。
- 先前未读下游持久唯一约束/通知实现，不能据此承诺跨进程崩溃下外部通知 exactly-once。授权内须证明持久既有键不被重复交 emit；发现下游额外需求则向主代理报告，禁止自行扩写信号模块。

### 5. 冻结验收用例与发布口径

1. 目标日 auction 有效、limitList 全空：普通入口 allMarket 按原规则可用，依赖池缺输入，不能整页返回一个不说明原因的空快照；无 Token 但本地事实合格仍可用。
2. 目标日 auction 缺失、limitList 全空：09:28 正常 refresh 确实走真实调用链的 fake transport、保真落库和候选计算，返回 provisional 而非“未到09:30禁止”；当前合格新候选一次 emit。09:15 预热不被改成最终就绪，不 emit。
3. 09:28 观察后推进到 09:30 而不增加事实：不自动宣称完整，不重复 emit；随后诊断写入真实截止后事实，普通 get 识别变化并更新状态，旧键仍不重复。
4. 同日先空后补、等行数关键值改变、日历/精确前日变化：普通 get 自动本地重建；更早 limitList 不能代替精确前日。目标已知但前日未知时仅阻断依赖池；目标自身未知则不采集不发信号。
5. 采集失败/空结果/无效批次：旧事实保留，本次失败可见，不能称已新采集成功。按正常业务实际使用的原始事实仍可展示，不填零刷绿。
6. 并发 get/refresh、切日期、迟到响应、增强任务旧 generation：单日期请求合并、预算有界，无跨日缓存覆盖或历史机会伪装；真实运输取消的集成证据沿用 Zeno 冻结接口另测，不用假外层 race 代替。
7. 历史已有候选、跨日完成、预热阶段分别断言 emit/dismiss/通知为 0；当前首次新候选 emit 一次，重复/刷新/本地重建/服务重新加载后的旧键均为 0，不复活 DISMISSED。
8. 缺事实、缺分池依赖、合法零命中、neutral 未选源、按需无数据分别表达；阶段元数据不把 provisional 或 due_unconfirmed 映射为完整可用。

以上仅用专属隔离 fixture、时钟和 fake transport，禁止用户 profile、真实接口/账户、订单、依赖下载或 native 验收操作。Kant 提交后由 Astra 独立复验；Zeno 第一切片完成后仍单独验收其 fact-only、状态、init skip 与请求预算，不由正常入口测试代替。

### 未实现残余：startup 自动补偿

本合同不改 scheduler，不新增默认初始化竞价任务，不补“错过窗口后启动/休眠唤醒自动同步”。完成本切片后可声称的范围仅为经过验收的正常入口/刷新及补齐后再次进入恢复；不能宣称后台无人进入页面也会自动补齐、启动默认已恢复或用户 Mac 已验证。startup 补偿继续单列，等待另行授权和证据。

## 正常入口前版设计记录（已被上述冻结合同取代，不作为并列实施要求）

主代理已明确授权 R-DATA-ENTRY + R-DATA-CACHE 的后续实现。前文“本轮不扩大实现”仍指 Zeno 的诊断 fact-only 第一切片，不撤销其副作用边界；本节仅为 Kant 的新授权合同，不代表两项残余已经修复或验收。本节仅使用先前已读源码上下文，没有新增文件调研。

### A. 写范围与不变项

- Kant 仅修改 `electron/main/services/morningAuctionService.ts`、必要的新纯 helper 和专属 tests；不改 Zeno 的 diagnostics/dataQuality/scheduler/Panel/init/shared/preload 等文件，不改交易 SQLite、交易执行或启动调度。
- 保持现有正常入口、显式刷新、只读缓存接口和既有候选阈值；不重写策略模型、不新增广泛同步、不把正常功能改为模拟。必要的就绪元数据可在当前服务导出的 snapshot 类型中增补，保留原池结构，不能借 `isMock=false` 宣称数据已就绪。
- 调整事实读取、依赖判断、缓存一致性与既有信号发布条件。正常入口可以保留受控的既有行情请求；不得把诊断按钮路径导入这个会计算候选/发布信号的服务。
- 默认初始化和错过窗口的自动启动补偿不在本节授权范围；第一切片与本节分别验收，均不能直接代表目标 Mac、启动恢复或整产品通过。

### B. 精确日期与依赖分层

正常入口显式请求的 tradeDate 不得偷偷换成另一天。先严格验证日期与本地/已公布官方日历；今日、目标日或必需回溯区间未知、冲突未决、未来日期均不进行远端采集或信号写入，返回稳定原因。仅知道目标日之前有一个 MAX(open date)，不足以证明它是精确前一交易日，必须排除中间漏日。

prevTradeDate 从已知完整区间的实际交易日历取严格小于目标日的最近开市日；getLimitListByDate 必须使用该精确日期，禁止继续使用 limit_list_daily 的 MAX(较早日期) 兜底。applyThemeAttributionToSnapshot 中目前按 MAX(limit date) 选择直接题材日期的分支也必须与同一 prevTradeDate 对齐，不可从另一条内部路径重新引入旧日。已知休市日返回非交易日状态和建议日期，不将建议日期的事实标为用户原请求日。

将 buildRealMorningAuctionSnapshot 按以下顺序拆开：

1. 解析日期上下文；读取目标日竞价缓存、精确前日涨跌停缓存，分别记录有效事实和缺口。缺 limitList 不得在读取/获取 auction 之前 return。
2. 按 D 节的截止和请求预算，必要时获取目标日竞价，校验后事务写入，再从已提交的本地事实构造快照。失败/空结果保留旧事实；新 null 不覆盖旧非空，错误日期/无效价格不得进入候选。落库失败的网络结果不能当作已持久化、已确认就绪的事实去发布机会信号。
3. `threeOne.allMarket` 沿用现有 3%/500万元/0.15%/30亿元过滤规则，使用目标日有效 auction rows 独立计算。源码现有注释和构建过程明确该池与昨日连板状态无关；不得因前日涨跌停、题材成员或名称缓存为空禁用它。名称缺失可用证券代码展示并标明未知，不能伪造名称或价格。
4. `threeOne.firstBoard/secondBoard/brokenBoard/brokenConsec`、全部 `weakToStrong` 和 `boardCategory` 仅用精确前日涨跌停事实；前日缓存缺失时这些池返回缺输入状态，不借任意更早一天代替。各行还须满足其使用的当日价格/前收等关键事实要求；缺竞价的行不以现有 0 值兜底当有效候选，排除并计入缺口。
5. 题材、价格历史和收盘/实时投影保持原有职责；本服务调用支持日期参数的题材路由时传目标 tradeDate，不用今天的 DC 题材冒充历史归因。历史页面保持历史价格投影，不因刷新将当前实时涨跌混入历史事实。不得因增强信息缺失把原始竞价事实整体说成不存在。

snapshot 增补明确 readiness：目标日、精确前日、calendar 状态；auction 的 missing/provisional/observed_after_cutoff/failed 状态及有效行数、覆盖说明；previousLimit 的 missing_or_empty/present 状态；按池标记 ready/partial/blocked/no_match 及原因。这里 observed_after_cutoff 是本地可追溯的出数截止后观察，不是券商认证，也不自动表示全市场完整覆盖。没有任务成功证据时，零行不能区分“尚未同步”和“上游确实没有”，如实用 missing_or_empty。只有相应输入已具备且筛选确实零命中，才能标 no_match；未选源或按需缓存空仍不是 ready。

### C. 同日缓存失效，不要求 Zeno 加回调

采用本服务可实现的读取侧依赖指纹，不要求 Zeno 改 repository、诊断动作或写新版本表：

- 每次 getOrCreate/refresh 先读取目标日 auction、精确前日 limitList，并形成稳定规范化指纹，覆盖实际计算字段、代码、日期、观察时间及日历解析结果；key 同时包含 tradeDate、selectedConceptSource 和发布阶段。必须识别同样行数的值修订，不能只用 COUNT/MAX 日期，也不能依赖 SQLite `PRAGMA data_version` 检测同一连接自己的写入。
- 缓存存储 `dependencyKey + readiness + snapshot`。依赖变化、前日从空到有、auction 从空到有、字段修订或阶段改变即重新构建；同日空快照不再永久冻结。因此 Zeno fact-only 落库后的下一次正常入口调用能直接生效，不需点显式刷新或重启。
- 事实变化造成的重建优先只用已提交本地数据，不为“使缓存失效”再次强制请求远端。盘中实时投影可在返回副本上更新，不把每一次实时价变化当作重新发布竞价机会的理由。
- 题材/价格历史等异步增强绑定 `tradeDate + source + candidateSet + generation`；旧异步任务不得回写已失效或其他日期的新快照。不能只按日期复用旧 _conceptCache 后漏掉新增候选，也不能让旧日期的 _conceptFetchInFlight 结果污染当前源。
- 返回调用者隔离副本；只读 getCachedMorningAuctionSnapshot 不触发远端、策略重算或信号。若其依赖指纹已变，可返回 null 或明确 stale 的快照，但不得把陈旧空池标为 ready。采用 null 时保证后续正常入口仍可重建。
- 请求期间 Zeno 写入同一事实日：发布快照/信号前再比较依赖指纹；若变化，最多立即进行一次纯本地重建。仍持续变化则返回 DATA_CHANGED_RETRY 的非就绪结果，不缓存/发布过时构建结果、不无限重试。

指纹查询限定目标日/精确前日及必要候选，不扫描全历史来检测变化；内存缓存保留有限日期，例如当前日和最近访问历史日，不无限累积。

### D. 正常入口截止与有界 single-flight

Zeno 的事实补齐动作维持 09:30 截止不变。Kant 不改既有 scheduler 的 09:15/09:28 调用；正常服务按下列阶段处理：

- 当日 09:28 前：允许读取本地事实和前日结构，但尚无可确认的当日竞价时返回 waiting/provisional，不为补空表反复调用竞价接口、不发布竞价机会。
- 09:28 至 09:30：允许保留现有确认窗口触发的一次竞价请求，作为 provisional 观察；不宣称正常完整事实已就绪、不发布当前机会。不因函数名含 refresh/confirmed 就视为出数已确认。
- 09:30 起：只有目标日校验通过、观察发生在截止后且持久化成功的事实，才获得 observed_after_cutoff。09:28 的旧缓存不能仅因钟表跨过 09:30 自动升级；下一次正常入口可进行一次受控重取，或识别诊断已补入的截止后观察。时间满足只是必要条件，失败/空响应/缺字段仍按真实状态返回。
- 已知历史交易日可保留既有按 trade_date 查询能力，不用当前墙钟的早盘时段禁止历史事实查询；查询历史始终只展示，不发布当前机会。日历未知/未来日仍拒绝，缓存里未来行不能绕过检查。

getOrCreate 与 refresh 共用同一份在途任务，按日期与事实来源合并远端竞价获取；题材源切换不应为同一天竞价制造第二次并行请求。本服务最多一项远端竞价请求在途；同键调用共享结果，不同键超额请求明确 busy/retry，不建无界队列。每个请求保留既有分页完整拉取，不重复造分页。

普通读取优先命中已足够的本地事实；失败/空响应设有限冷却（建议 30 秒，单调时钟）避免 Tab/轮询风暴，明确权限拒绝不自动紧密重试。冷却期间仍必须检查本地事实指纹，外部补齐立即可见；显式刷新不能绕过日历、时间截止、在途合并和上游 retryAfter。阶段跨越可触发新的到期观察预算，但不能绕过真实限流。

请求等待必须有界，超时状态可返回；Promise.race 不等于底层取消，在旧请求真正结束前不得释放同键 single-flight 后再启动重叠请求。迟到响应必须经过 generation 检查，不能覆盖新快照或发布旧信号。此切片只保证本服务调用合并，不声称未协作的诊断与正常服务已经具备跨模块全局请求锁。

### E. 正常入口的信号副作用合同

诊断采集始终不发信号；正常竞价入口保留其原有业务信号能力，但只允许当前已知交易日、截止后有效竞价事实驱动的合格候选发布。当前机会的资格按具体候选事实决定；缺前日 limitList 不应阻止独立 allMarket 的已确认候选，但缺关键当日报价、日历未知或 provisional 不得发布。

历史/未来/休市目标、未知日历、落库失败、waiting/provisional 路径的信号新增、更新、通知及 dismiss 操作数均为 0。门禁必须覆盖 emitMorningAuctionDecisionSignals 的整个副作用段，包括现有 dismissOneWordMorningAuctionSignals，不能只保护最后的 emit 调用。

沿用已有稳定键 `short_term:morningAuction.allMarket:{tradeDate}:{tsCode}`；不加入 generatedAt、缓存 generation 或调用次数来生成新身份。相同事实反复读取、显式刷新、依赖补齐、并发合并和服务重新加载后，已有该键的机会不得重复新增/通知，不重置 READ/WATCHING/DISMISSED 等生命周期或原信号时点。最小实现可在本服务发布前查询持久 decision_signals 的既有键，仅将未发布的新键交现有 emit，并在当前主进程内串行化发布；不能只用内存 Set 宣称重启后也去重。

只有新出现且满足条件的候选可追加信号。已存在候选的事实修订不通过“重新 emit 一个机会”处理；需要改变生命周期时沿用明确可证明的现有规则，不猜其下游通知行为。既有一字板 dismiss 仅限当前目标日且新观察确实满足条件，幂等处理，不得借查看历史改写历史机会。

本次未读取 decisionSignalService 的持久唯一约束与通知实现，不能承诺外部通知跨崩溃 exactly-once。Kant 必须用正常服务专属测试证明已有键在重复调用和重新加载后不再交 emit；若现有下游无法在授权范围内满足持久去重，明确报告给主代理，不擅改 Zeno 或信号模块，也不能以未验证的 dedupKey 存在代替验收。

### F. Kant 专属隔离验收与交接

1. limitList 全空、目标日已有有效竞价：正常 getOrCreate 的 allMarket 可按原阈值生成候选，前日依赖池 blocked，原始事实可见；无 Token 时本地合格事实照常可用。
2. limitList 全空、目标日竞价为空、假接口返回合法事实：到期正常入口仍请求并落库，不早退；请求失败/空结果保留已有事实并如实非就绪，不回填假价格。
3. 目标日前一交易日缺行，但更早某日有涨跌停数据：不得借旧日构池或直接题材归因；完整节假日日历取精确前日，日历漏一天则 fail closed。
4. 先访问得到同日空缓存，再仅向 fixture 写入竞价、再写入精确前日涨跌停：连续普通 getOrCreate 自动反映两次变化，不点 refresh、不重启；同条数修改关键字段也失效。
5. 当日 09:27:59、09:28、09:29:59、09:30 四点：provisional 不能靠时间自然升级，截止后成功观察才符合发布资格；历史查询与当前日期显示分离，未来/未知日期无远端副作用。
6. 一批并发 getOrCreate+refresh、切日期/题材源、失败重试和超时迟到响应：同日竞价仅一个实际请求，预算有限，旧 generation 不覆盖新结果，外部补齐绕过的是旧缓存而非限流规则。
7. 重建期间修改本地依赖：最多一次本地追赶，不发布陈旧快照的信号；后台增强不能改写其他日期/候选集合。
8. 历史、provisional、未知日历分别断言 emit/dismiss/通知为 0；当前合法新候选仍可产生一次机会，重复读取/刷新/缓存失效/服务重新加载不再次提交已有稳定键，不复活 DISMISSED。不得靠禁用全部当前信号使测试通过。
9. 合法空候选、缺输入、部分报价与题材未选中分别保留状态差异；isMock=false 或非空记录数本身不代表 ready。

测试使用独立合成数据库、注入时钟与假行情，不读用户 profile、不联网、不触发订单；源码改动与证据交 Astra 后才签署本切片通过。Zeno 第一切片完成后仍由 Astra 单独复验 fact-only 与状态合同，Kant 的正常入口通过不能替代它；两者通过也不等于启动补偿或真实 Mac 已验收。

## 1. 截图能证明什么

用户提供的事实：stock 5572、tradeCal 1096（2024-2026）、daily 2603547、trend 62（最新 20260930）、todaySignals 11；minute/limitList/KPL/THS/DC/chip 为 0；auction 为 0 且唯一 critical blocked；策略评估 0/0、无本地信号。本次没有读取截图对应 profile、请求日志或数据库。

基础数据显然不是“完全没初始化”。记录总数不等于目标交易日覆盖、字段质量或目标策略样本齐备；62 条趋势和 11 条看板信号不能证明策略评估所需的信号表、范围和成熟样本存在。未读评估实现，具体计数来源保持未知，不把 0/0 解释为胜率 0%。

| 类别 | 最小正确解释 |
|---|---|
| 股票、日历、日线 | 展示已有量和已有质量证据，不重新清库初始化；总量足够不自动代表覆盖合格。 |
| 未选中的 KPL/THS/DC | NOT_SELECTED，中性展示，不算同步失败，也不冒充数据已具备。选中源的空表才影响当前题材能力。 |
| minute | 已读 scheduler 的 subscribeStockMinute 是个股订阅触发，可走 Tushare 或东财；未请求时空缓存是 ON_DEMAND，不要求冷启动全市场分钟灌库。请求后失败必须另报，不能一直掩盖为按需。未审其他分钟 provider。 |
| limitList | 不是一般无害空缓存：当前竞价分池依赖前一交易日涨跌停事实；该能力确有输入缺口。 |
| chip / trend / 策略评估 | 属于目标集合和派生运行状态问题。仅凭 0 不得宣称“任务未跑”或“接口无权限”；无运行证据时应 UNKNOWN，确认未执行才 NOT_RUN，无目标才 NO_TARGETS。trend 已有 62 条，不归为未运行。 |
| auction | 原始竞价事实确实缺失，应保留受影响能力的阻断；接口权限、认证、网络与执行历史未知，不能猜用户失败原因。 |

## 2. 实际源码发现

1. [diagnosticsService.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/services/diagnosticsService.ts:250) 对所有空表统一 warning/“暂无本地数据”；各题材表都显示同一个“同步当前题材源”动作，容易把未选中的表当故障。
2. [daysSince](K:/AI/person/money/RT-ResearchFlow/electron/main/services/diagnosticsService.ts:175) 按自然日计算市场数据过期。[dataQualityService.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/services/dataQualityService.ts:145) 已有交易日历和官方安排兜底，可复用，不另造工作日算法。两个诊断入口应使用同一截止日，不各自算日期。
3. [auctionQuality](K:/AI/person/money/RT-ResearchFlow/electron/main/services/dataQualityService.ts) 检查竞价缺失但 action=null；expectedAuctionDate 只查 MAX(open date)，未证明中间日历覆盖完整，不能把缺日历误判为休市或已足够新鲜。
4. [morningAuctionService.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/services/morningAuctionService.ts:315) 在没有较早 limit_list_daily 日期/记录时，328/332 行提前返回空快照，357 行的 fetchStkAuction 尚未执行。这是可由源码证明的可达路径，不是已经证明用户 Mac 确实走过该路径。
5. [schedulerService.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/services/schedulerService.ts:1251) 的 KPL/DC 同步依赖“向前七个自然日找有涨跌停数据的日期”，找不到就用今天；长假或 limitList=0 会使取日不可靠。THS 用 allSettled 忽略失败批次，成功部分非空仍全量替换旧成员，存在损失已有覆盖的风险。
6. [题材诊断动作](K:/AI/person/money/RT-ResearchFlow/electron/main/services/diagnosticsService.ts:610) await 返回 void 后即称已结束；空结果、无 Token 的内部直接返回、普通错误重试耗尽返回 null 不能提供“完整成功”的证据。已有 getTushareAccessErrorCode 可区分权限/认证/限流/超时，不应再从空表倒推权限。
7. 主代理已确认但本轮未重读：initializationTaskModel.ts 将历史日线和 sync-concepts 标 quickStart=defer；未包含竞价/涨跌停/筹码/趋势。shouldSkipInitializationTask 找第一个 kpl/ths/dc 而非当前选中源。这属于初始化语义/跳过条件缺口，不是全库迁移失败。

## 3. 最小状态与日期合同

保留既有 health/trust 字段兼容旧调用，增补可解释就绪元数据，Panel 不再只按 count==0 着色：

- applicability：required / selected / on_demand / derived / not_selected。
- readiness：ready / missing / partial / not_run / waiting / failed / unknown / not_applicable；NOT_SELECTED、ON_DEMAND_EMPTY、NO_TARGETS、NO_MATCH 等通过稳定 reasonCode 区分。未选中不显示“已就绪”，按需空不显示“失败”。
- evidence：selectedSource、targetScope、recordCount、expectedTradeDate、latestTradeDate、calendarBasis、checkedAt、affectedModules；lastAttempt 含任务/源/目标日期、outcome、写入数量、脱敏错误码。没有记录就是 unknown，不能伪造“从未运行”。
- access：not_configured / unknown / confirmed_denied / auth_failed / rate_limited / timeout / transport_error，必须由配置或本次真实响应产生；Token 已保存不等于 stk_auction、题材或筹码权限已验证。
- 聚合保留“竞价能力阻断”等事实和数量，但不把单一扩展能力缺数据表达为“整个软件不能用”；不得简单把所有 warning 改成 ok。

日历合同：北京时间取日；市场事实按已知实际开市日推进，显示 expectedTradeDate 和缺少的交易日数。日线沿用 marketSettlementPolicy 的 18:00 发布截止；竞价沿用诊断现有 09:30 保守完整性截止，09:28 自动拉取可发生但不据此断言应已完整出数。盘前/休市回退到前一已知应有交易日，目标当天日历和区间有缺口则 CALENDAR_UNAVAILABLE，不按周一至周五猜测、不固定倒推七天。官方兜底只能在已公布范围内使用；已存日历与官方冲突保留并说明，不静默覆盖。资料更新时间的维护 TTL 可单列自然日，不能与行情新鲜度混用。

20260930 的趋势是否过期应由截图检查时刻、真实日历及派生任务截止决定；不能仅因自然日已过七天报警。本次不推定用户截图拍摄时刻或实际休市安排。

## 4. Zeno 可实现的最小修复切片

### 4.1 诊断补齐动作，不改竞价/策略大模块

在 diagnosticsService 的既有 action runner 中增加 syncAuctionSnapshot，并按当前质量合同解析一个已到出数截止的真实交易日。主进程读取/解密现有配置，调用已有 [fetchStkAuction(token, tradeDate)](K:/AI/person/money/RT-ResearchFlow/electron/main/services/tushareService.ts:1243)，校验返回证券代码、日期和关键价格，再通过已有 [upsertStkAuctionCache](K:/AI/person/money/RT-ResearchFlow/electron/main/database/stkAuctionCacheRepository.ts:10) 落本地缓存。该接口封装已有全市场分页，不重复造分页，也不触碰券商交易。

补齐必须独立于 limitList：不得把 refreshMorningAuctionSnapshot 当原始数据同步器，它可能提前返回，且还会派生/发送看板信号。无 Token 返回 NOT_CONFIGURED；空响应返回 UPSTREAM_EMPTY，不假定无权限、不标“修复成功”；复用 TUSHARE_AUTH_FAILED / TUSHARE_QUOTA_INSUFFICIENT / TUSHARE_RATE_LIMITED / TUSHARE_REQUEST_TIMEOUT，其他真实失败记脱敏 transport/upstream error。不把官方接口积分门槛硬编码为用户已有权限事实。

只有通过校验的真实目标日数据才能写入并重新计算质量；空响应/失败不得清空已有数据、伪造一行、用昨日日线冒充竞价或将 null 填 0。目标日只有少量行或全为无效价格不能直接全绿：分别报覆盖未知/部分、关键事实无效。没有可靠应有样本分母，不声称全市场完整；返回总数和有效目标日数量。

为既有分池增加独立 syncLimitList 动作，取 auction 目标日之前的精确前一交易日，复用已有 fetchLimitListDaily/upsertLimitList。只补用户请求的一天，不顺带启动全部盘后、KPL、筹码或信号任务。auction 原始缓存补齐不等于所有分池可用：前日涨跌停/题材缺口继续独立呈现。既有竞价引擎的提前返回行为本轮不改；即使前日接口成功但确实零记录，也不能把分池业务宣称已验证可用。

动作返回结构必须区分 started、success、empty、partial、blocked、failed，并附 targetDate/source/insertedRows/reasonCode；仅“已启动”或 await void 结束不是 success。可保留旧 transport status，新增 outcome 供 Panel 显示。重复点击按数据集+源+日期 single-flight，失败可受控重试；不自动循环重试已明确权限不足。

### 4.2 题材与初始化

限定修改 scheduler 的题材函数：入参只接受 kpl/ths/dc；开始时绑定选中源，KPL/DC 由上述日历决策取日期，不依赖涨跌停缓存。返回结构化任务结果；无 Token、空结果、重试耗尽、THS 成员部分失败分别如实报告。THS 任一批失败时不得以成功子集全量替换原表；最小实现保留原成员并报 partial，待完整结果后再沿用原替换逻辑。

诊断只为选中源提供主同步动作；其他源显示未选择，不拿其他源的行数证明当前源就绪。同步期间切源：旧任务仍绑定原源，结果不冒充新选中源已同步；刷新诊断按当前配置重算。

初始化保持快速/完整两个层次。defer 表示“稍后补齐”，不表示 done；基础可用后在诊断展示题材、竞价分池等逐项补齐，不新增无差别全量分钟/筹码预热。主代理现已将 src/components/Onboarding/initializationTaskModel.ts 的精确修复纳入 Zeno 范围：shouldSkip 必须匹配当前源，且达到该任务的目标日期/范围；不是任一题材表有行就跳过。不扩展为重写初始化流程。策略评估区分未运行、缺输入、样本未成熟与真实运行后零命中；具体评估代码未读，本轮先保留未知状态，不捏造信号刷绿。

### 4.3 写范围

Zeno 保持在已获分配的 diagnosticsService.ts、dataQualityService.ts、Panel、对应 shared/preload 类型/白名单、限定 scheduler 题材函数、src/components/Onboarding/initializationTaskModel.ts 的当前源 skip 单点及其 tests；另按主代理最新授权修改 tushareService.ts 的 fetchStkAuction/fetchLimitListDaily 及两者必要的取消/截止到真实请求与重试等待的传播。新增动作复用原有行情服务和仓库，不改 morningAuctionService、conceptRouter、初始化大流程或策略算法，不改变其他行情调用的默认行为。Panel/shared/preload 的精确文件由主代理已读路径确定，本轮未读，不臆造新路径。

## 5. 最小隔离验收矩阵

| 输入/故障点 | 必须证明 |
|---|---|
| 截图式基础计数、各选配表为空 | 基础已有事实保留，不提示全库重建；auction 仍明确缺失；未选中题材/未请求分钟不假报失败。 |
| 当前 THS 空、KPL 非空，再反向切换 | 只能用当前源判断 readiness/初始化 skip；正在跑旧源不刷新为新源成功。 |
| 超过七天的闭市区间、开市日前后、18:00/09:30 边界 | 期望日期来自注入的实际日历；无自然日伪 stale，未出数时 waiting。 |
| 今日或中间日历缺失、范围外、日历冲突 | unknown/blocked+明确原因，不按 weekday 猜测或悄悄覆盖。 |
| limitList=0，auction=0，但 mock 行情接口有有效分页返回 | 竞价动作确实调用 fetchStkAuction 并落目标日缓存，不受分池提前返回限制，不发派生信号。 |
| Token 未配置 / 权限未知 / 401 / 权限拒绝 / 429 / 超时 / 网络异常 / 空响应 | 状态与证据一一对应；无响应不能声称权限拒绝；均不清空已有缓存或假报完成。 |
| 错日期、未来日期、无效价格、少量有效行、再次同步 | 非目标事实不得用于刷绿；部分覆盖可见，主键幂等，重复请求 single-flight。 |
| 竞价已补但前日 limitList 缺失 | 原始事实与分池依赖状态分离；单日涨跌停动作不触发 KPL/筹码/全盘后同步。 |
| KPL/DC 长假且 limitList 空；THS 部分成员请求失败 | 正确交易日；返回 partial/failed，既有成员不被成功子集清空替换；不将 void/null 当成功。 |
| 无目标/未运行/已运行零命中/未成熟的派生任务 | 显示不同原因，0/0 为样本不可计算而非 0% 胜率；不得从 todaySignals=11 推出评估有11个样本。 |
| Darwin 与 Win32 同一隔离 fixture | 判定一致；平台适配错误独立呈现，不将 generic 网络或本地为空认定为 Mac 专属。 |

本轮仅设计，未运行上述测试。Zeno 实现后由 Astra 用合成 SQLite/注入时钟/假行情响应执行，不访问生产数据或发起真实请求；已有原生依赖若 ABI 不兼容则报告阻断，不下载或重建依赖来绕过范围。

## 6. Mac 与跨平台边界

已读的空表映射、自然日过期、题材取日、同步结果丢失和竞价提前返回均未依赖 darwin 分支，是跨平台共有路径。Mac 的文件权限、钥匙串/Token 解密、网络代理/证书、休眠错过定时器可能需要目标机证据，但本次没有该证据，不能指定其为用户失败根因。截图已有大量 SQLite 数据，不能因此断言其他库/字段绝无问题，也不能反过来要求重装或删除 profile。

最终建议：先交付“准确状态 + 可用单日补齐入口 + 选中源保真结果”这一完整纵向切片，避免重做基础数据；随后独立验收，再安排必要的派生任务与目标 Mac 检查。本次不涉及交易 SQLite、native 验收、安装或 1.2 发布。

## Astra 联合独立验收中间记录（2026-10-08，目标 1.2）

状态：**正常竞价后端入口 FAIL；Zeno 诊断切片的最终独立结论暂未签发**。下列证据不是开发方通过数的转述。后续修复不得靠禁用正常竞价、只保留预览或仅诊断按钮绕过正常入口求通过。

### 已复现的正常入口阻断

1. **R-ENTRY-OBS（P2）：混合观察被整池升级为 ready。** 当前时刻 09:31，两条字段完整的同日竞价分别观察于 09:31 与 09:15；另一变体把第二条观察时间设为未来 09:40。真实入口均返回 `eligibleRows=1, afterCutoffRows=1, validRows=2`，但 `threeOne.allMarket={state:ready,candidates:2}`。个股信号门禁仍只发布有资格的一条，不能据此宣称整个池已就绪。根因：`morningAuctionEntryPolicy.ts:155` 采用任意一条截止后观察确定全局 phase，`morningAuctionService.ts:891` 判断池 partial 时未检查池所依赖各行的观察资格。最小范围：这两个文件及专属测试；按池的实际依赖逐行判定观察完整性，保留有效个股首次发布能力，不改变 09:28 provisional 合同。证据：独立 N1 两个变体均失败。

2. **R-ENTRY-COOLDOWN（P2）：快照淘汰同时丢失请求冷却。** 固定同一时刻，依次刷新 `20260710 → 20260709 → 20260708 → 20260710`，假上游均返回空。实际发出四次请求，首尾同日两次请求间并未经过 60 秒。`morningAuctionService.ts:953` 仅从快照缓存取 lastAttempt，而 `:988` 将缓存限制为两个日期。最小范围：service/policy/专属测试；冷却门禁与可淘汰快照分离，受控有界保存未到期请求资格，容量耗尽时拒绝新增请求而非驱逐仍有效门禁。不得删除最多两日期并发、singleflight 或迟到保护。证据：独立 N2 失败。

### 独立执行记录

- Kant 原始冻结 suite：Node 20.20.2 / Windows x64 / ABI 115，**31/31，退出 0，1.28 秒**。这部分多数仓储及上游是 mock，不能替代真实 transport 证明。
- Zeno 冻结 10 个测试文件：Node 20.20.2 forks 单 worker，**83 pass、12 ABI 加载失败、1 skipped，退出 1，5.02 秒**。12 项使用到当前本地 ABI 145 的 better-sqlite3，不能在 ABI 115 下加载。跳过的是本地 HTTP server 用例，本轮不开放网络连接。
- 保留上述失败后，使用项目已有 Electron 41.1.0 / Node 24.14.0 / ABI 145，`ELECTRON_RUN_AS_NODE=1`，受控隐藏子进程执行三个真实内存 SQLite 测试文件：**12/12，子进程退出 0，4.65 秒**。未重建、替换或下载依赖，未操作安装版。首次 PowerShell 直接启动没有提供可计数日志，不计通过；有效记录是 controlled 日志。
- 新增 Astra 正常入口反例及正控：**7 项，4 pass / 3 fail，退出 1，0.843 秒**。两个失败对应上述两个问题，其中 R-ENTRY-OBS 有两个变体。
- 正控实际运行正常入口与真实 Tushare 有界函数，只有底层 fetch 为假传输：09:28 可真实取得合成响应、保存并首次 emit，同日期 get/refresh 共用请求；真实 fetch 收到 abort，未重试/写入；4 个唯一满页触发分页上限后不落子集；历史查询零 emit/dismiss。未调用真实信号发送器或交易通道。
- 新增诊断联合探针首轮 **6 fail / 8 pass，退出 1**，但 IPC 路径在假传输前统一产生 `DIAGNOSTICS_FAILED`，D3 等实际 fetch 次数为 0；这是隔离夹具/mock 解析问题，**整轮不能作为诊断联合验收通过证据，也不能作为产品 IPC 缺陷证据**。已请求仅修正 K 盘探针配置后重跑，未经确认不修改探针。

### 待补独立反例，尚不冒充已验证

源码显示需继续证实三类风险：`preserveFactBatch` 回填旧非空字段时保留了新 fetchedAt；满页后收到缺失 data 的响应可能被当成正常分页终止；依赖墙钟的跨页预算遇到时钟回拨可能超过 30 秒。原始数字解析还需区分非法数值与真实 null。联合探针 IPC 夹具未通过前，不将这些假设计为已复现产品结论。现有 83+12 项仍不足以独立签发整个诊断切片 PASS。

### 源码绑定与边界

Kant 三文件 SHA256 分别为：

- `electron/main/services/morningAuctionService.ts`: `3a7400ac23b43ee4728d99c29278c533063598e89a8f50232fb544b634313c8d`
- `electron/main/services/morningAuctionEntryPolicy.ts`: `1c9d5680c6601190a227efc0f7e1dc52f2a66083ff82cdd9125ccef2eb008d1b`
- `tests/unit/morningAuctionEntry.service.test.ts`: `f16fb4326255f4b99260daf7a8e66f72cc74d7064962073e321d67555f854c8a`

Zeno 正式冻结的 `dataReadinessService.ts` 为 `a36a99465a16abce1f4d4c75e868cd044256e7206faf47666d8b2cb518097fed`，`tushareService.ts` 为 `2ac575606a8f0e9ba4d3f8f22f9289013b06818f629669824caaa2652f7439c3`，与先前入口执行时捕获值相同。23 文件、其余依赖的完整原字节副本及哈希见 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/frozen-manifest.json`。新探针导入本次冻结的真实工程模块，没有内嵌旧实现。后续任一相关业务依赖改动必须重新绑定并补相应回归。

日志目录：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da`；主要文件 `suite.log`、`zeno-suite.log`、`zeno-sqlite-electron-controlled.log`、`astra-normal-results.log`、`astra-diagnostic-results.log`。

主代理已通知 package version 1.2.0、README 与 1.2 开发期说明的已知元数据修改，本轮不把它们当未知漂移；1.2 仍未发布。正常 MorningAuction UI 三文件未冻结，不在本轮通过范围；startup 补偿未实现；默认初始化仍不包含竞价。真实 Mac 实采、Tushare 实际权限与用户原请求失败原因均未验证，不作成功或归因推断。仅写本报告与独立探针，不改业务/测试源码、主库、交易 SQLite、native 验收或已发布 1.1 制品。


### 后续范围更新：正常竞价 UI 三文件已独立验收（2026-10-08）

本节覆盖上文“UI 未冻结、不纳入”的临时边界：主代理已正式交接 UI 三文件，现纳入 **23 + 3 + 3 = 29 文件**。上文正常入口 FAIL 与诊断联合探针未计数的事实不变。

**UI 切片结论：PASS（纯逻辑测试 + 实际页面源码接线范围）**；没有执行 DOM/浏览器/原生 Mac 渲染，不能据此宣称安装版展示已实测或整个竞价功能通过。

- 使用 Node 20.20.2 / ABI 115，forks 单 worker，独立执行 `morningAuctionReadinessViewModel.test.ts`：**39/39，退出 0，0.517 秒**；无网络、无真实 profile。日志 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/ui-suite.log`。
- 实际页面 `MorningAuction.tsx:1657` 将 selectedDate、snapshot.tradeDate、readiness、isMock 一起交给模型；未知/错日的状态为 warning，页面 `:1753` 使用红/黄/灰配色，不将未知标成绿色正常。
- 09:28 provisional 只映射后端 phase；新模型无 Date.now、采集、IPC、计时升级或交易调用。上次失败与已有有效行/观察时间同时显示，coverage 始终未知；source 明确写“题材源”，页面行情标签保持 stk_auction。
- `MorningAuction.tsx:1955` 将模型空态传给 CandidateQueue，`:884` 真正渲染该文本，不把缺输入的空列表写成无机会。
- `:1764` 的“打开数据工具”仅调用已有 onOpenDataTools；`:1777` 明说单日事实补齐位于配置中心-诊断，不伪称按钮打开诊断或补齐历史。标题栏 `:1731` 显示“按需更新”。既有页面功能的刷新/题材读取仍存在，不能将“本次展示逻辑不新增采集”误写成整个页面零请求。
- 非阻断文案残余：模型映射 TOKEN_MISSING，但当前后端无配置返回 NOT_CONFIGURED；OBSERVED_ROWS_PERSISTED 与 PARTIAL_OBSERVATION_RETAINED_FACTS 也未映射，因此这些真实回执会安全降级为“原因未知”。建议后续只补当前真实枚举文案，不改变业务状态、不据此放松后端门禁。

UI 原字节 SHA256：

- `src/components/ShortTermStrategy/MorningAuction.tsx`: `b00596e990c530ad4e3d41ad06d3b87a1b83d742d58d7740d13baaef0ab8da7f`
- `src/components/ShortTermStrategy/morningAuctionReadinessViewModel.ts`: `c16cd7d63b49d698ecde4ad7c8220b0d6b43fb7073c1fe77810f367ba7af64d9`
- `tests/unit/morningAuctionReadinessViewModel.test.ts`: `16500183cd3a11890f92a67510d96f35cabc529b2405e6d22aad0cc024f0af1c`

全部 29 文件精确路径、字节数、哈希和必要依赖绑定已写入 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/acceptance-source-manifest.json`。本轮最短已证实产品修复清单仅 R-ENTRY-OBS 与 R-ENTRY-COOLDOWN；诊断需先修复我方隔离探针解析再签发结论，不能因已有 95 项有效通过而跳过联合反例。等待该探针修正授权，不修改业务代码。startup、真实 Mac 实采、权限及最终 1.2 发布仍全部不在本段通过范围。

## Astra 最终分片独立结论（2026-10-08，23 + 3 + 3 冻结范围）

本节取代上文“诊断暂未签发/等待探针修正授权”的中间状态；历史失败日志与原文保留，不改写失败事实。用户随后明确授权修正独立探针的机械配置并继续验收。

| 切片 | 本次结论 | 边界 |
| --- | --- | --- |
| Zeno 数据/诊断 23 文件 | **FAIL** | 真实 helper + IPC handler + SQLite + 假 transport 联合反例复现 4 项问题 |
| Kant 正常入口 3 文件 | **FAIL，保持** | R-ENTRY-OBS、R-ENTRY-COOLDOWN 未收到修复 hash，未复验修复版 |
| Zeno 正常入口 UI 3 文件 | **限定 PASS** | 独立 39/39 + 实际源码接线；未做 DOM/原生 Mac 渲染 |
| startup / 实际 Mac 上游采集 / 1.2 发布 | **未验收** | 不属于上述通过范围 |

### 探针纠正与证据有效性

独立目录位于工程 node_modules 的同级外部目录，初版探针对 Electron 的裸模块 mock 与工程内解析身份不一致；IPC 提前报 DIAGNOSTICS_FAILED、假 fetch 次数为 0。新配置给 Electron 明确解析映射，原业务断言 **一条未改**。初版配置和 `astra-diagnostic-results.log` 均保留，整轮不计产品通过或失败。

为避免在 Sol 修正常入口期间混入未交接代码，v2 仅从已经捕获的冻结原字节副本加载相关模块，保留原工程模块 ID/相对依赖解析；加载时逐文件核对 SHA256，不匹配直接失败，没有嵌入自造或旧版替代实现。配置含 35 个去重源码绑定，本轮实际命中并校验 18 个，完整记录 `astra-v2-loaded-hashes.jsonl`。其余冻结文件由之前的独立用例和限定源码审阅覆盖，不宣称本轮动态遍历了全部 29 文件。

受控隐藏子进程：Electron 41.1.0 / Node 24.14.0 / ABI 145 / Windows x64，ELECTRON_RUN_AS_NODE=1，Vitest 2.1.9 forks 单 worker，TEMP/TMP 为 K 盘独立目录。真实内存 SQLite + 真实迁移/竞价与涨跌停仓储；真实诊断 helper 和 IPC handler；仅 fetch、秘密配置、Electron 窗口/信任注册边界、策略/发布及非本次业务依赖为隔离替身。不会调用真实凭证、主库、原生窗口、真实通知/交易或任何网络。

**v2 联合结果：14 项，10 pass / 4 fail，子进程退出 1，4.67 秒。** 日志 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-diagnostic-v2-results.log`。此前 Node20 的 83 项、适配现有 ABI 后的 SQLite 12 项仍是有效分层证据；第一次 ABI 115/145 失败记录仍保留，未重建依赖。不能把 95 个已有通过数覆盖本轮 4 个行为反例。

### 诊断四项最小阻断及修复合同

#### D1 / R-DATA-OBSERVATION，P1：旧字段被赋予新观察时间，并进入当前机会发布边界

位置：`electron/main/services/diagnosticFactSyncService.ts:43`、`:52`、`:55`、`:57`；下游资格检查 `morningAuctionEntryPolicy.ts:94` 与发布准备 `morningAuctionService.ts:991`。

精确复现：北京时间 2026-10-08 09:31，真实内存库已有 09:15 观察的 600001.SH，price=10.5、preClose=10、vol=600000、amount=6000000、turnoverRate=0.2、floatShare=40000。假传输返回同日同股相同 price/vol/preClose，但 amount/turnover_rate/float_share 均为真实 null。通过实际 diagnostics:runCheck 执行 syncAuctionSnapshot，再进入正常 get。

实际：诊断返回 ok:true / FACTS_SAVED；旧字段被回填，但 fetched_at 从 1791422100000 更新到 1791423060000；入口变成 observed_after_cutoff、allMarket ready，并向被隔离的 emit 边界提交 1 条 OPPORTUNITY，signalTime=09:31。本轮没有发送真实通知。

必须断言：借用旧字段的合成行不能获得新的完整观察资格；保留真实旧字段及其保守时间/来源，不能因为补齐动作就首次发布当前机会。诊断动作自身依然不得运行策略/emit。若无逐字段观察模型，最小可靠方式是只要借用了旧事实就保留该行旧观察时间，披露“保留旧事实/观察未补齐”；允许保存真实新事实，但不能让写入成功暗示观察完整。完整且有效的新响应仍可更新观察时间，正常入口仍可首次发布新键。

最小范围：diagnosticFactSyncService.ts + 对应 fact-only/SQLite 集成测试；仅在需要新增稳定部分完成码时扩展 shared/dataReadiness.ts 的文案/映射。不需要用禁用入口解决。

#### D2 / R-DATA-RAW-NUMERIC，P1：非法数值先被变成 null，再被当作成功补齐

位置：`electron/main/services/tushareService.ts:1088` 与有界竞价解析 `:1348`，随后进入上述 preserveFactBatch。

精确复现：沿用 D1 旧行，将上游 amount 返回字符串 `not-a-number`，其余字段真实有效。实际 parser 把非法数值转成 null，helper 回填旧 amount=6000000 并更新 fetched_at，IPC 返回 ok:true、FACTS_SAVED、insertedRows=1。

必须断言：非法原始数值与真正 null/缺失字段分开处理；非法值应在整个批次落库之前被拒绝，稳定返回 FACT_INVALID、insertedRows=0，旧行包括 fetched_at 完全不变。可接受数字字符串的格式应明确且整串校验，不能接受前缀解析、非有限数或不合字段语义的数值。真正可空值不能为求测试通过被填 0 或一律拒绝，保留旧值时遵守 D1。

最小范围：tushareService.ts 中仅 fetchStkAuction/fetchLimitListDaily 的有界解析分支及私有 helper + 运输/联合测试。不要直接改变被其他默认调用共用的宽松 parser 行为。

限制：本次 D2 的 negative-volume 变体被已有旧行冲突门禁拒绝并通过；它证明此具体冲突未落库，**不证明全新负数行已具备完整语义校验**，不据此另造未执行的失败结论。

#### D3 / R-DATA-PAGE-TERMINATOR，P1：缺失响应 data 被当作正常终止页，落入 5000 行子集

位置：`electron/main/services/tushareService.ts:1162`、`:1385`。

精确复现：首请求返回 5000 条互不重复、日期/字段有效的行；第二请求返回 HTTP 成功、JSON `{code:0}`，没有 data。库原来有 1 条旧事实。

实际：两次 fetch 后 IPC ok:true、FACTS_SAVED、insertedRows=5000，真实库共 5001 行。coverage:unknown 的免责声明不能使异常分页终止变成成功的完整批次处理。

必须断言：满页之后缺失/null data 或无效 envelope 必须非成功，不能被当成合法末页；本批前面累积的行一条不写，旧事实保持。合法终止页应有可验证结构与 items（可为空）；首次真正空结果仍返回 empty，不猜为权限错误。重复页、无进展、4 页上限和失败页继续整批拒绝。

最小范围：tushareService.ts 中有界响应校验及竞价分页分支 + tushare.diagnosticBounds / fact-only SQLite 联合测试，不改无 options 默认调用行为。

#### D12 / R-DATA-MONOTONIC-BUDGET，P2：墙钟回拨使 30 秒预算失效

位置：`electron/main/services/diagnosticFactSyncService.ts:81`、`:89`；`tushareService.ts:1121`、`:1129`、`:1153`。

精确复现：每页真实假 fetch 在 12 秒后返回一个有效满页；执行到第 12 秒把墙钟回拨 1 小时。advanceTimers 到累计 30 秒时动作仍 pending；第 4 页在累计 48 秒返回，最终因分页上限而非总预算停止，实际发出 4 次请求，未落库。

必须断言：整次动作共享不重置的单调 30 秒预算和 AbortController，向真实 fetch、body 消费、重试等待传播；墙钟回拨/切页不能延长预算。计时器和外部取消连接应在 finally 清理，提交之前还要检查单调截止；不得仅 Promise.race 后让真实请求继续运行。超过预算不再取下一页、不重试、不落子集。保留正常 1 次尝试、4 页上限、同 action/date singleflight；未提供 options 的默认调用行为不变。此保证是可协作取消/恢复执行时检查，不声称 JS/OS 调度提供硬实时保证。

最小范围：diagnosticFactSyncService.ts 整体动作预算；必要的有界 Tushare helper 与专属测试。不得以删除真实采集来满足时限。

### 联合正控与仍然成立的保护

- D4：真实有界路径的合法空响应及 HTTP403 均经实际 IPC 返回 ok:false+receipt，旧 SQLite 事实不变，不运行策略或发布。
- D5：删除真实交易日历中 20261003 这一假期中间日后，两动作 CALENDAR_UNAVAILABLE，fetch=0、写入=0；不以 MAX 旧日或自然日补猜。
- D6：09:29:59 自动目标为 20260930，09:30:00 为 20261008；诊断两次均只保存事实、零发布。随后正常入口对有效完整新行仍产生候选并首次触达隔离发布边界，证明不是禁用业务换通过。
- D7：实际 concept helper 遇 THS 部分成员失败不调用 replacement，独立 SQLite 审计表保持原行。此用例没有动态执行整个 scheduler wrapper，不能写成全调度原生验收。
- D8/D9：实际 Tushare 有界函数将 abort 传到假 response body；重试等待收到取消后不再 fetch，不只是外层 race。
- D10：SQLite 插入触发器注入失败，真实仓储事务回滚、实际 IPC 返回 WRITE_FAILED，旧事实不变。
- D11：实际 health 的未选 KPL/DC 与空按需 minute 显示 neutral，不增加 ok；当前 THS 缺数据仍参与评价。此前当前源 skip、THS partial、诊断汇总及初始化任务用例仍通过。默认初始化不包含竞价这一产品边界未改变。

### 给 Kant 的精确复现及最小修复合同（两项维持 FAIL）

**R-ENTRY-OBS，独立 N1 两个变体。** 固定北京时间 2026-07-10 09:31；同日放两条完整竞价，第一条 fetchedAt=09:31，第二条分别为 09:15 / 09:40，股票 600001.SH / 600002.SH，均 price=10.5、preClose=10、amount=6000000、turnoverRate=0.2、floatShare=40000。调用 getOrCreateMorningAuctionSnapshot(20260710)。实际 validRows=2、eligibleRows=1、afterCutoffRows=1、allMarket candidates=2/state=ready；独立断言 `pools['threeOne.allMarket'].state === 'partial'` 失败。只有第一条触达 emit 的断言通过，不能说个股发送门禁本身失效。

精确位置以本节为准：`morningAuctionEntryPolicy.ts:145` / `:151` 为“任意截止后行决定整体 phase”；`morningAuctionService.ts:891` 为池 partial 漏检逐行观察资格。最小合同：当前日按每个池实际依赖的输入/候选判定观察完整性；混合旧/未来/无可核验时间时不能整池 ready 或完整 no_match。保留旧事实用于显式预览，保留有效新行的首次发布能力，09:28 继续 provisional；不强迫新增 phase 枚举，不把历史资格与当前发布资格混淆。只改 service/policy/专属测试。

**R-ENTRY-COOLDOWN，独立 N2。** 固定北京时间 2026-07-10 09:28、不推进任何时间，启用合成数据源且上游返回空，顺序 await refresh `20260710 → 20260709 → 20260708 → 20260710`。实际传输日期正是这四个，首尾同日请求 2 次；独立断言 `calls.filter(date === '20260710').length === 1` 失败。

精确位置：`morningAuctionService.ts:952` / `:953` 从可淘汰快照取 lastAttempt，`:960` 用该记录判断冷却，`:988` 两日期缓存淘汰后丢失门禁。最小合同：快照 LRU 与请求资格分离；未到期冷却记录不得被访问其他日期或迟到结果丢弃，另设有界容量并在满额时给出明确非请求回执，不能靠驱逐未到期门禁放行；用单调 elapsed 保证 60 秒。维持每日期 get/refresh singleflight、最多两个日期同时执行、迟到保护和最多一次 local 追赶。旧快照可被重建，不代表允许再次远端请求。

两项的原始日志为 `astra-normal-results.log`。本轮 D1/D6 只在冻结旧正常入口上检验与诊断的组合，不构成 Kant 修复验收；必须提供新的 service/policy/test hash 后重跑 N1/N2 及必要正控，才可能解除 FAIL。

### 最短修复集合与最终源码绑定

诊断最短集合：**diagnosticFactSyncService.ts + tushareService.ts + 对应限定测试**；只在新增部分完成回执需要时改 shared/dataReadiness.ts。正常入口另由 Kant 修 **morningAuctionService.ts + morningAuctionEntryPolicy.ts + 专属测试**。本轮没有理由扩大到启动调度、主业务数据库迁移、实盘交易、默认接口或产品重写。

全部 29 文件原字节 hash 与必要依赖沿用前文冻结值，最终机器可读结论为 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/acceptance-source-manifest-v2.json`；本轮实际加载记录附在其中，并有独立 jsonl。旧 manifest 的“等待授权”仅是历史中间状态，以 v2 为准。诊断关键绑定为 helper `77763cdc1014a7bb41fcf23a78016e7e35139a0411225b69a80fad459d743b2f`、Tushare `2ac575606a8f0e9ba4d3f8f22f9289013b06818f629669824caaa2652f7439c3`、IPC `2458f2719d4a07723cdb865472a420a2f12461533a3460b4222153df7db38910`，没有把 Sol 未交接的新实现混入。

只写 Astra 报告及 K 盘隔离配置/日志，未改业务源码或工程测试。未接触账户、token、主库、交易 SQLite、安装版、native 验收、网络、CI/publish。已知 package 1.2.0 与文档元数据更新不视为源码漂移；1.2 未发布。真实 Mac 的上游权限/采集、原生渲染、startup 补偿及最终产品发布均不在此有限 PASS 范围，不归因用户原失败。

### 最终必要补验：测试清单对齐与 UI 文案新哈希（2026-10-08）

**诊断 4 项和正常入口 2 项均继续 FAIL，尚未接收它们的修复哈希；本段没有重跑 Kant 旧哈希反例，也没有扩大业务审查范围。**

测试清单核对来自原冻结 23 文件与实际独立运行参数的逐项比对，missing=[]、extra=[]。冻结范围中恰有 10 个诊断测试文件，均已执行：

- tests/unit/dataReadiness.contract.test.ts
- tests/unit/diagnostics.factOnly.test.ts
- tests/unit/tushare.diagnosticBounds.test.ts
- tests/unit/conceptSync.readiness.test.ts
- tests/unit/diagnostics.readinessIpc.test.ts
- tests/unit/diagnostics.readinessHealth.test.ts
- tests/unit/diagnostics.factOnly.sqlite.test.ts
- tests/unit/initializationTaskModel.test.ts
- tests/unit/dataQuality.service.test.ts
- tests/unit/diagnostics.dailyCloseQuality.test.ts

29 文件中另外两个测试文件属于正常入口和 UI，均另记结果，不混入诊断统计。Node20 首轮这 10 文件共有 96 项：83 pass + 12 ABI 加载失败 + 1 skip。随后 Electron 12/12 是三个 SQLite 文件中上述同一批 12 项的重新执行，不是新增 12 项。因此唯一有效通过数为 **95，另 1 skip**，不是“完整 101 回归”。skip 是显式不启动本地 HTTP server 的用例；实际 fake-fetch/body/retry 取消已独立执行，不能把它算成该 HTTP 用例通过。

开发方声明 11 文件 101/101，未提供额外那个文件的完整清单；若它包含相同 10 文件，则数值差为另一个文件的 5 项加本轮跳过的 1 项。没有证据确认该文件身份，不猜测为某个既有测试，不在未授权范围扩跑，也不将开发方另一次 Electron 12/12 简单相加为 113 个唯一用例。冻结范围内不存在需要补跑的遗漏测试文件。

UI 已接收并独立核对新原字节 SHA256：

- src/components/ShortTermStrategy/morningAuctionReadinessViewModel.ts：`543d76d3b6738125178518dba9578c4cea545b66b4477614d2666f21ca32eacb`
- tests/unit/morningAuctionReadinessViewModel.test.ts：`2d0684a3d63035c4f252ec6098b502e28187fcf5fc4b476bdd259ca122dd4336`

与已审旧快照的字节内容差异仅为 NOT_CONFIGURED、OBSERVED_ROWS_PERSISTED、PARTIAL_OBSERVATION_RETAINED_FACTS 三条文案及对应 3 项参数化测试，无状态判断修改。页面文件沿用已冻结哈希 `b00596e990c530ad4e3d41ad06d3b87a1b83d742d58d7740d13baaef0ab8da7f`，没有重复读取/运行未变更页面。

独立 Node20 forks 补验变更后的 UI 测试文件：**42/42，退出 0，0.537 秒**，日志 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/ui-v2-suite.log`。覆盖真实码说明，同时保持 phase、tone、outcome、coverage 与失败旧缓存/空态含义。原先三条真实码文案残余已在此有限范围关闭，UI 继续限定 PASS；仍未做 DOM/原生渲染。

最新 29 文件源绑定与分片结论为 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/acceptance-source-manifest-v3.json`，只替换上述 UI 两条哈希；诊断 v2 实际加载的 18 项哈希及 14 项 10 pass / 4 fail 证据不变。前文 D1/D2/D3/D12 已给出源路径/精确行号、原始复现、必须断言、正向业务保留要求和最短修复范围，作为交付 Zeno 的实施输入，不用既有测试通过数覆盖反例。等待修复版哈希后再验，不改产品源码。

## Kant 正常入口修复版独立补验：冷却仍未满足单调时钟契约

本节接续前面的旧版结论，仅替换正常入口 3 文件绑定；诊断四项阻断与 UI 文案补验结论不变。未读取 Zeno 正在修改的文件，未重复运行未变全量回归。当前结果为 **正常入口 FAIL，最终集成 FAIL**；不能将开发方 110/110 作为独立验收。

### 本次源绑定与执行边界

- `electron/main/services/morningAuctionService.ts`：SHA256 `7edb2e5f58c7efd4b32e525f0dd22f8a33dcffb0bbbac62f92ed91f7a22da9a5`，50852 字节。
- `electron/main/services/morningAuctionEntryPolicy.ts`：SHA256 `e3ead07eb60198e56477ab8cc399c72caf22caf5d9b44bcc924271d96d49369d`，10069 字节。
- `tests/unit/morningAuctionEntry.service.test.ts`：SHA256 `4d0da4959a214db130c94f4168f2a4f4d4953f25a84a495efd1cec196f39d6f8`，35303 字节。

运行平台为 Windows x64、Node 20.20.2、ABI 115，TEMP/TMP 位于 K 盘隔离目录。Vitest 在原模块 ID 上加载已冻结原字节并核验 SHA256；没有内嵌旧实现来冒充修复版。执行的是旧 N1 两个参数变体、旧 N2，以及新 B1 至 B9 独立边界，**12 项执行，10 PASS / 2 FAIL，退出 1，1.35 秒**。旧探针另 4 项因测试名筛选未执行，不计通过或新失败。Sol 新测试文件只绑定、审阅，没有宣称重新执行其完整 54 项或关联 110 项。

- 联合执行日志：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-kant-v2-results.log`。
- 旧反例：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-normal.test.ts`。
- 新边界探针：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-kant-boundaries.test.ts`。
- 实际加载哈希：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-kant-v2-loaded-hashes.jsonl`，10 个不同模块。
- 隔离配置：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-kant-v2.config.mjs`。
- 最新 29 文件清单与分片结果：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/acceptance-source-manifest-v4.json`。

实际加载的传输仍为已冻结旧版 `tushareService.ts` SHA256 `2ac575606a8f0e9ba4d3f8f22f9289013b06818f629669824caaa2652f7439c3`；日历上下文 `dataReadinessService.ts` 为 `a36a99465a16abce1f4d4c75e868cd044256e7206faf47666d8b2cb518097fed`，实际交易日历 `officialSseTradingCalendar.ts` 为 `bc91bef50bfbecdf41660e3e81d21c2a6d04ef859900ea28083a3e6a3fdc8da0`。本轮入口请求使用隔离 stub，业务 service/policy 为新真实源码；不得把这些用例算作新传输取消通过。待 Zeno 最终传输哈希交付，必须结合最终依赖重验受影响联合反例。

### 本次唯一新增最小阻断：R-ENTRY-COOLDOWN / 单调时钟（P2）

源码位置：`electron/main/services/morningAuctionService.ts:566` 的门禁只存 `attempt/pending`，`:990` 取墙钟，`:993` 用 `Date.now() - attempt.startedAt >= 60000` 清理；`:1007` 创建门禁时没有独立单调时钟起点。独立容量门禁解决了快照淘汰绕过，但该算式仍允许系统校时改变 60 秒期限。

1. **B1，墙钟前跳提前重试。** 09:28 首次请求空结果，保持单调时钟经过 0ms，只将墙钟改为 09:29:01，再刷新同日。必须断言上游请求仍为 1 次，实际为 2 次。探针第 124 行先验证 `performance.now()` 差值确为 0，第 127 行真实次数断言失败，排除“测试已经经过 60 秒”的解释。
2. **B2，墙钟回拨延长冷却。** 09:35 首次请求后将墙钟退至 09:34，再推进单调计时 60,000ms，此时墙钟回到 09:35，再刷新同日。必须允许第 2 次请求，实际仍为 1 次。探针第 134 行验证单调差值为 60,000，第 137 行次数断言失败。不能用墙钟回到原值就判定没有经过时间。

最小修复只需要正常入口 service 的门禁字段、准入/清理逻辑，以及对应专属测试：准入时另存 `performance.now()` 或 `process.hrtime.bigint()` 的单调起点，清理和容量回收只用同一单调时钟差值；原 `attempt.startedAt/endedAt` 继续记录墙钟供展示与审计，不与单调值混算。保留“请求开始后 60 秒且已经结束才可回收”的既定语义，pending 门禁不得被到期清理；满 32 个未到期门禁拒绝新采集，但本地已有事实仍可构建。不改交易日、09:28/09:30 的业务墙钟判断，不触碰 scheduler、诊断传输或 UI，也不以延长到无限冷却替代修复。

补验至少原样重跑 B1/B2，加 B3/B4 的 59,999/60,000ms、容量释放与正向本地使用。门禁单调字段不需要持久化为跨启动时间，也不需要扩展全产品锁协议。本轮这两个失败已是有效产品反例，不属于 Electron mock 机械配置错误。

### 已通过的旧反例和必要正向行为

| 用例 | 独立结果及范围 |
| --- | --- |
| N1 两变体 | 09:31 时一条有效观察混入 09:15 旧观察或 09:40 未来观察，均为 due_unconfirmed、allMarket partial；保留 2 候选，只向隔离 emit spy 发布 1 个合格新键。R-ENTRY-OBS 在该新入口哈希上关闭。 |
| N2 | 固定时钟的 0710 → 0709 → 0708 → 0710 只有 3 次请求，快照两日期容量淘汰不再驱逐冷却门禁。旧缓存淘汰子缺陷关闭，但整体冷却要求因 B1/B2 仍 FAIL。 |
| B3 | 无墙钟跳变时 59,999ms 仍为 1 次，60,000ms 可第 2 次请求。该通过不能替代单调时钟证据。 |
| B4 | 32 个未到期门禁拒绝第 33 日期且不驱逐最早门禁；已有同日有效本地事实仍能构建并发布首次合格键。无校时场景 60 秒后可回收容量并请求。日期来自真实日历夹具，不用工作日猜测。 |
| B5 | 同日 get/refresh singleflight、最多两日期采集，第三日期 ENTRY_BUSY；旧 generation 迟到不覆盖新快照，其已准入门禁也不会丢失。 |
| B6 | 即使旧观察未达到候选阈值，也不能把空 allMarket 说成已确认无机会；真正新观察补齐后才可 no_match。 |
| B7 | 缺二板依赖只阻对应池，不压制独立完备的一板池；补齐后仅发布首次出现的合格新键，不重复一板旧键。 |
| B8 | 权限失败的门禁在快照淘汰、题材源切换后仍保留，固定时间三日期再回访仍只有 3 次请求。 |
| B9 | 输入持续变化时最多一次 local 追赶，仍变化返回 DATA_CHANGED_RETRY，零发布，不形成无界重建。 |

上述“发布”均是隔离调用记录，不是真实客户端信号、通知或订单。入口对旧/未来时间戳的过滤通过，不代表诊断 D1 的“保留旧字段却盖上新 fetchedAt”已修复；后者仍可能把混合事实伪装成合格输入，必须单独修复并联合重验。

### 本轮交接结论

正常入口最短剩余修复是 **一个独立单调门禁起点及其两类校时反例**；不需要撤回本次观察资格、独立 32 门禁、分池依赖和迟到保护的已验证修复。诊断 D1/D2/D3/D12 维持 FAIL，等待 Zeno 新哈希；UI 继续仅纯逻辑 42/42 的限定 PASS。此前首次探针配置失败日志、产品失败日志及 v1/v2/v3 清单全部保留。本轮未修改任何产品源码/测试，未运行真实网络、账户、主库、安装版或发布；startup 补偿与目标 Mac 实采仍不在已证范围。

## 最终冻结组合：限定数据/竞价切片 PASS（2026-10-08）

本节取代前面的“待修复/最终集成 FAIL”，历史失败记录不删除。最终组合为 Zeno 新 7 文件、Kant 最新 service/test 及不变 policy、已独立通过且未变的 UI 3 文件，完整 29 项路径、字节数、SHA256 与捕获时间见：

`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/acceptance-source-manifest-final.json`

这份 manifest 保留未变项的已冻结原字节绑定，只替换本次正式交接的新版本，不声称重新扫描了整个工作区。实际执行加载的 18 个冻结模块另列其中，涵盖新 scope helper、真实 IPC、诊断 helper、缓存仓储与正常入口；不是用旧实现或全部 stub 代替新源。

### 最终必要检查

- 原 14 项诊断联合反例 + 12 项正常入口反例：**26/26，退出 0，6.19 秒**。日志 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-final-original-26-results.log`。另外 4 项未选择的旧用例不计通过。
- 必要真实 helper 正控：**2/2，退出 0，1.74 秒**。日志 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-final-positive-v3-results.log`。09:28 正常入口真实 bounded 请求可形成 observed_provisional 并首次发布；09:30 诊断只补事实，正常入口随后只发布新键。旧字段回填保留旧时间且不发布；等行数的完整新观察替换后可恢复一次发布，重复访问不重发。
- UI 继续沿用相同最终哈希的独立 **42/42 限定 PASS**，没有重跑未变套件。Zeno 开发 98、Kant 开发 70 不当作独立证据；本轮也不将旧 95 改称完整 101。

D1/D2/D3/D12 与 R-ENTRY-OBS/R-ENTRY-COOLDOWN 均在最终组合关闭。实际反例确认：非法数和 malformed 后续分页整批零写；保留旧观察不伪装当前机会；整次 30 秒预算在墙钟回拨后仍终止第三页，真实 fake transport/body/retry 收到取消；门禁墙钟前跳不提前重试、回拨不延长，32 容量、两日期并发、singleflight 和迟到保护仍通过。不是通过全锁、仅预览或取消正常业务取得 PASS。

运行环境为 Windows x64，已有 Electron 41.1.0 / Node 24.14.0 / ABI145 的纯 Node 子进程，真实 `:memory:` SQLite；请求只使用假 fetch，发信边界为隔离 spy，正控中把去重键写入内存 SQLite 夹具。未声称实际通知/完整 decisionSignalService 已联验。新建 scope helper 已由诊断和正常入口真实调用穿透，不是仅 Promise.race 或 mock helper 超时。

### 留痕与验收边界

正控首轮误用阶段字面量 provisional（实际为 observed_provisional），且沿用了不持久去重键的 emit stub；修正后的第二轮又把字符串填入 SQLite INTEGER 主键。两轮均为隔离夹具错误，分别保留 `astra-final-positive-results.log`、`astra-final-positive-v2-results.log`，不计产品失败或通过。最终夹具让 INTEGER 主键自动生成，真实写入去重键并断言内存信号行数，原“不重发”断言未放宽。此前命令过长被 Windows 拒绝、Node20/ABI115 无法加载现有 ABI145 绑定也单列留痕；未重建依赖。原产品失败日志继续保留。

**最终结论：本轮授权的 23 + 3 + 3 数据/正常入口/UI 切片限定 PASS，范围内已知阻断清零，可交付下一集成环节。** 不等于 1.2 已发布或整个产品验收完成。没有用户 Mac 实采、真实权限确认、原生/DOM 渲染或跨版本证明；startup 补偿、安装包、Euclid base/workflow 均不在此 29 文件签字范围。未改业务源码/测试，未操作用户 profile、真实账户、主库、券商或订单。

## 候选 A 组 dataQuality 修复后最小独立补验：PASS

正式绑定 `electron/main/services/dataQualityService.ts` SHA256 `4c8850bdd34644df3bfb0b7278aea80ae0178d24ed225de6d5f796f50935c19d`；同时捕获 `tests/unit/benchmarkAsOfQuality.test.ts` SHA256 `90edbe5e0e94ab598f751949b86c771829749fbff9d4083edc62123984e0e1bc`。没有把前一版本 PASS 自动延伸到本次改动。

独立在已有 Electron 纯 Node / Windows / ABI145、真实内存 SQLite、假传输下执行 **20/20，退出 0，8.02 秒**：原诊断联合 14 项 + 原真实 helper/正常入口正控 2 项 + 独立 as-of 4 项。未重跑 UI42、正常入口纯套件、Euclid 负责的 A13/B36 或其他已通过检查。

- 原样 7/24 仅有 7/27 的未知/冲突日历两例：blocked、recordCount=0、earliest/latest=null、CALENDAR_UNAVAILABLE，4 条原始记录完全保留。
- 日历未知时只用既有结算自然日期作上界，不推断交易日；日前边界包含 7/23，排除未结算 7/24 和未来 7/27。两个缓存按 code/date 去重为 4，原始各 12 行保留，仍 degraded/CALENDAR_UNAVAILABLE，不刷绿。
- 已知日历下 30 个已完成交易日/四基准仍 reliable、120 条。诊断取消/分页/零写入、09:28 provisional 首次发布、09:30 新事实恢复且不重发的原联合行为继续通过。

日志：`K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-dq-asof-results.log`。加载器实际核验 18 个冻结模块，确认运行的是上述新 dataQuality 哈希，明细 `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/astra-dq-asof-loaded-unique.json`。

同一最终 manifest `K:/AI/person/money/.tmp/astra-auction-entry-ec9932eb6af54670a67850098cdd93da/acceptance-source-manifest-final.json` 已更新：原 29 行只替换 dataQuality，一并追加本次独立回归结论；另 28 项源哈希和历史失败证据不变。旧版完整 manifest 保存在 `acceptance-source-manifest-pre-dq-asof.json`。benchmark 测试以 supplementalValidationSources 单列，不擅自扩写原 29 范围。父任务 release 34 + 2 旧 CI 测试 = 36 文件，不等于本代理已验 36 文件；无 F3/T1/D0。

**本次最小修复集成 PASS。** 未运行新 CI/build/install，也不改变旧候选 run 的失败事实；无真实用户 Mac 实采、原生渲染或跨版本证明。本节完成后停止写报告，供父任务冻结。






