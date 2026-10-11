# 5.1 持久化订单意图与本人确认

设计日期：2026-10-08。状态：待 Sol 实现、Astra 独立验收；不是实现完成或实盘放行声明。范围仅 Mac 本机同花顺/中信的逐笔买卖、撤单及恢复，不重写投研框架，不增加 Windows 后台代下单。未来运行时改动归入 **1.2.0**，不得覆盖已发布 1.1.0。本次仅新增本文，不运行测试、CI 或客户端，不访问生产 profile、数据库、凭证。

## 第 1 页：源码事实与真正缺口

依据：`openspec/changes/reliable-product-architecture/specs/supervised-execution-boundary/spec.md`。限定读取五个源码/测试文件：`electron/main/ipc/macThsHandlers.ts`、`electron/main/services/macThsScripts.ts`、`electron/shared/macThsTypes.ts`、`tests/unit/macThsHandlers.test.ts`、`tests/unit/macThsCore.test.ts`。一次限定文件名检索未发现 `electron/main/services/macThsCore.ts`；实际日志读写就在 handler 的 `loadJournal/saveJournal`。未读取的 renderer、preload、全局单实例机制、行情来源及其他存储均保持未知。测试以下仅指已有断言，不代表本次执行通过。

### 必须沿用，不重复造轮子

| 已有边界 | 源码证据及范围 |
|---|---|
| 调用方、平台及会话限制 | `authorized` 验证当前主窗口/主 frame；非 darwin 拒绝；`liveEnabled` 不跨重启；`busy` 串行当前 handler。不能推断已具备跨进程锁。 |
| 参数校验及本人逐笔确认 | `validateMacThsOrder` 白名单、价格规范化、金额上限；确认票绑定规范化参数、sender、120 秒有效期且一次消费；真实买卖/撤单还经过默认取消的 `dialog.showMessageBox`。 |
| UI 操作保护 | 脚本校验模式、布局、中信标签、表单回读；提交前后匹配唯一新增合同的代码/方向/价格/数量；单笔撤单，不全撤，不自动点击真实券商确认 sheet。 |
| 副作用前写未知与阻断 | handler 在启动脚本前写 `unknownPending=true` 和 requestId；未知跨重启阻断新变更；超时/脚本错误保持未知。使用临时文件替换、0600 权限，不是完全没有持久化。 |
| 已有隔离测试 | handler 测试覆盖确认取消、参数变化、重复 ID、重启未知、单笔撤单；core 测试覆盖校验、脚本静态约束及诊断脱敏。保留这些入口和断言。 |

### 剩余缺口与复现时序

| 严重性 | 源码可推导的时序与后果 |
|---|---|
| P1：确认未绑定账户/时效 | `MacThsOrder` 无账户、行情/人工输入时间；对话只写“当前账户”。账户 A 下发起确认 → 等待期间改为 B → 脚本从 B 捕获 `originalBroker`，只保证其后标签不变，不能证明本人确认的是 B。票在原生对话前检查有效期，长时间停留后确认不再检查；旧价格仍可执行。 |
| P1：恢复丢失逐笔上下文 | 副作用前只记布尔值与 ID → 提交可能发生 → 进程退出：不知道哪笔、哪个账户、确认内容及已有合同。`resolveUnknown` 消费前端确认票后直接清布尔值，没有逐笔核实记录或本机原生复核；旧 ID 虽暂时阻断，换 ID 可再发相同订单。 |
| P1：去重有淘汰窗口 | `loadJournal` 仅取最近 256 个 ID。成功请求经过足够多后续请求被淘汰，再用旧 ID 并重新确认可以再次提交；不同 ID 的同一业务意图从未关联。不能承诺持久去重。 |
| P1：持久化/观察可信度不足 | 写临时文件后 rename 无显式 fsync，不能据此承诺断电持久；进程内 `busy` 也不能证明多进程互斥。`queryOrders/queryDeals` 只返回 `VIEW_OPENED`；提交观察返回合同号但没有结构化证据持久化。`LIVE_ACCEPTED` 不等于成交；相同参数的外部人工订单可能被匹配，撤单轮询也未逐次复核账户上下文。 |

