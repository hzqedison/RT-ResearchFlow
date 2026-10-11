# RT-ResearchFlow 1.1 独立最终验收

- 验收日期：2026-10-08，Asia/Singapore。
- 指定角色：Astra 独立最终验收负责人；本报告不以实现代理的完成声明代替证据。
- 结论：**CONDITIONAL（有条件通过）**。
- 正式版本：`v1.1.0` / `1.1.0`。
- 正式源码：`ec1fe73e5f3c80edb1f3e7b0a989a03cf66b18ad`。
- 正式运行：`37717182978`，最终 attempt 2，`completed / success`。
- 唯一持久化交付修改为本报告；未修改产品源码、AGENTS、正式 tag 或公开资产，未重打包或在本机运行 NSIS，未访问生产 data、真实券商或账户。

## 1. 放行范围与发现

允许现有正式安装包继续用于**非实盘、先备份或使用独立测试资料的有限测试交付**。本轮没有在所查范围内复现新的确定性产品缺陷，也没有发现正式附件与已验收安装包证据不一致；这不是整个产品无缺陷或适合无人值守实盘的证明。

| 发现 | 判断与处理 |
| --- | --- |
| Windows attempt 1 首次安装确实崩溃 | 独立读取失败日志确认退出值 `-1073741819`，即 `0xC0000005`。根因仍未知，不得写成已修复。attempt 2 是同源码重新构建并重新验收的新 EXE，不是失败 EXE 字节恢复正常。现有成功证据支持有限交付，不能消除安装稳定性风险。 |
| Mac 安装后测试没有 AI 密钥保存用例 | 三项 Mac E2E 没有调用 AI 配置保存，也未验证真实 Keychain 加密/解密和重启后带密钥配置恢复。Windows 的无 Key 保存、模拟 safeStorage 的单测均不能替代此项。作为下一次 Mac 验收必须补齐的覆盖缺口，不据此断言产品存在保存 bug。 |
| 没有正式 1.0 -> 1.1 跨版升级数据证据 | 现有数据库单测验证合成迁移/快照；Windows 安装检查是同版同目录重装；Mac 是新 profile 安装启动。这些均不能证明已有用户数据库、密钥与偏好升级后无损。不得作无损升级的全面签字。 |
| Mac 交易只验证拒绝路径和引导，不验证下单能力 | 缺少权限/客户端时安全阻断、取消确认、按钮禁用和脱敏导出有证据；真实同花顺客户端布局、账户绑定、券商委托受理、成交和撤单没有验收证据。**本轮不放行真实交易能力。** |
| 安装 E2E 的零跳过不等于所有测试零跳过 | 两种 Mac 原生单测各有 1 项跳过，Windows 原生单测有 3 项跳过；只有必要的安装后 E2E 为零失败、零跳过、零 flaky。 |

上述缺口不构成本轮已复现的源码 bug，因此未编造复现步骤或要求盲目修改源码。若后续复现确定缺陷，应由实现代理修复，再交独立最终验收复验；不得覆盖已公开的 1.1.0 安装包。

## 2. 正式发布证据：本轮独立获取并复核

一手来源：

