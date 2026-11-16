$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ResourceOptimization.ps1') -Action Library
$nativeDesktopTarget=${function:Get-DesktopShellTarget}
$nativeDesktopStop=${function:Stop-DesktopShellTarget}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('strata-resource-test-'+[guid]::NewGuid().ToString())
$resourceRoot=$temp; $resourceJournal=Join-Path $temp 'visual-session.json'
$script:shell=@{pid=321;path='C:\Windows\explorer.exe';started='111'}
$script:stops=0; $script:starts=0
function Get-ResourceIdentity { return @{sid='fixture';session=8} }
function Get-DesktopShellTarget { return $script:shell }
function Stop-DesktopShellTarget($Target) { $script:stops++; $script:shell=$null }
function Start-DesktopShellProcess { $script:starts++; $script:shell=@{pid=654;path='C:\Windows\explorer.exe';started='222'} }
function Get-NvidiaMemorySnapshot { return @{available=$true;cards=@(@{index='0';name='Fixture GPU';totalMiB='12227';usedMiB='700';freeMiB='11527'})} }
$owner=[guid]::NewGuid().ToString()
function Request-Fixture { return @{owner=$owner;apps=@();targets=@();confirmedExplorer=$true;explorerTarget=$script:shell;manualRestore=$false} }
function Must-Reject($Operation,$Request,$Pattern) {
    try { $null=Invoke-ResourceAction $Operation $Request; throw 'Unexpected acceptance' }
    catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
try {
    $r=Request-Fixture; $r.confirmedExplorer=$false
    Must-Reject StopExplorer $r 'confirmation required'
    $r=Request-Fixture; $r.explorerTarget=@{pid=321;path='C:\Windows\explorer.exe';started='999'}
    Must-Reject StopExplorer $r 'changed'
    if ($script:stops -or $script:starts -or (Test-Path -LiteralPath (Join-Path $temp 'desktop-session.json'))) { throw 'Rejected action changed state' }
    $r=Request-Fixture
    $result=Invoke-ResourceAction StopExplorer $r
    if (-not $result.stopped -or $script:stops -ne 1 -or -not (Test-Path -LiteralPath (Join-Path $temp 'desktop-session.json'))) { throw 'Missing recovery before shell stop' }
    $other=Request-Fixture; $other.owner=[guid]::NewGuid().ToString()
    $result=Invoke-ResourceAction RestoreExplorer $other
    if ($result.restored -or $script:starts) { throw 'Foreign panel restored shell' }
    $result=Invoke-ResourceAction RestoreExplorer $r
    if (-not $result.restored -or $script:starts -ne 1 -or (Test-Path -LiteralPath (Join-Path $temp 'desktop-session.json'))) { throw 'Owned recovery failed' }
    $other.manualRestore=$true
    $null=Invoke-ResourceAction RestoreExplorer $other
    if ($script:starts -ne 1) { throw 'Duplicate Explorer was launched' }
    $script:shell=$null
    $null=Invoke-ResourceAction RestoreExplorer $other
    if ($script:starts -ne 2) { throw 'Manual recovery without journal failed' }
    $rows=@(
        [pscustomobject]@{Name='pid_123_luid_0x00000000_0x00001234_phys_0';DedicatedUsage=20MB},
        [pscustomobject]@{Name='pid_123_luid_0x00000000_0x00001234_phys_0#1';DedicatedUsage=20MB},
        [pscustomobject]@{Name='pid_123_luid_0x00000000_0x00005678_phys_1';DedicatedUsage=40MB},
        [pscustomobject]@{Name='pid_124_luid_0x00000000_0x00001234_phys_0';DedicatedUsage=5MB},
        [pscustomobject]@{Name='_Total';DedicatedUsage=1000MB}
    )
    $converted=@(Convert-GpuMemoryCounters $rows)
    if ($converted.Count -ne 2 -or $converted[0].bytes -ne 40MB -or $converted[1].bytes -ne 20MB -or $converted[0].adapter -eq $converted[1].adapter) { throw 'Counters duplicated/merged across adapters' }
    function Get-GpuMemoryCounters { throw 'Simulated missing provider' }
    $result=Invoke-ResourceAction ScanGpu $null
    if ($result.counterAvailable -or $result.warnings.Count -ne 1 -or -not $result.nvidia.available -or $script:stops -ne 1) { throw 'Unavailable counters were hidden or scan changed desktop' }
    $script:shell=@{pid=321;path='C:\Windows\explorer.exe';started='111'}
    $r=Request-Fixture
    function Stop-DesktopShellTarget($Target) { throw 'Simulated access denied' }
    Must-Reject StopExplorer $r 'access denied'
    if (-not (Test-Path -LiteralPath (Join-Path $temp 'desktop-session.json'))) { throw 'Stop failure lost recovery record' }
    $null=Invoke-ResourceAction RestoreExplorer $r
    $script:fakeOwner='fixture'
    $script:fakeProcess=[pscustomobject]@{Id=321;ProcessName='explorer';SessionId=8;Path=(Join-Path $env:WINDIR 'explorer.exe');StartTime=([DateTime]::new(111,[DateTimeKind]::Utc))}
    $script:fakeKilled=0
    $script:fakeProcess | Add-Member ScriptMethod Kill { $script:fakeKilled++ }
    $script:fakeProcess | Add-Member ScriptMethod WaitForExit { param($timeout); return $true }
    function Get-DesktopShellPid { return 321 }
    function Get-Process { param($Id); return $script:fakeProcess }
    function Get-CimInstance { param($ClassName,$Filter); return @{ProcessId=321} }
    function Invoke-CimMethod { param($InputObject,$MethodName); return @{ReturnValue=0;Sid=$script:fakeOwner} }
    $target=& $nativeDesktopTarget
    if ($target.pid -ne 321) { throw 'Native shell HWND identity not used' }
    $script:fakeOwner='foreign'
    try { & $nativeDesktopTarget; throw 'Foreign shell accepted' } catch { if ($_.Exception.Message -notmatch 'another user') { throw } }
    $script:fakeOwner='fixture'; $script:fakeProcess.Path='C:\Other\explorer.exe'
    try { & $nativeDesktopTarget; throw 'Wrong shell path accepted' } catch { if ($_.Exception.Message -notmatch 'mismatch') { throw } }
    $script:fakeProcess.Path=Join-Path $env:WINDIR 'explorer.exe'
    $script:shell=$target
    $null=& $nativeDesktopStop $target
    if ($script:fakeKilled -ne 1) { throw 'Verified shell was not targeted' }
    $script:fakeProcess.StartTime=$script:fakeProcess.StartTime.AddSeconds(1)
    try { & $nativeDesktopStop $target; throw 'Reused desktop PID accepted' } catch { if ($_.Exception.Message -notmatch 'reused') { throw } }
    if ($script:fakeKilled -ne 1) { throw 'Unverified shell was killed' }
    Write-Output 'RESOURCE_GPU_DESKTOP_TEST_OK (mocked shell and GPU provider; no real desktop stop)'
} finally {
    $resolved=[IO.Path]::GetFullPath($temp)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'strata-resource-test-*') { throw 'Unsafe test cleanup' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
