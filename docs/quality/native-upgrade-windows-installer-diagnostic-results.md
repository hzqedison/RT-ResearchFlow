# Windows D0 installer diagnostic: independent preflight results

Date: 2026-10-08
Reviewer role: Astra independent final acceptance
Decision: **BLOCKED_D0_PRECHECK**
Native execution: **NOT EXECUTED**
Product/upgrade acceptance: **NOT GRANTED**

## Scope and input identity

This review is limited to the immutable 23-file snapshot at
`K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy`.
All executable review inputs, imports and the submitted offline tests came from
that snapshot, not from the canonical worktree undergoing Mac repairs.

The proposed remote baseline is
`2dc13874d413a3bcf5c4c7ff0f81a4bd3150240f`, plus the six D0 files.
No remote candidate containing those six additions was independently fetched in
this turn. The hashes below freeze the local review input, not an authorization
to advance a branch or run CI.

Only this report was added to the canonical repository. No installer was
downloaded or launched, no native setup/cleanup entry point was invoked, no
firewall/audit/Keychain state was changed, and no workflow, product, release,
tag or public asset was modified. Mac F4/F5 did not determine this decision.

## Blocking findings

### D0-P1: protection cleanup runs despite unresolved owned processes

Severity: P1, diagnostic safety/lifecycle defect.

Code: [diagnostic.mjs:237](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:237),
[diagnostic.mjs:241](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:241),
[observe.ps1:85](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/observe.ps1:85),
[parent windows.ps1:166](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/platform/windows.ps1:166).

The D0 cleanup adapter records a failed or throwing owned-process cleanup, then
unconditionally invokes the parent's protection cleanup. It does not gate that
call on confirmed absence of installer descendants.

A relevant concrete condition is a previously tracked installer descendant in
an NSIS temporary directory whose identity cannot be re-established or whose
termination fails. The D0 observer reports unresolved ownership/cleanup, but the
parent's ProductProcesses search only covers the case directory and the product
executable name. A remaining NSIS helper outside those paths is not necessarily
seen by that parent cleanup. The latter can therefore remove the case's firewall
rules and restore WFP audit policy while that descendant remains unresolved.
This is especially problematic if the descendant can subsequently launch the
installed application.

Independent isolated reproduction executed the exact cached cleanup function
with effect stubs, not a rewritten algorithm:

```text
observer cleanup -> { succeeded: false, remainingOwned: 1 }
calls            -> owned-cleanup, restore-protection:cleanup
result            -> cleanup failed, but protection restore was still requested
```

A second case made the observer throw EACCES; protection restore was still
requested. The original installer failure remains the primary failure in the
ordinary failure path, which is a positive check, but that does not make the
cleanup order safe.

The always-cleanup action also replaces result.cleanup rather than appending
attempt history ([diagnostic.mjs:311](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:311)).
A later successful cleanup can remove the earlier detailed cleanup records,
although the generic primary/secondary failure can remain.

Minimum repair boundary: D0 `diagnostic.mjs` and its offline tests; D0
`observe.ps1` only if a stronger stopped-process receipt is needed. Do not modify
the frozen parent. Keep the existing protections until owned-process termination
has been positively established, preserve every cleanup attempt, and explicitly
record any residual protection/ownership state on failure. A disposed hosted
runner is not evidence that cleanup succeeded. No installer retry is permitted.

Required regression evidence: both negative cases above must refrain from
calling protection restore; the successful termination path may restore it;
subsequent cleanup must preserve the original native error and previous cleanup
details.

### D0-P2: known parent failures lose their safe code and classification

Severity: P2, diagnostic evidence defect.

Code: [diagnostic.mjs:58](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:58),
[diagnostic.mjs:220](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:220),
[diagnostic.mjs:300](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:300),
[parent evidence.mjs:281](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/evidence.mjs:281).

safeError preserves kind/code only for this module's D0Error. The unchanged parent
throws its distinct AcceptanceError with a safe structured code and, where
available, nativeError fields. Passing such a failure through D0 collapses it
into DIAGNOSTIC_ERROR / D0_TOOL_ERROR, rather than preserving the known
environment/protection failure.

Independent execution of the actual safeError function established:

```text
input:  AcceptanceError(BLOCKED_ENVIRONMENT, WFP_AUDIT_UNAVAILABLE)
output: DIAGNOSTIC_ERROR / D0_TOOL_ERROR / errno unavailable
```

This would erase the distinction between an unavailable protection prerequisite
and a generic observer defect before spending the one-shot experiment budget.
The same boundary should handle the downloader's fixed upgradeCode values and
bounded parent timeout/spawn diagnostics. Arbitrary exception text, raw paths,
parameters, credentials and unknown codes must remain suppressed.

Minimum repair boundary: D0 `diagnostic.mjs`, offline tests and README if its
contract changes. Add an explicit allowlisted adapter for the frozen parent's
structured error contract; do not loosen redaction or change parent files.
Regression cases must preserve known safe codes/classes and continue to reject
untrusted messages and arbitrary properties.

### D0-P3: event-observation deadline does not bound the event query

Severity: P2, bounded-observation contract defect.

Code: [observe.ps1:248](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/observe.ps1:248),
[observe.ps1:250](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/observe.ps1:250),
[observe.ps1:266](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/observe.ps1:266),
[diagnostic.mjs:194](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:194).

The loop establishes a 60-second deadline, but invokes synchronous Get-WinEvent
without a per-query deadline or cancellation, and checks the clock only after
that query completes. MaxEvents bounds returned records, not query duration.
A stalled query can therefore exceed the 60-second observation window. The
driver's 250-second timeout covers the entire observer and is not a 60-second
event-stage limit; on timeout it can also lose the observer's in-memory report.

The report sets eventObservation.bounded=true unconditionally after normal
return, even when a slow query took the phase past its deadline. This finding
is based on direct source/control-flow review, not a claim that a native runner
actually stalled.

Minimum repair boundary: D0 `observe.ps1`, its offline tests and, only if needed,
the D0 driver. Use a remaining-budget-bounded, cancellable read-only query
boundary; retain partial sanitized facts and classify query timeout/unavailability
explicitly. It must not restart the installer, alter event/audit settings, or
turn a missing event into an attributed crash. Add a deterministic slow-query
test and verify the advertised phase deadline including termination/collection
semantics, with any scheduling tolerance stated honestly.

## Independently executed checks

### Submitted 20-case offline suite

Executed from the snapshot with TEMP/TMP on K:. No dependency installation or
snapshot modification was performed.

Command:

```powershell
node --test tools/native-acceptance/windows-diagnostic/offline.test.mjs
```

First execution: **19 passed, 1 failed, 0 skipped**.
The failure was MODULE_NOT_FOUND for js-yaml in the workflow-structure case,
not an assertion about native Windows behavior.

A second execution supplied the app's advertised bundled Node package directory
through NODE_PATH. It produced the same **19 passed, 1 failed, 0 skipped** because
js-yaml was still unavailable there. No further dependency retry or network
installation was attempted. The incomplete case is
[offline.test.mjs:155](K:/AI/person/money/.tmp/rt-windows-d0-review-jMRhVy/tools/native-acceptance/windows-diagnostic/offline.test.mjs:155).
The workflow was read directly, but its submitted parser-based test is not
claimed as independently passed. The developer's reported 20/20 remains
development evidence, not a replacement for these results.

Among the 19 independently passed cases were actual PowerShell AST parsing and
execution of only the extracted pure Number-Id/Match-Event functions. Wrong
PID/path/time/creation time and WER records without a fault PID were rejected;
partial creation-time attribution stayed explicit.

### Nine additional reviewer-controlled checks

Executed once using Node `v24.15.0`, the snapshot module's pure exports,
and exact cached function bodies in an in-memory VM. All native/network/process
effects were stubs. No temporary script was written.

**9 assertions passed, 0 failed.** Some deliberately confirm the presence of the
defects above; this count is not a readiness pass and is not native test coverage.