## 第 2 页：最小可实施契约

接线补充：以下明确主进程与真实脚本的接口语义，不代表正在开发的 store 已提供同名 API。本轮未读取该 store；须等 Sol 交付后由 Astra 独立复核再集成。

### 不可变快照与确认

主进程创建 `intentId`，保存版本化 `snapshot` 与规范化摘要 `snapshotHash`。字段至少包含：执行端 `mac-local-ths`、模式、动作、证券及市场、方向、整数分价格、数量、金额上限、撤单目标合同、`accountContext`、输入来源/时间、创建时间及失效时间。撤单目标使用账户上下文和交易日期限定，不能把合同号当全局唯一。`requestId` 是传输去重键，不能代替业务意图；同 ID 不同摘要直接冲突，不修改原记录。

`accountContext` 不要求官方 account ID。现有 `brokerLabel` 首先读取 `button of UI element 2 of row 1 of table 1 of scroll area 1` 的 `AXTitle`，失败才读取窗口的 `static texts`，取唯一“中信证券”前缀标签。它目前只检查长度大于四，既不能证明后缀是账户，也不能证明第一行是当前选中行。接线采用以下可实施观察规则：

- 新增**内部**只观察动作 `observeAccount`，不加入 renderer 的 `MAC_THS_ACTIONS`。沿用窗口/sheet 检查，要求当前 A 股模式已选中；不点击买卖/撤单或自动切账户。读取上述真实路径及静态文字，同时尝试读取该行 `AXSelected`，不可读记为 `unknown`，不能当作 true。
- 若有明确选中行，返回该行标签及 `source=row-selected`；否则只有现有路径与静态文字得到的账户候选没有矛盾、可见标签唯一时，使用 `source=window-unique`，明确是“唯一可见标签，待本人核实”，不是机器证明的活动账户。多个候选有歧义即阻断。隐藏账户或相同遮罩对应多个实际账户，机器不能证明其唯一性。
- 主进程 `parseAccountObservation` 校验标签。首版仅接受中信前缀后明确的数字/遮罩账户样式，至少四个可见数字；允许受限的“账户/账号/资金账号”标记及分隔符。例如 `中信证券 ****5678` 是**协议示例，不是已实测标签**。只有券商名、“普通/A股/交易”等通用后缀或版本数字不能通过。其他真实格式须取得目标 Mac 的脱敏 AX 证据后补解析规则，不猜测字段，不退化为永久要求官方 ID。
- 保留原 UI 标签 `rawLabel`，仅去外围空白得到 `canonicalLabel`，不删遮罩、不折叠内部字符；对 `[v1,同花顺,live,source,canonicalLabel]` 的规范 JSON UTF-8 求 SHA-256。摘要只用于本地比较，不是认证或匿名化凭证。默认显示 `中信证券 · ****5678`；若脱敏导致不同标签无法区分，在本机原生对话展示原 UI 已可见的必要区分位，仍不可区分则取消该笔。摘要不能代替人能识别的标签，UI 已遮住的数字绝不反推。
- 原生对话显示标签、观察来源与时间，并要求本人核实它就是当前目标账户；保存 `uiObserved + humanConfirmed`，不写 `brokerAuthenticated`。只保存必要标签、摘要和本机观察时间；未知客户端版本显式为 unknown，不编造。标签及 argv 不进入诊断导出。后续账户比对保持同一来源、同一规范标签，不能在路径丢失后悄悄降级。

保留现有一次性票和原生逐笔确认，120 秒期限从发票时起，以会话单调时钟执行。没有已读取的行情输入契约，首版来源明确为 `manual`，时间只能记主进程收到输入的时间，不能冒充本人编辑时间或行情时间；原生对话展示价格与输入年龄。未来引用行情再增加真实来源和时效规则。

### 不重写 renderer 的主进程接线顺序

