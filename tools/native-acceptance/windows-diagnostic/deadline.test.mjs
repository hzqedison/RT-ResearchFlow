import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Parse the real observer, execute ONLY its extracted pure deadline/attribution
// functions. No observer entry point, native adapter, Get-WinEvent, installer,
// registry, firewall, or audit call is executed, even on Windows.
const observer = fileURLToPath(new URL('./observe.ps1', import.meta.url));
const harness = String.raw`
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:D0_OBSERVER_SOURCE,[ref]$tokens,[ref]$errors)
if($errors.Count) { throw 'OBSERVER_AST_INVALID' }
$names=@('Invoke-QueryDeadline','Get-QueryCleanupReceipt','Get-OwnedCleanupReceipt','Invoke-EventQueryWorker','Match-Event','Number-Id',
  'Digest','Test-OwnedCreationCapture','Get-SavedOwnedCleanup','Initialize-OwnedExitType','Register-OwnedProcess','New-OwnedProcessAdapter','Invoke-OwnedExitConfirmation','Stop-Identified')
foreach($name in $names) {
  $functions=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
  if($functions.Count -ne 1) { throw 'PURE_FUNCTION_NOT_UNIQUE' }
  Invoke-Expression $functions[0].Extent.Text
}
function Scenario($Name,$Frames=@(),$ExitDelay=0,$DrainDelay=0,$Ownership='owned-handle',$StartDelay=0,$FailStart=$false,$Oversleep=0,$FrameAt=0,$BudgetMs=100,$ReserveMs=20,$ToleranceMs=5) {
  $state=@{now=0;killAt=-1;kills=0;frames=$Frames;index=0;ownership='not-started';overslept=$false}
  $facts=[Collections.Generic.List[string]]::new()
  $adapter=@{
    Clock={$state.now}.GetNewClosure()
    Start={
      $state.now+=$StartDelay; $state.ownership=$Ownership
      if($FailStart) {throw 'SIMULATED_START_FAILURE'}
    }.GetNewClosure()
    Ownership={$state.ownership}.GetNewClosure()
    Poll={
      if($state.now -ge $FrameAt -and $state.index -lt $state.frames.Count) {
        $frame=$state.frames[$state.index]; $state.index++
        if($frame.kind -eq 'error') {return @{kind='error'}}
        if($frame.kind -eq 'eof') {return @{kind='eof'}}
        return @{kind='frame';frame=$frame}
      }
      if($state.killAt -ge 0 -and $state.now -ge ($state.killAt+$DrainDelay)) {return @{kind='eof'}}
      return @{kind='pending'}
    }.GetNewClosure()
    Terminate={$state.kills++;$state.killAt=$state.now}.GetNewClosure()
    Exited={($state.killAt -ge 0 -and $state.now -ge ($state.killAt+$ExitDelay))}.GetNewClosure()
    Sleep={param($Ms)
      $state.now+=$Ms
      if($Oversleep -and -not $state.overslept) {$state.now+=$Oversleep;$state.overslept=$true}
    }.GetNewClosure()
  }
  $result=Invoke-QueryDeadline $adapter {param($frame) if($frame.kind -eq 'event') {$facts.Add($frame.item)}} $BudgetMs $ReserveMs $ToleranceMs
  return @{name=$Name;receipt=$result;kills=$state.kills;facts=@($facts.ToArray())}
}
$results=@(
  (Scenario 'slow-query'),
  (Scenario 'slow-cancel' -ExitDelay 1000),
  (Scenario 'slow-collection' -DrainDelay 1000),
  (Scenario 'no-events' -Frames @(@{kind='done';status='no-events'})),
  (Scenario 'query-error' -Frames @(@{kind='done';status='unavailable'})),
  (Scenario 'partial-timeout' -Frames @(@{kind='event';item='sanitized-fact'})),
  (Scenario 'partial-error' -Frames @(@{kind='event';item='sanitized-fact'},@{kind='error'})),
  (Scenario 'unknown-owner' -Ownership 'unavailable'),
  (Scenario 'spawn-failed' -Ownership 'unavailable' -FailStart $true),
  (Scenario 'not-started' -Ownership 'not-started' -FailStart $true),
  (Scenario 'late-start' -StartDelay 120),
  (Scenario 'scheduling-overrun' -Oversleep 110),
  (Scenario 'matched' -Frames @(@{kind='event';item='sanitized-fact'},@{kind='done';status='matched'}))
)
$from=[DateTime]::Parse('2026-01-01T00:00:00Z').ToUniversalTime(); $through=$from.AddSeconds(60)
$created=$from.AddSeconds(-1); $processes=@{'41'=@{rawPath='C:\owned\app.exe';createdUtc=$created.ToString('o')}}
$fields=@{ProcessId='0x29';AppPath='C:\owned\app.exe';ProcessCreationTime=$created.ToFileTimeUtc().ToString()}
$compat=@{hex=(Number-Id '0x29');decimal=(Number-Id '41');invalid=(Number-Id 'no-pid')}
$compat.correct=(Match-Event $fields $from $processes $from $through).attribution
$fields.ProcessCreationTime=($created.ToFileTimeUtc()+10001).ToString()
$compat.creationMismatch=(Match-Event $fields $from $processes $from $through).attribution
$fields.Remove('ProcessCreationTime'); $compat.partial=(Match-Event $fields $from $processes $from $through).attribution
$fields.AppPath='C:\other\app.exe'; $compat.wrongPath=(Match-Event $fields $from $processes $from $through).attribution
$fields.ProcessId='42'; $compat.wrongPid=(Match-Event $fields $from $processes $from $through).attribution
$fields.Remove('ProcessId'); $compat.werWithoutPid=(Match-Event $fields $from $processes $from $through).attribution
$compat.outside=(Match-Event $fields $through.AddTicks(1) $processes $from $through).attribution
# Exercise the actual worker loop with a fake clock, fake pause, and fake
# query. All three are explicit arguments: the default native query is NEVER
# invoked. Feed its output into the real parent deadline pump afterwards.
$worker=@{now=$from;queries=0;frames=[Collections.Generic.List[object]]::new()}
$config=@{from=$from.ToString('o');through=$through.ToString('o');queryThrough=$from.AddMilliseconds(59250).ToString('o');processes=@{}}
Invoke-EventQueryWorker $config {$worker.now} {param($Ms) $worker.now=$worker.now.AddMilliseconds($Ms)} {param($From,$End) $worker.queries++} {param($Frame) $worker.frames.Add($Frame)}
$noEvents=Scenario 'worker-no-events' -Frames @($worker.frames.ToArray()) -FrameAt 59250 -BudgetMs 60000 -ReserveMs 500 -ToleranceMs 250
$lateCompletion=Scenario 'worker-late-completion' -Frames @($worker.frames.ToArray()) -FrameAt 59500 -BudgetMs 60000 -ReserveMs 500 -ToleranceMs 250
$workerResult=@{elapsedMs=($worker.now-$from).TotalMilliseconds;queries=$worker.queries;frames=@($worker.frames.ToArray());parent=$noEvents.receipt}
$offsetConfig=$config.Clone()
foreach($key in @('from','through','queryThrough')) {
  $offsetConfig[$key]=([DateTimeOffset]::Parse($config[$key])).ToOffset([TimeSpan]::FromHours(8)).ToString('o')
}
$offsetWorker=@{now=$from;frames=[Collections.Generic.List[object]]::new()}
Invoke-EventQueryWorker $offsetConfig {$offsetWorker.now} {param($Ms) $offsetWorker.now=$offsetWorker.now.AddMilliseconds($Ms)} {
  param($QueryFrom,$End)
  if($QueryFrom.Kind -ne [DateTimeKind]::Utc -or $QueryFrom.Ticks -ne $from.Ticks -or $End.Kind -ne [DateTimeKind]::Utc) {throw 'UTC_QUERY_WINDOW_REQUIRED'}
} {param($Frame) $offsetWorker.frames.Add($Frame)}
$offsetResult=@{elapsedMs=($offsetWorker.now-$from).TotalMilliseconds;frames=@($offsetWorker.frames.ToArray())}
$workerError=@{frames=[Collections.Generic.List[object]]::new()}
Invoke-EventQueryWorker $config {$from} {param($Ms) throw 'FAKE_PAUSE_UNEXPECTED'} {param($From,$End) throw 'FAKE_QUERY_FAILURE_WITH_RAW_PATH_NOT_EMITTED'} {param($Frame) $workerError.frames.Add($Frame)}
$terminal=@{helperOwnership='owned-handle';helperExited=$true;collectionComplete=$true;bounded=$true;receiptComplete=$true;preserveIsolation=$false}
$live=@{helperOwnership='owned-handle';helperExited=$false;collectionComplete=$true;bounded=$true;receiptComplete=$true;preserveIsolation=$false}
$deadIncomplete=@{helperOwnership='owned-handle';helperExited=$true;collectionComplete=$false;bounded=$false;receiptComplete=$false;preserveIsolation=$true}
$bad=@{helperOwnership='owned-handle';helperExited='true';collectionComplete='true';bounded='true';receiptComplete='true';preserveIsolation='false'}
$cleanup=@{
  notStarted=(Get-QueryCleanupReceipt $false $null)
  missing=(Get-QueryCleanupReceipt $true $null)
  corrupt=(Get-QueryCleanupReceipt $true @{})
  live=(Get-QueryCleanupReceipt $true $live)
  confirmed=(Get-QueryCleanupReceipt $false $terminal)
  staleGuard=(Get-QueryCleanupReceipt $true $terminal)
  deadIncomplete=(Get-QueryCleanupReceipt $true $deadIncomplete)
  nonBoolean=(Get-QueryCleanupReceipt $true $bad)
}
$record=@{pid=41;createdUtc=$created.ToString('o');imagePathSha256=('a'*64);category='verified-download'}
$stops=@{count=0}
$owned=@{
  neverStarted=(Get-OwnedCleanupReceipt $false $false $null {throw 'MUST_NOT_STOP'})
  missing=(Get-OwnedCleanupReceipt $true $false $null {throw 'MUST_NOT_STOP'})
  corrupt=(Get-OwnedCleanupReceipt $true $true $null {throw 'MUST_NOT_STOP'})
  nonArray=(Get-OwnedCleanupReceipt $true $true $record {throw 'MUST_NOT_STOP'})
  empty=(Get-OwnedCleanupReceipt $true $true @() {throw 'MUST_NOT_STOP'})
  duplicate=(Get-OwnedCleanupReceipt $true $true @($record,$record) {throw 'MUST_NOT_STOP'})
  unclaimed=(Get-OwnedCleanupReceipt $false $true @($record) {throw 'MUST_NOT_STOP'})
  valid=(Get-OwnedCleanupReceipt $true $true @($record) {param($r) $stops.count++; return $true})
  unidentified=(Get-OwnedCleanupReceipt $true $true @($record) {param($r) return $false})
  error=(Get-OwnedCleanupReceipt $true $true @($record) {param($r) throw 'FAKE_IDENTITY_QUERY_FAILURE'})
  nonBoolean=(Get-OwnedCleanupReceipt $true $true @($record) {param($r) return 'true'})
}
# Optional real-timer integration: only an owned hidden pure-sleep child, never
# the native event worker. Extract just the production zero-wait handle shim.
$real=$null
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
  $factory=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'New-EventQueryAdapter'},$true)
  $compile=$factory.Body.Find({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Add-Type'},$true)
  if(-not $compile) { throw 'OWNED_HANDLE_SHIM_MISSING' }
  Invoke-Expression $compile.Extent.Text | Out-Null
  $childSource='[Console]::Out.WriteLine(''{"kind":"event","item":"controlled-sleep-fact"}''); Start-Sleep -Seconds 20'
  $exe=Join-Path $PSHOME 'pwsh.exe'; if(-not(Test-Path -LiteralPath $exe)) {$exe=Join-Path $PSHOME 'powershell.exe'}
  $info=[Diagnostics.ProcessStartInfo]::new($exe)
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
  $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  $info.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childSource))
  $realState=@{process=[Diagnostics.Process]::new();handle=[IntPtr]::Zero;ownership='not-started';read=$null;clock=[Diagnostics.Stopwatch]::StartNew();kills=0}
  $realState.process.StartInfo=$info; $realFacts=[Collections.Generic.List[string]]::new()
  $realAdapter=@{
    Clock={$realState.clock.Elapsed.TotalMilliseconds}
    Start={
      $realState.ownership='unavailable'
      if(-not $realState.process.Start()) {throw 'SLEEP_CHILD_START_FAILED'}
      $realState.handle=$realState.process.Handle; $realState.ownership='owned-handle'
      $realState.read=$realState.process.StandardOutput.ReadLineAsync()
    }
    Ownership={$realState.ownership}
    Exited={[D0QueryHandle]::Exited($realState.handle)}
    Terminate={$realState.kills++;[D0QueryHandle]::RequestTermination($realState.handle)}
    Poll={
      if(-not $realState.read.IsCompleted) {return @{kind='pending'}}
      if($realState.read.IsFaulted -or $realState.read.IsCanceled) {return @{kind='error'}}
      $line=$realState.read.GetAwaiter().GetResult()
      if($null -eq $line) {return @{kind='eof'}}
      $realState.read=$realState.process.StandardOutput.ReadLineAsync()
      return @{kind='frame';frame=($line | ConvertFrom-Json -AsHashtable)}
    }
    Sleep={param($Ms) Start-Sleep -Milliseconds $Ms}
  }
  try {
    $realReceipt=Invoke-QueryDeadline $realAdapter {param($Frame) $realFacts.Add($Frame.item)} 2000 500 250
    $real=@{receipt=$realReceipt;facts=@($realFacts.ToArray());kills=$realState.kills}
  } finally {
    if($realState.handle -ne [IntPtr]::Zero -and -not [D0QueryHandle]::Exited($realState.handle)) {[D0QueryHandle]::RequestTermination($realState.handle)}
  }
}
function OwnedScenario($Name,$Delay=0,$InitiallyExited=$false,$PidReused=$false,$SwapAfterAcquire=$false,$DenyOpen=$false,$DenyIdentity=$false,$DenyExit=$false,$DenyKill=$false,$AcquireDelay=0) {
  $original=@{createdFileTimeUtc=$created.ToFileTimeUtc().ToString();imagePathSha256=('a'*64);exited=$InitiallyExited}
  $successor=@{createdFileTimeUtc=$created.AddSeconds(1).ToFileTimeUtc().ToString();imagePathSha256=('a'*64);exited=$false}
  $fixture=@{now=0;opens=0;requests=0;successorRequests=0;polls=0;requestedAt=-1;held=$null;pidInstance=$original}
  if($PidReused) {$fixture.pidInstance=$successor}
  $item=@{pid=41;createdUtc=$created.ToString('o');createdFileTimeUtc=$original.createdFileTimeUtc;imagePathSha256=$original.imagePathSha256;category='nsis-temp';exitConfirmed=$false}
  $adapter=@{
    Clock={$fixture.now}.GetNewClosure()
    Acquire={
      $fixture.opens++;$fixture.now+=$AcquireDelay
      if($DenyOpen) {throw 'FAKE_ACCESS_DENIED'}
      $fixture.held=$fixture.pidInstance
      if($SwapAfterAcquire) {$fixture.pidInstance=$successor}
    }.GetNewClosure()
    Identity={
      if($DenyIdentity) {throw 'FAKE_IDENTITY_QUERY_DENIED'}
      return ($fixture.held.createdFileTimeUtc -ceq $item.createdFileTimeUtc -and $fixture.held.imagePathSha256 -ceq $item.imagePathSha256)
    }.GetNewClosure()
    Exited={
      $fixture.polls++
      if($DenyExit -and $fixture.requests -gt 0) {throw 'FAKE_EXIT_QUERY_DENIED'}
      if($fixture.requestedAt -ge 0 -and $fixture.now -ge ($fixture.requestedAt+$Delay)) {$fixture.held.exited=$true}
      return [bool]$fixture.held.exited
    }.GetNewClosure()
    Terminate={
      if($DenyKill) {throw 'FAKE_TERMINATION_DENIED'}
      if([object]::ReferenceEquals($fixture.held,$successor)) {$fixture.successorRequests++}
      $fixture.requests++;$fixture.requestedAt=$fixture.now
      return $true
    }.GetNewClosure()
    Sleep={param($Ms) $fixture.now+=$Ms}.GetNewClosure()
  }
  # The real Stop-Identified, not a true-returning StopRecord stand-in, feeds
  # the real ownership receipt used by cleanup's restoration gate.
  $receipt=Get-OwnedCleanupReceipt $true $true @($item) {param($r) Stop-Identified $r $adapter 100 5}
  return @{name=$Name;receipt=$receipt;elapsedMs=$fixture.now;opens=$fixture.opens;requests=$fixture.requests;polls=$fixture.polls;
    originalExited=$original.exited;successorExited=$successor.exited;successorRequests=$fixture.successorRequests;exitConfirmed=$item.exitConfirmed}
}
$ownedExit=@(
  (OwnedScenario 'never-exits' -Delay 1000),
  (OwnedScenario 'delayed-exit' -Delay 30),
  (OwnedScenario 'already-exited' -InitiallyExited $true),
  (OwnedScenario 'pid-reused-before-open' -PidReused $true),
  (OwnedScenario 'pid-reused-after-open' -SwapAfterAcquire $true -Delay 20),
  (OwnedScenario 'open-denied' -DenyOpen $true),
  (OwnedScenario 'identity-denied' -DenyIdentity $true),
  (OwnedScenario 'exit-query-denied' -DenyExit $true),
  (OwnedScenario 'termination-denied' -DenyKill $true),
  (OwnedScenario 'acquire-timeout' -AcquireDelay 120)
)
$tombstone=@{pid=41;createdUtc=$created.ToString('o');createdFileTimeUtc=$created.ToFileTimeUtc().ToString();imagePathSha256=('a'*64);category='nsis-temp';exitConfirmed=$true}
$tombstoneResult=Stop-Identified $tombstone @{Acquire={throw 'MUST_NOT_OPEN_PID_REUSED_SUCCESSOR'}}
$falseProof=$tombstone.Clone();$falseProof.exitConfirmed='true'
$falseProofResult=Stop-Identified $falseProof @{Acquire={throw 'MUST_NOT_OPEN'}}
$overflowProof=$tombstone.Clone();$overflowProof.createdFileTimeUtc='9999999999999999999'
$overflowProofResult=Stop-Identified $overflowProof @{Acquire={throw 'MUST_NOT_OPEN'}}
$wrongTimeProof=$tombstone.Clone();$wrongTimeProof.createdFileTimeUtc=$created.AddSeconds(1).ToFileTimeUtc().ToString()
$wrongTimeProofResult=Stop-Identified $wrongTimeProof @{Acquire={throw 'MUST_NOT_OPEN'}}
$microBase=[long]132538463990000000
$precision=@{
  inside=(Test-OwnedCreationCapture ($microBase+9) $microBase)
  next=(Test-OwnedCreationCapture ($microBase+10) $microBase)
  previous=(Test-OwnedCreationCapture ($microBase-1) $microBase)
  exact=(Test-OwnedCreationCapture ($microBase+3) ($microBase+3))
  changedExact=(Test-OwnedCreationCapture ($microBase+4) ($microBase+3))
}
$realOwned=$null
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
  Initialize-OwnedExitType
  $ownedInfo=[Diagnostics.ProcessStartInfo]::new($exe)
  $ownedInfo.UseShellExecute=$false;$ownedInfo.CreateNoWindow=$true;$ownedInfo.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
  $ownedInfo.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Start-Sleep -Seconds 20'))
  $ownedChild=[Diagnostics.Process]::new();$ownedChild.StartInfo=$ownedInfo
  if(-not $ownedChild.Start()) {throw 'OWNED_SLEEP_START_FAILED'}
  $ownedChildHandle=$ownedChild.Handle
  try {
    $ownedInstance=[D0OwnedProcessHandle]::Open($ownedChild.Id)
    $microsecond=$ownedInstance.CreatedFileTimeUtc-($ownedInstance.CreatedFileTimeUtc % 10)
    $ownedRecord=@{pid=$ownedChild.Id;createdUtc=[DateTime]::FromFileTimeUtc($microsecond).ToString('o');rawPath=$ownedInstance.ImagePath;
      imagePathSha256=(Digest $ownedInstance.ImagePath);category='nsis-temp';exitConfirmed=$false}
    $ownedInstance.Release()
    $registered=Register-OwnedProcess $ownedRecord
    $ownedTimer=[Diagnostics.Stopwatch]::StartNew()
    $ownedAdapter=New-OwnedProcessAdapter $ownedRecord $ownedTimer
    $nativeRequest=$ownedAdapter.Terminate;$realStopStats=@{requests=0;acquires=0;identities=0;polls=0;errorClass='none';identityResult=$null}
    $nativeAcquire=$ownedAdapter.Acquire
    $ownedAdapter.Acquire={$realStopStats.acquires++;try {& $nativeAcquire} catch {$realStopStats.errorClass=$_.Exception.GetType().Name;throw}}.GetNewClosure()
    $nativeIdentity=$ownedAdapter.Identity
    $ownedAdapter.Identity={$realStopStats.identities++;try {$v=& $nativeIdentity;$realStopStats.identityResult=$v;return $v} catch {$realStopStats.errorClass=$_.Exception.GetType().Name;throw}}.GetNewClosure()
    $nativeExited=$ownedAdapter.Exited
    $ownedAdapter.Exited={$realStopStats.polls++;try {& $nativeExited} catch {$realStopStats.errorClass=$_.Exception.GetType().Name;throw}}.GetNewClosure()
    $ownedAdapter.Terminate={$realStopStats.requests++; & $nativeRequest}.GetNewClosure()
    $ownedReceipt=Get-OwnedCleanupReceipt $true $true @($ownedRecord) {param($r) Stop-Identified $r $ownedAdapter 2000 250}
    $proof=@{pid=$ownedRecord.pid;createdUtc=$ownedRecord.createdUtc;createdFileTimeUtc=$ownedRecord.createdFileTimeUtc;
      imagePathSha256=$ownedRecord.imagePathSha256;category=$ownedRecord.category;exitConfirmed=$ownedRecord.exitConfirmed}
    $fixtureRoot=[IO.Path]::GetFullPath((Join-Path $env:TEMP ('rt-owned-exit-'+[Guid]::NewGuid().ToString('N'))))
    $fixtureBase=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
    if(-not $fixtureRoot.StartsWith($fixtureBase,[StringComparison]::OrdinalIgnoreCase)) {throw 'OWNED_TEST_ROOT_INVALID'}
    [void][IO.Directory]::CreateDirectory($fixtureRoot)
    try {
      [IO.File]::WriteAllText((Join-Path $fixtureRoot 'd0-native-invocation.claim'),'controlled-sleep-only')
      @($proof) | ConvertTo-Json -AsArray -Depth 5 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'd0-owned-processes.json')
      $repeatedReceipt=Get-SavedOwnedCleanup $fixtureRoot {param($r) Stop-Identified $r}
    } finally {
      [IO.File]::Delete((Join-Path $fixtureRoot 'd0-owned-processes.json'))
      [IO.File]::Delete((Join-Path $fixtureRoot 'd0-native-invocation.claim'))
      [IO.Directory]::Delete($fixtureRoot,$false)
    }
    $realOwned=@{receipt=$ownedReceipt;elapsedMs=$ownedTimer.ElapsedMilliseconds;requests=$realStopStats.requests;stages=$realStopStats;registered=$registered;
      exitConfirmed=$ownedRecord.exitConfirmed;hasExited=$ownedChild.HasExited;repeated=$repeatedReceipt}
  } finally {
    if(-not [D0QueryHandle]::Exited($ownedChildHandle)) {[D0QueryHandle]::RequestTermination($ownedChildHandle)}
  }
}
@{results=$results;compat=$compat;worker=$workerResult;offsetWorker=$offsetResult;lateCompletion=$lateCompletion.receipt;workerError=@($workerError.frames.ToArray());cleanup=$cleanup;owned=$owned;stopCalls=$stops.count;real=$real;
  ownedExit=$ownedExit;tombstone=$tombstoneResult;falseProof=$falseProofResult;overflowProof=$overflowProofResult;wrongTimeProof=$wrongTimeProofResult;precision=$precision;realOwned=$realOwned} | ConvertTo-Json -Depth 8 -Compress
`;
// Keep the growing in-memory harness off Windows' finite command line.
const encoded = Buffer.from('& ([scriptblock]::Create([Console]::In.ReadToEnd()))', 'utf16le').toString('base64');
let execution;
for (const executable of process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh']) {
  execution = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...process.env, D0_OBSERVER_SOURCE: observer },
    input: harness, encoding: 'utf8', timeout: 25_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  if (execution.error?.code !== 'ENOENT') break;
}
const unavailable = execution.error?.code === 'ENOENT';
if (!unavailable) {
  assert.ifError(execution.error);
  assert.equal(execution.status, 0, execution.stderr);
}
const data = unavailable ? null : JSON.parse(execution.stdout.trim());
const cases = new Map(data?.results.map(result => [result.name, result]) ?? []);
const options = { skip: unavailable ? 'PowerShell unavailable; no behavioral result claimed' : false };

