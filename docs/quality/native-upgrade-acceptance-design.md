# 原生跨版升级与 Mac Keychain 验收设计

状态：Astra 有界测试设计，待 Sol 实现；**本文不代表测试已经运行或通过**。

## 1. 目标、固定输入与不可越界事项

本轮只补齐正式 1.0 -> 1.1 跨版数据保留，以及 Mac 真实系统凭证存储的保存、完整退出、独立进程重启、解密持久化证据。不重新审计产品，不测试券商账户，不重打包产品。

| 输入 | 固定值 |
| --- | --- |
| 仓库 | `hzqedison/RT-ResearchFlow` |
| 旧版本 / 源码 | `v1.0.0` / `41f8429149f646c7dec7f1610082702e7d9cce48` |
| 新版本 / 源码 | `v1.1.0` / `ec1fe73e5f3c80edb1f3e7b0a989a03cf66b18ad` |
| 原生产物 | 已公开的 Windows x64 EXE、Mac ARM64 DMG、Mac Intel x64 DMG，各自旧/新两份 |
| 新版既有发布运行 | `37717182978`，仅作为原发布证据，不重新触发 |
| 执行者 | Sol 实现独立验收工具与 CI；Astra 冻结输入、控制最终运行、复核证据与签署 |

- 不修改正式安装包、app.asar、应用源码、产品版本、签名、tag、release 或 release workflow；不得把重新编译的应用替代公开包。
- 不安装到开发者本机，不使用 self-hosted runner，不读取或上传用户资料。全部执行限定在一次性 GitHub-hosted 原生 runner。
- 不复用 `codex/release-1.1` 分支。使用专用 `codex/acceptance-1.0-to-1.1`，本轮只有验收工具变化，不产生新产品版本。
- 不以 mock safeStorage、伪造密文、数据库直写密钥、替换 IPC 处理器或跳过断言取得通过。

## 2. 已确认契约，直接作为设计输入

以下由主任务提供，Sol 实现前应冻结为版本化输入，而不是再次大范围扫库：

- 打包 Windows 的有效 `userData` 始终是 `dirname(exe)/data`，`sessionData=data/session`；`--user-data-dir` 只可能是 legacy 迁移来源，**不是本轮隔离保证**。v2 profile 迁移包括 `Local State`，本轮不得误触发另一份 legacy profile。
- 打包 Mac 保留传入的隔离 profile 作为 `userData`，不主动重设 `sessionData`；必须实际读取并记录两个路径，不能推定二者相等。
- `ai:getConfig` 的 `hasApiKey` 只说明密文 BLOB 非空，不能证明解密成功。
- 真实保存入口参数为 `data.providerConfig={provider:'deepseek',model,apiKey,baseUrl,maxTokens,...}`；非空 `apiKey` 使用真实 `safeStorage` 加密并在真实事务中写入 `provider_configs.apiKeyEncrypted`。
- 不传或传空白 key 的元数据保存应保留已有密文。密钥的落盘、解密检查必须使用安装包中的 `better-sqlite3`，不能改用工作区构建物。

主任务补充的最小版本契约需列出：两版应用名/应用 ID/可执行文件相对路径、Windows 卸载注册身份、数据库文件相对路径、必要的设置 IPC 和固定行查询、Mac `sessionData` 实际归属规则。缺失时停止对应用例，不能用猜测路径继续。

## 3. 资产前置复用与 E2E 输入边界

直接复用 Sol 并行实现的 [.github/scripts/fetch-upgrade-installers.cjs](K:/AI/person/money/RT-ResearchFlow/.github/scripts/fetch-upgrade-installers.cjs) 和 [tests/fixtures/releases/native-upgrade-1.0-1.1.json](K:/AI/person/money/RT-ResearchFlow/tests/fixtures/releases/native-upgrade-1.0-1.1.json)。**不新增第二套下载器、发布资产 manifest 或 release workflow 改动。** 主任务已实读两版 GitHub API digest；下载器负责平台/架构白名单、GitHub-hosted 限制、RUNNER_TEMP 独有目录、固定大小/哈希、流式校验、原子完成及仅清理自身 partial。