1. 保留现有 `submitLive/cancelLive` 请求与 `confirmationToken` 往返。入口仍先做 sender/mainFrame、平台、会话、参数、busy 和未知门禁检查。首次无票调用时，以现有 requestId 查找持久映射；相同 ID 不同动作/规范参数报冲突，已执行的返回原状态，不创建新意图。仅真实买卖/撤单进入此切片，启用会话本身不是订单意图。
2. 首次合法请求执行只观察步骤；主进程生成 intentId，保存不可变快照后才发 `CONFIRMATION_REQUIRED`。票内存绑定 `{token,senderId,mainFrame,sessionId,intentId,snapshotHash,inputKey,accountDigest,deadline}`，原生确认文案来自持久快照，不从第二次请求拼接。renderer 不需要生成或回传 intentId/账户字段。未执行的同请求可返回仍有效的原票；失效不得静默延长或覆盖快照，新订单沿用已有新 requestId 能力。现有 renderer 的 ID 生命周期尚未读取，不在本文虚称已兼容验收。
3. 带票调用先一次性消费并校验上述绑定，再弹现有默认取消的原生买卖/撤单对话。取消只记录未执行；确认返回后重新检查当前主窗口/主 frame、liveEnabled、会话、单调期限、持久快照摘要及门禁。再调用 `observeAccount`，要求 source/label/digest 与票一致；观察完成后再查 TTL 与授权。变更则票作废，不以新观察覆盖旧授权。
4. 将本人确认事件持久化；以 store 的原子条件转移认领唯一 attempt，**在调用真正变更脚本前落盘 UNKNOWN 并消费去重键**。任一持久化失败不执行。认领后若最后 TTL/授权检查失败，因确定脚本尚未启动可记录 NOT_SUBMITTED；记录失败仍保守 UNKNOWN。这些是 store 必须提供的语义，不预设 Sol 的方法名。
5. 变更脚本接收期望 source/canonicalLabel，通过 `execFile` 参数数组传入 AppleScript `on run argv`，不把标签拼进脚本文本或 shell。在填表前、填表后、点击前与每轮结果观察前重新提取并对比；比较 Unicode 字符序列，不能沿用 AppleScript 默认忽略大小写等宽松文本相等。仍保留模式、回读、合同匹配及真实 sheet 不自动确认。最后一次检查到点击仍有 UI 竞争窗口，不能承诺券商级原子账户绑定。
6. 严格解析阶段/账户/回报后，先持久化结果证据再返回旧接口成功码。启动后超时、非零退出、格式错误、账户变化、未识别 sheet、回报落盘失败都保留 UNKNOWN；进程退出不自动补跑脚本。重启不恢复票或 liveEnabled。

### 私有脚本返回协议 v2

保留已有 probe/preview/query 的 v1 行为。内部观察与真实买卖/撤单使用下列有界 TSV 协议；不让 renderer 解析。字段中的反斜线、TAB、CR、LF 分别编码为 `\\\\`、`\\t`、`\\r`、`\\n`，解析器只接受这四种转义和严格字段数；总量不超过现有 4096 字节，候选最多 8 条，超限不能截断后当成功。

```text
RTTHS2<TAB>observe|submit|cancel<TAB>intentId-or--<TAB>attemptId-or--<TAB>pre_effect|possible_effect<TAB>code
ACCOUNT<TAB>row-selected|row-unknown|static<TAB>escapedRawLabel
CONTEXT<TAB>row-selected|window-unique<TAB>escapedCanonicalLabel
RECEIPT<TAB>contractNo<TAB>symbol<TAB>buy|sell<TAB>price<TAB>quantity<TAB>newMatchCount<TAB>escapedState
```

观察响应使用 ACCOUNT 行，由主进程进行上述选择/校验；变更响应必须包含所比对的 CONTEXT，成功提交还须有唯一匹配 RECEIPT。撤单 RECEIPT 使用目标行真实字段及状态，不虚构方向/价格；只有观察到“部撤”就保存部分撤单，不改称全撤。intent/attempt 必须与本次调用一致；submit/cancel 与 live 成功码必须相容，不能接受模拟成功码。失败可以没有 receipt，不允许以旧的裸 `LIVE_ACCEPTED|合同号` 作为 v2 证据。