1. Failed owned cleanup still requests protection restore: reproduced D0-P1.
2. Throwing owned cleanup still requests protection restore: reproduced D0-P1.
3. Original installer crash stays primary when cleanup reports a failure.
4. With no protection setup, native cleanup effects are not invoked.
5. Known parent error is collapsed: reproduced D0-P2.
6. Ordinary error text and private paths remain suppressed.
7. The actual observer adapter retains a nonzero process's structured crash JSON.
8. The actual observer adapter rejects a raw absolute path in returned JSON.
9. Independent 21-payload plus two-manifest freeze verification.

These checks used sanitized synthetic data, not original EXE execution. They
are separate from the submitted suite, previous Mac/offline tests and earlier
product acceptance counts. No all-platform or upgrade pass count is asserted.

## Satisfactory reviewed boundaries

- Dedicated Windows diagnostic workflow; no upgrade or application launch step.
- Hosted Windows x64, dedicated branch and exact run_attempt=1 guards.
- Exclusive driver and observer invocation claims; no installer retry loop or D1.
- Original 1.0 PIN: source `41f8429149f646c7dec7f1610082702e7d9cce48`;
  size 166547210; SHA-256
  `f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b`.
- The unchanged downloader fetches both pinned releases, but D0 selects and
  executes only 1.0. This turn checked the selection logic and manifest, not
  downloaded installer bytes.
- Original /S and /D invocation shape, Hidden/PassThru and no explicit change to
  working directory, TEMP/TMP, elevation or mitigation settings.
- Read-only native architecture/token/mitigation observations; missing fields
  are not guessed from the installer's x64 filename.
- Application Error/WER provider whitelist and PID/image/time association;
  unavailable creation time is labelled partial rather than full attribution.
- Module evidence is read only from an original still-present file; no dump,
  extraction workaround, re-execution or retention hook.
- Nonzero observer JSON is not inherently discarded by the parent command
  helper. The independent adapter check specifically confirms that path.
- Published evidence is limited to the sanitized diagnostic JSON. No raw event
  text, command line, full image path or credential is intentionally published.
- Local raw bytes and both freeze manifests are bound to the same commit's Git
  blobs by the gate; checkout disables automatic EOL conversion. Local frozen
  bytes are checked again before native work.
- diagnosticOnly remains true and upgradeAccepted remains false. A successful
  D0 installation could not establish 1.0-to-1.1 data preservation.

## Coverage limits and historical facts

R0 previously observed the original 1.0 EXE exit -1073741819 / 0xC0000005 and an
associated System.dll c0000005 event. That historical evidence does not establish
a DLL path/hash or root cause. This turn did not reread remote R0 logs or collect
new native facts. No Defender, ASLR, runner-image or product defect is assigned
as the cause.

The preserved parent's initial firewall policy targets the installed product
EXE. D0 checks two enabled outbound-block rules and the audit backup's presence;
that is not proof of whole-installer or arbitrary-descendant network containment,
nor a count of WFP-denied events. The observer does not obtain Security 5157
evidence. Keep this limitation explicit; adding a new installer-wide network
policy would change D0's R0 comparison conditions and needs separate design,
not silent inclusion as an observation-only change.

Process observation is snapshot-based and can miss short-lived children.
Matching image metadata does not prove an identical environment.
windows-latest does not pin the historical runner image. Gatekeeper,
Keychain, live trading, real accounts and actual cross-version upgrade
preservation remain outside D0.

## Independent raw-byte freeze

The file hashes were calculated from one raw-byte read pass over the immutable
snapshot. Aggregate checks used those captured bytes/metadata; no line-ending
normalization was performed.

- Parent 16-payload combination:
  `8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795`
- D0 five-payload plus parent-binding combination:
  `3f582b9e9663cd436172829e87ded49a64eff14885fdf7cb0f4e1f5dc05b5aaa`
- Parent manifest, separately hashed:
  `942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c`
- D0 manifest, separately hashed:
  `e3e12713d9ffec17a115272f95cd5e5913fcef6165c2baeb37afe4fe0fd699c1`
- Independent all-23-files aggregate:
  `f9024946ee04af2040bf0a7dd9a3f1571e531733d0bb85bb379476830a13f232`

All five values were independently derived or checked against actual snapshot
bytes. The parent and D0 values match the supplied review identities.

The all-23 aggregate is SHA-256 of UTF-8 JSON.stringify(entries), with no trailing
newline. Entries are sorted by ascending POSIX relative path; each object has
keys in the order path, size, sha256. Both manifest files are included as ordinary
entries in this reviewer aggregate. The report itself is excluded. The D0
manifest's own documented aggregate excludes itself and uses
JSON.stringify({parent,files}); these are deliberately different scopes.

Format below: SHA-256, byte size, relative path.

```text
8cb2214fdb9a972de2433cebbc7e4a6a67f20b69c5496f7a6a52f3c114645a06   10080  .github/scripts/fetch-upgrade-installers.cjs
e793ff8c657710d5a2a21e2574545d9f3685d45d3e32dd53d425fb7987df9072    5248  .github/workflows/native-upgrade-acceptance.yml
b2bf4b7004b210d039b281978a50e330101b9cded23c74c75c8e52c2c40f160a    2431  .github/workflows/windows-installer-diagnostic.yml
b65be09318ab5dbba790909a6024cd6df83ccdf5671c66b55669ecea3a3c6b7f    1808  tests/fixtures/releases/native-upgrade-1.0-1.1.json
d0af1dc8e14aebcb3580c38270cf486fc77d73b2634b6256f1b54051c7f6e6bb    9298  tools/native-acceptance/README.md
2f8c3442f8707a55df4d0b142f3f5cc609cac86639440aa4812906050475184b   40217  tools/native-acceptance/evidence.mjs
942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c    2988  tools/native-acceptance/fixtures/harness-freeze.json
b9634472a2d3805c9396811c1b075d4c6a61ef837a22e7fc6af12dc06492e7a7    2457  tools/native-acceptance/fixtures/version-contract.json
8d27e36a97c3b9c4d67f4cf6987039e2b841afecdf3066f3d005fce9e462a80a   32523  tools/native-acceptance/harness.ts
e3b29698b5a2143c9792d8c50b78a71182ebe08df30f2ff66654ebcd5d873581     689  tools/native-acceptance/native-upgrade.spec.ts
985dd204e4dd7eb2cace69cf617e7fb57d632a056e739721752fe76a525dc7ee   35735  tools/native-acceptance/offline.test.mjs
ad9c6e47c663b4aadd9c5181c0b0ee713cc5b9f7046370104784797909581298     319  tools/native-acceptance/package.json
0d4cd7edeabd1bab839bb8a864c2aa11e57ce6ce0c693f4b96688a5d14eb0a90    9486  tools/native-acceptance/platform/macos.mjs
f952ebfeccaaaeb875af61568edf7319ee02a2e76b9f1c652cafe620f337e06c     155  tools/native-acceptance/platform/macos.sh
fc5a2ceb1d608eef6fb15f4ffe780253015d0c37d0736bea85e24a75b3a1c778   11982  tools/native-acceptance/platform/windows.ps1
7f23244a40deecbab076fb39d7e5e4d8bd13d960836f65e14fa6af61eed13c81     504  tools/native-acceptance/playwright.config.ts
7009ed801624686eff210f907b2312ce368f5f04ab2ac09f6465c1b9151fe70d    1317  tools/native-acceptance/pnpm-lock.yaml
671af518c48fde83548d51fc3a27bf2d85d9fd3ff326b1ff04a08dafaa067945    4955  tools/native-acceptance/snapshot.cjs
f7c3264bd0c860cd1077eef3406037e852e569ffcb809f778fcd08ef06bd05ca    6613  tools/native-acceptance/windows-diagnostic/README.md
46f7f6f7d78ceb26f70583e2df8d0b3bd66232caf118535516f2b7fc33860604   23482  tools/native-acceptance/windows-diagnostic/diagnostic.mjs
e3e12713d9ffec17a115272f95cd5e5913fcef6165c2baeb37afe4fe0fd699c1    1398  tools/native-acceptance/windows-diagnostic/freeze.json
dd6476b3246448492120f4e2a527e013caee91ba83639733e95b4b9741b87fdc   25465  tools/native-acceptance/windows-diagnostic/observe.ps1
d96cd8d415bf4ec13a933d5774100f5dde5f7532761ae37969fbcf0e35cacd81   14586  tools/native-acceptance/windows-diagnostic/offline.test.mjs
```

