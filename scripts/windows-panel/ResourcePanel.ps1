$script:resourceHelper=$null
$script:resourcePending=$null
$script:resourceVisualOwned=$false
$script:resourceDesktopOwned=$false
$script:gpuScanForm=$null
$script:finishingResource=$false
$script:resourceOwner=[guid]::NewGuid().ToString()
$resourceAuto=New-Object Windows.Forms.CheckBox
$resourceAuto.Text=$ui.resourceAuto; $resourceAuto.SetBounds(18,20,780,28); $resourceTab.Controls.Add($resourceAuto)
$resourceVisual=New-Object Windows.Forms.CheckBox
$resourceVisual.Text=$ui.resourceVisual; $resourceVisual.SetBounds(18,60,780,28); $resourceTab.Controls.Add($resourceVisual)
$resourceRestore=New-Object Windows.Forms.CheckBox
$resourceRestore.Text=$ui.resourceRestore; $resourceRestore.Checked=$true
$resourceRestore.SetBounds(18,100,780,28); $resourceTab.Controls.Add($resourceRestore)
$resourceForce=New-Object Windows.Forms.CheckBox
$resourceForce.Text=$ui.resourceForce; $resourceForce.SetBounds(18,140,780,28); $resourceTab.Controls.Add($resourceForce)
$resourceAppLabel=Label-At $resourceTab $ui.resourceApps 18 148 370
$resourceApps=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resource-apps.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$resourceAppList=New-Object Windows.Forms.CheckedListBox
$resourceAppList.CheckOnClick=$true; $resourceAppList.SetBounds(18,180,370,186)
$resourceTab.Controls.Add($resourceAppList)
foreach ($app in $resourceApps) { $null=$resourceAppList.Items.Add($app.label) }
$resourcePreview=New-Object Windows.Forms.TextBox
$resourcePreview.ReadOnly=$true; $resourcePreview.Multiline=$true; $resourcePreview.WordWrap=$true; $resourcePreview.ScrollBars='Vertical'
$resourcePreview.SetBounds(408,180,390,186); $resourceTab.Controls.Add($resourcePreview)
$resourceInspect=Button-At $resourceTab $ui.resourceInspect 18 390 170
$resourceApply=Button-At $resourceTab $ui.resourceApply 206 390 170
$resourceRecover=Button-At $resourceTab $ui.resourceRecover 394 390 190
$resourceScan=Button-At $resourceTab $ui.resourceScan 602 390 190
$resourceStopDesktop=Button-At $resourceTab $ui.resourceStopDesktop 18 430 210
$resourceStartDesktop=Button-At $resourceTab $ui.resourceStartDesktop 246 430 210
$resourceResult=Label-At $resourceTab $ui.resourceIdle 18 448 780
$resourceResult.Height=60
$storedResource=$catalogue.preferences.resourceOptimization
if ($storedResource) {
    $resourceAuto.Checked=$storedResource.beforeModelStart -eq $true
    $resourceVisual.Checked=$storedResource.reduceVisuals -eq $true
    $resourceRestore.Checked=$storedResource.restoreOnClose -ne $false
    $resourceForce.Checked=$storedResource.forceApps -eq $true
    for ($i=0; $i -lt $resourceApps.Count; $i++) { $resourceAppList.SetItemChecked($i,$resourceApps[$i].id -in @($storedResource.apps)) }
}
function Get-ResourceOptions {
    $apps=@()
    foreach ($index in $resourceAppList.CheckedIndices) { $apps+=$resourceApps[$index].id }
    return @{beforeModelStart=$resourceAuto.Checked;reduceVisuals=$resourceVisual.Checked;restoreOnClose=$resourceRestore.Checked;forceApps=$resourceForce.Checked;apps=$apps}
}
function Layout-ResourcePanel([double]$scale) {
    $width=$resourceTab.ClientSize.Width
    $resourceAuto.SetBounds([int](18*$scale),[int](20*$scale),($width-[int](36*$scale)),[int](28*$scale))
    $resourceVisual.SetBounds([int](18*$scale),[int](60*$scale),($width-[int](36*$scale)),[int](28*$scale))
    $resourceRestore.SetBounds([int](18*$scale),[int](100*$scale),($width-[int](36*$scale)),[int](28*$scale))
    $resourceForce.SetBounds([int](18*$scale),[int](140*$scale),($width-[int](36*$scale)),[int](28*$scale))
    $resourceAppLabel.SetBounds([int](18*$scale),[int](180*$scale),[int](370*$scale),[int](25*$scale))
    $resourceAppList.SetBounds([int](18*$scale),[int](212*$scale),[int](370*$scale),[int](126*$scale))
    $resourcePreview.SetBounds([int](408*$scale),[int](212*$scale),[math]::Max(40,$width-[int](426*$scale)),[int](126*$scale))
    $buttons=@($resourceInspect,$resourceApply,$resourceRecover,$resourceScan); $positions=@(18,206,394,602); $widths=@(170,170,190,190)
    for ($i=0; $i -lt 4; $i++) { $buttons[$i].SetBounds([int]($positions[$i]*$scale),[int](356*$scale),[int]($widths[$i]*$scale),[int](32*$scale)) }
    $resourceStopDesktop.SetBounds([int](18*$scale),[int](402*$scale),[int](210*$scale),[int](32*$scale))
    $resourceStartDesktop.SetBounds([int](246*$scale),[int](402*$scale),[int](210*$scale),[int](32*$scale))
    $resultTop=[int](448*$scale)
    $resultHeight=[math]::Max(1,[math]::Min([int](65*$scale),$resourceTab.ClientSize.Height-$resultTop-[int](12*$scale)))
    $resourceResult.SetBounds([int](18*$scale),$resultTop,($width-[int](36*$scale)),$resultHeight)
}
function Update-ResourceButtons {
    $busy=[bool]$script:resourceHelper
    foreach ($c in @($resourceInspect,$resourceApply,$resourceRecover,$resourceScan,$resourceStopDesktop,$resourceStartDesktop,$resourceAuto,$resourceVisual,$resourceRestore,$resourceForce,$resourceAppList)) { $c.Enabled=-not $busy }
}
function Show-ResourceSnapshot($s) {
    $lines=@()
    foreach ($app in $resourceApps) {
        $targets=@($s.targets | Where-Object { $_.app -eq $app.id })
        $all=@($s.backgroundTargets | Where-Object { $_.app -eq $app.id })
        $lines+=($app.label+' / '+$targets.Count+' '+$ui.resourceWindows+' / '+$all.Count+' '+$ui.resourceAllProcesses)
    }
    foreach ($key in @('windowAnimation','clientAnimation','menuAnimation')) {
        $lines+=($ui.('resource_'+$key)+': '+$(if ($s.visuals.$key) { $ui.resourceOn } else { $ui.resourceOff }))
    }
    $lines+=''; $lines+=($ui.resourceRecovery+': '+[bool]$s.recoveryAvailable)
    $lines+=('Explorer: '+[bool]$s.explorerTarget)
    $resourcePreview.Text=$lines -join "`r`n"
}
function Resource-Request([string]$Action,$Extra) {
    if ($Action -notin @('Inspect','Apply','Restore','ScanGpu','StopExplorer','RestoreExplorer')) { throw 'Unsupported resource action' }
    if ($script:resourceHelper) { throw 'Resource operation is already running' }
    $request=@{owner=$script:resourceOwner;apps=@();targets=@();reduceVisuals=$false;confirmedApps=$false;manualRestore=$false;forceApps=$false;confirmedForce=$false;confirmedExplorer=$false}
    if ($Extra) { foreach ($key in $Extra.Keys) { $request[$key]=$Extra[$key] } }
    [IO.Directory]::CreateDirectory($stateRoot) | Out-Null
    $file=Join-Path $stateRoot ([guid]::NewGuid().ToString()+'.resource-request.json')
    [IO.File]::WriteAllText($file,($request | ConvertTo-Json -Depth 12),(New-Object Text.UTF8Encoding($false)))
    try {
        $p=[PanelProcess]::Start('powershell.exe',@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'ResourceOptimization.ps1'),'-Action',$Action,'-RequestFile',$file),$true,$root,$true)
        $script:resourceHelper=@{process=$p;stdout=$p.StandardOutput.ReadToEndAsync();stderr=$p.StandardError.ReadToEndAsync();action=$Action;file=$file;started=[DateTime]::UtcNow}
        $resourceResult.Text=$ui.resourceBusy+' '+$Action
        Update-ResourceButtons
    } catch { [IO.File]::Delete($file); throw }
}
function Confirm-ResourceApps($targets) {
    if (-not @($targets).Count) { return $true }
    $lines=@($(if ($script:resourcePending.options.forceApps) { $ui.resourceForceWarning } else { $ui.resourceCloseWarning }), '')
    foreach ($target in $targets) { $lines+=($target.app+' / PID '+$target.pid+"`r`n"+$target.path) }
    return [Windows.Forms.MessageBox]::Show(($lines -join "`r`n"),$ui.resourcePage,'YesNo','Warning') -eq 'Yes'
}
function Confirm-ResourceDesktop {
    return [Windows.Forms.MessageBox]::Show($ui.resourceDesktopWarning,$ui.resourcePage,'YesNo','Warning') -eq 'Yes'
}
function Show-GpuMemorySnapshot($Snapshot) {
    if ($script:gpuScanForm -and -not $script:gpuScanForm.IsDisposed) { $script:gpuScanForm.Close() }
    $view=New-Object Windows.Forms.Form
    $view.Text=$ui.resourceScan; $view.Font=$form.Font; $view.StartPosition='CenterParent'
    $view.Size=New-Object Drawing.Size(1040,620); $view.MinimumSize=New-Object Drawing.Size(860,500)
    $summary=New-Object Windows.Forms.TextBox
    $summary.ReadOnly=$true; $summary.Multiline=$true; $summary.Dock='Top'; $summary.Height=90; $summary.ScrollBars='Vertical'
    $lines=@()
    foreach ($card in $Snapshot.nvidia.cards) { $lines+=('NVML '+$card.index+' / '+$card.name+': '+$card.usedMiB+' / '+$card.totalMiB+' MiB; free '+$card.freeMiB+' MiB') }
    if (-not $Snapshot.nvidia.available) { $lines+=$Snapshot.nvidia.reason }
    $lines+=@($Snapshot.warnings); $lines+=('WDDM counter available: '+$Snapshot.counterAvailable+' / '+$Snapshot.time)
    $summary.Text=$lines -join "`r`n"
    $note=New-Object Windows.Forms.TextBox
    $note.ReadOnly=$true; $note.Multiline=$true; $note.Dock='Bottom'; $note.Height=80; $note.Text=$ui.resourceScanNote
    $grid=New-Object Windows.Forms.DataGridView
    $grid.Dock='Fill'; $grid.ReadOnly=$true; $grid.AllowUserToAddRows=$false; $grid.AllowUserToDeleteRows=$false
    $grid.RowHeadersVisible=$false; $grid.SelectionMode='FullRowSelect'; $grid.AutoSizeColumnsMode='Fill'
    foreach ($column in @(@('name','Process',23),@('pid','PID',10),@('adapter','WDDM LUID / phys',32),@('memory','Dedicated MiB',15),@('category','Review',20))) {
        $index=$grid.Columns.Add($column[0],$column[1]); $grid.Columns[$index].FillWeight=$column[2]
    }
    $categories=@{protected=$ui.resourceProtected;allowlisted=$ui.resourceAllowlisted;readonly=$ui.resourceReadonly}
    foreach ($row in $Snapshot.processes) { $null=$grid.Rows.Add([object[]]@($row.name,$row.pid,$row.adapter,$row.dedicatedMiB,$categories[$row.category])) }
    $view.Controls.Add($grid); $view.Controls.Add($note); $view.Controls.Add($summary)
    $script:gpuScanForm=$view
    if (-not $SelfTest) { $view.Show($form) }
}
function Begin-ResourceApply([bool]$LaunchModel) {
    if ($script:resourceHelper -or $script:resourcePending) { throw 'Resource optimization is already running' }
    $options=Get-ResourceOptions
    if (-not $options.reduceVisuals -and -not $options.apps.Count) {
        if ($LaunchModel) { Start-SelectedModel } else { $resourceResult.Text=$ui.resourceNothing }
        return
    }
    $script:resourcePending=@{options=$options;launchModel=$LaunchModel}
    if ($LaunchModel) { $start.Enabled=$false; Update-PiConnection }
    try { Resource-Request 'Inspect' $null }
    catch { $script:resourcePending=$null; if ($LaunchModel) { $start.Enabled=$true }; throw }
}
function Finish-ResourceOperation {
    if ($script:finishingResource) { return }
    $job=$script:resourceHelper
    if (-not $job) { return }
    if (-not $job.process.HasExited) {
        if (([DateTime]::UtcNow-$job.started).TotalSeconds -gt 30) { $resourceResult.Text=$ui.resourceSlow }
        return
    }
    $script:finishingResource=$true
    $next=$null; $launch=$false
    try {
        $stdout=$job.stdout.GetAwaiter().GetResult(); $stderr=$job.stderr.GetAwaiter().GetResult()
        if ($job.process.ExitCode -ne 0) { throw $stderr.Trim() }
        $result=$stdout | ConvertFrom-Json
        if ($job.action -eq 'Inspect') {
            Show-ResourceSnapshot $result
            $resourceResult.Text=$ui.resourceInspected
            if ($script:resourcePending) {
                $pending=$script:resourcePending; $options=$pending.options
                if ($pending.stopExplorer) {
                    if ($result.explorerTarget -and (Confirm-ResourceDesktop)) {
                        $next=@{confirmedExplorer=$true;explorerTarget=$result.explorerTarget}; $script:resourceNextAction='StopExplorer'; $script:resourceDesktopOwned=$true
                    } else { $resourceResult.Text=$ui.resourceCancelled }
                    $script:resourcePending=$null
                } else {
                $availableTargets=if ($options.forceApps) { $result.backgroundTargets } else { $result.targets }
                $targets=@($availableTargets | Where-Object { $_.app -in $options.apps })
                if (Confirm-ResourceApps $targets) { $next=@{apps=$options.apps;reduceVisuals=$options.reduceVisuals;targets=$targets;confirmedApps=$true;forceApps=[bool]$options.forceApps;confirmedForce=[bool]$options.forceApps} }
                else { $resourceResult.Text=$ui.resourceCancelled; $script:resourcePending=$null; if ($pending.launchModel) { $start.Enabled=$true } }
                }
            }
        } elseif ($job.action -eq 'Apply') {
            $requests=@($result.closeRequests | Where-Object { $_.requested }).Count
            $failed=@($result.closeRequests | Where-Object { -not $_.requested }).Count
            $forced=@($result.closeRequests | Where-Object { $_.forced }).Count
            $resourceResult.Text=$ui.resourceVisualResult+' '+[bool]$result.visualsReduced+' / '+$ui.resourceApplied+' '+$requests+' / '+$ui.resourceFailedCount+' '+$failed
            $details=@()
            foreach ($item in $result.closeRequests) {
                $outcome=if (-not $item.requested) { $ui.resourceCloseFailed } elseif ($item.forced) { $ui.resourceProcessExited } else { $ui.resourceCloseRequested }
                $details+=($item.app+' / PID '+$item.pid+': '+$outcome)
                if ($item.error) { $details+=($item.error+' / Win32: '+$item.nativeErrorCode) }
            }
            foreach ($item in $result.newProcesses) { $details+=($ui.resourceNewProcess+': '+$item.app+' / PID '+$item.pid) }
            if ($result.visualsSkipped) { $details+=$ui.resourceForeignVisual; $script:resourceVisualOwned=$false }
            $resourcePreview.Text=$details -join "`r`n"
            $resourceResult.Text+="`r`n"+$(if ($result.visualsSkipped) { $ui.resourceForeignVisual } elseif ($forced) { $ui.resourceForcedResult } else { $ui.resourceNotForced })
            $launch=$script:resourcePending -and $script:resourcePending.launchModel -and $failed -eq 0
            if ($failed -and $script:resourcePending.launchModel) { $start.Enabled=$true }
            $script:resourcePending=$null
        } elseif ($job.action -eq 'ScanGpu') {
            Show-GpuMemorySnapshot $result
            $resourceResult.Text=$ui.resourceScanned
        } elseif ($job.action -eq 'StopExplorer') {
            $resourceResult.Text=if ($result.runningAgain) { $ui.resourceDesktopRespawn } elseif ($result.stopped) { $ui.resourceDesktopStopped } else { $result.reason }
        } elseif ($job.action -eq 'RestoreExplorer') {
            $resourceResult.Text=if ($result.restored) { $ui.resourceDesktopRestored } else { $result.reason }
            $script:resourceDesktopOwned=$false
        } else { $resourceResult.Text=if ($result.restored) { $ui.resourceRestored } else { $ui.resourceNoRecovery }; $script:resourceVisualOwned=$false }
    } catch {
        if ($script:resourcePending.launchModel) { $start.Enabled=$true }
        $script:resourcePending=$null
        $resourceResult.Text=$ui.resourceFailed+' / '+$_.Exception.Message
        $resourcePreview.Text=$resourceResult.Text
    } finally {
        $job.process.Dispose(); [IO.File]::Delete($job.file); $script:resourceHelper=$null
        $script:finishingResource=$false
        Update-ResourceButtons
    }
    if ($next) {
        if ($next.reduceVisuals) { $script:resourceVisualOwned=$true }
        $action=if ($script:resourceNextAction) { $script:resourceNextAction } else { 'Apply' }; $script:resourceNextAction=$null
        try { Resource-Request $action $next }
        catch { if ($script:resourcePending.launchModel) { $start.Enabled=$true }; $script:resourcePending=$null; $resourceResult.Text=$ui.resourceFailed+' / '+$_.Exception.Message }
    } elseif ($launch) { Start-SelectedModel }
}
function Restore-ResourceOnClose {
    if ($SelfTest) { return }
    if ($script:resourceDesktopOwned) {
        Resource-Request 'RestoreExplorer' @{manualRestore=$false}
        if (-not $script:resourceHelper.process.WaitForExit(15000)) { throw 'Desktop recovery is still running' }
        Finish-ResourceOperation
        if ($resourceResult.Text.StartsWith($ui.resourceFailed)) { throw $resourceResult.Text }
    }
    if (-not $resourceRestore.Checked -or -not $script:resourceVisualOwned) { return }
    # Owned restoration only; never take over another panel's journal during shutdown.
    Resource-Request 'Restore' @{manualRestore=$false}
    $p=$script:resourceHelper.process
    if (-not $p.WaitForExit(15000)) { throw 'Visual restore is still running; wait before closing the panel.' }
    Finish-ResourceOperation
    if ($resourceResult.Text.StartsWith($ui.resourceFailed)) { throw $resourceResult.Text }
}
$resourceInspect.add_Click({ try { Resource-Request 'Inspect' $null } catch { Message-Error $_.Exception.Message } })
$resourceScan.add_Click({ try { Resource-Request 'ScanGpu' $null } catch { Message-Error $_.Exception.Message } })
$resourceStopDesktop.add_Click({
    try {
        if ($script:resourceHelper -or $script:resourcePending) { throw 'Resource operation is already running' }
        $script:resourcePending=@{stopExplorer=$true;launchModel=$false}
        Resource-Request 'Inspect' $null
    } catch { $script:resourcePending=$null; Message-Error $_.Exception.Message }
})
$resourceStartDesktop.add_Click({ try { Resource-Request 'RestoreExplorer' @{manualRestore=$true} } catch { Message-Error $_.Exception.Message } })
$resourceApply.add_Click({ try { Save-PanelPreferences; Begin-ResourceApply $false } catch { Message-Error $_.Exception.Message } })
$resourceRecover.add_Click({
    if ([Windows.Forms.MessageBox]::Show($ui.resourceRestoreConfirm,$ui.resourcePage,'YesNo','Question') -eq 'Yes') {
        try { Resource-Request 'Restore' @{manualRestore=$true} } catch { Message-Error $_.Exception.Message }
    }
})
