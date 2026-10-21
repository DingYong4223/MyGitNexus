$ErrorActionPreference = 'Stop'
$target = $env:MYGITNEXUS_HOOK_RM_TARGET
if ([string]::IsNullOrWhiteSpace($target)) { Write-Output '[]'; exit 0 }
$target = (Resolve-Path -LiteralPath $target).ProviderPath

if (-not ([Management.Automation.PSTypeName]'MyGitNexusHookRm.Native').Type) {
Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace MyGitNexusHookRm {
  public static class Native {
    public const int ErrorMoreData = 234;
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct RM_UNIQUE_PROCESS {
      public int dwProcessId;
      public long ProcessStartTime;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO {
      public RM_UNIQUE_PROCESS Process;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
      public string strAppName;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
      public string strServiceShortName;
      public uint ApplicationType;
      public uint AppStatus;
      public uint TSSessionId;
      public uint bRestartable;
    }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmStartSession(out uint pSessionHandle, uint dwSessionFlags, string strSessionKey);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFileNames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);
    [DllImport("rstrtmgr.dll")]
    public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
    [DllImport("rstrtmgr.dll")]
    public static extern int RmEndSession(uint pSessionHandle);
  }
}
'@
}

$h = [uint32]0
$key = [guid]::NewGuid().ToString('N')
$rmErr = [MyGitNexusHookRm.Native]::RmStartSession([ref]$h, 0, $key)
if ($rmErr -ne 0) { Write-Output '[]'; exit 0 }
$files = @($target)
$err = [MyGitNexusHookRm.Native]::RmRegisterResources($h, 1, $files, 0, [IntPtr]::Zero, 0, $null)
if ($err -ne 0) {
  [void][MyGitNexusHookRm.Native]::RmEndSession($h)
  Write-Output '[]'
  exit 0
}
$need = [uint32]0
$n = [uint32]0
$reboot = [uint32]0
$err = [MyGitNexusHookRm.Native]::RmGetList($h, [ref]$need, [ref]$n, $null, [ref]$reboot)
if ($err -ne [MyGitNexusHookRm.Native]::ErrorMoreData) {
  [void][MyGitNexusHookRm.Native]::RmEndSession($h)
  Write-Output '[]'
  exit 0
}
$n = $need
$buf = New-Object MyGitNexusHookRm.Native+RM_PROCESS_INFO[] ([int]$n)
$err = [MyGitNexusHookRm.Native]::RmGetList($h, [ref]$need, [ref]$n, $buf, [ref]$reboot)
[void][MyGitNexusHookRm.Native]::RmEndSession($h)
if ($err -ne 0) { Write-Output '[]'; exit 0 }

$out = @()
for ($i = 0; $i -lt [int]$n; $i++) {
  $procId = $buf[$i].Process.dwProcessId
  $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
  $cmd = if ($p) { $p.CommandLine } else { '' }
  $out += [PSCustomObject]@{ pid = [int]$procId; cmd = $cmd }
}
ConvertTo-Json -InputObject @($out) -Compress