脚本保留 `submitTouched`：紧邻可能产生副作用的点击**之前**设 true，所有返回统一包装阶段；子进程错误/缺失协议不能证明 pre_effect。只有阶段为 pre_effect 且属于已有 safeBlocked 白名单的可解释阻断，才允许 NOT_SUBMITTED；点击后的同名错误仍为 UNKNOWN。观察到合同只记 ACCEPTED_OBSERVED，不推断成交；无法唯一归因的外部同参数委托保留歧义。

### 持久状态、去重与恢复

沿现有本地日志演进为独立 `macThsIntentStore`，不用引入全产品数据库迁移。版本化文件保存快照、确认记录、状态修订、请求映射、执行 attempt、证据及人工核实事件；事件只追加语义，原快照不得覆盖。单写者锁贯穿读改写，无法取得锁即阻断变更。提交成功的定义包括临时文件 fsync、原子替换及目标平台必要的目录持久化；任何失败不启动脚本，不能默默降级。已消费 ID 保留持久索引/墓碑，不随最近列表裁剪；摘要损坏或不支持版本 fail closed。具体断电保证须由平台验收支持。

| 状态 | 允许转移与不变量 |
|---|---|
| `PREPARED` | 快照先落盘，再显示确认；本人取消/过期为 `ABANDONED`，没有执行。重启不恢复确认权限。 |
| `CONFIRMED` | 本人确认事件落盘；会话/时效重新校验成功后，以持久比较并交换认领唯一 attempt。重启后的旧确认必须重新取得。 |
| `UNKNOWN` | **在任何可能提交的调用前持久提交此状态**，同时消费去重键。超时、异常、进程退出、真实确认 sheet、回报落盘失败均停留此处，不重发。认领落盘后实际未点击也保守未知。 |
| `NOT_SUBMITTED` | 仅有明确“点击前已阻断”的适配器证据可进入；沿用现有 safeBlocked 思路，新增结构化 `effectPhase`，不凭任意错误码清未知。重试需新意图和新确认。 |
| `ACCEPTED_OBSERVED` / `CANCEL_OBSERVED` | 记录账户上下文、观察时间、合同、参数、来源和观察状态；分别表示 UI 观察到委托/撤单，不表示成交或全部撤销。部分撤单单独保存，不能丢弃已成交部分。首版不新增无证据的 `FILLED` 状态。 |

同 `requestId/intentId` 重入返回已有状态，不执行；并发只能一个 attempt。换 requestId 但引用原 intent 仍返回原状态。新 ID 的同账户/动作/参数/撤单目标指纹，若关联未知意图则进入重复隔离，不能通过“再试一次”绕开；正常有意重复下单须显式新建、关联前笔并重新逐笔确认，不能仅凭相同指纹永久禁止合法订单。

未知恢复沿用 renderer 的 `resolveUnknown`：主进程选择最早待核实项，票绑定该 intent、快照摘要与状态修订，在现有 confirmation 文案和随后新增的原生对话展示该笔，不要求 renderer 新增字段。原生对话可取消、只打开现有委托页，或确认“本人已核对委托/成交/撤单及未关闭弹窗，并接受剩余不确定性”。只打开页面不清锁；查询仍仅为 VIEW_OPENED，没有可信自动对账。首版 `showMessageBox` 没有自由输入能力，核实事件只能记录 `human_reported / checked_client`、目标快照、时间、会话及明确解除本笔门禁的决定，**不能虚构本人输入了合同或成交状态**。

核实事件与该笔门禁变更原子落盘后再响应；业务状态仍 UNKNOWN，旧 intent/请求永久不可重发。存在其他待核实项就保持 unknownPending；全都核实后兼容返回 STATE_RESOLVED 仅指操作门禁解除，原生文案明确“不代表订单结果已对账”。同参数新请求仍关联未知前笔；只有本次原生对话明确展示叠加风险、本人选择“确认另下一笔，前笔仍可能有效”才允许新增意图执行，不得作为恢复重试自动提交。