E2E 和独立 workflow 只消费该前置的成功输出，具体字段名以 Sol 的已定义接口为准，但语义必须包含以下内容：

1. 两版 tag/source 等于第 1 节固定值，每个平台各一个旧包和新包，不追随 `latest`。历史 `v1.0.0` 的 `prerelease=true` **允许作为固定升级基线**；不得因此改取其他版本。正式 `v1.1.0` 仍须锁定本轮指定产品。
2. 前置返回已校验完成的安装包绝对路径、版本、平台/架构、大小、SHA-256，以及唯一下载目录/所有权标记。E2E 拒绝 partial、路径越界、缺少完成回执或与固定 manifest 不一致的条目，不自行下载替代品。
3. 三个原生 job 各自调用前置取得对应版本对；Ubuntu prepare 不尝试借用非白名单平台运行原生下载。安装结束后由验收逻辑再次核对原安装包哈希，证明安装过程中输入未变，不重建或复制后冒称原包。
4. `input-manifest.json` 是本次运行的**证据回执**，引用固定 manifest 的文件哈希和下载器结果，不另维护资产版本真相。记录 harness SHA、两产品 SHA、case/run/attempt；checkout 的验收代码不等于被测应用代码。
5. 固定清单或下载失败即阻断对应 native job；错误必须原样分类保留，workflow/E2E 不降低大小/哈希门禁，也不改写清单以适配一次意外下载。

已知 1.1 哈希可作为额外交叉断言：

| 资产 | SHA-256 |
| --- | --- |
| Windows EXE | `3689c579c902b006df422b91c5e723d63f89fcd1e3e16f85df7132942add1fbe` |
| Mac ARM64 DMG | `42970ebc1d9365765deddc94306beb39816ca3a4a16b88b62331a004d51f6d8e` |
| Mac Intel DMG | `604782a67ebb79e2df5665ab8293573996d34ba37711b2f27e4dde2ea969ac96` |

## 4. 隔离必须先于第一次启动和写入测试密钥

### 4.1 文件、进程与身份

- 每个原生 job 一个带随机 case ID 的所有权清单，根位于 `RUNNER_TEMP`；安装路径、profile、证据路径、挂载点各自固定。禁止指向仓库 `release/win-unpacked`、宿主已有应用或开发者数据路径。
- Windows 两版在同一 Windows 用户/SID、同一个固定安装目录运行。先确认目标目录和本产品卸载登记不存在，再安装旧版；后续不得手工清空安装目录、先卸载旧版或改 appId。
- Mac 两版应用从各自正式 DMG 安装到同一个受控 `.app` 路径，使用同一个系统用户 UID、同一 profile、同一临时系统 Keychain。升级只替换 `.app`，不合并旧 bundle，也不删除其父目录或数据目录。
- 每次启动由真实主进程返回 `app.isPackaged`、`app.getVersion()`、`app.getName()`、`app.getAppPath()`、`app.getPath('exe'/'userData'/'sessionData')`、`process.pid`、`process.arch`，保存规范化路径的哈希与相对路径。应用身份另以 Windows 登记身份或 Mac `CFBundleIdentifier` 核对。
- Mac `sessionData` 若不等于 profile，必须是版本契约中事先声明、首次启动前确认不存在、属于本次一次性 runner 的专用路径，并登记所有权。禁止启动后发现串用默认目录再临时放宽白名单；不能靠测试中调用 `app.setPath` 改写产品的真实路径行为。
- Windows 不传有数据的 legacy `--user-data-dir`；如启动框架必须传入，则只能是单独的空陷阱目录，记录启动前后未作为有效 profile 使用，不能把它当成有效数据目录。
- 断言两版实际数据根符合各自契约且延续同一份数据；不能仅看传给启动器的参数。每次进程启动还要检查 profile 中的唯一 case marker，防止串用另一个用例的目录。

### 4.2 凭证与联网隔离

