# 原生跨版升级与 Keychain 最终验收记录

日期：2026-10-08。负责人：Astra 独立验收。范围仅限下述指定 run，不代表全产品审计。

## 最终结论：BLOCKED

**本次原生补充验收未通过。不是产品 1.1 故障确认，也不能据此撤销或伪造此前有限发布验收结果。**

GitHub run 已结束，无需继续等待或重启。本次未自动重跑、未修改 harness、正式产品、tag 或公开安装包。必须先修复 Mac 失败诊断的工具缺口，再查明原生失败原因；Windows 旧版安装失败也必须得到有证据的解释或受控处置。真实跨版升级保留数据和 Mac Keychain 持久化依然未获证明。

## 运行身份与取证范围

- Run：[37726873605](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37726873605)，最新 attempt **1**，最终 `completed / failure`。
- 工作流：`.github/workflows/native-upgrade-acceptance.yml`；事件 `push`；专用分支 `codex/acceptance-1.0-to-1.1`。
- Harness commit：`df888e46c22c75b5e058337f05cfe83bdca7208e`。API、三个 native job checkout 日志、三个 artifact 身份字段相符。
- 开始：`2026-10-08T04:18:39Z`；run 最后更新时间：`2026-10-08T04:20:49Z`。
- 既有冻结组合摘要：`4b453553ff58cef16568a3dcaa223a3845cd11517f921f105b7e4a27d6753bdc`。主任务此前已报告候选提交原始字节逐项匹配；本轮另发现 Windows 运行树字节差异，见 F3。
- 产品基线：1.0.0 source `41f8429149f646c7dec7f1610082702e7d9cce48`；目标：1.1.0 source `ec1fe73e5f3c80edb1f3e7b0a989a03cf66b18ad`。这些不是 harness commit。
- 本人只读取该 run 的最新 jobs、四个已结束 job 的完整返回日志（Windows、Mac ARM、Mac Intel、collect），以及三个小型证据 ZIP。ZIP 在内存中校验 SHA-256 并解压白名单 JSON，未落地安装包、profile、日志目录或其他临时文件。
- 本地只执行两项字节变换探针和一项报告器内存探针；未运行安装器、产品 Electron、Keychain、防火墙或真实账户操作。

## 原生结果矩阵

| 平台/任务 | Job ID | GitHub 结果 | 原始证据及可用范围 |
| --- | --- | --- | --- |
| prepare | 113146942555 | success | 固定输入契约准备完成；不是原生功能验证 |
| Windows x64 | 113147009285 | failure | `FAIL_INSTALL / NSIS_NONZERO_EXIT`；旧 1.0 安装退出异常；phases 空 |
| macOS arm64 | 113147009322 | failure | 仅初始 `BLOCKED_INPUT / NOT_EXECUTED`；phases、assertions 均空 |
| macOS x64 | 113147009463 | failure | 仅初始 `BLOCKED_INPUT / NOT_EXECUTED`；phases、assertions 均空 |
| collect | 113147427888 | failure | 正确拒绝三个不完整/失败结果；不是第四个产品故障 |

三个 native job 的固定安装包下载校验步骤均成功，原生测试步骤均失败，独立清理、证据发布和 artifact 上传步骤均成功。**清理步骤成功不能推出应用正常退出、升级成功或 OS 隔离已验证。**

## F1 / P1：Mac 错误证据丢失，无法定位实际失败阶段

**分类：已确认的验收工具可观测性缺陷；导致 Mac 原生失败的底层原因仍未知。**

两个 Mac ZIP 均只有 `acceptance-result.json`，状态仍为 init 写入的 `NOT_EXECUTED`，`complete=false`、`cleanup=true`，没有 input-manifest、network-isolation、installer-events。两个日志都只有 `Native acceptance runner: failed; review sanitized evidence.` 及退出码 1；没有可用的异常类型、相对源码位置、错误阶段或安装/启动进度。

确定代码位置：

- `tools/native-acceptance/evidence.mjs:207` 的 PrivateReporter 只实现第 208 行 onEnd，不实现 onError 或 onTestEnd；失败输出不带诊断。
- `tools/native-acceptance/evidence.mjs:233` 在 init 保存 `BLOCKED_INPUT / NOT_EXECUTED`；第 169 行起 cleanup 仅把原结果 cleanup 改为 true，不能补回失去的错误。
- `tools/native-acceptance/native-upgrade.spec.ts:5` 在测试体直接构造并执行 NativeUpgrade；构造、模块加载、worker/测试基础设施故障没有独立的安全失败记录保障。
- `tools/native-acceptance/harness.ts:379` 起的 finally 归档与 fallback，不能替代测试运行器层的早期或最终异常捕获。

本人将已冻结源码中的实际 PrivateReporter 类在内存隔离环境执行，确认无 onError/onTestEnd；带合成错误的 failed 结束事件仍只产生上述通用字符串。这是报告器诊断缺失的确定性证据，**不是对 Mac 原生根因的复现**。

不能把初始 `NOT_EXECUTED` 当成已证明“安装器从未运行”。也不能把该状态归为安装包哈希不符、Keychain 不支持、产品启动 bug 或凭证保存 bug；现有证据不足以区分这些情况。

**交 Sol 的有界修复范围：** `tools/native-acceptance/evidence.mjs`、`native-upgrade.spec.ts`、`harness.ts`、`offline.test.mjs`，必要时仅验收 README。新增安全的测试运行器错误捕获和阶段检查点：至少区分测试发现/模块或 worker 启动、构造、execute、平台 setup/install/launch、最终归档；失败后不得只发布初始占位结果。原始主失败与清理/归档次级失败应分别保留。

不得直接打开原始 Playwright trace、屏幕、profile 或未脱敏 exception 输出。只发布严格白名单错误类别、固定代码、相对源码位置、阶段和必要非敏感计数；禁止密钥、Authorization、绝对路径、完整调用参数。回归须覆盖早期异常、测试异常、归档异常与敏感字段拒绝。不得以改成 mock 或删除真实加解密断言来修复。

## F2 / P1：Windows 在旧版基线首次安装时原生崩溃

**分类：已确认的原生安装失败；旧版安装器与 hosted runner 的兼容性/安装运行环境原因未定。不是已确认的 1.1 应用回归，也不直接认定为 harness 调用错误。**

Windows input-manifest 记录并校验的旧新版 EXE：

| 版本 | 字节数 | SHA-256 |
| --- | --- | --- |
| 1.0.0 | 166547210 | `f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b` |
| 1.1.0 | 166498081 | `3689c579c902b006df422b91c5e723d63f89fcd1e3e16f85df7132942add1fbe` |

installer-events 只有 **1.0.0** 的一次安装事件：

- exitCode：`-1073741819`，即 `0xC0000005`。
- durationMs：`3254`。
- Windows 应用错误事件：moduleName `System.dll`，moduleVersion `0.0.0.0`，exceptionCode `c0000005`，faultOffset `00001581`。
- runner：Windows Server 2025 / 10.0.26100，image `windows-2025-vs2026`，version `20260925.250.1`。
- 复现条件：该 hosted runner 首次静默安装固定 1.0 EXE，owned RUNNER_TEMP 目录，app 专属出站规则与 WFP 审计 setup 后执行。参数链为 `/S` 与同目录 `/D=`。
- 代码路径：`tools/native-acceptance/platform/windows.ps1:108` 启动原安装器；第 132 行保存退出/应用错误事件；第 133 行非零退出即失败。这些是定位执行点，不代表这几行已经被证实写错。

结果 `phases=[]`；仅公共探测目标在隔离前可达断言通过。network controls 为空，inherited/descendantsCovered 均 false，不能声称四阶段网络隔离或完整退出已经验收。没有开始四阶段应用验证的证据，更没有 1.1 覆盖升级成功的证据。

**下一步不是重跑碰运气：** 先以固定旧包、固定运行条件补足有界的安装前条件/进程与错误归属证据，保留原始退出码和本次失败。只有形成明确的环境假设后，才由 Astra 决定受控变量对照；不得换一份重打包 1.0、手动解包复制文件冒充安装、跳过旧版本或把同版重装冒充跨版升级。主任务可派 Sol 在 `platform/windows.ps1`、`evidence.mjs` 和离线回归中补充脱敏诊断；不得擅改产品或用重试掩盖失败。

此前正式发布验收披露的 Windows 首次安装异常属于另一轮、另一个产物；本次是固定旧 1.0 EXE，不能把两个相同异常码当作已证实同一根因。

## F3 / P2：Windows 运行树不等于冻结原始字节

**分类：验收证据链/工作流确定性缺口；不等于公开安装包被改写。**

Windows input-manifest 的两项源码文件哈希与预检冻结清单不同：

| 文件 | 冻结 SHA-256 | Windows 证据 SHA-256 |
| --- | --- | --- |
| `tests/fixtures/releases/native-upgrade-1.0-1.1.json` | `b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f` | `2a89e725e9fbe9ce51c94d048a250a785d04e73527fd25f719578fca3e27d63a` |
| `tools/native-acceptance/fixtures/version-contract.json` | `b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7` | `156ed94a8ed4abf678fd7330e1ff8e6c849f9c2ca8dd407ec6e2969e6d2f0bb7` |

本人仅对预检缓存的这两份原始 UTF-8 内容做内存 SHA-256 探针：原始内容均匹配冻结哈希；把 LF 转为 CRLF 后，均精确匹配 Windows artifact 中的哈希。因此这两项差异可由换行转换完整解释，不是 JSON 语义/安装包 pin 变化的证据。尚未证明其他 14 文件在 runner 上的原始字节相同，不能把 commit 身份一致等同全部工作树字节一致。

**交 Sol 的修复范围：** 独立 `.github/workflows/native-upgrade-acceptance.yml` 及验收 evidence/offline 工具。应在运行原生逻辑前控制 checkout 的换行行为，按固定 commit 对象原始字节核对全部 16 文件并记录组合摘要，任一不符即在安装前阻断；不得事后归一化再声称同字节。保持修改只在验收分支，不能为此改正式 release 工作流、tag 或安装包。

## 原始 artifact 字节证据

三份 ZIP 已由本人在内存中重新计算 SHA-256，均等于 GitHub artifact API digest 和各上传日志；collect 下载日志也记录了相同摘要。并逐份核对 runId、attempt、harnessSha、平台/架构，无跨 run 混用。

| 平台 | Artifact ID | ZIP 字节数 | 本人计算且与 GitHub 一致的 SHA-256 |
| --- | --- | --- | --- |
| Windows x64 | [11528012760](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37726873605/artifacts/11528012760) | 2480 | `12595b4749115919d12c5cf422f9b11c95c96d56d0ccf7a5a17fa7cf56004f87` |
| macOS arm64 | [11528296511](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37726873605/artifacts/11528296511) | 475 | `1b2e12e39f48048c12a556f7161c538e33d086965ef62bec0f9fd9211baf6eef` |
| macOS x64 | [11528550069](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37726873605/artifacts/11528550069) | 475 | `503945915455e806633ca46f7dba6e94bd3bac5de14b5c04fe8dc4bfab9746da` |

Artifact 到期时间为 2026-10-22 左右，参见 GitHub 元数据；本报告保存了关键失败字段和摘要，不包含下载签名 URL、临时绝对路径、凭证或 profile。

## 本轮已证明与仍未证明

**已证明：** 指定冻结候选 commit 的工作流实际运行；三个架构的下载校验步骤成功；Windows 两个固定 EXE 的哈希/size 有独立 artifact 明细；旧 1.0 原生安装异常真实发生；Mac 失败证据不充分；collect 未误放行；三个小型 artifact 原字节回读一致。对于 Mac，仅凭下载步骤成功不能替代缺失的逐包公开 input-manifest 明细。

**仍未证明：** 任一平台完整 A/B/C/D 生命周期、1.0 到 1.1 同身份跨版数据保留、数据库升级后可用、正常退出后独立进程重启、Mac 真正 safeStorage/Keychain 解密持久化、密钥替换与仅元数据保存的原生行为、运行期无明文落盘、各阶段 OS 隔离自检。真实用户设备、Apple 公证/Gatekeeper 和真实券商订单仍在本轮范围之外。

**计数口径：** 本轮无新增通过的原生升级案例（0/3 完成验收）。本人新增执行的是 2 项内存换行哈希探针、1 项报告器内存探针以及 3 份小型 ZIP 字节/结构核对，不与此前 14 项离线回归或产品 54 项检查混算。原生安装和测试由上述 GitHub-hosted runner 执行，本人控制验收与独立取证，不宣称在本机完成原生操作。

## 交接结论

**BLOCKED；不签署升级/Keychain 验收通过。** Sol 按 F1/F3 的确定工具缺陷及 F2 的诊断边界修复，提供有界回归和新的冻结清单，再交 Astra 复验并决定下一次原生执行。保留 run 37726873605 attempt 1 的失败历史，不自动重跑，不修改正式 1.1 产品、tag、公开 assets，也不把尚未定位的原生失败直接归为产品故障。


## F1/F3 修复后独立复验：2026-10-08

### 分层结论，不能代替前述原生结果

| 范围 | 本轮结论 | 执行限制 |
| --- | --- | --- |
| F1/F3 验收工具修复 | **PASS_TOOL_RECHECK** | 本人实际运行离线回归并核对实现；不是原生产品 PASS |
| Mac arm64 / x64 验收逻辑 | **CONDITIONAL：可准备 Mac-only 原生执行** | 本轮未发现新增的 Mac 工具级阻断，但目前没有可单独触发 Mac 的已审工作流入口 |
| Windows 原生验收 | **BLOCKED_F2** | D0 观察项尚未实现，禁止原样重跑旧 NSIS 失败路径 |
| 当前冻结三平台工作流 | **NOT_AUTHORIZED_TO_RUN** | 仍会同时启动未补 D0 的 Windows；不能用上述工具 PASS 授权 push 或 dispatch 全矩阵 |

上文 run 37726873605 attempt 1 的 **BLOCKED** 及失败原始字段完整保留。此处只解除经离线复验覆盖的 F1/F3 工具缺口；没有触发任何 CI，没有新的安装、升级、Keychain 或交易通过记录。

### 独立读取与实际执行

本次按原始字节一次性取样 16 个验收文件及新增冻结清单，读取七份变更内容：evidence、harness、测试入口、offline tests、README、验收 workflow、harness-freeze。未大范围重读产品或旧平台代码；原有下载器、平台执行器、版本/安装包契约、SQLite snapshot 等九份未变文件的 SHA-256 与上一轮冻结清单一致。

本人在 K 盘工作区设置 TEMP/TMP 为仓库 `.cache` 后运行：

```text
node --test tools/native-acceptance/offline.test.mjs
exitCode: 0
tests: 29
pass: 29
fail: 0
cancelled: 0
skipped: 0
todo: 0
duration_ms: 484.4567
```

这些是本人本轮执行结果，不是转述 Sol 的开发摘要。29 项由原 14 项和本次新增 15 项构成；不与原生案例、之前 54 项产品检查混算。测试通过内存转译调用实际 harness/入口方法，外部 I/O 使用明确替身；没有下载、系统原生安装、Electron 产品启动、注册表、防火墙或 Keychain 操作。未安装依赖，也未运行完整 TypeScript 类型检查；离线测试内的 TypeScript 转译不冒充完整类型检查。

另由本人独立计算每文件原始字节 SHA-256/大小，并在不调用 Sol 的 createFreeze 实现的检查脚本中重新构建排序数组、计算组合摘要，与清单逐项比较。结果：**16/16 条目一致，组合一致**。没有调用会重写清单的 `freeze` 命令，也没有做换行归一化。

### F1：本轮已复核的行为

- `tools/native-acceptance/evidence.mjs:492` 起 init 只创建私有进度，不再把初始 NOT_EXECUTED 当成公开终态证据。
- `native-upgrade.spec.ts:6` 起在受保护入口中动态导入 harness，分别标记 module-load、constructor、execute；异常先通过 recordFailure 保存安全投影，再抛固定安全错误。本人执行了针对三种失败阶段的实际入口回归。
- `evidence.mjs:428` 起 reporter 新增 onError/onTestEnd，保留错误阶段、允许的异常类型、errno、信号、整数退出码及白名单源码相对位置；不再只有一个 failed 字符串。onEnd 在没有终态证据时记录 RUNNER_NO_TERMINAL_EVIDENCE，不能推断安装器从未运行。
- `evidence.mjs:453` 起独立 runner 包装器在启动前重查冻结收据和原始字节，并捕获子运行器启动/非零退出，读取共享进度。本人已阅读这条包装路径；**本轮未启动真实 Playwright 子进程或模拟一个真实 hosted worker 崩溃**，该外层进程集成仍待云端证据，不夸大为已完成原生验证。
- `evidence.mjs:79` 的 applyFailure 保留第一条 primary，后续异常标记 secondary；第 120 行的合并逻辑不以 PASS 或 cleanup 成功覆盖已有失败。实际 harness 回归同时注入 NSIS、cleanup、archive 失败，仍保留 NSIS 为首因，并分别记录 EACCES/ENOSPC 的次级阶段。
- `harness.ts:387` 起 archive 阶段及 `evidence.mjs:363` 起独立 cleanup attempt 均有记录。cleanup 失败即使后续清理成功，原失败诊断仍在，不自动抹去失败历史。
- `evidence.mjs:48` 起的脱敏保留可定位类别、固定错误码和相对源码位置，主动剔除 message、stack、IPC 参数、附件和原始输出。回归同时验证真实错误类别/errno/退出信息保留与非真实密钥、Bearer、绝对路径不外泄。它不是完整原始日志，也不保证任意未知错误都能仅凭这些字段定根因；信息不足时继续 BLOCKED，不能推为产品故障。

**工具级判定：F1 此次明确修复目标通过。** 灾难性进程终止、runner 被取消、证据文件系统不可用等不能靠离线回调证明全链路可恢复；缺少原生证据时依然不得签 PASS。

### F3：本轮已复核的行为

- `evidence.mjs:131` 的 validateFreeze 限定固定顺序的 16 项路径、大小与摘要；拒绝缺失、未知路径、把清单自身塞入清单、错误组合摘要和非固定 source 身份。
- `evidence.mjs:142` 的 verifyFrozenBytes 先核对本地原始字节，然后核对相同固定提交中的清单自身及全部 16 个文件。清单不自包含摘要，避免循环自哈希。
- `evidence.mjs:170` 起以 workflow 的精确 GITHUB_SHA 读取 GitHub contents API；限定 file/base64 响应，并在第 186 行根据原始内容核对 Git blob SHA-1。API 或字节不符即失败，不静默回退分支头部。
- `.github/workflows/native-upgrade-acceptance.yml:23` 起在 checkout 前给 Git 配置 core.autocrlf=false、core.eol=lf；没有 checkout 后批量改换行再冒充原字节。任何残留转换仍由字节比较阻断。**本轮没有实际在 Windows GitHub checkout 上运行，不能把静态配置审查当作 EOL 云端实测。**
- prepare 进行固定提交核对；native 的 verify 位于依赖安装和安装包下载之前；fetch、runner 包装器及 `harness.ts:336` 执行前再查 case/run/attempt/commit 绑定收据和本地字节。明确的冻结不符不能进入 setup/install/app-launch。
- 离线负向回归实际覆盖 missing、同尺寸篡改、LF→CRLF，证明在远端回调之前失败；将这些失败传入实际 harness execute 后，未调用 setup/install。另覆盖远端文件不符、清单自身远端 blob 不符及非法固定身份。
- **云端 GitHub API、真实 checkout 与收据跨进程链路本轮未执行。** 上述远端字节比较负向测试使用内存回调，不冒充网络原字节回读；未来候选 commit 仍须逐项匹配本次 17 个文件再进入已批准的执行范围。

**工具级判定：F3 此次明确修复目标通过。** 不承诺任意未覆盖的系统条件、文件系统故障或云端错误均已验证。

### Windows 限制与 Mac 交接条件

`tools/native-acceptance/platform/windows.ps1` 的 SHA-256 仍为 `fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778`，与发生 F2 的实现一致。F2 D0 所需的只读环境/权限/路径、严格进程和事件归属、故障模块身份等观察没有在该执行器新增；不能以 29 项离线通过消解旧包原生安装崩溃。

当前 workflow 第 60 行仍把 windows-latest 列入必跑矩阵，push 和无筛选参数的 workflow_dispatch 都不是 Mac-only。因而：

1. **不得现在更新 acceptance 分支以触发当前三平台矩阵，也不得先启动再取消 Windows 来规避边界。**
2. 若优先推进 Mac，须提供真正排除 Windows 执行的有界入口/选择，并使 collect 如实标记 Windows 未执行和总体未完成，不能删掉 Windows 就宣布三平台通过。该 workflow 变化属于新字节，须由 Sol 实现、更新清单并交 Astra 有界复验；本报告不预先批准未见实现。
3. Windows 则须按既有 D0 设计补足诊断、停止条件和一次执行约束，保持历史 1.0 EXE 不变。先交 Astra 预检，再决定是否执行；不得原样重跑、更换基线或试到绿。
4. 本次 Mac 仅为实现层的条件性可执行结论，不是已证明修复此前 Mac 原生失败。真正 source/环境/Keychain/四进程证据仍要以后续明确 run 的原生结果裁定。

### 本人独立 raw-byte freeze

16 项路径按 POSIX 字典序排列。每文件摘要基于原始字节，不包含本报告和冻结清单自身。