旧日志迁移保留最近 ID 为墓碑；旧 `unknownPending=true` 创建 `LEGACY_UNKNOWN` 占位，只能显示“订单详情未知”并逐项人工核实，不能杜撰快照。旧日志没有的历史 ID 无法恢复，迁移须明确历史去重覆盖起点。坏日志不重置为空；新存储启用后缺失也不视作全新安装。外部删除整个 profile 不在此本地去重保证内。

## 第 3 页：Sol 实施边界与验收

### 一个纵向切片，不扩建整产品

交付“创建意图 → 原生确认 → 持久认领 → 本机执行 → 回报/未知 → 重启恢复 → 本人核实”。Windows/Mac 共享意图模型与可读状态，但真实执行只在本人 Mac 本机；既有模拟模式可回归，不可替代真实路径。保留现有 IPC 入口及 `unknownPending` 兼容投影，附加 intent/恢复摘要；恢复列表与核实先由主进程原生对话承载，避免在未读 renderer 上猜测改动。

| 下一 Sol 可修改的文件 | 责任 |
|---|---|
| `electron/shared/macThsTypes.ts` | 约定 `MacThsAccountObservation`、`MacThsIntentSnapshot`、`MacThsHumanReview`、`MacThsBoundaryReason`；MacThsRequest 无新增必填字段，MacThsResult 可选附加 intentId/reason，旧 code/confirmation/unknownPending 兼容。诊断不导出账户、订单、票或原始日志。 |
| `electron/main/services/macThsIntentStore.ts`（Sol 正在独立实现） | 本轮不读不改。交付后独立核验：快照保存、requestId 映射、原子认领 UNKNOWN、终态证据和人工核实/门禁原子写入、重启/去重语义；API 不匹配先对齐，不能并行改写。 |
| `electron/main/ipc/macThsHandlers.ts` | 内存 `BoundConfirmation`、`MacThsExecutionContext`；实现上述六步与逐笔 resolveUnknown 原生核实，用 store 取代直接布尔清锁。 |
| `electron/main/services/macThsScripts.ts` | 内部 `observeAccount` 生成器、`MacThsScriptObservation` v2 解析器及账户标签解析；期望上下文通过 argv 传入，输出 phase/receipt。内部动作不扩成任意 renderer 脚本入口。 |
| `tests/unit/macThsHandlers.test.ts`、`tests/unit/macThsCore.test.ts`、`tests/unit/macThsIntentStore.test.ts`（新增） | 下列离线故障及端到端编排用例，全部使用临时目录和隔离适配器。 |

以上为后续任务写白名单，不是本任务授权写范围；不含版本、旧报告、任务表或发布文件。若现有 UI/IPC 约束无法承载新增字段或原生恢复入口，Sol 提交具体契约缺口，由 Astra 确认后再扩范围，不自行猜改未读文件。

### 错误码投影与隔离测试矩阵

新增细分 reason 不要求旧 renderer 认识新 code；新 reason 属于内部/可选结果类型，投影到已有 MAC_THS_CODES。所有失败的用户解释放进现有 confirmation.message 或本机原生提示，不依赖未读取的前端渲染行为。运行时结果兼容仍待集成验证。

