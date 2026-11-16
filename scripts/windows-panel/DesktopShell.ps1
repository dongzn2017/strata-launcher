function Get-DesktopShellPid {
    if (-not ('StrataDesktopShell' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StrataDesktopShell {
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static uint Pid() { uint p=0; var h=GetShellWindow(); if(h!=IntPtr.Zero) GetWindowThreadProcessId(h,out p); return p; }
}
'@
    }
    return [int][StrataDesktopShell]::Pid()
}
function Get-DesktopShellTarget {
    $processId=Get-DesktopShellPid
    if (-not $processId) { return $null }
    $p=Get-Process -Id $processId -ErrorAction Stop
    $identity=Get-ResourceIdentity
    $expected=Join-Path $env:WINDIR 'explorer.exe'
    if ($p.ProcessName -ne 'explorer' -or $p.SessionId -ne $identity.session -or $p.Path -ne $expected) { throw 'Desktop shell identity/path/session mismatch' }
    $native=Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
    $owner=Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.sid) { throw 'Desktop shell belongs to another user' }
    return @{pid=$p.Id;path=$p.Path;started=$p.StartTime.ToUniversalTime().Ticks.ToString()}
}
function Stop-DesktopShellTarget($Target) {
    $current=Get-DesktopShellTarget
    if (-not $current -or $current.pid -ne $Target.pid -or $current.path -ne $Target.path -or $current.started -ne $Target.started) { throw 'Desktop shell changed; refresh and confirm again' }
    # Kill only the shell HWND's verified process, never all explorer.exe processes.
    $p=Get-Process -Id $current.pid -ErrorAction Stop
    $null=$p.Handle
    if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne $Target.started) { throw 'Desktop shell PID was reused' }
    $p.Kill()
    if (-not $p.WaitForExit(5000)) { throw 'Desktop shell did not exit' }
}
function Read-DesktopJournal {
    $file=Join-Path $resourceRoot 'desktop-session.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    $j=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    $identity=Get-ResourceIdentity
    if ($j.version -ne 1 -or $j.sid -ne $identity.sid -or $j.session -ne $identity.session) { throw 'Desktop recovery record belongs to another user/session' }
    return $j
}
function Start-DesktopShellProcess {
    # This explicit user action restores visible desktop UI; no argument or path comes from a request.
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -WorkingDirectory $env:WINDIR -WindowStyle Normal | Out-Null
}
function Invoke-DesktopAction([string]$Operation,$r) {
    $file=Join-Path $resourceRoot 'desktop-session.json'
    $journal=Read-DesktopJournal
    $current=Get-DesktopShellTarget
    if ($Operation -eq 'StopExplorer') {
        if ($r.confirmedExplorer -ne $true) { throw 'Explorer confirmation required' }
        if (-not $current) { return @{stopped=$false;reason='Desktop shell is already absent'} }
        $target=$r.explorerTarget
        if (-not $target -or $target.pid -ne $current.pid -or $target.started -ne $current.started -or $target.path -ne $current.path) { throw 'Desktop shell changed; refresh and confirm again' }
        if ($journal -and $journal.owner -ne $r.owner) { throw 'Another panel owns desktop recovery' }
        $identity=Get-ResourceIdentity
        Save-ResourceJson $file @{version=1;owner=$r.owner;sid=$identity.sid;session=$identity.session;target=$current;created=[DateTime]::UtcNow.ToString('o')}
        Stop-DesktopShellTarget $current
        $runningAgain=[bool](Get-DesktopShellTarget)
        return @{stopped=$true;runningAgain=$runningAgain;pid=$current.pid}
    }
    if ($journal -and -not $r.manualRestore -and $journal.owner -ne $r.owner) { return @{restored=$false;reason='Another panel owns desktop recovery'} }
    if (-not $journal -and -not $r.manualRestore) { return @{restored=$false;reason='No owned desktop recovery record'} }
    if (-not $current) {
        Start-DesktopShellProcess
        $deadline=[DateTime]::UtcNow.AddSeconds(8)
        do { Start-Sleep -Milliseconds 200; $current=Get-DesktopShellTarget } while (-not $current -and [DateTime]::UtcNow -lt $deadline)
        if (-not $current) { throw 'Explorer launch requested but desktop shell not confirmed; recovery record retained' }
    }
    if ($journal) {
        Save-ResourceJson (Join-Path $resourceRoot 'desktop-last.json') @{journal=$journal;restored=$true;time=[DateTime]::UtcNow.ToString('o')}
        [IO.File]::Delete($file)
    }
    return @{restored=$true;pid=$current.pid}
}
