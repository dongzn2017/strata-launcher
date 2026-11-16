if (-not $ScreenshotDirectory) { $ScreenshotDirectory=Join-Path $root 'logs/strata-panel-tests/resource' }
[IO.Directory]::CreateDirectory($ScreenshotDirectory) | Out-Null
$resourceAuto.Checked=$true; $resourceVisual.Checked=$true; $resourceRestore.Checked=$true
$resourceForce.Checked=$false
for ($i=0; $i -lt $resourceAppList.Items.Count; $i++) { $resourceAppList.SetItemChecked($i,$i -eq 0) }
$options=Get-ResourceOptions
if (-not $options.beforeModelStart -or -not $options.reduceVisuals -or $options.apps.Count -ne 1 -or $options.apps[0] -ne 'chrome') { throw 'Resource UI serialization failed' }
$resourceForce.Checked=$true
if (-not (Get-ResourceOptions).forceApps) { throw 'Forced-close opt-in did not serialize' }
$resourceForce.Checked=$false
$script:resourceTestLaunches=0; $script:resourceTestConfirms=0; $script:resourceTestConsent=$false
$script:resourceTestActions=@()
$realResourceRequest=${function:Resource-Request}
function Start-SelectedModel { $script:resourceTestLaunches++ }
function Confirm-ResourceApps($targets) {
    $script:resourceTestConfirms++
    # Modal message boxes run a nested event loop; a second timer tick must not repeat the confirmation.
    Finish-ResourceOperation
    return $script:resourceTestConsent
}
function Resource-Request([string]$Action,$Extra) {
    $script:resourceTestActions+=$Action
    if ($Action -eq 'Inspect') { $result=@{visuals=@{windowAnimation=$true;menuAnimation=$true;clientAnimation=$true};targets=@(@{app='chrome';pid=987;path='C:\Fixture\chrome.exe';started='12345'});backgroundTargets=@(@{app='chrome';pid=987;path='C:\Fixture\chrome.exe';started='12345'});explorerTarget=@{pid=321;path='C:\Windows\explorer.exe';started='111'};recoveryAvailable=$false} }
    elseif ($Action -eq 'Apply') {
        if (-not $Extra.confirmedApps -or $Extra.targets.Count -ne 1 -or $Extra.targets[0].pid -ne 987) { throw 'Unconfirmed application apply' }
        if ($Extra.forceApps -and -not $Extra.confirmedForce) { throw 'Forced UI request missing confirmation' }
        if ($script:resourceTestCloseFailure) {
            $result=@{applied=$true;visualsReduced=$false;closeRequests=@(@{app='chrome';pid=987;requested=$false;forced=$true;error='Fixture access denied';nativeErrorCode=5})}
        } else {
            $result=@{applied=$true;visualsReduced=$true;visualsSkipped=[bool]$script:resourceTestForeignJournal;closeRequests=@(@{app='chrome';pid=987;requested=$true})}
        }
    } elseif ($Action -eq 'StopExplorer') {
        if (-not $Extra.confirmedExplorer -or $Extra.explorerTarget.pid -ne 321) { throw 'Desktop stop was not confirmed and bound' }
        $result=@{stopped=$true;runningAgain=$false}
    } else { $result=@{restored=$true} }
    $stdout=New-Object 'Threading.Tasks.TaskCompletionSource[string]'
    $stderr=New-Object 'Threading.Tasks.TaskCompletionSource[string]'
    $stdout.SetResult(($result | ConvertTo-Json -Depth 10 -Compress)); $stderr.SetResult('')
    $process=[pscustomobject]@{HasExited=$true;ExitCode=0}
    $process | Add-Member ScriptMethod Dispose {}
    $script:resourceHelper=@{process=$process;stdout=$stdout.Task;stderr=$stderr.Task;action=$Action;file=(Join-Path $ScreenshotDirectory 'unused-test-request.json');started=[DateTime]::UtcNow}
    Update-ResourceButtons
}
Begin-ResourceApply $true
if ($resourceApply.Enabled -or $start.Enabled) { throw 'Duplicate resource/model operation enabled' }
Finish-ResourceOperation
if ($script:resourceTestLaunches -or $script:resourcePending -or $script:resourceHelper -or $script:resourceTestActions.Count -ne 1) { throw 'Cancelled optimization started a model or applied settings' }
$script:resourceTestConsent=$true
Begin-ResourceApply $true
Finish-ResourceOperation
if ($script:resourceTestLaunches -or $script:resourceHelper.action -ne 'Apply') { throw 'Model launched before optimization completed' }
Finish-ResourceOperation
if ($script:resourceTestLaunches -ne 1 -or $script:resourceTestConfirms -ne 2 -or $script:resourceHelper -or $script:resourcePending) { throw 'Optimization/model sequencing or modal reentrancy failed' }
Begin-ResourceApply $false; Finish-ResourceOperation; Finish-ResourceOperation
if ($script:resourceTestLaunches -ne 1) { throw 'Manual optimization launched a model' }
$resourceForce.Checked=$true
Begin-ResourceApply $false; Finish-ResourceOperation; Finish-ResourceOperation
if ($script:resourceTestLaunches -ne 1) { throw 'Forced application close launched a model' }
$resourceForce.Checked=$false
${script:resourceTestCloseFailure}=$true
Begin-ResourceApply $true; Finish-ResourceOperation; Finish-ResourceOperation
if ($script:resourceTestLaunches -ne 1 -or -not $resourcePreview.Text.Contains('Fixture access denied') -or -not $resourcePreview.Text.Contains('Win32: 5')) { throw 'Close failure was hidden or still launched model' }
$script:resourceTestCloseFailure=$false; $script:resourceTestForeignJournal=$true
Begin-ResourceApply $false; Finish-ResourceOperation; Finish-ResourceOperation
if ($script:resourceVisualOwned -or -not $resourcePreview.Text.Contains($ui.resourceForeignVisual)) { throw 'Foreign visual journal incorrectly owned or not explained' }
$script:resourceTestForeignJournal=$false
function Confirm-ResourceDesktop { return $script:resourceTestConsent }
$script:resourceTestConsent=$false
$script:resourcePending=@{stopExplorer=$true;launchModel=$false}
Resource-Request 'Inspect' $null; Finish-ResourceOperation
if ($script:resourcePending -or $script:resourceHelper -or $script:resourceDesktopOwned) { throw 'Cancelled desktop stop changed ownership' }
$script:resourceTestConsent=$true
$script:resourcePending=@{stopExplorer=$true;launchModel=$false}
Resource-Request 'Inspect' $null; Finish-ResourceOperation
if ($script:resourceHelper.action -ne 'StopExplorer') { throw 'Desktop stop bypassed inspect/confirm' }
Finish-ResourceOperation
if (-not $script:resourceDesktopOwned -or $script:resourceTestLaunches -ne 1) { throw 'Desktop stop lost recovery ownership or launched model' }
Resource-Request 'RestoreExplorer' @{manualRestore=$true}; Finish-ResourceOperation
if ($script:resourceDesktopOwned) { throw 'Desktop restore retained ownership' }
$tabs.SelectedTab=$resourceTab
$resourcePreview.Text="Google Chrome / 1`r`nMicrosoft Edge / 0`r`nMozilla Firefox / 0`r`nDiscord / 0`r`nSteam / 0`r`nSpotify / 0`r`nEpic Games Launcher / 0"
$resourceResult.Text=$ui.resourceIdle
$form.Show(); [Windows.Forms.Application]::DoEvents()
$errors=@(); $previousScale=1.0
foreach ($scale in @(1.0,1.25,1.5,2.0)) {
    $script:scalingPanel=$true
    $factor=New-Object Drawing.SizeF(($scale/$previousScale),($scale/$previousScale))
    $form.Scale($factor); $form.Font=New-Object Drawing.Font('Microsoft YaHei UI',([single](9*$scale)))
    $script:scalingPanel=$false; Layout-Panel
    [Windows.Forms.Application]::DoEvents()
    $errors+=@(Layout-Errors @($resourceTab))
    foreach ($control in @($resourceAuto,$resourceVisual,$resourceRestore,$resourceForce,$resourceInspect,$resourceApply,$resourceRecover,$resourceScan,$resourceStopDesktop,$resourceStartDesktop)) {
        $size=[Windows.Forms.TextRenderer]::MeasureText($control.Text,$control.Font)
        if ($size.Width -gt $control.Width-24*$scale) { $errors+='Clipped resource control: '+$control.Text }
    }
    Save-WindowImage $form (Join-Path $ScreenshotDirectory ('resource-'+[int]($scale*100)+'.png'))
    $previousScale=$scale
}
${function:Resource-Request}=$realResourceRequest
$script:resourcePending=$null; $script:resourceVisualOwned=$false
Resource-Request 'Inspect' $null
for ($i=0; $i -lt 350 -and $script:resourceHelper; $i++) {
    Start-Sleep -Milliseconds 100; Finish-ResourceOperation; [Windows.Forms.Application]::DoEvents()
}
if ($script:resourceHelper -or $resourceResult.Text.StartsWith($ui.resourceFailed)) { throw 'Real read-only resource inspection failed' }
Resource-Request 'ScanGpu' $null
for ($i=0; $i -lt 350 -and $script:resourceHelper; $i++) {
    Start-Sleep -Milliseconds 100; Finish-ResourceOperation; [Windows.Forms.Application]::DoEvents()
}
if ($script:resourceHelper -or $resourceResult.Text.StartsWith($ui.resourceFailed) -or -not $script:gpuScanForm) { throw 'Real read-only GPU scan failed' }
$script:gpuScanForm.Font=$font
$script:gpuScanForm.Show(); [Windows.Forms.Application]::DoEvents()
Save-WindowImage $script:gpuScanForm (Join-Path $ScreenshotDirectory 'gpu-scan.png')
$script:gpuScanForm.Dispose()
$report=@{ok=($errors.Count -eq 0);scales=@(100,125,150,200);cancelAbortsModel=$true;modalReentrancyProtected=$true;manualDoesNotLaunchModel=$true;optionsSerialized=$true;forceCloseOptInVerified=$true;desktopConfirmAndRestoreVerified=$true;readOnlyInspectionVerified=$true;readOnlyGpuScanVerified=$true;realExplorerStopped=$false;realAppsClosed=$false;realVisualsChanged=$false;errors=$errors}
[IO.File]::WriteAllText((Join-Path $ScreenshotDirectory 'resource-ui-report.json'),($report | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
$script:allowClose=$true; $small.Dispose(); $form.Dispose(); $http.Dispose(); $monitorMenu.Dispose(); $tooltips.Dispose()
if ($errors.Count) { throw ($errors -join '; ') }
Write-Output ('RESOURCE_UI_SELF_TEST_OK '+$ScreenshotDirectory)