测试密钥为 harness 在内存生成的明显非真实随机值，例如 `NOT-A-REAL-CREDENTIAL:<case>:<nonce>`；不使用现有 Key、令牌或真实账户。API Base URL 在同一次真实保存事务中指向专用 loopback 地址，其他厂商保持未配置，不点击“连接测试”、AI 分析或交易。

**loopback Base URL 不是唯一安全措施。** 必须在应用第一次运行前启用覆盖主进程、Chromium 网络进程和后代进程的操作系统级外连限制，否则不能写入测试密钥：

- Mac 首选 runner 可用的 `sandbox-exec` 包装启动器，外部脚本原样转交 Playwright 启动参数到未修改的安装包可执行文件；策略拒绝非 loopback 网络连接并继承到后代，保留本地调试通信与真实系统 Keychain 所需 IPC。不得往应用 bundle 注入脚本或换 main 入口。该系统工具/策略在 runner 上的可用性是待实现验证项，不预先声称所有镜像支持。
- Windows 使用只作用于本次测试应用及实际子进程执行路径的系统出站防火墙规则，IPv4/IPv6 都覆盖；发现未纳入隔离的外部子进程执行路径即阻断用例。不得将 runner 的 GitHub 控制和证据上传连接整体切断。Windows 的最低升级夹具不包含非空 API Key；Mac 凭证测试不能因此降级。
- 写密钥前运行**无凭证的隔离自检**：在同一约束下探测主进程 Node 请求、Electron 网络请求及一个子进程外连，必须取得明确拒绝证据；loopback 控制连接必须成功。使用隔离前已证明可达的公开无认证探测端点，不能将保留地址超时、DNS 不存在或没有互联网当作隔离成功。
- 保存策略摘要/规则命中或拒绝状态、自检结果与继承检查。仅设置代理、改 hosts、渲染器 `page.route`、应用启动后才装网络拦截，均不足以通过门禁。
- 允许应用无凭证的后台公开数据请求被系统阻断，但须记录计数与阶段。测试不触发有凭证请求；专用 loopback 观察端只返回受控错误，不提供模型响应、不记录原始 Authorization/请求体。若观察到自动携带 fixture 发出请求，记录脱敏布尔事实并判定凭证测试失败，不能把响应 mock 成成功后继续签字。
- 缺少可验证的系统级隔离，或网络隔离破坏 Keychain/正常启动且无法在本轮解决时，结果为 `BLOCKED_ENVIRONMENT`。不得通过关闭隔离、改用 mock crypto 或真实厂商地址降低要求。

## 5. Mac 系统 Keychain 前置条件

由 runner 的同一用户创建一个本轮独占的真实临时 Keychain，解锁并加入该用户搜索列表、设为本轮默认；保存原默认和搜索列表以便清理恢复。Keychain 文件位于受控目录，随机密码仅在运行时使用，禁止上传或在命令回显中泄露。

- Keychain 必须跨旧版、新版及其所有重新启动保持同一个文件和用户身份。不能每次启动重新创建或用新的加密种子掩盖持久化错误。
- 不预填应用的 Safe Storage 项，不给所有程序添加宽泛信任，不使用允许任意访问的 ACL/partition-list 修改绕过跨版本访问问题，不将 Keychain 数据库解密导出。
- 两版真实应用内 `safeStorage.isEncryptionAvailable()` 必须为真；这仅是前置条件，不能作为成功结论。
- 若真实系统权限弹窗使 CI 无法继续，最多等待已设定的短超时，保留脱敏截图并报告 `BLOCKED_ENVIRONMENT / KEYCHAIN_INTERACTION_REQUIRED`；不绕过或把弹窗当作产品加解密已成功。
- 此方案证明真实 macOS Keychain 后端在隔离 Keychain 中可用，不证明用户已有 login Keychain 的锁定、ACL 或企业策略全部兼容。

## 6. 核心用例与阶段契约

三个独立原生 job 均跑跨版流程；两个 Mac job 在同一跨版数据链中额外跑真实凭证流程。必要断言不得 skip，不得自动 retry 掩盖不稳定。

### UPGRADE-01：真实旧版建立资料，跨版安装后读取