## Minimal next step and release decision

Return D0-P1/P2/P3 to Sol/Kant with the D0-only repair boundaries above.
Update the D0 README and offline tests as required, regenerate only the D0
freeze, and provide a new immutable review snapshot. Preserve the approved
parent 17 bytes and the original released 1.0/1.1 assets. Supply an available
offline YAML dependency or equivalent independently runnable workflow check;
do not count the unresolved parser test as passed.

**Do not trigger this D0 candidate.** This is a tool preflight block, not evidence
that Windows 1.1 is defective, not a Mac verdict and not a product withdrawal.
After repair, Astra must review the new frozen bytes before the main task binds
them to a candidate commit and considers the single native D0 run.

## 2026-10-08 追加：P1/P2/P3 修复后独立预检

本节保留上文历史结论，独立审查新的 24 文件快照，不替换或修改原被拒快照。

**结论：BLOCKED_D0_PRECHECK。不能授予 D0_READY_FOR_ONE_HOSTED_RUN。**

**D0 未执行；产品、升级和原生安装验收均未授予。**

### 阻断发现：P1 的退出回执仍可在进程尚未退出时报告成功

严重级别：P1，清理安全契约未闭合。上层恢复门禁已修复，但其底层正向证据不成立。

位置：

- [observe.ps1:316](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1:316)：`Stop-Identified` 先核对 CIM 的 PID、创建时间及路径摘要，随后在第 322 行执行 `Stop-Process`，第 323 行直接返回 `$true`，没有终止后的退出确认。
- [observe.ps1:139](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1:139)：`Get-OwnedCleanupReceipt` 将这个布尔值计作已清理，并可生成 `succeeded=true / remainingOwned=0 / unknownDescendant=false`。
- [observe.ps1:338](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1:338)：真实 cleanup 分支汇总上述进程回执与查询 worker 回执，输出正向清理结果。
- [diagnostic.mjs:280](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:280)：正向门禁接受该结果，随后第 287 行恢复防护；[diagnostic.mjs:304](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:304) 确认真实适配器确实使用这条接线。
- [父 windows.ps1:173](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/platform/windows.ps1:173)：父 cleanup 撤除防火墙规则并恢复审计。其产品进程查询仅覆盖 case 路径和产品名称，不能作为外部 NSIS 临时目录 helper 的退出证明；其最终查询也发生在撤防之后。

独立反例不是字符串匹配，也不是重写后的清理算法：从冻结字节的 PowerShell AST 提取原始 `Digest`、`Stop-Identified`、`Get-OwnedCleanupReceipt` 和实际 cleanup 分支。仅以替身替换 CIM 查询、终止命令及持久化读取，模拟已识别的 `nsis-temp` helper：终止请求返回，但退出尚未确认。将真实分支输出的 JSON 交给内存 VM 中的原始 JS `cleanup → observer → cleanupWithEffects → platformCommand`，所有外部效果均由替身记录。

实测结果：

```text
stillLive             = true
CIM queries           = 1
termination requests  = 1
observer.succeeded    = true
remainingOwned        = 0
unknownDescendant     = false
calls                 = observe:cleanup -> parent:cleanup
protectionState       = restored
```

因此，“终止命令返回”被提升成了“退出已经确认”。这不是泛指 CIM 会漏掉短命进程，而是对已经识别、已经进入清理记录的进程缺少终止后确认。查询 worker 的句柄退出确认不能替代安装器/NSIS helper 的退出确认。

补充证据：只读检查本机 PowerShell 7.6.5 的已加载方法 IL，`StopProcessCommand.StopProcess` 调用 `System.Diagnostics.Process.Kill`；后者调用 `Kernel32.TerminateProcess`，未发现等待进程退出的调用。本轮没有在真实安装器上复现延迟退出，也不宣称 hosted runner 已发生这一时序。确定性替身检查证明的是：当前工具没有独立的退出确认边界，无法满足本次明确要求的正向退出门禁。

最小可复现检查如下，只运行 AST 中的函数，绝不执行观察器入口或真实 CIM/终止命令：

```powershell
$ErrorActionPreference = 'Stop'
$file = 'K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'AST_INVALID' }
foreach ($name in @('Digest', 'Stop-Identified', 'Get-OwnedCleanupReceipt')) {
  $nodes = @($ast.FindAll({ param($n)
    $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name
  }, $true))
  if ($nodes.Count -ne 1) { throw 'FUNCTION_NOT_UNIQUE' }
  Invoke-Expression $nodes[0].Extent.Text
}
$fixture = @{
  live = $true; queries = 0; stops = 0
  created = [DateTime]::Parse('2026-10-08T00:00:00Z').ToUniversalTime()
}
$record = @{
  pid = 424242; createdUtc = $fixture.created.ToString('o')
  imagePathSha256 = (Digest 'K:\fake\ns123.tmp\helper.exe')
  category = 'nsis-temp'
}
function Get-CimInstance {
  param($ClassName, $Filter, $OperationTimeoutSec)
  $fixture.queries++
  if ($fixture.live) {
    return @{ ExecutablePath = 'K:\fake\ns123.tmp\helper.exe'; CreationDate = $fixture.created }
  }
}
function Stop-Process {
  param($Id, [switch]$Force, $ErrorAction)
  $fixture.stops++
}
$receipt = Get-OwnedCleanupReceipt $true $true @($record) {
  param($item) Stop-Identified $item
}
@{ receipt = $receipt; stillLive = $fixture.live; queries = $fixture.queries; stops = $fixture.stops } |
  ConvertTo-Json -Depth 6
```

此脚本是已执行内存反例的简化复现入口；完整跨语言接线也已实际执行，结果见上。现有 74 项测试把 `StopRecord` 的 `$true` 当作退出事实，未覆盖这个真实适配器缺口。

### 三项修复的分别判定

| 项目 | 本轮判定 | 证据及边界 |
| --- | --- | --- |
| P1 上层恢复门禁 | 已修复 | 失败、异常、缺失字段、未知后代和活查询 worker 均阻止恢复；真实 JS 适配器反例确认负向结果确实阻止父 cleanup。 |
| P1 回执来源 | **仍阻断** | `Stop-Identified` 在终止请求后直接返回成功，未确认安装器/NSIS helper 退出，详见上文。 |
| P1 清理历史 | 已修复 | `main(run)` 后再执行 `main(cleanup)`，原安装器 `NSIS_NONZERO_EXIT` 保留，两个 attempts 均保留，第一次 retained、第二次 restored；后续成功不抹去失败。 |
| P1 部分恢复失败 | 已修复 | 原始父 `platformCommand` 注入 `AUDIT_RESTORE_FAILED` 后，结果为 `protectionState=unknown`，保留固定错误码及安全 errno/signal。 |
| P2 父错误与下载错误 | 已修复 | 实际父适配器的 `BLOCKED_ENVIRONMENT/WFP_AUDIT_UNAVAILABLE` 经真实 run 接线保留，且没有安装器调用；实际下载器参数失败保留 `UNSUPPORTED_PLATFORM_ARCH/BLOCKED_INPUT`。未知 code、异常文本及任意属性不透传。 |
| P3 事件查询 deadline | 源码及受控隔离检查通过 | 真实 worker 工厂、匿名管道、句柄终止和 deadline pump 用纯休眠 worker 补测；59250+250+500 ms 预算接线存在。真实 Get-WinEvent 可用性和 hosted 调度表现未测。 |

关键位置还包括 [diagnostic.mjs:63](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:63) 的固定错误白名单、[diagnostic.mjs:293](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:293) 的 attempts 追加，以及 [observe.ps1:37](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1:37)、[observe.ps1:210](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1:210)、[observe.ps1:485](K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5/tools/native-acceptance/windows-diagnostic/observe.ps1:485) 的查询 pump、生产适配器和阶段接线。

