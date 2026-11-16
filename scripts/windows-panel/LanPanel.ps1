$script:lanHelper=$null; $script:lanHost=$null; $script:lanHostOutput=$null; $script:lanId=$null
$lanStatus=Label-At $lanTab 'LAN' 18 20 780
$lanStatus.Height=70
$lanDetail=New-Object Windows.Forms.TextBox
$lanDetail.ReadOnly=$true; $lanDetail.Multiline=$true; $lanDetail.ScrollBars='Vertical'
$lanTab.Controls.Add($lanDetail)
$lanStart=Button-At $lanTab $ui.lanStart 18 360 140
$lanStop=Button-At $lanTab $ui.lanStop 174 360 140
$lanRefresh=Button-At $lanTab $ui.lanRefresh 330 360 140
$lanCopy=Button-At $lanTab $ui.lanCopy 486 360 180
$lanMonitor=Button-At $lanTab $ui.lanMonitor 18 410 210
$lanMonitorCopy=Button-At $lanTab $ui.lanMonitorCopy 246 410 260
function Layout-LanPanel([double]$scale) {
    $w=$lanTab.ClientSize.Width
    $lanStatus.SetBounds([int](18*$scale),[int](20*$scale),$w-[int](36*$scale),[int](70*$scale))
    $lanDetail.SetBounds([int](18*$scale),[int](110*$scale),$w-[int](36*$scale),[int](220*$scale))
    $buttons=@($lanStart,$lanStop,$lanRefresh,$lanCopy)
    for($i=0;$i -lt 4;$i++) { $buttons[$i].SetBounds([int]((18+156*$i)*$scale),[int](360*$scale),[int](140*$scale),[int](32*$scale)) }
    $lanMonitor.SetBounds([int](18*$scale),[int](410*$scale),[int](210*$scale),[int](32*$scale))
    $lanMonitorCopy.SetBounds([int](246*$scale),[int](410*$scale),[int](260*$scale),[int](32*$scale))
}
function Start-LanOperation([string]$Action) {
    if ($SelfTest) { return }
    try {
        if ($Action -eq 'Start') {
            if ($script:lanHost -and -not $script:lanHost.HasExited) { throw 'This bridge is already running' }
            $p=[PanelProcess]::Start($node,@((Join-Path $root 'launcher.mjs'),'lan',$script:activeProfile),$true,$root,$true)
            $script:lanHost=$p; $script:lanHostOutput=$p.StandardOutput.ReadLineAsync(); $script:lanHostError=$p.StandardError.ReadToEndAsync()
            $lanStatus.Text='Starting LAN bridge...'; return
        }
        if ($Action -eq 'Stop') {
            if (-not $script:lanId) { throw 'No launcher-owned LAN record selected' }
            $null=Node-Call 'lan-stop' @{id=$script:lanId}
        }
        $s=Node-Call 'lan-info' @{profile=$script:activeProfile}
        $script:lanInfo=$s; $script:lanId=$s.id
        $lanStatus.Text=$s.state
        $lanDetail.Text=($s | ConvertTo-Json -Depth 10)
        $lanStart.Enabled=[bool]$s.configured -and -not $s.listening
        $lanStop.Enabled=[bool]$s.id -and $s.listening
    } catch { $lanStatus.Text=$ui.lanFailed+' / '+$_.Exception.Message }
}
function Finish-LanOperation {
    if ($script:lanHostOutput -and $script:lanHostOutput.IsCompleted) {
        try {
            $line=$script:lanHostOutput.GetAwaiter().GetResult()
            if (-not $line) { throw $script:lanHostError.GetAwaiter().GetResult() }
            $s=$line | ConvertFrom-Json
            $script:lanId=$s.id
            $script:lanHostOutput=$null
            Start-LanOperation 'PanelStatus'
        } catch { $script:lanHostOutput=$null; $lanStatus.Text=$ui.lanFailed+' / '+$_.Exception.Message }
    }
}
function Close-LanHelper {
    # Closing the GUI does not terminate its independent bridge or the model.
    if ($script:lanHost) { $script:lanHost.Dispose() }
}
function Start-LocalMonitor {
    $sh=Join-Path $root 'Strata-Monitor.sh'
    $git='C:/Program Files/Git/bin/bash.exe'
    $null=[PanelProcess]::Start($git,@('--login',$sh,$script:activeProfile),$false,$root,$false)
}
$lanStart.add_Click({ Start-LanOperation 'Start' })
$lanRefresh.add_Click({ Start-LanOperation 'PanelStatus' })
$lanStop.add_Click({ if ([Windows.Forms.MessageBox]::Show($ui.lanConfirmStop,$ui.lanPage,'YesNo','Warning') -eq 'Yes') { Start-LanOperation 'Stop' } })
$lanCopy.add_Click({ try { [Windows.Forms.Clipboard]::SetText([string]$script:lanInfo.api) } catch { Message-Error $_.Exception.Message } })
$lanMonitor.add_Click({ try { Start-LocalMonitor } catch { Message-Error $_.Exception.Message } })
$lanMonitorCopy.add_Click({ try { [Windows.Forms.Clipboard]::SetText([string]$script:lanInfo.monitorCommand) } catch { Message-Error $_.Exception.Message } })
