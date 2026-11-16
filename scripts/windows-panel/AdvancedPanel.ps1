$aui=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'AdvancedPanel.zh-CN.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:engineOptionControls=@{}
$script:engineOptionRows=@{}
$engineGroup=Combo-At $advancedTab 14 12 210 @($aui.all)
foreach ($group in @($catalogue.engineOptionSpecs | ForEach-Object { $_.group } | Select-Object -Unique)) { $null=$engineGroup.Items.Add($group) }
$engineSearchLabel=Label-At $advancedTab $aui.filter 236 15 45
$engineSearch=New-Object Windows.Forms.TextBox
$engineSearch.SetBounds(284,12,514,28); $advancedTab.Controls.Add($engineSearch)
$engineTabs=New-Object Windows.Forms.TabControl
$engineTabs.SetBounds(10,52,798,396); $advancedTab.Controls.Add($engineTabs)
$engineEditPage=New-Object Windows.Forms.TabPage; $engineEditPage.Text=$aui.edit
$enginePreviewPage=New-Object Windows.Forms.TabPage; $enginePreviewPage.Text=$aui.preview
$engineReferencePage=New-Object Windows.Forms.TabPage; $engineReferencePage.Text=$aui.reference
$engineTabs.TabPages.AddRange(@($engineEditPage,$enginePreviewPage,$engineReferencePage))
$engineRows=New-Object Windows.Forms.FlowLayoutPanel
$engineRows.FlowDirection='TopDown'; $engineRows.WrapContents=$false; $engineRows.AutoScroll=$true
$engineEditPage.Controls.Add($engineRows)
$engineDetail=New-Object Windows.Forms.TextBox
$engineDetail.ReadOnly=$true; $engineDetail.Multiline=$true; $engineDetail.ScrollBars='Vertical'
$engineDetail.TabStop=$false
$engineDetail.Text=$aui.notice
$engineEditPage.Controls.Add($engineDetail)
foreach ($s in $catalogue.engineOptionSpecs) {
    $key=[string]$s.key
    $row=New-Object Windows.Forms.Panel; $row.Margin=New-Object Windows.Forms.Padding(0,0,0,4)
    $row.Size=New-Object Drawing.Size(740,64)
    $label=Label-At $row ([string]$s.label) 4 3 460
    $label.Name='engine-label-'+$key
    $variable=Label-At $row ([string]($s.env+$s.flag)) 4 31 460
    $variable.Name='engine-variable-'+$key
    $c=Combo-At $row 480 4 246 @($s.values | ForEach-Object {
        switch ([string]$_) { 'default' { $aui.inherit }; 'off' { $aui.off }; 'on' { $aui.on }; default { [string]$_ } }
    })
    $c.Name='engine-option-'+$key; $c.Tag=$s
    $risk=Label-At $row ([string]$s.risk) 480 33 246
    $row.Tag=@{spec=$s;label=$label;variable=$variable;choice=$c;risk=$risk}
    $c.add_Enter({ param($sender,$eventArgs) Show-EngineDetail $sender.Tag })
    $c.add_SelectedIndexChanged({ param($sender,$eventArgs) Show-EngineDetail $sender.Tag })
    $script:engineOptionControls[$key]=$c; $script:engineOptionRows[$key]=$row
    $engineRows.Controls.Add($row)
}
$enginePreview=New-Object Windows.Forms.TextBox
$enginePreview.Name='engine-preview'; $enginePreview.ReadOnly=$true; $enginePreview.Multiline=$true
$enginePreview.WordWrap=$false; $enginePreview.ScrollBars='Both'; $enginePreview.Dock='Fill'
$enginePreview.TabStop=$false
$enginePreview.add_Enter({ $enginePreview.Select(0,0) })
$enginePreview.Font=New-Object Drawing.Font('Consolas',9); $enginePreviewPage.Controls.Add($enginePreview)
$engineReference=New-Object Windows.Forms.TextBox
$engineReference.ReadOnly=$true; $engineReference.Multiline=$true; $engineReference.ScrollBars='Vertical'
$engineReference.WordWrap=$true; $engineReference.TabStop=$false
$engineReference.Font=New-Object Drawing.Font('Microsoft YaHei UI',9); $engineReferencePage.Controls.Add($engineReference)
$engineReferenceList=New-Object Windows.Forms.ListBox
$engineReferenceList.HorizontalScrollbar=$true
$engineReferencePage.Controls.Add($engineReferenceList)
$engineReferenceList.add_SelectedIndexChanged({
    if ($engineReferenceList.SelectedIndex -lt 0) { return }
    $entry=$script:filteredEngineReference[$engineReferenceList.SelectedIndex]
    $heading='Engine '+$catalogue.engineReference.engineVersion+' / Control '+$catalogue.engineReference.controlVersion
    $parts=@($heading,$aui.source,$aui.protected,$aui.version,'',$entry.name,$entry.label,$entry.risk,'',$entry.hint,'',$entry.description)
    $engineReference.Text=($parts -join "`r`n") -replace '(?<!\r)\n',"`r`n"
    $engineReference.Select(0,0)
})
$engineReset=Button-At $advancedTab $ui.engineReset 618 474 180
$engineReset.Anchor='Bottom,Right'
function Show-EngineDetail($spec) {
    if (-not $spec) { return }
    $engineDetail.Text=$spec.label+' | '+$spec.risk+"`r`n"+($spec.env+$spec.flag)+"`r`n"+$spec.hint
}
function Filter-EngineOptions {
    $term=$engineSearch.Text.Trim().ToLowerInvariant()
    $group=[string]$engineGroup.SelectedItem
    $engineRows.SuspendLayout()
    try {
        foreach ($row in $script:engineOptionRows.Values) {
            $s=$row.Tag.spec
            $text=($s.label+' '+$s.env+' '+$s.flag+' '+$s.hint+' '+$s.group).ToLowerInvariant()
            $row.Visible=($engineGroup.SelectedIndex -eq 0 -or $s.group -eq $group) -and (-not $term -or $text.Contains($term))
        }
    } finally { $engineRows.ResumeLayout($true) }
    $script:filteredEngineReference=@()
    $engineReferenceList.BeginUpdate(); $engineReferenceList.Items.Clear()
    foreach ($entry in $catalogue.engineReference.entries) {
        $text=($entry.name+' '+$entry.label+' '+$entry.description+' '+$entry.hint).ToLowerInvariant()
        if ($term -and -not $text.Contains($term)) { continue }
        if ($engineGroup.SelectedIndex -gt 0 -and $entry.group -ne $group) { continue }
        $script:filteredEngineReference+=@($entry)
        $null=$engineReferenceList.Items.Add([string]$entry.name)
    }
    $engineReferenceList.EndUpdate()
    $engineReference.Text=''
    if ($engineReferenceList.Items.Count) { $engineReferenceList.SelectedIndex=0 }
}
function Layout-AdvancedPanel([double]$scale) {
    if ([math]::Abs($enginePreview.Font.Size-9*$scale) -gt 0.01) {
        $oldFont=$enginePreview.Font
        $enginePreview.Font=New-Object Drawing.Font('Consolas',([single](9*$scale)))
        $oldFont.Dispose()
    }
    $width=$advancedTab.ClientSize.Width
    $engineGroup.SetBounds([int](14*$scale),[int](12*$scale),[int](210*$scale),[int](28*$scale))
    $engineSearchLabel.SetBounds([int](236*$scale),[int](15*$scale),[int](45*$scale),[int](25*$scale))
    $engineSearch.SetBounds([int](284*$scale),[int](12*$scale),[math]::Max(60,$width-[int](302*$scale)),[int](28*$scale))
    $engineTabs.SetBounds([int](10*$scale),[int](52*$scale),[math]::Max(100,$width-[int](20*$scale)),[math]::Max(100,$advancedTab.ClientSize.Height-[int](124*$scale)))
    $engineRows.SetBounds([int](6*$scale),[int](6*$scale),[math]::Max(60,$engineEditPage.ClientSize.Width-[int](12*$scale)),[math]::Max(60,$engineEditPage.ClientSize.Height-[int](124*$scale)))
    $engineDetail.SetBounds([int](6*$scale),$engineRows.Bottom+[int](6*$scale),$engineRows.Width,[int](100*$scale))
    $refWidth=$engineReferencePage.ClientSize.Width; $refHeight=$engineReferencePage.ClientSize.Height
    $listWidth=[int]($refWidth*0.38)
    $engineReferenceList.SetBounds([int](6*$scale),[int](6*$scale),$listWidth,[math]::Max(40,$refHeight-[int](12*$scale)))
    $engineReference.SetBounds($engineReferenceList.Right+[int](8*$scale),[int](6*$scale),[math]::Max(40,$refWidth-$engineReferenceList.Right-[int](14*$scale)),[math]::Max(40,$refHeight-[int](12*$scale)))
    $rowWidth=[math]::Max(60,$engineRows.ClientSize.Width-[int](24*$scale))
    foreach ($row in $script:engineOptionRows.Values) {
        $row.Size=New-Object Drawing.Size($rowWidth,[int](64*$scale))
        $leftWidth=[int]($rowWidth*0.62); $valueX=$leftWidth+[int](8*$scale); $valueWidth=$rowWidth-$valueX-[int](8*$scale)
        $row.Tag.label.SetBounds([int](4*$scale),[int](3*$scale),$leftWidth,[int](25*$scale))
        $row.Tag.variable.SetBounds([int](4*$scale),[int](31*$scale),$leftWidth,[int](25*$scale))
        $row.Tag.choice.SetBounds($valueX,[int](4*$scale),$valueWidth,[int](28*$scale))
        $row.Tag.risk.SetBounds($valueX,[int](33*$scale),$valueWidth,[int](25*$scale))
    }
}
$engineSearch.add_TextChanged({ Filter-EngineOptions })
$engineGroup.add_SelectedIndexChanged({ Filter-EngineOptions })
$engineTabs.add_SelectedIndexChanged({ Layout-AdvancedPanel (Panel-Scale) })
Filter-EngineOptions