本轮清单采用的组合算法是：把下述排序条目构造成字段顺序固定为 `{path,size,sha256}` 的数组，取 `JSON.stringify(files)` 的紧凑 UTF-8 字节（无末尾换行）计算 SHA-256。此算法不同于最初使用的双空格校验行拼接法，不能跨算法直接比较组合摘要。

**独立组合 SHA-256：`bf2426030d15c99ddc29908675e3c26d2101803f38fc4f48e4ac8abb6cf583ad`**

```text
8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06  .github/scripts/fetch-upgrade-installers.cjs
106904418335783f20140a45a533486e4c05338ef95e0f81bd3971ec4efea83d  .github/workflows/native-upgrade-acceptance.yml
b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f  tests/fixtures/releases/native-upgrade-1.0-1.1.json
d6c5ae565c33eaafc229ac196531437d8b470e3bb84a2778e297e24808493bd0  tools/native-acceptance/README.md
04fa6266030bb198f187e7690287318655d0339c2e8668c580913280158b45d1  tools/native-acceptance/evidence.mjs
b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7  tools/native-acceptance/fixtures/version-contract.json
8d27e36a97c3b9c4d67f4cf6987039e2b841afecdf3066f3d005fce9e462a80a  tools/native-acceptance/harness.ts
e3b29698b5a2143c9792d8c50b78a71182ebe08df30f2ff66654ebcd5d873581  tools/native-acceptance/native-upgrade.spec.ts
b5a0eec1c1a9b174a73c79729a7652e44374569a4a6ed86b97534825c0d49e45  tools/native-acceptance/offline.test.mjs
ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298  tools/native-acceptance/package.json
0d4cd7edeabd1bab839bb8a864c2aa11e57ce6ce0c693f4b96688a5d14eb0a90  tools/native-acceptance/platform/macos.mjs
f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c  tools/native-acceptance/platform/macos.sh
fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778  tools/native-acceptance/platform/windows.ps1
7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81  tools/native-acceptance/playwright.config.ts
7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d  tools/native-acceptance/pnpm-lock.yaml
671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945  tools/native-acceptance/snapshot.cjs
```

**清单自身单独列出，不纳入上述 16 项组合：**

```text
eb5289ce35dc1b6f7015506719081ad87845b9b8a431fd6d8b7a46ae7dbab4d2  tools/native-acceptance/fixtures/harness-freeze.json
size: 2988 bytes
```

以上 16 项的大小按同一顺序为：10080, 5300, 1808, 8561, 39870, 2457, 32523, 689, 30466, 319, 9486, 155, 11982, 504, 1317, 4955 字节；完整路径/大小/摘要三元组与已审 harness-freeze.json 一致。本次没有远端候选提交编号，也没有进行远端提交字节回读。将来上传需保留这 17 份原始字节；如果为 Mac-only 或 Windows D0 再修改任一文件，旧冻结即不授权新执行，必须提交新清单。

### 本轮交付终点

**F1/F3 工具级复验通过；当前全矩阵 NOT_AUTHORIZED_TO_RUN，Windows BLOCKED_F2，Mac 仅条件性可推进。** 本轮唯一写入为本报告追加，历史原生失败仍保留；未改产品、验收实现、工作流、清单、正式 tag 或 assets，未触发 CI。


## Mac-only 入口独立复验及新冻结：2026-10-08

### 最新执行结论：MAC_ONLY_READY_TO_RUN

**仅放行本节冻结的 Mac arm64 + Mac x64 原生验收入口。** 这取代上一节因“无 Mac-only 入口”而设的执行限制，不改变任何历史失败或 Windows F2 阻断。本人本轮未触发 CI、未安装产品、未测试真实凭证或交易。

| 范围 | 当前结论 |
| --- | --- |
| 本次已审 Mac-only workflow | **MAC_ONLY_READY_TO_RUN**，需候选提交的 17 文件原始字节全部匹配后才可触发 |
| Mac 实际升级/Keychain 产品验收 | **尚未通过**，等待随后具体 run 的真实原生证据 |
| Windows | **NOT EXECUTED / BLOCKED_F2**，D0 实现仍未纳入本次 |
| 三平台/全产品验收 | **NOT COMPLETE**，Mac-only 绿色不能替代 Windows 或完整验收 |

本次唯一持久写入为本报告追加。订单意图存储不在读取、审查、冻结或执行授权范围；不得将其或其他未审变更搭载为本次验收 payload。已发布产品、tag、安装包不在变更范围。

### 入口与门槛审查

本人读取本次五份变化内容并与上一轮缓存原文逐行比较：workflow、evidence.mjs、offline.test.mjs、README，以及自动生成的 freeze。其余 12 个验收 payload 文件原始 SHA-256 与上一轮一致。

- `.github/workflows/native-upgrade-acceptance.yml:60` 起的固定矩阵仅有 `macos-15 / macOS / arm64` 和 `macos-15-intel / macOS / x64`，没有 Windows 项。prepare、collect 都是 Ubuntu 元数据任务，不执行安装器。dispatch 未提供可注入平台的参数，native 调用平台由这两个固定矩阵项决定。
- 该 workflow 无 Windows runner 或 NSIS 执行入口。冻结列表仍含 windows.ps1，只会做原字节哈希/绑定，不等于运行它。用户授权的 Windows D0 是另一项未完成工作，不能通过此次入口执行。
- workflow 第 140 行调用 `collect-mac`；`evidence.mjs:543` 将允许集精确限定为两个 Mac 架构，第 552 行遇到 Windows 结果直接拒绝，不静默丢弃；第 555 行仍要求选中平台数量和 native job 聚合结果均满足。
- `evidence.mjs:557` 起的原 Mac 全套门槛与上一轮逐行一致：四阶段身份/路径/状态断言、正常退出、只读 SQLite、无明文、每阶段 REAL_SYSTEM_DECRYPT、K1 替换、仅元数据保存保持密文、四文件身份绑定、冻结源绑定、12 项隔离探针和两版安装退出 0 等均未删除或放宽。
- 原 `collect` 仍要求 Windows + 两个 Mac，复用同一门槛，不能由两个 Mac 通过满足。Mac-only 摘要第 595 行明确输出 `Windows NOT EXECUTED (BLOCKED_F2); all-platform acceptance is NOT complete.`
- `evidence.mjs:605` 对受信的 AcceptanceError 传递其安全错误码，仍经过 safeDiagnostic 的格式限制，不直接输出原始异常 message/stack；未知异常保持通用 fallback。混入 Windows 的实际 CLI 负向测试现在保留 `COLLECT_PLATFORM_UNKNOWN`。

**未发现本轮需要先修复的具体阻断。** 上述“门槛未变”是代码差异审查与离线行为验证，不是证明 Mac 原生升级、Keychain 或 OS 隔离已成功。

### 本人实际执行的检查

在 K 盘仓库运行离线套件，TEMP/TMP 指向仓库 `.cache`。未安装依赖。新增 CLI 用例只创建 K 盘 owned 合成 JSON 目录、启动汇总命令，再按解析后父目录/目录名前缀检查清理自身临时目录，不启动平台 setup/install、Electron 产品或 Keychain。

```text
node --test tools/native-acceptance/offline.test.mjs
exitCode: 0
tests: 33
pass: 33
fail: 0
cancelled: 0
skipped: 0
todo: 0
duration_ms: 1341.3423
```

其中新增四项测试运行实际 CLI，覆盖双 Mac 完整、缺架构/无结果、失败断言、Windows 混入，以及旧 collect 对三平台的要求。这些输入是刻意构造的合成证据，**不是原生运行通过产物**。

本人另独立指定七项负向场景，复用已审的合成输入准备器但实际启动 collector CLI。七项均返回退出码 1，输出 incomplete or failing：

1. 只有 Mac x64，缺 arm64。
2. 缺少 A 阶段 REAL_SYSTEM_DECRYPT。
3. 缺少 C 阶段 K1_REPLACED_K0。
4. 缺少 C 阶段 METADATA_ONLY_PRESERVES_CIPHER。
5. D 阶段独立进程退出码非零。
6. cleanup=false。
7. 旧三平台 collect 收到 Windows 失败断言。

**计数保持分开：33 项套件通过，7 项附加 CLI 负向检查按预期拒绝，16 文件加独立清单的字节核对通过；原生新增通过案例仍为 0。** 未复跑之前已完成的云端 run，也未重做全产品测试。

### 开发失败历史不抹除

主任务提供的开发记录为：新增测试首跑 **32 passed / 1 failed**，暴露 CLI 外层把安全错误码替换成通用 fallback；修正后开发自检 **33 passed / 0 failed / 0 skipped**。这段开发历史予以保留，属于主任务提供的记录，本人没有重新制造或独立重放那次旧代码失败。

本节的 33 项通过及七项补充负向结果才是本人针对当前冻结版本实际执行的证据。不得把开发首跑写成一次全过，也不得将开发结果与独立复验重复累加。

### 新的独立 raw-byte freeze

全部摘要取自本轮一次性读取的原始文件字节，不转换换行、不重新保存源码。本人用独立检查脚本构造按 POSIX 相对路径排序的 `{path,size,sha256}` 数组，验证所有条目与清单一致，并计算紧凑 `JSON.stringify(files)` UTF-8 字节的 SHA-256（无尾部换行）；未调用会写清单的 freeze 命令。

**16 文件组合 SHA-256：`8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795`**

```text
8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06  .github/scripts/fetch-upgrade-installers.cjs
e793ff8c657710d5a2a21e2574545d9f3685d45d3e32dd53d425fb7987df9072  .github/workflows/native-upgrade-acceptance.yml
b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f  tests/fixtures/releases/native-upgrade-1.0-1.1.json
d0af1dc8e14aebcb3580c38270cf486fc77d73b2634b6256f1b54051c7f6e6bb  tools/native-acceptance/README.md
2f8c3442f8707a55df4d0b142f3f5cc609cac86639440aa4812906050475184b  tools/native-acceptance/evidence.mjs
b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7  tools/native-acceptance/fixtures/version-contract.json
8d27e36a97c3b9c4d67f4cf6987039e2b841afecdf3066f3d005fce9e462a80a  tools/native-acceptance/harness.ts
e3b29698b5a2143c9792d8c50b78a71182ebe08df30f2ff66654ebcd5d873581  tools/native-acceptance/native-upgrade.spec.ts
985dd204e4dd7eb2cace69cf617e7fb57d632a056e739721752fe76a525dc7ee  tools/native-acceptance/offline.test.mjs
ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298  tools/native-acceptance/package.json
0d4cd7edeabd1bab839bb8a864c2aa11e57ce6ce0c693f4b96688a5d14eb0a90  tools/native-acceptance/platform/macos.mjs
f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c  tools/native-acceptance/platform/macos.sh
fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778  tools/native-acceptance/platform/windows.ps1
7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81  tools/native-acceptance/playwright.config.ts
7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d  tools/native-acceptance/pnpm-lock.yaml
671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945  tools/native-acceptance/snapshot.cjs
```

**清单自身独立绑定，不纳入上述组合：**

```text
942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c  tools/native-acceptance/fixtures/harness-freeze.json
size: 2988 bytes
```

上述 16 文件大小按同一排序依次为：10080, 5248, 1808, 9298, 40217, 2457, 32523, 689, 35735, 319, 9486, 155, 11982, 504, 1317, 4955 字节。此组合取代上一节 `bf242603...` 作为本次 Mac-only 执行冻结身份；上一节的旧冻结仍保留为历史，不能混用于新 run。

### 主任务可执行交接

1. 将候选 commit 中这 16 个 payload 加 freeze 自身共 17 个文件的原始字节逐项核对；全部匹配本清单后，方可触发**这一 Mac-only workflow**。本轮尚未提供候选提交/具体 run，本人没有声称已经完成远端字节回读。
2. 任一文件或换行不同，停止更新 ref 并交回差异；不通过运行后归一化补救。不将其他产品修改纳入本次授权。
3. 云端失败保留首因和完整 run/attempt 历史，交 Astra 区分工具、环境和产品；不自动 rerun 掩盖。Mac-only 成功也仍需 Astra 独立读取原生证据才可签 Mac 范围结论。
4. Windows 继续 BLOCKED_F2。本次没有授权 Windows 安装器诊断、重新安装、跨版升级或全平台验收通过。

**本轮终点：MAC_ONLY_READY_TO_RUN；CI 尚未触发，产品原生结果待取证。**


## Mac-only 原生运行最终取证：run 37729682202 / attempt 1

日期：2026-10-08。**本轮最终结论：BLOCKED，Mac 原生验收 0/2 完成。**

本节记录已结束运行的新事实，保留前述 MAC_ONLY_READY_TO_RUN 的工具放行历史；“可以开始实验”不等于实验通过。本轮没有重新触发、rerun、取消或替换任务，没有改任何执行器、产品、tag、公开资产或 Windows D0 文件。

### 身份与终态

- [指定 run 37729682202](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37729682202)：最新 attempt **1**，`completed / failure`。
- Harness commit：`2dc13874d413a3bcf5c4c7ff0f81a4bd3150240f`；分支 `codex/acceptance-1.0-to-1.1`；工作流为 Mac-only 版本。
- 开始 `2026-10-08T04:53:52Z`，run 最后更新时间 `2026-10-08T04:55:51Z`。观测期间任务自行完成，不存在观察超时后重启。
- 固定工具组合：`8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795`；冻结清单自身：`942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c`。
- 主任务此前提供候选提交 17 文件逐字节匹配记录；本人本轮独立核对 run API、两个 native job checkout 日志和 artifact 中的 harnessSha/runId/attempt/架构。两份 artifact 身份一致，各自 caseId 独立。
- prepare job **113155740651** 成功；Mac arm64 job **113155794741** 失败；Mac x64 job **113155794786** 失败；collect job **113156174571** 正确失败。没有 Windows native job。

两种 Mac 的 `Verify all 16 raw files...` 步骤和正式 DMG 下载校验步骤均成功。两个 verify 日志明确携带上述 `NA_EXPECTED_COMBINED_SHA256`。这证明冻结闸门在这次云端执行通过，不等于 DMG/安装/运行期所有事实已形成完整 artifact。两份 artifact 均缺 input-manifest，不能补写不存在的逐包运行期收据。

### 实际回读的白名单 artifact

本人下载的是两份小型证据 ZIP，全部在内存中计算原始 SHA-256、检查 ZIP 大小、限制条目名称/大小并读取 JSON；没有下载安装器、数据库、profile 或 Keychain 文件。两份哈希均与 GitHub API digest、各上传日志及 collect 的下载回读日志一致。

| 平台 | Artifact ID | ZIP 大小 | 原始 SHA-256 |
| --- | --- | --- | --- |
| Mac arm64 | [11529546721](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37729682202/artifacts/11529546721) | 953 字节 | `287b0094b78ebb56fec71ce3ef4602185c231e13d020406c62dcdf46f77a5ba3` |
| Mac x64 | [11529193193](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37729682202/artifacts/11529193193) | 1056 字节 | `fcd820ae8979a37becfc4256973f3ac4fe226c15dee729988bb9a7dc16b8487d` |

**每个 ZIP 实际只有 acceptance-result.json。** input-manifest.json、network-isolation.json、installer-events.json 均未上传；不是四文件完整套装，不能用 job 的上传 success 掩盖缺项。现有文件均在允许白名单内，没有为补证导出原始日志附件或敏感文件。

### F4 / P1：A 阶段应用启动失败；底层根因未获证明

**分类：原生启动/验收启动链环境兼容性阻断；尚无足够证据确认产品 bug。**

| 字段 | arm64 | x64 |
| --- | --- | --- |
| status | BLOCKED_ENVIRONMENT | BLOCKED_ENVIRONMENT |
| primary reasonCode | TEST_FAILED | NATIVE_EXECUTION_FAILED |
| primary stage | app-launch | app-launch |
| errorClass / errno | Error / null | Error / EPERM |
| 安全源码位置 | 未提供 | harness.ts:124:16 |
| secondary | RUNNER_EXIT_NONZERO，退出码 1 | RUNNER_EXIT_NONZERO，退出码 1 |
| 最后归档 stage | cleanup | cleanup |
| phases / assertions | 空 / 空 | 空 / 空 |
| cleanup / complete | true / false | true / false |

两端均留下 case-init、freeze-verification、download、runner-start、discovery-or-worker-start、test-start、module-load、constructor、execute、platform-setup、platform-install、app-launch 的检查点。**最后的 stage=cleanup 是收尾位置，不应覆盖 primary 的 app-launch 失败阶段。**

- arm64 的 app-launch 时间是 `04:54:53.272Z`，原生主错误仍未提供 errno 或源码位置；不能从 TEST_FAILED 推断子进程信号、sandbox 拒绝、权限原因或产品崩溃。
- x64 的 app-launch 时间是 `04:55:29.790Z`。EPERM 与 `tools/native-acceptance/harness.ts:124` 的 `_electron.launch({ executablePath: this.launcher, ... })` 关联，是目前最具体的直接错误。**没有 syscall、启动目标角色、启动后 PID/退出原因等字段，不能进一步断言是哪一次操作被拒绝。**
- launcher 是 owned 目录中的 shell 包装器。本人定向读取固定提交的 `platform/macos.mjs`，校验其 SHA-256 为 `0d4cd7edeabd1bab839bb8a864c2aa11e57ce6ce0c693f4b96688a5d14eb0a90`，与已审冻结一致；第 63 行创建 0700 包装器，经 sandbox-exec 启动包内原始可执行文件。因此“脚本 spawn”“sandbox 启动”“包内进程启动/调试连接”等层次都需证据区分，不能只凭 EPERM 任选原因。
- 两个 RUNNER_EXIT_NONZERO 的退出码 1 是测试运行器的退出信息，**不是已证明的应用主进程退出码**，也不是 Mac 安装器失败码。
- 两端都进入 app-launch；按 `harness.ts:349` 的顺序，可推断旧版 install 控制调用已经返回后才进入首次 launch。因 installer-events 缺失，未将此推断提升成完整可独立复核的安装验收 PASS，更不能称跨版升级完成。

本次 runner 环境：arm64 为 `macos-15-arm64 / 20260907.0337.1`，x64 为 `macos-15 / 20260824.0482.1`；两者 Node 均为 `20.20.2`。此信息只用于固定下一轮条件，不足以认定镜像差异为根因。

### F5 / P1：失败路径仍丢失已完成前置事实，现有脱敏信息不足以完成定位

**分类：已观察到的验收取证完整性缺口。** F1 的新检查点与 primary/secondary 确实比旧 NOT_EXECUTED 提供更多信息，但没有覆盖本次在 archive 之前中断的路径。

确定代码依据：

- `harness.ts:338` 构造 input-manifest 仅保留在进程内；安装结果和已完成断言也先存于 harness 内存。
- `harness.ts:380` 先等待 cleanup，直到第 397 行起才持久化 input-manifest、network-isolation、installer-events。两份原生产物都没有 archive 检查点或这些文件。
- `evidence.mjs:104` 的 checkpoint 只持久化 stage/时间等进度；第 113 行 recordFailure 写入共享状态，但共享状态未包含 harness 的那些已完成事实。因此本次结果保留 diagnostics，却仍是空 phases/assertions。
- `evidence.mjs:48` 的 safeDiagnostic 保留类型、errno、允许的源码位置等，不保留具体启动操作类别、syscall、受控目标角色或结构化 worker 退出信息。本次 arm64 仍没有足够根因信息；x64 只有 EPERM 及 launch 调用位置。

不能仅据“没有 archive”就断言是某个特定 worker 信号或 cleanup 崩溃；这里只能确定归档阶段没有形成可用证据。也不能拿 cleanup 的后续 success 把丢失事实重建为通过。

### 清理事实与覆盖限制

两个结果都记录了一次完整 `cleanupEvidence.attempts`，cleanupSucceeded=true；独立工作流 cleanup 步骤亦 success。

- arm64：`04:54:53.720Z` 到 `04:54:53.843Z`。
- x64：`04:55:30.196Z` 到 `04:55:30.411Z`。另有 `04:55:30.000Z` 的较早 cleanup 检查点，但没有对应完成 attempt；**不能宣称两次清理都被证明成功**。

已审 Mac cleanup 实现会恢复原 default/search Keychain、删除 owned 临时 Keychain、处理 owned mount/进程，并对失败返回错误。本轮 evidence 支持“独立清理控制调用完成”；它不等于应用正常退出，也没有额外发布原 Keychain 路径、条目或敏感数据。实际加解密持久化与新旧进程读写从未完成验收。

### 逐项验收状态

| 契约 | 本次实际证据 | 裁定 |
| --- | --- | --- |
| 固定 harness 身份/冻结闸门 | API、checkout、verify success、期望组合一致 | 闸门通过；完整逐文件收据未归档 |
| 固定历史 DMG 输入 | 两个下载校验步骤 success；无 input-manifest | 下载门通过；缺独立逐包 artifact 明细 |
| A 旧版启动与版本/身份确认 | app-launch 后失败，phases/assertions 空 | 未通过 |
| B 旧版完整退出后新进程读取 | 无 B 检查点/断言 | 未覆盖 |
| 1.0 到 1.1 同身份升级 | 无新版安装/升级事件归档 | 未覆盖 |
| C/D 新版独立进程与数据保留 | 无 C/D 检查点/断言 | 未覆盖 |
| safeStorage/Keychain K0、K1、仅元数据保存 | 无 REAL_SYSTEM_DECRYPT 或相关断言 | 未覆盖 |
| 数据库/配置/业务数据持久化及无明文 | 无 snapshot/状态断言 | 未覆盖 |
| 三类传输的四阶段真实 OS 拒绝与 loopback | 无 network-isolation | 未覆盖，不能伪报 0 次外连 |
| owned cleanup | 一次完整 attempt/平台，独立步骤 success | 控制调用成功；不代替应用正常退出 |
| Mac-only / Windows 边界 | 无 Windows job；collect 明确 Windows NOT EXECUTED | 边界保持；Windows 仍 BLOCKED_F2 |

