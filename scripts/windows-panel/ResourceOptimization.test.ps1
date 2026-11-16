$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ResourceOptimization.ps1') -Action Library
$nativeClose=${function:Request-AppClose}
$nativeEligible=${function:Get-EligibleApps}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('strata-resource-test-'+[guid]::NewGuid().ToString())
$resourceRoot=$temp; $resourceJournal=Join-Path $temp 'visual-session.json'
$script:fakeVisuals=@{windowAnimation=$true;clientAnimation=$true;menuAnimation=$true}
$script:setCalls=@(); $script:closeCalls=@()
$script:eligible=@(@{app='chrome';pid=987;path='C:\Fixture\chrome.exe';started='12345'})
function Get-VisualSettings { return $script:fakeVisuals.Clone() }
function Set-VisualSetting([string]$Key,[bool]$Value) {
    $script:setCalls+=($Key+':'+$Value)
    if ($script:failOnSet -and $script:setCalls.Count -eq $script:failOnSet) { throw 'Simulated visual API failure' }
    $script:fakeVisuals[$Key]=$Value
}
function Get-ResourceIdentity { return @{sid='fixture-user';session=99} }
function Get-DesktopShellTarget { return $null }
function Get-EligibleApps { return $script:eligible }
function Request-AppClose($Target) { $script:closeCalls+=$Target.pid; return $true }
$owner=[guid]::NewGuid().ToString()
function Request-Fixture { return @{owner=$owner;apps=@('chrome');targets=$script:eligible;confirmedApps=$true;reduceVisuals=$true;manualRestore=$false} }
function Must-Reject($Operation,$Request,[string]$Pattern) {
    try { Invoke-ResourceAction $Operation $Request; throw 'Operation unexpectedly accepted' }
    catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
try {
    $inspection=Invoke-ResourceAction 'Inspect' $null
    if ($inspection.targets.Count -ne 1 -or $script:setCalls.Count -or $script:closeCalls.Count) { throw 'Inspect mutated state' }
    $request=Request-Fixture; $request.confirmedApps=$false
    Must-Reject 'Apply' $request 'confirmation required'
    $request=Request-Fixture; $request.forceApps=$true
    Must-Reject 'Apply' $request 'Forced close confirmation required'
    $request=Request-Fixture; $request.apps=@('node')
    Must-Reject 'Apply' $request 'not allowlisted'
    $request=Request-Fixture; $request.targets=@(@{app='chrome';pid=987;path='C:\Fixture\other.exe';started='12345'})
    Must-Reject 'Apply' $request 'changed or exited'
    if ($script:setCalls.Count -or $script:closeCalls.Count) { throw 'Failed validation caused changes' }
    $applied=Invoke-ResourceAction 'Apply' (Request-Fixture)
    if (-not $applied.applied -or $script:setCalls.Count -ne 3 -or $script:closeCalls.Count -ne 1) { throw 'Apply did not use graceful close/visual settings' }
    $before=Get-Content -LiteralPath $resourceJournal -Raw
    $other=Request-Fixture; $other.owner=[guid]::NewGuid().ToString()
    $closeBefore=$script:closeCalls.Count; $setBefore=$script:setCalls.Count
    $result=Invoke-ResourceAction 'Apply' $other
    if (-not $result.visualsSkipped -or $result.visualsOwned -or $script:closeCalls.Count -ne $closeBefore+1 -or $script:setCalls.Count -ne $setBefore -or (Get-Content -LiteralPath $resourceJournal -Raw) -ne $before) { throw 'Foreign visual record blocked app close or was overwritten' }
    $result=Invoke-ResourceAction 'Restore' $other
    if ($result.restored -or (Get-Content -LiteralPath $resourceJournal -Raw) -ne $before) { throw 'Another panel took over restoration' }
    # Repeated apply must retain the first original snapshot, not back up the reduced values.
    $null=Invoke-ResourceAction 'Apply' (Request-Fixture)
    if ((Get-Content -LiteralPath $resourceJournal -Raw) -ne $before) { throw 'Repeated apply overwrote original settings' }
    $script:fakeVisuals.menuAnimation=$true
    $result=Invoke-ResourceAction 'Restore' (Request-Fixture)
    if (-not $result.restored -or $result.skipped -notcontains 'menuAnimation' -or $result.settings.Count -ne 2 -or (Test-Path -LiteralPath $resourceJournal)) { throw 'Conditional recovery failed' }
    if ($script:fakeVisuals.Values -contains $false) { throw 'Visual values did not recover' }
    $result=Invoke-ResourceAction 'Restore' (Request-Fixture)
    if ($result.restored) { throw 'Missing journal falsely restored' }
    $held=[IO.File]::Open((Join-Path $resourceRoot 'operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try { Must-Reject 'Apply' (Request-Fixture) 'Another panel is optimizing' } finally { $held.Dispose() }
    $closeCount=$script:closeCalls.Count; $script:failOnSet=$script:setCalls.Count+2
    Must-Reject 'Apply' (Request-Fixture) 'Simulated visual API failure'
    if (-not (Test-Path -LiteralPath $resourceJournal) -or $script:closeCalls.Count -ne $closeCount) { throw 'Partial failure lost recovery or closed apps' }
    $script:failOnSet=0
    $null=Invoke-ResourceAction 'Restore' (Request-Fixture)
    if ($script:fakeVisuals.Values -contains $false) { throw 'Partial visual failure was not recoverable' }
    $script:fakeCloseCount=0; $script:fakeOwner='fixture-user'
    $script:fakeProcess=[pscustomobject]@{Id=987;SessionId=99;ProcessName='chrome';Path='C:\Fixture\chrome.exe';StartTime=([DateTime]::new(12345,[DateTimeKind]::Utc));MainWindowHandle=([IntPtr]123)}
    $script:fakeProcess | Add-Member ScriptMethod CloseMainWindow { $script:fakeCloseCount++; return $true }
    $script:fakeProcess | Add-Member ScriptMethod Kill { $script:fakeCloseCount++ }
    $script:fakeProcess | Add-Member ScriptMethod WaitForExit { param($timeout); return $true }
    function Get-Process { [CmdletBinding()]param($Id,$Name); if ($Id -eq 987 -or $Name -eq 'chrome') { return $script:fakeProcess } }
    function Get-CimInstance { param($ClassName,$Filter); return @{ProcessId=987} }
    function Invoke-CimMethod { param($InputObject,$MethodName); return @{ReturnValue=0;Sid=$script:fakeOwner} }
    $eligibleResult=@(& $nativeEligible)
    if ($eligibleResult.Count -ne 1 -or $eligibleResult[0].app -ne 'chrome') { throw 'Eligible application filter failed' }
    $script:fakeProcess.MainWindowHandle=[IntPtr]::Zero
    if (@(& $nativeEligible).Count) { throw 'Background process was eligible' }
    if (@(& $nativeEligible $true).Count -ne 1) { throw 'Opt-in background process was omitted' }
    $script:fakeProcess.MainWindowHandle=[IntPtr]123
    $null=& $nativeClose $script:eligible[0]
    if ($script:fakeCloseCount -ne 1) { throw 'Normal window-close request was not used' }
    $script:fakeOwner='another-user'
    try { & $nativeClose $script:eligible[0]; throw 'Foreign user accepted' } catch { if ($_.Exception.Message -notmatch 'another user') { throw } }
    $script:fakeOwner='fixture-user'; $script:fakeProcess.StartTime=$script:fakeProcess.StartTime.AddSeconds(1)
    try { & $nativeClose $script:eligible[0]; throw 'Reused PID accepted' } catch { if ($_.Exception.Message -notmatch 'identity changed') { throw } }
    if ($script:fakeCloseCount -ne 1) { throw 'Unsafe application was closed' }
    $script:fakeProcess.StartTime=([DateTime]::new(12345,[DateTimeKind]::Utc))
    $null=Stop-SelectedApp $script:eligible[0]
    if ($script:fakeCloseCount -ne 2) { throw 'Verified explicit forced stop did not target the selected process' }
    Write-Output 'RESOURCE_NATIVE_TEST_OK (mocked visuals and app close only)'
} finally {
    $resolved=[IO.Path]::GetFullPath($temp)
    $prefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'strata-resource-test-*') { throw 'Unsafe test cleanup' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