### 独立执行结果与隔离边界

唯一源码输入是 `K:/AI/person/money/.tmp/rt-windows-d0-fixed-EKu5l5`。父 17 文件来自该 snapshot；没有使用 canonical parent。源码及两个 snapshot 全程只读，唯一持久化交付写入是本报告的追加。PowerShell 编译/测试临时目录指向 K 盘工作区。

运行前检查了两套测试、导入入口及被提取函数。没有执行观察器原生入口；没有调用真实 Get-WinEvent、注册表、防火墙、审计、安装器、产品应用或真实券商/密钥。没有 Git、依赖安装/卸载、网络下载、push、CI 或原生安装操作。实际启动的额外子进程仅为本次受控的隐藏 PowerShell 纯休眠 worker。

```powershell
$env:NODE_PATH = 'K:/AI/person/money/RT-ResearchFlow/node_modules/.pnpm/js-yaml@4.3.0/node_modules'
$env:TEMP = 'K:/AI/person/money/.tmp'
$env:TMP = $env:TEMP
# 工作目录为上述 immutable snapshot。
node --test tools/native-acceptance/windows-diagnostic/offline.test.mjs tools/native-acceptance/windows-diagnostic/deadline.test.mjs
```

独立结果：**74 tests / 74 pass / 0 fail / 0 skip / 0 cancelled；4287.3204 ms。**

本机 Node 为 `v24.15.0`；CI 目标 Node 20，本轮没有执行 Node 20。YAML 使用指定的现有 `js-yaml@4.3.0`，没有 skip 或安装替代品。此前 19/20 的环境失败不再存在。

另完成 **12 组审查者控制的行为检查**，不并入提交测试的 74 项。其中一组是成功复现阻断缺陷，不能把“12 组断言完成”称为安全放行：

1. 原始 PS 退出回执接入真实 JS cleanup/observer/父适配器，复现 P1 过早恢复。
2. 负向清理回执确实不调用防护恢复。
3. 观察器异常保留 errno，且不调用防护恢复。
4. 实际父适配器恢复失败保留错误码，防护状态为 unknown。
5. 真实 main 的 run/cleanup 路径保留原始崩溃和两次清理历史，安装调用恰为一次。
6. 实际父适配器 WFP setup 失败保留分类、errno、signal，并在安装前停止。
7. 实际下载器在参数校验处失败，固定 upgradeCode 被正确分类，无下载效果。
8. 原始证据门禁拒绝 rawModulePath、嵌套 commandLine/message、Bearer 字符串和绝对路径；未知异常属性不输出。
9. 原始 observer 适配器保留非零退出的结构化崩溃 JSON，并拒绝不安全 JSON。
10. 原始 New-EventQueryAdapter 的编码启动、输入/输出管道及精确句柄终止，接入纯休眠 worker 和原始 deadline pump。
11. 原始 verifyFreeze 使用缓存原字节和内存 commit 读取替身，检查 22 payload + 2 manifest；这不是远端回读。
12. 无 protection setup 时不调用任何原生清理效果。

第 10 组使用 2000 ms 总预算、500 ms 终止预留、250 ms 调度容差，实测 `waitMs=1533`，`queryStatus=timeout`、`helperExited=true`、`collectionComplete=true`、`receiptComplete=true`、`bounded=true`，并保留已收集的合成 eventId=1000。worker 函数体替换为读入配置、输出合成事实和休眠；生产工厂、管道、终止 shim 和 pump 未重写。没有执行真实事件查询。提交测试另覆盖迟启动、超时取消、排水失败、未知 worker 和实际 worker 的注入式无事件查询。

审查夹具调试中修正过 PowerShell 动态作用域同名变量和 VM 的 Error realm 配置；它们不属于产品缺陷，不计入 74 项结果。最终上述 12 组均完成断言。

### 冻结身份与 SHA-256

所有 24 个文件均读取原始字节、计算长度及 SHA-256。22 个 payload 对照两份清单全部匹配；父清单绑定、两个组合摘要及 D0 清单自身摘要也匹配用户指定身份。无换行归一化。

| 范围 | SHA-256 |
| --- | --- |
| parent 16 payload 组合 | `8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795` |
| parent freeze 原字节 | `942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c` |
| 新 D0 6 payload + parent 绑定组合 | `1fe53a9683c9eb9338a85569909f22bf3c948e83fc44159e15d4f1da822b619c` |
| 新 D0 freeze 原字节 | `8b8311b19e5ddc5a591c1cba38f06fae0ce7a463348f67fd8cf62ee02425802b` |
| 独立 all-24 aggregate | `06f3735fd283319cf91699ea6662f6293594ada6cc5c2e57a4f7f39e9d00c1a9` |

all-24 aggregate 算法沿用上文：POSIX 相对路径升序排列的 `{path,size,sha256}` 数组，按此键序 `JSON.stringify`，UTF-8、无结尾换行，再求 SHA-256；包含两个 manifest，不包含报告。

父 17 文件的逐文件 SHA/大小与上文表格完全相同。本次七个 D0 文件如下：

```text
b2bf4b7004b210d039b281978a50e330101b9cded23c74c75c8e52c2c40f160a   2431  .github/workflows/windows-installer-diagnostic.yml
8ab68c6e344f3e8a1b50fde5b289df02e2350736311f7480edcaee4d57b3df31   7936  tools/native-acceptance/windows-diagnostic/README.md
1cec71a18afc89c59da03ce1f8a0619c8871c41afcbfbb6610d730707a929ef7  22567  tools/native-acceptance/windows-diagnostic/deadline.test.mjs
a2a8a02da5b3b0743e4a6cba8f3ee374c161a00d1216beff2896ab86550df347  28755  tools/native-acceptance/windows-diagnostic/diagnostic.mjs
8b8311b19e5ddc5a591c1cba38f06fae0ce7a463348f67fd8cf62ee02425802b   1593  tools/native-acceptance/windows-diagnostic/freeze.json
62f401317ab797217bfbd0521f05ebde02b3277e69d2457791e590100de4745a  42074  tools/native-acceptance/windows-diagnostic/observe.ps1
93b99c53d629a2024b743a5d58ac192d958cd658d64c772acaf2c4f8330085c9  21264  tools/native-acceptance/windows-diagnostic/offline.test.mjs
```

声明的 remote 基线为 `2dc13874d413a3bcf5c4c7ff0f81a4bd3150240f`。本轮未访问远端，也未证明包含新七文件的候选 commit 已存在或与这些原字节相同。

### 解除阻断条件及保留风险

只允许实现代理在 D0 范围补足 `Stop-Identified` 的退出确认及相应回归测试，验收者本轮不修改源码。终止请求之后必须用已识别进程的句柄或等价、严格校验身份的有界机制确认退出；仍存活、超时、确认失败或身份不明时返回非成功，保持隔离且禁止恢复。不能把“停止请求已发送”当作“退出已确认”，不能让等待无限增长。

修复后须覆盖终止延迟、终止请求返回但尚未退出、退出查询失败、PID 身份变化和最终确认退出；执行完整 PS 回执到 JS restore 的接线反例，保留失败 attempts 和原始安装器错误。不得更改冻结 parent。重新生成 D0 freeze、交付新 immutable snapshot，独立复验后才可重新考虑一次 D0。

即使后续获得本地预检 READY，父任务仍必须先完成远端候选 commit 的全部 24 文件原字节回读与两清单核对，再触发固定 `codex/diagnose-windows-installer-1.0` 分支、GitHub-hosted `windows-latest`、run_attempt=1 的一次 D0。push 本身也可触发该 workflow，不能把 push 当作无执行副作用的验证步骤。新 run ID 不构成额外实验授权；无 D1 自动重试、旧 runner 回退、重签或重编译。

固定执行输入仍只能是原始 Windows 1.0.0 installer：size `166547210`，SHA-256 `f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b`，产品源提交 `41f8429149f646c7dec7f1610082702e7d9cce48`。本轮仅核对其冻结声明和选择逻辑，没有下载或重新计算 EXE 实物摘要。冻结下载器仍获取两版本，但只允许执行 1.0，不运行 1.1，不做升级。

