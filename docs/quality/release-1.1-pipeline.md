# 1.1 发布管线

## 范围与状态

本说明记录发布工作流的门禁与操作方式，不代表 v1.1.0 已发布或三平台已经运行通过。当前修改只涉及发布编排，依赖、核心源码与既有打包脚本不变。

统一版本包含 Windows x64 EXE、Mac Apple 芯片 arm64 DMG 和 Mac Intel x64 DMG。文件名沿用现有更新服务契约，固定产品名称 RT-ResearchFlow、应用身份 com.tradewatcher.app；Windows 安装器保留现有用户数据保护宏与默认保留数据配置。

## 共同构建与验收流程

1. tag 触发：仅接受 vMAJOR.MINOR.PATCH 或 vMAJOR.MINOR.PATCH-beta.N，数字不允许多余前导零。tag 必须与 package.json 完全一致，且对应版本发布说明存在。
2. 三个平台分别在 GitHub 托管原生临时运行器构建。Windows 禁止打包后自动启动；Mac 复用 macos/build.mjs 的依赖修复、原生打包与临时签名机制。
3. 先计算安装包 SHA-256，再从该 EXE 静默安装到运行器临时目录，或挂载该 DMG 后复制应用到临时目录。不得使用 win-unpacked 或构建目录替代安装后应用验收。
4. 运行现有 Windows 两项、Mac 三项安装后测试，单 worker、零重试；JSON 报告必须全部通过且无跳过、无 flaky、无全局错误。Mac 另核对已安装应用的版本、bundle ID、CPU 架构与签名；Windows 已有集成测试核对安装后版本。
5. Windows 对测试生成的隔离 data 文件增加合成哨兵，用同字节 EXE 同目录重装后逐文件比对。此项仅证明同版本重装保留合成数据，不证明从 1.0 升级到 1.1 的数据库迁移通过。
6. 验收后再次计算安装包哈希，只有与安装前一致才上传不可覆盖的工作流产物。每个平台分目录保存安装包、SHA256SUMS.txt、INSTALLATION-PROVENANCE.json。
7. 汇总任务检查原始 run 的逐 attempt 平台任务成功结论、钉住的源码 commit、package 版本、测试文件清单、无跳过证明、文件大小与 SHA-256。合并三平台校验和，不重建应用或安装包。
8. 三个平台全部通过才创建草稿。上传三份安装包、统一 SHA256SUMS.txt 与 RELEASE-PROVENANCE.json；逐附件从草稿下载回来，检查同字节、大小、GitHub digest（若存在）及附件身份未变化。tag 触发始终保持草稿。

## 本轮 1.1 的一次性分支入口