- [正式 release](https://github.com/hzqedison/RT-ResearchFlow/releases/tag/v1.1.0)：release ID `406353639`，`draft=false`、`prerelease=false`，发布时间 `2026-10-08T02:42:54Z`，五个附件。
- [正式 tag 引用](https://api.github.com/repos/hzqedison/RT-ResearchFlow/git/ref/tags/v1.1.0)：直接指向上述 commit，与 release、run 和 provenance 一致。
- [RELEASE-PROVENANCE.json](https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.1.0/RELEASE-PROVENANCE.json)：实际读取公开 asset `620512799` 的 2504 字节文件；首次普通下载连接失败，改用 GitHub asset API 成功，不将失败下载算作验证通过。
- [SHA256SUMS.txt](https://github.com/hzqedison/RT-ResearchFlow/releases/download/v1.1.0/SHA256SUMS.txt)：实际读取 308 字节公开文件。
- [正式 workflow](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37717182978)：独立读取总状态、两次 attempt 的 job 状态、相关原生 job 日志与发布 job 日志。

公开附件 API 的大小/digest、provenance 的大小/哈希，以及 SHA256SUMS 三方逐项一致：

| 安装包 | 字节数 | SHA-256 | 来自 attempt | 安装后 E2E |
| --- | ---: | --- | ---: | --- |
| `RT-ResearchFlow-macOS-1.1.0-arm64.dmg` | 201656920 | `42970ebc1d9365765deddc94306beb39816ca3a4a16b88b62331a004d51f6d8e` | 1 | 3 passed，0 failed/skipped/flaky |
| `RT-ResearchFlow-macOS-1.1.0-x64.dmg` | 209345834 | `604782a67ebb79e2df5665ab8293573996d34ba37711b2f27e4dde2ea969ac96` | 1 | 3 passed，0 failed/skipped/flaky |
| `RT-ResearchFlow-Setup-1.1.0-x64.exe` | 166498081 | `3689c579c902b006df422b91c5e723d63f89fcd1e3e16f85df7132942add1fbe` | 2 | 2 passed，0 failed/skipped/flaky |

### 原字节发布链

[发布 job 113122517945](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37717182978/job/113122517945) 的日志与成功步骤显示：下载三份不可变 tested-package 工件，按各自 `runAttempt` 核对成功的原生 job 与源码 SHA；核对安装前后安装包哈希未变；发布前将五个 draft 附件重新下载，逐文件比较长度和 SHA-256，并与 GitHub digest 比对；再次核对 tag、附件 ID/大小/更新时间稳定后才转公开。回读步骤在 `02:42:45Z` 开始，后续发布成功。

本轮没有重新下载三份大型安装包；安装包字节一致性的证据是**独立复核云端原字节回读代码、实际成功步骤及当前公开资产摘要**，不是本机重新计算三份安装包的 SHA-256。SHA-256 一致性也不等同于 Apple 公证或第三方签名认证。

## 3. 现有云端测试：只复核，未在本轮重新执行

| 平台 | 原生单测日志 | 安装后 E2E 日志 | 补充 |
| --- | --- | --- | --- |
| Mac ARM64 | 251 文件通过；2344 passed / 1 skipped | 3 passed，37.1 秒 | 安装后二进制 `lipo` 为 `arm64`；attempt 1 原字节复用。 |
| Mac Intel | 251 文件通过；2344 passed / 1 skipped | 3 passed，46.2 秒 | 安装后二进制 `lipo` 为 `x86_64`；attempt 1 原字节复用。 |
| Windows x64 | 251 文件通过；2342 passed / 3 skipped | 2 passed，15.1 秒 | attempt 2 新构建；额外同版同目录重装后合成 data 文件哈希保持不变。 |

证据位置：[attempt 1](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37717182978/attempts/1)、[Windows 成功 job](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37717182978/job/113120858766)、[Windows 失败 job](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37717182978/job/113116288854)。Mac attempt 1 原始 job ID 分别为 `113116288829`（ARM64）、`113116288814`（Intel）；最新 jobs 接口保留的对应记录为 `113120859768`、`113120860143`，其日志时间和哈希仍对应 attempt 1，不是两次独立 Mac 重测。

### Mac 三项安装后测试实际覆盖

- [macos-app-smoke.spec.ts](K:/AI/person/money/RT-ResearchFlow/tests/e2e/macos-app-smoke.spec.ts:6)：新临时 profile 启动、读取 SQLite 来源、首页可见、sandbox/contextIsolation/nodeIntegration、原生菜单；修改一般通知设置；关闭窗口后触发 `activate` 重新开窗并检查设置。这里是**同一进程重开窗口**，不是重启应用，更不是跨版升级。退出后仅特别检查两类已知 stderr 文本，不是所有退出故障的完整探测。
- [mac-ths-experiment.spec.ts](K:/AI/person/money/RT-ResearchFlow/tests/e2e/mac-ths-experiment.spec.ts:6)：没有同花顺或辅助功能权限时真实桥接诊断返回允许的阻断码；诊断不含合同号；取消授权确认；未启用实盘时买卖/撤单禁用。勾选风险确认只使启用按钮可用，没有实际启用或提交订单。
- [quant-trading-onboarding.spec.ts](K:/AI/person/money/RT-ResearchFlow/tests/e2e/quant-trading-onboarding.spec.ts:10)：记录开通进度并 reload 保留；注入假敏感字段和 `canSubmitOrders=true` 后仍阻断交易；实际本地 blob 导出不含注入敏感内容。进度自述不被当作已获券商权限。

[windows-integrated-app.spec.ts](K:/AI/person/money/RT-ResearchFlow/tests/e2e/windows-integrated-app.spec.ts:29) 才包含打包应用的无 Key AI 配置保存检查；它不能替代 Mac Keychain 检查。[runtime-reliability.spec.ts](K:/AI/person/money/RT-ResearchFlow/tests/e2e/runtime-reliability.spec.ts:5) 虽有源码 Electron 的配置跨重启与错误反馈用例，但不在此次正式 Mac 安装后的三项套件中，本轮亦未运行，不把父任务历史结果冒充本轮测试。

## 4. 本轮亲自控制和执行的隔离补测

在本机 Windows 的现有 K 盘源码工作区，用项目 Electron 的 Node 模式运行既有 Vitest 单测，不启动产品 UI 或安装器。将 `TEMP`、`TMP` 指向 `K:/AI/person/money/RT-ResearchFlow/.cache`，由用例创建并清理唯一临时夹具；数据库为内存或夹具 SQLite，AI SDK/safeStorage 和交易执行/原生确认均使用 mock。

执行配置：`ELECTRON_RUN_AS_NODE=1`，单 worker，`--reporter=verbose`；未修改任何测试以让结果通过。首个 GUI 子进程调用没有返回测试输出，不计作通过；改用输出管道等待实际测试结果后，得到以下可观察结果。

| 文件 | 本轮结果 | 验证内容 |
| --- | --- | --- |
| `tests/unit/databaseMigrations.test.ts` | 12 passed | 合成完整迁移链、单迁移事务回滚、失败版本后续重试、旧合成记录/自定义提示保留。 |
| `tests/unit/databaseStartup.test.ts` | 9 passed | WAL 已提交内容的一致性快照；备份失败阻止迁移；迁移失败保留恢复点；未知未来 schema 拒绝；周期快照与回执。 |
| `tests/unit/aiConfigStorage.test.ts` | 9 passed | 无密钥元数据不触发 NOT NULL 错误；已有加密密钥不被元数据覆盖；空白拒绝；OS 存储不可用时拒绝保存；错误不泄露测试密钥。SDK 请求为离线 mock，模型枚举测试不证明厂商当前真实 API 可用。 |
| `tests/unit/macThsHandlers.test.ts` | 6 passed | 外来调用/未启用会话拒绝；参数绑定的一次性确认票；默认取消的原生确认；重复请求拒绝；结果不明跨重启阻断；单笔撤单边界。没有执行 osascript 或订单。 |
| `tests/unit/macThsCore.test.ts` | 18 passed / 1 skipped | 输入白名单和恶意字段拒绝、诊断脱敏、预览不提交、真实提交不自动确认券商弹窗、单笔撤单模板边界。Windows 跳过 AppleScript 编译用例；没有模拟宣称 Mac 原生执行成功。 |

实际汇总：**5 test files passed；54 passed / 1 skipped / 0 failed；4.92 秒；退出码 0**。开始时间 `2026-10-08 11:06:10`（本地时区）。本轮没有跑全量测试，也没有重跑 Mac E2E。这组结果属于当前本地工作区的补充回归，不替代由正式源码 SHA 绑定的云端原生包验收。

## 5. 关键源码边界复核

- [databaseStartup.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/database/databaseStartup.ts:35)：使用 SQLite online backup 后 `quick_check`，完成后才 rename；[升级分支](K:/AI/person/money/RT-ResearchFlow/electron/main/database/databaseStartup.ts:102) 的快照失败会抛错，迁移回调在其后。不是通过复制主 db 文件伪造 WAL 安全备份，也不自动回滚已经提交的历史迁移。
- [aiConfigRepository.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/database/aiConfigRepository.ts:54)：未配置厂商用空 BLOB 满足 NOT NULL；未提供密钥字段不会覆盖已有密钥。[apiKeyEncryption.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/utils/apiKeyEncryption.ts:28) 对必需密钥存储失败拒绝保存。这支持原 NOT NULL 问题的修复判断，但不证明 Mac 系统钥匙串权限正常。
- [macThsHandlers.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/ipc/macThsHandlers.ts:41)：检查当前窗口和主 frame；实盘必须本次会话启用、确认票参数一致、本人原生确认。提交前先写结果不明日志，异常后阻止盲目重发。日志仅保留最近 256 个请求 ID，不将现有测试表述为无限历史范围的永久去重保证。
- [macThsScripts.ts](K:/AI/person/money/RT-ResearchFlow/electron/main/services/macThsScripts.ts:250)：模板在提交前核对模式、券商标签和表单回读；真实券商确认弹窗留给本人。源码模板与编译通过不是当前同花顺版本真实布局/账户一致性或资金安全的实测证明。

## 6. 未覆盖风险与解除条件

1. 跨版升级：用独立的 1.0 安装和合成旧 profile 跑完整 1.0 -> 1.1 流程，核对 db、偏好、加密密钥可读性和恢复路径，才可对该路径签字；不得使用用户唯一生产数据试错。
2. Mac 凭证：在原生隔离环境用非真实测试字符串覆盖 Keychain 可用/不可用、保存、重启读取和错误提示；此类隔离验收不应要求测试者提交自己的密钥。
3. Windows 安装崩溃：保留已知失败记录；若再现，先保存失败包及哈希、故障模块/偏移或转储再定位，不能跳过安装门禁。当前失败包未上传，无法对其事后做同字节重试。
4. Apple 公证、Gatekeeper/SmartScreen、目标设备系统兼容性、真实客户端权限和实盘路径未验收。`codesign --verify` 成功不代表 Developer ID 签名和 Apple 公证完成。
5. 不承诺零 bug、无人值守交易、所有数据源实时可用或真实模型调用成功。现有公开说明虽保留“准备时尚未公开”的历史状态段，实际发布状态应以其追加的验收证据和附件为准，后续可整理文案减少歧义。

最终签署：**CONDITIONAL**。正式包同字节证据链及上述有限隔离回归可接受；真实交易、跨版无损升级和 Mac 实际密钥存储不在本次通过范围。未执行、未覆盖或只复核的项目均保持明确标记，不以实现模型自验结论代签。