1. 安装正式 1.0 包。等待安装器完整退出，检查退出码；检测任何自动启动的额外产品进程，确保后续只有受控实例。无法确认进程归属则停止，不把自动启动实例误认成 harness 启动。
2. 启动进程 A，断言 **实际版本 1.0.0**、打包状态、应用身份、原生架构、可执行路径和数据路径。Mac 的 ARM64/x64 不允许互换或借 Rosetta 冒充原生测试。
3. 通过真实设置/AI IPC 写入可辨识合成资料：一般通知偏好 `decision_notify_min_priority`、DeepSeek 单厂商自定义模型元数据/提示词/输出上限；其他厂商无密钥。再通过实际 UI 的开通引导写入本地进度，在真实 origin 的 localStorage 保存仅供路径追踪的 case marker。Mac 此时同时执行 KEYCHAIN-01 的旧版密钥保存。
4. 通过真实已安装进程中的包内 SQLite 只读连接，记录白名单逻辑快照：设置值、`ai_config`/`provider_configs` 对应非敏感字段、至少一组版本契约允许保留的业务记录 ID/内容摘要、迁移版本集合。业务记录使用主任务提供的固定契约，不为赶工猜表名或允许“找不到就跳过”。
5. 在有效数据根放置一个**非数据库、非凭证**的合成文件 sentinel，记录其 SHA-256；记录本地进度和 marker。该文件只是补充，不能替代 SQLite/应用设置保留断言。
6. 正常 `app.quit()`，等待进程 A 完整结束且退出码为 0，确认它的产品后代全部结束、数据库可只读打开；失败不能用强杀后继续计为正常退出。需要清理时可只终止本轮拥有的进程，但用例保持失败。
7. **完整重新启动旧版进程 B**，生成独立的启动记录；确认进程 A 已结束、这是新启动事件，重新读取所有夹具。PID 通常应不同，但不能仅以 PID 数字比较替代进程退出和启动时间证据；PID 重用不等于同进程。
8. 正常退出 B，记录稳定逻辑快照和 sentinel 哈希。仅在此后执行真实升级：Windows 运行正式 1.1 EXE 指向同一目录，由安装器处理旧版；Mac 卸载 DMG 挂载后只替换受控路径内的旧 `.app`，再从正式 1.1 DMG 安装到该路径，不清数据、不带入测试者 profile。
9. 在新进程启动前检查安装器未移除有效数据目录、sentinel 和已有数据库。Windows 此时可比较原 DB 文件哈希作为“安装阶段未碰 DB”的补充，但启动后不再要求整个 DB 文件哈希不变。
10. 启动进程 C，断言 **实际版本 1.1.0**，同应用身份、同用户、同固定安装位置以及正确的数据延续关系。Windows 卸载注册项应只有一个本产品有效登记，版本更新为 1.1.0，不能另装第二份后从新空 profile 启动。
11. 核对所有保留夹具、业务记录逻辑摘要、localStorage 进度、marker 和 sentinel。允许数据库 schema/内部维护时间按预先列明的迁移规则变化，不允许临时扩充忽略列表掩盖数据丢失。
12. 正常退出 C，完整启动独立进程 D，再次核对实际 1.1.0 和保留夹具。覆盖升级后的第二次启动，不能用窗口 `activate`、reload 或仅关闭 BrowserWindow 代替。

### KEYCHAIN-01：Mac 旧密钥跨进程、跨版本真实解密

在上述 A 中通过真实 `ai:saveConfig` 只保存 DeepSeek 的非真实 fixture K0。调用必须来自实际 renderer/preload IPC，不能直接调用 repository 或往 BLOB 填入 harness 加密的结果。

每个检查点 A、B、C 都执行以下断言：

