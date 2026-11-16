param([ValidateSet('Inspect','Apply','Restore','ScanGpu','StopExplorer','RestoreExplorer','Library')][string]$Action='Inspect', [string]$RequestFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$OutputEncoding=[Console]::OutputEncoding
$resourceApps=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resource-apps.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$resourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../runtime/strata-launcher/resource-optimization'))
$resourceJournal=Join-Path $resourceRoot 'visual-session.json'
. (Join-Path $PSScriptRoot 'GpuMemory.ps1')
. (Join-Path $PSScriptRoot 'DesktopShell.ps1')

function Initialize-VisualApi {
    if ('StrataVisualSettings' -as [type]) { return }
    Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class StrataVisualSettings {
  [StructLayout(LayoutKind.Sequential)] struct AnimationInfo { public uint size; public int enabled; }
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", SetLastError=true)]
  static extern bool ReadBool(uint action, uint param, ref int value, uint flags);
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", SetLastError=true)]
  static extern bool WriteBool(uint action, uint param, IntPtr value, uint flags);
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", SetLastError=true)]
  static extern bool Animation(uint action, uint param, ref AnimationInfo value, uint flags);
  static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static bool Get(uint action) {
    if(action==0x48) { var a=new AnimationInfo {size=8}; Check(Animation(action,8,ref a,0)); return a.enabled!=0; }
    int value=0; Check(ReadBool(action,0,ref value,0)); return value!=0;
  }
  public static void Set(uint action, bool enabled) {
    // Session settings only: SPIF_SENDCHANGE, without SPIF_UPDATEINIFILE.
    if(action==0x49) { var a=new AnimationInfo {size=8,enabled=enabled?1:0}; Check(Animation(action,8,ref a,2)); }
    else Check(WriteBool(action,0,new IntPtr(enabled?1:0),2));
  }
}
'@
}
function Get-VisualSettings {
    Initialize-VisualApi
    return @{windowAnimation=[StrataVisualSettings]::Get(0x48);clientAnimation=[StrataVisualSettings]::Get(0x1042);menuAnimation=[StrataVisualSettings]::Get(0x1002)}
}
function Set-VisualSetting([string]$Key,[bool]$Value) {
    Initialize-VisualApi
    $actions=@{windowAnimation=0x49;clientAnimation=0x1043;menuAnimation=0x1003}
    if (-not $actions.ContainsKey($Key)) { throw 'Unknown visual setting' }
    [StrataVisualSettings]::Set($actions[$Key],$Value)
}
function Save-ResourceJson([string]$File,$Value) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($File)) | Out-Null
    $temp=$File+'.'+[guid]::NewGuid().ToString()+'.tmp'
    try {
        [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
        if ([IO.File]::Exists($File)) { [IO.File]::Replace($temp,$File,[NullString]::Value) } else { [IO.File]::Move($temp,$File) }
    } finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
}
function Get-ResourceIdentity {
    return @{sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;session=(Get-Process -Id $PID).SessionId}
}
function Get-EligibleApps([bool]$IncludeBackground=$false) {
    $identity=Get-ResourceIdentity
    $result=@()
    foreach ($app in $resourceApps) {
        foreach ($p in @(Get-Process -Name $app.process -ErrorAction SilentlyContinue)) {
            try {
                if ($p.SessionId -ne $identity.session -or (-not $IncludeBackground -and $p.MainWindowHandle -eq [IntPtr]::Zero)) { continue }
                $native=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
                $owner=Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid
                if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.sid) { continue }
                $result+=@{app=$app.id;pid=$p.Id;started=$p.StartTime.ToUniversalTime().Ticks.ToString();path=$p.Path}
            } catch { continue }
        }
    }
    return $result
}
function Get-VerifiedAppProcess($Target) {
    $p=Get-Process -Id $Target.pid -ErrorAction Stop
    # Hold the process handle across verification and termination, not just its reusable PID.
    $null=$p.Handle
    $identity=Get-ResourceIdentity
    $app=$resourceApps | Where-Object { $_.id -eq $Target.app } | Select-Object -First 1
    if (-not $app) { throw 'Application is not allowlisted' }
    if ($p.SessionId -ne $identity.session -or $p.ProcessName -ne $app.process -or $p.Path -ne $Target.path -or $p.StartTime.ToUniversalTime().Ticks.ToString() -ne $Target.started) { throw 'Application identity changed before close' }
    $native=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
    $owner=Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.sid) { throw 'Application belongs to another user' }
    return $p
}
function Request-AppClose($Target) {
    return (Get-VerifiedAppProcess $Target).CloseMainWindow()
}
function Stop-SelectedApp($Target) {
    $p=Get-VerifiedAppProcess $Target
    $p.Kill()
    if (-not $p.WaitForExit(3000)) { throw 'Selected process did not exit' }
    return $true
}
function Read-VisualJournal {
    if (-not (Test-Path -LiteralPath $resourceJournal)) { return $null }
    $j=Get-Content -LiteralPath $resourceJournal -Raw -Encoding UTF8 | ConvertFrom-Json
    $identity=Get-ResourceIdentity
    if ($j.version -ne 1 -or $j.sid -ne $identity.sid -or $j.session -ne $identity.session) { throw 'Visual recovery record belongs to another user/session; do not overwrite it.' }
    return $j
}
function Assert-ResourceRequest($r) {
    $guid=[guid]::Empty
    if (-not [guid]::TryParse([string]$r.owner,[ref]$guid)) { throw 'Invalid optimization owner' }
    foreach ($key in @('reduceVisuals','confirmedApps','manualRestore','forceApps','confirmedForce','confirmedExplorer')) {
        if ($null -ne $r.$key -and $r.$key -isnot [bool]) { throw ('Expected boolean: '+$key) }
    }
    foreach ($id in @($r.apps)) { if ($id -notin @($resourceApps.id)) { throw 'Application is not allowlisted' } }
    foreach ($target in @($r.targets)) {
        if ($target.app -notin @($r.apps) -or $target.pid -isnot [int] -or $target.pid -le 0 -or -not $target.path -or -not $target.started) { throw 'Invalid selected application identity' }
    }
    if (@($r.targets).Count -and -not $r.confirmedApps) { throw 'Application close confirmation required' }
    if ($r.forceApps -and -not $r.confirmedForce) { throw 'Forced close confirmation required' }
}
function Invoke-ResourceAction([string]$Operation,$r) {
    if ($Operation -eq 'Inspect') {
        $journal=Read-VisualJournal
        return @{visuals=(Get-VisualSettings);targets=@(Get-EligibleApps);backgroundTargets=@(Get-EligibleApps $true);explorerTarget=(Get-DesktopShellTarget);desktopRecoveryAvailable=[bool](Read-DesktopJournal);recoveryAvailable=[bool]$journal;recoveryOwner=$journal.owner}
    }
    if ($Operation -eq 'ScanGpu') { return Get-GpuMemorySnapshot }
    Assert-ResourceRequest $r
    [IO.Directory]::CreateDirectory($resourceRoot) | Out-Null
    $lock=$null
    try {
        try { $lock=[IO.File]::Open((Join-Path $resourceRoot 'operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
        catch { throw 'Another panel is optimizing resources; no action was taken.' }
        if ($Operation -in @('StopExplorer','RestoreExplorer')) { return Invoke-DesktopAction $Operation $r }
        $journal=Read-VisualJournal
        if ($Operation -eq 'Restore') {
            if (-not $journal) { return @{restored=$false;reason='No saved visual settings'} }
            if (-not $r.manualRestore -and $journal.owner -ne $r.owner) { return @{restored=$false;reason='Another panel owns the visual settings'} }
            $current=Get-VisualSettings
            $restored=@(); $skipped=@()
            foreach ($property in $journal.original.PSObject.Properties) {
                if ($current[$property.Name] -eq $false) { Set-VisualSetting $property.Name ([bool]$property.Value); $restored+=$property.Name }
                else { $skipped+=$property.Name }
            }
            Save-ResourceJson (Join-Path $resourceRoot 'visual-last.json') @{journal=$journal;restored=$restored;skipped=$skipped;time=[DateTime]::UtcNow.ToString('o')}
            [IO.File]::Delete($resourceJournal)
            return @{restored=$true;settings=$restored;skipped=$skipped}
        }
        if ($Operation -ne 'Apply') { throw 'Unknown resource operation' }
        # A foreign visual journal must remain untouched, but must not block independent app closes.
        $visualsSkipped=[bool]($r.reduceVisuals -and $journal -and $journal.owner -ne $r.owner)
        # Validate every PID/start-time/path again after confirmation, before changing anything.
        $eligible=@(Get-EligibleApps ([bool]$r.forceApps))
        foreach ($target in @($r.targets)) {
            if (-not @($eligible | Where-Object { $_.pid -eq $target.pid -and $_.app -eq $target.app -and $_.started -eq $target.started -and $_.path -eq $target.path }).Count) { throw 'Selected application changed or exited; refresh and confirm again.' }
        }
        if ($r.reduceVisuals -and -not $journal) {
            $identity=Get-ResourceIdentity; $visuals=Get-VisualSettings; $original=@{}
            foreach ($key in $visuals.Keys) { if ($visuals[$key]) { $original[$key]=[bool]$visuals[$key] } }
            $journal=@{version=1;owner=$r.owner;sid=$identity.sid;session=$identity.session;original=$original;created=[DateTime]::UtcNow.ToString('o')}
            Save-ResourceJson $resourceJournal $journal
            foreach ($key in $original.Keys) { Set-VisualSetting $key $false }
        }
        $closes=@()
        foreach ($target in @($r.targets)) {
            try {
                # A close request is not evidence of exit; applications may ask the user or keep background processes.
                $ok=if ($r.forceApps) { Stop-SelectedApp $target } else { Request-AppClose $target }
                $closes+=@{app=$target.app;pid=$target.pid;requested=[bool]$ok;forced=[bool]$r.forceApps}
            } catch {
                $code=$null; $exception=$_.Exception
                while ($exception) {
                    if ($exception -is [ComponentModel.Win32Exception]) { $code=$exception.NativeErrorCode; break }
                    $exception=$exception.InnerException
                }
                $closes+=@{app=$target.app;pid=$target.pid;requested=$false;forced=[bool]$r.forceApps;error=$_.Exception.Message;nativeErrorCode=$code}
            }
        }
        $newProcesses=@()
        if ($r.forceApps -and @($closes | Where-Object { $_.requested }).Count) {
            Start-Sleep -Milliseconds 300
            $newProcesses=@(Get-EligibleApps $true | Where-Object {
                $candidate=$_
                $candidate.app -in @($r.apps) -and -not @($eligible | Where-Object { $_.pid -eq $candidate.pid -and $_.started -eq $candidate.started }).Count
            })
        }
        $visualsOwned=[bool]($journal -and $journal.owner -eq $r.owner)
        $receipt=@{applied=$true;visualsReduced=[bool]($r.reduceVisuals -and -not $visualsSkipped);visualsSkipped=$visualsSkipped;visualsOwned=$visualsOwned;closeRequests=$closes;newProcesses=$newProcesses;time=[DateTime]::UtcNow.ToString('o')}
        Save-ResourceJson (Join-Path $resourceRoot 'last-apply.json') $receipt
        return $receipt
    } finally { if ($lock) { $lock.Dispose() } }
}
if ($Action -ne 'Library') {
    $request=if ($RequestFile) { Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    Invoke-ResourceAction $Action $request | ConvertTo-Json -Depth 12 -Compress
}
