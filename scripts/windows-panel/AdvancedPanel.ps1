$aui=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'AdvancedPanel.zh-CN.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:engineOptionControls=@{}
$script:engineOptionRows=@{}
$engineBody=New-Object Windows.Forms.TableLayoutPanel
$engineBody.Name='engine-body'; $engineBody.Dock='Fill'
$engineBody.ColumnCount=1; $engineBody.RowCount=3
[void]$engineBody.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new('Percent',100))
[void]$engineBody.RowStyles.Add([Windows.Forms.RowStyle]::new('Absolute',40))
[void]$engineBody.RowStyles.Add([Windows.Forms.RowStyle]::new('Percent',100))
[void]$engineBody.RowStyles.Add([Windows.Forms.RowStyle]::new('Absolute',43))
$advancedTab.Controls.Add($engineBody)
$engineToolbar=New-Object Windows.Forms.Panel
$engineToolbar.Name='engine-toolbar'; $engineToolbar.Dock='Fill'; $engineToolbar.Margin=[Windows.Forms.Padding]::Empty
$engineBody.Controls.Add($engineToolbar,0,0)
$engineGroup=Combo-At $engineToolbar 0 3 210 @($aui.all)
foreach ($group in @($catalogue.engineOptionSpecs | ForEach-Object { $_.group } | Select-Object -Unique)) { $null=$engineGroup.Items.Add($group) }
$engineSearchLabel=Label-At $engineToolbar $aui.filter 224 6 45
$engineSearch=New-Object Windows.Forms.TextBox
$engineSearch.Name='engine-search'
$engineToolbar.Controls.Add($engineSearch)
$engineTabs=New-Object Windows.Forms.TabControl
$engineTabs.Name='engine-tabs'; $engineTabs.Dock='Fill'; $engineTabs.Margin=[Windows.Forms.Padding]::Empty
$engineBody.Controls.Add($engineTabs,0,1)
$engineEditPage=New-Object Windows.Forms.TabPage; $engineEditPage.Text=$aui.edit
$enginePreviewPage=New-Object Windows.Forms.TabPage; $enginePreviewPage.Text=$aui.preview
$engineReferencePage=New-Object Windows.Forms.TabPage; $engineReferencePage.Text=$aui.reference
$engineTabs.TabPages.AddRange(@($engineEditPage,$enginePreviewPage,$engineReferencePage))
$engineEdit=New-Object Windows.Forms.TableLayoutPanel
$engineEdit.Name='engine-edit'; $engineEdit.Dock='Fill'
$engineEdit.ColumnCount=1; $engineEdit.RowCount=2
[void]$engineEdit.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new('Percent',100))
[void]$engineEdit.RowStyles.Add([Windows.Forms.RowStyle]::new('Percent',100))
[void]$engineEdit.RowStyles.Add([Windows.Forms.RowStyle]::new('Absolute',94))
$engineEditPage.Controls.Add($engineEdit)
$engineRows=New-Object Windows.Forms.FlowLayoutPanel
$engineRows.Name='engine-rows'; $engineRows.Dock='Fill'; $engineRows.Margin=[Windows.Forms.Padding]::Empty
$engineRows.FlowDirection='TopDown'; $engineRows.WrapContents=$false; $engineRows.AutoScroll=$true
$engineEdit.Controls.Add($engineRows,0,0)
$engineDetail=New-Object Windows.Forms.TextBox
$engineDetail.Name='engine-detail'; $engineDetail.Dock='Fill'
$engineDetail.ReadOnly=$true; $engineDetail.Multiline=$true; $engineDetail.ScrollBars='Vertical'
$engineDetail.TabStop=$false
$engineDetail.Text=$aui.notice
$engineEdit.Controls.Add($engineDetail,0,1)
if (-not $script:panelHighContrast) {
    $engineDetail.BackColor=$panelColors.background
    $engineDetail.ForeColor=$panelColors.ink
    $engineSearchLabel.ForeColor=$panelColors.muted
}
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
    $label.AutoEllipsis=$true; $variable.AutoEllipsis=$true; $risk.AutoEllipsis=$true
    if (-not $script:panelHighContrast) {
        $row.BackColor=$panelColors.background
        $variable.ForeColor=$panelColors.muted; $risk.ForeColor=$panelColors.muted
    }
    $row.Tag=@{spec=$s;label=$label;variable=$variable;choice=$c;risk=$risk}
    $c.add_Enter({ param($sender,$eventArgs) Show-EngineDetail $sender.Tag })
    $c.add_SelectedIndexChanged({ param($sender,$eventArgs) if ($sender.Focused) { Show-EngineDetail $sender.Tag } })
    $script:engineOptionControls[$key]=$c; $script:engineOptionRows[$key]=$row
    $engineRows.Controls.Add($row)
}
$enginePreview=New-Object Windows.Forms.TextBox
$enginePreview.Name='engine-preview'; $enginePreview.ReadOnly=$true; $enginePreview.Multiline=$true
$enginePreview.WordWrap=$false; $enginePreview.ScrollBars='Both'; $enginePreview.Dock='Fill'
$enginePreview.TabStop=$false
$enginePreview.add_Enter({ $enginePreview.Select(0,0) })
$enginePreview.Font=New-Object Drawing.Font('Consolas',9); $enginePreviewPage.Controls.Add($enginePreview)
$engineReferenceLayout=New-Object Windows.Forms.TableLayoutPanel
$engineReferenceLayout.Name='engine-reference-layout'; $engineReferenceLayout.Dock='Fill'
$engineReferenceLayout.ColumnCount=2; $engineReferenceLayout.RowCount=1
[void]$engineReferenceLayout.RowStyles.Add([Windows.Forms.RowStyle]::new('Percent',100))
[void]$engineReferenceLayout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new('Percent',38))
[void]$engineReferenceLayout.ColumnStyles.Add([Windows.Forms.ColumnStyle]::new('Percent',62))
$engineReferencePage.Controls.Add($engineReferenceLayout)
$engineReference=New-Object Windows.Forms.TextBox
$engineReference.Name='engine-reference'; $engineReference.Dock='Fill'
$engineReference.ReadOnly=$true; $engineReference.Multiline=$true; $engineReference.ScrollBars='Vertical'
$engineReference.WordWrap=$true; $engineReference.TabStop=$false
$engineReferenceLayout.Controls.Add($engineReference,1,0)
$engineReferenceList=New-Object Windows.Forms.ListBox
$engineReferenceList.Name='engine-reference-list'; $engineReferenceList.Dock='Fill'
$engineReferenceList.HorizontalScrollbar=$true; $engineReferenceList.IntegralHeight=$false
$engineReferenceLayout.Controls.Add($engineReferenceList,0,0)
$engineReferenceList.add_SelectedIndexChanged({
    if ($engineReferenceList.SelectedIndex -lt 0) { return }
    $entry=$script:filteredEngineReference[$engineReferenceList.SelectedIndex]
    $heading='Engine '+$catalogue.engineReference.engineVersion+' / Control '+$catalogue.engineReference.controlVersion
    $parts=@($heading,$aui.source,$aui.protected,$aui.version,'',$entry.name,$entry.label,$entry.risk,'',$entry.hint,'',$entry.description)
    $engineReference.Text=($parts -join "`r`n") -replace '(?<!\r)\n',"`r`n"
    $engineReference.Select(0,0)
})
$engineActions=New-Object Windows.Forms.Panel
$engineActions.Name='engine-actions'; $engineActions.Dock='Fill'; $engineActions.Margin=[Windows.Forms.Padding]::Empty
$engineBody.Controls.Add($engineActions,0,2)
$engineReset=Button-At $engineActions $ui.engineReset 0 8 180
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
function Layout-EngineChrome([double]$scale) {
    $engineGroup.SetBounds(0,[int](3*$scale),[int](210*$scale),[int](28*$scale))
    $engineSearchLabel.SetBounds([int](224*$scale),[int](6*$scale),[int](46*$scale),[int](25*$scale))
    $searchX=[int](272*$scale)
    $engineSearch.SetBounds($searchX,[int](3*$scale),[math]::Max(0,$engineToolbar.ClientSize.Width-$searchX),[int](28*$scale))
    $resetWidth=[int](180*$scale)
    $engineReset.SetBounds([math]::Max(0,$engineActions.ClientSize.Width-$resetWidth),[int](8*$scale),$resetWidth,[int](32*$scale))
}
function Resize-EngineRows([double]$scale) {
    if ($script:resizingEngineRows -or $script:scalingPanel -or -not $engineRows.Visible) { return }
    # Use the window size, not the display rectangle (whose origin moves when scrolled).
    $scrollWidth=[math]::Max([Windows.Forms.SystemInformation]::VerticalScrollBarWidth,[int](18*$scale))
    $rowWidth=$engineRows.Width-$scrollWidth-[int](4*$scale)
    if ($rowWidth -lt [int](100*$scale)) { return }
    $script:resizingEngineRows=$true
    $engineRows.SuspendLayout()
    try {
        foreach ($row in $script:engineOptionRows.Values) {
            $row.Size=[Drawing.Size]::new($rowWidth,[int](64*$scale))
            $row.Margin=[Windows.Forms.Padding]::new(0,0,0,[int](5*$scale))
            $leftWidth=[int]($rowWidth*0.60); $valueX=$leftWidth+[int](16*$scale)
            $valueWidth=$rowWidth-$valueX-[int](10*$scale)
            $row.Tag.label.SetBounds([int](10*$scale),[int](4*$scale),$leftWidth,[int](26*$scale))
            $row.Tag.variable.SetBounds([int](10*$scale),[int](33*$scale),$leftWidth,[int](24*$scale))
            $row.Tag.choice.SetBounds($valueX,[int](5*$scale),$valueWidth,[int](26*$scale))
            $row.Tag.risk.SetBounds($valueX,[int](33*$scale),$valueWidth,[int](24*$scale))
        }
    } finally {
        try { $engineRows.ResumeLayout($true) } finally { $script:resizingEngineRows=$false }
    }
}
function Layout-AdvancedPanel([double]$scale) {
    $engineBody.Padding=[Windows.Forms.Padding]::new([int](12*$scale),[int](10*$scale),[int](12*$scale),[int](8*$scale))
    $engineBody.RowStyles[0].Height=[single](40*$scale)
    $engineBody.RowStyles[2].Height=[single](43*$scale)
    $engineEdit.Padding=[Windows.Forms.Padding]::new([int](8*$scale))
    $engineEdit.RowStyles[1].Height=[single](94*$scale)
    $engineDetail.Margin=[Windows.Forms.Padding]::new(0,[int](8*$scale),0,0)
    $engineReferenceLayout.Padding=[Windows.Forms.Padding]::new([int](6*$scale))
    $enginePreviewPage.Padding=[Windows.Forms.Padding]::new([int](8*$scale))
    if ([math]::Abs($enginePreview.Font.Size-$form.Font.Size) -gt 0.01) {
        $oldFont=$enginePreview.Font
        $enginePreview.Font=[Drawing.Font]::new('Consolas',$form.Font.Size)
        $oldFont.Dispose()
    }
    Layout-EngineChrome $scale
    Resize-EngineRows $scale
}
$engineSearch.add_TextChanged({ Filter-EngineOptions })
$engineGroup.add_SelectedIndexChanged({ Filter-EngineOptions })
$engineToolbar.add_ClientSizeChanged({ if (-not $script:scalingPanel) { Layout-EngineChrome (Panel-Scale) } })
$engineActions.add_ClientSizeChanged({ if (-not $script:scalingPanel) { Layout-EngineChrome (Panel-Scale) } })
$engineRows.add_ClientSizeChanged({ Resize-EngineRows (Panel-Scale) })
$engineRows.add_VisibleChanged({ Resize-EngineRows (Panel-Scale) })
Filter-EngineOptions