- 用实际安装应用的 `app.getAppPath()` 建立 `createRequire`，加载**该安装包内**的 `better-sqlite3`，以 `readonly + fileMustExist` 打开实际数据根的数据库，读取 DeepSeek 的 `apiKeyEncrypted`。不得打开源代码仓库数据库或临时复制库代替当前产品数据。
- 对读取到的真实非空 BLOB，在**该真实应用主进程**调用真实 `safeStorage.decryptString(Buffer.from(blob))`，在进程内将 UTF-8 字节与 K0 逐字节比较，只返回比较布尔值、BLOB 长度和必要状态。不向 renderer、日志或测试报告返回解密文本。
- 记录密文哈希：未重新保存密钥时跨重启/升级应保持原密文，或出现事先可解释且经复核的产品重加密行为；不能通过测试重新保存 K0 修复失败。解密比较为必要条件，`hasApiKey=true` 仅作辅助。
- 检查其他厂商仍未配置密钥，没有因为保存一个厂商而要求所有厂商 Key；检查 API 返回不包含明文。
- 对实际 DB/WAL/SHM 的**现有文件**检查 fixture 的 UTF-8 与 UTF-16LE 字节均不存在；仅返回扫描结果和文件类别，不上传文件。应用退出后再检查稳定 DB 与仍存在的相关文件。缺少 WAL/SHM 是正常可能状态，不因此跳过对 DB 的检查。
- 在写密钥的 UI/IPC 阶段关闭 trace/视频/截图和完整参数日志，避免测试工具自身把 fixture 持久化到证据中。持久化到系统 Keychain 的是其真实加密机制，不把系统 Keychain 文件纳入明文扫描或上传。

**禁止**先从内存保存值证明“解密成功”、用旧进程传给新进程的 Buffer 代替新进程重新读库、只检查字段非空、在断言前更新或恢复密文。

### KEYCHAIN-02：Mac 新版单厂商保存及完整重启

确认 C 中 K0 跨版解密通过后，再通过新版真实保存入口更新为另一枚非真实 fixture K1（K1 != K0），同时改变一个非敏感厂商设置。

1. 当次进程从数据库读取并真实解密，必须等于 K1 且不等于 K0；新密文不得为空，不要求加密是确定性的。
2. 再执行一次仅修改元数据、不传 Key 的真实保存，验证 BLOB 哈希保持不变且解密仍等于 K1；如果 UI 保存行为使用空字符串，再覆盖该真实 UI 路径，不直接改处理器。
3. 正常退出 C 后，上述 D 只读取，不预填、重新保存或重新创建 Keychain；真实解密落盘密文必须仍等于 K1，其他厂商仍无 Key，新增元数据保留。
4. 两次明文扫描与错误/退出检查必须通过。此用例证明真实存储及解密持久化，不证明 DeepSeek 接口连接、模型名称在线有效或模型推理成功。

### 数据库迁移覆盖的表述限制

记录 A/B/C/D 的 `schema_migrations` 集合。若两正式版本 schema 相同，结果只能叫**跨产品版本升级数据保留**，不能声称执行过 schema 升级。若确有待执行 migration，必须验证迁移前恢复点存在、可只读打开、包含旧逻辑快照，且升级后目标迁移记录完整；不能用周期 `.bak` 冒充迁移前快照。读取和检查恢复点都只用本次合成数据，不上传数据库。

## 7. 失败、阻塞与取证契约

| 分类 | 条件与结果 |
| --- | --- |
| `BLOCKED_INPUT` | 缺少资产/摘要/版本契约，或 tag/source/hash/架构不匹配；不安装、不继续。 |
| `BLOCKED_ENVIRONMENT` | 非原生/非一次性 runner、无法证明外连隔离、无法使用真实 Keychain、无法确认路径所有权或系统交互使测试不可继续。不能签 PASS。 |
| `FAIL_INSTALL` | 安装器非零退出、安装超时、残留实例或重复安装登记；保留阶段/退出码/故障模块等，不自动重跑掩盖。 |
| `FAIL_DATA` | 任一必要夹具丢失、串 profile、未授权修改保留字段、迁移前备份不符合契约、实际数据根错误。 |
| `FAIL_CREDENTIAL` | 保存抛错、BLOB 空、真实解密失败/值不符、元数据保存清掉密文、非预期明文落盘或自动凭证请求。 |
| `FAIL_LIFECYCLE` | 退出非零、退出超时、旧产品进程仍存活、把 reload/activate 当新进程，或新进程版本不正确。 |
| `PASS` | 该平台全部必要阶段通过、无 skip/flaky/retry，且隔离、资产、进程、数据、crypto 的证据完整。 |