test('slow query is terminated inside the total budget, not waited on synchronously', options, () => {
  const { receipt, kills } = cases.get('slow-query');
  assert.equal(receipt.queryStatus, 'timeout');
  assert.equal(receipt.queryTimeout, true);
  assert.equal(receipt.waitMs, 80);
  assert.equal(receipt.deadlineMs, 100);
  assert.equal(receipt.terminationReserveMs, 20);
  assert.equal(receipt.schedulingToleranceMs, 5);
  assert.equal(kills, 1);
  assert.equal(receipt.helperExited, true);
  assert.equal(receipt.collectionComplete, true);
  assert.equal(receipt.bounded, true);
});
for (const [name, field] of [['slow-cancel', 'helperExited'], ['slow-collection', 'collectionComplete']]) {
  test(`${name}: cancellation is not exit or complete collection`, options, () => {
    const { receipt, kills } = cases.get(name);
    assert.equal(receipt.waitMs, 100);
    assert.equal(receipt[field], false);
    assert.equal(receipt.receiptComplete, false);
    assert.equal(receipt.preserveIsolation, true);
    assert.equal(receipt.bounded, false);
    assert.equal(kills, 1);
  });
}
for (const [name, status] of [['no-events', 'no-events'], ['query-error', 'unavailable'], ['matched', 'matched']]) {
  test(`${name}: explicit outcome without inventing crash attribution`, options, () => {
    const { receipt, facts } = cases.get(name);
    assert.equal(receipt.queryStatus, status);
    assert.equal(receipt.queryUnavailable, status === 'unavailable');
    assert.equal(receipt.queryTimeout, false);
    assert.equal(receipt.queryCompletionReceived, true);
    assert.equal(receipt.receiptComplete, true);
    assert.equal(receipt.preserveIsolation, false);
    assert.equal(receipt.bounded, true);
    assert.deepEqual(facts, name === 'matched' ? ['sanitized-fact'] : []);
  });
}
for (const name of ['partial-timeout', 'partial-error']) {
  test(`${name}: facts already collected survive failure`, options, () => {
    const { receipt, facts } = cases.get(name);
    assert.deepEqual(facts, ['sanitized-fact']);
    assert.equal(receipt.queryStatus, name === 'partial-timeout' ? 'timeout' : 'unavailable');
    assert.equal(receipt.queryCompletionReceived, false);
    assert.equal(receipt.receiptComplete, true);
  });
}
for (const name of ['unknown-owner', 'spawn-failed']) {
  test(`${name}: never terminate an unidentified process; keep isolation`, options, () => {
    const { receipt, kills } = cases.get(name);
    assert.equal(kills, 0);
    assert.equal(receipt.helperOwnership, 'unavailable');
    assert.equal(receipt.helperExited, false);
    assert.equal(receipt.receiptComplete, false);
    assert.equal(receipt.preserveIsolation, true);
    assert.equal(receipt.bounded, false);
    assert.ok(receipt.waitMs <= receipt.deadlineMs);
  });
}
test('provably not started is distinct from ambiguous startup', options, () => {
  const { receipt, kills } = cases.get('not-started');
  assert.equal(receipt.helperOwnership, 'not-started');
  assert.equal(receipt.queryUnavailable, true);
  assert.equal(receipt.helperExited, true);
  assert.equal(receipt.receiptComplete, true);
  assert.equal(kills, 0);
});
for (const name of ['late-start', 'scheduling-overrun']) {
  test(`${name}: overshoot cannot produce a false bounded receipt`, options, () => {
    const { receipt, kills } = cases.get(name);
    assert.ok(receipt.waitMs > receipt.deadlineMs + receipt.schedulingToleranceMs);
    assert.equal(receipt.deadlineExceeded, true);
    assert.equal(receipt.bounded, false);
    assert.equal(receipt.preserveIsolation, true);
    assert.equal(kills, 1);
  });
}
test('existing pure Number-Id/Match-Event attribution contract remains compatible', options, () => {
  assert.deepEqual(data.compat, {
    hex: 41, decimal: 41, invalid: -1,
    correct: 'pid-image-creation-time-window', creationMismatch: 'creation-time-mismatch',
    partial: 'pid-image-window; creation-time-unavailable', wrongPath: 'image-identity-unavailable',
    wrongPid: 'missing-or-unowned-fault-pid', werWithoutPid: 'missing-or-unowned-fault-pid', outside: 'outside-window',
  });
});
test('actual no-event worker finishes before cancel reserve, including its last sleep', options, () => {
  assert.equal(data.worker.elapsedMs, 59_250);
  assert.equal(data.worker.queries, 60);
  assert.deepEqual(data.worker.frames, [{ kind: 'done', status: 'no-events' }]);
  assert.equal(data.worker.parent.queryStatus, 'no-events');
  assert.equal(data.worker.parent.queryTimeout, false);
  assert.equal(data.worker.parent.receiptComplete, true);
  assert.equal(data.worker.parent.waitMs, 59_250);
  assert.equal(data.worker.parent.deadlineMs, 60_000);
  assert.equal(data.worker.parent.terminationReserveMs, 500);
});
test('completion arriving at the cancellation reserve does not overwrite timeout', options, () => {
  assert.equal(data.lateCompletion.waitMs, 59_500);
  assert.equal(data.lateCompletion.queryStatus, 'timeout');
  assert.equal(data.lateCompletion.queryTimeout, true);
  assert.equal(data.lateCompletion.queryCompletionReceived, true);
  assert.equal(data.lateCompletion.receiptComplete, true);
});
test('offset timestamp configuration is normalized to the same UTC worker window', options, () => {
  assert.equal(data.offsetWorker.elapsedMs, 59_250);
  assert.deepEqual(data.offsetWorker.frames, [{ kind: 'done', status: 'no-events' }]);
});
test('actual worker turns a fake query exception into a fixed unavailable frame', options, () => {
  assert.deepEqual(data.workerError, [{ kind: 'done', status: 'unavailable' }]);
});
for (const name of ['missing', 'corrupt', 'live', 'nonBoolean']) {
  test(`cleanup ${name}: no terminal evidence means no successful cleanup`, options, () => {
    const receipt = data.cleanup[name];
    assert.equal(receipt.succeeded, false);
    assert.equal(receipt.remainingOwned, 1);
    assert.equal(receipt.unknownDescendant, true);
    assert.equal(receipt.helperExited, false);
    assert.equal(receipt.terminationStatus, 'unconfirmed');
  });
}
for (const name of ['confirmed', 'staleGuard']) {
  test(`cleanup ${name}: persisted handle-confirmed exit is terminal evidence`, options, () => {
    const receipt = data.cleanup[name];
    assert.equal(receipt.succeeded, true);
    assert.equal(receipt.remainingOwned, 0);
    assert.equal(receipt.unknownDescendant, false);
    assert.equal(receipt.helperOwnership, 'owned-handle');
    assert.equal(receipt.helperExited, true);
    assert.equal(receipt.receiptComplete, true);
    assert.equal(receipt.terminationStatus, 'exited-confirmed');
  });
}
test('cleanup known-dead but incomplete collection still blocks restoration', options, () => {
  const receipt = data.cleanup.deadIncomplete;
  assert.equal(receipt.succeeded, false);
  assert.equal(receipt.remainingOwned, 1);
  assert.equal(receipt.unknownDescendant, false);
  assert.equal(receipt.helperExited, true);
  assert.equal(receipt.receiptComplete, false);
  assert.equal(receipt.terminationStatus, 'exited-confirmed');
});
test('cleanup explicitly distinguishes never-started from unknown worker', options, () => {
  const receipt = data.cleanup.notStarted;
  assert.equal(receipt.succeeded, true);
  assert.equal(receipt.remainingOwned, 0);
  assert.equal(receipt.unknownDescendant, false);
  assert.equal(receipt.helperOwnership, 'not-started');
  assert.equal(receipt.terminationStatus, 'not-started');
});
for (const name of ['missing', 'corrupt', 'nonArray', 'empty', 'duplicate', 'unclaimed', 'unidentified', 'error', 'nonBoolean']) {
  test(`native ownership ${name}: fail closed without claiming complete process coverage`, options, () => {
    const receipt = data.owned[name];
    assert.equal(receipt.succeeded, false);
    assert.ok(receipt.remainingOwned > 0);
    assert.equal(receipt.unknownDescendant, true);
    assert.equal(receipt.checkedCount, 0);
    assert.equal(receipt.scope, 'owned-tracked-only; PID-start-image-digest-checked; snapshot-coverage-incomplete');
  });
}
test('native ownership valid: each owned identity checked; explicit unknownDescendant false', options, () => {
  const receipt = data.owned.valid;
  assert.equal(receipt.succeeded, true);
  assert.equal(receipt.remainingOwned, 0);
  assert.equal(receipt.unknownDescendant, false);
  assert.equal(receipt.registryStatus, 'valid');
  assert.equal(receipt.checkedCount, 1);
  assert.equal(data.stopCalls, 1);
});
test('no native claim and no ownership registry: explicitly never started', options, () => {
  const receipt = data.owned.neverStarted;
  assert.equal(receipt.succeeded, true);
  assert.equal(receipt.remainingOwned, 0);
  assert.equal(receipt.unknownDescendant, false);
  assert.equal(receipt.registryStatus, 'not-required');
});
test('real timer bounds an owned hidden sleep child and drains its partial fact', {
  skip: unavailable || !data?.real ? 'Windows owned-handle integration unavailable' : false,
}, () => {
  const { receipt, facts, kills } = data.real;
  assert.equal(receipt.queryStatus, 'timeout');
  assert.equal(receipt.queryTimeout, true);
  assert.equal(receipt.helperOwnership, 'owned-handle');
  assert.equal(receipt.helperExited, true);
  assert.equal(receipt.collectionComplete, true);
  assert.equal(receipt.receiptComplete, true);
  assert.equal(receipt.bounded, true);
  assert.equal(receipt.preserveIsolation, false);
  assert.ok(receipt.waitMs >= 1500 && receipt.waitMs <= 2250);
  assert.equal(kills, 1);
  assert.deepEqual(facts, ['controlled-sleep-fact']);
});
const exitCases = new Map(data?.ownedExit.map(result => [result.name, result]) ?? []);
for (const name of ['never-exits', 'pid-reused-before-open', 'open-denied', 'identity-denied', 'exit-query-denied', 'termination-denied', 'acquire-timeout']) {
  test(`actual Stop-Identified ${name}: no confirmed exit means no restoration`, options, () => {
    const result = exitCases.get(name);
    assert.equal(result.receipt.succeeded, false);
    assert.equal(result.receipt.remainingOwned, 1);
    assert.equal(result.receipt.unknownDescendant, true);
    assert.equal(result.exitConfirmed, false);
    assert.equal(result.originalExited, false);
    assert.equal(result.successorRequests, 0);
    const restoreCalls = [];
    const receipt = result.receipt;
    if (receipt.succeeded === true && receipt.remainingOwned === 0 && receipt.unknownDescendant === false) restoreCalls.push('restore');
    assert.deepEqual(restoreCalls, []);
  });
}
test('termination returning success while the exact held instance stays alive exhausts the bound', options, () => {
  const result = exitCases.get('never-exits');
  assert.equal(result.requests, 1, JSON.stringify(result));
  assert.equal(result.opens, 1);
  assert.ok(result.polls > 1);
  assert.equal(result.elapsedMs, 100);
});
test('delayed exit succeeds only after the exact handle reports exited', options, () => {
  const result = exitCases.get('delayed-exit');
  assert.equal(result.elapsedMs, 30);
  assert.equal(result.requests, 1);
  assert.equal(result.originalExited, true);
  assert.equal(result.exitConfirmed, true);
  assert.equal(result.receipt.succeeded, true);
  assert.equal(result.receipt.remainingOwned, 0);
  assert.equal(result.receipt.unknownDescendant, false);
});
test('already-exited owned handle needs no termination request', options, () => {
  const result = exitCases.get('already-exited');
  assert.equal(result.requests, 0);
  assert.equal(result.opens, 1);
  assert.equal(result.originalExited, true);
  assert.equal(result.receipt.succeeded, true);
  assert.equal(result.exitConfirmed, true);
});
test('PID reuse after acquiring the original handle cannot redirect termination to its successor', options, () => {
  const result = exitCases.get('pid-reused-after-open');
  assert.equal(result.opens, 1);
  assert.equal(result.requests, 1);
  assert.equal(result.originalExited, true);
  assert.equal(result.successorExited, false);
  assert.equal(result.successorRequests, 0);
  assert.equal(result.receipt.succeeded, true);
});
test('PID reuse before acquiring a handle fails identity verification without termination', options, () => {
  const result = exitCases.get('pid-reused-before-open');
  assert.equal(result.requests, 0);
  assert.equal(result.successorExited, false);
});
test('durable exact-instance exit proof permits repeat cleanup without reopening a PID', options, () => {
  assert.equal(data.tombstone, true);
  assert.equal(data.falseProof, false);
  assert.equal(data.overflowProof, false);
  assert.equal(data.wrongTimeProof, false);
});
test('large FILETIME identity retains integer precision and rejects the next microsecond', options, () => {
  assert.deepEqual(data.precision, { inside: true, next: false, previous: false, exact: true, changedExact: false });
});
test('real hidden owned sleep child is confirmed exited before its cleanup receipt succeeds', {
  skip: unavailable || !data?.realOwned ? 'Windows owned-handle integration unavailable' : false,
}, () => {
  const result = data.realOwned;
  assert.equal(result.registered, true, JSON.stringify(result));
  assert.equal(result.requests, 1, JSON.stringify(result));
  assert.equal(result.hasExited, true);
  assert.equal(result.exitConfirmed, true);
  assert.equal(result.receipt.succeeded, true);
  assert.equal(result.receipt.remainingOwned, 0);
  assert.equal(result.receipt.unknownDescendant, false);
  assert.equal(result.repeated.succeeded, true, JSON.stringify(result));
  assert.equal(result.repeated.remainingOwned, 0);
  assert.equal(result.repeated.unknownDescendant, false);
  assert.ok(result.elapsedMs <= 2250);
});
