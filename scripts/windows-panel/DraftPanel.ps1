$dui=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'DraftPanel.zh-CN.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$draftLabels=@{}
$draftRows=@(@('mode',$dui.mode,24),@('pack',$dui.pack,72),@('window',$dui.window,120),@('confidence',$dui.confidence,168))
foreach ($row in $draftRows) { $draftLabels[$row[0]]=Label-At $draftTab $row[1] 18 $row[2] 230 }
$draftMode=Combo-At $draftTab 260 22 260 @($dui.auto,$dui.manual)
$draftPack=Combo-At $draftTab 260 70 400 @($dui.stock,'Tuned / Strata1')
$draftWindow=New-Object Windows.Forms.NumericUpDown
$draftWindow.Minimum=2; $draftWindow.Maximum=6; $draftWindow.Value=6
$draftWindow.SetBounds(260,118,180,26); $draftTab.Controls.Add($draftWindow)
$draftConfidence=New-Object Windows.Forms.NumericUpDown
$draftConfidence.Minimum=0.05; $draftConfidence.Maximum=1; $draftConfidence.DecimalPlaces=2
$draftConfidence.Increment=0.05; $draftConfidence.Value=0.8
$draftConfidence.SetBounds(260,166,180,26); $draftTab.Controls.Add($draftConfidence)
$draftHelp=Label-At $draftTab $dui.help 18 220 780
$draftHelp.Height=100
$draftActual=New-Object Windows.Forms.TextBox
$draftActual.ReadOnly=$true; $draftActual.Multiline=$true; $draftActual.ScrollBars='Vertical'
$draftActual.SetBounds(18,338,780,144); $draftTab.Controls.Add($draftActual)
function Layout-DraftPanel([double]$scale) {
    foreach ($row in $draftRows) { $draftLabels[$row[0]].SetBounds([int](18*$scale),[int]($row[2]*$scale),[int](230*$scale),[int](28*$scale)) }
    $items=@($draftMode,$draftPack,$draftWindow,$draftConfidence)
    $ys=@(22,70,118,166); $ws=@(260,400,180,180)
    for ($i=0; $i -lt $items.Count; $i++) { $items[$i].SetBounds([int](260*$scale),[int]($ys[$i]*$scale),[int]($ws[$i]*$scale),[int](28*$scale)) }
    $width=[math]::Max(40,$draftTab.ClientSize.Width-[int](36*$scale))
    $draftHelp.SetBounds([int](18*$scale),[int](220*$scale),$width,[int](100*$scale))
    $draftActual.SetBounds([int](18*$scale),[int](338*$scale),$width,[math]::Max(40,$draftTab.ClientSize.Height-[int](356*$scale)))
}
function Get-DraftOptions {
    return @{mode=@('auto','manual')[[math]::Max(0,$draftMode.SelectedIndex)];pack=@('stock','tuned')[[math]::Max(0,$draftPack.SelectedIndex)];window=[int]$draftWindow.Value;confidence=[double]$draftConfidence.Value}
}
function Update-DraftControls {
    $enabled=$script:controls.drafting.SelectedItem -eq 'dflash2'
    $draftMode.Enabled=$enabled; $draftPack.Enabled=$enabled
    $draftWindow.Enabled=$enabled -and $draftMode.SelectedIndex -eq 1
    $draftConfidence.Enabled=$draftWindow.Enabled
    $script:modelLabels.spec.Text=$dui.mtpWindow
    $script:modelLabels.specMinP.Text=$dui.mtpProbability
    $script:controls.spec.Enabled=-not $enabled; $script:controls.specMinP.Enabled=-not $enabled
}
function Restore-DraftOptions($value) {
    $draftMode.SelectedIndex=if ($value.mode -eq 'manual') { 1 } else { 0 }
    $draftPack.SelectedIndex=if ($value.pack -eq 'tuned') { 1 } else { 0 }
    $draftWindow.Value=if ($null -ne $value.window) { [decimal]$value.window } else { 6 }
    $draftConfidence.Value=if ($null -ne $value.confidence) { [decimal]$value.confidence } else { 0.8 }
    Update-DraftControls
}
function Update-DraftStatus {
    $actual=$script:ownedStatus.startupMemory.drafting
    $draftActual.Text=$dui.pending
    if (-not $actual) { return }
    $draftActual.Text=$dui.actual+': '+$actual.mode+"`r`n"+$dui.file+': '+$actual.file+"`r`n"+$dui.window+': '+$actual.window+' / '+$dui.confidence+': '+$actual.confidence+"`r`n"+$dui.evidence
}
$draftMode.add_SelectedIndexChanged({ Update-DraftControls })
$script:controls.drafting.add_SelectedIndexChanged({ Update-DraftControls })
Restore-DraftOptions $null
Update-DraftStatus