### 交 Sol 的最小后续边界，不自动执行

1. **启动链只读取证：** 限 `tools/native-acceptance/harness.ts`、`platform/macos.mjs`、`evidence.mjs` 和对应离线回归。增加 wrapper/目标角色、存在性/可执行位、原字节 hash、原 bundle 验证返回状态等非敏感摘要；记录能安全确定的 syscall/固定错误类别及进程是否实际产生、退出码/信号。未知保持 unknown，不通过猜测给 arm64 补 EPERM。
2. **进度事实提前持久化：** 在输入校验、平台 setup、旧版安装控制返回后及时保存已经扫描的事实 JSON/断言摘要，不把所有事实押在 cleanup 后的 finally 上；新增在进入 launch 后子运行器异常结束的隔离回归，证明已有事实和原主因仍可收集。未完成网络探针须明确 incomplete，不能伪造安全通过。
3. **错误投影补强而非打开原始日志：** 对已识别的启动/worker 错误保留固定分类、允许的 errno/信号/整数码和受控路径角色。不要上传原始 Playwright 错误参数、stderr、profile、Keychain、trace、完整环境或完整绝对路径。
4. 先依证据判断启动链具体问题，再给出有界修复；**不得**直接关闭 sandbox/Gatekeeper、删除 quarantine、重签名或改安装包字节来求通过，不取消真实加解密/完整重启断言。
5. 修改仅在验收工具侧，重新生成冻结并交 Astra 独立预检后才决定下一次 Mac-only 运行。Windows D0 的新实现不纳入本轮；本报告不授权自动重跑当前 run 或扩大矩阵。

### 本人执行范围及最终签署

本人独立读取指定 run 最新 attempt/jobs、两个 native 及 collect 日志，回读并校验两份 artifact 原始 ZIP，检查全部实际 JSON 字段，并定向核对一个固定提交的 Mac 执行器源码及哈希。部分分析使用上一轮已冻结源码缓存；没有重新执行离线 33 项或七项负向测试，更没有把旧离线计数合并成此次原生通过数。

**BLOCKED。Mac 0/2 完成；Windows NOT EXECUTED / BLOCKED_F2；all-platform acceptance NOT complete。** 真实产品故障尚未被证明，启动与证据缺口须按上述范围先定位；保留 run 37729682202 attempt 1 的失败事实，不自动修实现、重跑或换包。


## Mac F4/F5 修复独立预检：允许有界原生复验，尚非产品验收通过

日期：2026-10-08。**本轮工具预检结论：MAC_ONLY_READY_FOR_NATIVE_RERUN。**

本结论仅覆盖下列冻结的 Mac-only 验收工具，不改写前节 run
37729682202 / attempt 1 的失败事实。**F4 的真实启动失败根因尚未被证明修复；
本轮确认的是新增诊断能够保留更多可靠事实，可以进入下一次受控原生取证。
F5 的已完成事实延迟落盘问题，在本轮代码路径检查和隔离回归范围内已得到修复。**

Windows D0 的 P1/P2/P3 仍在另一条修复线上，**禁止执行 D0**。
本次未读取其正在修改的实现，未改其预检报告，也不把 Mac 工具放行扩展为
Windows 或全产品通过。

### 审查输入和边界

主任务声明 Kant 已停止修改本轮输入。本人读取并核对以下五份变化 payload
及新冻结清单，与上次已审 Mac-only `8fef9436...` 缓存原文比较：
harness.ts、evidence.mjs、platform/macos.mjs、offline.test.mjs、README.md
及 fixtures/harness-freeze.json。其余十一份 payload 的原始字节摘要与上一冻结相同。

首次批量读取返回超过传输显示上限，未作为完整审查依据；对变化文件及本报告
进行了有界重新捕获并缓存，随后从缓存作差异分析。独立测试还逐项重算了
当前十六份实际 payload 的原始字节 SHA-256，未归一化换行。

workflow、下载器、固定安装包 manifest、版本契约、Windows 执行器、
snapshot.cjs、依赖清单/锁文件和测试入口等未发生字节变化。
没有大范围审计产品或修改业务、打包、发布流程。

### F5：提前保存已完成事实，失败不再依赖最终归档

- [harness.ts:364](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:364)
  在输入校验完成后立即写 input-manifest，不等待平台 setup 或 cleanup。
- [harness.ts:373](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:373)
  在 setup 返回后立即保存策略事实；探针仍为未完成，再保存策略文件 hash。
  不能把 setup 成功当作真实外连被拒绝的证明。
- [harness.ts:100](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:100)
  将已返回安装结果入账并立刻保存 installer-events，之后继续执行安装器 hash、
  用户身份和无自动启动断言。尚未返回的安装调用不伪造成功事件。
- [harness.ts:62](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:62)
  每项断言在抛出失败前保存；[harness.ts:124](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:124)
  在启动前先保存不完整 phase，明确 exited=false、identityVerified=false 和
  debugConnection=not-observed，而非虚构应用 PID/退出码。
- [harness.ts:404](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:404)
  在首次等待 cleanup 前再次保存已有事实。此处是补充防护，不再是唯一落盘机会。
- [evidence.mjs:364](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:364)
  保持白名单和脱敏扫描，合并已有首因、检查点和清理历史；
  [evidence.mjs:375](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:375)
  用同目录排他临时文件、flush 和 rename 发布完整 JSON，不直接截断旧文件。
- [evidence.mjs:126](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:126)
  的 recordFailure 从已持久化状态追加错误；运行器退出或清理成功不将原失败
  覆盖为 PASS。汇总阶段仍要求完整四阶段、正常退出、真实解密及网络控制证据。

本轮证明的是进程失败/中断范围的已完成事实保存机制。
机器断电、存储永久故障、云端被强制撤销而未执行 artifact 上传不在通过范围内；
原子 rename 也不是对所有文件组成一个跨文件事务。

### F4：白名单启动链诊断，严格区分观察与推断

[evidence.mjs:392](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:392)
新增只读检查 wrapper、shell、sandbox-exec 和原始可执行文件的存在性、执行权限、
mode 和 hash；codesign 仅调用一次 --verify/--deep/--strict，30 秒命令预算。
不存在 re-sign、quarantine 删除、关闭 Gatekeeper 或放宽 sandbox 的改动。
codesign 成功也不等于 Gatekeeper 放行，更不等于应用已经执行。

[evidence.mjs:430](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:430)
只观察本来就要进行的、精确匹配 owned wrapper 路径的一次 spawn；
原 options、接收者、返回值和异常继续传递，没有另起产品启动探针或重试循环。
本地反例确认匹配外的 spawn 不被记录/改写，同步失败后 hook 能恢复。

角色边界如下：

- spawn-requested 不证明已经产生 PID。
- spawn-observed 和 exit-observed 只属于 launcher-process，不自动成为应用
  主进程或产品退出结果。
- [harness.ts:143](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:143)
  只在 Playwright launch 返回后记录 debugConnection=connected。
- [harness.ts:162](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:162)
  仍要求真实 Electron 返回的 exe 和 PID 与所持进程吻合；完成全部相关身份断言后，
  才由 [harness.ts:168](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:168)
  写入应用 pid 与 identityVerified=true。调试连接成功但 PID 不符的反例被拒绝。
- [evidence.mjs:564](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:564)
  将外层运行器退出明确标成 test-runner，不填到未完成 phase 的应用 exitCode。
- [evidence.mjs:67](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:67)
  只投影允许的 syscall 动词、errno 数值及固定进程角色，不输出 argv、环境、
  原始 stderr 或含路径的错误参数。无 errno 的 ARM 错误仍为 null；
  不套用历史 Intel EPERM。

仍然无法仅靠这些检查确认 shell 到 sandbox-exec 到原始应用每一次 exec 的实际
跨越。只有 wrapper PID、文件可执行或 codesign 返回状态时，根因仍可未知。
下一轮必须读取实际诊断，不能把 EPERM 自动解释为 Gatekeeper、sandbox 或产品缺陷。

### 本人实际执行的检查

工作目录和 TEMP/TMP 均在 K 盘。没有安装依赖，没有调用原生平台 setup/install、
本机 Electron 产品、Keychain、防火墙、券商或交易操作。

**1. 当前提交的离线套件：39 passed / 0 failed / 0 skipped。**

实际执行 `node --test tools/native-acceptance/offline.test.mjs`，退出码 0，
duration_ms=1415.0517。其中包含原来的冻结拒绝、主次错误、清理、三平台/Mac-only
collector 回归，以及新增六项行为回归。不是仅引用开发者的 39/39 摘要。

套件内名为 Windows setup/install 的用例调用的是带全部平台效果替身的实际
harness 方法，**不执行 Windows 安装器，也不是 D0**。

**2. 本人另设计并控制的附加检查：11 项按预期通过，0 失败。**

1. ARM unknown 启动错误：实际 harness 路径只调用一次 launch，errno=null，
   identityVerified=false，phase 无 pid、无 exitCode。
2. 调试连接返回但主 PID 531/532 不一致：拒绝 EFFECTIVE_EXECUTABLE；
   即使 debugConnection=connected，也不确认应用身份。
3. 对单个无害 Node 子进程使用真实 ChildProcess 观察器：只启动一次，观察到退出 23，
   角色始终 launcher-process；未把它当作产品或应用正常退出。
4. 非匹配 spawn：不采集事件，不改变原返回值；hook 恢复。
5. 同步 spawn 抛错：原异常传回，hook 恢复，没有虚构 PID 或 EPERM。
6. codesign 查询不可用：只尝试一次只读效果调用，退出码保持 null，不追加产品启动。
7. 原子写的排他创建返回 EEXIST：不写目标，也不删除不属于本次调用的临时文件。
8. 实际 collector CLI 收到“包装器 exitCode=0，但应用 phase exited=false”的
   合成证据：拒绝通过。
9. 实际 collector CLI 缺 A:REAL_SYSTEM_DECRYPT：拒绝通过。
10. 实际 collector CLI 有 PASS 字样但 cleanup=false：拒绝通过。
11. 真实 K 盘文件持久化及提前退出：在独立 Node 测试子进程内调用当前
    writeEvidence/checkpoint/recordFailure/atomicJson 逻辑，四份白名单 JSON 已保存后
    用退出码 73 直接结束，未经过 cleanup/finally；父进程仍能读取完整四文件并追加
    RUNNER_EXIT_NONZERO，保留 TEST_FAILED 首因和已完成安装断言。phase 没有应用 PID/
    exitCode，cleanup=false，complete=false，退出 73 仅属于 test-runner。

第 11 项使用合成事实、注入的 owned K 盘根目录及无原生操作的依赖边界；
不伪装 CI 环境，不调用真实产品。harness 的“在 cleanup 前产生这些事实”的行为由
第 1/2 项及 39 项套件直接验证，持久化层由真实文件与进程边界补强。
这些是工具隔离验证，不代替 Mac 真机升级、Keychain 或真实 safeStorage 测试。

执行环境 Node 为 `v24.15.0`；云端 workflow 仍固定安装 Node 20。
本轮没有宣称已在云端 Node 20/macOS 上完成这 11 项或实际产品验收。
所有新增临时 JSON 均只写在 K 盘独有测试目录，删除前验证绝对路径父目录和前缀，
未改生产 data。未另增测试源码文件。

**计数保持分开：39 项套件、11 项独立补测、16+1 文件冻结核对；
本轮新增原生产品通过数为 0。**

### 未退化项及残余风险

冻结函数的十六路径白名单、local-first 原字节拒绝和清单自身同 commit 绑定没有放宽；
离线套件继续拒绝缺文件、同长度篡改、换行转换、错误 commit 内容及错误清单自身。
本人另独立重算了全部当前 payload 的实际 SHA-256 和组合，不依赖生成器的完成消息。

Mac-only workflow 字节未变，只含 macos-15/arm64 与 macos-15-intel/x64。
[evidence.mjs:644](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:644)
的 collector 平台集与完整门槛保持不变：旧 collect 仍需三个平台，collect-mac
拒绝混入 Windows；四阶段、两版安装、正常退出、REAL_SYSTEM_DECRYPT、K1 替换、
仅元数据保存不改密文及十二项传输控制门槛未删除。

清理执行算法和 Mac 临时 Keychain/sandbox 配置未改；新增错误投影不是安全策略改动。
本轮确认其调用/主次错误合并回归没有退化，**未实测 native cleanup 成功**。
此结论不涉及 D0 新清理代码。

残余风险必须保留：

- F4 可能仍在首次应用 launch 失败；本轮只改善归因，未证明启动已经恢复。
- OS 实际进程身份、启动后的调试连接、Keychain 交互、正常退出及跨版数据保存仍待
  原生 run 的 A/B/C/D 证据。不得用 hasApiKey、窗口重开或 wrapper PID 替代。
- 短生命周期进程和未返回的系统调用可能仍只给出 unknown。只读 codesign 检查不是
  Apple 公证验证，现有未公证风险不变。
- probeComplete 是本轮十二项主动传输控制的状态，不是完整后台外连拒绝次数。
  新四文件齐全也不等于所有测试完成。
- 39 项套件及附加检查中的平台效果替身不能证明 macOS 安全机制本身有效。
- 源代码审查和这些隔离结果不保证零 bug。

### 新的独立 raw-byte freeze

所有条目均从当前实际文件原始字节独立计算，排序为 POSIX 相对路径升序，
按键顺序 `{path,size,sha256}` 组成数组；对无尾换行的紧凑
`JSON.stringify(files)` UTF-8 字节作 SHA-256。清单自身不纳入十六项组合。

**16 payload combined：**
`398039814a6ad00dd665a4256a26f2d37754df03b4fb674c6662c67de5ffa6f8`

**清单自身 SHA-256：**
`2114e5397f5e2f9c09d067c72f8e3b6107b0bbb77b67e4f46d6e51cd260ffa9a`

清单大小：2989 字节。两项均与主任务声明一致。

以下依次为 SHA-256、字节数、相对路径：

```text
8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06   10080  .github/scripts/fetch-upgrade-installers.cjs
e793ff8c657710d5a2a21e2574545d9f3685d45d3e32dd53d425fb7987df9072    5248  .github/workflows/native-upgrade-acceptance.yml
b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f    1808  tests/fixtures/releases/native-upgrade-1.0-1.1.json
0ba333ee15dad72bb06d55e42c13f83293c96233b5a77bfbd9d1b24a12cee574   11875  tools/native-acceptance/README.md
00e079a3a7bdc6e07b657aaf6be124e4c549f9a8738de832b89d4098428cdae0   47013  tools/native-acceptance/evidence.mjs
b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7    2457  tools/native-acceptance/fixtures/version-contract.json
28b95e005e6abaa219def399f460dbce7a6575f0a7a97d5b97e0db9e524cc8dc   34476  tools/native-acceptance/harness.ts
e3b29698b5a2143c9792d8c50b78a71182ebe08df30f2ff66654ebcd5d873581     689  tools/native-acceptance/native-upgrade.spec.ts
22600ff4397bf30f4f486375cd1bd8168b593dc45500ee343b284a3a7adeab47   45956  tools/native-acceptance/offline.test.mjs
ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298     319  tools/native-acceptance/package.json
dc371cf619740c3700454e85a21634478db316b9ba7cdfb220f90d505c4b2a0b    9894  tools/native-acceptance/platform/macos.mjs
f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c     155  tools/native-acceptance/platform/macos.sh
fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778   11982  tools/native-acceptance/platform/windows.ps1
7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81     504  tools/native-acceptance/playwright.config.ts
7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d    1317  tools/native-acceptance/pnpm-lock.yaml
671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945    4955  tools/native-acceptance/snapshot.cjs
```

本报告、D0 六文件、durable store 和任何产品修改均不在上述冻结内。
前节旧冻结保留为对应历史 run 的身份，不得混用。

### 有界交接条件

1. 主任务仅将本节十六份 payload 加 freeze 自身共十七份文件绑定至新的候选 commit，
   逐项回读原字节完全匹配后，才可安排下一次 Mac-only 原生复验。
   本轮没有远端候选 SHA，没有声称已完成远端字节比对。
2. 不覆盖正式 v1.0.0/v1.1.0 资产、不移动 tag、不重新构建或重签产品，不关闭
   sandbox/Gatekeeper，不增设多次产品启动探针。每阶段仍执行原定一次启动。
3. 新原生运行需保留首个失败及全部 attempt，取得真实四 JSON、run/jobs/step 日志，
   由 Astra 逐项审查。不能以 workflow success、diagnostic 字段变多或离线通过直接
   签署升级/Keychain成功；失败不得自动重试到绿。
4. D0 禁止执行，其 P1/P2/P3 须在独立冻结基线上另行复验。本报告不授权合并或运行
   尚未放行的 D0，也不改变其历史预检结论。

**本轮终点：MAC_ONLY_READY_FOR_NATIVE_RERUN。本人未 push、触发 CI、运行安装器或交易；
仅追加本报告，产品最终验收仍待真实 Mac 结果。**


## Mac-only 原生复验取证：37732869282 / attempt 1

### 本轮签署：BLOCKED，Mac 两架构均未完成验收

本节依据本轮实际 run、已完成 job 日志、两份原生 artifact 中的八个 JSON，以及独立
原始字节 SHA256 / JSON 一致性检查。不是复述开发方自检，也不以 workflow 状态代签。

两端均停在 **A 阶段的原始 v1.0.0 首次启动**。启动链进程已产生，随后均观察到退出码
65，但调试连接未建立，原应用身份、PID 和退出码均未确认。因此不能将该 65 归给
原应用、shell 或 sandbox-exec 中的某一层，也不能认定 v1.1.0 存在升级故障。

Intel 的 EPERM 明确对应 `kill`，不是 `spawn`；ARM 仍无具体 errno。
本轮没有真实升级、持久化解密或正常退出重启通过证据。F5 证据留存有实质改善，
但“所有 cleanup attempts 均被保留”仍不成立。Windows 不在此次运行和签署范围。

### 1. 运行身份和正式字节边界

- [原生运行 37732869282](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282)，attempt 1，push，分支 `codex/acceptance-1.0-to-1.1`。
- API 返回的 harness commit：`89e80fb07b1a1dcf1e71218ad50ef0a7f3698046`；tree：`348e9f17a90275393f624add9d43b5e9f6e77a65`。
- 本轮首次读取 run 时已经 completed / failure，最后更新为 `2026-10-08T05:34:00Z`。没有因等待超时重启、另触发 run 或反复重试。
- 十六文件 combined：`398039814a6ad00dd665a4256a26f2d37754df03b4fb674c6662c67de5ffa6f8`。
- freeze 自身 SHA256：`2114e5397f5e2f9c09d067c72f8e3b6107b0bbb77b67e4f46d6e51cd260ffa9a`。
- 固定产品 manifest SHA256：`b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f`；版本契约 SHA256：`b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7`。
- 本人核对两份 input-manifest 中的十六项冻结记录与上轮独立冻结完全相同，八个 JSON 的 run / attempt / commit / architecture / case 身份一致。安装包固定记录与既有产品 manifest 相同。此次没有重新下载大安装包或重新读取远端十七份源码；远端原字节逐项回读属于主任务先前提供的证据，原生安装前 freeze 闸门成功另由本轮日志支持。

| Job | 实际结果 | 本轮观察 |
| --- | --- | --- |
| [prepare 113165751684](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282/job/113165751684) | success | 准备阶段完成 |
| [ARM 113165825354](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282/job/113165825354) | failure | freeze / immutable download 成功；第 9 步 native 失败；后续独立 cleanup、stage、upload 成功 |
| [Intel 113165825405](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282/job/113165825405) | failure | 同上 |
| [collect 113166161217](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282/job/113166161217) | failure | 严格拒绝两份 BLOCKED_ENVIRONMENT / NATIVE_EXECUTION_FAILED；明确 Windows NOT EXECUTED / BLOCKED_F2，all-platform NOT complete |

固定产品身份如下。这里只确认记录与下载闸门，不能将 v1.1.0 的下载成功说成已安装、启动或升级通过。

| 架构 / 版本 | 固定大小（字节） | 固定 SHA256 |
| --- | ---: | --- |
| arm64 / 1.0.0 | 201578904 | `547d959d5de843bb8fb07bbe47037d388598de381a930d74119dc5caf2359383` |
| arm64 / 1.1.0 | 201656920 | `42970ebc1d9365765deddc94306beb39816ca3a4a16b88b62331a004d51f6d8e` |
| x64 / 1.0.0 | 209343420 | `dc8cee3d6952d3226b3216c149ba3be0cfe66e57111c4bb69edba71f6cae002f` |
| x64 / 1.1.0 | 209345834 | `604782a67ebb79e2df5665ab8293573996d34ba37711b2f27e4dde2ea969ac96` |

v1.0.0 source 为 `41f8429149f646c7dec7f1610082702e7d9cce48`；
v1.1.0 source 为 `ec1fe73e5f3c80edb1f3e7b0a989a03cf66b18ad`。
产品版本、tag 和公开资产均未修改。

### 2. Artifact 取证及字节一致性

