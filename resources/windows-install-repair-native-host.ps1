$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# The verified envelope loader sets UTF-8 before replacing Console.In with the
# payload reader. Do not reset InputEncoding here: it discards that reader.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# This is a private primitive, not an authorization endpoint. The reviewed
# consumer verifies installer ancestry, consent, producer signature and exact
# operation bindings BEFORE starting this child. No UAC or old uninstaller here.
function ReadKey($base, $path) {
  $key = $base.OpenSubKey($path, $false)
  if ($null -eq $key) { return @{ state='absent'; values=$null; children=@() } }
  try {
    $values = @()
    foreach ($name in ($key.GetValueNames() | Sort-Object)) {
      $kind = $key.GetValueKind($name)
      $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      switch ($kind.ToString()) {
        'String' { $type='REG_SZ'; $data=[string]$value }
        'ExpandString' { $type='REG_EXPAND_SZ'; $data=[string]$value }
        'DWord' { $type='REG_DWORD'; $data=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int32]$value),0) }
        'QWord' { $type='REG_QWORD'; $data=[BitConverter]::ToUInt64([BitConverter]::GetBytes([int64]$value),0).ToString([Globalization.CultureInfo]::InvariantCulture) }
        'Binary' { $type='REG_BINARY'; $data=-join @($value | ForEach-Object { $_.ToString('x2') }) }
        'MultiString' { $type='REG_MULTI_SZ'; $data=@($value) }
        default { throw 'unsupported-type' }
      }
      $values += @{name=[string]$name; type=$type; data=$data}
    }
    return @{state='present';values=@($values);children=@($key.GetSubKeyNames() | Sort-Object)}
  } finally { $key.Dispose() }
}
function NormalizeImage($image) {
  if ($image.state -eq 'absent') {
    if ($null -ne $image.values -or @($image.children).Count -ne 0) { throw 'bad-absent' }
    return @{state='absent';values=$null;children=@()}
  }
  if ($image.state -ne 'present' -or $null -eq $image.values -or @($image.children).Count -ne 0) { throw 'unsupported-image' }
  $values=@();$seen=@{}
  foreach ($v in @($image.values | Sort-Object name)) {
    $name=[string]$v.name
    if ($seen.ContainsKey($name.ToLowerInvariant())) { throw 'duplicate-value' }
    $seen[$name.ToLowerInvariant()]=$true
    if ($v.type -notin @('REG_SZ','REG_EXPAND_SZ','REG_DWORD','REG_QWORD','REG_BINARY','REG_MULTI_SZ')) { throw 'bad-type' }
    $values+=@{name=$name;type=[string]$v.type;data=$v.data}
  }
  return @{state='present';values=@($values);children=@()}
}
function SameImage($a,$b) {
  # Compare exact names/types/raw data, not expanded values or Number coercion.
  if ($a.state -ne $b.state -or @($a.children).Count -ne @($b.children).Count) { return $false }
  if ($a.state -eq 'absent') { return $null -eq $b.values }
  $av=@($a.values | Sort-Object name);$bv=@($b.values | Sort-Object name)
  if ($av.Count -ne $bv.Count) { return $false }
  for($i=0;$i -lt $av.Count;$i++) {
    if ($av[$i].name -cne $bv[$i].name -or $av[$i].type -cne $bv[$i].type -or
      (($av[$i].data | ConvertTo-Json -Depth 6 -Compress) -cne ($bv[$i].data | ConvertTo-Json -Depth 6 -Compress))) { return $false }
  }
  return $true
}
function ReplaceKey($base,$path,$expected,$next) {
  $actual=ReadKey $base $path
  if (@($actual.children).Count -ne 0 -or !(SameImage $actual $expected)) { throw 'observed-concurrent-change' }
  # This read -> write is NOT an OS CAS. The coordinator preserves a durable
  # intent, reads all eight keys around stages, and retains uncertain journals.
  if ($next.state -eq 'absent') {
    if ($actual.state -eq 'present') { $base.DeleteSubKey($path,$true) }
  } else {
    $key=$base.CreateSubKey($path,$true)
    try {
      $wanted=@{};foreach($v in $next.values){$wanted[$v.name.ToLowerInvariant()]=$true}
      $working=$actual
      # Never expand deletion authority to values discovered after the checked
      # before image. Extra/concurrent values stop this run; this is NOT CAS.
      foreach($old in @($expected.values)){
        if(!$wanted.ContainsKey($old.name.ToLowerInvariant())){
          if(!(SameImage (ReadKey $base $path) $working)){throw 'observed-concurrent-change'}
          $key.DeleteValue([string]$old.name,$true)
          $working.values=@($working.values | Where-Object { $_.name -ine $old.name })
        }
      }
      foreach($v in $next.values){
        if(!(SameImage (ReadKey $base $path) $working)){throw 'observed-concurrent-change'}
        switch($v.type){
          'REG_SZ' {$kind=[Microsoft.Win32.RegistryValueKind]::String;$data=[string]$v.data}
          'REG_EXPAND_SZ' {$kind=[Microsoft.Win32.RegistryValueKind]::ExpandString;$data=[string]$v.data}
          'REG_DWORD' {$kind=[Microsoft.Win32.RegistryValueKind]::DWord;$data=[BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$v.data),0)}
          'REG_QWORD' {$kind=[Microsoft.Win32.RegistryValueKind]::QWord;$data=[BitConverter]::ToInt64([BitConverter]::GetBytes([uint64]::Parse([string]$v.data)),0)}
          'REG_BINARY' {$kind=[Microsoft.Win32.RegistryValueKind]::Binary;$hex=[string]$v.data;$data=[byte[]]::new($hex.Length/2);for($i=0;$i -lt $data.Length;$i++){$data[$i]=[Convert]::ToByte($hex.Substring($i*2,2),16)}}
          'REG_MULTI_SZ' {$kind=[Microsoft.Win32.RegistryValueKind]::MultiString;$data=[string[]]@($v.data)}
          default {throw 'bad-type'}
        }
        $key.SetValue([string]$v.name,$data,$kind)
        $working.values=@($working.values | Where-Object { $_.name -ine $v.name })+@($v)
      }
      $key.Flush()
    } finally {$key.Dispose()}
  }
  if (!(SameImage (ReadKey $base $path) $next)) { throw 'registry-readback' }
}
function InitializeNativeFiles {
  if ('RTRepairNativeFiles' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public static class RTRepairNativeFiles {
  [StructLayout(LayoutKind.Sequential)] struct INFO {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out INFO info);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern uint GetSecurityInfo(SafeFileHandle handle,uint objectType,uint securityInfo,
    out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll", SetLastError=true)] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int kind,ref int value,uint size);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CommandLineToArgvW(string commandLine,out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  public static string[] Arguments(string commandLine) {
    int count;IntPtr memory=CommandLineToArgvW(commandLine,out count);if(memory==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
    try{var values=new string[count];for(int i=0;i<count;i++)values[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory,i*IntPtr.Size));return values;}finally{LocalFree(memory);}
  }
  static INFO Info(SafeFileHandle h) {
    INFO v; if (!GetFileInformationByHandle(h,out v) || (v.Attributes & 0x400)!=0 || v.Links!=1) throw new IOException("unsafe-file-identity"); return v;
  }
  static string Id(INFO v) { return "win32:"+v.Volume.ToString("x8")+":"+v.IndexHigh.ToString("x8")+":"+v.IndexLow.ToString("x8"); }
  static SafeFileHandle Open(string path,uint access,uint share,uint disposition,uint flags) {
    SafeFileHandle h=CreateFileW(path,access,share,IntPtr.Zero,disposition,flags|0x200000,IntPtr.Zero);
    if(h.IsInvalid){h.Dispose();throw new Win32Exception(Marshal.GetLastWin32Error());}return h;
  }
  static List<SafeFileHandle> Parents(string path,bool requireControl=false) {
    if(!Path.IsPathRooted(path) || !String.Equals(Path.GetFullPath(path),path,StringComparison.OrdinalIgnoreCase) || path.StartsWith("\\\\")) throw new IOException("unsafe-path");
    var handles=new List<SafeFileHandle>();
    try { string current=Path.GetPathRoot(path); string relative=Path.GetDirectoryName(path).Substring(current.Length);
      var paths=new List<string>();paths.Add(current);
      foreach(string part in relative.Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries)) {current=Path.Combine(current,part);paths.Add(current);}
      foreach(string parent in paths){var h=Open(parent,requireControl?0x20080u:0x80u,3,3,0x2000000);INFO info; if(!GetFileInformationByHandle(h,out info) || (info.Attributes&0x10)==0 || (info.Attributes&0x400)!=0){h.Dispose();throw new IOException("unsafe-parent");}handles.Add(h);}
      return handles;
    }catch{foreach(var h in handles)h.Dispose();throw;}
  }
  static void Close(List<SafeFileHandle> handles){foreach(var h in handles)h.Dispose();}
  static string Hash(Stream stream){stream.Position=0;using(var h=SHA256.Create()){return BitConverter.ToString(h.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}}
  public static string[] Inspect(string path) {
    var parents=Parents(path);
    try { using(var h=Open(path,0x80000000,1,3,0)) {var info=Info(h);if((info.Attributes&0x10)!=0)throw new IOException("directory-not-member");using(var stream=new FileStream(h,FileAccess.Read)){return new string[]{Id(info),stream.Length.ToString(),Hash(stream)};}} }
    catch(Win32Exception e){if(e.NativeErrorCode==2)return new string[]{"absent","0",""};throw;}
    finally{Close(parents);}
  }
  // Read-only handle facts. Every ancestor and the leaf are opened without
  // following reparse points; absence is distinct from an unreadable object.
  public static string[] InspectPath(string path) {
    if(!Path.IsPathRooted(path) || !String.Equals(Path.GetFullPath(path),path,StringComparison.OrdinalIgnoreCase) || path.StartsWith("\\\\"))throw new IOException("unsafe-path");
    var parents=String.Equals(Path.GetPathRoot(path),path,StringComparison.OrdinalIgnoreCase)?new List<SafeFileHandle>():Parents(path);
    try { using(var h=Open(path,0x80000000,3,3,0x2000000)) {
      var info=Info(h);
      if((info.Attributes&0x10)!=0)return new string[]{Id(info),"directory","0",""};
      using(var stream=new FileStream(h,FileAccess.Read))return new string[]{Id(info),"file",stream.Length.ToString(),Hash(stream)};
    }}
    catch(Win32Exception e){if(e.NativeErrorCode==2 || e.NativeErrorCode==3)return new string[]{"","missing","0",""};throw;}
    finally{Close(parents);}
  }
  public static void CheckClosedFile(string path) {
    var parents=Parents(path);
    try {using(var h=Open(path,0x80000000,0,3,0)){var info=Info(h);if((info.Attributes&0x10)!=0)throw new IOException("expected-file");}}
    finally{Close(parents);}
  }
  public sealed class StableRead : IDisposable {
    public FileStream Stream {get;private set;}
    public string Identity {get;private set;}
    public StableRead(FileStream stream,string identity){Stream=stream;Identity=identity;}
    public void Dispose(){Stream.Dispose();}
  }
  public static StableRead OpenStableRead(string path) {
    var parents=Parents(path);SafeFileHandle handle=null;
    try {handle=Open(path,0x80000000,0,3,0);var info=Info(handle);
      if((info.Attributes&0x10)!=0)throw new IOException("backup-not-file");
      var stream=new FileStream(handle,FileAccess.Read);handle=null;
      return new StableRead(stream,Id(info));
    }finally{if(handle!=null)handle.Dispose();Close(parents);}
  }
  static void CheckPrivateHandle(SafeFileHandle handle,string userSid) {
    IntPtr owner,group,dacl,sacl,descriptor;
    uint code=GetSecurityInfo(handle,1,0x5,out owner,out group,out dacl,out sacl,out descriptor);
    if(code!=0 || descriptor==IntPtr.Zero)throw new IOException("journal-security");
    try {
      uint length=GetSecurityDescriptorLength(descriptor);
      if(length==0 || length>65536)throw new IOException("journal-security-size");
      var bytes=new byte[(int)length];Marshal.Copy(descriptor,bytes,0,(int)length);
      var security=new RawSecurityDescriptor(bytes,0);
      if(security.Owner==null || (security.Owner.Value!=userSid && security.Owner.Value!="S-1-5-32-544") ||
         security.DiscretionaryAcl==null)throw new IOException("journal-owner");
      foreach(GenericAce ace in security.DiscretionaryAcl) {
        var qualified=ace as QualifiedAce;
        if(qualified==null)throw new IOException("journal-ace");
        if(qualified.AceQualifier==AceQualifier.AccessAllowed) {
          string sid=qualified.SecurityIdentifier.Value;
          if(sid!=userSid && sid!="S-1-5-18" && sid!="S-1-5-32-544")throw new IOException("journal-acl");
        }
      }
    }finally{LocalFree(descriptor);}
  }
  public static string CheckPrivatePath(string path,string userSid) {
    var parents=Parents(path);
    try {using(var handle=Open(path,0x00020000,3,3,0x2000000)) {
      var info=Info(handle);CheckPrivateHandle(handle,userSid);return Id(info);
    }}finally{Close(parents);}
  }
  public static void CheckPrivateDirectory(string path,string userSid) {
    var security=Directory.GetAccessControl(path,AccessControlSections.Access|AccessControlSections.Owner);
    var owner=(SecurityIdentifier)security.GetOwner(typeof(SecurityIdentifier));
    if(owner.Value!=userSid && owner.Value!="S-1-5-32-544")throw new IOException("journal-owner");
    foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
      var sid=(SecurityIdentifier)rule.IdentityReference;
      if(rule.AccessControlType==AccessControlType.Allow && sid.Value!=userSid && sid.Value!="S-1-5-18" && sid.Value!="S-1-5-32-544")throw new IOException("journal-acl");
    }
  }
  public static string[] Write(string target,string source,string backup,string beforeId,string beforeSha,string nextSha,long nextSize,string userSid) {
    var targetParents=Parents(target);var sourceParents=Parents(source);var backupParents=Parents(backup,true);
    try {
      CheckPrivateHandle(backupParents[backupParents.Count-1],userSid);
      using(var srcHandle=Open(source,0x80000000,1,3,0)) {
        Info(srcHandle);
        using(var src=new FileStream(srcHandle,FileAccess.Read)) {
          if(src.Length!=nextSize || Hash(src)!=nextSha)throw new IOException("payload-pin");
          bool absent=beforeId=="absent";
          using(var dstHandle=Open(target,0xC0000000,0,absent?1u:3u,0x80000000)) {
            var info=Info(dstHandle);if((info.Attributes&0x10)!=0)throw new IOException("directory-not-member");
            using(var dst=new FileStream(dstHandle,FileAccess.ReadWrite)) {
              if(!absent && (Id(info)!=beforeId || Hash(dst)!=beforeSha))throw new IOException("member-changed");
              // Complete old bytes are durably backed up before truncation.
              using(var backupHandle=Open(backup,0xC0000000,0,1,0x80000000)) {
                Info(backupHandle);
                using(var old=new FileStream(backupHandle,FileAccess.ReadWrite)) {
                  if(!absent){dst.Position=0;dst.CopyTo(old);}
                  old.Flush(true);if(!absent && Hash(old)!=beforeSha)throw new IOException("backup-readback");
                }
              }
              dst.Position=0;dst.SetLength(0);src.Position=0;src.CopyTo(dst);dst.Flush(true);
              if(dst.Length!=nextSize || Hash(dst)!=nextSha)throw new IOException("payload-readback");
              return new string[]{Id(info),dst.Length.ToString(),nextSha};
            }
          }
        }
      }
    }finally{Close(backupParents);Close(sourceParents);Close(targetParents);}
  }
  public static void DeleteOwned(string target,string expectedId,string expectedSha) {
    var parents=Parents(target);
    try {using(var h=Open(target,0x80010000,0,3,0)){var info=Info(h);if((info.Attributes&0x10)!=0 || Id(info)!=expectedId)throw new IOException("delete-identity");
      using(var stream=new FileStream(h,FileAccess.Read)){if(Hash(stream)!=expectedSha)throw new IOException("delete-hash");int yes=1;if(!SetFileInformationByHandle(h,4,ref yes,4))throw new Win32Exception(Marshal.GetLastWin32Error());}}}
    finally{Close(parents);}
  }
}
'@
}
function RequireNativePath($value) {
  $path=[string]$value
  if($path -notmatch '^[A-Za-z]:\\' -or $path.StartsWith('\\\\') -or
     $path -cne [IO.Path]::GetFullPath($path) -or
     $path.Substring(2) -match '[<>:"/|?*\x00-\x1f]') {throw 'noncanonical-path'}
  return $path
}
function ReadNativeTree($root) {
  $rows=[Collections.Generic.List[object]]::new()
  function WalkNativeTree($base,$directory,$items) {
    foreach($child in [IO.Directory]::EnumerateFileSystemEntries($directory)) {
      $fact=[RTRepairNativeFiles]::InspectPath($child)
      if($fact[1] -notin @('file','directory')) {throw 'tree-race'}
      $relative=$child.Substring($base.Length).TrimStart('\').Replace('\','/')
      if(!$relative -or @($relative.Split('/') | Where-Object {$_ -in @('.','..','')}).Count -ne 0) {throw 'tree-path'}
      if($items.Count -ge 100000) {throw 'tree-limit'}
      if($fact[1] -eq 'file') {
        [RTRepairNativeFiles]::CheckClosedFile($child)
        if($relative -match '(?i)-(wal|shm)$') {throw 'sqlite-active'}
        $items.Add(@{path=$relative;kind='file';sha256=$fact[3];size=[long]::Parse($fact[2])})
      } else {
        $items.Add(@{path=$relative;kind='directory'})
        WalkNativeTree $base $child $items
      }
    }
  }
  if(([RTRepairNativeFiles]::InspectPath($root))[1] -ne 'directory') {throw 'data-root'}
  WalkNativeTree $root $root $rows
  return @($rows)
}
function VerifyNativeZipBackup($stream,$rows) {
  Add-Type -AssemblyName System.IO.Compression
  $wanted=@{};foreach($row in $rows){$wanted[[string]$row.path]=$row}
  $seen=@{}
  $hash=[Security.Cryptography.SHA256]::Create()
  try {$stream.Position=0;$digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
  finally {$hash.Dispose()}
  $stream.Position=0
  $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read,$true)
  try {
    if($zip.Entries.Count -ne $wanted.Count) {throw 'backup-coverage'}
    foreach($entry in $zip.Entries) {
      $name=[string]$entry.FullName
      $directory=$name.EndsWith('/')
      if($directory){$name=$name.Substring(0,$name.Length-1)}
      if(!$name -or $name.Length -gt 240 -or $name.Contains('\') -or $name.StartsWith('/') -or
         @($name.Split('/') | Where-Object {$_ -in @('.','..','') -or $_ -match '[<>:"\\|?*\x00-\x1f]'}).Count -ne 0) {throw 'backup-name'}
      if($seen.ContainsKey($name) -or !$wanted.ContainsKey($name) -or
         (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {throw 'backup-member'}
      $seen[$name]=$true;$expected=$wanted[$name]
      if($directory -ne ($expected.kind -eq 'directory')) {throw 'backup-kind'}
      if(!$directory) {
        if($entry.Length -ne [long]$expected.size) {throw 'backup-size'}
        $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
        try {$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}
        finally {$stream.Dispose();$sha.Dispose()}
        if($actual -cne [string]$expected.sha256) {throw 'backup-content'}
      }
    }
  } finally {$zip.Dispose()}
  return $digest
}
try {
  $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
  if($request.schemaVersion -eq 1 -and $request.operation -eq 'read-nonregistry') {
    InitializeNativeFiles
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if($sid -cne [string]$request.userSid -or
       [IO.Path]::GetDirectoryName([Environment]::SystemDirectory) -ine [string]$request.systemRoot -or
       $request.paths.Count -gt 512 -or
       $request.dataRoots.Count -gt 32 -or $request.dataRoots.Count -lt 1 -or
       $request.workerImageNames.Count -lt 1 -or $request.workerImageNames.Count -gt 32) {throw 'snapshot-contract'}
    foreach($name in @($request.workerImageNames)) {
      if([string]$name -notmatch '^[A-Za-z0-9_.-]+\.exe$') {throw 'worker-name'}
    }
    $target=RequireNativePath $request.target
    $pathRows=@(foreach($path in @($request.paths)) {
      $name=RequireNativePath $path
      $fact=[RTRepairNativeFiles]::InspectPath($name)
      $row=@{path=$name;kind=$fact[1]}
      if($fact[1] -in @('file','directory')){$row.fileId=$fact[0]}
      if($fact[1] -eq 'file'){$row.sha256=$fact[3];$row.size=[long]::Parse($fact[2])}
      $row
    })
    $dataRows=@(foreach($item in @($request.dataRoots)) {
      $root=RequireNativePath $item.root;$backup=RequireNativePath $item.backup
      if($root -notmatch '^[DK]:\\' -or $backup -notmatch '^[DK]:\\' -or
         $backup.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or
         $backup.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) {throw 'backup-location'}
      $rows=@(ReadNativeTree $root)
      $stable=[RTRepairNativeFiles]::OpenStableRead($backup)
      try {$backupSha=VerifyNativeZipBackup $stable.Stream $rows
        @{root=$root;entries=$rows;backupPath=$backup;backupSha256=$backupSha;backupFileId=$stable.Identity}}
      finally {$stable.Dispose()}
    })
    $workers=0
    foreach($proc in @(Get-CimInstance Win32_Process)) {
      if($proc.ProcessId -eq [int]$request.consumerPid -or $proc.ProcessId -le 4) {continue}
      if($proc.ExecutablePath -and
         ([string]$proc.ExecutablePath).StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) {$workers++;continue}
      if(@($request.workerImageNames) -contains [string]$proc.Name) {
        if(!$proc.ExecutablePath) {throw 'worker-unknown'}
        $workers++
      }
    }
    if($workers -ne 0) {throw 'worker-active'}
    $hasSqlite=@($dataRows | ForEach-Object {$_.entries} | Where-Object {
      $_.kind -eq 'file' -and $_.path -match '(?i)\.(db|sqlite|sqlite3)$'
    }).Count -ne 0
    [Console]::Write((@{paths=$pathRows;data=$dataRows;activeWorkers=0;
      sqliteState=$(if($hasSqlite){'unknown'}else{'closed-consistent'});
      userSid=$sid;observedAtMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json -Depth 20 -Compress));exit 0
  }
  if($request.schemaVersion -eq 1 -and $request.operation -eq 'check-private-journal') {
    InitializeNativeFiles
    $root=RequireNativePath $request.root;$path=RequireNativePath $request.path
    if($root -notmatch '^[DK]:\\' -or
       ($path -cne $root -and (!$path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or
         [IO.Path]::GetDirectoryName($path) -ine $root -or $path -notmatch '\.journal$')) -or
       [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne [string]$request.userSid) {throw 'journal-contract'}
    $rootId=[RTRepairNativeFiles]::CheckPrivatePath($root,[string]$request.userSid)
    $pathId=if($path -cne $root){[RTRepairNativeFiles]::CheckPrivatePath($path,[string]$request.userSid)}else{$rootId}
    [Console]::Write((@{verified=$true;rootFileId=$rootId;pathFileId=$pathId}|ConvertTo-Json -Compress));exit 0
  }
  if($request.schemaVersion -eq 1 -and $request.operation -eq 'verify-program') {
    InitializeNativeFiles
    $root=RequireNativePath $request.target
    if($root -notmatch '^[DK]:\\' -or $request.members.Count -gt 20000) {throw 'program-contract'}
    foreach($member in @($request.members)) {
      $name=[string]$member.path
      if(!$name -or $name -match '[<>:"\\|?*\x00-\x1f]' -or
         @($name.Split('/') | Where-Object {$_ -in @('.','..','')}).Count -ne 0) {throw 'program-member'}
      $path=[IO.Path]::Combine($root,$name.Replace('/','\'))
      $fact=[RTRepairNativeFiles]::InspectPath($path)
      if($fact[1] -ne 'file' -or $fact[3] -cne [string]$member.sha256 -or
         [long]::Parse($fact[2]) -ne [long]$member.size) {throw 'program-mismatch'}
    }
    [Console]::Write('{"verified":true}');exit 0
  }
  if($request.schemaVersion -eq 1 -and $request.operation -eq 'read-registry-all') {
    if($request.installKey -notmatch '^Software\\[^\\\x00-\x1f]+$' -or
       $request.uninstallKey -notmatch '^Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\\x00-\x1f]+$') {throw 'registry-read-contract'}
    $rows=@(foreach($scope in @('per-user','all-users')) {
      $hive=if($scope -eq 'all-users'){[Microsoft.Win32.RegistryHive]::LocalMachine}else{[Microsoft.Win32.RegistryHive]::CurrentUser}
      foreach($view in @('32','64')) {
        $nativeView=if($view -eq '64'){[Microsoft.Win32.RegistryView]::Registry64}else{[Microsoft.Win32.RegistryView]::Registry32}
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$nativeView)
        try {@{scope=$scope;view=$view;install=(ReadKey $base $request.installKey);
          uninstall=(ReadKey $base $request.uninstallKey)}}
        finally {$base.Dispose()}
      }
    })
    [Console]::Write((@{schemaVersion=1;rows=$rows}|ConvertTo-Json -Depth 12 -Compress));exit 0
  }
  if($request.schemaVersion -eq 1 -and $request.operation -eq 'launch-facts') {
    if($request.consumerPid -isnot [int] -or $request.consumerPid -le 0) {throw 'consumer-pid'}
    InitializeNativeFiles
    $process=Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId='+$request.consumerPid)
    if($null -eq $process -or $process.ParentProcessId -le 0) {throw 'consumer-process'}
    $parent=Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId='+$process.ParentProcessId)
    if($null -eq $parent -or !$parent.ExecutablePath -or !$parent.CommandLine) {throw 'parent-process'}
    $nativeParent=[Diagnostics.Process]::GetProcessById($parent.ProcessId)
    try {
      $created=$nativeParent.StartTime.ToUniversalTime().Ticks
      $parentImage=[RTRepairNativeFiles]::Inspect([string]$parent.ExecutablePath)
      $args=[RTRepairNativeFiles]::Arguments([string]$parent.CommandLine)
      $repair=@($args | Where-Object {$_ -ieq '/RTRepair'}).Count -eq 1
      $all=@($args | Where-Object {$_ -ieq '/allusers'}).Count
      $user=@($args | Where-Object {$_ -ieq '/currentuser'}).Count
      if(($all+$user) -ne 1) {throw 'scope-ambiguous'}
      # NSIS /D= is terminal and may contain unquoted spaces. Do not reconstruct
      # it from split argv or accept an alternative directory supplied by child.
      $match=[regex]::Match([string]$parent.CommandLine,'(?i)(?:^|\s)/D=(.*)$')
      if(!$match.Success) {throw 'target-not-explicit'}
      $target=$match.Groups[1].Value
      if($target.StartsWith('"') -and $target.EndsWith('"')) {$target=$target.Substring(1,$target.Length-2)}
      if($target -notmatch '^[DK]:\\Program Files\\RT-ResearchFlow$') {throw 'target-noncanonical'}
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
      $principal=[Security.Principal.WindowsPrincipal]::new($identity)
      $parentAgain=[Diagnostics.Process]::GetProcessById($parent.ProcessId)
      try {if($nativeParent.HasExited -or $parentAgain.StartTime.ToUniversalTime().Ticks -ne $created) {throw 'parent-reused'}} finally {$parentAgain.Dispose()}
      [Console]::Write((@{directParentImageSha256=$parentImage[2];directParentRunning=$true;
        directParentRepairIntent=$repair;selectedScope=$(if($all -eq 1){'all-users'}else{'per-user'});
        selectedTarget=$target;currentUserSid=$identity.User.Value;elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);
        parentProcessId=$parent.ProcessId;parentCreatedTicks=$created.ToString()}|ConvertTo-Json -Compress));exit 0
    } finally {$nativeParent.Dispose()}
  }
  if($request.schemaVersion -eq 1 -and $request.operation -in @('inspect-file','write-file','delete-owned-file')) {
    InitializeNativeFiles
    switch($request.operation) {
      'inspect-file' {$result=[RTRepairNativeFiles]::Inspect([string]$request.target)}
      'write-file' {$result=[RTRepairNativeFiles]::Write([string]$request.target,[string]$request.source,[string]$request.backup,[string]$request.beforeId,[string]$request.beforeSha256,[string]$request.nextSha256,[long]$request.nextSize,[string]$request.userSid)}
      'delete-owned-file' {[RTRepairNativeFiles]::DeleteOwned([string]$request.target,[string]$request.beforeId,[string]$request.beforeSha256);$result=@('absent','0','')}
    }
    [Console]::Write((@{identity=$result[0];size=$result[1];sha256=$result[2]}|ConvertTo-Json -Compress));exit 0
  }
  if($request.schemaVersion -ne 1 -or $request.operation -notin @('read-registry','write-registry') -or
    $request.scope -notin @('per-user','all-users') -or $request.view -notin @('32','64') -or
    $request.installKey -notmatch '^Software\\[^\\\x00-\x1f]+$' -or
    $request.uninstallKey -notmatch '^Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\\x00-\x1f]+$' -or
    $request.selectedKey -notin @('install','uninstall')) {throw 'invalid-contract'}
  $hive=if($request.scope -eq 'all-users'){[Microsoft.Win32.RegistryHive]::LocalMachine}else{[Microsoft.Win32.RegistryHive]::CurrentUser}
  $view=if($request.view -eq '64'){[Microsoft.Win32.RegistryView]::Registry64}else{[Microsoft.Win32.RegistryView]::Registry32}
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
  try {
    $path=if($request.selectedKey -eq 'install'){$request.installKey}else{$request.uninstallKey}
    if($request.operation -eq 'write-registry') {
      $expected=NormalizeImage $request.expected;$next=NormalizeImage $request.next
      ReplaceKey $base $path $expected $next
    }
    [Console]::Write((ReadKey $base $path | ConvertTo-Json -Depth 12 -Compress))
  } finally {$base.Dispose()}
} catch {[Console]::Error.Write('WINDOWS_REPAIR_NATIVE_HOST_FAILED');exit 1}