保留风险：CIM 有界快照可能遗漏短命后代；`unknownDescendant=false` 仅指已跟踪身份的清理结论，不代表完整进程覆盖。原父防火墙仍是产品 EXE 特定规则，不代表整个安装器及任意后代全网隔离。P3 的 `bounded` 是带退出/收集证明的观察结果，不是 OS 启动或调度永不阻塞的实时保证；超预算必须如实失败。真实 Get-WinEvent、模块消失、签名读取、Node 20 和 hosted Windows 环境尚未验证。

R0 run `37726873605` 的原始 `0xC0000005 / System.dll` 问题继续保留，不推定根因、不撤销历史失败。D0 诊断结果即使将来收集成功，也不等于原生产品或 1.0→1.1 升级验收通过。

## 2026-10-08 再追加：具体进程实例退出确认修复独立复验

### 最终预检结论与候选绑定

**D0_READY_FOR_ONE_HOSTED_RUN，限下列候选及冻结字节，并须先完成触发前门禁。**

原 P1“发出终止请求即认定退出”的实质阻断已解除；P2/P3 未发现回归。此前两个快照的 BLOCKED 结论保留为历史，不适用于此次不同字节的候选。本结论不是 D0 已执行、不是原生安装成功、不是产品发布或升级验收通过。

| 身份 | 本次绑定 |
| --- | --- |
| 唯一源码快照 | `K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95`，24 文件 |
| 候选 commit | `9345c6a07f5e5e49c8652212ff728791f57bb77d` |
| 候选 tree | `17612aa60f648178634bb04e96a6910aaaae4120` |
| 候选 parent commit | `2dc13874d413a3bcf5c4c7ff0f81a4bd3150240f` |
| 冻结 parent 组合 | `8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795` |
| parent freeze SHA-256 | `942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c` |
| 本次 D0 组合 | `21eb31013f7c81900d2bc9b401fd7dc371d7e66ec7db7cc386cd3e6f4c4644b6` |
| 本次 ownfreeze SHA-256 | `ad2534d59a127f7b2642d94885d9d5f231aebd80c0c4841056d80b78a361f3dc` |
| 独立 all-24 aggregate | `697e835187f9829a06b91610b6ba651d5b35c27efcfc12e299fa8a293d9fc095` |

**证据来源区分：**本地 24 文件原字节、逐文件大小和 SHA-256、两份清单及组合摘要由本轮独立计算/核对。候选 commit/tree/parent、未挂任何 ref、未触发 CI，以及 contents API `encoding=base64` 对全部 24 文件逐一回读且与此快照匹配，来自用户转述的父任务证据。本轮没有联网独立回读候选，不把父任务的远端验证写成独立执行。候选字节绑定以该父任务回读证据为前提。

### 原 P1 反例的完整接线复验

从本次冻结 PS 字节的 AST 提取原函数及实际 cleanup 分支，执行 `Stop-Identified → Invoke-OwnedExitConfirmation → Get-OwnedCleanupReceipt → Get-SavedOwnedCleanup → cleanup JSON`。持久化读取/写入和进程适配器在这一组为内存替身；不调用真实 CIM 或任意用户进程。产生的真实分支 JSON 再交给原始 JS `cleanup → observer → cleanupWithEffects → 父 platformCommand`，只替换外部效果。没有复制一个简化版 restore 条件代替真实 JS 门禁。

原“kill-request-but-alive”反例结果：

```text
stillLive                    = true
acquires                     = 1
termination requests         = 1
exit polls                   = 301
elapsedMs                    = 3000
observer.succeeded           = false
remainingOwned               = 1
unknownDescendant            = true
persisted exitConfirmed      = false
actual JS calls              = observe:cleanup
parent protection restoration= NOT CALLED
protectionState              = retained
```

另有延迟 30 ms 才退出、已自然退出、PID 身份不符、拒绝打开、身份查询异常、退出查询异常、非布尔退出值、终止异常、终止返回 false、获取句柄耗时 3101 ms，共 **11 个 PS→真实 JS 场景**。只有已退出和延迟后确实退出两个正向场景请求恢复；其余 9 个场景均 retained，且没有写入成功退出证明。假时钟和合成 PID 只证明控制流，不作为原生退出事实。

关键实现位置：

- [observe.ps1:352](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:352)：原生 shim 在同一个实例句柄上获取创建 FILETIME、镜像身份、退出信号并请求终止。
- [observe.ps1:397](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:397)：观察到进程时捕获具体实例，保存精确 FILETIME 和 retained handle。
- [observe.ps1:416](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:416)：生产 adapter 复用实例句柄，核对精确创建时间及镜像摘要，终止后不重开 PID 来确认另一个实例。
- [observe.ps1:449](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:449)：3000 ms 预算和 100 ms 调度容差，只有 bool 类型的退出确认才可成功，异常/超时均 false。
- [observe.ps1:479](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:479)：校验记录、使用实例确认并仅在确认后标记 `exitConfirmed`。
- [observe.ps1:165](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:165)：私有记录反序列化、UTC 线格式恢复及实例证明持久化。
- [observe.ps1:514](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:514)：实际 cleanup 汇总分支；[diagnostic.mjs:280](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/diagnostic.mjs:280) 仍是恢复的正向门禁。

### 生产 adapter、真实受控进程与持久证明

审查者另行启动 **4 个仅属于本次测试的隐藏 PowerShell 子进程**，只休眠或自然结束。使用冻结源中的真实 `D0OwnedProcessHandle`、`Register-OwnedProcess`、`New-OwnedProcessAdapter` 和退出确认函数；没有目标安装器、产品进程或真实事件查询。

| 场景 | 实际终止请求数 | 独立实例句柄所见 | 清理结果 |
| --- | --- | --- | --- |
| 受控休眠子进程，确认后终止 | 1 | 已退出 | succeeded=true，测得约 51 ms |
| 已捕获实例自然先退出 | 0 | 已退出 | succeeded=true，测得约 4 ms |
| 真实子进程但镜像摘要不符 | 0 | 仍存活 | succeeded=false，remainingOwned=1 |
| 真实子进程但创建实例时间不符 | 0 | 仍存活 | succeeded=false，remainingOwned=1 |

两个正向场景的 `createdFileTimeUtc` 都与该真实句柄返回的内核 FILETIME 完全相同。仅将这两个真实退出产生的记录做 JSON 往返后交给原始 `Get-SavedOwnedCleanup`，并将新建 adapter 替身设为“一旦尝试重开 PID 就抛错”；重复清理仍成功。因此重复成功不是靠重新按 PID 终止或误认后继实例。

这一组私有保存路径使用内存 I/O 替身，验证原始序列化、解码及复用逻辑。提交的 deadline 套件另在 K 盘专用临时目录完成真实文件写入/读取的同类回归。两者都不是产品目录操作。

错误镜像/错误创建实例场景在断言时仍存活，证明生产 adapter 没有向它们发出清理终止请求。随后由审查夹具持有的独立确切句柄终止并回收这两个测试子进程；没有按名称或未验证的 PID 清理。

时间精度检查：FILETIME 以 long 和十进制字符串保留，不经过 JS 浮点值；捕获时对 CIM 微秒截断仅允许同一微秒内的 0..9 tick，随后破坏性操作要求精确 FILETIME 相等。[observe.ps1:118](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:118) 及提交回归覆盖大于 2^53 的时间、下一微秒、前一 tick、精确值变化。PID 获取前复用被拒绝；获取后保持原句柄的复用情形由确定性实例替身验证，未声称在本机强行制造了真实 PID 回收复用。

资源边界：shim 在 Open 之后查询失败时调用 Release，身份不符时也 Release；成功或等待失败的已识别句柄有意保留到观察器进程结束，避免在重试中打开后继实例。Release 是非等待式 CloseHandle，并清零以支持重复释放；独立真实测试完成了两次 Release 和测试句柄回收。没有将“进程结束时 OS 回收句柄”写成每条路径都立即显式释放；未做长期句柄泄漏压力测试。单实例预算不等于任意数量后代的总清理预算，外层超时仍是兜底，未确认时不能撤防。