本人仅取回两个小型 ZIP，在内存中读取白名单四 JSON；未下载安装器、未将 ZIP
解压至用户目录。检查文件名、条目数量、尺寸边界、非加密 ZIP、解压后长度和
JSON 内容中的敏感字符串边界。两个原始 ZIP 的 SHA256 均同时匹配 GitHub artifact
API digest、上传日志以及 collect 下载日志。

| 架构 | Artifact | ZIP 字节数 | 本人计算的原始 ZIP SHA256 |
| --- | --- | ---: | --- |
| arm64 | [11530157647](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282/artifacts/11530157647) | 4644 | `6c41980797d1762ba940fd3d6f1fc1df027ee51f9a86034e1a0f586f80c893bd` |
| x64 | [11530223848](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37732869282/artifacts/11530223848) | 4689 | `1364fc9f967b608e8e16b4dd8fc5b493e9f1070b977c2278d9b52ffd287d847d` |

四文件原始字节摘要：

| 架构 | 文件 | 字节数 | SHA256 |
| --- | --- | ---: | --- |
| arm64 | input-manifest.json | 4693 | `5f7e6b6ea477e08e65cc9ef1eac6bf8437d2dbb70f0330b6bc80d15091635d87` |
| arm64 | acceptance-result.json | 5802 | `c68d25a55eedb8fbce858862e967a39fae177bac6340af86f8beeef7088d035d` |
| arm64 | network-isolation.json | 1079 | `08d7b1747ba6c15f6c08b49780535934a8b2a51c1e7228e74eba385e14979824` |
| arm64 | installer-events.json | 482 | `966abb5bd0b8139ef5082399854c4ddaafd06095be4a80daa5e48c065df8fa67` |
| x64 | input-manifest.json | 4683 | `5a22d541d3b5a60ae8241828e2bea6e3733fd87f569737c9d771c528018fd120` |
| x64 | acceptance-result.json | 5813 | `4ca47e5392ef924d1db085dcf8a9a10be74867b40b3649b414d6ee74b7b5caf7` |
| x64 | network-isolation.json | 1077 | `5e946a3e7322c4dcb4a1c741624c5e60fee062b674355bf56be638aae6640f5d` |
| x64 | installer-events.json | 480 | `8cb221dd8a32ae9ef00c7985d9af3b46a98aa7cbccc73671c5b3a767f96d50c1` |

### 3. F4：最早失败已收窄，但原始失败层仍未知

以下时间全部为 UTC，均来自本轮 acceptance-result，而不是推测：

| 观测字段 | arm64 | x64 |
| --- | --- | --- |
| A 阶段开始 | 05:33:20.682 | 05:33:41.233 |
| launcher 请求 | 05:33:23.107 | 05:33:43.328 |
| launcher spawned | 05:33:23.113，PID 2854 | 05:33:43.337，PID 39772 |
| launcher exit | 05:33:23.179，code 65 | 05:33:43.368，code 65 |
| primary diagnostic | Error，errno null，无 syscall | Error，EPERM，syscall kill |
| secondary diagnostic | RUNNER_EXIT_NONZERO，test-runner，exit 1 | RUNNER_EXIT_NONZERO，test-runner，exit 1 |
| debugConnection | not-observed | not-observed |
| identityVerified | false | false |
| 原应用 PID / exitCode | 均缺失 | 均缺失 |

**可以确定：**

1. 两端的 launcher-process 均已经 spawn，不能再把本次 Intel EPERM 描述为创建
   启动进程失败。退出 65 是当前证据中最早带明确时间戳的异常观察。
2. 两端的 wrapper、shell、sandbox-exec、original executable 均通过存在、
   regular-file、executable 检查，codesign 验证进程返回 0。这些检查不等于原应用
   已执行，不等于 Gatekeeper 放行，也不等于 Keychain 正常。
3. ARM 原始可执行文件摘要为
   `b3f1a55e927ca70ffe9287f01a8883ffcfbea372bf53aa562f913bf627a13027`；
   Intel 为 `da0f02238766748a6212e04c394dbd8507b0d8469d8c128663939f664537d989`。
   这只是已安装文件身份观察，不是这些文件进程的退出证据。
4. 观察器对 launcher-process 的标记来自
   [evidence.mjs:430](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:430)；
   原应用身份要到调试连接及 PID / executable 核验完成后才成立，参见
   [harness.ts:143](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:143)
   和 [harness.ts:162](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:162)。
   本次没有到达该证据门槛。

**不能确定：**

- wrapper 使用 shell 的 `exec sandbox-exec ... original-executable` 链，
  见 [macos.mjs:69](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/platform/macos.mjs:69)。
  同一 PID 可能改变执行映像，只有 launcher PID / exit 不能识别哪一层产生 65。
  不能用通用退出码释义，直接断言 sandbox 策略语法错误或原包崩溃。
- Intel `kill` 的目标 PID / 角色、signal 和实际 syscall 时间未保留；
  primary diagnostic 也没有独立事件时间。不能断言它一定早于或晚于 exit 65，
  不能将其擅自归为杀原应用失败、杀 wrapper 失败或 runner 自身安全策略问题。
- diagnostic 中的
  [evidence.mjs:455](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:455)
  是观察器等待 operation 的位置，不是已定位的操作系统 `kill` 调用位置。
- ARM 的 errno 仍为 null，不能借用 Intel 的 EPERM。现有安全日志没有可归属到
  某一执行层的 65 原因文本，根因仍未知。

**分类：启动链阶段阻断，工具 / 环境 / 原产品根因未决。**
目前没有足够证据签署“确定产品 bug”，也没有足够证据签署“工具已排除”。

### 4. F5：输入和部分事实已救回，清理 attempt 日志仍有缺口

与前一轮相比，本轮两个 artifact 都保留了四份白名单 JSON，包括：

- 输入来源与完整十六文件冻结；两个版本固定 installer 元数据。
- 一次原始 1.0.0 安装结果，appId `com.tradewatcher.app`、安装返回 0；
  ARM 时长 10463 ms，Intel 时长 14258 ms。尚无 1.1.0 安装事件。
- A 阶段的七项 true 断言、未完成的启动 phase、launcher 事件、primary 和
  test-runner secondary diagnostic。
- 独立 workflow cleanup 的成功回执。即使测试未到 archive checkpoint，
  后续 stage / upload 仍上传了这些早期事实。

**残余缺陷 F5-cleanup（P2，验收证据完整性，非产品故障）：**
每端有两个 cleanup 入口 checkpoint，但只保留一个完成的 cleanup attempt。

| 架构 | 第一次入口 | 第二次入口 | 唯一完整 attempt |
| --- | --- | --- | --- |
| arm64 | 05:33:23.224 | 05:33:23.607 | 05:33:23.618 至 05:33:23.789，成功 |
| x64 | 05:33:43.405 | 05:33:43.596 | 05:33:43.617 至 05:33:43.856，成功 |

代码在 [evidence.mjs:469](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:469)
先记 checkpoint，随后等待平台 cleanup；直到 await 完成后才将 attempt 写入数组，
见 [evidence.mjs:472](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:472)
及 [evidence.mjs:475](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:475)。

**复现条件：**测试 worker 进入 cleanup、平台命令尚未完成时退出或被终止，再由
workflow 的独立 cleanup 收尾。当前实现会保住两个入口 checkpoint，却丢失第一
次 attempt 的可追踪开始记录和最终未知状态。本轮数据符合该缺口，不能据此进一步
断言首次平台命令究竟执行到哪里、为何终止或是否已完成操作。

**最小修复边界：**在 await 前持久化独立 attempt ID、执行角色、startedAt 和
started / incomplete 状态；完成时更新同一 attempt。外层 cleanup 另追加自己的
attempt，保留先前未知状态及 primary failure。补充 worker 在 cleanup 中断的反例，
不能把第一次未知补写为成功。

另有**快照时点不一致**：两份 network-isolation 的 `cleanupSucceeded=false`、
`disabledAt=""`，而 acceptance-result 的 cleanup 为 true。结合 checkpoint、
后续 job 和代码顺序，这反映前者是清理前快照、后者附加了外层清理回执，不足以
断言清理失败。当前
[publishEvidence](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:487)
仅复制既有文件；测试 worker 未走到
[harness.ts:432](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/harness.ts:432)
的最终 network 持久化。后续应显式保留快照时间与 incomplete 范围，并附加有来源的
最终 cleanup 投影，不得顺便把未执行的网络控制或解密测试改成通过。

### 5. 实际覆盖和未覆盖

每端只有以下七项 true 断言：`A:PUBLIC_PROBE_REACHABLE_BEFORE_ISOLATION`、
`A:INSTALLER_EXIT_0`、`A:INSTALLER_BYTES_0`、`A:SYSTEM_USER_0`、
`A:NO_INSTALLER_AUTOSTART_0`、`A:LEGACY_TRAP_EMPTY_BEFORE`、
`A:PROFILE_NOT_PREPOPULATED`。这是七项启动前条件，不是七项完整产品测试；
两架构相加也不能称为十四项升级 / Keychain 通过。

| 契约 | 本轮证据与结论 |
| --- | --- |
| 原始 installer 来源、身份、下载闸门 | 两架构有固定元数据及成功日志；本人未重下载大包 |
| v1.0.0 安装到隔离目标 | 两架构有返回 0、身份和部分前置断言 |
| A 的原应用身份与调试连接 | 未确认，阻断 |
| A 的单厂商真实 safeStorage 保存 / 解密 | 未执行完成，无通过证据 |
| 正常 app.quit 后独立新进程重启 B | 未覆盖；runner exit 和 launcher exit 都不能替代 |
| 1.0.0 至 1.1.0 同身份升级 C、持久化再启动 D | 未覆盖，没有 1.1.0 安装或 B/C/D phase |
| 新旧进程解密、无明文密钥、配置和数据保留 | 未覆盖，不能由 hasKey、下载或安装成功推导 |
| 隔离 setup | 记录 inherited-sandbox-loopback-only 策略及摘要，非继承效果最终证明 |
| 隔离 controls / probeComplete | controls 为空，inherited=false，probeComplete=false，未完成 |
| 外层 cleanup | 每架构一次完成且成功；更早一次入口状态未知 |
| collect fail-closed | 已按真实不完整证据失败，未把两架构失败判成通过 |

网络策略摘要为
`f7dfa3333acc36436a1dcb4ad350a8823f403439c7c49622ede267dd49f89e0a`。
记录的 requestCount=0 / credentialRequestObserved=false 仅限现有 loopback 观察；
不能扩张为完整操作系统外连拒绝计数或“绝无外发”。`descendantsCovered=true`
也不能在原应用未确认、inherited=false 的情况下证明原应用及全部后代实际继承隔离。
本轮没有使用真实凭证、券商账户或真实订单。

### 6. 下一步最小取证边界，不自动重跑

1. 在**现有单次启动**上增加有界、内存内白名单化的错误分类或执行层边界观察，
   保留安全的角色 / errno / syscall / 已知关联 PID；无证据时继续标 unknown。
   不上传原始 stderr、完整命令行、路径或密钥，不额外启动原应用探针。
2. 对 Intel `kill`，只在来源真正可确认时记录目标角色、所属关系、signal 和阶段。
   分开记录启动退出 65 与后续异常，不能让后一层异常覆盖先前失败。
3. 修复上述 cleanup journal 的“开始前不落盘”缺口，并标明 network 快照时点。
   离线反例必须覆盖中断，而不只是平台 cleanup 正常返回的情形。
4. 最小实现范围仍是 Mac 验收 harness / evidence / platform 及对应离线测试、
   README、freeze；无需改产品或 Windows D0。新的执行字节须重新冻结和独立预检。
   本报告不授权自行触发 CI、换基线、换包、手工解包绕过或重试到绿。
5. 不关闭 sandbox / Gatekeeper，不改变原始安装包或安全参数来制造通过。
   如需受控单变量诊断，应先明确实验契约，不能混作升级正式验收。

### 7. 本人执行与复核证据的区别

**本轮亲自执行：**读取指定 run 的终态与 latest-attempt jobs / artifacts；
读取两端 native job 和 collector 日志；通过既有授权接口下载两个小型证据 ZIP；
在内存中检查四文件白名单及脱敏边界、计算 ZIP 与八文件 SHA256；执行确定性
JSON / identity / pin / freeze / coverage 一致性审计。该审计退出 0，
结果为 `identityAndHashAudit=PASS`、`nativeAcceptance=BLOCKED`。
这只是证据一致性通过，不是原生产品测试通过。

**本轮只复核：**GitHub-hosted runner 实际运行的下载、安装、启动、cleanup 和
collector；此前已独立审查的冻结源码用于解释本轮证据。上轮 39 项离线测试及
独立反例并未在本轮重跑，不能重复计数，也不并入此前 54 项结论。
主任务远端十七文件回读的结论按来源注明，没有伪称本人在本轮重新完成。

**最终结论：BLOCKED。**F4 的诊断范围有所收窄，F5 的早期证据留存部分得到原生
验证；这两点不是升级、Keychain 或产品交付通过。保留全部历史失败。本轮仅追加
本报告，没有操作生产数据、Keychain、防火墙、安装器、CI、tag、公开资产或交易，
没有修改 Windows D0 报告。


## 下一步有界诊断设计：固定 Mac sandbox / wrapper 与真实 cleanup 调用边界

**状态：DESIGN_READY_FOR_SOL，仅设计交接，不是 READY_TO_RUN 或产品放行。**
本节延续 run `37732869282` 的实际失败，不重置历史。本轮仅使用已读冻结源码、
已取得的日志和 JSON，另定向查阅公开一手实现作语法线索；没有执行探针、离线用例、
安装器、产品、CI 或修改执行代码。Windows D0 仍由另一位验收负责人处理。

### A. 源码已证问题与假设必须分开

| 项目 | 当前判断 | 证据门槛 / 说明 |
| --- | --- | --- |
| cleanup attempt 在平台调用返回后才保存 | **已证工具缺陷** | evidence.mjs:469 仅 checkpoint，472 await，475 才写 receipt；中断会丢失真实 attempt 状态。本轮两端均留下两个入口、一个完成回执 |
| command 超时回调直接 child.kill，无异常保护 | **已证条件性工具缺陷，尚非本次根因** | evidence.mjs:261、263；若 kill 同步抛错，异常不由该 Promise 的正常 reject 路径收束，可能打断证据保存。实际 Intel kill 的来源尚未关联至这里，不能据此归因 |
| 固定 SBPL 的 loopback 地址表达式 | **待证假设** | 第 4 / 5 行分别使用 IPv4 字面量及方括号 IPv6；当前没有编译器诊断，不能仅凭 exit 65 认定哪行无效 |
| 第 6 行 remote unix-socket | **未证明有语法缺陷** | 不应因它看起来可疑就删掉或放宽网络规则 |
| wrapper 的 -f / -- / 引号 / exec 链 | **未证明有调用缺陷** | 源码引号意图明确，但本轮没有 sandbox-exec 参数解析或 exec 成败证据；launcher PID 不能证明已经执行 original binary |
| Intel EPERM / kill | **已证 syscall 类别，目标与原因未证** | 不能说 spawn 被拒，也不能认定其为 sandbox、Gatekeeper 或原产品故障 |
| ARM 原因 | **未知** | errno null，不借用 Intel 的错误解释 |

上述条件性 kill 缺陷的依据是
[evidence.mjs:255](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:255)
的完整 Promise / timer 结构，不是根据操作系统错误码猜测。最小修复要让 timer 的
kill 错误进入安全的 secondary diagnostic 和有界结束路径，保住此前 timeout /
launch failure；不能把它改成成功或无限等待。本轮未复现这一条件分支。

