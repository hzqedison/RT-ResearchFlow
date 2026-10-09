using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

// Isolated build supervisor, not a privileged installer or release approval.
// The source is checked against independently verified Git bytes before compilation.
// The fixed stdin-gated loader cannot start Python before assignment to this Job.
public static class RTPrivateRuntimeOwnedJobHost {
  [StructLayout(LayoutKind.Sequential)] struct BASIC {
    public long PerProcessTime, PerJobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct COUNTERS { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED {
    public BASIC Basic; public COUNTERS Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref EXTENDED value,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern uint GetWindowsDirectoryW(StringBuilder path,uint size);
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
    public long TotalUser, TotalKernel, PeriodUser, PeriodKernel;
    public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,out ACCOUNTING value,uint size,IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  static int failed, stderrBytes;
  static bool EmptyJob(IntPtr job) {
    ACCOUNTING value;
    if(!QueryInformationJobObject(job,1,out value,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero))throw new IOException("query-job");
    return value.ActiveProcesses==0;
  }
  static byte[] ReadInput() {
    using(var output=new MemoryStream()) {
      var input=Console.OpenStandardInput();var buffer=new byte[8192];int count;
      while((count=input.Read(buffer,0,buffer.Length))>0){if(output.Length+count>4*1024*1024)throw new IOException("input-cap");output.Write(buffer,0,count);}
      return output.ToArray();
    }
  }
  static void PrivateCache(string root) {
    if(!Path.IsPathRooted(root) || !(root.StartsWith("D:\\",StringComparison.OrdinalIgnoreCase)||root.StartsWith("K:\\",StringComparison.OrdinalIgnoreCase)) ||
      !String.Equals(Path.GetFullPath(root),root,StringComparison.OrdinalIgnoreCase))throw new IOException("cache-root");
    for(string p=root;p!=null;p=Path.GetDirectoryName(p)) {
      var attributes=File.GetAttributes(p);if((attributes&FileAttributes.Directory)==0 || (attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("cache-reparse");
    }
    if(Directory.GetFileSystemEntries(root).Length!=0)throw new IOException("cache-not-empty");
    var security=Directory.GetAccessControl(root,AccessControlSections.Access|AccessControlSections.Owner);
    var user=WindowsIdentity.GetCurrent().User.Value;
    var owner=((SecurityIdentifier)security.GetOwner(typeof(SecurityIdentifier))).Value;
    if(owner!=user)throw new IOException("cache-owner");
    security.SetAccessRuleProtection(true,false);
    foreach(FileSystemAccessRule old in security.GetAccessRules(true,false,typeof(SecurityIdentifier)))security.RemoveAccessRuleSpecific(old);
    foreach(string sid in new string[]{user,"S-1-5-18","S-1-5-32-544"})security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    Directory.SetAccessControl(root,security);
    security=Directory.GetAccessControl(root,AccessControlSections.Access|AccessControlSections.Owner);
    foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
      var sid=((SecurityIdentifier)rule.IdentityReference).Value;
      if(rule.AccessControlType==AccessControlType.Allow && sid!=user && sid!="S-1-5-18" && sid!="S-1-5-32-544")throw new IOException("cache-acl");
    }
  }
  static void Drain(Stream input,Stream output,int cap) {
    var buffer=new byte[4096];int total=0,count;
    try{while((count=input.Read(buffer,0,buffer.Length))>0){total+=count;if(total>cap){Interlocked.Exchange(ref failed,1);return;}if(output!=null){output.Write(buffer,0,count);output.Flush();}else{Interlocked.Add(ref stderrBytes,count);}}}
    catch{Interlocked.Exchange(ref failed,1);}
  }
  public static int Main(string[] args) {
    IntPtr job=IntPtr.Zero;Process process=null;
    try {
      if(args.Length!=4 || args[0].Length>12000 || args[0].Length==0 || args[0].IndexOfAny(new char[]{' ','\t','\r','\n','"'})>=0)throw new IOException("arguments");
      Convert.FromBase64String(args[0]);int deadline;if(!int.TryParse(args[2],out deadline)||deadline<100||deadline>300000)throw new IOException("deadline");
      if(args[3].Length!=64 || args[3].Trim("0123456789abcdef".ToCharArray()).Length!=0)throw new IOException("nonce");
      PrivateCache(args[1]);byte[] input=ReadInput();
      var windows=new StringBuilder(32768);uint length=GetWindowsDirectoryW(windows,(uint)windows.Capacity);if(length==0||length>=windows.Capacity)throw new IOException("windows-directory");
      string systemRoot=windows.ToString();
      job=CreateJobObjectW(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new IOException("create-job");
      var limits=new EXTENDED();limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE; handle is NOT inherited.
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED))))throw new IOException("job-limits");
      var start=new ProcessStartInfo(Path.Combine(systemRoot,"System32\\WindowsPowerShell\\v1.0\\powershell.exe"));
      start.Arguments="-NoLogo -NoProfile -NonInteractive -EncodedCommand "+args[0];
      start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
      start.WorkingDirectory=args[1];start.EnvironmentVariables.Clear();
      start.EnvironmentVariables["SystemRoot"]=systemRoot;start.EnvironmentVariables["WINDIR"]=systemRoot;
      start.EnvironmentVariables["TEMP"]=args[1];start.EnvironmentVariables["TMP"]=args[1];
      process=new Process();process.StartInfo=start;process.Start();
      // The encoded loader must wait for stdin EOF before compiling/launching
      // any third-party work. Supply no payload until assignment has succeeded.
      if(!AssignProcessToJobObject(job,process.Handle)) {process.Kill();throw new IOException("assign-job");}
      var output=Task.Factory.StartNew(()=>Drain(process.StandardOutput.BaseStream,Console.OpenStandardOutput(),1024*1024));
      var error=Task.Factory.StartNew(()=>Drain(process.StandardError.BaseStream,null,8192));
      process.StandardInput.BaseStream.Write(input,0,input.Length);process.StandardInput.BaseStream.Flush();process.StandardInput.Close();
      var clock=Stopwatch.StartNew();
      while(!process.WaitForExit(10)){if(Interlocked.CompareExchange(ref failed,0,0)!=0 || clock.ElapsedMilliseconds>=deadline)throw new IOException("child-failed");}
      int code=process.ExitCode;
      // Root exit alone is insufficient. Query the live owned Job, retaining
      // its handle until the kernel has observed every member exit.
      var emptyClock=Stopwatch.StartNew();
      while(!EmptyJob(job) && emptyClock.ElapsedMilliseconds<1000)Thread.Sleep(10);
      if(!EmptyJob(job)){TerminateJobObject(job,124);throw new IOException("leftover-descendant");}
      if(!Task.WaitAll(new Task[]{output,error},5000))throw new IOException("pipe-drain");
      if(Interlocked.CompareExchange(ref failed,0,0)!=0)throw new IOException("pipe-io");
      if(stderrBytes!=0)throw new IOException("child-stderr");
      CloseHandle(job);job=IntPtr.Zero;
      if(code!=0)return code;
      // Child stderr is never forwarded. Only this verified native host may
      // emit the nonce-bound kernel observation, after all checks pass.
      Console.Error.Write("RT_PRIVATE_JOB_EMPTY:"+args[3]+":"+process.Id+":0");
      return 0;
    }catch(Exception error){
      // Only internally fixed codes are returned. Never print native exception
      // text containing a local path, script, environment or credential.
      string known="|arguments|deadline|nonce|cache-root|cache-reparse|cache-not-empty|cache-owner|cache-acl|input-cap|windows-directory|create-job|job-limits|assign-job|child-failed|query-job|leftover-descendant|pipe-drain|pipe-io|child-stderr|";
      string code=known.IndexOf("|"+error.Message+"|",StringComparison.Ordinal)>=0?error.Message:"native-operation";
      Console.Error.Write("RT_PRIVATE_RUNTIME_JOB_HOST_FAILED:"+code);return 124;
    }
    finally{if(job!=IntPtr.Zero)CloseHandle(job);if(process!=null){try{if(!process.HasExited)process.WaitForExit(5000);}catch{}process.Dispose();}}
  }
}