| 内部 reason / 既有对外 code | 必测时序及断言 |
|---|---|
| `ACCOUNT_CONTEXT_UNAVAILABLE / BROKER_UNVERIFIED` | 只有券商名/通用后缀、标签缺失、无法解析：不发可执行票、不启动变更。合法数字/遮罩样式可进入本人确认，不要求官方 ID。 |
| `ACCOUNT_CONTEXT_AMBIGUOUS / BROKER_UNVERIFIED` | 多候选冲突、第一行未证实选中、脱敏后不可区分：不能猜选第一行；唯一可见路径与选中行路径分别覆盖。 |
| `ACCOUNT_CONTEXT_CHANGED / CONFIRMATION_EXPIRED` | 原生对话期间 A 换 B、来源丢失、同尾号不同完整标签：原票失效，不重绑；若点击后变化则投影 RECEIPT_UNKNOWN。 |
| `REVIEW_EXPIRED / CONFIRMATION_EXPIRED` | 原生框停留超 120 秒、观察调用跨过期限、墙钟回拨：变更执行零次。 |
| `CALLER_CHANGED / INVALID_ORDER` | 原生框返回后窗口替换、frame 变化、会话停用：不执行；现有外来 sender 测试保留。 |
| `INTENT_CONFLICT / INVALID_ORDER`、`INTENT_REPLAY / DUPLICATE_REQUEST` | 相同 ID 改参数冲突；相同 ID 重入不二次执行；超过 256 笔及重启后仍有效。同参数新 ID 不能偷偷当作恢复重试。 |
| `PERSISTENCE_UNAVAILABLE / JOURNAL_UNAVAILABLE` | 快照/确认/认领写失败不执行；适配器入口可见持久 UNKNOWN；结果落盘失败仍未知；并发认领最多一次。 |
| `SCRIPT_PROTOCOL_INVALID / RECEIPT_UNKNOWN` | 超时、截断、坏转义、错误 intent/attempt、模拟成功混入实盘、裸旧协议：不清 UNKNOWN；标签含引号/换行不造成脚本注入。 |
| `UNRESOLVED_EFFECT / RECEIPT_UNKNOWN` | 同一 safeBlocked 在 pre_effect 才可 NOT_SUBMITTED，在 possible_effect 必须未知；NATIVE_CONFIRMATION_REQUIRED 不自动点 sheet。 |
| 既有 `LIVE_ACCEPTED / LIVE_CANCELLED` | 仅在结构化证据落盘后投影；合同参数/上下文不符、多匹配不成功；部分撤单记录部分，不升级为成交或全撤。 |
| `HUMAN_REVIEW_RECORDED / STATE_RESOLVED` 或 `UNKNOWN_PENDING` | query/取消核实不清锁；核实票绑定目标修订，原生确认后仅该笔门禁变化；其他未知仍阻断，旧 intent 永不复发，核实事实仅 human_reported。 |

纵向必测链：原始 v1 请求 → 主进程持久 intent/原票 → 默认取消零执行 → 新确认 → 盘上 UNKNOWN → 隔离适配器模拟副作用后退出 → 重建 handler/store → 重新启用仍不重发 → 原生逐笔核实 → 原 intent 仍不可执行。handler 测试区分“只观察调用”与“变更调用”计数；所有客户端输出、时钟和对话由隔离依赖提供，临时目录存储，禁止真实 osascript/网络。旧日志迁移、坏文件、锁冲突与磁盘故障继续由 store 测试覆盖。

### 证据分层与放行条件

**离线可证明：**输入与摘要绑定、状态机/去重、模拟崩溃恢复、故障注入下的调用顺序、人工核实不伪造机器事实、迁移和诊断脱敏。静态脚本断言不能证明真实 AX 布局；注入 fsync 失败不能单独证明实际断电耐久。本次只制定用例，未执行。

**必须真实客户端才可证明：**真实 AXTitle 是否包含可区分账户信息、该行 AXSelected 是否存在、window-unique 标签是否随当前账户切换、同尾号/多账户场景，以及 AppleScript argv/字符比较/协议输出在目标 macOS、Apple/Intel、同花顺版本上的表现。也必须实测权限、表单回读、真实确认 sheet、唯一委托观察、撤单/部分成交展示及重启兼容。隐藏账户与最后校验到点击的竞争窗口不能被摘要消除；目标布局缺少足够信息时明确该笔未能验证，而不是冒充支持。先做本人在场的无订单观察，再由本人自主逐笔确认真实买卖/撤单；代理不替本人点击，不连接券商后端，不把 Windows、模拟或只预览当最终目标的替代。记录版本、环境、脱敏证据与未测项，不收集密码或原始账户日志。

Astra 独立复核实现、隔离故障证据及明确授权的真实客户端证据后给出放行结论；Sol 自测、Luna 清单和本文均不能代签。没有真实证据时只能标记“离线流程已验/客户端兼容未验”，不能宣称实盘成功或 exactly-once 券商执行。