公开一手实现只提供线索：[Codex 的 Seatbelt 生成源码](https://raw.githubusercontent.com/openai/codex/main/codex-rs/sandboxing/src/seatbelt.rs)
也生成 `remote unix-socket`，其 loopback 生成采用 `localhost:port` /
`localhost:*`。这不足以证明本项目字面量在本轮 macOS 镜像中必然无效，
也不足以授权将 profile 改成该写法。**先取得本项目原 profile 的真实诊断，
不以外部项目示例代替本机编译证据。**

### B. 固定不变的诊断材料

原始 profile 来自
[macos.mjs:66](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/platform/macos.mjs:66)，
UTF-8、LF、最后一个换行必须保留：

```scheme
(version 1)
(allow default)
(deny network-outbound)
(allow network-outbound (remote ip "127.0.0.1:*"))
(allow network-outbound (remote ip "[::1]:*"))
(allow network-outbound (remote unix-socket))
```

原始字节 SHA256：
`f7dfa3333acc36436a1dcb4ad350a8823f403439c7c49622ede267dd49f89e0a`。

原 wrapper 来源为
[macos.mjs:69](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/platform/macos.mjs:69)。
探针使用相同的 shebang、exec、参数次序、路径引用方式和 `"$@"`，
**仅终端目标由原产品绝对路径替换成固定 `/usr/bin/true`**：

```sh
#!/bin/bash
exec /usr/bin/sandbox-exec -f '<owned-root>/network.sb' -- '/usr/bin/true' "$@"
```

上面是结构说明，不是可直接运行的命令；实际路径必须由受控 renderer 引用，
不能把占位符写入脚本或从任意用户字符串拼接命令。

实现必须共用纯 profile / wrapper renderer，避免写一个“类似”的诊断模板。
只允许两个枚举目标：`original-product` 和 `system-true`，不得新增任意
命令、环境变量替换产品目标、shell eval 或运行时插入脚本内容的入口。
产物 wrapper 本身不能被覆盖成 true，再偷偷恢复成产品。

保存 profile 原始摘要、wrapper 实例原始摘要，以及仅将 profile 路径与目标映射为
固定占位符的模板摘要 / 对比布尔值。模板规范化只用于对比，不得对执行字节做换行
或参数归一化。两类模板必须除目标外一致；profile 必须逐字节等于旧摘要。
任何不一致都在 spawn 前 BLOCKED_INPUT。

### C. 一次、无业务副作用的工具探针 T1

**推荐先做独立的 diagnostic-only 运行，不与产品启动自动串联。**
它只验证系统工具链，不下载 DMG、不挂载、不安装、不启动 Electron、不生成假 key，
不访问用户数据库，也不执行现有 setup 中的 Keychain 切换操作。
现有 setup 先操作 Keychain 才写 profile，因此不能直接调用 setup 来完成探针。

1. 仅 GitHub-hosted 的既定 Mac arm64 / x64 镜像，分别生成受控 RUNNER_TEMP case，
   校验 owner / run / attempt / commit / freeze；拒绝本机、Windows、已有 case 或
   attempt > 1。单架构只有一个 T1，不自动重试；任何重新运行需另行决定并保留旧结果。
2. 从冻结源码的同一纯 renderer 写出 profile 和独立 true wrapper，路径必须属于
   case、不可为符号链接，沿用 0600 / 0700。确认 profile 摘要为上节旧摘要。
   只读检查 /bin/bash、/usr/bin/sandbox-exec、/usr/bin/true 的存在、类型、权限、
   系统文件摘要；true 不存在时停止，不查 PATH、不下载替代物、不改用 shell 内建。
3. 与原 launch 使用同一 safeEnvironment 策略和明确的 cwd 契约，不输出环境。
   检查无 shell 初始化 / 动态加载注入项；若环境安全条件不满足，停止，不能悄悄
   更换环境然后称为“精确复现”。证据记录策略 ID / 安全检查布尔值，而非环境内容。
4. 直接 spawn 已生成的可执行 wrapper，`shell:false`、无 shell -c，stdin 关闭，
   stdout / stderr 管道，附加业务参数为空。不使用 Playwright 的 Electron launch：
   true 不提供 inspector，等待调试端口只会人为制造超时。
5. 记录本次实际 spawn requested / observed / error / exit / close 的 UTC 时间、
   受控 PID、角色、exitCode / signal；调用开始前写证据。全程上限 5 秒，
   结束收尾另限 2 秒；超时只能针对本次持有的 ChildProcess 做有界终止并安全捕获
   kill 失败，不用 killall、负 PID、进程组或扫描后猜 PID。
6. stdout / stderr 只在内存做有界处理；超过额度或超时即停止判为阻断，保存安全
   状态，不输出原文。持久化证据后结束该 diagnostic-only job，
   **即使 T1 成功，也不能在同一入口接着安装或启动产品。**

必须如实注明：T1 复用的是 sandbox profile 与 shell-wrapper-sandbox-exec
链；它没有复现 Playwright 加入的 inspector 参数、stdio 细节、Electron 进程树、
产品签名 / quarantine 路径和 Keychain 行为。终端目标及附加参数为空是显式实验
变化，不能把它说成与失败的 Electron 调用在所有变量上完全一致。

若未来将 T1 纳入正式验收前置步骤，仍须先独立审查工具和新 freeze，再决定是否
允许进入 A。本轮只设计诊断入口，不给任何自动进入产品阶段的授权。

### D. stderr 的安全分类合同

分类器只接受 **T1 自己持有的工具进程管道**，不挂接产品 stderr，不读取全系统
日志、不收集原始调用栈、环境、命令行、Keychain 输出、目录列表或崩溃报告。
原始 stdout / stderr 不落文件、不放 artifact、不进入抛错 message / reporter，
也不以原始字符串的 hash 变相留存敏感文本。

- stderr 内存累计上限 8 KiB，单条诊断上限 1 KiB，最多输出 4 条分类；stdout 只计
  有界字节数，预期为空。增量解码和跨 chunk 匹配需正确；截断、乱码、未知格式均
  显式标 unavailable / unknown，不拼凑结论。
- 可输出固定枚举：`TOOL_SPAWN_ERROR`、`SHELL_SYNTAX_ERROR`、
  `PROFILE_READ_ERROR`、`SBPL_PARSE_ERROR`、`SBPL_SYMBOL_ERROR`、
  `SBPL_ADDRESS_ERROR`、`SANDBOX_APPLY_ERROR`、`TARGET_EXEC_ERROR`、
  `TOOL_USAGE_ERROR`、`TOOL_TIMEOUT`、`UNCLASSIFIED_TOOL_EXIT`。
  枚举是待实现的分类合同，不代表本轮已观测到这些错误。
- errno / syscall / signal 仅固定白名单；producerRole 与 observedRole 分开。
  仅由受控工具前缀及完整、锚定的固定消息结构确认 producer，不从出现某个词就
  推断执行层。没有可靠识别时 producerRole=unknown，保留 launcher-process 事实。
- 可保留 compiler 提供的 profile 行 / 列，但必须确认指向本次准确 profile 路径，
  在内存映射成固定角色 `sandbox-profile` 后校验：行在 1 至 6，列落在相应行范围；
  不输出绝对路径。不能将 observer JS 行号填成 SBPL 行号。
- token 只允许来自这六行的有限词表，例如 version、allow、deny、default、
  network-outbound、remote、ip、unix-socket 和两项固定 loopback 字符串。
  只在对应诊断结构提供 token 时输出；未知词只标 unknown。不能截取任意“附近文本”。
- 不应让泛化正则仅凭 stderr 出现 EPERM、65、某个 token 就输出编译失败。
  需脱敏反例验证：伪前缀、额外路径、伪密钥、超长字符串、换行 / ANSI、分片、
  无行列、未知语言和两个相互冲突的消息。匹配不够精确时保留未知，而不是丢失
  整体非零退出事实。

最小 receipt 包含：run / attempt / commit / case / arch、诊断模式、
profileSha256、wrapperSha256、模板对比、工具摘要、前置检查、实际事件、
安全分类、可用的行列 / token、bufferTruncated、timeout、cleanup 关联 ID。
全部先进入严格 schema / 脱敏检查，再写白名单证据。不得在 uploader 遍历整个 case。

### E. 结果判定与禁止重试点

| T1 结果 | 能支持的结论 | 不能支持的结论 / 下一步 |
| --- | --- | --- |
| 材料、身份或冻结不一致 | 输入不可信，安装前阻断 | 不执行 T1 或产品，不自动修正 profile |
| spawn / shell 级明确失败 | 系统工具启动层有真实错误 | 不指向产品；修工具后须重新冻结评审 |
| 同 profile 的明确 SBPL 诊断 | 当前 runner 对该精确 profile 有编译 / 地址 / 符号错误 | 可据行列提出修复；不在原 run 自动改 profile 再试 |
| sandbox_apply / exec 的明确诊断 | 编译之后的特定工具阶段受阻（仅当消息确有该语义） | 不将它改写为 SBPL 语法错误或产品崩溃 |
| exit 65，无可靠分类 | 固定工具链也复现非零退出 | 仍 UNKNOWN；不能仅按数字认定编译失败 |
| exit 0、signal null、stdout / stderr 空、材料一致、无超时 | TOOL_CHAIN_PASS；该 profile 与 wrapper 执行 true 的路径完成 | 不证明网络阻断、Electron 启动、Keychain 或升级 |
| timeout、未知 stderr、截断、证据写入失败 | 诊断不完整，阻断 | 不重跑到绿，不继续产品 |

原始 run 的 exit 65 不会因 T1 也失败就自动获得确定根因。只有同一精确 profile
得到清晰编译诊断，才可确认当前工具材料缺陷；对历史 run 的归因仍标明这是后续
受控复现的支持证据，而不是历史中不存在的原始 stderr。

若 T1 将来明确指向某一规则，下一轮只能另立一个有明确语义的单变量修复实验，
仍先 true、仍不启动产品。不能删规则直到通过，不能把 loopback 改为 `*:*'，
不能放开 network*、禁用 sandbox / Gatekeeper、strip quarantine、resign，
也不能将不同 profile 摘要下的成功覆盖原始失败。网络效果验证与产品 A/B/C/D
仍是后续独立门槛，true 不发网络，当然无法证明阻断有效。

### F. cleanup attempts：最低可审计修复

**边界定义：一次真正进入 cleanup 函数就是一个 caller attempt；checkpoint
只是流程标记。辅助进程真正 spawn / 进入 cleanup action 必须另有事件，不能由
caller intent 代替。**

建议最小状态记录：

| 事件 | 写入时机 | 能证明什么 |
| --- | --- | --- |
| caller-entered | 验证 owner 后、任何 await / 平台副作用之前，持久化成功才继续 | 本次调用实际发生；attemptId / callerRole / callerPid / startedAt 已登记 |
| helper-spawn-requested | 调用实际 spawn 前 | 已准备调用，不等于 spawn 成功 |
| helper-spawned / spawn-error | 实际 ChildProcess 事件 | helper PID / 安全系统错误；不是资源清理完成 |
| helper-entered | Mac helper 确认 action 和 owner 后，执行清理前 | 平台清理分支真实进入 |
| operation-started / ended | 各固定资源步骤实际调用前后 | 仅记录 owned-process-cleanup、mount-detach、keychain-default-restore、keychain-search-restore、keychain-delete；未适用步骤标 not-needed |
| helper-finished | helper 退出前同步记录结果 | helper 自己的成功 / 失败观察 |
| caller-observed-result | caller 收到并核验 helper 返回后 | 本次 caller 收到完整回执；不覆盖其他 attempt |

每次调用产生新 attemptId，贯穿 caller 和 helper；角色分别限定
test-finally / workflow-cleanup，不能从目前位于哪个 checkpoint 反推调用者。
status 至少区分 started、succeeded、failed、incomplete；未知结果
`cleanupSucceeded=null`，不能用 false 假称已失败、也不能因之后成功补成 true。
runner 被终止时允许末事件为 started / helper-entered，保留未知就是正确证据。

**落盘与竞争最低要求：**

1. 在已有 run-state / acceptance-result 之外，以每 attempt 独有的不可覆盖事件
   文件作为小型内部 journal。每事件排他创建、先脱敏、原子完成；不共用一个数组
   做跨进程 read-modify-write。内部 journal 只在受控 case，最终折叠进入现有四 JSON，
   不扩张 artifact 白名单上传目录。
2. caller 或 helper 在任意边界中断，外层收尾都能读取既有事件，不能依赖正常 finally。
   没有 ended 的 attempt 保持 incomplete；有 helper-finished 但 caller 未收到时，
   分别保留 helper 结果与 caller receipt 缺失。
3. 独立 workflow cleanup 不能与尚存活的旧 helper 并行修改 Keychain。
   用受控 ownership / 活动锁和有界存活核对串行化；旧 helper 仍活着或归属不可确认
   时阻断重复执行，不能根据文件“很旧”就夺锁。旧 helper 已确认退出才允许新 attempt。
4. timer 中的 kill 失败要捕获并记为该调用的安全 secondary error，有限等待后返回
   incomplete / failed，不抛出失控异常、无限挂起或丢掉 primary。
   不增加一次任意进程探测 / 信号来“确认权限”。
5. mergeRunState / archive / publish 从 journal 按 attemptId 合并，必须同时保留
   两次真实调用；不得仅取最后一次 attempt 或用下一次 success 覆盖前一次未知。
   主错误、cleanup 错误、archive 错误继续分角色保留。
6. network-isolation 的 cleanup 投影注明来自哪个 attempt、观察时点和是否完整。
   外层成功可更新“最终资源收尾”事实，但不能改动 earlier snapshot 的含义，
   更不能把 inherited / probeComplete / controls 填成通过。

此设计不要求伪造清理的逐步成功，也不要求必须凑足两次调用。根本要求是：
实际发生几次就有几次可追踪 intent；实际进入平台几次就有几次进入事件；
缺失的完成证据显式未知。T1 不创建 Keychain，因此它的该类清理应为 not-needed，
不能调用安全设置变更来制造 cleanup 覆盖。

### G. Sol 最小实现边界与交接门槛

本轮不动这些文件；以下是后续建议写范围，不含业务代码：

| 文件 | 最小工作 |
| --- | --- |
| tools/native-acceptance/platform/macos.mjs | 纯材料 renderer、隔离 diagnostic-only action、cleanup helper 的真实边界事件；不改原 profile |
| tools/native-acceptance/evidence.mjs | T1 有界观察 / 安全分类、caller cleanup journal、受保护的 timeout kill、严格结果投影 |
| tools/native-acceptance/harness.ts | 标明 cleanup caller 身份、保留早期事实；不得顺带启动 T1 后自动跑产品或改 A/B/C/D 断言 |
| tools/native-acceptance/offline.test.mjs | 执行实际新 helper 的纯离线反例及中断边界测试，不执行 Mac 安全命令 |
| tools/native-acceptance/README.md | 模式、scope、未知值、一次执行和禁止自动重试规则 |
| tools/native-acceptance/fixtures/harness-freeze.json | 实现完成后重新生成，独立绑定自身原字节；不能沿用旧摘要 |
| .github/workflows/mac-launcher-diagnostic.yml（后续若建立） | 专用手动入口，严格两 Mac 架构、diagnostic-only；无 installer 下载、Keychain、产品启动或发布权限 |

独立诊断 workflow 必须纳入新的明确冻结集合并绑定同一 commit；不能将新增入口
放在未冻结文件中，再拿旧十六文件摘要声称全部已审。原 acceptance workflow
和 collector 仍保持产品门槛，不允许 diagnostic-only 结果被原 collector 当 PASS。
即使不新增 workflow，也必须由明确的诊断模式拒绝 fall-through 到 execute。
分支 / 触发条件需证明上传代码本身不会触发既有产品工作流，之后才可授权更新 ref。

最低离线反例：原 profile 一个字节改变即拒绝；模板只能替换固定目标；参数顺序 /
-- / 引号保持；非白名单目标和环境注入拒绝；T1 非零 / 超时 / 未知 stderr 永不启动
产品；stderr 秘密与分片不能泄漏；kill 抛错有界保存；caller 入场后、helper 入场后、
资源操作中、helper 结束但 caller 未返回四种中断；双调用不丢事件；活 helper
禁止并发收尾；later success 不掩盖 prior unknown / primary；四 JSON 和原 Mac
collector 严格门槛不退化。

**下一交付：Sol 实现上述工具改动，Astra 先离线预检及原字节冻结；随后才单独决定
是否执行 T1。现在不盲目再跑产品。Mac 产品结论仍为 BLOCKED，Windows D0 不受本节
影响。**


## H. T1 触发契约修订：固定专用分支的一次受控 push

**设计结论：认可此方案，比为注册 dispatch 而把未审 workflow 写入 main 更小；
但本节不是候选代码 READY，也不是现在创建 / 更新 ref 的执行授权。**
替代 G 节“仅手动入口”的建议，允许唯一固定分支
`refs/heads/codex/diagnose-mac-launcher-1.0` 的 push 触发 T1。
A 至 G 的原 profile、无产品启动、无 Keychain 变更、一次探针及错误分类边界不变。

GitHub 的 [push / workflow_dispatch 官方事件说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
支持未并入默认分支的 push workflow；dispatch 的默认分支存在要求使其不宜作为
本次尚未注册入口的前提。无需为此改 main、正式 tag 或 release。
本轮查阅官方说明，但没有调用 dispatch、push 或任何 ref 写操作。

### H1. 当前触发面核对及证据范围

本轮定向列举本地 `.github/workflows`，共七份既有文件，没有新 T1 文件。
其中 native-upgrade 使用此前已审原字节缓存；另六份本轮首次读取其触发配置和
入口关联。**这不是尚未提供的远端候选 commit / default branch 最终核对。**
候选 READY 前必须将下列事实重新绑定至实际候选对象，并核对默认分支上的
间接事件监听者，不能拿 canonical 工作树的状态替代远端事实。

| 既有 workflow | 已读 on 过滤 | 对本次专用分支的影响 |
| --- | --- | --- |
| native-upgrade-acceptance.yml | push 仅 codex/acceptance-1.0-to-1.1，加 paths；dispatch | 专用诊断分支不匹配 push，不会因此进入产品 A/B/C/D |
| macos.yml | push main / codex/macos-support；pull_request base main；dispatch | push 不匹配；**若诊断分支已有指向 main 的 PR，更新它仍可能触发产品构建 / 测试** |
| verify.yml | push main；pull_request base main；dispatch | 同样必须排除该分支关联的未关闭 main PR |
| release.yml | push codex/release-1.1 或 v* tag；dispatch | 仅推诊断 branch 不匹配；不得同时推 tag |
| windows-build.yml | push codex/macos-support；dispatch | 不匹配 |
| windows-installer-diagnostic.yml | push codex/diagnose-windows-installer-1.0，加 paths；dispatch | 不匹配，不运行 D0 |
| macos-upstream.yml | schedule / dispatch | 不因该 push 触发；其独立定时任务不属于本次授权 |

已读七份中没有 create、workflow_run、check_run、check_suite、status 或
repository_dispatch 自动入口，也没有由 T1 调用的现成 reusable workflow。
macos-upstream 会在自己的定时 / 手动任务中 dispatch 构建，但它不是此 push
的后继链。不能据此声称仓库独立定时任务永远不会同时运行。

本轮可供候选比对的既有 workflow 原始 SHA256：

```text
c5833fe8364829cc56bf6c7b1a7d6db9f49bba9d97050210cad1f56a6d1c6570  macos-upstream.yml
0f16743ab8472358ed2b20cf0cba805fb97df79e03b30b56b9a518adae58901c  macos.yml
e793ff8c657710d5a2a21e2574545d9f3685d45d3e32dd53d425fb7987df9072  native-upgrade-acceptance.yml (previously reviewed frozen bytes)
ebc1f459cea72f18c059c3ac41d8fec05219537a124c92f085592ee3d27fb452  release.yml
e8900bd97bc28b81c3747825778fb09e6067bd543ea12654aa0d2c9c3cc0c8e6  verify.yml
311155b86b9ca0bc7e0942dca06ad4f6fb645a7265e668aaf5034731fb327453  windows-build.yml
b2bf4b7004b210d039b281978a50e330101b9cded23c74c75c8e52c2c40f160a  windows-installer-diagnostic.yml
```

D0 文件仅查看触发范围，未做实现验收，未写其报告。候选树如果不包含本地某份
workflow，需明确记录 absence；如果出现额外 workflow 或摘要不同，需检查实际
新内容及事件链。不能为了匹配这份本地清单而把无关 D0 代码塞进 T1 候选。

### H2. 候选、授权与一次 ref 操作

1. 父任务先生成未挂分支的候选 commit，明确 base / tree / commit 及完整写范围。
   所有 T1 可执行依赖、workflow、固定材料与 freeze 必须属于同一候选；
   `24` 不是硬编码正确答案，以最终完整白名单 N 项为准，freeze 自身另列摘要。
2. 原字节 contents / blob 回读逐项匹配，保留排序组合摘要；Astra 对冻结实现、
   离线行为及触发面预检给出具体候选的 `T1_READY_TO_RUN` 后才可推进。
   未审 main、release 或产品代码不因“需要注册 workflow”混入范围。
3. 推进前确认该专用 ref 的预期状态，且**不存在以它为 head、以 main 为 base
   的未关闭 PR**，本轮也不创建 PR；同时核对候选 / default 的全部 workflow
   事件、调用关系及所有其他会匹配此 push / branch create 的任务。
   若默认分支间接监听链无法查明，不能给“只会跑 T1”的最终 READY。
4. 创建时要求 ref 原先不存在，使用冲突即失败的原子创建语义；更新时绑定明确
   expected-old，并只允许到已审候选的快进。先 GET 再普通 update_ref 不等价于
   lease；执行工具若不能实现原子 expected-old 约束，停止而非假称有保护。
5. 授权绑定 repository、唯一 ref、expected-old / absence、候选 commit、
   全部 freeze、模式 T1-only。只做一次成功的 ref 操作，不同时推其他分支 / tag。
   操作结果未知时只读核对 ref 和 run，不能盲目再推一次。
6. 触发后登记确切 run_id / attempt / head_sha / event / workflow path，
   将本次授权标记已消费，只观测这一 handle。没有出现 run 时也先记录阻塞，
   不能用补一个 commit、重新 dispatch、删除重建 ref 或 rerun 来“试到触发”。

使用的推送身份须能够正常产生 Actions 事件；不要依赖会抑制后继事件的
workflow GITHUB_TOKEN 去制造触发。权限问题只报告，不扩大账户权限或自行换凭证。
本节不操作任何授权凭证。

### H3. 新 workflow 的最低门禁

- push 只允许上述**完整固定分支名**，不得使用 codex/**、所有分支、tag、
  pull_request 或 workflow_run。可不加 paths 以免首次创建分支时漏触发；
  若保留 paths，必须覆盖最终完整工具集合，且不能把它当安全授权门禁。
- prepare / native 入口再核对 repository、完整 ref、event、attempt=1、
  checkout 的精确 github.sha 及冻结集合。拒绝删除 ref 事件、非 Mac、
  其他架构、非 diagnostic-only 模式和任何不符输入。
- 首轮建议只允许 push 执行 T1。可以保留 workflow_dispatch 声明，但在首轮
  gate 中拒绝其进入探针；未来启用 dispatch 必须另行明确授权，不能形成旁路。
- 两 Mac 架构各只有一个 job、一次 T1，fail-fast=false，不设重试；
  按 run / SHA / architecture 原子创建 marker，先于 spawn。concurrency
  cancel-in-progress=false，只用于避免重叠，不宣称它能去重或授权新 run。
- runner marker 仅约束同一次 case / run。**新 run 的空 RUNNER_TEMP 和
  attempt=1 不是新的授权**。父任务维护本次 ref 操作及已消费 run 的记录，
  不自动创建第二个 run；若以后要求工具程序化实现跨 run exactly-once，
  必须新增独立的授权消费 / run 绑定机制，不能声称现有 marker 已保证。
- 只有 contents:read 及确实必要的只读权限；checkout 不保留写凭证；
  不调用现有 acceptance run、产品安装 / 打包、Keychain setup、发布、D0、
  repository dispatch 或其他 workflow。上传只含白名单工具证据。
- 诊断结果明确 scope=T1-tool-only、product NOT_EXECUTED、Windows NOT_EXECUTED。
  T1 成功不调用产品 collector，不改变 Mac 产品 BLOCKED。

### H4. 本轮范围与下一步

上述是**触发方案认可，附不可省略的门禁**；没有新的候选 SHA / 完整新集合，
因此现在不签署实现 READY。Sol 的纯材料和 cleanup 实现可继续，不因改用 push
而取消 A-G 的预检与安全边界。

父任务提供的 Windows Node 20.20.2 路径
`K:/AI/person/money/.tmp/rt-node20-test-Q3NSRB/unpacked/node-v20.20.2-win-x64/node.exe`
可作为后续隔离离线测试运行时。本轮没有执行它；所述 39 项通过仍是父任务
开发证据，不是本人的复验，更不是 Mac 原生验证。

本轮仅追加本节，不修改 workflow / 源码、不创建 ref、不触发 CI，
不动 main / tag / release / 公开资产，也不改另一位 Astra 负责的 D0 报告。


## T1 + cleanup journal 独立实现复验：ca45d5f4 / 501ee989

### 签署结论：BLOCKED_PRECHECK，不签 READY_FOR_CANDIDATE_AUDIT

本轮亲自执行了指定 Node 20.20.2 的完整离线套件、额外十项独立检查，并审查
本次十八份输入文件（十七 payload 加 freeze）。没有运行 Mac / Windows 安装器、
原生 sandbox / Keychain、产品、交易或 CI。

原有 58 项可以在满足相对入口假设的隔离目录中全部通过，但额外反例证明
**已识别的 SBPL 诊断会被后续超时覆盖**。这违反本次探针保留定位事实的目的，
不能只凭开发用例通过签署 READY。另有离线用例的 cwd 依赖，需一并作小范围修正。
两项均属于验收工具，不是 RT-ResearchFlow 产品故障，也不解释历史原生 exit 65。

### R1 / P2 / 阻断：超时会覆盖已取得的安全编译诊断

位置：
[evidence.mjs:303](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:303)
先调用实际分类器；随后
[evidence.mjs:305](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:305)
在 timeout / command-unavailable 分支直接替换 `toolOutput.records`。
后到的工具异常因此覆盖了先前能够安全保存的错误分类。

本人在 K 盘独立探针中调用**实际 boundedCommand 实现**，仅注入 ChildProcess
事件，不执行系统命令。合成输入满足实现自己的编译诊断严格格式：

1. stderr 收到指向受控 profile 的第 4 行第 3 列 invalid IP address 诊断，
   token 为原 profile 固定词表中的 `127.0.0.1:*`。
2. 子进程观察到 exit 65，但 stdio 的 close 尚未观察到。
3. 到达 deadline；因为已经观察到进程退出，未额外发 kill，grace 后有界返回。

实际安全结果：

```json
{
  "exitCode": 65,
  "closeObserved": false,
  "classes": ["TOOL_TIMEOUT"]
}
```

预期是保留已识别的 `SBPL_ADDRESS_ERROR`，同时单独保留 timeout /
close 未确认事实，而不是用后者覆盖前者。本人新增检查第 7 项明确失败；
这不是 Node 版本、cwd 或测试安装依赖导致的失败。

**最小修复范围：**evidence.mjs 中该覆盖分支、offline.test.mjs 增加此反例、
重新生成 freeze；若说明文字需要同步才改 README。可将终止原因作为独立安全
诊断字段，或在有界记录内追加，不要求沿用本人探针的数组布局；必须同时保住
先前安全分类与后续 timeout。不得引入 raw stderr，不扩大 token 白名单，
不得因编译信息已出现而把未关闭的进程 / 管道判作清理完成。

修复后需要同类检查 command-unavailable 等覆盖分支，确保原先已观察的事实不会
被更晚异常抹掉。没有要求为了覆盖这些分支重新启动原产品。

### R2 / P2 / 离线用例缺陷：命令入口错误地依赖调用目录

位置：
[offline.test.mjs:777](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/offline.test.mjs:777)。

该项通过 `path.resolve('tools/native-acceptance/evidence.mjs')` 计算子进程入口，
而不是相对于测试文件计算。在独立 K 盘工作目录运行整份测试时，子进程会寻找
不存在的目录下入口，返回 MODULE_NOT_FOUND；断言期待的 NATIVE_PLATFORM_REQUIRED
没有执行到。README 又给出 `node --test offline.test.mjs` 的使用方式，这个
相对路径假设使测试不具备该调用方式所需的 cwd 独立性。

**实际首轮：**cwd 为 `K:/AI/person/money/.tmp`，58 项中 57 passed / 1 failed /
0 skipped，失败仅第 41 项；退出 1。保留此结果，不称首轮全过。

为区分实现问题与调用目录假设，本人没有修改待审测试，而是在自己的 K 盘临时
目录放入从已读输入复制的 evidence 入口与只读版本契约，满足原测试的相对路径。
其余测试仍运行 canonical 的完整 offline.test.mjs。第二轮 58 passed /
0 failed / 0 skipped，退出 0。复制入口的真实子进程在 Windows 平台门禁即退出，
没有进入 Mac helper、创建原生 case 或执行安全设置操作。

**最小修复范围：**offline.test.mjs 使用相对于自身模块 URL 的入口位置，并在
任意受控 cwd 可运行。无需改 workflow、产品或原 profile。修复后的完整套件应
直接在独立 K 盘目录通过，不再需要此次相对入口支撑文件。

### 本轮亲自执行的测试与证据

运行时：
`K:/AI/person/money/.tmp/rt-node20-test-Q3NSRB/unpacked/node-v20.20.2-win-x64/node.exe`，
Node 20.20.2。TEMP / TMP 均指向 `K:/AI/person/money/.tmp`，
js-yaml 通过用户指定的既有 NODE_PATH 加载。未安装依赖或读取生产数据。

| 执行 | 结果 | 解释 |
| --- | --- | --- |
| canonical 完整 58 项，独立 .tmp cwd | 57 / 1 / 0 skipped，退出 1 | R2 的相对入口失败；约 10.15 秒 |
| canonical 完整 58 项，K 盘独立相对入口支撑目录 | 58 / 0 / 0 skipped，退出 0 | 本人实际执行，不是转述 Sol；约 17.59 秒；不抹去首轮失败 |
| Astra 新增十项检查 | 9 / 1 / 0 skipped，退出 1 | 第 7 项复现 R1；约 0.43 秒 |

独立检查文件：
[independent.test.mjs](K:/AI/person/money/.tmp/astra-t1-review-LaQ1lr/independent.test.mjs)。
该目录还保留已读输入和纯合成 cleanup journal，没有安装器、账户资料或密钥。
临时探针最初的长命令因 Windows 参数长度限制在进程创建前被拒绝，随后采用
K 盘文件执行；这是本人取证命令的环境限制，不归为被测代码故障。

十项独立检查覆盖：原字节冻结 / 组合、真实 YAML 入口、固定 profile / 引号、
首次证据写入失败时零 spawn、同步 spawn 错误隐私、exit 已观察但 close 未观察、
编译诊断遇到后续 timeout、stdout 超额与 kill EPERM、伪诊断 / 密钥后缀脱敏、
以及早期未知 cleanup 在后续成功后仍被保留。所有 native API 都是明确注入的
离线事件替身；并未将这些合成错误说成本轮 macOS 实际发生的错误。

这三次执行不得相加成 126 项不同测试，也不得并入旧 54 项或原生 Mac 升级结论。
此前 Sol 的 58 项通过只作开发证据；本节记录的是本人的独立运行。

### 已通过的有界检查与代码预检

- **冻结字节：**从磁盘一次读取原始字节，独立计算十八项摘要；独立探针再次验证
  已捕获内容的字节往返、十七项排序列表与 manifest、组合摘要及 freeze 自身摘要。
  与本轮提供的 ca45 / 501e / be2b 全部相符。
- **材料：**共享 renderer 仅允许 original-product / system-true，原 profile
  SHA256 仍为 `f7dfa3333acc36436a1dcb4ad350a8823f403439c7c49622ede267dd49f89e0a`。
  换行、参数、引号、终端目标变化有拒绝反例，没有关闭或放宽隔离。
- **T1 workflow：**js-yaml 解析确认仅固定诊断分支 push、contents:read、
  两 Mac 架构、fail-fast=false、无 dispatch。所有 run 入口限于
  t1-guard / prepare / init-t1 / verify / t1-run / t1-cleanup / publish；
  没有下载 DMG、安装依赖、setup Keychain、产品 launch、打包或发布调用。
- **门禁与一次执行：**代码及实际入口离线替身覆盖仓库 / ref / event /
  deletion / attempt / hosted / 架构 / Node20 / case / freeze、同一 case 二次
  run 被 marker 拒绝。marker 仍只是本次运行防重复，不声称跨 run 授权。
- **deadline 与私密输出：**5 秒加 2 秒 grace 的实际参数传递有覆盖；
  独立检查确认首次证据失败不 spawn、输出超限和 kill 抛 EPERM 都有界退出，
  close 未观察时保持 incomplete。stdout 不回传，stderr 原文 / hash 不落盘；
  模糊、恶意后缀及无法识别内容不泄漏。**R1 说明完整错误事实保留仍未过关。**
- **cleanup journal：**caller-entered 在 await 前独占落盘；caller / helper
  分序列事件，lease 对活进程 / 身份未知 / 未确认资源操作采取阻断。实际 helper
  的资源操作顺序通过 VM 注入检查，不执行 ps / security / hdiutil。
  caller 未收到回执时仍为 null，不把 helper 成功等同 caller 成功。
- **清理及收集保守性：**T1 cleanup 不调用原生 helper / Keychain；仅用自己的
  close 观察决定结束是否确认。旧未知 attempt 不被后续 success 改写，
  network 的 controls / inherited / probeComplete 不因此变绿。
  collect / collect-mac 均拒绝 mode=mac-launcher-T1，即使合成文件把 status
  改作 PASS，也不能充当产品验收。
- **范围差异：**harness.ts 本轮只把 cleanup caller 标为 test-finally；
  native-upgrade-acceptance.yml 与既有冻结相比只有显示计数 16 改为 17。
  原产品 A/B/C/D 条件没有因此降级。以上不是对未相关产品模块的全量审计。

### 确切审阅字节清单：只作身份记录，不是执行放行

十七项 combined：
`ca45d5f444d67cf112d82a1b68ca8510be0bb1e1912f2b88d92068a3b97ecbe0`。

```text
SHA256                                                            bytes  relative path
8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06   10080  .github/scripts/fetch-upgrade-installers.cjs
be2b35a7fc92819d38705eb15cf24004fa07ea4e97403a853da06ef25ebe4332    3613  .github/workflows/mac-launcher-diagnostic.yml
e18567eff0ea04838b698a44e938b2306ba6343955d95157f389667ddfcb4b0a    5248  .github/workflows/native-upgrade-acceptance.yml
b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f    1808  tests/fixtures/releases/native-upgrade-1.0-1.1.json
a66ad6eb1e41e65699e684a3e2630bd45039a57c7c8d730c71042bfc1f9cf682   17313  tools/native-acceptance/README.md
4b499fc2077ee8dab7f0d32d6238dcde43c51fe537f17cdc97976d8f430e27b4   80766  tools/native-acceptance/evidence.mjs
b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7    2457  tools/native-acceptance/fixtures/version-contract.json
63879080a2b7d942af9ac98101ebfa18a1f758f9dd27cbf967e5582e28a19350   34490  tools/native-acceptance/harness.ts
e3b29698b5a2143c9792d8c50b78a71182ebe08df30f2ff66654ebcd5d873581     689  tools/native-acceptance/native-upgrade.spec.ts
f4f4d0a0767af4cee9996bc9eb33686c9e2bc52bce1a07d911062e070dcfbc70   78186  tools/native-acceptance/offline.test.mjs
ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298     319  tools/native-acceptance/package.json
c2a1fa2f730a5ff47a6377a1eb6b68e414cf9d8e5e46f921c27a37c282122479   12065  tools/native-acceptance/platform/macos.mjs
f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c     155  tools/native-acceptance/platform/macos.sh
fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778   11982  tools/native-acceptance/platform/windows.ps1
7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81     504  tools/native-acceptance/playwright.config.ts
7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d    1317  tools/native-acceptance/pnpm-lock.yaml
671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945    4955  tools/native-acceptance/snapshot.cjs
```

freeze 清单自身单独绑定，不计入自引用组合：
`501ee989fea6476c9584863eabce1434704dff79a3df86a5ce8787e1dbc71f3d`，
3169 字节，
`tools/native-acceptance/fixtures/harness-freeze.json`。

本轮审阅对象没有获授执行许可。R1 / R2 修复后的任何新字节必须重新冻结并复验，
不能沿用以上摘要签署 READY。报告和本人临时探针不属于执行 payload。

### 残余风险与最小交接

1. Sol 仅需修 evidence.mjs 的诊断覆盖、offline.test.mjs 的两项回归与 cwd 路径，
   同步必要说明并重建 freeze。未要求改 profile、wrapper 规则、产品、workflow
   触发方式或 Windows D0。
2. 当前只有离线语法 / 行为模型证据，尚无真实 T1。SBPL 实际报错格式能否命中
   严格分类器、macOS 工具链能否编译此 profile、原始 exit 65 的根因均未知；
   不能将合成诊断当真实系统错误。
3. 修复后即使离线通过，也最多签署 READY_FOR_CANDIDATE_AUDIT。
   主任务仍须对最终候选完整 raw bytes、全部候选 / default workflow 触发链、
   main PR 关联、lease 约束及唯一 run 授权完成 H 节审查，然后才能决定一次 T1。
4. Mac 原生升级 / Keychain 产品验收仍 BLOCKED；本轮不复查或重跑 D0，
   不把另一任务的结果并入此结论。

**本轮终点：BLOCKED_PRECHECK。**仅追加本报告及自己的 K 盘独立取证文件；
未改待审实现 / 业务 / workflow、未 push、未触发 CI、未安装或操作 Keychain、
未触碰 main / tag / release / 公开资产或真实交易。


### 复验交接补充：R1 精确修复合同及 R2 调用条件

本补充响应主任务“暂不创建候选、不触发 T1”的决定，**维持 BLOCKED_PRECHECK**。
没有新增测试执行，也没有修改待审代码。以下是之后分派修复时的最小合同，不是
要求当前正在处理其他任务的 Kant 立即切换工作。

#### R1：事实与超时分别保存，不改变退出原因归属

确定修改点仍为
[evidence.mjs:305](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:305)。
不要无条件把已分类的 `toolOutput.records` 换成仅 TOOL_TIMEOUT /
TOOL_SPAWN_ERROR 的新数组。

最低要求：

1. 已经严格白名单识别的 stderr 记录保持原值，包括 classification、producerRole、
   targetRole、可确认的 profile 行列和允许 token。此处保留的是实际分类器的
   观察，不新增从 exit 65 推断出来的“编译原因”。
2. 超时保存在独立的执行状态或安全诊断中：timeout=true、closeObserved=false、
   工具 deadline 原因码。可沿用已有 timeout / error diagnostic 字段，
   不强制新建数组或 schema 字段；不能为满足测试外观而伪造二次错误。
3. 已观察到的 exitCode=65 和 signal=null 不被超时、kill 结果、runner 退出码改写。
   如果原来没有 exitCode，仍保持 null，不能用超时数字填充。
4. 整体仍 BLOCKED、不完整；保留一条已识别记录不等于完整输出或成功清理。
   若 outputComplete 表示输出流完整性，close 未观察时必须为 false；若实现继续
   用它表示已捕获文本可分类，则需显式区分这两个含义，不能用它证明完整退出。
5. 超时只针对工具执行收尾，不归给 original binary 或产品。可确认的先前分类
   不被后到错误覆盖；后到超时也不被先前分类掩盖。kill 失败继续作为独立安全
   secondary 信息，不覆盖前两类观察。
6. 仍遵守有界记录、stderr 原文不落盘、已退出 child 不再发 kill、deadline /
   grace 有限、零自动重试。记录空间满时显式标 incomplete / truncated，
   不能静默丢掉最早定位事实来让新分类占位。

**针对性回归期望：**

| 注入事件顺序 | 必须保留 | 必须拒绝的错误结论 |
| --- | --- | --- |
| 已识别 SBPL 记录，exit 65，无 close，随后 deadline | 原 SBPL 记录、65、timeout、close 未确认、BLOCKED | 仅 TOOL_TIMEOUT；原应用导致超时；cleanup 成功 |
| 同一 SBPL 记录，exit 65，正常 close | 原记录、65、close=true，无虚构 timeout | TOOL_CHAIN_PASS |
| 无可识别 stderr，exit 65，无 close，deadline | 65、timeout、未知分类 / 不完整 | 自动补成 SBPL_PARSE_ERROR |
| timeout 加 kill EPERM，未确认退出 | timeout、kill EPERM / syscall、exit 未知、incomplete | 把 EPERM 说成 spawn；填充原应用退出码 |
| 已安全分类的文本之后又有无法识别 / 敏感文本 | 已确认事实与后续输出不完整分别表述，不输出敏感文本 | 直接上传原文，或把整个过程判通过 |

独立探针目前对“原 SBPL 分类未被保留”的断言已实际失败；
上述其余行是**修复后所需回归合同**，不能写成这一补充已经亲自执行。
新实现可以将 timeout 放在现有独立字段而不是塞进 records；后续复验应按语义
检查“两个事实都在”，不强迫沿用本人的临时数组布局。

该反例使用的是合成输入和实际工具函数。它确认的是工具会丢诊断的代码缺陷，
**并未确认原生 Mac profile 真存在 invalid IP address，更没有定位历史产品原因。**

#### R2：测试自身依赖 cwd，首轮没有满足其隐含仓库根目录假设

首轮本人刻意在 `K:/AI/person/money/.tmp` 中，以绝对路径启动测试文件。
这不是已经证明受该测试支持的 cwd；它没有满足第 777 行的隐含“从仓库根目录
解析子入口”假设。因此 57/58 不能用于否定 Sol 在其调用条件下的 58/58，
也不是被测 Mac 门禁本身失效。

但是，失败并非环境随机波动：代码明确使用相对于 process.cwd() 的
`path.resolve('tools/native-acceptance/evidence.mjs')`；
[README.md:173](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/README.md:173)
给出的 `node --test offline.test.mjs` 没有说明这个额外 cwd 约束，
package 的 check 脚本也使用测试文件相对路径。**这是测试入口定位与使用说明的
可移植性缺口，不是产品阻断原因；本轮核心 READY 阻断仍为 R1。**

最小优先修复是以本测试的 import.meta.url 解析相邻 evidence.mjs，再转为文件系统
路径传给 Node；不要改生产工作目录或要求把临时测试放回用户数据位置。
若维护者选择只支持仓库根目录，也必须明确完整命令与 cwd，并让脚本说明一致；
不能把它描述成任意目录可用。

本次第二轮 58/58 是在本人 K 盘独立目录补齐相对入口后得到，
**不是声称在真实仓库根目录执行过完整套件**。首轮 57/58、第二轮 58/58、
独立十项 9/10 三份结果继续分别保留。

**交回主任务：BLOCKED_PRECHECK。**最小修复写范围为 evidence.mjs、
offline.test.mjs、必要的 README 说明及重新生成的 freeze；不改产品、
profile、workflow 触发、安装包或 D0。修复后再由 Astra 复验，
当前不创建候选、不推 ref、不执行 T1。

## 2026-10-08 T1 限定修复独立二审：READY_FOR_CANDIDATE_AUDIT

**结论：READY_FOR_CANDIDATE_AUDIT。** 上一节的 R1 诊断事实丢失与 R2 测试入口依赖 cwd，
在本次限定代码集合和独立离线反例中已修复。本结论替代上一版工具代码的
BLOCKED_PRECHECK 状态，但不删除、改写或抹去其历史证据。
这不是 T1 原生执行通过、Mac 升级通过、Keychain 通过或产品放行；
不授权自动创建候选、推 ref、重试或执行产品。

### 本人亲自执行的测试与结果

执行运行时为 K 盘独立 Node 20.20.2。TEMP/TMP 均指向
`K:/AI/person/money/.tmp`，工作目录为新建的
`K:/AI/person/money/.tmp/astra-t1-second-20261008-a37d1c`。
本轮没有安装依赖、启动安装器、实际运行 Mac 系统命令、访问 Keychain、
修改系统隔离策略、调用券商、下载正式资产或联网触发 CI。

| 独立执行项目 | 结果 | 证据 |
| --- | --- | --- |
| 从全新 K 盘独立 cwd，以测试文件绝对路径运行现有离线套件 | 66 passed / 0 failed / 0 skipped；exit 0；11246.7171 ms | [offline.tap](K:/AI/person/money/.tmp/astra-t1-second-20261008-a37d1c/offline.tap) |
| 本人独立反例集：前轮十项反例重放，加五项饱和/信号/发布保真检查 | 15 passed / 0 failed / 0 skipped；exit 0；4854.3257 ms | [independent.tap](K:/AI/person/money/.tmp/astra-t1-second-20261008-a37d1c/independent.tap) |
| 独立反例代码及本轮输入快照 | 仅存在本人 K 盘临时目录；不进入候选或冻结集合 | [independent.test.mjs](K:/AI/person/money/.tmp/astra-t1-second-20261008-a37d1c/independent.test.mjs)、[captured-inputs.json](K:/AI/person/money/.tmp/astra-t1-second-20261008-a37d1c/captured-inputs.json) |

以上两组数量分别记录，不混为一次原生验收，也不并入此前的 54 项或其他历史计数。
Sol 报告的 66/66 只作为开发期背景；表中两组均由本人独立执行。
本轮测试首次执行即通过，没有修改实现、修改断言后重跑，或通过补放相对入口
使结果变绿。上一轮 57/58、补相对入口后的 58/58、独立反例 9/10 均继续保留。

### 实质复验发现

1. **R1 已在本范围关闭：后续超时不再覆盖已分类事实。**
   [evidence.mjs:305](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:305)
   对 timeout/spawn-control failure 只在不足四条时追加安全控制分类；
   四条已满时保留全部原记录，并强制 `outputComplete=false`。
   本人重放原始失败序列：合成的合法 SBPL 地址诊断、实际工具监听到的合成
   `exit=65`、不触发 close，随后截止时间到达。结果同时保留
   `SBPL_ADDRESS_ERROR` 与 `TOOL_TIMEOUT`，`exitCode=65`、
   `signal=null`、`closeObserved=false`，结论仍为 BLOCKED。
   该子进程已观察到 exit，因此没有再调用 kill；未伪造 SIGKILL。

2. **四条记录已满时，控制失败仍可见且不破坏事实。**
   独立测试分别注入 timeout 和 spawn-error，两者均逐字段保留四条原 SBPL 记录
   及列号 1、2、3、4，不用第五条控制记录挤掉第四条。
   timeout 仍由 `NATIVE_COMMAND_TIMEOUT` 与 `timeout=true` 体现；
   spawn-error 仍由 `NATIVE_COMMAND_UNAVAILABLE` 体现；
   两种情形均 `outputComplete=false`、`closeObserved=false`、BLOCKED。
   另注入已观察到的合成 `exit(null, SIGTERM)` 后管道未关闭：
   输出保留 `exitCode=null` 与 `signal=SIGTERM`，没有改成 65 或 SIGKILL。
   此处均为确定性事件注入，不是本机实际 Mac 进程或真实信号实验。

3. **发布链字段保真及主次因关系已独立覆盖。**
   两项追加反例执行实际 `runT1 -> cleanupT1 -> publishEvidence`，
   使用所审 evidence 源码在独立 VM 内转译，系统文件/进程事件为受控合成输入，
   原生 spawn 不会执行。清理日志和四份 JSON 的落盘、扫描、合并与复制使用实际代码，
   写入范围被限制在本人临时子目录。
   无前置主因时，最终主因为 `NATIVE_COMMAND_TIMEOUT`；
   预置合成 `EARLIER_TOOL_CHECK_FAILURE` 时，该主因不变，
   timeout 与 `T1_OWNED_PROCESS_EXIT_UNCONFIRMED` 均保留为 secondary。
   两份最终结果都仍有四条原 SBPL 记录、exit 65、signal null、
   timeout true、outputComplete false、closeObserved false，
   `complete=false`、`status=BLOCKED_ENVIRONMENT`。
   代码依据为 [evidence.mjs:96](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:96)、
   [evidence.mjs:147](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:147)、
   [evidence.mjs:999](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:999)。
   控制超时没有覆盖已知编译诊断，也未被转写为产品错误。

4. **清理、隐私及验收边界没有因本修复放宽。**
   上述发布反例仅有一次 synthetic spawn；第二次调用实际 T1 入口被
   exclusive marker 拒绝，没有新增 spawn。实际清理 journal 保留一次调用与资源操作；
   缺 close 时 `cleanupSucceeded=null`、`cleanup=false`，
   不因已看到 exit 就声称资源收尾已完整。
   最终目录恰为四份白名单 JSON，没有 profile、wrapper、原始 stderr、环境或密钥；
   扫描禁止 owned 绝对路径和合成敏感标识。安装事件及 installers 为空，
   网络 `inherited=false`、`probeComplete=false`，
   不把 system true 当网络隔离或产品运行证据。
   原离线套件的 collector 拒绝 T1 冒充原生验收用例也通过。
   同时重放首次事件落盘失败阻止 spawn、stdout 超限与 kill 失败保持有界、
   含额外敏感文本不误分类、早期清理未知不被后续成功抹掉等既有反例。

5. **R2 已在本范围关闭：不再隐含仓库根目录 cwd。**
   [offline.test.mjs:778](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/offline.test.mjs:778)
   通过 `fileURLToPath(new URL('./evidence.mjs', import.meta.url))` 定位相邻子入口。
   本轮 66 项确实从全新的独立目录启动，没有仓库相对路径辅助副本。
   因而本轮结果能够覆盖此前 cwd 缺口；不追溯改写上一轮失败的调用事实。

### 独立冻结结果

本轮重新读取三份被修复文件的原始字节，其余十五份 payload 的人工审阅沿用此前
已读快照，不重新审计产品。独立反例对完整捕获集合按 UTF-8 往返字节计算 SHA256、
核对尺寸、排序与组合摘要；实际 T1 入口反例还运行了未替换的
`requireFrozenExecution`，对当前本地十七份 payload 与清单重新进行字节门禁。
因此不仅是照抄 Sol 给出的摘要。

组合定义：按相对路径排序，将每项投影为
`{path,size,sha256}`，对 `JSON.stringify(rows)` 的 UTF-8 字节计算 SHA256。
不纳入本报告、独立探针、冻结清单自身、D0 或产品修改。

**17 payload combined SHA256**
`1867bccb52d4e3814013099fc02c8b27b17d20cfc23d88cd97fb2a8f9d5dcd1e`

**清单自身独立 SHA256**
`93b2bd7e04e23e80baacd3a68678935c09ad69e60f5320d31662b910e639853f`
（`tools/native-acceptance/fixtures/harness-freeze.json`，3169 bytes。）

| 相对路径 | 原始字节数 | SHA256 |
| --- | ---: | --- |
| `.github/scripts/fetch-upgrade-installers.cjs` | 10080 | `8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06` |
| `.github/workflows/mac-launcher-diagnostic.yml` | 3613 | `be2b35a7fc92819d38705eb15cf24004fa07ea4e97403a853da06ef25ebe4332` |
| `.github/workflows/native-upgrade-acceptance.yml` | 5248 | `e18567eff0ea04838b698a44e938b2306ba6343955d95157f389667ddfcb4b0a` |
| `tests/fixtures/releases/native-upgrade-1.0-1.1.json` | 1808 | `b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f` |
| `tools/native-acceptance/README.md` | 17313 | `a66ad6eb1e41e65699e684a3e2630bd45039a57c7c8d730c71042bfc1f9cf682` |
| `tools/native-acceptance/evidence.mjs` | 81054 | `ffac22cc994ce13e06d723033c9660050b0a494bffb69c87304fb7c0f4918018` |
| `tools/native-acceptance/fixtures/version-contract.json` | 2457 | `b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7` |
| `tools/native-acceptance/harness.ts` | 34490 | `63879080a2b7d942af9ac98101ebfa18a1f758f9dd27cbf967e5582e28a19350` |
| `tools/native-acceptance/native-upgrade.spec.ts` | 689 | `e3b29698b5a2143c9792d8c50b78a71182ebe08df30f2ff66654ebcd5d873581` |
| `tools/native-acceptance/offline.test.mjs` | 86132 | `6e5088f3dbfe9f9443da59b8f818a1e6fbefbf3fad23787a5ddf619ef3af8818` |
| `tools/native-acceptance/package.json` | 319 | `ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298` |
| `tools/native-acceptance/platform/macos.mjs` | 12065 | `c2a1fa2f730a5ff47a6377a1eb6b68e414cf9d8e5e46f921c27a37c282122479` |
| `tools/native-acceptance/platform/macos.sh` | 155 | `f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c` |
| `tools/native-acceptance/platform/windows.ps1` | 11982 | `fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778` |
| `tools/native-acceptance/playwright.config.ts` | 504 | `7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81` |
| `tools/native-acceptance/pnpm-lock.yaml` | 1317 | `7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d` |
| `tools/native-acceptance/snapshot.cjs` | 4955 | `671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945` |

三份更新文件为 evidence.mjs、offline.test.mjs、harness-freeze.json。
原 profile SHA256 仍为
`f7dfa3333acc36436a1dcb4ad350a8823f403439c7c49622ede267dd49f89e0a`；
T1 workflow SHA256 仍为
`be2b35a7fc92819d38705eb15cf24004fa07ea4e97403a853da06ef25ebe4332`。
没有为了反例通过而调整 profile、放松隔离或修改原包。

### 后续唯一允许推进的范围与残余风险

- 本签署只允许主任务进入**候选对象审计准备阶段**；本轮本人未创建候选、更新 ref、
  push、触发 CI、重打包或修改 tag/release/assets。
- 在任何一次受控 T1 触发前，仍须对候选 commit 的上述 17 payload 加清单自身共
  18 文件逐一做远端原始 blob/base64 字节比对，绑定同一个 commit；
  本地 VM 的冻结收据不等同于远端候选身份审计。
- 仍须审核候选和 default 分支全部 workflow 触发过滤、开放 PR 关联及 indirect 触发，
  确认固定诊断分支不会顺带运行 native-upgrade、产品构建或其他副作用工作流；
  再按 H 契约完成 expected-old lease 与一次性人工触发授权。
  单 run marker 不代表跨 run 自动重试许可。
- 本人复核过的 T1 workflow 仅固定分支 push，两架构各一次 system true；
  native-upgrade 的 push 分支仍为另一固定分支。但本轮未做远端 workflow/PR 状态检查，
  不能据本地文件宣称整个远端触发链已获批准。
- **真实 SBPL 编译是否失败、历史 exit 65 的真实根因、两个 Mac 架构原生 T1、
  原包启动、A/B/C/D 跨版数据保留及真实 Keychain 重启解密均未在本轮验证。**
  合成的 SBPL_ADDRESS_ERROR 仅用来证明诊断保留行为，不能当成已确认的原生编译错误。
- Windows D0 与产品验收状态不因本轮工具修复改变；本轮没有读取、修改、启动或签署 D0。

**本次交付：READY_FOR_CANDIDATE_AUDIT；不是 READY_TO_RUN、不是 NATIVE PASS。**

## 2026-10-08 T1 候选触发链审查：条件式 T1_READY_TO_RUN

本节仅审查候选触发链，不重新审计产品，不执行 CI。
基于主任务提供的 [审计快照](K:/AI/person/money/.tmp/rt-mac-t1-trigger-audit-20pGmc/audit.json)，
**未发现需要修改候选源码或 workflow 的触发链阻断项。**
在下述临门无漂移检查完成后，可按 H 契约执行一次 T1-only 原子 ref 创建；
不是产品 native acceptance 授权。

### 绑定的候选与取证边界

- repository：`hzqedison/RT-ResearchFlow`。
- candidate：`e6e1339e0ac75fd62567fde884b4772abd8d5243`。
- tree：`046417170817528b0f79ced40c039254bb0dce47`。
- parent：`89e80fb07b1a1dcf1e71218ad50ef0a7f3698046`。
- 唯一 ref：`refs/heads/codex/diagnose-mac-launcher-1.0`；快照中不存在。
- default：`main`，head `ba24a131f750016c8dd08ac77a18357be84988a9`。
- 快照时间：`2026-10-08T07:35:56.533Z`；open PR 为零；该分支 priorRunCount 为零。
- audit.json 原始文件 SHA256：`7b7fb2b165adee6eb0eaff45891ac9f12ff088a496d26726edd3e93adac4e9ce`。

主任务提供了候选 18 文件的远端 contents API base64 原字节逐项一致结论；
本人本轮没有重复联网回读这 18 份文件或实时查询远端状态。
本人直接解析快照中 7 份候选、2 份 default workflow 的完整 YAML，
重新提取 on、permissions、job-level uses、step uses 与触发/写操作调用关系。
9 份原文重新计算的 Git blob SHA1 均匹配快照所载 SHA，
解析出的 on 均匹配其摘要。
这确认的是快照内部内容一致性，不独自证明远端目录枚举完整性或此刻仍无漂移；
完整枚举及远端身份依据主任务的已完成取证。

T1 workflow SHA256 为 `be2b35a7fc92819d38705eb15cf24004fa07ea4e97403a853da06ef25ebe4332`，
native-upgrade workflow 为 `e18567eff0ea04838b698a44e938b2306ba6343955d95157f389667ddfcb4b0a`，
均与本人上一轮冻结一致。候选仍绑定 17 payload 组合
`1867bccb52d4e3814013099fc02c8b27b17d20cfc23d88cd97fb2a8f9d5dcd1e`
及清单自身
`93b2bd7e04e23e80baacd3a68678935c09ad69e60f5320d31662b910e639853f`。

### 实际触发链结论

| 候选入口 | 触发条件 | 对本次唯一 ref 操作的判断 |
| --- | --- | --- |
| mac-launcher-diagnostic.yml | push 精确诊断分支 | 唯一匹配；contents:read；无 reusable workflow 调用、dispatch 或 ref/release 写步骤 |
| native-upgrade-acceptance.yml | push 精确 acceptance 分支；dispatch | 不匹配；不会由该 push 启动产品 A/B/C/D |
| macos.yml | push main/mac-support；PR base main；dispatch | push 不匹配；须继续排除诊断 head 的未关闭 PR |
| verify.yml | push main；PR base main；dispatch | 同上 |
| release.yml | push release-1.1 分支或 v* tag；dispatch | 诊断 branch 不匹配；本次不推 tag |
| windows-build.yml | push mac-support；dispatch | 不匹配 |
| macos-upstream.yml | schedule；dispatch | 不因该 ref 操作触发；其中显式 dispatch 不可从 T1 到达 |

default 的两份入口分别为 release 的 v* tag push，以及 verify 的 main push/PR/dispatch。
快照中的候选/default 均无 create、workflow_run、pull_request_target、
check_run、check_suite、status 或 repository_dispatch 入口；未发现 T1 的间接工作流调用。
D0 workflow 在本候选中不存在，不是遗漏进入本次 T1 的执行器。

verify 与 windows-build 的候选原文 SHA256 不同于 H 节早期本地工作树清单；
本人按本次候选原文重新解析了其入口，不沿用旧摘要假设。当前过滤仍不匹配诊断分支。
不需要为追齐早期本地清单而将 D0 或其他本地修改加入候选。

### 最后操作前必须保留的条件

1. 再确认 ref **仍不存在**、该 head 的 open PR 仍为零、default 分支名称及 head
   仍与上列快照一致；同时确认诊断分支没有新增历史 run。
   任一项变化均停止并补审，不把旧快照当实时 lease。
2. 创建操作必须具有“目标 ref 已存在即冲突失败”的原子语义，
   且直接绑定上述 candidate SHA。不能把 helper 默认从 main 创建分支、
   先创建到 parent 再推进，或 GET 后无条件覆盖称为一次受控创建。
3. 仅一次成功创建，不同时修改任何其他 ref/tag；结果未知时只读核对，
   不能重发创建、删除重建、补 commit、dispatch 或 rerun。
   没出现 run 也按 H 契约登记阻塞，不补触发。
4. 后续登记真实 run_id / attempt=1 / head_sha / event=push / workflow path，
   将本次授权标记已消费，仅将该 handle 交 Astra。
   marker 不提供跨 run 的重复授权。

上述是基于审计快照的 **条件式 T1_READY_TO_RUN**，无新增源码修复要求。
本轮本人没有创建候选、更新 ref、触发 CI、运行系统 true 或产品。
实际 Mac 编译/启动原因、产品跨版升级、Keychain 和 Windows 的结论均保持原状态。

## 2026-10-08 原生 T1 最终证据审查：run 37744985585 / attempt 1 / BLOCKED

**签署结论：BLOCKED。** ARM 与 Intel 的单次 T1 launcher 均退出 65，
仅能得到 `UNCLASSIFIED_TOOL_EXIT`；不能确认具体 SBPL、shell、sandbox_apply
或目标 exec 原因。证据身份、原字节、单次启动及限定清理记录核对通过，
不等同于 T1 工具链通过，更不是产品跨版升级、Keychain 或交易验收通过。

本轮一次性触发授权已由主任务使用并绑定下列唯一 handle；已消费。
本人没有创建/更新 ref、dispatch、rerun、触发 D0、修改 profile、启动产品或重打包。

### 1. 本人独立取得的终态与工作流步骤

[唯一 run](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37744985585)
的 GitHub API 返回 `completed / failure`，`run_attempt=1`，
创建于 `2026-10-08T07:41:22Z`，最后更新于 `2026-10-08T07:42:21Z`。
本轮第一次权威查询时已经终态，因此没有额外等待或反复轮询。

- source：`e6e1339e0ac75fd62567fde884b4772abd8d5243`。
- tree：`046417170817528b0f79ced40c039254bb0dce47`。
- event：`push`；branch：`codex/diagnose-mac-launcher-1.0`。
- workflow：`.github/workflows/mac-launcher-diagnostic.yml`；
  API 的 referenced_workflows 与 pull_requests 为空。
- 三个实际 job：prepare `113204218302` success；
  ARM `113204300221` failure；Intel `113204300234` failure。
- 两架构均为第 6 步 T1 失败，第 5 步冻结校验及第 7/8/9 步清理记录、
  四 JSON staging、上传均 success。各一次 setup-node post 步骤 skipped，
  不表示跳过原生探针，也不能冒充跳过测试后全通过。
- 两个 runner 日志均记录 macOS `15.7.9 / 24G830`、Node `v20.20.2`；
  ARM image `macos-15-arm64 / 20260907.0337.1`，
  Intel image `macos-15 / 20260824.0482.1`。

本轮通过既有 GitHub 只读工具亲自获取 run、三个 job 的步骤与日志、
artifact 元数据及 ZIP；没有借用 Sol 的最终结论代签。
日志中的 `Frozen input contract: 1.0.0 -> 1.1.0` 只是共用静态清单校验文案，
**不是本次下载、安装或执行了两个产品版本**。

### 2. ZIP 原始字节与四 JSON 身份

本人下载的两份 ZIP 都小于 5 KB，存于 K 盘独立取证目录。
各自实际长度与 SHA256 同时匹配 API 的 size/digest 和本次上传 job 的 SHA256 日志。
ZIP 中各有且只有四个白名单文件名；拒绝额外路径/重复名称，并有解压尺寸上限，
没有执行归档内任何内容。

| 架构 | Artifact ID | ZIP bytes | 实测 ZIP SHA256 |
| --- | --- | ---: | --- |
| ARM64 | 11534519165 | 4602 | `420c1b27d8560282ef285ae44e100b678c054f8d30dd1ef1a65d9bb91809c226` |
| Intel x64 | 11535581288 | 4607 | `8cf9ca17a650e554bbdf300ba8b9ecc2237e5cd057fb22429f387dabe57fe18d` |

| 架构 | 文件 | 原始 bytes | 实测 SHA256 |
| --- | --- | ---: | --- |
| arm64 | `input-manifest.json` | 4279 | `76620f4a7df093d7dab141f9fcb9dd1dc6e65807bb8acb4bc13e5ab9d569f2be` |
| arm64 | `network-isolation.json` | 1029 | `6a6727a2abc9c30fe5c0fb990d5f5ce781fa3a56ec26a9e3d0f53e8ee761c37f` |
| arm64 | `installer-events.json` | 374 | `00767c0d1df991d2b198e65e79602dabb33ef0d38cffd59e6908fad663e05ce4` |
| arm64 | `acceptance-result.json` | 8653 | `fa525b16e3f9f6b2ed2426af8d35633edad118327dc74c6d1154e61f3dec1744` |
| x64 | `input-manifest.json` | 4277 | `fc689b1ff02e643da829da7b786ce49fffd522d0a0039531a5a2d0bbb519b850` |
| x64 | `acceptance-result.json` | 8651 | `f510121a2c1cac85a45cb33f2010005731c14453dad7b2bd1a9afc35ea6de178` |
| x64 | `network-isolation.json` | 1027 | `b76571055e53c01f78c8aeb7ca279beb83658ebf9778905e43230c5cb077bdf4` |
| x64 | `installer-events.json` | 372 | `d2adfc3308fde8ecb515651c5a47b0f6c7d69ed024b6820d317c68d127c396c1` |

八份 JSON 的 runId/attempt/source/platform/arch/mode/caseId 均核对一致，
全部通过实际 `scanEvidence` 白名单检查。
ARM caseId 为 `0eaff908-46a9-41a3-88b7-d87a2d4e2f95`，
Intel 为 `da213397-72f5-45fa-bfab-329b2818f4f0`，两架构没有串用 case。

两份 input-manifest 中的 17 项 `path,size,sha256` 与本人冻结清单逐项相同；
排序 JSON 组合摘要重新计算为
`1867bccb52d4e3814013099fc02c8b27b17d20cfc23d88cd97fb2a8f9d5dcd1e`。
清单自身均为
`93b2bd7e04e23e80baacd3a68678935c09ad69e60f5320d31662b910e639853f`。
云端两个 job 的原始字节/同 commit blob 校验步骤已成功，
本轮不再另行下载重复的全部源码。

原 profile SHA256 两架构均为
`f7dfa3333acc36436a1dcb4ad350a8823f403439c7c49622ede267dd49f89e0a`，
共享 wrapper template SHA256 均为
`b26f10979db304377da163929fe2683437f946e351a080ddca0f879521bc93f0`。
本人使用各自 job 日志中的唯一 owned root，在内存按已审模板重新构造
system-true wrapper 并计算哈希，分别与 artifact 一致：
ARM `b6e8b96721771be639fb2900b190ce0841fbc60c17efa48820f566ef3bc62297`；
Intel `79391b84618bc9ff8e388225a89b07a0d5b42c68b671571b694b88d9c54443ab`。
两者不同是隔离根路径不同，不是模板或目标变化。报告不复制 runner 绝对路径。

### 3. 已证事实：一次目标为 system true 的 launcher 启动，不是 true 执行成功

| 字段 | ARM64 | Intel x64 |
| --- | --- | --- |
| launcher PID | 2771 | 1354 |
| spawn-requested | 07:41:57.776Z，1 次 | 07:42:12.545Z，1 次 |
| spawn-observed | 07:41:57.781Z，1 次 | 07:42:12.558Z，1 次 |
| exit-observed | 07:41:57.790Z，65 / null signal | 07:42:12.574Z，65 / null signal |
| close-observed | 07:41:57.794Z，65 / null signal | 07:42:12.582Z，65 / null signal |
| timeout / bufferTruncated | false / false | false / false |
| stdoutBytes / stderrBytes | 0 / 172 | 0 / 172 |
| outputComplete | false | false |
| classification / producerRole | UNCLASSIFIED_TOOL_EXIT / unknown | UNCLASSIFIED_TOOL_EXIT / unknown |
| diagnosticStatus | BLOCKED | BLOCKED |

各 job 日志只有一次 `t1-run` 步骤；每份记录恰为 request/spawn/exit/close 四个事件，
同一架构后三个事件 PID 一致，无第二次 spawn、无 kill 尝试、无重试或 timeout。
冻结代码的 exclusive marker 先于 launcher spawn；
wrapper 精确目标为 `/usr/bin/true`、传给 wrapper 的参数为空。
来源为 [macos.mjs:9](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/platform/macos.mjs:9)、
[macos.mjs:15](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/platform/macos.mjs:15)、
[evidence.mjs:949](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:949)、
[evidence.mjs:995](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:995)。
行号对应本轮已冻结源码知识，不代表已对未来 canonical 修改重审。

**边界：PID 和 65 属于 launcher-process 角色，不能说是原产品 PID/退出码，
也不能据此断言 /usr/bin/true 已被实际 exec 或已运行一次。**
本轮只能确认“单次、以 system true 为目标的同 profile/wrapper 链”失败，
且这一非零退出不需要产品进程参与。
不能据相同退出码把此前两次产品验收失败的根因直接追认为本次原因。

### 4. 清理来源与证据持久化

ARM 的清理 caller PID 为 2773，attemptId
`21253548-eea5-4563-bc94-46f7d0ec9d38`；
Intel caller PID 为 1356，attemptId
`cd98d6c7-5a6b-4146-a89c-09563d78246c`。
均为独立的 `workflow-cleanup` 入口，不是 launcher PID。

每个 journal 有且只有一次实际 caller 入口，sequence 0..6 完整：
caller-entered、owned-process-cleanup succeeded、
mount-detach not-needed、三项 Keychain not-needed、caller-observed-result。
clear/close 已发生在清理入口前，callerReceipt 为 true；
helperReceipt 为 null 是因为 T1 没有调用资源清理 helper，
**不是把未执行的 helper 说成成功**。
来源为 [evidence.mjs:1014](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:1014)。

最终 acceptance 与 network 的 cleanup attemptId/history 对应同一调用；
`cleanup=true` 仅指 T1 已观察到 owned launcher close 和本次无需处理其他资源。
network 的 `disabledAt` 来自通用 cleanup 投影，不是一次真实网络策略撤销证明。
`controls=[]`、`inherited=false`、`descendantsCovered=false`、
`probeComplete=false` 均保留。未测试产品进程树清理、网络继承或真实 Keychain 清理。

两架构均保留了输入冻结、材料哈希、三个系统工具的只读检查、
部分进程事实、全部本次 cleanup 调用及四 JSON。
这说明本次实际 T1 没有再次出现早期证据整体丢失。
但它只有一个 workflow-cleanup 入口，不能以此代签历史产品验收中的
test-finally + workflow-cleanup 双入口场景已原生验证。

### 5. 尚不能确认的原因与最小下一步设计

**确定存在的是诊断分辨率缺口，不是已证实的产品或 SBPL 缺陷。**
两份工具 stderr 均为 172 bytes，未截断、未超时、close 已观察到，
但原文按隐私契约没有进入日志/归档。各 job 日志也未出现原始
`sandbox-exec:` 诊断文本。不能从 byte 数或 exit 65 还原原文。

当前 [evidence.mjs:384](K:/AI/person/money/RT-ResearchFlow/tools/native-acceptance/evidence.mjs:384)
的 classifier 将 UTF-8/字符限制、行数/空行限制、未匹配格式、位置范围、
混合分类等不同情况统一投影为同一个 unknown。
因此本次 `outputComplete=false` **不表示必然缺少 close 或发生截断**，
也不能指定为某一种 SBPL 编译错误、Intel EPERM、Gatekeeper 或安全策略拒绝。
上层 diagnostics 为空，是本次未抛出异常而将非零子进程结果投影进 toolDiagnostic；
不应为凑错误文本而发明 exception、errno 或主因。

最小后续方案仅为诊断设计，**本报告不授权执行**：

1. 不动 profile、wrapper 参数（包括 `--`）、system-true 目标、deadline、
   隔离边界或产品代码。先为 unknown 路径添加有限枚举的 rejection reason，
   例如 UTF8_INVALID、DISALLOWED_CHARACTER、TOO_MANY_LINES、EMPTY_LINE、
   LINE_TOO_LONG、POSITION_OUT_OF_RANGE、UNMATCHED_FORMAT、MIXED_CLASSES。
   原有 exit/signal、records、timeout、outputComplete 不得被新信息覆盖。
2. 可增加有上限的 lineCount/lineBytes、CR/LF/control 字符标志、
   exact-profile-prefix/exact-wrapper-prefix 命中布尔值，以及仅在锚定格式匹配时
   提取的有限范围行列号。前缀/格式必须是固定枚举，
   未知后缀保持 unknown；不能上传任意 substring、原始 stderr、
   profile 文本、绝对路径、环境、命令行或密钥，也不添加可逆“编码原文”。
3. 通过离线反例证明这些格式标签不会把“含有某个 token”当成原因：
   CRLF、多行前言、未知尾部、控制字符、敏感路径/fixture、
   超长/畸形 UTF-8，以及已分类事实后发生超时等情况都应 fail-closed，
   并保留已确认事实。没有同版本可信格式依据，不猜诊断正则并宣布根因。
4. 如主任务以后选择实现此诊断补充，最小评审边界为
   `evidence.mjs`、`offline.test.mjs`、必要的 README 与重新生成的 freeze；
   本轮不改实现。须重新 Astra 预检、候选原字节审计，并取得独立的新执行授权，
   不能使用已经消费的本 run 授权自动再跑，也不能跳转产品或 D0。

### 6. 本轮独立核验与留存

本人实际执行的是：只读获取本 run 的原生证据、ZIP 原字节哈希核对、
逐项 JSON/日志/冻结/模板/事件/cleanup 的确定性离线断言。
[独立证据核验脚本](K:/AI/person/money/.tmp/astra-T1-native-37744985585-ES0cpw/audit-existing-evidence.mjs)
实际 exit 0；
[本次核验摘要](K:/AI/person/money/.tmp/astra-T1-native-37744985585-ES0cpw/audit-summary.json)
记录两架构 `metadataAndEvidenceAudit=PASS` 和 `nativeT1Result=BLOCKED`，
二者不可合并为原生通过。

本次没有重新运行上轮 66+15 离线套件，没有新增任何原生启动，
也不把读取云端测试结果算作本人又执行了一轮原生测试。
原生执行来自本次已授权且唯一的 GitHub-hosted run，本人独立控制取证与签署。

原始 ZIP：
[ARM artifact.zip](K:/AI/person/money/.tmp/astra-T1-native-37744985585-ES0cpw/arm64/artifact.zip)、
[Intel artifact.zip](K:/AI/person/money/.tmp/astra-T1-native-37744985585-ES0cpw/x64/artifact.zip)。
原始结果：
[ARM acceptance-result.json](K:/AI/person/money/.tmp/astra-T1-native-37744985585-ES0cpw/arm64/acceptance-result.json)、
[Intel acceptance-result.json](K:/AI/person/money/.tmp/astra-T1-native-37744985585-ES0cpw/x64/acceptance-result.json)。

**本轮结束：BLOCKED，原因未充分分类；证据边界合格。**
保留所有历史失败与本次真实结果。不重跑、不触发 D0、不改 profile、
不接续产品；正式 1.1 tag/assets 及原产品验收结论不变。

## 2026-10-08 下一步单次高分辨率取证设计：DESIGN_ONLY，不授权新 run

本节收敛上一节的建议，不修改已审实现、不运行测试、不联网补取资料、
不新增工作流或触发任何原生操作。诊断与正常竞价修复保持原优先级；
本设计不把产品、交易或其他平台任务纳入诊断范围。

**目标不是再增加一个 UNSUPPORTED_FORMAT 标签，而是在同一次有界 stderr
接收中，同时收齐传输状态、白名单格式骨架、固定材料位置和规则拒绝原因，
使一次取证可以区分具体失败层与观测器自身不兼容。**

已知基线仍是 run 37744985585：两架构各一次 launcher，exit 65、signal null、
close 已观察到、stderr 172 bytes、未分类。这些字节没有进入现有证据，
本设计不能还原它们，也不把合成格式当作已经观测到的原生文本。
在禁止输出任意 stderr 的前提下，不能诚实保证任意未知格式一次就能定根因；
下述设计要求一次尽量收齐互补信息，并定义何时定位充分、何时必须停止。

### I1. 一次接收，三个独立投影；不靠循环重试增加信息

只使用现有那一次 launcher 的 stderr 内存缓冲，不再调用一次 true、
sandbox-exec --help、产品、Keychain、账户、额外诊断命令或跟踪器。
profile、wrapper（包括现有参数）、空业务参数、环境白名单与 deadline 全部不变。

同一输入同时生成以下三层信息，不因其中一层不认识格式而清空其他层：

1. **接收事实层**：保留原 exit/signal/close/timeout/byte counts/truncation。
   区分管道接收完成、UTF-8 可解码、语义分类完成三个概念；
   不再让一个 outputComplete=false 被误读为“必定缺少 close”。
   既有字段及主次因语义不改，新增信息只作旁证。
2. **白名单结构层**：以固定原文词典、精确 owned 路径、固定六行 profile、
   少量标点语法和有界位置数字识别 line-shape。
   输出枚举/引用/布尔值，不输出“清洗后的原始字符串”。
3. **识别失败层**：指出哪个规则、哪一个结构槽位不匹配；
   例如前缀已识别、位置已识别，但 MESSAGE 或 SUFFIX 未识别。
   不能只给一个 UNSUPPORTED_FORMAT，也不能把“不认识”自动解释为产品问题。

识别不以全局 substring 搜索或宽泛正则代替。即使后续行未知，
已确认的固定行号、完整固定短语等事实仍保留；但存在冲突或未知尾部时，
不得把部分匹配升级为完整因果判断。

### I2. 最小新增字段合同

建议只在现有 toolDiagnostic 中增加一个版本化 formatEvidence 对象。
它仍随原四 JSON 发布，不新增原始 stderr 附件或第五份产物；
existing input-manifest 的 profile/template/freeze 身份继续绑定其解释。

| 最小字段组 | 内容与上限 | 用途 |
| --- | --- | --- |
| schemaVersion | 固定 1；词典与规则属于冻结代码 | 使行骨架与解析器版本可追溯 |
| capture | 接收 CLOSED / INCOMPLETE；UTF8_VALID / INVALID；LF / CRLF / CR / MIXED / NONE；至多 8 行及 overflow 标志 | 将传输问题与格式问题分开；保留原始总字节数，不归一化原始计数 |
| rejectRules | 固定规则 ID 集合，最多 8 项；不得含错误文本 | 可同时看到编码、字符、行数、语法、位置、混合分类等拒绝原因 |
| lines[].index、grammarId、shape | 最多 8 行；index 有界；grammarId 为固定 ID 或 NONE；shape 每行最多 24 个类型/固定词典 ID | 呈现错误的顺序结构和具体未匹配槽位，不上传任意字符序列 |
| lines[].site、echoRow、caret | 精确 profile 定位锚下的第 1..6 行、该固定行长以内或行末后一位的列；其他只记 ABSENT / OUT_OF_RANGE / EOF_CANDIDATE；echoRow 为固定 R1..R6；caret 仅与已确认 echoRow 关联 | 能区分“报告定位在哪一行”和“源行/指示符相互是否一致” |
| lines[].phraseIds、profileTokenIds | 最多 4 个固定短语 ID、8 个固定 profile token ID；只在规定语法槽位或完整固定源行中匹配 | 以引用表示已知错误短语和具体固定参数，不暴露任意变量名 |
| lines[].unmatchedSlots | PREFIX / LOCATION / MESSAGE / TOKEN / SUFFIX / LINE 等枚举；最多 6 项 | 让下一位实现者知道缺的是什么；未知 span 不回传内容、字符数串或 hash |

继续使用原 8192-byte 接收上限、原命令/收尾时间界限、原最多四条已分类 records；
结构旁证最多八行，不挤占或覆盖这四条事实。
超过任一结构上限必须明确 overflow/INCOMPLETE，不得静默裁剪后声称完整。
输出总量另有小型固定上限（建议 8 KiB）；若超过，只缩减结构旁证并保留已知主因、
退出事实和 overflow，不使清理证据或原始 records 丢失。

rejectRules 至少能区别：
INVALID_UTF8、DISALLOWED_CONTROL、UNSUPPORTED_CHARACTER、
TOO_MANY_LINES、EMPTY_LINE、LINE_TOO_LONG、PREFIX_MISMATCH、
LOCATION_GRAMMAR_MISMATCH、POSITION_OUT_OF_RANGE、MESSAGE_MISMATCH、
TOKEN_NOT_ALLOWED、TRAILING_UNMATCHED、MIXED_CLASSIFICATIONS。
记录具体规则 ID 和有限槽位，不生成自由文本解释。

CRLF 可以在**结构投影层**作为一个换行边界处理，
但要保留 CRLF 标志和旧分类器拒绝规则；
不能悄悄改实际 stderr、profile 字节或现有 native 输入。
encoding 不合法时只出编码/接收事实，不进行替换解码后伪造匹配。

### I3. 路径占位、固定六行与 line-shape 的保密规则

**路径仅匹配本 case 内存中确切已知的值。**
只允许 PROFILE_PATH、WRAPPER_PATH、SYSTEM_TRUE_PATH 等固定占位 ID。
PROFILE_PATH 必须完整匹配实际传入的 owned profile 路径，并满足前后语法边界；
另一个目录里的同名 network.sb、路径后接 -old/额外字符、任意 /Users 路径
均不作等价匹配。不得仅按 basename 或通用路径正则替换后输出剩余原文。

对固定 profile 的六行只输出引用：

| 固定引用 | 可命中的公开固定内容类别 |
| --- | --- |
| R1 | version 声明 |
| R2 | allow default |
| R3 | deny network-outbound |
| R4 | IPv4 loopback wildcard 参数及该行固定操作符 |
| R5 | IPv6 loopback wildcard 参数及该行固定操作符 |
| R6 | unix-socket 参数及该行固定操作符 |

profileTokenIds 取自该六行的预先审核词典，例如 R4_IPV4_LOOPBACK、
R5_IPV6_LOOPBACK、R6_UNIX_SOCKET；这里是**原始字面量的引用**，不宣称其合法。
不把其它 IP、主机、用户名、任意引号内容或变量名上传。

token 命中仅允许两种来源：
完整匹配固定源行（可带事先列明的固定行号/缩进语法），
或已识别错误短语后、精确的有界 quoted-token / bare-token 槽位。
出现在任意未知消息、凭据中或路径子串中的同名字词不算 token 证据。
未知 quoted value 整体只标 TOKEN_NOT_ALLOWED，不逐字符保留词典片段。

**shape 是类型数组，不是脱敏字符串。**
例如可表达 TOOL_PREFIX、PROFILE_PATH、COLON、ROW、COLON、COLUMN、
ERROR_LABEL、KNOWN_PHRASE、QUOTE、PROFILE_TOKEN、QUOTE、END。
未知部分整体为 UNMATCHED_SLOT；不按字符生成字母/数字/标点掩码，
不保留任意标点串、原始 ASCII、Base64、十六进制、未知 span 长度序列或文本 hash。
这样避免所谓“格式信息”变成可还原敏感文本的旁路。

行列仅能来自精确 profile 定位语法，或与已确认固定源行相邻的 caret-only 语法。
source echo 只输出 R1..R6，不复制原文。
caret 行必须完整匹配受限空白加单个 caret/有限范围标记；
含其它字符则仅标不匹配。存在 tab 时标记 TAB_PRESENT，
未经明确列宽约定不得擅自换算展示列。
超出固定范围的数字不原样输出，只记 OUT_OF_RANGE；
空行、文件尾候选和行末后一列与真正位置冲突分开记录，
不能因 parser 不支持这些情况而丢掉所有定位信息。

### I4. 至少覆盖的诊断结构族与充分定位门槛

这些是下一实现的**候选语法与反例覆盖合同**，不是声称本次 172 bytes
属于某一种格式。最终接受的变体必须在静态材料/独立审查中逐项列明，
不能用 optional-anything 正则“吃掉”未审文本。

至少考虑：有/无 sandbox-exec 固定前缀；精确 profile 路径的行/列定位；
固定 error 标签；固定错误短语的冒号或引号分隔；
定位行后跟固定 source echo 和 caret 的多行形式；
固定 sandbox_apply 错误、execvp 错误、profile 读取错误、
shell wrapper 行号错误与固定 usage 行。
允许分别提取这些结构事实，但只有完整的经审语法才能给强分类。

| 同一次产物中的事实组合 | 足以支持什么 | 仍不能声称什么 |
| --- | --- | --- |
| 精确 profile 路径锚、有效 R4/R5/R6 位置、完整已知编译错误短语、相应固定 token；若有 echo/caret 则不冲突 | 定位至该 profile 位置及工具报告的具体错误类别；可制定针对该固定参数的修复评审 | 未经原生复验不能说修改已解决；不推导产品故障 |
| profile 定位与固定源行/caret 一致，但错误短语未知 | 已定位到具体材料/行列；剩余缺口是错误语义而非启动范围 | 不能把行上有 IP 字面量就称为 invalid IP |
| 完整经审 execvp/目标执行语法、固定目标槽位（如 TRUE 或原命令中的 ARG_SEPARATOR）、固定 errno 短语 | 工具报告的是哪个目标/参数及哪类执行错误；与静态 argv 契约对照后确定最小修复点 | 不能把 launcher PID 当 true 的已确认 exec 身份；不能把 kill 的 errno 混入 |
| 完整固定 sandbox_apply + EPERM/EACCES 语法 | 工具报告 sandbox 应用失败，而不是只知 exit 65 | 不归因到 Gatekeeper、账户权限或产品，除非另有证据 |
| usage/shell 固定语法，wrapper 行号/参数槽位明确 | 定位到 launcher 调用或 shell 解析边界；静态资料用于判定参数契约 | usage 本身不自动证明是哪一个参数错误 |
| CRLF/额外 error 标签/多行 source echo，结构可解析，但旧规则拒绝点明确 | 可定位为旧分类器格式覆盖不足，并保留能确认的原生错误事实 | 不把“分类器不认识”当原生成功 |
| 只有 65、未知前缀或任意未匹配文本 | 只能保留 launcher 非零退出及具体观测缺口 | 不猜 profile、wrapper、sandbox 或产品根因；不得自动下一轮 |

为避免仍然只有一个泛化 unknown，验收要求：
每条未分类信息至少具备其**结构锚是否存在、拒绝规则与未匹配槽位**；
若根本没有安全锚，明确 NO_SAFE_ANCHOR，不生成猜测的行号或 token。
有定位但无语义、有语义但位置冲突、完全无锚三种结果必须区分。
整体仍可 BLOCKED，但证据应足以指导静态分析或一次明确的人工授权决策，
而不是让代理盲目再试。

不同架构独立判断；相同长度、退出码或某个字段不能互相代填。
没有上述充分组合时，最终结论明确“剩余未知是什么”，停止取证，
不因希望单次定位而编造确定性。

### I5. 真运行前的最小验证反例

不要求本轮执行。后续独立预检至少覆盖下列行为，而不只测试枚举被写入：

| 反例组 | 必须得到的行为 |
| --- | --- |
| 路径定位 + optional 固定前缀/error 标签；冒号/引号变体；已审完整错误短语 | 输出相同的固定位置/短语事实并保留不同 shape；未审变体不能强分类 |
| 六行逐行 echo、匹配/冲突 caret、行末后一位、文件尾候选、tab 和超范围位置 | 能定位或明确 POSITION/LOCATION 冲突，不越界、不伪造列宽 |
| execvp 指向固定 true / 固定 -- 槽位；sandbox_apply；wrapper 行号 | 层级、目标与 errno 槽位不串用；没有对应语法不推断层级 |
| 已知短语后拼接私密路径/假 key/未知引号值；不同根同名文件；known token 嵌在 secret 中 | 私密内容不出现在 JSON、日志、异常或附件；部分命中不升级根因 |
| 两条输入只改变未知私密 span 的内容，安全骨架相同 | 除既有总 byte count 或明确的有界接收元数据外，公开结构投影一致；没有字符编码/未知值 hash 旁路 |
| CRLF、孤立 CR、ANSI/control、畸形 UTF-8、空行、多行 usage、超过八行/尺寸上限 | 各有明确 framing/rejection/overflow；不静默修复原字节，不将不完整判 PASS |
| 一行已识别、下一行未知/不同类别；四条 records 已满后 timeout 或 spawn error | 保留先前事实、真实 exit/signal 和主次因；结构旁证不挤占事实，不混成产品原因 |
| 从真实入口到 cleanup/publish 的合成四 JSON 流程，带前置主因、缺 close 和重复调用 | 新字段获白名单扫描；主因不覆盖；不完整清理仍 unknown；第二次 spawn 被拒；collector 不接受 T1 为产品验收 |

反例必须覆盖规则拒绝原因与最终发布字段，而非仅断言 hasKey、某个字段非空、
或者“打印过错误”。现有 66+15 历史结果不自动代表上述新增合同通过。

### I6. 静态 Apple 信息：需要窄核对，不需要扩成另一个研发项目

**建议在下一次真运行前完成一轮很小的静态契约核对，由代理处理，不要求用户处理。**
优先复用 A-G 设计阶段已经取得的公开材料；仅补以下缺口：

1. sandbox-exec 的 command/arguments 解析约定，尤其现有 `--` 的处理方式。
   无确切依据时不改参数，也不把 exit 65 当其被错误解释的证明。
2. profile 读取/编译、sandbox_apply、execvp、usage 的固定诊断前缀和格式；
   明确文本由 sandbox-exec 还是其调用的编译组件生成，
   不能假设所有错误都采用当前正则中的单行格式。
3. 若存在与本 runner 对应的 Apple 官方源码或手册，记录版本/来源与格式依据。
   若只找到较旧公开源码，标明与 macOS 15.7.9/24G830 的版本差距，
   仅用于候选语法及离线 fixture，不据此确认本次运行时文本。
   现有三个系统二进制 SHA 可作版本关联线索，不自动证明同版本源码可得。

本轮没有新增联网检索，故不宣称已补齐这些静态契约。
无需下载产品/系统大包、逆向任意二进制、关闭保护、
运行额外 help/trace 命令或大范围审计应用。
没有合适静态材料时，保留位置/形状事实和 unknown 语义，
不能为取得结论放宽文本白名单。

### I7. 实现与授权边界

最小实现边界仍是 evidence.mjs 的解析/投影及白名单字段、
offline.test.mjs 的行为反例、必要的 README 说明和重新生成 freeze。
不新增产品依赖、平台 helper、工作流、矩阵、下载器或额外原生命令；
不改业务、正常竞价实现、profile、wrapper、权限、隔离或已发布资产。
本节只追加设计文档，没有编写这些实现。

真运行前仍必须完成：Sol 有界实现；Astra 独立源码预检及离线反例；
重新冻结与远端候选原字节审计；触发链无漂移检查；
明确绑定新 source/ref/attempt 的**新一次授权**。
上一 run 的授权已经消费，不能把本设计、attempt=1 或新 runner 当作新授权。

**本消息及本设计不授权触发任何下一 run。**
后续如获授权，仍只允许一次目标为 system true 的工具级启动；
无论结果如何，不续启产品、不操作账户/Keychain/凭据、不自动再试。