取证文件采用固定 schema，只保存白名单事实：

- `input-manifest.json`：两个正式版本的资产身份、哈希、大小、来源、产品 SHA，以及 harness SHA、runner OS/架构、run ID/attempt。
- `acceptance-result.json`：case ID、阶段顺序、版本/应用身份、相对数据路径、进程启动/退出记录、退出码、各断言结果、schema 集合、逻辑摘要、密文哈希/长度、实际解密比较布尔值；禁止 key、解密结果文本、完整 DB/配置、Keychain 文件或密码。
- `network-isolation.json`：策略类型/摘要、启用和解除时间、无凭证正反控制、后代覆盖证据、loopback 凭证请求是否出现；不保存 Authorization/完整请求体。
- `installer-events.json` 和经脱敏的原生错误片段；Windows 再现 `0xC0000005` 时补取 Windows Application Error/WER 故障模块、版本、异常偏移。不得默默上传包含密钥/内存的 dump。正式失败安装包本身仍可按已锁定 asset ID/哈希重新取得，无需上传夹具数据。
- 必要的失败截图仅在无 fixture 输入可见的阶段生成；默认关闭带参数的 trace/video。上传前扫描 fixture/Keychain 密码和禁止字段，扫描不通过只上传最小失败摘要，不用删除敏感字段后伪造已齐全证据。

补测不自动更新上次正式验收报告。Astra 最后根据各平台结果单独给出 PASS/CONDITIONAL/BLOCKED；不得因为 Windows 通过就代签两个 Mac，也不得将一个架构通过推断到另一架构。

## 8. 独立 GitHub 工作流结构

建议新 workflow `Native Upgrade Acceptance`：

```text
push: 仅 codex/acceptance-1.0-to-1.1，限验收工具/工作流路径
workflow_dispatch: 固定 1.0 -> 1.1 契约，不接受任意产品仓库或安装包 URL
permissions: contents: read
concurrency: 此固定版本对的 acceptance；cancel-in-progress: false

prepare (ubuntu, 5 min)
  -> 读取 Sol 的固定 manifest，校验固定版本对/源码/三平台覆盖和 harness SHA
  -> 输出矩阵与本轮证据关联信息，不重复下载或创建资产清单

native-upgrade [fail-fast: false，retries: 0，各 25 min]
  windows-latest / x64
  macos-15 / arm64
  macos-15-intel / x64
  -> 调用 fetch-upgrade-installers.cjs，消费既有固定 manifest 与完成回执
  -> 准备独立 harness / 路径所有权 / 出站隔离 / Mac Keychain
  -> 原生旧版安装、建数据、退出、旧版完整重启
  -> 同身份跨版升级、新版完整重启、逻辑保留断言
  -> 两个 Mac 的实际密文解密与单厂商保存持久化
  -> always: 仅清理拥有的进程/临时挂载/网络规则，恢复 Keychain 设置
  -> always: 扫描白名单证据后上传，不上传 profile/DB/Keychain

collect (needs 三平台，if: always，5 min)
  -> 校验证据 schema、平台全覆盖、运行/资产/源码身份和必要断言
  -> 显示机器结果，不自行给出 Astra 最终签署
```

- 实现时固定 action 到审查过的版本/提交，并使用 lockfile 固定 harness 依赖；无需安装 Chromium，使用下载的真实 Electron 应用。
- 只安装独立测试工具依赖，不运行产品 `pnpm install` 的 postinstall、不运行 `verify/build/dist/electron-builder`，避免无意重编译或替换 native 模块。
- 安装器、每次启动/退出、Keychain 交互和网络自检各有明确子超时，不能靠外层 25 分钟超时当清理机制。首次失败就保留证据，不用多次 retry 换包后沿用原 PASS。
- 后续确需单平台复跑时，沿用**同两份已公开包的同哈希**，记录新的 run/attempt；旧失败记录保留。与原发布流水线的“同源码重新打包”不同，本轮不重新产生安装包。
- GitHub 控制面和证据上传不受应用隔离规则阻断；清理必须在 evidence 上传之前按所有权恢复规则，`collect` 不具有 release/tag 写权限。

