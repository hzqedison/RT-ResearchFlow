param([Parameter(Mandatory)][ValidateSet('run','cleanup')][string]$Action, [Parameter(Mandatory)][string]$Root)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$InformationPreference='SilentlyContinue'
$code='D0_OBSERVER_FAILED'; $stage='observer-guard'
$report=@{ diagnosticOnly=$true; upgradeAccepted=$false; experiment='D0'; attempted=$false; invocationCount=0; exitCode='unavailable'; timedOut=$false;
  primary=$null; secondary=@(); stages=@(); processes=@(); events=@(); moduleCandidates=@(); autoStartedProduct=$false; finalStage='observer-guard';
  coverage='bounded-process-snapshots; short-lived-children-may-be-unavailable; not-a-complete-process-trace' }
$tracked=@{}; $modules=@{}; $eventsSeen=@{}; $stopRequested=$false; $ownedExitHandles=@{}
function Need($Condition,[string]$Code) { if(-not $Condition) { $script:code=$Code; throw $Code } }
function Set-Stage([string]$Name) { $script:stage=$Name; $report.finalStage=$Name; $report.stages+=@{stage=$Name;time=[DateTime]::UtcNow.ToString('o')} }
function Digest([string]$Value) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value))).ToLowerInvariant() }
function Safe-Name([string]$Value) {
  $name=[IO.Path]::GetFileName($Value)
  if($name -match '^[A-Za-z0-9_.~ -]{1,96}$' -and $name -notmatch '(?i)Bearer|CREDENTIAL|PASSWORD') { return $name }
  return 'unavailable'
}
function Number-Id($Value) {
  try { if([string]$Value -match '^0x[0-9a-fA-F]+$') { return [Convert]::ToInt64(([string]$Value).Substring(2),16) }; return [long]::Parse([string]$Value) }
  catch { return -1 }
}
function Match-Event($Fields,$EventUtc,$Processes,$From,$Through) {
  if($EventUtc -lt $From -or $EventUtc -gt $Through) { return @{ attribution='outside-window' } }
  $fault=Number-Id $(if($Fields.ContainsKey('ProcessId')) {$Fields.ProcessId} else {$Fields.ProcessID})
  if($fault -lt 1 -or -not $Processes.ContainsKey([string]$fault)) { return @{ attribution='missing-or-unowned-fault-pid' } }
  $p=$Processes[[string]$fault]
  if(-not $Fields.AppPath -or -not [string]::Equals($Fields.AppPath,$p.rawPath,[StringComparison]::OrdinalIgnoreCase)) { return @{ attribution='image-identity-unavailable' } }
  $created=$Fields.ProcessCreationTime
  if(-not $created) { return @{ attribution='pid-image-window; creation-time-unavailable'; faultPid=$fault; creationTimeMatches='unavailable' } }
  try {
    $ticks=if([string]$created -match '^0x') {[Convert]::ToInt64(([string]$created).Substring(2),16)} else {[long]::Parse([string]$created)}
    $difference=[Math]::Abs($ticks-([DateTime]::Parse($p.createdUtc).ToFileTimeUtc()))
    if($difference -gt 10000) { return @{ attribution='creation-time-mismatch' } }
    return @{ attribution='pid-image-creation-time-window'; faultPid=$fault; creationTimeMatches=$true }
  } catch { return @{ attribution='creation-time-unparseable' } }
}
function Invoke-QueryDeadline($Adapter,[scriptblock]$OnFrame,[int]$BudgetMs=60000,[int]$TerminationReserveMs=500,[int]$ToleranceMs=250) {
  # Adapter operations must be non-waiting, except Start (whose elapsed time is
  # measured, never assumed bounded). No Stop/Dispose/EndInvoke/WaitForExit here.
  $begin=& $Adapter.Clock; $status='unavailable'; $timeout=$false; $cancelled=$false
  $completion=$false; $collected=$false; $running=$true; $started=$false
  try { & $Adapter.Start; $started=$true } catch { $running=$false }
  while($started) {
    $elapsed=(& $Adapter.Clock)-$begin
    if($elapsed -ge $BudgetMs) { if($running) {$timeout=$true;$status='timeout'}; break }
    if($running -and $elapsed -ge ($BudgetMs-$TerminationReserveMs)) { $timeout=$true; $status='timeout'; $running=$false }
    if(-not $running -and -not $cancelled) {
      $cancelled=$true
      try { if((& $Adapter.Ownership) -eq 'owned-handle' -and -not (& $Adapter.Exited)) { & $Adapter.Terminate } } catch {}
    }
    try {
      $packet=& $Adapter.Poll
      switch($packet.kind) {
        'frame' {
          if($packet.frame.kind -eq 'done') {
            $completion=$true; $running=$false
            if(-not $timeout -and $packet.frame.status -in @('matched','no-events','unavailable')) { $status=$packet.frame.status }
          } elseif($packet.frame.kind -in @('event','unattributed')) { & $OnFrame $packet.frame }
          else { $status='unavailable'; $running=$false }
        }
        'eof' { $collected=$true; $running=$false }
        'error' { if(-not $timeout) {$status='unavailable'}; $running=$false }
      }
      if($collected -and (& $Adapter.Exited)) { break }
    } catch { if(-not $timeout) {$status='unavailable'}; $running=$false }
    $remaining=$BudgetMs-((& $Adapter.Clock)-$begin)
    if($remaining -le 0) { break }
    if($packet.kind -ne 'frame') { & $Adapter.Sleep ([int][Math]::Min(10,$remaining)) }
  }
  # Termination requests are not evidence of exit. Check the retained process
  # handle without waiting, even if startup or scheduling exhausted the budget.
  $ownership=& $Adapter.Ownership; $exited=$false
  try {
    if($ownership -eq 'not-started') { $exited=$true; $collected=$true }
    elseif($ownership -eq 'owned-handle') {
      if(-not (& $Adapter.Exited) -and -not $cancelled) { $cancelled=$true; & $Adapter.Terminate }
      $exited=(& $Adapter.Exited)
    }
  } catch {}
  $elapsed=[int][Math]::Ceiling((& $Adapter.Clock)-$begin)
  $within=($elapsed -le ($BudgetMs+$ToleranceMs))
  $complete=($exited -and $collected -and $ownership -ne 'unavailable' -and $within)
  return @{queryStatus=$status;queryTimeout=$timeout;queryUnavailable=($status -eq 'unavailable');queryCompletionReceived=$completion;
    collectionComplete=$collected;helperOwnership=$ownership;helperExited=$exited;cancellationRequested=$cancelled;
    receiptComplete=$complete;preserveIsolation=(-not $complete);waitMs=$elapsed;bounded=($within -and $complete);
    deadlineMs=$BudgetMs;terminationReserveMs=$TerminationReserveMs;schedulingToleranceMs=$ToleranceMs;deadlineExceeded=(-not $within)}
}
function Get-QueryCleanupReceipt([bool]$GuardPresent,$Observation) {
  if(-not $GuardPresent -and $null -eq $Observation) {
    # The guard is created before any helper can start. No guard or receipt
    # therefore means this invocation never reached helper startup.
    return @{succeeded=$true;remainingOwned=0;unknownDescendant=$false;helperOwnership='not-started';helperExited=$true;
      collectionComplete=$true;receiptComplete=$true;bounded=$true;terminationStatus='not-started'}
  }
  $ownership='unavailable'
  if($Observation -and $Observation.helperOwnership -in @('owned-handle','not-started','unavailable')) { $ownership=$Observation.helperOwnership }
  $exited=($Observation -and $Observation.helperExited -is [bool] -and $Observation.helperExited -and $ownership -ne 'unavailable')
  $collected=($Observation -and $Observation.collectionComplete -is [bool] -and $Observation.collectionComplete)
  $bounded=($Observation -and $Observation.bounded -is [bool] -and $Observation.bounded)
  $complete=($exited -and $collected -and $bounded -and $Observation.receiptComplete -is [bool] -and $Observation.receiptComplete -and
    $Observation.preserveIsolation -is [bool] -and -not $Observation.preserveIsolation)
  return @{succeeded=[bool]$complete;remainingOwned=$(if($complete){0}else{1});unknownDescendant=(-not $exited);
    helperOwnership=$ownership;helperExited=[bool]$exited;collectionComplete=[bool]$collected;receiptComplete=[bool]$complete;bounded=[bool]$bounded;
    terminationStatus=$(if(-not $exited){'unconfirmed'}elseif($ownership -eq 'not-started'){'not-started'}else{'exited-confirmed'})}
}
function Get-SavedQueryCleanup([string]$CaseRoot) {
  try {
    $guard=Test-Path -LiteralPath (Join-Path $CaseRoot 'd0-query-isolation.guard')
    $observation=$null; $path=Join-Path $CaseRoot 'd0-event-query-receipt.json'
    if(Test-Path -LiteralPath $path) {
      $observation=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable
      # Empty/corrupt persisted data is not proof that no helper started.
      if($null -eq $observation) { throw 'QUERY_RECEIPT_UNAVAILABLE' }
    }
    return Get-QueryCleanupReceipt $guard $observation
  } catch { return Get-QueryCleanupReceipt $true @{helperOwnership='unavailable'} }
}
function Test-OwnedCreationCapture([long]$KernelFileTime,[long]$SnapshotFileTime) {
  if($KernelFileTime -le 0 -or $SnapshotFileTime -le 0) {return $false}
  if($SnapshotFileTime % 10 -ne 0) {return ($KernelFileTime -eq $SnapshotFileTime)}
  # Integer subtraction, not double division: FILETIME exceeds 2^53.
  return ($KernelFileTime -ge $SnapshotFileTime -and ($KernelFileTime-$SnapshotFileTime) -le 9)
}
function Get-OwnedCleanupReceipt([bool]$InvocationClaimed,[bool]$RegistryPresent,$Records,[scriptblock]$StopRecord) {
  $scope='owned-tracked-only; PID-start-image-digest-checked; snapshot-coverage-incomplete'
  $result=@{succeeded=$false;remainingOwned=1;unknownDescendant=$true;registryStatus='invalid';checkedCount=0;scope=$scope}
  if(-not $RegistryPresent) {
    if($InvocationClaimed) { $result.registryStatus='missing' }
    else { $result.registryStatus='not-required'; $result.succeeded=$true; $result.remainingOwned=0; $result.unknownDescendant=$false }
    return $result
  }
  # A native claim plus an empty/invalid registry cannot prove that nothing
  # launched (including the gap between Start-Process and Save-Owned).
  if(-not $InvocationClaimed -or $Records -isnot [Array]) { return $result }
  if($Records.Count -eq 0) { $result.registryStatus='empty'; return $result }
  $ids=[Collections.Generic.HashSet[int]]::new()
  foreach($record in $Records) {
    $created=[DateTimeOffset]::MinValue
    if($null -eq $record -or ($record.pid -isnot [int] -and $record.pid -isnot [long]) -or $record.pid -lt 1 -or $record.pid -gt [int]::MaxValue -or
      $record.createdUtc -isnot [string] -or -not [DateTimeOffset]::TryParse($record.createdUtc,[ref]$created) -or $created.Offset -ne [TimeSpan]::Zero -or
      $record.imagePathSha256 -isnot [string] -or $record.imagePathSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $record.category -notin @('verified-download','case-install','nsis-temp') -or -not $ids.Add([int]$record.pid)) { return $result }
    if($null -ne $record.exitConfirmed -and $record.exitConfirmed -isnot [bool]) { return $result }
    if($null -ne $record.createdFileTimeUtc) {
      $exact=[long]0
      try {
        if($record.createdFileTimeUtc -isnot [string] -or $record.createdFileTimeUtc -notmatch '^[0-9]{1,19}$' -or
          -not [long]::TryParse($record.createdFileTimeUtc,[ref]$exact) -or
          -not (Test-OwnedCreationCapture $exact $created.UtcDateTime.ToFileTimeUtc())) { return $result }
      } catch {return $result}
    }
    if($record.exitConfirmed -is [bool] -and $record.exitConfirmed -and -not $record.createdFileTimeUtc) { return $result }
  }
  $result.registryStatus='valid'; $result.remainingOwned=0; $result.unknownDescendant=$false
  foreach($record in $Records) {
    try {
      $stopped=& $StopRecord $record
      if($stopped -is [bool] -and $stopped) { $result.checkedCount++ }
      else { $result.remainingOwned++; $result.unknownDescendant=$true }
    } catch { $result.remainingOwned++; $result.unknownDescendant=$true }
  }
  $result.succeeded=($result.remainingOwned -eq 0 -and -not $result.unknownDescendant)
  return $result
}
function Get-SavedOwnedCleanup([string]$CaseRoot,[scriptblock]$StopRecord) {
  try {
    $claimed=Test-Path -LiteralPath (Join-Path $CaseRoot 'd0-native-invocation.claim')
    $path=Join-Path $CaseRoot 'd0-owned-processes.json'; $present=Test-Path -LiteralPath $path
    $records=$null
    if($present) {
      $records=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable -NoEnumerate
      # PowerShell JSON decoders can turn ISO strings into DateTime. Restore
      # the UTC wire shape before strict identity validation, without relying
      # on the version-specific ConvertFrom-Json -DateKind parameter.
      if($records -is [Array]) {
        foreach($record in $records) {
          if($record.createdUtc -is [DateTime]) {$record.createdUtc=$record.createdUtc.ToUniversalTime().ToString('o')}
        }
      }
    }
    $result=Get-OwnedCleanupReceipt $claimed $present $records $StopRecord
    if($result.registryStatus -eq 'valid') {
      # Persist only the existing identity plus exact creation time and a proof
      # obtained from a signaled instance handle. Keep partial confirmed exits.
      @($records | ForEach-Object {
        @{pid=$_.pid;createdUtc=$_.createdUtc;imagePathSha256=$_.imagePathSha256;category=$_.category;
          createdFileTimeUtc=$_.createdFileTimeUtc;exitConfirmed=($_.exitConfirmed -is [bool] -and $_.exitConfirmed)}
      }) | ConvertTo-Json -AsArray -Depth 5 | Set-Content -LiteralPath $path
    }
    return $result
  } catch { return Get-OwnedCleanupReceipt $true $true $null $StopRecord }
}
function Invoke-EventQueryWorker($Config=$null,
  [scriptblock]$Now={[DateTime]::UtcNow},
  [scriptblock]$Pause={param($Ms) Start-Sleep -Milliseconds $Ms},
  [scriptblock]$Query={param($From,$End) Get-WinEvent -FilterHashtable @{LogName='Application';Id=1000,1001;StartTime=$From;EndTime=$End} -MaxEvents 512 -ErrorAction Stop},
  [scriptblock]$Emit={param($Frame) [Console]::Out.WriteLine(($Frame | ConvertTo-Json -Depth 6 -Compress))}) {
  # Only the helper touches Get-WinEvent. Configuration and raw module paths
  # travel through anonymous in-memory pipes, never files or command arguments.
  $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
  try {
    if($null -eq $Config) { $Config=[Console]::In.ReadLine() | ConvertFrom-Json -AsHashtable }
    $Root=$config.root; $install=$config.install; $installer=$config.installer
    $from=[DateTime]::Parse($config.from,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $through=[DateTime]::Parse($config.through,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $queryThrough=[DateTime]::Parse($config.queryThrough,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    $processes=$config.processes; $seen=@{}; $matched=$false
    while((& $Now) -lt $queryThrough) {
      try {
        & $Query $from (& $Now) | ForEach-Object {
          $event=$_; $key=[string]$event.RecordId
          if(-not $seen.ContainsKey($key) -and $event.ProviderName -in @('Application Error','Windows Error Reporting')) {
            $seen[$key]=$true; [xml]$xml=$event.ToXml(); $data=@{}
            foreach($d in $xml.Event.EventData.Data) { if($d.Name) {$data[$d.Name]=[string]$d.'#text'} }
            $association=Match-Event $data $event.TimeCreated.ToUniversalTime() $processes $from $through
            if($association.attribution -notin @('pid-image-creation-time-window','pid-image-window; creation-time-unavailable')) {
              & $Emit @{kind='unattributed'}
            } else {
              $item=@{provider=$event.ProviderName;eventId=$event.Id;recordId=$event.RecordId;eventUtc=$event.TimeCreated.ToUniversalTime().ToString('o');faultPid=$association.faultPid;
                attribution=$association.attribution;creationTimeMatches=$association.creationTimeMatches;moduleName=(Safe-Name $data.ModuleName);moduleVersion='unavailable';exceptionCode='unavailable';faultOffset='unavailable'}
              if($data.ModuleVersion -match '^\d+(\.\d+){1,4}$') {$item.moduleVersion=$data.ModuleVersion}
              if($data.ExceptionCode -match '^[a-fA-F0-9]{8}$') {$item.exceptionCode=$data.ExceptionCode.ToLowerInvariant()}
              if($data.FaultingOffset -match '^[a-fA-F0-9]{1,16}$') {$item.faultOffset=$data.FaultingOffset.ToLowerInvariant()}
              $rawModulePath=$null
              if($data.ModulePath -and [IO.Path]::IsPathFullyQualified($data.ModulePath)) {
                $rawModulePath=$data.ModulePath; $item.modulePathSha256=Digest $rawModulePath; $item.category=Kind-Path $rawModulePath
              } else {$item.category='unavailable';$item.modulePathSha256='unavailable'}
              & $Emit @{kind='event';item=$item;rawModulePath=$rawModulePath}
              $matched=$true
            }
          }
        }
      } catch {
        if($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw }
      }
      if($matched) { break }
      # Finish normal no-event polling BEFORE the parent's termination reserve.
      # Include the last sleep; never round it up to another full second.
      $remaining=[int][Math]::Ceiling(($queryThrough-(& $Now)).TotalMilliseconds)
      if($remaining -gt 0) { & $Pause ([int][Math]::Min(1000,$remaining)) }
    }
    & $Emit @{kind='done';status=$(if($matched){'matched'}else{'no-events'})}
  } catch { & $Emit @{kind='done';status='unavailable'} }
}
function New-EventQueryAdapter($Config) {
  if(-not ('D0QueryHandle' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class D0QueryHandle {
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h, uint code);
  public static bool Exited(IntPtr h) {
    uint r=WaitForSingleObject(h,0);
    if(r==0xffffffff) throw new InvalidOperationException("query handle unavailable");
    return r==0;
  }
  // TerminateProcess initiates termination asynchronously; zero-time handle
  // polling, not this return value, establishes that the owned helper exited.
  public static void RequestTermination(IntPtr h) { TerminateProcess(h,1); }
}
'@ | Out-Null
  }
  $source='$ErrorActionPreference="Stop";'
  foreach($name in @('Digest','Safe-Name','Number-Id','Match-Event','Kind-Path','Invoke-EventQueryWorker')) {
    $source+='function '+$name+' {'+(Get-Command $name -CommandType Function).Definition+"}`n"
  }
  $source+='Invoke-EventQueryWorker'
  $info=[Diagnostics.ProcessStartInfo]::new((Join-Path $PSHOME 'pwsh.exe'))
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
  $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
  foreach($arg in @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source)))) { $info.ArgumentList.Add($arg) }
  $state=@{process=[Diagnostics.Process]::new();ownership='not-started';handle=[IntPtr]::Zero;read=$null;write=$null;
    config=$Config;clock=[Diagnostics.Stopwatch]::StartNew()}
  $state.process.StartInfo=$info
  return @{
    Clock={$state.clock.Elapsed.TotalMilliseconds}.GetNewClosure()
    Start={
      # Until the exact handle is retained, a startup failure is ambiguous.
      $state.ownership='unavailable'
      if(-not $state.process.Start()) { throw 'QUERY_START_FAILED' }
      $state.handle=$state.process.Handle; $state.ownership='owned-handle'
      $state.write=$state.process.StandardInput.WriteLineAsync(($state.config | ConvertTo-Json -Depth 8 -Compress)); $state.config=$null
      $state.read=$state.process.StandardOutput.ReadLineAsync()
    }.GetNewClosure()
    Poll={
      if($state.write.IsFaulted -or $state.write.IsCanceled) { return @{kind='error'} }
      if(-not $state.read.IsCompleted) { return @{kind='pending'} }
      if($state.read.IsFaulted -or $state.read.IsCanceled) { return @{kind='error'} }
      $line=$state.read.GetAwaiter().GetResult() # Already completed, never a wait.
      if($null -eq $line) { return @{kind='eof'} }
      $state.read=$state.process.StandardOutput.ReadLineAsync()
      return @{kind='frame';frame=($line | ConvertFrom-Json -AsHashtable)}
    }.GetNewClosure()
    Ownership={$state.ownership}.GetNewClosure()
    Exited={ [D0QueryHandle]::Exited($state.handle) }.GetNewClosure()
    Terminate={ [D0QueryHandle]::RequestTermination($state.handle) }.GetNewClosure()
    Sleep={param($Ms) Start-Sleep -Milliseconds $Ms}
    # Do not synchronously dispose/cancel pipe tasks, or dispose the Process.
    # Unfinished resources stay owned until observer exit; the guard stays put.
  }
}
function Kind-Path([string]$Value) {
  if(-not $Value -or -not [IO.Path]::IsPathFullyQualified($Value)) { return 'unavailable' }
  $full=[IO.Path]::GetFullPath($Value)
  if($full.StartsWith($install+'\',[StringComparison]::OrdinalIgnoreCase) -or $full -eq $install) { return 'case-install' }
  if($full.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase) -or $full -eq $Root) { return 'case-root' }
  if($installer -and $full -eq $installer) { return 'verified-download' }
  foreach($temp in @($env:TEMP,$env:TMP)) {
    if($temp -and $full.StartsWith([IO.Path]::GetFullPath($temp).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) {
      $tail=$full.Substring([IO.Path]::GetFullPath($temp).TrimEnd('\').Length+1)
      if($tail -match '^ns[A-Za-z0-9]+\.tmp\\') { return 'nsis-temp' }
      return 'temp-other'
    }
  }
  if($full.StartsWith($env:WINDIR.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { return 'windows-directory' }
  return 'other'
}
function Shape([string]$Label,[string]$Value) {
  if(-not $Value -or -not [IO.Path]::IsPathFullyQualified($Value)) { return @{label=$Label;availability='unavailable'} }
  $full=[IO.Path]::GetFullPath($Value); $link=$false; $cursor=$full; $volume='unavailable'
  while($cursor) {
    if(Test-Path -LiteralPath $cursor) { if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { $link=$true } }
    $parent=[IO.Path]::GetDirectoryName($cursor); if($parent -eq $cursor) { break }; $cursor=$parent
  }
  try { $volume=([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full))).DriveType.ToString() } catch {}
  return @{label=$Label;category=(Kind-Path $full);length=$full.Length;spaces=$full.Contains(' ');nonAscii=($full -match '[^\x00-\x7F]');
    localVolume=($volume -eq 'Fixed');reparseAncestor=$link;exists=(Test-Path -LiteralPath $full);writable='unavailable-not-probed';imagePathSha256=(Digest $full)}
}
function Record-Error([string]$Kind,[string]$Code,[string]$Stage,$Exception) {
  $class=if($Exception -and $Exception.GetType().Name -in @('Win32Exception','IOException','UnauthorizedAccessException','InvalidOperationException')) {$Exception.GetType().Name} else {'Error'}
  $detail=@{kind=$Kind;code=$Code;stage=$Stage;errorClass=$class;description='Raw exception text and paths suppressed.'}
  if($Exception -is [ComponentModel.Win32Exception]) { $detail.nativeErrorCode=$Exception.NativeErrorCode }
  if(-not $report.primary) { $report.primary=$detail } else { $report.secondary+=,$detail }
}
function Registrations {
  $items=@()
  foreach($base in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if(Test-Path -LiteralPath $base) { foreach($item in Get-ChildItem -LiteralPath $base) {
      $p=Get-ItemProperty -LiteralPath $item.PSPath
      if($p.DisplayName -ceq 'RT-ResearchFlow') { $items+=@{key=$item.Name;version=$p.DisplayVersion;location=$p.InstallLocation} }
    } }
  }
  return $items
}
function Save-Owned {
  # PID/start/path digest only: no command line or raw image path is persisted.
  @($tracked.Values | ForEach-Object { @{pid=$_.pid;createdUtc=$_.createdUtc;imagePathSha256=(Digest $_.rawPath);category=$_.category;
    createdFileTimeUtc=$_.createdFileTimeUtc;exitConfirmed=($_.exitConfirmed -is [bool] -and $_.exitConfirmed)} }) |
    ConvertTo-Json -AsArray -Depth 5 | Set-Content -LiteralPath "$Root/d0-owned-processes.json"
}
function Initialize-OwnedExitType {
  if('D0OwnedProcessHandle' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public sealed class D0OwnedProcessHandle {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr h,uint flags,StringBuilder path,ref uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint code);
  IntPtr handle;
  public string ImagePath {get;private set;}
  public long CreatedFileTimeUtc {get;private set;}
  public static D0OwnedProcessHandle Open(int pid) {
    var value=new D0OwnedProcessHandle();
    // QUERY_LIMITED_INFORMATION | SYNCHRONIZE | TERMINATE, on one instance.
    value.handle=OpenProcess(0x101001,false,pid);
    if(value.handle==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      long created,exited,kernel,user;
      if(!GetProcessTimes(value.handle,out created,out exited,out kernel,out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
      uint size=32768; var path=new StringBuilder((int)size);
      if(!QueryFullProcessImageNameW(value.handle,0,path,ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
      value.CreatedFileTimeUtc=created; value.ImagePath=path.ToString(); return value;
    } catch {value.Release();throw;}
  }
  public bool Exited() {
    uint result=WaitForSingleObject(handle,0);
    if(result==0) return true;
    if(result==258) return false;
    throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public void RequestTermination() {
    if(!TerminateProcess(handle,1)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  // Closing a process handle never waits for that process or any pipe task.
  public void Release() {if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
  ~D0OwnedProcessHandle() {Release();}
}
'@ | Out-Null
}
function Register-OwnedProcess($Record) {
  # Capture while observed, before NSIS cleanup. CIM timestamps have microsecond
  # precision: only capture within that exact microsecond, then persist the
  # kernel's full FILETIME. Destructive operations later require exact equality.
  $instance=$null
  try {
    if($Record.category -notin @('verified-download','case-install','nsis-temp')) { return $false }
    Initialize-OwnedExitType
    if($null -eq $script:ownedExitHandles) { $script:ownedExitHandles=@{} }
    $instance=[D0OwnedProcessHandle]::Open([int]$Record.pid)
    $created=[DateTime]::Parse($Record.createdUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().ToFileTimeUtc()
    if((Digest $instance.ImagePath) -cne (Digest $Record.rawPath) -or
      -not (Test-OwnedCreationCapture $instance.CreatedFileTimeUtc $created)) { $instance.Release(); return $false }
    $Record.createdFileTimeUtc=$instance.CreatedFileTimeUtc.ToString([Globalization.CultureInfo]::InvariantCulture)
    $key=[string]$Record.pid+'|'+$Record.createdFileTimeUtc+'|'+(Digest $Record.rawPath)
    $script:ownedExitHandles[$key]=$instance
    return $true
  } catch { if($instance) {$instance.Release()}; return $false }
}
function New-OwnedProcessAdapter($Record,$Clock) {
  Initialize-OwnedExitType
  if($null -eq $script:ownedExitHandles) { $script:ownedExitHandles=@{} }
  $cache=$script:ownedExitHandles
  # GetNewClosure creates a module scope; capture the pure digest function
  # explicitly rather than assuming a caller-local function is visible there.
  $digest=(Get-Command Digest -CommandType Function).ScriptBlock
  $hash=if($Record.imagePathSha256) {$Record.imagePathSha256} else {Digest $Record.rawPath}
  $created=[DateTime]::Parse($Record.createdUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().ToFileTimeUtc()
  $expected=if($Record.createdFileTimeUtc) {[long]::Parse($Record.createdFileTimeUtc,[Globalization.CultureInfo]::InvariantCulture)} else {$created}
  $key=[string]$Record.pid+'|'+$expected.ToString([Globalization.CultureInfo]::InvariantCulture)+'|'+$hash
  $state=@{instance=$null;clock=$Clock}
  return @{
    Clock={$state.clock.Elapsed.TotalMilliseconds}.GetNewClosure()
    Acquire={
      if($cache.ContainsKey($key)) {$state.instance=$cache[$key]}
      else {$state.instance=[D0OwnedProcessHandle]::Open([int]$Record.pid)}
    }.GetNewClosure()
    Identity={
      $same=($state.instance.CreatedFileTimeUtc -eq $expected -and [Math]::Abs($expected-$created) -le 9 -and
        (& $digest $state.instance.ImagePath) -ceq $hash)
      if(-not $same) {$state.instance.Release(); return $false}
      $Record.createdFileTimeUtc=$expected.ToString([Globalization.CultureInfo]::InvariantCulture)
      $cache[$key]=$state.instance
      return $true
    }.GetNewClosure()
    Exited={$state.instance.Exited()}.GetNewClosure()
    Terminate={$state.instance.RequestTermination(); return $true}.GetNewClosure()
    Sleep={param($Ms) Start-Sleep -Milliseconds $Ms}
    # Retain the exact handle through observer lifetime, including failed waits.
    # Never reopen a PID to kill/confirm a possibly different successor instance.
  }
}
function Invoke-OwnedExitConfirmation($Adapter,[int]$BudgetMs=3000,[int]$ToleranceMs=100) {
  # Clock is elapsed time since Stop-Identified entry, including adapter setup.
  # All identity/exit calls are handle-based and non-waiting. No synchronous
  # Stop-Process, Process.Kill, cancellation, disposal, or indefinite wait.
  $confirmed=$false
  try {
    if((& $Adapter.Clock) -ge $BudgetMs) { return $false }
    & $Adapter.Acquire | Out-Null
    if((& $Adapter.Clock) -ge $BudgetMs) { return $false }
    $identity=& $Adapter.Identity
    if($identity -isnot [bool] -or -not $identity) { return $false }
    $exited=& $Adapter.Exited
    if($exited -isnot [bool]) { return $false }
    if($exited) { $confirmed=$true }
    else {
      if((& $Adapter.Clock) -ge $BudgetMs) { return $false }
      $requested=& $Adapter.Terminate
      if($requested -isnot [bool] -or -not $requested) { return $false }
      while((& $Adapter.Clock) -lt $BudgetMs) {
        $exited=& $Adapter.Exited
        if($exited -isnot [bool]) { return $false }
        if($exited) {$confirmed=$true; break}
        $remaining=$BudgetMs-(& $Adapter.Clock)
        if($remaining -le 0) {break}
        & $Adapter.Sleep ([int][Math]::Min(10,[Math]::Ceiling($remaining)))
      }
    }
    return ($confirmed -and (& $Adapter.Clock) -le ($BudgetMs+$ToleranceMs))
  } catch { return $false }
}
function Stop-Identified($record,$Adapter=$null,[int]$BudgetMs=3000,[int]$ToleranceMs=100) {
  $clock=[Diagnostics.Stopwatch]::StartNew()
  try {
    if($record.category -notin @('verified-download','case-install','nsis-temp') -or $record.pid -lt 1) {return $false}
    $hash=if($record.imagePathSha256) {$record.imagePathSha256} else {Digest $record.rawPath}
    if($hash -cnotmatch '^[a-f0-9]{64}$') {return $false}
    if($null -ne $record.exitConfirmed -and $record.exitConfirmed -isnot [bool]) {return $false}
    if($null -ne $record.createdFileTimeUtc) {
      $exact=[long]0
      $created=[DateTime]::Parse($record.createdUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().ToFileTimeUtc()
      if($record.createdFileTimeUtc -isnot [string] -or $record.createdFileTimeUtc -notmatch '^[0-9]{1,19}$' -or
        -not [long]::TryParse($record.createdFileTimeUtc,[ref]$exact) -or -not (Test-OwnedCreationCapture $exact $created)) {return $false}
    }
    if($record.exitConfirmed -is [bool] -and $record.exitConfirmed) {
      # This exact persisted identity was previously proven signaled. It is not
      # inferred from a missing PID; do not touch a live PID-reused successor.
      return ($record.createdFileTimeUtc -is [string] -and $record.createdFileTimeUtc -match '^[0-9]{1,19}$')
    }
    if($null -eq $Adapter) {$Adapter=New-OwnedProcessAdapter $record $clock}
    $confirmed=Invoke-OwnedExitConfirmation $Adapter $BudgetMs $ToleranceMs
    if($confirmed) {$record.exitConfirmed=$true}
    return [bool]$confirmed
  } catch {return $false}
}
try {
  Need ($env:CI -ceq 'true' -and $env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted' -and $IsWindows) 'HOSTED_WINDOWS_REQUIRED'
  Need ($env:GITHUB_RUN_ATTEMPT -ceq '1') 'D0_RERUN_FORBIDDEN'
  Need ([IO.Path]::IsPathFullyQualified($Root) -and [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) 'ABSOLUTE_CASE_REQUIRED'
  $Root=[IO.Path]::GetFullPath($Root).TrimEnd('\'); $temporary=(Get-Item -LiteralPath $env:RUNNER_TEMP).FullName.TrimEnd('\')
  $rootItem=Get-Item -LiteralPath $Root
  Need ($rootItem.Parent.FullName -eq $temporary -and $rootItem.Name.StartsWith('rt-native-acceptance-') -and -not($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'D0_ROOT_INVALID'
  $owner=Get-Content -LiteralPath "$Root/owner.json" -Raw | ConvertFrom-Json
  Need ($owner.diagnostic -ceq 'D0' -and $owner.root -eq $Root -and $owner.harnessSha -ceq $env:GITHUB_SHA -and $owner.runId -ceq $env:GITHUB_RUN_ID -and $owner.runAttempt -ceq '1') 'D0_OWNER_INVALID'
  $install=[IO.Path]::GetFullPath((Join-Path $Root 'install')); $installer=$null
  $queryGuard=Join-Path $Root 'd0-query-isolation.guard'
  if($Action -eq 'cleanup') {
    $queryCleanup=Get-SavedQueryCleanup $Root
    $processCleanup=Get-SavedOwnedCleanup $Root {param($record) Stop-Identified $record}
    $remaining=[int]$queryCleanup.remainingOwned+[int]$processCleanup.remainingOwned
    $unknownDescendant=($queryCleanup.unknownDescendant -or $processCleanup.unknownDescendant)
    # An unresolved helper is NOT an installer PID. Never find/kill it by name,
    # nor remove protection just because a separate observer process exited.
    $clean=($remaining -eq 0 -and -not $unknownDescendant -and $queryCleanup.succeeded -and $processCleanup.succeeded)
    @{diagnosticOnly=$true;upgradeAccepted=$false;succeeded=$clean;remainingOwned=$remaining;unknownDescendant=$unknownDescendant;
      queryCleanup=$queryCleanup;ownershipRegistry=$processCleanup.registryStatus;ownedCheckedCount=$processCleanup.checkedCount;scope=$processCleanup.scope} | ConvertTo-Json -Depth 5 -Compress
    exit $(if($clean){0}else{1})
  }
  Set-Stage 'pre-install-guards'
  Need (Test-Path -LiteralPath "$Root/d0-verified.json") 'D0_FREEZE_RECEIPT_REQUIRED'
  Need (Test-Path -LiteralPath "$Root/d0-budget-consumed.json") 'D0_BUDGET_CLAIM_REQUIRED'
  # A second observer cannot launch even in the same run/case.
  $code='D0_NATIVE_BUDGET_EXHAUSTED'
  $marker=[IO.File]::Open("$Root/d0-native-invocation.claim",[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None); $marker.Dispose()
  $code='D0_OBSERVER_FAILED'
  $receipt=Get-Content -LiteralPath "$Root/download-receipt.json" -Raw | ConvertFrom-Json
  $pin=$receipt.installers[0]
  Need ($pin.version -ceq '1.0.0' -and $pin.basename -ceq 'RT-ResearchFlow-Setup-1.0.0-x64.exe' -and $pin.size -eq 166547210 -and $pin.sha256 -ceq 'f5ea701458902dbcdeea08b3aabbcfca23b2c2c6a16ed8b88de1b31811033a4b') 'D0_OLD_PIN_INVALID'
  Need ($pin.path -match '^rt-native-upgrade-[A-Za-z0-9_-]+/RT-ResearchFlow-Setup-1\.0\.0-x64\.exe$') 'D0_INSTALLER_PATH_INVALID'
  $installer=[IO.Path]::GetFullPath((Join-Path $temporary $pin.path))
  Need ((Get-Item -LiteralPath $installer).Length -eq 166547210 -and (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $pin.sha256) 'D0_INSTALLER_BYTES_CHANGED'
  Need (-not(Test-Path -LiteralPath $install)) 'INSTALL_TARGET_NOT_EMPTY'
  $registrations=@(Registrations)
  $existing=@(Get-CimInstance Win32_Process -Filter "Name='RT-ResearchFlow.exe'" -OperationTimeoutSec 3)
  Need ($registrations.Count -eq 0 -and $existing.Count -eq 0) 'PREEXISTING_PRODUCT_STATE'
  $rules=@(Get-NetFirewallRule -Group ('rt-native-acceptance-'+$owner.caseId) -ErrorAction Stop)
  Need ($rules.Count -eq 2 -and @($rules | Where-Object {$_.Enabled -ne 'True' -or $_.Direction -ne 'Outbound' -or $_.Action -ne 'Block'}).Count -eq 0) 'REUSED_PROTECTION_MISSING'
  Need (Test-Path -LiteralPath "$Root/audit-policy.csv") 'REUSED_WFP_SETUP_MISSING'
  $report.preflight=@{emptyTarget=$true;registrationsBefore=0;productProcessesBefore=0;protectionUnchanged=$true}
  $report.paths=@((Shape 'launcher-location' (Get-Location).Path),(Shape 'launcher-process-cwd' ([Environment]::CurrentDirectory)),
    (Shape 'TEMP' $env:TEMP),(Shape 'TMP' $env:TMP),(Shape 'case' $Root),(Shape 'target' $install),(Shape 'installer' $installer))
  Need (@($report.paths | Where-Object {$_.label -in @('target','case','installer') -and ($_.localVolume -ne $true -or $_.reparseAncestor -ne $false)}).Count -eq 0) 'OWNED_PATH_SHAPE_UNSAFE'
  $probe=Join-Path $Root 'd0-write-probe'; $stream=[IO.File]::Open($probe,[IO.FileMode]::CreateNew); $stream.Dispose(); Remove-Item -LiteralPath $probe
  ($report.paths | Where-Object label -EQ 'case').writable=$true
  $report.parameterShape='/S /D=<CASE>/install'; $report.installerCwd='unavailable; launcher path shapes recorded without changing cwd'
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class D0Native {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint a,bool i,int p);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsWow64Process2(IntPtr h,out ushort p,out ushort n);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr h,uint a,out IntPtr t);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr t,int c,IntPtr b,int z,out int r);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr s);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr s,uint n);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessMitigationPolicy(IntPtr h,int p,out uint b,int z);
  static string Arch(ushort a) { return a==0x14c?"x86":a==0x8664?"x64":a==0xaa64?"arm64":"unavailable"; }
  public static Dictionary<string,string> Inspect(int pid) {
    var r=new Dictionary<string,string>(); r["architecture"]="unavailable";r["elevated"]="unavailable";r["integrity"]="unavailable";
    IntPtr h=OpenProcess(0x1000,false,pid); if(h==IntPtr.Zero)return r;
    try {
      ushort p,n; if(IsWow64Process2(h,out p,out n))r["architecture"]=Arch(p==0?n:p);
      IntPtr token; if(OpenProcessToken(h,8,out token)) {
        try {
          int required; IntPtr b=Marshal.AllocHGlobal(4096);
          try {
            if(GetTokenInformation(token,20,b,4096,out required))r["elevated"]=Marshal.ReadInt32(b)!=0?"true":"false";
            if(GetTokenInformation(token,25,b,4096,out required)) {
              IntPtr sid=Marshal.ReadIntPtr(b); byte count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));
              uint rid=(uint)Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));
              r["integrity"]=rid==0x1000?"low":rid==0x2000?"medium":rid==0x2100?"medium-plus":rid==0x3000?"high":rid==0x4000?"system":"other";
            }
          } finally {Marshal.FreeHGlobal(b);}
        } finally {CloseHandle(token);}
      }
      foreach(int policy in new[]{0,1,2,3,6,7,8}) {uint flags;r["policy"+policy]=GetProcessMitigationPolicy(h,policy,out flags,4)?flags.ToString("x8"):"unavailable";}
    } finally {CloseHandle(h);}
    return r;
  }
}
'@ | Out-Null
  function Native-Context([int]$ProcessId) {
    $value=[D0Native]::Inspect($ProcessId)
    $policies=@(); foreach($id in @(0,1,2,3,6,7,8)) { $v=$value['policy'+$id]; $policies+=@{name=('policy-'+$id);flags=$(if($v){$v}else{'unavailable'})} }
    return @{processArchitecture=$value.architecture;elevated=$value.elevated;integrity=$value.integrity;mitigations=$policies}
  }
  $context=Native-Context $PID
  Need ($context.elevated -ne 'unavailable' -and $context.integrity -ne 'unavailable') 'LAUNCHER_TOKEN_UNAVAILABLE'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $report.identity=@{sidSha256=(Digest $identity.User.Value);elevated=$context.elevated;integrity=$context.integrity;
    administrator=([Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator));mitigations=$context.mitigations}
  $os=Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 3
  $edition=if($os.Caption -match '^[A-Za-z0-9 ()-]{1,96}$') {[string]$os.Caption} else {'SKU-'+[string]$os.OperatingSystemSKU}
  $report.runner=@{osBuild=[string]$os.BuildNumber;osEdition=$edition;powershellVersion=$PSVersionTable.PSVersion.ToString();cpuArchitecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()}
  function Observe-Processes {
    $all=@(Get-CimInstance Win32_Process -OperationTimeoutSec 3)
    do {
      $count=$tracked.Count
      foreach($p in $all) {
        $id=[string]$p.ProcessId; $parent=[string]$p.ParentProcessId
        if(-not $tracked.ContainsKey($id) -and $tracked.ContainsKey($parent) -and $p.CreationDate -ge [DateTime]::Parse($tracked[$parent].createdUtc)) {
          $category=Kind-Path $p.ExecutablePath
          if(-not $p.ExecutablePath -or $category -notin @('verified-download','case-install','nsis-temp')) {
            $script:stopRequested=$true; Record-Error 'BLOCKED_ENVIRONMENT' 'DESCENDANT_OUTSIDE_OWNED_SCOPE' 'process-observation' $null
          }
          $tracked[$id]=@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;createdUtc=$p.CreationDate.ToUniversalTime().ToString('o');rawPath=[string]$p.ExecutablePath;category=$category;observedUtc=[DateTime]::UtcNow.ToString('o');native=(Native-Context $p.ProcessId);exitCode='unavailable';exitedUtc='unavailable';alive=$true}
          [void](Register-OwnedProcess $tracked[$id])
          if($p.ExecutablePath -eq (Join-Path $install 'RT-ResearchFlow.exe')) { $report.autoStartedProduct=$true; [void](Stop-Identified $tracked[$id]) }
        }
      }
    } while($count -ne $tracked.Count)
    foreach($entry in $tracked.Values) {
      $live=$all | Where-Object ProcessId -EQ $entry.pid
      if($live -and $live.ExecutablePath -eq $entry.rawPath -and $live.CreationDate.ToUniversalTime().ToString('o') -eq $entry.createdUtc) {
        try {
          foreach($module in (Get-Process -Id $entry.pid -ErrorAction Stop).Modules) {
            if($module.ModuleName -ieq 'System.dll') { $key=[string]$entry.pid+':'+$module.FileName; $modules[$key]=@{pid=$entry.pid;rawPath=$module.FileName;observedUtc=[DateTime]::UtcNow.ToString('o')} }
          }
        } catch { $entry.moduleUnavailable=$true }
      } else { $entry.alive=$false } # Not an observed native exit timestamp or exit code.
    }
    Save-Owned
  }
  Initialize-OwnedExitType
  Set-Stage 'single-install'; $start=[DateTime]::UtcNow
  $report.attempted=$true; $report.invocationCount=1
  # Deliberately identical to the frozen R0 invocation. No extra switch, cwd, TEMP or elevation override.
  $p=Start-Process -FilePath $installer -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -PassThru
  $tracked[[string]$p.Id]=@{pid=$p.Id;parentPid='unavailable';createdUtc=$p.StartTime.ToUniversalTime().ToString('o');rawPath=$installer;category='verified-download';observedUtc=[DateTime]::UtcNow.ToString('o');native=(Native-Context $p.Id);exitCode='unavailable';exitedUtc='unavailable';alive=$true}
  [void](Register-OwnedProcess $tracked[[string]$p.Id])
  Save-Owned
  $rootInfo=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -OperationTimeoutSec 3
  if($rootInfo) {
    Need ($rootInfo.ExecutablePath -eq $installer) 'LAUNCHED_PROCESS_IDENTITY_UNAVAILABLE'
    $tracked[[string]$p.Id].parentPid=[int]$rootInfo.ParentProcessId
    $tracked[[string]$p.Id].createdUtc=$rootInfo.CreationDate.ToUniversalTime().ToString('o')
  }
  Save-Owned
  # Snapshot observation replaces only the wait polling cadence, not its 120-second budget.
  $deadline=$start.AddMilliseconds(120000)
  while(-not $p.WaitForExit(100)) {
    Observe-Processes
    if($stopRequested -or [DateTime]::UtcNow -ge $deadline) { $report.timedOut=(-not $stopRequested); break }
  }
  Observe-Processes
  if($p.HasExited) { $report.exitCode=$p.ExitCode; $tracked[[string]$p.Id].exitCode=$p.ExitCode; $tracked[[string]$p.Id].exitedUtc=$p.ExitTime.ToUniversalTime().ToString('o'); $tracked[[string]$p.Id].alive=$false }
  if($report.timedOut) { Record-Error 'FAIL_INSTALL' 'NSIS_TIMEOUT' 'single-install' $null }
  elseif($p.HasExited -and $p.ExitCode -ne 0) { Record-Error 'FAIL_INSTALL' 'NSIS_NONZERO_EXIT' 'single-install' $null }
  $report.elapsedMs=[int]([DateTime]::UtcNow-$start).TotalMilliseconds
  # End owned children before waiting for event publication. Do not defer or obstruct NSIS DLL cleanup.
  Set-Stage 'owned-process-cleanup'
  foreach($entry in @($tracked.Values | Sort-Object pid -Descending)) { if(-not(Stop-Identified $entry)) { Record-Error 'DIAGNOSTIC_ERROR' 'OWNED_PROCESS_CLEANUP_INCOMPLETE' $stage $null } }
  Save-Owned
  # Bootstrap compilation/encoding does not query events or start a process.
  $queryConfig=@{root=$Root;install=$install;installer=$installer;from=$start.ToString('o');processes=$tracked}
  $adapter=New-EventQueryAdapter $queryConfig
  [IO.File]::WriteAllText($queryGuard,'read-only-query; receipt-incomplete; preserve-isolation')
  Set-Stage 'event-observation'
  $eventStart=[DateTime]::UtcNow
  $queryConfig.through=$eventStart.AddSeconds(60).ToString('o')
  # 250ms normal EOF drain + 500ms termination/collection reserve, all INSIDE
  # the original 60s window. Scheduling tolerance does not grant more querying.
  $queryConfig.queryThrough=$eventStart.AddMilliseconds(59250).ToString('o')
  $facts=@{unattributed=0}
  $observation=Invoke-QueryDeadline $adapter {
    param($frame)
    if($frame.kind -eq 'unattributed') { $facts.unattributed++; return }
    $item=$frame.item; $key=[string]$item.recordId
    if($eventsSeen.ContainsKey($key)) { return }; $eventsSeen[$key]=$true
    $report.events+=,$item
    if($frame.rawModulePath) { $modules['event:'+$key]=@{pid=$item.faultPid;rawPath=$frame.rawModulePath;observedUtc=$item.eventUtc} }
  }
  $observation.matchedCount=$report.events.Count; $observation.unattributedCount=$facts.unattributed
  $observation.queryWindowMs=59250; $observation.resultDrainReserveMs=250
  $observation.scope='Application-1000-1001-window; missing-fault-PID-is-not-attributed'
  $report.eventObservation=$observation
  # This contains only the small sanitized boundary receipt, never events,
  # absolute paths, command lines, raw exceptions, or the query configuration.
  $observation | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath "$Root/d0-event-query-receipt.json"
  if($observation.receiptComplete) { Remove-Item -LiteralPath $queryGuard }
  if($observation.queryTimeout) { Record-Error 'DIAGNOSTIC_ERROR' 'D0_EVENT_QUERY_TIMEOUT' $stage $null }
  if($observation.queryUnavailable) { Record-Error 'DIAGNOSTIC_ERROR' 'D0_EVENT_QUERY_UNAVAILABLE' $stage $null }
  if($observation.deadlineExceeded) { Record-Error 'DIAGNOSTIC_ERROR' 'D0_EVENT_DEADLINE_EXCEEDED' $stage $null }
  if(-not $observation.receiptComplete) { Record-Error 'DIAGNOSTIC_ERROR' 'D0_EVENT_QUERY_RECEIPT_INCOMPLETE' $stage $null }
  Set-Stage 'post-exit-module-observation'
  foreach($module in $modules.Values) {
    $item=@{pid=$module.pid;moduleName=(Safe-Name $module.rawPath);category=(Kind-Path $module.rawPath);modulePathSha256=(Digest $module.rawPath);observedUtc=$module.observedUtc;sha256='unavailable';size='unavailable';signature='unavailable';signedHashStable='unavailable'}
    # Only read still-existing originals, after owned processes have been stopped.
    # Share Delete explicitly; never hold a DLL open to intercept cleanup.
    if(Test-Path -LiteralPath $module.rawPath -PathType Leaf) {
      try {
        $info=Get-Item -LiteralPath $module.rawPath
        if(-not($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
          $stream=[IO.File]::Open($module.rawPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
          try { $item.size=$stream.Length; $item.sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() } finally {$stream.Dispose()}
          $signature=Get-AuthenticodeSignature -LiteralPath $module.rawPath
          if($signature.Status.ToString() -in @('Valid','NotSigned','HashMismatch','NotTrusted','NotSupportedFileFormat','Incompatible','UnknownError')) { $item.signature=$signature.Status.ToString() }
          $after=Get-Item -LiteralPath $module.rawPath
          $item.signedHashStable=($info.Length -eq $after.Length -and $info.LastWriteTimeUtc -eq $after.LastWriteTimeUtc)
        }
      } catch { $item.unavailableReason='original-module-no-longer-readable' }
    } else { $item.unavailableReason='original-module-disappeared; no-retry-or-extraction' }
    $report.moduleCandidates+=,$item
  }
  if($report.moduleCandidates.Count -eq 0) { $report.fieldsUnavailable=@('System.dll-path-hash-signature-not-observed') }
  $after=@(Registrations)
  $report.registrationsAfter=$after.Count; $report.identityConfirmed=$false
  if($after.Count -eq 1) {
    $report.registeredVersion=if($after[0].version -eq '1.0.0') {'1.0.0'} else {'unavailable-or-unexpected'}
    $report.locationMatches=($after[0].location -and [IO.Path]::GetFullPath($after[0].location).TrimEnd('\') -eq $install)
    $report.registrationSha256=Digest ($after[0].key+'|'+$after[0].location)
    $report.identityConfirmed=($report.registeredVersion -eq '1.0.0' -and $report.locationMatches)
  }
  if($report.exitCode -eq 0 -and (-not $report.identityConfirmed -or $report.autoStartedProduct)) { Record-Error 'DIAGNOSTIC_ERROR' 'EXIT_ZERO_NOT_SUFFICIENT_FOR_INSTALL_IDENTITY' 'post-install-identity' $null }
} catch { Record-Error 'DIAGNOSTIC_ERROR' $code $stage $_.Exception }
finally {
  if($Action -eq 'run') {
    $queryCleanup=if($queryGuard) {Get-SavedQueryCleanup $Root} else {Get-QueryCleanupReceipt $false $null}
    $processCleanup=if($queryGuard) {Get-SavedOwnedCleanup $Root {param($record) Stop-Identified $record}} else {Get-OwnedCleanupReceipt $false $false $null {}}
    $remaining=[int]$queryCleanup.remainingOwned+[int]$processCleanup.remainingOwned
    $unknownDescendant=($queryCleanup.unknownDescendant -or $processCleanup.unknownDescendant)
    if(-not $processCleanup.succeeded) {
      # Best-effort termination of identities still known in this observer does
      # NOT repair an unavailable durable registry or authorize restoration.
      foreach($entry in @($tracked.Values | Sort-Object pid -Descending)) { try { [void](Stop-Identified $entry) } catch {} }
    }
    $report.cleanupOwned=@{succeeded=($remaining -eq 0 -and -not $unknownDescendant -and $queryCleanup.succeeded -and $processCleanup.succeeded);
      remainingOwned=$remaining;unknownDescendant=$unknownDescendant;queryCleanup=$queryCleanup;
      ownershipRegistry=$processCleanup.registryStatus;ownedCheckedCount=$processCleanup.checkedCount;scope=$processCleanup.scope}
    if($remaining -gt 0) { Record-Error 'DIAGNOSTIC_ERROR' 'OWNED_PROCESS_CLEANUP_INCOMPLETE' 'cleanup' $null }
    foreach($entry in $tracked.Values) {
      $report.processes+=@{pid=$entry.pid;parentPid=$entry.parentPid;createdUtc=$entry.createdUtc;exitedUtc=$entry.exitedUtc;observedUtc=$entry.observedUtc;exitCode=$entry.exitCode;alive=$entry.alive;
        imageName=(Safe-Name $entry.rawPath);imageNameSha256=(Digest ([IO.Path]::GetFileName($entry.rawPath)));imagePathSha256=(Digest $entry.rawPath);category=$entry.category;
        processArchitecture=$entry.native.processArchitecture;integrity=$entry.native.integrity;elevated=$entry.native.elevated;mitigations=$entry.native.mitigations}
    }
    $report | ConvertTo-Json -Depth 12 -Compress
  }
}
if($report.primary) { exit 1 }
