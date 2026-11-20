if (-not $ScreenshotDirectory) { $ScreenshotDirectory=Join-Path $root 'logs/strata-panel-tests/advanced' }
[void][IO.Directory]::CreateDirectory($ScreenshotDirectory)
$windowsDpi=$form.DeviceDpi
$testFontFamily=$form.Font.FontFamily.Name

function Assert-PanelLayout([string]$name, [object[]]$containers) {
    $errors=@(Layout-Errors $containers)
    if ($errors.Count) {
        $bounds=foreach ($container in $containers) {
            if (@(Layout-Errors @($container)).Count -eq 0) { continue }
            $container.GetType().Name+'/'+$container.Name+' '+$container.ClientSize
            foreach ($control in $container.Controls) { '  '+$control.Name+' '+$control.Bounds }
        }
        throw ($name+': '+(($errors+$bounds) -join '; '))
    }
}

function Select-EnginePage($page) {
    $engineTabs.SelectedTab=$page
    [Windows.Forms.Application]::DoEvents()
}

function Test-AdvancedPages([string]$name, [switch]$capture) {
    Select-EnginePage $engineEditPage
    $tabs.SelectedTab=$advancedTab
    [Windows.Forms.Application]::DoEvents()
    Assert-PanelLayout $name @($form,$header,$actionBar,$advancedTab,$engineBody,$engineToolbar,$engineActions,$engineEditPage,$engineEdit)
    if (-not $engineRows.Visible -or $engineRows.Width -lt 350 -or $engineRows.Height -lt 100 -or
            $engineRows.HorizontalScroll.Visible -or -not $engineRows.VerticalScroll.Visible) {
        throw ($name+': invalid advanced scroll area on selection')
    }
    foreach ($row in $script:engineOptionRows.Values) {
        if (-not $row.Visible -or $row.Width -gt $engineRows.ClientSize.Width) {
            throw ($name+': row hidden or clipped: '+$row.Tag.spec.key)
        }
        Assert-PanelLayout ($name+'/'+$row.Tag.spec.key) @($row)
    }
    if ($capture) { Save-WindowImage $form (Join-Path $ScreenshotDirectory ('advanced-'+$name+'.png')) }
    Select-EnginePage $enginePreviewPage
    Assert-PanelLayout ($name+'/preview') @($enginePreviewPage)
    if (-not $enginePreview.Visible -or $enginePreview.Width -lt 350 -or -not $enginePreview.ReadOnly) {
        throw ($name+': invalid next-launch preview')
    }
    Select-EnginePage $engineReferencePage
    Assert-PanelLayout ($name+'/reference') @($engineReferencePage,$engineReferenceLayout)
    if (-not $engineReference.Visible -or $engineReferenceList.Items.Count -eq 0 -or $engineReference.Width -lt $engineReferenceList.Width) {
        throw ($name+': invalid engine reference layout')
    }
    if ($capture -and $name -eq 'first') { Save-WindowImage $form (Join-Path $ScreenshotDirectory 'reference-first.png') }
}

$tabs.SelectedTab=$modelTab
$form.Show()
[Windows.Forms.Application]::DoEvents()
Assert-PanelLayout 'model/first' @($form,$header,$actionBar,$modelTab)
Save-WindowImage $form (Join-Path $ScreenshotDirectory 'model-first.png')
# No manual layout, size change or second visit before checking the initial tab selection.
Test-AdvancedPages 'first' -capture

Select-EnginePage $engineEditPage
$engineSearch.Text='route_prior'
[Windows.Forms.Application]::DoEvents()
$visibleRows=@($script:engineOptionRows.Values | Where-Object { $_.Visible })
if ($visibleRows.Count -ne 1 -or $visibleRows[0].Tag.spec.key -ne 'routePrior') {
    throw 'Advanced engine filtering did not select only routePrior'
}
try {
    $previousOptions=Get-EngineOptions
    $choice=$script:engineOptionControls.routePrior
    $choice.SelectedIndex=[array]::IndexOf(@($choice.Tag.values),'off')
    if ((Get-EngineOptions).routePrior -ne 'off' -or $enginePreview.Text -notmatch '(?m)^STRATA_ROUTE_PRIOR=0\r?$') {
        throw 'Advanced engine choice did not reach the next-launch preview'
    }
} finally { Restore-EngineOptions $previousOptions; $engineSearch.Clear() }

$originalFont=$form.Font
$previousScale=1.0
foreach ($scale in @(1.25,1.5,2.0,1.0)) {
    $tabs.SelectedTab=$modelTab
    $script:scalingPanel=$true
    try {
        # Synthetic resize and font scale on one monitor; no system DPI change.
        $form.Scale([Drawing.SizeF]::new(($scale/$previousScale),($scale/$previousScale)))
        $form.Font=[Drawing.Font]::new($testFontFamily,([single]($originalFont.Size*$scale)))
    } finally { $script:scalingPanel=$false }
    Layout-Panel
    [Windows.Forms.Application]::DoEvents()
    $name='scaled-'+[int]($scale*100)
    Assert-PanelLayout ('model/'+$name) @($form,$header,$actionBar,$modelTab)
    Test-AdvancedPages $name -capture:($scale -eq 1.5)
    $previousScale=$scale
}
Write-Output ('ADVANCED_UI_SELF_TEST_OK display_dpi='+$windowsDpi+' simulated_scales=125,150,200,100')