### 私有证明的信任边界与公开证据白名单

必须区分“退出证据的来源”与“记录格式验证”。`exitConfirmed=true` 的 tombstone 快捷路径，假设输入来自该受控 case 之前由工具写入的私有记录；它不是签名证书，也不是任意 JSON 的退出鉴定器。独立边界检查确认：一个完全合成、字段和时间均合法的 true tombstone 也会被内部 `Stop-Identified` 接受，而且不会打开进程。**该检查不计作真实退出通过，也不能拿合成或外部提交的 JSON 替代私有可信退出记录。**

本次可放行范围是未经外部注入、一次性、GitHub-hosted 受控 case，生产入口无外部 adapter 注入，私有记录由原始观察器链生成。未发现该执行路径会把提交测试的合成 tombstone 导入生产 case。本结论不提供抵抗同权限恶意改写 case 文件的保证；若后续运行出现私有记录被替换、外部导入或来源不能建立，应继续保留防护并阻断，不能仅凭 `exitConfirmed` 字段放行。

公开 JSON 白名单未扩大到 `exitConfirmed` 或 `createdFileTimeUtc`。独立执行确认两种私有字段都会被公共 `sanitizeEvidence` 拒绝；实际 cleanup 的公共回执保持可接受。原始 rawModulePath、嵌套 commandLine/message、Bearer 字符串、绝对路径及任意异常属性继续被拒绝或抑制。查询 worker 仍只通过匿名内存管道交换原始路径信息，不上传私有记录。

### Node 20 独立执行与 P2/P3 回归

实际使用 Node **v20.20.2，Windows x64，process.versions.modules=115**；PowerShell **7.6.5**。没有改变系统 PATH、项目依赖或 node_modules，没有重建任何原生模块。此运行时覆盖不等于 Electron ABI 验收。

```powershell
$env:NODE_PATH = 'K:/AI/person/money/RT-ResearchFlow/node_modules/.pnpm/js-yaml@4.3.0/node_modules'
$env:TEMP = 'K:/AI/person/money/.tmp'
$env:TMP = $env:TEMP
# 工作目录：K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95
& 'K:/AI/person/money/.tmp/rt-node20-test-Q3NSRB/unpacked/node-v20.20.2-win-x64/node.exe' --test tools/native-acceptance/windows-diagnostic/offline.test.mjs tools/native-acceptance/windows-diagnostic/deadline.test.mjs
```

独立结果：**89 tests / 89 pass / 0 fail / 0 skip / 0 cancelled；4961.951 ms。** 不使用开发方 4917 ms 作为本轮结果，也不把父任务 Mac 39/39 并入。

另执行 **13 组审查者控制的检查**，不与上述 89 项相加制造统一覆盖率。其中包括 11 场景完整跨语言接线、4 个真实受控子进程和 2 次真实来源证明复用；其余验证私有字段不可公开、负向/异常恢复门禁、部分恢复失败为 unknown、真实 main 的两次 attempts、父 WFP 分类、实际下载器参数错误、安全证据门禁、非零 observer JSON、24 文件原始冻结验证及无 setup 时不调用原生清理。

P2：实际父 `platformCommand` 的 `WFP_AUDIT_UNAVAILABLE/BLOCKED_ENVIRONMENT` 经真实 JS run 接线保留，errno/signal 保留，安装调用为零。恢复失败保留 `AUDIT_RESTORE_FAILED` 且 protectionState=unknown；实际下载器参数错误仍为 `UNSUPPORTED_PLATFORM_ARCH/BLOCKED_INPUT`。原始安装器崩溃和两次清理历史仍保留。

P3：本次提交 suite 的慢查询、取消不等于退出、排水不完整、迟启动、调度超时、未知 worker、偏移时区、59250 ms 无事件窗口、边界完成以及真实隐藏 query-sleep 子进程检查全部通过。事件查询预算仍为 59250+250+500=60000 ms、调度容差 250 ms；本轮没有执行真实 Get-WinEvent，不将隔离结构检查称为真实事件服务通过。

### 本轮变化文件与原字节校验

父 17 文件以及 workflow、driver、README、offline.test 的摘要和上一轮完全一致。变化仅为 observer、deadline.test 及 ownfreeze：

```text
51e2241b3cd8f68d0b406dfd1c9b50f8db09da9ac9d8b74b26d91eaf70f64b70  52583  tools/native-acceptance/windows-diagnostic/observe.ps1
c342adb8d61494ef1f58a7f8cf50bd253532e51dac36b40ad589efc0c27fddd4   35264  tools/native-acceptance/windows-diagnostic/deadline.test.mjs
ad2534d59a127f7b2642d94885d9d5f231aebd80c0c4841056d80b78a361f3dc   1593  tools/native-acceptance/windows-diagnostic/freeze.json
```

全部 24 文件均按原字节读取校验，没有 EOL 归一化。all-24 aggregate 使用上文同一算法，包含两个 manifest。未读取 canonical 正在变化的 Mac 源码作为 parent，也未修改任何源码或 immutable snapshot；本轮持久化交付仅追加本报告。

### 触发前仍必须满足的条件

1. 使用且仅使用上表候选 SHA 与本次 `21eb.../ad253...` 冻结身份。父任务保存全部 24 文件远端原字节回读证据；任何字节或候选改变都不能沿用本结论。
2. 父任务完成 candidate/default 的全部 workflow 触发链检查，并确认目标分支没有 open PR 引起非目标工作流。用户最新消息中该检查仍在进行；**本报告不宣布它已完成**。发现非目标触发则继续阻断，不得创建/更新触发 ref。
3. 以上门禁均满足后，最多一次在固定 `codex/diagnose-windows-installer-1.0` 分支、GitHub-hosted `windows-latest`、run_attempt=1 的 D0。push/ref 更新可能自身触发，不能再额外 dispatch 重复运行；换 run ID 也不是新预算。没有 D1 自动重试、旧 runner 回退、重签、重编译或升级运行授权。
4. 只执行原 release Windows 1.0.0 installer，size `166547210`、SHA-256 `f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b`；源提交 `41f8429149f646c7dec7f1610082702e7d9cce48`。冻结下载器获取两版本不构成执行 1.1 的授权。本轮没有下载或重新哈希 EXE 实物。

本轮没有 push/ref 更新、CI、安装/卸载、交易、真实券商/密钥访问、用户进程操作、注册表/防火墙/审计/真实 Get-WinEvent 操作。D0 是否可触发必须按上述门禁交集判断，不仅看 READY 字样。

残余限制仍包括：CIM 可能遗漏短命后代；unknownDescendant=false 只表示已跟踪记录的清理结论，不是全进程覆盖；父规则不是整个安装器及任意后代的完整网络封锁；原生 OS 查询/进程启动不具硬实时保证；私有证明依赖受控来源；hosted 环境、真实事件可用性、模块消失和原始 installer 实际行为仍待那一次 D0。R0 `37726873605` 的 `c0000005 / System.dll` 事实保持，不推断根因、不把结构安全或诊断完成升级为产品验收。

### 同日补充：父任务触发链审计已报告完成

上文“触发链检查仍在进行”是写入时的状态。随后用户补充父任务只读核对结果如下；本节更新该状态，不改动独立源码/测试结论。

**来源限定：以下远端状态与触发链结论来自父任务，由用户提供。本审查者没有亲自执行该远端审计，也未另行读取其审计文件。** 父任务报告已保存各 workflow 原始内容、blob SHA 和解析后的触发条件至 [audit.json](K:/AI/person/money/.tmp/rt-trigger-audit-utpuit/audit.json)。