- 只有 push 到 codex/release-1.1 才启用本次已授权的自动发布，RELEASE_TAG 固定为 v1.1.0；其他分支不触发。源码固定到该 push 的 commit SHA，不能以随后变化的分支头替换；package.json 必须仍为 1.1.0。
- 准备任务先读取 Release 列表：v1.1.0 已公开就立即停止。已有草稿仍须符合原 run ID 与 commit 来源标记。若 tag 已存在，剥离 annotated tag 后的 commit 必须与本次 push 完全一致；绝不强推或覆盖。
- 仅这个入口允许 tag 暂时不存在。准备与构建阶段不创建 tag；三平台原生安装测试、Windows 同目录重装检查、不可变产物上传和汇总哈希/来源检查全部成功后，才在汇总任务中创建 refs/tags/v1.1.0，指向原 push SHA。
- 创建 tag 使用仅创建的 GitHub API，不调用更新引用接口。若遇到竞争导致 422，重新读取并核对 SHA；不一致或仍不存在就失败。创建草稿前和公开前继续核对 tag。
- 草稿上传与下载回验仍走原门禁。全部附件同字节且 tag、来源标记、附件身份未变化后，这个入口自动公开正式 1.1.0。普通 tag push 仍只留草稿，普通 workflow_dispatch 仍按 publish 输入决定。
- GitHub Actions 的 GITHUB_TOKEN 创建 tag、草稿和公开 Release 不会再触发对应的 push/release 工作流，因此不会重复构建。主任务把源码同步到分支时应使用正常可触发 push 的 GitHub App/PAT 等凭证，而非另一个 Actions 任务的 GITHUB_TOKEN。[GitHub 官方触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)
- 此 push 入口不要求先把工作流合入 default branch；推送提交本身须包含这份工作流，并产生该分支的 push 事件。手动运行按钮仍依赖 default branch 上的 workflow_dispatch 定义。[GitHub push 与 workflow_dispatch 说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
- 构建失败时 tag 尚未由本流程创建，可在同一分支提交修复继续 1.1。三平台成功后若发布步骤失败，重跑原 run 的失败任务以复用产物；如果 tag 已创建，也可按原手动运行规则恢复。已经创建的 tag 不会为后续不同 SHA 移动。

## 显式公开或发布步骤重试

在 GitHub Actions 的 Release 工作流选择手动运行，填写已存在的原 tag、原 tag 或本次指定分支触发运行的 tested_run_id，以及 publish 选项。

- publish=false：恢复原运行的已验收产物，补齐草稿缺失附件并下载回验，保持草稿。
- publish=true：复用相同产物与门禁，全部回验通过后才公开；beta.N 设置 prerelease，正式版本不设置 prerelease。
- 原运行可以因汇总、上传或发布步骤失败而总体失败，但必须已经完成，并且安装包证明对应的三个平台任务均成功。
- 原运行产物保留 30 天。产物过期、缺失或三平台未通过时直接失败，不偷偷用新的构建替代原已测试产物。
- CI 失败优先重跑失败任务，保留成功平台的产物与原 run ID。不可覆盖的同名产物会阻止重跑全部任务时无意替换成功平台安装包。
- 并发锁以目标 tag 分组；codex/release-1.1、v1.1.0 tag 推送和针对 v1.1.0 的手动发布共用 release-v1.1.0 锁。已有草稿只允许相同 run ID 与 commit 恢复；缺少来源标记的旧草稿停止处理。
- 已公开版本绝不修改、覆盖附件或重新发布。不得通过移动 tag 或复用旧文件名冒充新版本。附件已有同名但字节不同则回验失败，保持草稿且不自动删除或覆盖。
- GitHub latest 指针不在此流程中抢占；现有应用更新服务从 GitHub Releases 按语义版本选取正式或 beta 渠道版本，不依赖 latest 指针。
- 不建议绕过工作流直接在草稿页面点公开。该工作流的公开路径具备三平台验收及远端字节回验门禁，外部手工操作不受其保护。

## 更新源与证据

更新仓库为 hzqedison/RT-ResearchFlow，与现有 GitHub 更新服务保持一致。统一校验文件每行只包含 SHA-256 与安装包 basename，覆盖三平台直装包，草稿不会进入现有公开版本查询结果。

Mac 打包脚本同时生成 ZIP，但现有安装验收和更新服务消费的是 DMG；本流程只发布已实际安装验收的 DMG，不把未安装验收的 ZIP 宣称为同等验证产物。

安装测试原始 JSON 与测试截图等证据单独保存 14 天，不混入公开附件；公开的来源证明只含版本、commit、run/attempt、平台、测试文件与数量、安装包哈希和大小，不含真实账户或用户文件内容。

## 仍需分别完成的平台验收

- Windows x64、Mac arm64 与 Mac x64 在目标 tag 上实际执行这份工作流，确认原生依赖、打包、安装启动及现有 E2E 全部通过。
- 测试者设备的 Windows SmartScreen、Mac Gatekeeper、Developer ID 签名与公证。当前 Mac 临时签名验证不等于公证，不保证无安全提示直装。
- 从真实旧版本升级到 1.1 的目录复用、数据库迁移、备份和用户数据保留，需要使用隔离的合成旧数据单独验收；本流程不接触真实账户数据。
- 真实系统上的 GitHub 更新查询、断点/中断重试、安装包下载与校验、用户手动安装及版本渠道体验。静态来源和文件契约检查不等于运行通过。
- 未安装真实同花顺或连接真实账户的 CI，只验证安全边界和阻断逻辑，不证明真实委托、成交或撤单成功。
