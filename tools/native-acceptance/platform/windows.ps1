param(
  [Parameter(Mandatory)][ValidateSet('setup','install','processes','denials','cleanup')][string]$Action,
  [Parameter(Mandatory)][string]$Root,
  [string]$Installer, [ValidateSet('1.0.0','1.1.0')][string]$Version,
  [string]$Since
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$kind = 'BLOCKED_ENVIRONMENT'
$code = 'WINDOWS_CONTROL_FAILED'
function Need($Condition, [string]$Code) { if (-not $Condition) { $script:code=$Code; throw $Code } }
function Owned([string]$Value) {
  $full=[IO.Path]::GetFullPath($Value)
  Need ($full.StartsWith($Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) 'PATH_NOT_OWNED'
  return $full
}
function Registrations {
  $result=@()
  foreach($base in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if(Test-Path -LiteralPath $base) {
      foreach($item in Get-ChildItem -LiteralPath $base) {
        $p=Get-ItemProperty -LiteralPath $item.PSPath
        if($p.DisplayName -ceq 'RT-ResearchFlow') {
          $result+=@{key=$item.Name;version=$p.DisplayVersion;location=$p.InstallLocation}
        }
      }
    }
  }
  return $result
}
function ProductProcesses {
  return @(Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)) -or $_.Name -eq 'RT-ResearchFlow.exe'
  } | ForEach-Object { @{pid=[int]$_.ProcessId;parentId=[int]$_.ParentProcessId;exe=$_.ExecutablePath;started=$_.CreationDate.ToUniversalTime().ToString('o')} })
}
function InstallRules {
  $paths=@($exe)
  if(Test-Path -LiteralPath $install) {
    $paths+=@(Get-ChildItem -LiteralPath $install -Filter '*.exe' -Recurse -File | ForEach-Object { Owned $_.FullName })
  }
  $paths=@($paths | Sort-Object -Unique)
  foreach($program in $paths) {
    $bytes=[Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($program.ToLowerInvariant()))
    $id=[Convert]::ToHexString($bytes).Substring(0,16)
    foreach($family in @('v4','v6')) {
      $name="$group-$id-$family"
      if(-not (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)) {
        $remote=if($family -eq 'v4') { @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255') } else { @('::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff') }
        New-NetFirewallRule -Name $name -DisplayName $name -Group $group -Direction Outbound -Action Block -Enabled True -Profile Any -Program $program -RemoteAddress $remote | Out-Null
      }
    }
  }
  $paths | ConvertTo-Json -AsArray | Set-Content -LiteralPath (Owned "$Root/firewall-programs.json")
  return $paths
}
function StopOwned {
  $items=ProductProcesses
  foreach($item in $items) {
    Need ($item.exe -and $item.exe.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)) 'UNKNOWN_PRODUCT_PROCESS'
    # Recheck identity immediately before signalling; never kill by product name.
    $actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($item.pid)"
    if($actual -and $actual.ExecutablePath -eq $item.exe -and $actual.CreationDate.ToUniversalTime().ToString('o') -eq $item.started) {
      Stop-Process -Id $item.pid -Force -ErrorAction Stop
    }
  }
}
try {
  Need ($env:CI -ceq 'true' -and $env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted' -and $IsWindows) 'HOSTED_WINDOWS_REQUIRED'
  Need ([IO.Path]::IsPathFullyQualified($Root) -and [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) 'ABSOLUTE_ROOT_REQUIRED'
  $Root=[IO.Path]::GetFullPath($Root).TrimEnd('\')
  $temp=(Get-Item -LiteralPath $env:RUNNER_TEMP).FullName.TrimEnd('\')
  $rootItem=Get-Item -LiteralPath $Root
  Need ($rootItem.Parent.FullName -eq $temp -and $rootItem.Name.StartsWith('rt-native-acceptance-') -and -not($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'CASE_ROOT_INVALID'
  $owner=Get-Content -LiteralPath "$Root/owner.json" -Raw | ConvertFrom-Json
  Need ($owner.root -eq $Root -and $owner.platform -ceq 'windows' -and $owner.arch -ceq 'x64' -and $owner.harnessSha -ceq $env:GITHUB_SHA -and $owner.runId -ceq $env:GITHUB_RUN_ID -and $owner.runAttempt -ceq $env:GITHUB_RUN_ATTEMPT) 'CASE_OWNER_INVALID'
  $install=Owned "$Root/install"
  $exe=Owned "$install/RT-ResearchFlow.exe"
  $group='rt-native-acceptance-'+$owner.caseId
  $audit=Owned "$Root/audit-policy.csv"
  $auditId='{0CCE9226-69AE-11D9-BED3-505054503030}'
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if($Action -eq 'setup') {
    Need (-not(Test-Path -LiteralPath $install)) 'INSTALL_DIRECTORY_EXISTS'
    Need (@(Registrations).Count -eq 0) 'PREEXISTING_PRODUCT_REGISTRATION'
    Need (@(ProductProcesses).Count -eq 0) 'PREEXISTING_PRODUCT_PROCESS'
    Need (@(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Count -eq 0) 'FIREWALL_DISABLED'
    & auditpol.exe /backup "/file:$audit" *> $null
    Need ($LASTEXITCODE -eq 0) 'AUDIT_BACKUP_FAILED'
    & auditpol.exe /set "/subcategory:$auditId" /failure:enable *> $null
    Need ($LASTEXITCODE -eq 0) 'WFP_AUDIT_UNAVAILABLE'
    $programs=InstallRules
    @{sid=$sid;created=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Owned "$Root/windows-owner.json")
    @{ok=$true;uid=$sid;programs=@($programs);policy='app-specific-ipv4-ipv6-outbound-deny-with-wfp-audit'} | ConvertTo-Json -Compress
  } elseif($Action -eq 'install') {
    $kind='FAIL_INSTALL'
    Need ($Version -in @('1.0.0','1.1.0')) 'INSTALL_VERSION_INVALID'
    $receipt=Get-Content -LiteralPath "$Root/download-receipt.json" -Raw | ConvertFrom-Json
    $pin=@($receipt.installers | Where-Object version -CEQ $Version)
    Need ($pin.Count -eq 1) 'INSTALL_RECEIPT_INVALID'
    $expected=[IO.Path]::GetFullPath((Join-Path $temp $pin[0].path))
    Need ($expected -eq [IO.Path]::GetFullPath($Installer) -and $expected.StartsWith($temp+'\',[StringComparison]::OrdinalIgnoreCase)) 'INSTALLER_PATH_INVALID'
    Need ((Get-Item -LiteralPath $Installer).Length -eq $pin[0].size -and (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $pin[0].sha256) 'INSTALLER_BYTES_CHANGED'
    Need (@(ProductProcesses).Count -eq 0) 'PRODUCT_NOT_EXITED'
    $before=@(Registrations)
    if($Version -eq '1.0.0') { Need ($before.Count -eq 0 -and -not(Test-Path -LiteralPath $install)) 'OLD_INSTALL_NOT_CLEAN' }
    else { Need ($before.Count -eq 1) 'UPGRADE_REGISTRATION_MISSING' }
    $start=[DateTime]::UtcNow
    $p=Start-Process -FilePath $Installer -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -PassThru
    # The install process is owned by this invocation, but not necessarily under install/.
    @{pid=$p.Id;exe=$Installer;started=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Owned "$Root/installer-process.json")
    if(-not $p.WaitForExit(120000)) {
      $all=@(Get-CimInstance Win32_Process); $ownedIds=@([int]$p.Id)
      do { $oldCount=$ownedIds.Count; $ownedIds+=@($all | Where-Object { $_.ParentProcessId -in $ownedIds -and $_.ProcessId -notin $ownedIds } | ForEach-Object { [int]$_.ProcessId }); $ownedIds=@($ownedIds | Select-Object -Unique) } while($ownedIds.Count -gt $oldCount)
      foreach($childId in ($ownedIds | Sort-Object -Descending)) {
        $original=$all | Where-Object ProcessId -EQ $childId
        $current=Get-CimInstance Win32_Process -Filter "ProcessId=$childId"
        if($original -and $current -and $original.CreationDate -eq $current.CreationDate) { Stop-Process -Id $childId -Force -ErrorAction SilentlyContinue }
      }
      Need $false 'NSIS_TIMEOUT'
    }
    $exit=$p.ExitCode
    $events=@()
    if($exit -ne 0) {
      foreach($event in @(Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$start;Id=1000,1001} -ErrorAction SilentlyContinue)) {
        [xml]$xml=$event.ToXml(); $fields=@{}
        foreach($d in $xml.Event.EventData.Data) { if($d.Name) { $fields[$d.Name]=[string]$d.'#text' } }
        if($fields.AppPath -eq $Installer -or $fields.AppName -eq [IO.Path]::GetFileName($Installer)) {
          $events+=@{moduleName=[IO.Path]::GetFileName($fields.ModuleName);moduleVersion=$fields.ModuleVersion;exceptionCode=$fields.ExceptionCode;faultOffset=$fields.FaultingOffset}
        }
      }
    }
    @{version=$Version;exitCode=$exit;durationMs=[int]([DateTime]::UtcNow-$start).TotalMilliseconds;events=$events} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Owned "$Root/installer-event-$Version.json")
    Need ($exit -eq 0) 'NSIS_NONZERO_EXIT'
    Need (@(ProductProcesses).Count -eq 0) 'INSTALLER_AUTO_STARTED_PRODUCT'
    Need (Test-Path -LiteralPath $exe -PathType Leaf) 'INSTALLED_EXE_MISSING'
    $after=@(Registrations)
    Need ($after.Count -eq 1 -and $after[0].version -ceq $Version -and [IO.Path]::GetFullPath($after[0].location).TrimEnd('\') -eq $install) 'INSTALLED_REGISTRATION_INVALID'
    $baseline=Owned "$Root/registration-baseline.json"
    if($Version -eq '1.0.0') { $after[0] | ConvertTo-Json | Set-Content -LiteralPath $baseline }
    else {
      $prior=Get-Content -LiteralPath $baseline -Raw | ConvertFrom-Json
      Need ($after[0].key -ceq $prior.key -and $after[0].location -ceq $prior.location) 'UPGRADE_REGISTRATION_CHANGED'
    }
    $programs=InstallRules
    @{ok=$true;exitCode=$exit;uid=$sid;registration=$after[0];programs=@($programs);events=$events;durationMs=[int]([DateTime]::UtcNow-$start).TotalMilliseconds} | ConvertTo-Json -Depth 6 -Compress
  } elseif($Action -eq 'processes') {
    $all=@(Get-CimInstance Win32_Process)
    $items=@(ProductProcesses); $ids=@($items | ForEach-Object { $_.pid })
    do {
      $old=$ids.Count
      foreach($p in $all) { if($p.ParentProcessId -in $ids -and $p.ProcessId -notin $ids) { $ids+=([int]$p.ProcessId); $items+=@{pid=[int]$p.ProcessId;parentId=[int]$p.ParentProcessId;exe=$p.ExecutablePath;started=$p.CreationDate.ToUniversalTime().ToString('o')} } }
    } while($old -ne $ids.Count)
    @{ok=$true;processes=@($items)} | ConvertTo-Json -Depth 5 -Compress
  } elseif($Action -eq 'denials') {
    $from=[DateTime]::Parse($Since).ToUniversalTime(); $events=@()
    foreach($event in @(Get-WinEvent -FilterHashtable @{LogName='Security';Id=5157;StartTime=$from} -MaxEvents 2000 -ErrorAction SilentlyContinue)) {
      [xml]$xml=$event.ToXml(); $fields=@{}
      foreach($d in $xml.Event.EventData.Data) { $fields[$d.Name]=[string]$d.'#text' }
      # WFP uses a device path. Match its unique case suffix, not merely the filename.
      if($fields.Application -and $fields.Application.ToLowerInvariant().Contains(([IO.Path]::GetFileName($Root)+'\').ToLowerInvariant())) {
        $events+=@{pid=$fields.ProcessID;destination=$fields.DestAddress;port=$fields.DestPort;application=$fields.Application;time=$event.TimeCreated.ToUniversalTime().ToString('o')}
      }
    }
    @{ok=$true;events=@($events)} | ConvertTo-Json -Depth 5 -Compress
  } else {
    StopOwned
    $pending=Owned "$Root/installer-process.json"
    if(Test-Path -LiteralPath $pending) {
      $p=Get-Content -LiteralPath $pending -Raw | ConvertFrom-Json
      $actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.pid)"
      if($actual -and $actual.ExecutablePath -eq $p.exe -and $actual.CreationDate.ToUniversalTime().ToString('o') -eq $p.started) { Stop-Process -Id $p.pid -Force }
    }
    Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if(Test-Path -LiteralPath $audit) { & auditpol.exe /restore "/file:$audit" *> $null; Need ($LASTEXITCODE -eq 0) 'AUDIT_RESTORE_FAILED' }
    Need (@(ProductProcesses).Count -eq 0) 'OWNED_PROCESSES_REMAIN'
    @{ok=$true;cleanupSucceeded=$true} | ConvertTo-Json -Compress
  }
} catch {
  @{ok=$false;kind=$kind;code=$code} | ConvertTo-Json -Compress
  exit 1
}