- 候选 `9345c6a07f5e5e49c8652212ff728791f57bb77d` 共 7 个 workflow；向固定 D0 分支 push 只匹配 `windows-installer-diagnostic.yml`，权限为 `contents: read`。
- `native-upgrade` 仅匹配 `codex/acceptance-1.0-to-1.1`；`macos` 匹配 main、`codex/macos-support` 及 PR-main；`release` 匹配 `codex/release-1.1` 与 v* tag；`verify` 匹配 main/PR-main；`windows-build` 仅匹配 `codex/macos-support`；`upstream` 仅 schedule/dispatch。
- 审计时 default main 为 `ba24a131f750016c8dd08ac77a18357be84988a9`，仅有 `release.yml`（v* tag）和 `verify.yml`（main/PR）；未发现 create、workflow_run 或 pull_request_target 触发链。
- 目标 `codex/diagnose-windows-installer-1.0` 分支的权威 GET 返回不存在；`head=hzqedison:codex/diagnose-windows-installer-1.0` 的 open PR 列表为空。
- 父任务仍未创建/更新触发 ref，未执行 D0 或原生安装，并将在触发前再次检查 default SHA、PR 和分支状态。

基于该明确归属的父任务审计证据，**D0_READY_FOR_ONE_HOSTED_RUN** 继续绑定候选 `9345c6a07f5e5e49c8652212ff728791f57bb77d`、D0 组合 `21eb31013f7c81900d2bc9b401fd7dc371d7e66ec7db7cc386cd3e6f4c4644b6`、ownfreeze `ad2534d59a127f7b2642d94885d9d5f231aebd80c0c4841056d80b78a361f3dc`。静态触发链门禁已有父任务提供的通过证据；执行前新鲜度检查仍不可省略。若 default、分支、PR、候选字节或触发链发生变化，应先重新核对，不得把本次授权扩展到其他候选、其他工作流或第二次运行。没有额外 dispatch、D1 重试或产品验收授权。

## 2026-10-08 唯一 D0 运行终态及独立原生证据审查

### 结论：诊断门禁失败，安装器未调用，清理未确认

**运行已结束：failure。D0 安装器诊断目标未完成；原生产品结论为未执行/不能验收；upgradeAccepted 始终为 false。**

首次独立读取权威 REST 时，该运行已是终态，不需要再次等待或重试。此前 READY 的一次运行授权已经使用；安装器 invocationCount=0 不退还 workflow 运行预算，不能据此自动重跑或创建 D1。

1. 首个实际失败为 `DIAGNOSTIC_ERROR / LAUNCHER_TOKEN_UNAVAILABLE`，发生在观察器 `pre-install-guards`，不是 NSIS 或 System.dll 新崩溃。
2. 实际 `installation.attempted=false`、`invocationCount=0`、`exitCode="unavailable"`、`timedOut=false`。没有执行 1.0 安装器，没有执行 1.1 或升级。
3. 两次 cleanup attempts 均失败，`restorationAttempted=false`、`protectionState=retained`、`preserveIsolation=true`。不能写成已清理或已恢复原审计状态。
4. 证据已成功形成并上传，完整性校验通过；但 JSON 的 `complete=true` 只表示驱动控制流终结，不能改写 `status=DIAGNOSTIC_ERROR`，也不表示安装器诊断完成。

### 独立读取的权威来源与执行身份

本节的 run、attempt-1 jobs、日志、artifact metadata 及下载后的 ZIP/JSON 均由本审查者实际读取，不仅转述父任务结果。使用 GitHub 只读 connector/API；下载产物只在内存中校验和解包，没有执行其中任何内容，没有本机安装器运行。

