using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

// Reviewed internal launcher, not an elevation mechanism or authorization API.
// Node verifies its compiled artifact SHA and receiver capability first. This
// launcher ignores caller-controlled PATH/SystemRoot and owns an unnamed Job.
public static class RTWindowsRepairJobHost {
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
  static int failed;
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
    var security=Directory.GetAccessControl(root,AccessControlSections.Access|AccessControlSections.Owner);
    var user=WindowsIdentity.GetCurrent().User.Value;
    var owner=((SecurityIdentifier)security.GetOwner(typeof(SecurityIdentifier))).Value;
    if(owner!=user && owner!="S-1-5-32-544")throw new IOException("cache-owner");
    foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
      var sid=((SecurityIdentifier)rule.IdentityReference).Value;
      if(rule.AccessControlType==AccessControlType.Allow && sid!=user && sid!="S-1-5-18" && sid!="S-1-5-32-544")throw new IOException("cache-acl");
    }
  }
  static void Drain(Stream input,Stream output,int cap) {
    var buffer=new byte[4096];int total=0,count;
    try{while((count=input.Read(buffer,0,buffer.Length))>0){total+=count;if(total>cap){Interlocked.Exchange(ref failed,1);return;}if(output!=null){output.Write(buffer,0,count);output.Flush();}}}
    catch{Interlocked.Exchange(ref failed,1);}
  }
  public static int Main(string[] args) {
    IntPtr job=IntPtr.Zero;Process process=null;
    try {
      if(args.Length!=3 || args[0].Length>12000 || args[0].Length==0 || args[0].IndexOfAny(new char[]{' ','\t','\r','\n','"'})>=0)throw new IOException("arguments");
      Convert.FromBase64String(args[0]);int deadline;if(!int.TryParse(args[2],out deadline)||deadline<100||deadline>300000)throw new IOException("deadline");
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
      // Closing first kills any still-live descendant before waiting for pipe
      // EOF. A successful root exit does not prove all descendants exited.
      CloseHandle(job);job=IntPtr.Zero;
      if(!Task.WaitAll(new Task[]{output,error},5000)||Interlocked.CompareExchange(ref failed,0,0)!=0)throw new IOException("pipe-failed");
      return code;
    }catch{Console.Error.Write("WINDOWS_REPAIR_JOB_HOST_FAILED");return 124;}
    finally{if(job!=IntPtr.Zero)CloseHandle(job);if(process!=null){try{if(!process.HasExited)process.WaitForExit(5000);}catch{}process.Dispose();}}
  }
}