## 9. 预计新增文件与 Sol 写范围

以下为实现计划，不是本轮已新增的实现；优先使用独立目录，不改现有产品和 release 流水线。

| 计划路径 | 职责 |
| --- | --- |
| `.github/workflows/native-upgrade-acceptance.yml` | 固定版本对的 prepare/原生矩阵/证据汇总；调用 Sol 既有下载前置，无发布能力。 |
| `tools/native-acceptance/package.json`、`tools/native-acceptance/pnpm-lock.yaml` | 独立且锁定的 Playwright/测试依赖，不触发产品 postinstall。 |
| `tools/native-acceptance/playwright.config.ts` | 原生 Electron 测试，单 worker、无 retry、无跳过、敏感阶段无 trace/video。 |
| `tools/native-acceptance/fixtures/version-contract.json` | 仅存主任务确认的两版应用身份、数据路径、schema/设置/业务夹具查询契约，不含密钥，不重复维护资产 URL/哈希。 |
| `tools/native-acceptance/installed-app-harness.ts` | 真实包启动、主进程身份/路径、进程完整退出、包内 SQLite 只读检查、真实 safeStorage 比较。 |
| `tools/native-acceptance/native-upgrade.spec.ts` | A/B/C/D 跨版链与三类保留夹具；Mac 两个凭证用例。 |
| `tools/native-acceptance/platform/windows.ps1` | 一次性 runner 和路径所有权、真实 NSIS 安装/升级、应用网络边界、登记和故障证据。 |
| `tools/native-acceptance/platform/macos.sh` | 真实 DMG 安装/替换、原生架构、临时真实 Keychain、受限启动包装器与清理。 |
| `tools/native-acceptance/evidence.mjs` | 证据字段白名单、敏感输出扫描、摘要汇总与失败分类。 |

Sol 可在该测试目录内作必要小型拆分，但必须先给出入口/依赖关系；不扩张到产品重构。如果公开产品本身导致确定失败，只提交具体 bug、复现阶段和文件定位，保持正式 1.1 不变，另由主任务决定下一产品迭代。

明确分工边界：

- 已在实现的下载前置及固定 release manifest 归原 Sol 子任务维护；后续 E2E/CI 实现者只引用其契约，不并行修改这两个文件。
- `native-upgrade.spec.ts` 和 installed-app harness 负责 A/B/C/D 进程链、真实 IPC 建夹具、实际落盘数据检查、真实 safeStorage 解密布尔断言；不承担资产下载/发布，不以安装器退出成功代替功能断言。
- 平台脚本负责受控的真实安装/升级、操作系统网络/Keychain 边界和清理；不修改应用二进制或以数据库直写制造凭证成功。
- 独立 workflow 负责固定输入、原生矩阵、超时、步骤依赖和脱敏证据上传；不得在 E2E 失败后继续生成 PASS，不修改 `.github/workflows/release.yml`，不触发正式构建。
- Astra 在 Sol 交付具体 harness SHA 后控制最终执行并签署；当前设计回合不运行测试、不接受实现代理自签结论。

## 10. 交给 Astra 最终运行前的最小交付条件

1. 测试实现、独立 CI 及固定两版契约齐备；Sol 提供实现说明和静态检查结果，不自签最终验收。
2. 没有产品重打包/发布命令，没有真实凭证，没有生产路径；公开安装包下载与哈希核对完整。
3. 逐条映射 UPGRADE-01、KEYCHAIN-01、KEYCHAIN-02 的必需断言，尤其是完整进程退出、真实版本身份、实际数据根、重新读盘后真实解密、网络隔离先于密钥。
4. Astra 控制该 harness commit 的原生工作流运行，检查实际证据与失败分支；有限缺口明确保留，不以截图、`hasKey`、同版本重装或同进程重开窗口替代验收。

本轮设计到此为止：没有执行安装、网络隔离自检、Keychain 操作或任何最终测试；正式 1.1 产品及 tag 保持不变。