- [D0 run 37736052823](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37736052823)：attempt `1`、event `push`、branch `codex/diagnose-windows-installer-1.0`、workflow `.github/workflows/windows-installer-diagnostic.yml`。
- REST `head_sha=9345c6a07f5e5e49c8652212ff728791f57bb77d`，与审定候选相同；run `status=completed / conclusion=failure`。
- run 创建/开始 `2026-10-08T06:09:08Z`，终态更新时间 `2026-10-08T06:09:51Z`。
- [D0 job 113175709312](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37736052823/job/113175709312)：attempt-1 jobs REST 的 `total_count=1`，job 名 `diagnostic`、label `windows-latest`、runner group `GitHub Actions`，开始 `06:09:10Z`、完成 `06:09:51Z`。
- [脱敏 artifact 11531428764](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37736052823/artifacts/11531428764)：名称 `windows-installer-D0-37736052823-1`；metadata 绑定同一 run、branch、head SHA。
- [R0 Windows job 113147009285](https://github.com/hzqedison/RT-ResearchFlow/actions/runs/37726873605/job/113147009285)：本轮另行只读获取其日志，专用于实际 Node、runner 镜像及 OS 对比，没有跟踪或启动其他新运行。

本轮只读访问既有 D0 与历史 R0。未调用 rerun、dispatch、cancel，未创建新 run/ref/PR/tag，未改源码、runner 或 profile。独立读取到 attempt=1 不等于另做了全仓库所有触发的枚举；“唯一原子触发、未额外 dispatch”仍保留父任务先前提供的审计来源。

### Jobs/steps 核对

以下时间均为 2026-10-08 UTC，来自 attempt-1 jobs REST；步骤日志与之吻合。

| 步骤 | 时间 | 结果 |
| --- | --- | --- |
| Set up job | 06:09:11 | success |
| checkout 审定候选 | 06:09:11–06:09:16 | success |
| setup-node 20 x64 | 06:09:16–06:09:24 | success |
| 首次 hosted Windows case 门禁/init | 06:09:24–06:09:25 | success |
| D0 与 parent 原字节/commit blob 核对 | 06:09:25–06:09:29 | success |
| 冻结下载器获取原发布资产 | 06:09:29–06:09:32 | success |
| Single D0 invocation 驱动步骤 | 06:09:32–06:09:46 | **failure** |
| Always cleanup | 06:09:46–06:09:47 | **failure** |
| 发布脱敏 JSON | 06:09:47–06:09:48 | success |
| upload-artifact | 06:09:48 | success |
| Post setup-node | 06:09:48 | skipped |
| Post checkout | 06:09:48–06:09:50 | success |
| Complete job | 06:09:50 | success |

“Single D0 invocation”是步骤名称，不是安装器已经启动的证据。两条日志 `Process completed with exit code 1` 分别属于诊断驱动和 cleanup 步骤，不能用作安装器退出码。Post checkout/Complete job 成功也不表示产品进程和审计状态清理成功。

### 产物完整性及公开 JSON 审查

GitHub metadata、上传日志中的 ZIP digest 与独立下载字节的 SHA-256 三者相同。ZIP 只有一个普通 JSON entry，没有附带私有 registry、原始事件、模块、安装器或可执行内容。

| 对象 | 字节数 | SHA-256 |
| --- | ---: | --- |
| artifact ZIP | 2719 | `f33c9c793638372748673bc0e35854ebf62fa00c61c1b39df00ed08f3ac66e3f` |
| `windows-installer-d0.json` | 10529 | `87c1f6bc7534209ff942670edd51011baee9b51492aa5162070b846e03f25e98` |

artifact 创建于 `2026-10-08T06:09:48Z`，metadata 当时 `expired=false`，到期时间 `2026-10-22T06:09:48Z`。本轮未另存 ZIP 或私有数据到产品目录；报告中的摘要是原始字节摘要，不是 JSON 重新排版后的摘要。

对 JSON 的独立递归检查覆盖 39 个对象、128 个字符串，键均在已审定的公开字段集合内，未出现 raw event/message/commandLine、绝对路径、Bearer/指定凭证模式或私有 `exitConfirmed/createdFileTimeUtc`。数组大小、字符串长度及有限数值形状通过检查。此为本次产物内容检查，不宣称任意字符串的通用秘密识别能力。

JSON 身份如下，均与已审定快照一致：

```text
runId                 37736052823
attempt               1
caseId                e0a8ad0c-8e64-4fa2-a781-baf4f034103b
harness/sourceCommit  9345c6a07f5e5e49c8652212ff728791f57bb77d
D0 combined           21eb31013f7c81900d2bc9b401fd7dc371d7e66ec7db7cc386cd3e6f4c4644b6
D0 freeze             ad2534d59a127f7b2642d94885d9d5f231aebd80c0c4841056d80b78a361f3dc
parent combined       8fef94360d98b7be394def53a2f455794a8ac12707136a42971c7dbff67a6795
parent freeze         942aa01bdc012b180bcc40aa880944d703d190cec3ca577246f60f1f31ac063c
filesVerified         22 payload（另有两份 freeze 的 commit 字节绑定）
```

### 首个失败、旧包及未发生的安装观察

首个失败原样保留：

```json
{
  "kind": "DIAGNOSTIC_ERROR",
  "stage": "pre-install-guards",
  "errorClass": "Error",
  "description": "Raw exception text and paths suppressed.",
  "code": "LAUNCHER_TOKEN_UNAVAILABLE"
}
```

外层 primary 与 installation.primary 一致，未被后续 cleanup 替换。外层 secondary 保留 **两条** `D0_CLEANUP_FAILED`；installation.secondary 另保留 `OWNED_PROCESS_CLEANUP_INCOMPLETE`。不能把这些后续清理错误改写成首因。

| 证据项 | 实际值及解释 |
| --- | --- |
| release 输入 | 1.0.0 / v1.0.0，源提交 `41f8429149f646c7dec7f1610082702e7d9cce48` |
| before.size / after.size | 均为 `166547210` |
| before.sha256 / after.sha256 | 均为 `f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b` |
| unchanged | true；这里是驱动前后采样，不能描述为“已完成安装后的包检查” |
| attempted / invocationCount | false / 0 |
| installer exitCode | unavailable；没有本轮安装器退出码 |
| timedOut / autoStartedProduct | false / false；不能推广为已测安装器不会超时或自动启动 |
| installation.finalStage | pre-install-guards |
| processes / events / moduleCandidates | 均为空数组 |
| eventObservation | 未生成，查询阶段未执行，不是“查询后未找到事件” |
| launcher token/identity | 未得到可用的公开身份/令牌报告；没有安全原生错误码细节 |

驱动外层在 `06:09:39.916Z` 记录 `single-native-invocation`，观察器在 `06:09:40.3316560Z` 进入 `pre-install-guards`，随后在实际 `Start-Process` 前失败。前者表示向观察器派发，不是 installer launch。参数形状 `/S /D=<CASE>/install` 也是预备记录，本轮没有实际安装器命令执行事实。

现有证据只能定位到 launcher token 信息不可用的门禁。无法区分具体是 OpenProcess、OpenProcessToken、某个 GetTokenInformation 调用失败，还是读取/封送层的其他问题，因为产物没有这些 API 的独立返回状态和安全数字错误码。不能把 unavailable 解读为“非管理员”，不能归因 Defender、ASLR、系统策略、DLL 损坏或产品缺陷。

### WFP/protection setup 与所有 cleanup attempts

`protectionSetupCalled=true`、`probeReachable=true`。观察器已输出 preflight：`emptyTarget=true`、`registrationsBefore=0`、`productProcessesBefore=0`、`protectionUnchanged=true`。结合冻结源码及阶段顺序，可确认父 setup 返回并进入了后续观察器，原规则和审计备份存在性门禁通过；这不是 Security 5157 拒绝事件计数，也不是整个安装器及任意后代的完整网络隔离证明。

| 清理层/尝试 | 时间 | 状态 |
| --- | --- | --- |
| 观察器 finally 的 cleanupOwned | 本轮 pre-install 失败之后 | succeeded=false、remainingOwned=1、unknownDescendant=true、ownershipRegistry=missing、ownedCheckedCount=0 |
| 外层 cleanup.attempts[0] | `2026-10-08T06:09:46.854Z` | succeeded=false、protectionState=retained、restorationAttempted=false、preserveIsolation=true |
| always-cleanup 的 attempts[1] | `2026-10-08T06:09:47.751Z` | 同上；第一条及其详情未被覆盖 |

两次 attempts 的 observer records 都保留 `ownershipRegistry=missing / remainingOwned=1 / unknownDescendant=true / ownedCheckedCount=0`，随后是 `cleanupProtection=false`、scope `protection-retained-until-owned-process-exit-established`。没有 StopConfirmed/private proof 可以支持安装器/后代已退出的结论。

查询 worker 的子回执均为 `helperOwnership=not-started`、`terminationStatus=not-started`、`remainingOwned=0`、`helperExited=true`。它表达“该 worker 从未启动”的契约，不是成功杀死 worker 的原生证据，更不能覆盖整体 cleanup=false。

根据已审冻结控制流，[observe.ps1:531](K:/AI/person/money/.tmp/rt-windows-d0-exit-ctAr95/tools/native-acceptance/windows-diagnostic/observe.ps1:531) 在 pre-install 门禁之前就写入调用 claim；实际 Save-Owned 位于启动安装器之后。此次提前失败与“claim 已占用、ownership registry 缺失”的 fail-closed 结果相符。`remainingOwned=1` 是缺失可信清理证据的阻断哨兵，**不是实测有一个安装器进程残留**；既不能断言确有残留进程，也不能据 invocationCount=0 抹去保守清理失败。

本轮没有请求父 protection restore，审计恢复未获证明。日志末尾 `Cleaning up orphan processes` 及 hosted runner 的一次性性质不能替代工具的成功清理回执，也不能证明规则/审计原状态已恢复。

### 实际 Node/runner 与 R0 对比

独立获取 D0 job 与 R0 Windows job 日志，逐项比对：

| 项目 | R0 37726873605 | D0 37736052823 |
| --- | --- | --- |
| 外部诊断/harness Node | v20.20.2 x64 | v20.20.2 x64 |
| runner agent | 2.337.0 | 2.337.0 |
| OS | Microsoft Windows Server 2025 | Microsoft Windows Server 2025 |
| OS build | 10.0.26100 | 10.0.26100 |
| 日志 Runner Image | windows-2025-vs2026 | windows-2025-vs2026 |
| Image Version | 20260925.250.1 | 20260925.250.1 |

这些实际报告字段相同，没有据此观察到换 runner image。D0 日志同时说明 checkout/setup-node/upload-artifact 等 Actions 自身被平台强制使用 Node 24；这不改变 setup-node 后显式运行 `node diagnostic.mjs` 的 **v20.20.2**。Actions 内部 Node 与诊断脚本 Node 不可混为一谈。

必须保留产物中的一个比较口径问题：JSON `runner.image="win25-vs2026"` 来自 ImageOS，而内嵌 historical.image 是日志显示名 `windows-2025-vs2026`；JSON 本轮还没有 osBuild，因为 token 门禁在 OS 观察之前失败。驱动字符串比较因此输出了 `new-environment-diagnostic-observation; not-strict-R0-reproduction`。该原值不修改，但**不能把它当作确实换镜像的证据**；本轮更完整的两份 job 日志显示相关字段相同。

即便这些字段相同，也没有证明所有未观察环境变量完全相同，更没有发生严格 R0 复现：此次安装器调用为零。JSON historical 中的 `-1073741819 / c0000005 / System.dll / 00001581` 全是预先写入的 R0 历史常量，不是本轮新采集事件。R0 原失败继续保留，本轮没有增加其根因证据。

### 后续最小方案，仅供另行审定

不得重跑 `37736052823`，不得自动创建 D1、换 runner/profile 或重编译旧产品。若继续调查，建议先单独审定一个**不含安装器的只读 launcher-token 自检**：只观察该测试进程自身，固定当前 Node、runner/image 与调用方式，为 OpenProcess/OpenProcessToken/两种 GetTokenInformation 分别记录调用成功与否和白名单内数字错误码，不导出 token、SID 明文或原始异常。

该方案只改变诊断可观察性，不放宽 token 门禁，不执行 NSIS，不移除保护。先用隔离测试覆盖成功、拒绝、返回长度和封送失败；取得具体 API 失败证据后再决定是否需修工具。环境比较的显示名/ImageOS 归一化，以及 pre-launch claim 与可信 never-started 回执的区分，应作为明确、另审的工具改进，不能趁机把未知状态改成 cleanup 成功。

本节只完成现有唯一运行的证据审查，没有实施上述方案。结论保持：**运行终结且证据可核验；诊断目标未完成；本轮原生安装未执行；清理未确认、防护保留；升级/产品验收不授予。**
