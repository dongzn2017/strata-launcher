param([switch]$SelfTest, [string]$ScreenshotDirectory, [switch]$LanSelfTest, [switch]$ResourceSelfTest, [switch]$DraftSelfTest, [switch]$AdvancedSelfTest)
if ($LanSelfTest -or $ResourceSelfTest -or $DraftSelfTest -or $AdvancedSelfTest) { $SelfTest=$true }
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$node = (Get-Command node.exe -ErrorAction Stop).Source
$cli = Join-Path $PSScriptRoot 'cli.mjs'
$stateRoot = Join-Path $root 'runtime/strata-launcher'
$ui = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ui.zh-CN.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type @'
using System;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;
public static class PanelProcess {
  public static string Quote(string s) {
    return "\"" + Regex.Replace(Regex.Replace(s, "(\\\\*)\"", "$1$1\\\""), "(\\\\+)$", "$1$1") + "\"";
  }
  public static Process Start(string file, string[] args, bool hidden, string cwd, bool capture) {
    var p = new Process();
    p.StartInfo = new ProcessStartInfo(file, String.Join(" ", args.Select(Quote))) {
      UseShellExecute=false, CreateNoWindow=hidden, WorkingDirectory=cwd,
      RedirectStandardOutput=capture, RedirectStandardError=capture
    };
    if(capture) {
      p.StartInfo.StandardOutputEncoding = new System.Text.UTF8Encoding(false);
      p.StartInfo.StandardErrorEncoding = new System.Text.UTF8Encoding(false);
    }
    if(String.Equals(System.IO.Path.GetFileName(file), "python.exe", StringComparison.OrdinalIgnoreCase)) {
      p.StartInfo.EnvironmentVariables["PYTHONUTF8"] = "1";
      p.StartInfo.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
    }
    p.Start(); return p;
  }
}
'@
function Node-Call([string]$Command, $Object = $null) {
    $inputFile = $null
    try {
        $arguments = @($cli, $Command)
        if ($null -ne $Object) {
            [IO.Directory]::CreateDirectory($stateRoot) | Out-Null
            $inputFile = Join-Path $stateRoot (([guid]::NewGuid().ToString()) + '.request.json')
            [IO.File]::WriteAllText($inputFile, ($Object | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))
            $arguments += $inputFile
        }
        $p = [PanelProcess]::Start($node, [string[]]$arguments, $true, $root, $true)
        $stdout = $p.StandardOutput.ReadToEndAsync()
        $stderr = $p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit(15000)) { $p.Kill(); throw 'Panel helper timed out; no retry was submitted' }
        $text = $stdout.GetAwaiter().GetResult()
        $errorText = $stderr.GetAwaiter().GetResult()
        if ($p.ExitCode -ne 0) { throw $errorText.Trim() }
        return $text | ConvertFrom-Json
    } finally { if ($inputFile -and (Test-Path -LiteralPath $inputFile)) { Remove-Item -LiteralPath $inputFile } }
}
$catalogue = Node-Call 'catalogue'
$script:run = $null
$script:runner = $null
$script:service = $null
$script:poll = $null
$script:pollStarted = 0
$script:ownedStatus = $null
$script:runnerError = $null
$script:runnerOutput = $null
$script:reportedExit = $null
$script:allowClose = $false
$font = New-Object Drawing.Font('Microsoft YaHei UI', 9)
$script:panelHighContrast=[Windows.Forms.SystemInformation]::HighContrast
$panelColors=@{
    background=[Drawing.Color]::FromArgb(241,245,247)
    surface=[Drawing.Color]::White
    ink=[Drawing.Color]::FromArgb(25,42,50)
    muted=[Drawing.Color]::FromArgb(69,89,99)
    border=[Drawing.Color]::FromArgb(208,219,224)
    accent=[Drawing.Color]::FromArgb(18,103,92)
    danger=[Drawing.Color]::FromArgb(153,52,42)
}
function Label-At($parent, [string]$text, [int]$x, [int]$y, [int]$width = 180) {
    $c = New-Object Windows.Forms.Label
    $c.Text = $text; $c.Location = New-Object Drawing.Point($x, $y); $c.Size = New-Object Drawing.Size($width, 25)
    $parent.Controls.Add($c); return $c
}
function Button-At($parent, [string]$text, [int]$x, [int]$y, [int]$width = 120) {
    $c = New-Object Windows.Forms.Button
    $c.Text = $text; $c.Location = New-Object Drawing.Point($x, $y); $c.Size = New-Object Drawing.Size($width, 32)
    if (-not $script:panelHighContrast) {
        $c.FlatStyle='Flat'; $c.BackColor=$panelColors.surface; $c.ForeColor=$panelColors.ink
        $c.FlatAppearance.BorderColor=$panelColors.border
        $c.FlatAppearance.MouseOverBackColor=$panelColors.background
    }
    $parent.Controls.Add($c); return $c
}
function Combo-At($parent, [int]$x, [int]$y, [int]$width, [object[]]$items) {
    $c = New-Object Windows.Forms.ComboBox
    $c.DropDownStyle = 'DropDownList'; $c.Location = New-Object Drawing.Point($x, $y); $c.Width = $width
    $c.Items.AddRange($items); $c.SelectedIndex = 0; $parent.Controls.Add($c); return $c
}
function Message-Error($e) { [Windows.Forms.MessageBox]::Show([string]$e, $ui.error, 'OK', 'Warning') | Out-Null }
function Open-PanelJsonReader([string]$file) {
    $sharing=[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,$sharing)
    try { return New-Object IO.StreamReader($stream, (New-Object Text.UTF8Encoding($false)), $true) }
    catch { $stream.Dispose(); throw }
}
function Read-PanelJson([string]$file) {
    $reader=$null
    try {
        $reader=Open-PanelJsonReader $file
        return $reader.ReadToEnd() | ConvertFrom-Json
    } finally { if ($reader) { $reader.Dispose() } }
}
$form = New-Object Windows.Forms.Form
$form.SuspendLayout()
$form.AutoScaleMode = 'None'
$form.Text = $ui.title; $form.Font = $font; $form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object Drawing.Size(860, 764)
$form.MinimumSize = New-Object Drawing.Size(880, 804)
if (-not $script:panelHighContrast) {
    $form.BackColor=$panelColors.background; $form.ForeColor=$panelColors.ink
}
$header=New-Object Windows.Forms.Panel
$header.Name='launcher-header'
$header.Size=New-Object Drawing.Size(860,76)
$form.Controls.Add($header)
$brand=Label-At $header 'Strata Launcher' 18 9 320
$brand.Font=New-Object Drawing.Font($font.FontFamily,[single]14,[Drawing.FontStyle]::Bold)
$runtimeTag=Label-At $header '' 400 13 440
$runtimeTag.TextAlign='MiddleRight'; $runtimeTag.AutoEllipsis=$true
if (-not $script:panelHighContrast) {
    $header.BackColor=$panelColors.surface; $runtimeTag.ForeColor=$panelColors.muted
}
$tabs = New-Object Windows.Forms.TabControl
$tabs.Location = New-Object Drawing.Point(12, 84); $tabs.Size = New-Object Drawing.Size(836, 542)
$tabs.Anchor = 'Top,Bottom,Left,Right'; $form.Controls.Add($tabs)
$modelTab = New-Object Windows.Forms.TabPage; $modelTab.Text = $ui.qwenPage
$advancedTab = New-Object Windows.Forms.TabPage; $advancedTab.Text = $ui.advanced
$piTab = New-Object Windows.Forms.TabPage; $piTab.Text = $ui.pi
$learningTab = New-Object Windows.Forms.TabPage; $learningTab.Text = $ui.learning
$samplingTab = New-Object Windows.Forms.TabPage; $samplingTab.Text = $ui.sampling
$deepseekTab = New-Object Windows.Forms.TabPage; $deepseekTab.Text = 'DeepSeek'
$helpTab = New-Object Windows.Forms.TabPage; $helpTab.Text = $ui.parameterHelp
$lanTab = New-Object Windows.Forms.TabPage; $lanTab.Text = $ui.lanPage
$resourceTab = New-Object Windows.Forms.TabPage; $resourceTab.Text = $ui.resourcePage
$draftTab = New-Object Windows.Forms.TabPage; $draftTab.Text = 'DFlash2'
$tabs.TabPages.AddRange(@($modelTab, $deepseekTab, $draftTab, $advancedTab, $piTab, $learningTab, $samplingTab, $helpTab, $lanTab, $resourceTab))
$tabs.Multiline=$true
$draftTab.Size=$tabs.DisplayRectangle.Size
$lanTab.Size=$tabs.DisplayRectangle.Size
$resourceTab.Size=$tabs.DisplayRectangle.Size
. (Join-Path $PSScriptRoot 'LanPanel.ps1')
. (Join-Path $PSScriptRoot 'ResourcePanel.ps1')
$modelTab.Size = $tabs.DisplayRectangle.Size
$advancedTab.Size = $tabs.DisplayRectangle.Size
$piTab.Size = $tabs.DisplayRectangle.Size
$learningTab.Size = $tabs.DisplayRectangle.Size
$samplingTab.Size = $tabs.DisplayRectangle.Size
$deepseekTab.Size = $tabs.DisplayRectangle.Size
$helpTab.Size = $tabs.DisplayRectangle.Size
$presetLabel=Label-At $header $ui.preset 18 43 139
$profiles = @($catalogue.profiles | Where-Object { $_.available })
if ($profiles.Count -eq 0) { throw 'No installed Strata model profiles available' }
$preset = Combo-At $header 160 41 680 @($profiles | ForEach-Object { $_.label })
$script:controls = @{}
$script:modelLabels = @{}
$specs = @(
    @('context',32768,262144,1024), @('kv',@('int8','k8v4')),
    @('kvResident',4096,262144,4096), @('expertGiB',8,50,0.5),
    @('headroomGiB',6,24,0.5), @('vramMiB',0,4096,100),
    @('output',1024,32768,1024), @('thinking',0,24576,1024),
    @('effort',@('off','low','medium','high')), @('workers',1,12,1),
    @('spec',0,8,1), @('specMinP',0,1,0.05),
    @('port',1024,65535,1), @('visionThreads',1,12,1), @('imageTokens',64,1024,32),
    @('drafting',@('mtp','dflash2'))
)
foreach ($s in $specs) {
    $key = $s[0]
    $x = 18; $y = 30
    $script:modelLabels[$key] = Label-At $modelTab $ui.$key $x $y 190
    if ($s.Count -eq 2) { $c = Combo-At $modelTab ($x+195) ($y-2) 180 $s[1] }
    else {
        $c = New-Object Windows.Forms.NumericUpDown
        $c.Minimum = $s[1]; $c.Maximum = $s[2]; $c.Increment = $s[3]
        if ($s[3] -lt 1) { $c.DecimalPlaces = 2 }
        $c.Location = New-Object Drawing.Point(($x+195), ($y-2)); $c.Size = New-Object Drawing.Size(180, 26)
        $c.ThousandsSeparator = $key -ne 'port'; $modelTab.Controls.Add($c)
    }
    $script:controls[$key] = $c
}
$modelSections=@(
    @{title=$ui.modelContextGroup; keys=@('context','kv','kvResident','port')},
    @{title=$ui.modelResourceGroup; keys=@('expertGiB','headroomGiB','vramMiB','workers')},
    @{title=$ui.modelGenerationGroup; keys=@('output','thinking','effort','drafting')},
    @{title=$ui.modelVisionGroup; keys=@('spec','specMinP','visionThreads','imageTokens')}
)
foreach ($section in $modelSections) {
    $section.heading=Label-At $modelTab $section.title 18 12 375
    $section.heading.Font=New-Object Drawing.Font($font.FontFamily,[single]10,[Drawing.FontStyle]::Bold)
    if (-not $script:panelHighContrast) { $section.heading.ForeColor=$panelColors.accent }
}
. (Join-Path $PSScriptRoot 'DraftPanel.ps1')
$script:deepseekControls = @{}
$dsTabs=New-Object Windows.Forms.TabControl
$dsTabs.Location=New-Object Drawing.Point(10,12); $dsTabs.Size=New-Object Drawing.Size(808,490)
$dsTabs.Anchor='Top,Left'; $deepseekTab.Controls.Add($dsTabs)
$dsPageDefinitions=@(
    @{id='context';title=$ui.dsContextPage;keys=@('context','output','thinking','effort','port','vramMiB')},
    @{id='memory';title=$ui.dsMemoryPage;keys=@('ssdCacheGB','activeExperts','ssdPolicy','workers','storeThreads','storeFloorGiB')},
    @{id='engram';title=$ui.dsEngramPage;keys=@('engramCacheMiB','engramThreads','prefillChunk')}
)
$dsSpecs=@{}
foreach ($s in $specs) { $dsSpecs[$s[0]]=$s }
$dsSpecs.context=@('context',8192,1048576,1024)
$dsSpecs.ssdCacheGB=@('ssdCacheGB',8,55,0.5)
$dsSpecs.activeExperts=@('activeExperts',5,6,1)
$dsSpecs.ssdPolicy=@('ssdPolicy',@('default','lru','lfu','lfulru'))
foreach ($s in $catalogue.deepseekOptionSpecs) { $dsSpecs[[string]$s.key]=@([string]$s.key,@($s.values)) }
$script:dsPages=@{}; $script:dsHelpBoxes=@{}
foreach ($definition in $dsPageDefinitions) {
    $page=New-Object Windows.Forms.TabPage; $page.Text=$definition.title
    $dsTabs.TabPages.Add($page); $page.Size=$dsTabs.DisplayRectangle.Size
    $script:dsPages[$definition.id]=$page
    for ($i=0; $i -lt $definition.keys.Count; $i++) {
        $key=$definition.keys[$i]; $s=$dsSpecs[$key]; $x=14+393*($i % 2); $y=22+74*[math]::Floor($i/2)
        $entry=$ui.parameterDescriptions.('ds_'+$key)
        $label=Label-At $page ($entry.label -replace '^DeepSeek\s+\S+\s+','') $x $y 185
        $label.Name='ds-label-'+$key
        if ($s.Count -eq 2) { $c=Combo-At $page ($x+188) ($y-2) 180 $s[1] }
        else {
            $c=New-Object Windows.Forms.NumericUpDown
            $c.Minimum=$s[1]; $c.Maximum=$s[2]; $c.Increment=$s[3]
            if ($s[3] -lt 1) { $c.DecimalPlaces=1 }
            $c.ThousandsSeparator=$key -ne 'port'
            $c.Location=New-Object Drawing.Point(($x+188),($y-2)); $c.Size=New-Object Drawing.Size(180,26)
            $page.Controls.Add($c)
        }
        $c.Name='ds-'+$key; $c.Tag='ds_'+$key
        $script:deepseekControls[$key]=$c
    }
    if ($definition.id -eq 'engram') {
        $fixed=Label-At $page $ui.dsFixedCapabilities 14 174 764
        $fixed.Height=62
    }
    $box=New-Object Windows.Forms.TextBox
    $box.Name='ds-help-'+$definition.id
    $box.ReadOnly=$true; $box.Multiline=$true; $box.WordWrap=$true; $box.ScrollBars='Vertical'
    $box.Location=New-Object Drawing.Point(14,254); $box.Size=New-Object Drawing.Size(764,185)
    $box.Anchor='Top,Left'; $box.TabStop=$false
    $entry=$ui.parameterDescriptions.('ds_'+$definition.keys[0])
    $box.Text=$entry.label+"`r`n"+$entry.body
    $page.Controls.Add($box); $script:dsHelpBoxes[$definition.id]=$box
}
$dsPiPage=New-Object Windows.Forms.TabPage; $dsPiPage.Text=$ui.dsPiPage
$dsTabs.TabPages.Add($dsPiPage); $dsPiPage.Size=$dsTabs.DisplayRectangle.Size
$script:dsPages.pi=$dsPiPage
$dsPiTitle=Label-At $dsPiPage $ui.dsPiTitle 16 22 730
$dsPiTitle.Name='ds-pi-title'
$dsPiSummary=New-Object Windows.Forms.TextBox
$dsPiSummary.Name='ds-pi-summary'; $dsPiSummary.ReadOnly=$true
$dsPiSummary.Multiline=$true; $dsPiSummary.WordWrap=$true; $dsPiSummary.ScrollBars='Vertical'
$dsPiSummary.Location=New-Object Drawing.Point(16,64); $dsPiSummary.Size=New-Object Drawing.Size(750,210)
$dsPiSummary.Anchor='Top,Left,Right'; $dsPiSummary.TabStop=$false; $dsPiPage.Controls.Add($dsPiSummary)
$dsModelStart=Button-At $dsPiPage $ui.dsStart 16 300 210
$dsPiOpen=Button-At $dsPiPage $ui.dsOpenPi 250 300 210
$dsPiSettings=Button-At $dsPiPage $ui.dsPiSettings 484 300 210
$dsPiOpen.Enabled=$false
$helpKeys=@($ui.parameterDescriptions.PSObject.Properties | ForEach-Object { $_.Name })
$helpList=New-Object Windows.Forms.ListBox
$helpList.Location=New-Object Drawing.Point(18,20); $helpList.Size=New-Object Drawing.Size(252,484)
$helpList.Anchor='Top,Bottom,Left'; $helpTab.Controls.Add($helpList)
foreach ($key in $helpKeys) { $null=$helpList.Items.Add($ui.parameterDescriptions.$key.label) }
$helpText=New-Object Windows.Forms.TextBox
$helpText.ReadOnly=$true; $helpText.Multiline=$true; $helpText.WordWrap=$true; $helpText.ScrollBars='Vertical'
$helpText.Location=New-Object Drawing.Point(286,20); $helpText.Size=New-Object Drawing.Size(512,484)
$helpText.Anchor='Top,Bottom,Left,Right'; $helpTab.Controls.Add($helpText)
$helpList.add_SelectedIndexChanged({
    $entry=$ui.parameterDescriptions.($helpKeys[$helpList.SelectedIndex])
    $helpText.Text=$entry.label+"`r`n`r`n"+$entry.body
})
$helpList.SelectedIndex=0
$deployment = $catalogue.deployment
$runtimeTag.Text='Control '+$deployment.control_version+'  /  Engine '+$deployment.engine_package_version
. (Join-Path $PSScriptRoot 'AdvancedPanel.ps1')
$samplingCustom = New-Object Windows.Forms.CheckBox
$samplingCustom.Text=$ui.samplingCustom; $samplingCustom.Checked=$false
$samplingCustom.Location=New-Object Drawing.Point(18,20); $samplingCustom.Size=New-Object Drawing.Size(350,30)
$samplingTab.Controls.Add($samplingCustom)
$sampling07 = Button-At $samplingTab $ui.sampling07 423 16 180
$samplingModel = Button-At $samplingTab $ui.samplingModel 618 16 180
$script:samplingControls=@{}
for ($i=0; $i -lt $catalogue.samplingSpecs.Count; $i++) {
    $s=$catalogue.samplingSpecs[$i]; $key=[string]$s[0]
    $x=18+405*($i % 2); $y=92+66*[math]::Floor($i/2)
    $label=Label-At $samplingTab $ui.('sample_'+$key) $x $y 190
    $label.Name='sampling-label-'+$key
    $c=New-Object Windows.Forms.NumericUpDown
    $c.Name='sampling-'+$key
    $c.Minimum=[decimal]$s[1]; $c.Maximum=[decimal]$s[2]; $c.Increment=[decimal]$s[3]; $c.DecimalPlaces=[int]$s[4]
    $c.Location=New-Object Drawing.Point(($x+195),($y-2)); $c.Size=New-Object Drawing.Size(180,26)
    $c.ThousandsSeparator=$false
    $samplingTab.Controls.Add($c); $script:samplingControls[$key]=$c
}
$samplingFixedSeed=New-Object Windows.Forms.CheckBox
$samplingFixedSeed.Text=$ui.samplingFixedSeed; $samplingFixedSeed.Checked=$false
$samplingFixedSeed.Location=New-Object Drawing.Point(18,370); $samplingFixedSeed.Size=New-Object Drawing.Size(190,30)
$samplingTab.Controls.Add($samplingFixedSeed)
$samplingSeed=New-Object Windows.Forms.NumericUpDown
$samplingSeed.Minimum=1; $samplingSeed.Maximum=2147483647; $samplingSeed.Value=42
$samplingSeed.Location=New-Object Drawing.Point(213,370); $samplingSeed.Size=New-Object Drawing.Size(180,26)
$samplingTab.Controls.Add($samplingSeed)
$learnEnabled = New-Object Windows.Forms.CheckBox
$learnEnabled.Text=$ui.learnEnabled; $learnEnabled.Checked=$true
$learnEnabled.Location=New-Object Drawing.Point(18,22); $learnEnabled.Size=New-Object Drawing.Size(380,30)
$learningTab.Controls.Add($learnEnabled)
$learnReuse = New-Object Windows.Forms.CheckBox
$learnReuse.Text=$ui.learnReuse; $learnReuse.Checked=$true
$learnReuse.Location=New-Object Drawing.Point(423,22); $learnReuse.Size=New-Object Drawing.Size(375,30)
$learningTab.Controls.Add($learnReuse)
$null = Label-At $learningTab $ui.learnScope 18 85 190
$scopeNames=@('general','video','coding')
$learnScope=Combo-At $learningTab 213 82 180 @($ui.scopeGeneral,$ui.scopeVideo,$ui.scopeCoding)
$null = Label-At $learningTab $ui.learnInterval 423 85 190
$learnInterval = New-Object Windows.Forms.NumericUpDown
$learnInterval.Minimum=1; $learnInterval.Maximum=60; $learnInterval.Value=5
$learnInterval.Location=New-Object Drawing.Point(618,82); $learnInterval.Size=New-Object Drawing.Size(180,26)
$learningTab.Controls.Add($learnInterval)
$null = Label-At $learningTab $ui.learnPath 18 145 780
$learnPath = New-Object Windows.Forms.TextBox
$learnPath.ReadOnly=$true; $learnPath.Multiline=$true; $learnPath.WordWrap=$true
$learnPath.Text=Join-Path $stateRoot 'learning'
$learnPath.Location=New-Object Drawing.Point(18,175); $learnPath.Size=New-Object Drawing.Size(780,72)
$learningTab.Controls.Add($learnPath)
$learnRuntime=Label-At $learningTab $ui.learnPending 18 270 780
$learnRuntime.Height=200
$folderLabel = Label-At $piTab $ui.folder 18 20 120
$folderLabel.Name='pi-folder-label'
$cwd = New-Object Windows.Forms.TextBox
$cwd.Name='pi-cwd'
$cwd.Text = $root; $cwd.Location = New-Object Drawing.Point(150, 18); $cwd.Width = 545; $piTab.Controls.Add($cwd)
$browse = Button-At $piTab $ui.browse 705 16 90
$sessionLabel = Label-At $piTab $ui.session 18 67 120
$sessionLabel.Name='pi-session-label'
$session = Combo-At $piTab 150 64 400 @($ui.new, $ui.continue)
$session.Name='pi-session'
$null = Label-At $piTab $ui.plugins 18 115 350
$pluginList = New-Object Windows.Forms.CheckedListBox
$pluginList.Location = New-Object Drawing.Point(18, 145); $pluginList.Size = New-Object Drawing.Size(450, 325)
$pluginList.CheckOnClick = $true; $piTab.Controls.Add($pluginList)
$plugins = @($catalogue.plugins | Where-Object { $_.available })
foreach ($plugin in $plugins) { $index = $pluginList.Items.Add($plugin.label); $pluginList.SetItemChecked($index, $true) }
$fieldLabel = Label-At $piTab $ui.fields 500 115 285
$fieldList = New-Object Windows.Forms.CheckedListBox
$fieldList.Location = New-Object Drawing.Point(500,145); $fieldList.Size = New-Object Drawing.Size(285,235)
$fieldList.CheckOnClick = $true; $piTab.Controls.Add($fieldList)
$fieldNames = @('speed','gpu','cpu','ram','temperature','disk','cache','prefill')
foreach ($key in $fieldNames) { $index = $fieldList.Items.Add($ui.$key); $fieldList.SetItemChecked($index, $true) }
$footer = New-Object Windows.Forms.CheckBox
$footer.Text = $ui.footer; $footer.Checked = $true; $footer.Location = New-Object Drawing.Point(500, 404)
$footer.Size = New-Object Drawing.Size(285, 30); $piTab.Controls.Add($footer)
$actionBar=New-Object Windows.Forms.Panel
$actionBar.Name='launcher-actions'
$form.Controls.Add($actionBar)
$statusMark=New-Object Windows.Forms.Panel
$actionBar.Controls.Add($statusMark)
$status = Label-At $actionBar $ui.offline 24 10 815
$status.AutoEllipsis=$true; $status.Height=40
$saveStatus = Label-At $actionBar $ui.preferencesLoaded 24 56 815
$saveStatus.AutoEllipsis=$true
$start = Button-At $actionBar $ui.start 18 89 120
$openPi = Button-At $actionBar $ui.openPi 150 89 120
$refresh = Button-At $actionBar $ui.refresh 282 89 116
$monitor = Button-At $actionBar $ui.systemMonitor 410 89 116
$save = Button-At $actionBar $ui.save 538 89 170
$close = Button-At $actionBar $ui.close 720 89 120
$buttons=@($start,$openPi,$refresh,$monitor,$save,$close)
if (-not $script:panelHighContrast) {
    $actionBar.BackColor=$panelColors.surface
    $saveStatus.ForeColor=$panelColors.muted
    $start.BackColor=$panelColors.accent; $start.ForeColor=$panelColors.surface
    $start.FlatAppearance.BorderColor=$panelColors.accent
    $start.FlatAppearance.MouseOverBackColor=[Drawing.Color]::FromArgb(14,83,74)
    $statusMark.BackColor=$panelColors.border
    $status.add_TextChanged({
        $statusMark.BackColor=if ($status.Text.StartsWith($ui.ready) -or $status.Text.StartsWith($ui.external)) { $panelColors.accent }
        elseif ($status.Text.StartsWith($ui.loading)) { [Drawing.Color]::FromArgb(162,110,21) }
        elseif ($status.Text.StartsWith('Model launch failed')) { $panelColors.danger }
        else { $panelColors.border }
    })
}
function Panel-Scale {
    return [math]::Max([double]$form.DeviceDpi/96,[double]$form.Font.Size/9)
}
function Layout-DeepSeekHelp {
    if ($script:scalingPanel) { return }
    $scale=Panel-Scale
    foreach ($box in $script:dsHelpBoxes.Values) {
        $parent=$box.Parent
        $box.SetBounds([int](14*$scale),[int](254*$scale),[math]::Max(40,$parent.ClientSize.Width-[int](28*$scale)),[math]::Max(40,$parent.ClientSize.Height-[int](272*$scale)))
    }
}
function Layout-Panel {
    if ($script:layingOutPanel -or $script:scalingPanel) { return }
    $script:layingOutPanel=$true
    try {
        $scale=Panel-Scale
        $width=$form.ClientSize.Width
        $footerHeight=[int](130*$scale)
        $header.SetBounds(0,0,$width,[int](76*$scale))
        $brand.SetBounds([int](18*$scale),[int](8*$scale),[int](264*$scale),[int](29*$scale))
        $runtimeTag.SetBounds([int](302*$scale),[int](10*$scale),($width-[int](320*$scale)),[int](24*$scale))
        $presetLabel.SetBounds([int](18*$scale),[int](43*$scale),[int](138*$scale),[int](25*$scale))
        $preset.SetBounds([int](160*$scale),[int](41*$scale),($width-[int](178*$scale)),[int](24*$scale))
        $actionBar.SetBounds(0,($form.ClientSize.Height-$footerHeight),$width,$footerHeight)
        $statusMark.SetBounds([int](18*$scale),[int](12*$scale),[int](3*$scale),[int](36*$scale))
        $status.SetBounds([int](28*$scale),[int](9*$scale),($width-[int](46*$scale)),[int](42*$scale))
        $saveStatus.SetBounds([int](28*$scale),[int](54*$scale),($width-[int](46*$scale)),[int](24*$scale))
        $buttonWidths=@(120,120,116,116,170,120)
        $left=[int](18*$scale)
        for ($i=0; $i -lt $buttons.Count; $i++) {
            $buttonWidth=[int]($buttonWidths[$i]*$scale)
            if ($buttons[$i] -eq $close) { $left=$width-$buttonWidth-[int](18*$scale) }
            $buttons[$i].SetBounds($left,[int](87*$scale),$buttonWidth,[int](32*$scale))
            $left+=$buttonWidth+[int](12*$scale)
        }
        $tabs.SetBounds([int](12*$scale),[int](84*$scale),($width-[int](24*$scale)),[math]::Max(100,$actionBar.Top-[int](92*$scale)))
        $pageWidth=$tabs.DisplayRectangle.Width
        $columnWidth=[math]::Floor(($pageWidth-[int](54*$scale))/2)
        for ($j=0; $j -lt $modelSections.Count; $j++) {
            $section=$modelSections[$j]
            $x=[int](18*$scale)+($j%2)*($columnWidth+[int](18*$scale))
            $y=[int]((14+215*[math]::Floor($j/2))*$scale)
            $section.heading.SetBounds($x,$y,$columnWidth,[int](26*$scale))
            $labelWidth=[math]::Floor($columnWidth*0.52)
            for ($k=0; $k -lt $section.keys.Count; $k++) {
                $key=$section.keys[$k]
                $rowY=$y+[int]((36+38*$k)*$scale)
                $script:modelLabels[$key].SetBounds($x,($rowY+[int](2*$scale)),$labelWidth,[int](28*$scale))
                $script:controls[$key].SetBounds(($x+$labelWidth+[int](8*$scale)),$rowY,($columnWidth-$labelWidth-[int](8*$scale)),[int](26*$scale))
            }
        }
        Layout-AdvancedPanel $scale
        $dsTabs.SetBounds([int](10*$scale),[int](12*$scale),[math]::Max(40,$deepseekTab.ClientSize.Width-[int](20*$scale)),[math]::Max(40,$deepseekTab.ClientSize.Height-[int](24*$scale)))
        foreach ($page in $script:dsPages.Values) { $page.Size=$dsTabs.DisplayRectangle.Size }
        $dsPiTitle.SetBounds([int](16*$scale),[int](22*$scale),[math]::Max(40,$dsPiPage.ClientSize.Width-[int](32*$scale)),[int](26*$scale))
        $dsPiSummary.SetBounds([int](16*$scale),[int](64*$scale),[math]::Max(40,$dsPiPage.ClientSize.Width-[int](32*$scale)),[int](210*$scale))
        Layout-DeepSeekHelp
        Layout-LanPanel $scale
        Layout-ResourcePanel $scale
        Layout-DraftPanel $scale
    } finally { $script:layingOutPanel=$false }
}
$form.add_ClientSizeChanged({ Layout-Panel })
$form.add_FontChanged({ Layout-Panel })
$form.add_Shown({ Layout-Panel })
foreach ($page in $script:dsPages.Values) { $page.add_SizeChanged({ Layout-DeepSeekHelp }) }
$monitorMenu = New-Object Windows.Forms.ContextMenuStrip
$monitorOrdinary = $monitorMenu.Items.Add($ui.monitorOrdinary)
$monitorAdministrator = $monitorMenu.Items.Add($ui.monitorAdministrator)
$tooltips = New-Object Windows.Forms.ToolTip
$tooltips.SetToolTip($resourceVisual,$ui.resourceVisualHint)
$tooltips.SetToolTip($resourceAppList,$ui.resourceAppsHint)
$tooltips.SetToolTip($resourceRestore,$ui.resourceRestoreHint)
$tooltips.SetToolTip($resourceForce,$ui.resourceForceWarning)
$tooltips.SetToolTip($resourceStopDesktop,$ui.resourceDesktopWarning)
$tooltips.SetToolTip($resourceScan,$ui.resourceScanNote)
foreach ($key in $script:deepseekControls.Keys) {
    $c=$script:deepseekControls[$key]
    $tooltips.SetToolTip($c,$ui.parameterDescriptions.('ds_'+$key).body)
    $c.add_Enter({
        $entry=$ui.parameterDescriptions.([string]$this.Tag)
        $box=$script:dsHelpBoxes.Values | Where-Object { $_.Parent -eq $this.Parent } | Select-Object -First 1
        if ($box) { $box.Text=$entry.label+"`r`n"+$entry.body }
    })
}
foreach ($key in $script:controls.Keys) {
    $entry=$ui.parameterDescriptions.('qwen_'+$key)
    if ($entry) { $tooltips.SetToolTip($script:controls[$key],$entry.body) }
}
$tooltips.SetToolTip($learnEnabled, $ui.learnHint)
$tooltips.SetToolTip($learnReuse, $ui.reuseHint)
$tooltips.SetToolTip($learnInterval, $ui.intervalHint)
$tooltips.SetToolTip($script:controls.kvResident, $ui.kvResidentHint)
$tooltips.SetToolTip($script:controls.vramMiB, $ui.vramReserveHint)
$tooltips.SetToolTip($monitor, $ui.monitorHint)
$tooltips.SetToolTip($samplingCustom, $ui.samplingHint)
$tooltips.SetToolTip($samplingFixedSeed, $ui.samplingSeedHint)
$tooltips.SetToolTip($samplingSeed, $ui.samplingSeedHint)
foreach ($key in $script:samplingControls.Keys) { $tooltips.SetToolTip($script:samplingControls[$key],$ui.('sample_'+$key+'_hint')) }
foreach ($s in $catalogue.engineOptionSpecs) { $tooltips.SetToolTip($script:engineOptionControls[[string]$s.key],[string]$s.hint) }
$tooltips.SetToolTip($enginePreview,$ui.engineOptionsHint)
$tooltips.SetToolTip($engineReset,$ui.engineOptionsHint)
$monitor.Enabled = $true
$monitorAdministrator.Enabled=$false
$monitorAdministrator.Visible=$false
$openPi.Enabled = $false

$small = New-Object Windows.Forms.Form
$small.SuspendLayout(); $small.AutoScaleMode='None'
$small.Text = $ui.smallTitle; $small.Font = $font
$small.ClientSize = New-Object Drawing.Size(400, 310); $small.MinimumSize = New-Object Drawing.Size(416, 349)
$small.StartPosition = 'Manual'
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$small.Location = New-Object Drawing.Point(($area.Right-420),($area.Top+20))
$smallStatus = Label-At $small $ui.none 8 8 384
$smallStatus.Height = 38
$logText = New-Object Windows.Forms.TextBox
$logText.Multiline = $true; $logText.ReadOnly = $true; $logText.ScrollBars = 'Both'; $logText.WordWrap = $false
$logText.Font = New-Object Drawing.Font('Consolas', 7.5)
$logText.BackColor = [Drawing.Color]::FromArgb(20,22,24); $logText.ForeColor = [Drawing.Color]::Gainsboro
$logText.Location = New-Object Drawing.Point(8,50); $logText.Size = New-Object Drawing.Size(384,210)
$logText.Anchor = 'Top,Bottom,Left,Right'; $small.Controls.Add($logText)
$stop = Button-At $small $ui.stop 8 270 180; $stop.Anchor = 'Bottom,Left'
$details = Button-At $small $ui.details 210 270 182; $details.Anchor = 'Bottom,Right'
$small.KeyPreview = $true
function Is-DeepSeek {
    # SelectedIndexChanged already points at the next row while the old draft is saved.
    $current=$profiles | Where-Object { $_.id -eq $script:activeProfile } | Select-Object -First 1
    return $current.family -eq 'deepseek41'
}
function Active-ModelControls {
    if (Is-DeepSeek) { return $script:deepseekControls }
    return $script:controls
}
function Service-MatchesSelection {
    $s=$script:service
    if (-not $s -or $s.service -ne 'strata' -or $s.status -ne 'ok' -or -not $s.loaded -or $s.api_key) { return $false }
    if ($script:servicePort -ne [int](Active-ModelControls).port.Value) { return $false }
    $p=$profiles[$preset.SelectedIndex]
    if ([bool]$s.images -ne [bool]$p.vision) { return $false }
    if ($s.model -eq $p.model) { return $true }
    return [bool]($script:run -and $s.model -eq $script:run.model -and
        ($script:run.family -eq $p.family -or (-not $script:run.family -and $p.family -eq 'qwen')) -and
        $script:run.settings.context -eq $s.max_context)
}
function Update-PiConnection {
    $ds=Is-DeepSeek
    $active=Active-ModelControls
    $matched=Service-MatchesSelection
    $openPi.Text=$ui.openPi
    $openPi.Enabled=$matched -and $catalogue.piAvailable
    $piTab.Text=if ($ds) { $ui.dsPiTitle } else { $ui.pi }
    $dsPiOpen.Enabled=$ds -and $matched
    $dsModelStart.Enabled=$ds -and $start.Enabled
    $dsPiTitle.Text=$ui.dsPiTitle+' | '+$(if ($matched -and $ds) { $ui.piConnected } elseif ($script:service) { $ui.piMismatch } else { $ui.piDisconnected })
    $actualModel=if ($script:service) { [string]$script:service.model } else { '-' }
    $actualContext=if ($script:service) { [string]$script:service.max_context } else { '-' }
    $dsPiSummary.Text=($ui.piEndpoint+': http://127.0.0.1:'+([int]$script:deepseekControls.port.Value)+"/v1`r`n"+
        $ui.piActualModel+': '+$actualModel+"`r`n"+
        $ui.piActualContext+': '+$actualContext+" tokens`r`n"+
        $ui.piPlannedContext+': '+$script:deepseekControls.context.Value+" tokens`r`n"+
        $ui.piOutputBudget+': '+$script:deepseekControls.output.Value+" tokens`r`n"+
        $ui.piThinkingBudget+': '+$script:deepseekControls.thinking.Value+' / '+$script:deepseekControls.effort.SelectedItem+"`r`n"+
        $ui.piTextOnly)
}
function Apply-FamilyControls {
    $ds=Is-DeepSeek
    $modelTab.Enabled=-not $ds
    foreach ($key in @('visionThreads','imageTokens')) { $script:controls[$key].Enabled=[bool]$profiles[$preset.SelectedIndex].vision }
    $advancedTab.Enabled=-not $ds; $learningTab.Enabled=-not $ds
    $draftTab.Enabled=-not $ds
    Update-DraftControls
    $deepseekTab.Enabled=@($profiles | Where-Object { $_.family -eq 'deepseek41' }).Count -gt 0
    if ($ds -and $tabs.SelectedTab -in @($modelTab,$advancedTab,$learningTab)) { $tabs.SelectedTab=$deepseekTab }
    if (-not $ds -and $tabs.SelectedTab -eq $deepseekTab) { $tabs.SelectedTab=$modelTab }
    Update-PiConnection
}
function Set-Preset {
    $p = $profiles[$preset.SelectedIndex]
    $active=Active-ModelControls
    foreach ($key in $active.Keys) {
        $c=$active[$key]
        if ($null -eq $p.settings.$key) {
            if ($c -is [Windows.Forms.ComboBox]) { $c.SelectedIndex=0 }
            continue
        }
        if ($c -is [Windows.Forms.NumericUpDown]) { $c.Value = [decimal]$p.settings.$key }
        else { $c.SelectedItem = [string]$p.settings.$key }
    }
    Apply-FamilyControls
    Update-SamplingControls
}
function Set-SamplingDefaults {
    $p=$profiles[$preset.SelectedIndex]
    $active=Active-ModelControls
    $defaults=if ([string]$active.effort.SelectedItem -eq 'off' -or $active.thinking.Value -eq 0) { $p.samplingDefaults.off } else { $p.samplingDefaults.thinking }
    if ($script:run -and $script:service.model -eq $script:run.model -and $script:run.sampling.mode -eq 'custom') { $defaults=$script:run.sampling }
    foreach ($key in $script:samplingControls.Keys) { $script:samplingControls[$key].Value=[decimal]$defaults.$key }
    $samplingFixedSeed.Checked=$null -ne $defaults.seed
    $samplingSeed.Value=if ($samplingFixedSeed.Checked) { [decimal]$defaults.seed } else { 42 }
}
function Update-SamplingControls {
    if (-not $samplingCustom.Checked) { Set-SamplingDefaults }
    foreach ($c in $script:samplingControls.Values) { $c.Enabled=$samplingCustom.Checked }
    $samplingFixedSeed.Enabled=$samplingCustom.Checked
    $samplingSeed.Enabled=$samplingCustom.Checked -and $samplingFixedSeed.Checked
}
function Set-Sampling07 {
    $samplingCustom.Checked=$true
    $values=@{temperature=0.7;top_p=0.95;top_k=20;min_p=0;repetition_penalty=1;presence_penalty=0;frequency_penalty=0;penalty_last_n=64}
    foreach ($key in $values.Keys) { $script:samplingControls[$key].Value=[decimal]$values[$key] }
    $samplingFixedSeed.Checked=$false
    Update-SamplingControls
}
function Restore-SamplingPreferences($value) {
    $samplingCustom.Checked=$value.mode -eq 'custom'
    if ($samplingCustom.Checked) {
        foreach ($key in $script:samplingControls.Keys) {
            if ($null -ne $value.$key) { $script:samplingControls[$key].Value=[decimal]$value.$key }
        }
        $samplingFixedSeed.Checked=$null -ne $value.seed
        if ($samplingFixedSeed.Checked) { $samplingSeed.Value=[decimal]$value.seed }
    }
    Update-SamplingControls
}
function Get-EngineOptions {
    $options=@{}
    foreach ($s in $catalogue.engineOptionSpecs) {
        $options[[string]$s.key]=if (Is-DeepSeek) { 'default' } else { [string]$s.values[$script:engineOptionControls[[string]$s.key].SelectedIndex] }
    }
    return $options
}
function Update-EngineOptionsPreview {
    $options=Get-EngineOptions
    $lines=@($aui.pending,'')
    $inherited=$profiles[$preset.SelectedIndex].inheritedEngineOptions
    foreach ($s in $catalogue.engineOptionSpecs) {
        $key=[string]$s.key; $value=$options[$key]
        $target=[string]($s.env+$s.flag)
        if ($value -eq 'default') { $lines+=$target+': '+$ui.engineInherited+' ['+$inherited.$key+']'; continue }
        elseif ($key -eq 'routePrior') { $value=if ($value -eq 'on') { '1.5' } else { '0' } }
        elseif ($key -eq 'kva') { $value=if ($value -eq 'on') { '1' } else { '0' } }
        if ($s.booleanFlag) { $lines+=$target+': '+$value }
        else { $lines+=$target+'='+$value }
    }
    $enginePreview.Text=$lines -join "`r`n"
}
function Restore-EngineOptions($value) {
    foreach ($s in $catalogue.engineOptionSpecs) {
        $key=[string]$s.key
        $index=[array]::IndexOf(@($s.values),[string]$value.$key)
        $script:engineOptionControls[$key].SelectedIndex=[math]::Max(0,$index)
    }
    Update-EngineOptionsPreview
}
function Request-Object {
    $s = @{}
    $active=Active-ModelControls
    foreach ($key in $active.Keys) {
        $c=$active[$key]
        if ($c -is [Windows.Forms.NumericUpDown]) { $s[$key] = [double]$c.Value }
        else { $s[$key] = [string]$c.SelectedItem }
    }
    $selectedPlugins = @(); for ($i=0; $i -lt $plugins.Count; $i++) { if ($pluginList.GetItemChecked($i)) { $selectedPlugins += $plugins[$i].id } }
    $fields = @(); for ($i=0; $i -lt $fieldNames.Count; $i++) { if ($fieldList.GetItemChecked($i)) { $fields += $fieldNames[$i] } }
    $sampling=@{mode='model'}
    if ($samplingCustom.Checked) {
        $sampling.mode='custom'
        foreach ($key in $script:samplingControls.Keys) {
            $c=$script:samplingControls[$key]
            $sampling[$key]=if ($c.DecimalPlaces -eq 0) { [int]$c.Value } else { [double]$c.Value }
        }
        $sampling.seed=if ($samplingFixedSeed.Checked) { [int]$samplingSeed.Value } else { $null }
    }
    return @{profile=$script:activeProfile; settings=$s;
      sampling=$sampling; engineOptions=(Get-EngineOptions); resourceOptimization=(Get-ResourceOptions); draftOptions=(Get-DraftOptions);
      learning=@{enabled=($learnEnabled.Checked -and -not (Is-DeepSeek));reuse=$learnReuse.Checked;scope=$scopeNames[$learnScope.SelectedIndex];saveEveryMinutes=[int]$learnInterval.Value};
      plugins=$selectedPlugins; fields=$fields;
      cwd=$cwd.Text; session=@('new','continue')[$session.SelectedIndex]; footer=$footer.Checked}
}
function Restore-ModelPreferences($value) {
    $active=Active-ModelControls
    foreach ($key in $active.Keys) {
        if ($null -eq $value.settings.$key) { continue }
        $c=$active[$key]
        if ($c -is [Windows.Forms.NumericUpDown]) { $c.Value=[decimal]$value.settings.$key }
        else { $c.SelectedItem=[string]$value.settings.$key }
    }
    Restore-SamplingPreferences $value.sampling
    Restore-EngineOptions $value.engineOptions
    Restore-DraftOptions $value.draftOptions
    $learnEnabled.Checked=$value.learning.enabled -ne $false
    $learnReuse.Checked=$value.learning.reuse -ne $false
    $index=[array]::IndexOf($scopeNames,[string]$value.learning.scope)
    $learnScope.SelectedIndex=[math]::Max(0,$index)
    $learnInterval.Value=if ($null -ne $value.learning.saveEveryMinutes) { [decimal]$value.learning.saveEveryMinutes } else { 5 }
}
function Mark-PreferencesDirty {
    if ($script:restoringPreferences) { return }
    $script:preferencesDirty=$true
    $saveStatus.Text=$ui.preferencesDirty
}
function Switch-Profile {
    $wasRestoring=$script:restoringPreferences
    if ($script:activeProfile -and -not $wasRestoring) {
        $script:profileDrafts[$script:activeProfile]=Request-Object
        $script:changedProfiles[$script:activeProfile]=$script:profileDrafts[$script:activeProfile]
    }
    $script:restoringPreferences=$true
    try {
        $script:service=$null; $script:servicePort=$null
        $script:activeProfile=[string]$profiles[$preset.SelectedIndex].id
        Set-Preset
        Restore-ModelPreferences $script:profileDrafts[$script:activeProfile]
        Apply-FamilyControls
    } finally { $script:restoringPreferences=$wasRestoring }
    Mark-PreferencesDirty
}
function Save-PanelPreferences {
    $null=$form.ValidateChildren()
    $request=Request-Object
    $request.profiles=$script:changedProfiles
    try { $result=Node-Call 'save' $request }
    catch { $saveStatus.Text=$ui.preferencesFailed; throw }
    $script:profileDrafts[$script:activeProfile]=$request.Clone()
    $script:profileDrafts[$script:activeProfile].Remove('profiles')
    $script:changedProfiles=@{}
    $script:preferencesDirty=$false
    $saveStatus.Text=$ui.saved+' '+[DateTime]::Now.ToString('HH:mm:ss')
}
function Update-LearningStatus {
    Update-DraftStatus
    if (-not $script:run) { $learnRuntime.Text=$ui.learnPending; return }
    if ($script:run.family -eq 'deepseek41') { $learnRuntime.Text=$ui.deepseekStartup; return }
    $l=$script:run.learning
    $learnPath.Text=if ($l.savePath) { $l.savePath } else { Join-Path $stateRoot 'learning' }
    $mode=if ($l.enabled) { $ui.learnOn } else { $ui.learnOff }
    $seed=if ($l.selected -eq 'learned') { $ui.seedLearned } else { $ui.seedBase }
    $memory=$script:ownedStatus.startupMemory
    $actual=if ($null -ne $memory.kvResidentTokens) { [string]$memory.kvResidentTokens } else { $ui.notReported }
    $learnRuntime.Text=$mode+' | '+$seed+' | '+$l.scope+"`r`n"+
      $ui.kvRequested+': '+$script:run.settings.kvResident+' / '+$ui.kvActual+': '+$actual+"`r`n"+
      $ui.context+': '+$script:run.settings.context
    if ($null -ne $memory.expertCacheGiB) {
        $learnRuntime.Text+="`r`n"+$ui.cacheStartup+': '+$memory.expertCacheGiB+' GiB / '+$memory.expertSlots+' slots'
    }
    if ($null -ne $memory.nvmlFreeMiB) {
        $learnRuntime.Text+="`r`n"+$ui.memoryBeforeCache+': NVML '+$memory.nvmlFreeMiB+' / CUDA '+$memory.cudaFreeMiB+' MiB'
    }
    if ($null -ne $memory.loadedFreeMiB) {
        $learnRuntime.Text+="`r`n"+$ui.memoryLoaded+': '+$memory.loadedFreeMiB+' MiB'
        if ($memory.loadedFreeMiB -lt 256) { $learnRuntime.Text+=' '+$ui.memoryLow }
    }
    if ($l.warning) { $learnRuntime.Text+="`r`n"+$l.warning }
}
function Monitor-StartInfo([bool]$Administrator) {
    $app = $catalogue.monitor
    if (-not $app.available -or -not (Test-Path -LiteralPath $app.executable -PathType Leaf)) { throw $ui.monitorUnavailable }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $app.executable
    $info.Arguments = [PanelProcess]::Quote($app.directory)
    $info.WorkingDirectory = $app.directory
    $info.UseShellExecute = $Administrator
    $info.CreateNoWindow = -not $Administrator
    $info.WindowStyle = 'Hidden'
    if ($Administrator) { $info.Verb='runas' }
    else { $info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE') }
    return $info
}
function Open-SystemMonitor([bool]$Administrator) {
    try {
        if ($Administrator) { throw 'Built-in terminal monitoring does not need administrator access.' }
        Start-LocalMonitor
    } catch { Message-Error $_.Exception.Message }
}
function Stop-Owned {
    if (-not $script:run -or -not $script:runner -or $script:runner.HasExited) { return $true }
    if ([Windows.Forms.MessageBox]::Show($ui.confirmStop,$ui.smallTitle,'YesNo','Warning') -ne 'Yes') { return $false }
    $ownerFile = Join-Path $script:run.dir 'owner.json'
    if (-not (Test-Path -LiteralPath $ownerFile)) { Message-Error 'Owner guard not ready. Wait for startup or its explicit error.'; return $false }
    $owner = Read-PanelJson $ownerFile
    if ($owner.runId -ne $script:run.id -or $owner.runnerPid -ne $script:runner.Id) { Message-Error 'Owner identity mismatch. No process was stopped.'; return $false }
    [IO.File]::WriteAllText((Join-Path $script:run.dir 'stop.json'), (@{runId=$owner.runId;token=$owner.token} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    return $true
}
function Poll-Start {
    if ($script:poll) { return }
    $port = [int](Active-ModelControls).port.Value
    $uri = 'http://127.0.0.1:' + $port + '/health'
    $script:poll = $http.GetStringAsync($uri)
    $script:pollPort=$port; $script:pollProfile=$script:activeProfile
    $script:pollStarted = [Environment]::TickCount
}
function Poll-Finish {
    if (-not $script:poll -or -not $script:poll.IsCompleted) { return }
    try {
        $service = $script:poll.GetAwaiter().GetResult() | ConvertFrom-Json
        if ($script:pollPort -ne [int](Active-ModelControls).port.Value -or $script:pollProfile -ne $script:activeProfile) { return }
        $script:service = $service; $script:servicePort=$script:pollPort
        if ($script:service.service -ne 'strata' -or -not $script:service.loaded) { $script:service = $null }
    } catch { $script:service = $null }
    finally { $script:poll = $null }
    $start.Enabled = -not $script:service -and (-not $script:runner -or $script:runner.HasExited) -and -not $script:resourcePending
    Update-PiConnection
    if ($script:service) {
        $ownership = if ($script:run -and $script:service.model -eq $script:run.model) { $ui.ready } else { $ui.external }
        $status.Text = $ownership + "`n" + $script:service.model + ' | context ' + $script:service.max_context + ' | vision ' + $script:service.images
    } elseif ($script:runner -and -not $script:runner.HasExited) { $status.Text = $ui.loading }
    elseif ($script:runner -and $script:runner.HasExited -and $script:runner.ExitCode -ne 0) {
        $status.Text = 'Model launch failed / exit '+$script:runner.ExitCode+"`n"+$script:ownedStatus.error
    } else { $status.Text = $ui.offline }
    if (-not $samplingCustom.Checked) { Update-SamplingControls }
}
$script:profileDrafts=@{}
$script:changedProfiles=@{}
$script:activeProfile=$null
$script:restoringPreferences=$true
$script:preferencesDirty=$false
if ($catalogue.preferences.profiles) {
    foreach ($entry in $catalogue.preferences.profiles.PSObject.Properties) { $script:profileDrafts[$entry.Name]=$entry.Value }
}
$preset.add_SelectedIndexChanged({ Switch-Profile })
for ($i=0; $i -lt $profiles.Count; $i++) { if ($profiles[$i].id -eq 'q3xl-256k-vision') { $preset.SelectedIndex=$i } }
if (-not $script:activeProfile) { Switch-Profile }
if ($catalogue.preferences) {
    $pref = $catalogue.preferences
    for ($i=0; $i -lt $profiles.Count; $i++) { if ($profiles[$i].id -eq $pref.profile) { $preset.SelectedIndex=$i } }
    $active=Active-ModelControls
    foreach ($key in $active.Keys) {
        if ($null -ne $pref.settings.$key) {
            try { if ($active[$key] -is [Windows.Forms.NumericUpDown]) { $active[$key].Value = [decimal]$pref.settings.$key } else { $active[$key].SelectedItem = [string]$pref.settings.$key } } catch { }
        }
    }
    if ($pref.cwd) { $cwd.Text = $pref.cwd }
    if ($pref.session -eq 'continue') { $session.SelectedIndex=1 }
    for ($i=0; $i -lt $plugins.Count; $i++) { $pluginList.SetItemChecked($i, $pref.plugins -contains $plugins[$i].id) }
    for ($i=0; $i -lt $fieldNames.Count; $i++) { $fieldList.SetItemChecked($i, $pref.fields -contains $fieldNames[$i]) }
    $footer.Checked = $pref.footer -ne $false
    if ($pref.learning) {
        $learnEnabled.Checked=$pref.learning.enabled -ne $false
        $learnReuse.Checked=$pref.learning.reuse -ne $false
        $index=[array]::IndexOf($scopeNames,[string]$pref.learning.scope)
        if ($index -ge 0) { $learnScope.SelectedIndex=$index }
        if ($null -ne $pref.learning.saveEveryMinutes) {
            try { $learnInterval.Value=[decimal]$pref.learning.saveEveryMinutes } catch { }
        }
    }
    if ($pref.sampling) { Restore-SamplingPreferences $pref.sampling }
    if ($pref.engineOptions) { Restore-EngineOptions $pref.engineOptions }
}
$script:activeProfile=[string]$profiles[$preset.SelectedIndex].id
Apply-FamilyControls
$script:changedProfiles=@{}
$script:restoringPreferences=$false
$script:preferencesDirty=$false
$saveStatus.Text=$ui.preferencesLoaded
foreach ($c in $script:engineOptionControls.Values) { $c.add_SelectedIndexChanged({ Update-EngineOptionsPreview }) }
$engineReset.add_Click({ Restore-EngineOptions @{} })
Update-EngineOptionsPreview
$samplingCustom.add_CheckedChanged({ Update-SamplingControls })
$samplingFixedSeed.add_CheckedChanged({ $samplingSeed.Enabled=$samplingCustom.Checked -and $samplingFixedSeed.Checked })
foreach ($group in @($script:controls,$script:deepseekControls)) {
    $group.effort.add_SelectedIndexChanged({ if (-not $samplingCustom.Checked) { Update-SamplingControls } })
    $group.thinking.add_ValueChanged({ if (-not $samplingCustom.Checked) { Update-SamplingControls } })
}
foreach ($key in @('context','output','thinking','effort','port')) {
    $c=$script:deepseekControls[$key]
    if ($c -is [Windows.Forms.ComboBox]) { $c.add_SelectedIndexChanged({ Update-PiConnection }) }
    else { $c.add_ValueChanged({ Update-PiConnection }) }
}
$sampling07.add_Click({ Set-Sampling07 })
$samplingModel.add_Click({ $samplingCustom.Checked=$false; Update-SamplingControls })
Update-SamplingControls
$learnEnabled.add_CheckedChanged({
    foreach ($control in @($learnReuse,$learnScope,$learnInterval)) { $control.Enabled=$learnEnabled.Checked }
})
foreach ($control in @($learnReuse,$learnScope,$learnInterval)) { $control.Enabled=$learnEnabled.Checked }
$cwd.SelectionStart=0; $cwd.SelectionLength=0
$browse.add_Click({ $d = New-Object Windows.Forms.FolderBrowserDialog; $d.SelectedPath=$cwd.Text; if ($d.ShowDialog() -eq 'OK') { $cwd.Text=$d.SelectedPath }; $d.Dispose() })
$monitor.add_Click({ $monitorMenu.Show($monitor, (New-Object Drawing.Point(0,$monitor.Height))) })
$monitorOrdinary.add_Click({ Open-SystemMonitor $false })
$monitorAdministrator.add_Click({ Open-SystemMonitor $true })
$save.add_Click({ try { Save-PanelPreferences } catch { $saveStatus.Text=$ui.preferencesFailed; Message-Error $_.Exception.Message } })
$watchControls=@($script:controls.Values)+@($script:deepseekControls.Values)+@($script:samplingControls.Values)+@($script:engineOptionControls.Values)+@($draftMode,$draftPack,$draftWindow,$draftConfidence)+@($samplingCustom,$samplingFixedSeed,$samplingSeed,$learnEnabled,$learnReuse,$learnScope,$learnInterval,$cwd,$session,$footer,$resourceAuto,$resourceVisual,$resourceRestore,$resourceForce)
foreach ($c in $watchControls) {
    if ($c -is [Windows.Forms.NumericUpDown]) { $c.add_ValueChanged({ Mark-PreferencesDirty }); $c.add_TextChanged({ Mark-PreferencesDirty }) }
    elseif ($c -is [Windows.Forms.ComboBox]) { $c.add_SelectedIndexChanged({ Mark-PreferencesDirty }) }
    elseif ($c -is [Windows.Forms.CheckBox]) { $c.add_CheckedChanged({ Mark-PreferencesDirty }) }
    else { $c.add_TextChanged({ Mark-PreferencesDirty }) }
}
foreach ($c in @($pluginList,$fieldList,$resourceAppList)) { $c.add_ItemCheck({ Mark-PreferencesDirty }) }
function Start-SelectedModel {
    try {
        if ($script:runner -and -not $script:runner.HasExited) { throw 'An owned model is already starting/running' }
        Save-PanelPreferences
        $script:run = Node-Call 'prepare' (Request-Object)
        $logText.Text=''; $smallStatus.Text=$ui.loading
        $script:ownedStatus=$null; $script:reportedExit=$null
        Update-LearningStatus
        $script:runner = [PanelProcess]::Start($script:run.python, @('-u',(Join-Path $root 'scripts/strata-panel/runner.py'),'--run',(Join-Path $script:run.dir 'run.json'),'--parent',[string]$PID), $true, $root, $true)
        $script:runnerError=$script:runner.StandardError.ReadToEndAsync()
        $script:runnerOutput=$script:runner.StandardOutput.ReadToEndAsync()
        $start.Enabled=$false; $small.Show(); $small.BringToFront(); $status.Text=$ui.loading
        Update-PiConnection
    } catch { Message-Error $_.Exception.Message }
}
$start.add_Click({
    try {
        if ($script:resourceHelper -or $script:resourcePending) { throw 'Resource optimization is already running' }
        Save-PanelPreferences
        if ($resourceAuto.Checked) { $tabs.SelectedTab=$resourceTab; Begin-ResourceApply $true }
        else { Start-SelectedModel }
    } catch { Message-Error $_.Exception.Message }
})
function Open-SelectedPi {
    try {
        if (-not (Service-MatchesSelection)) { throw 'The selected model is not ready. Refresh its service before opening Pi.' }
        Save-PanelPreferences
        $r = Request-Object
        $r.port = [int](Active-ModelControls).port.Value
        $r.output = $r.settings.output; $r.thinking=$r.settings.thinking; $r.effort=$r.settings.effort
        if ($script:run -and $script:service.model -eq $script:run.model) { $r.runFile = Join-Path $script:run.dir 'run.json' }
        $pi = Node-Call 'pi' $r
        $git = 'C:/Program Files/Git/bin/bash.exe'
        $sh = Join-Path $PSScriptRoot 'pi.sh'
        $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
        if ($wt -and $sh -notmatch "[;']" -and $pi.file -notmatch "[;']" -and $cwd.Text -notmatch "[;']") {
            $null = [PanelProcess]::Start($wt.Source, @('--window','new','--maximized','new-tab','--title','Strata - Pi','--startingDirectory',$cwd.Text,$git,'--login',$sh,$pi.file), $true, $root, $false)
        } else { $null = [PanelProcess]::Start($git, @('--login',$sh,$pi.file), $false, $root, $false) }
    } catch { Message-Error $_.Exception.Message }
}
$openPi.add_Click({ Open-SelectedPi })
$dsModelStart.add_Click({ $start.PerformClick() })
$dsPiOpen.add_Click({ Open-SelectedPi })
$dsPiSettings.add_Click({ $tabs.SelectedTab=$piTab })
$tabs.add_SelectedIndexChanged({
    Layout-Panel
    if ($tabs.SelectedTab -eq $lanTab -and -not $SelfTest) { Start-LanOperation 'PanelStatus' }
    if ($tabs.SelectedTab -eq $deepseekTab -and -not (Is-DeepSeek)) {
        for ($i=0; $i -lt $profiles.Count; $i++) {
            if ($profiles[$i].family -eq 'deepseek41') { $preset.SelectedIndex=$i; break }
        }
    }
})
$stop.add_Click({ $null=Stop-Owned })
$details.add_Click({ if ($script:run -and (Test-Path -LiteralPath $script:run.log)) { $null = [PanelProcess]::Start('notepad.exe',@($script:run.log),$false,$root,$false) } })
$small.add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $null=Stop-Owned; $_.SuppressKeyPress=$true } })
$small.add_FormClosing({
    if (-not $script:allowClose) { $_.Cancel=$true; if (Stop-Owned) { $small.Hide() } }
})
$close.add_Click({ $form.Close() })
$form.add_FormClosing({
    $closingEvent=$_
    if ($script:resourceHelper) { $closingEvent.Cancel=$true; Message-Error $ui.resourceCloseBusy; return }
    if (-not $SelfTest -and $script:preferencesDirty) {
        try { Save-PanelPreferences } catch { $closingEvent.Cancel=$true; $saveStatus.Text=$ui.preferencesFailed; Message-Error $_.Exception.Message; return }
    }
    if (-not (Stop-Owned)) { $_.Cancel=$true; return }
    try { Restore-ResourceOnClose } catch { $closingEvent.Cancel=$true; Message-Error $_.Exception.Message; return }
    $script:allowClose=$true
})
$refresh.add_Click({ Poll-Start })
Add-Type -AssemblyName System.Net.Http
$handler = New-Object Net.Http.HttpClientHandler; $handler.UseProxy=$false
$http = New-Object Net.Http.HttpClient($handler); $http.Timeout=[timespan]::FromSeconds(1.5)
$timer = New-Object Windows.Forms.Timer; $timer.Interval=500
$script:ticks = 0
$timer.add_Tick({
    Poll-Finish
    Finish-LanOperation
    Finish-ResourceOperation
    $script:ticks++
    if ($script:ticks % 20 -eq 0 -and $tabs.SelectedTab -eq $lanTab) { Start-LanOperation 'PanelStatus' }
    if ($script:ticks % 8 -eq 0) { Poll-Start }
    if ($script:run) {
        if ($script:runner -and $script:runner.HasExited -and $script:reportedExit -ne $script:run.id) {
            $script:reportedExit=$script:run.id
            $stderr=$script:runnerError.GetAwaiter().GetResult()
            $stdout=$script:runnerOutput.GetAwaiter().GetResult()
            if ($stderr -or $stdout) { [IO.File]::AppendAllText($script:run.log, "`n[runner]`n"+$stdout+$stderr, (New-Object Text.UTF8Encoding($false))) }
            if (-not (Test-Path -LiteralPath (Join-Path $script:run.dir 'status.json'))) {
                $script:ownedStatus=@{state='error';error=('Runner exit '+$script:runner.ExitCode+' / '+$stderr.Trim())}
                $smallStatus.Text=$script:ownedStatus.error
            }
        }
        $f = Join-Path $script:run.dir 'status.json'
        if (Test-Path -LiteralPath $f) {
            try {
                $s = Read-PanelJson $f
                $script:ownedStatus=$s
                if ($script:runner.HasExited -and $s.state -notin @('stopped','exited','error')) {
                    $smallStatus.Text=$ui.runnerExited+' / exit '+$script:runner.ExitCode
                } elseif (-not $script:runner.HasExited -and ([DateTime]::UtcNow-[IO.File]::GetLastWriteTimeUtc($f)).TotalSeconds -gt 15) {
                    $smallStatus.Text=$ui.statusStale+"`n"+$script:run.profile
                } else { $smallStatus.Text=$s.state + ' | ' + $script:run.profile + ' | ' + $script:run.settings.context + "`n" + $s.error }
                Update-LearningStatus
            } catch { }
        }
        if ($small.Visible -and $script:ticks % 4 -eq 0 -and (Test-Path -LiteralPath $script:run.log)) {
            try { $lines=Get-Content -LiteralPath $script:run.log -Tail 80 -Encoding UTF8; $logText.Text=$lines -join "`r`n"; $logText.SelectionStart=$logText.TextLength; $logText.ScrollToCaret() } catch { }
        }
    }
})
# Apply the DPI baseline only after the runtime-built child tree is complete.
$form.AutoScaleDimensions=New-Object Drawing.SizeF(96,96); $form.AutoScaleMode='Dpi'
$small.AutoScaleDimensions=New-Object Drawing.SizeF(96,96); $small.AutoScaleMode='Dpi'
$form.ResumeLayout($true); $small.ResumeLayout($true)
Layout-Panel
function Layout-Errors($containers) {
    foreach ($container in $containers) {
        $children=@($container.Controls | Where-Object { $_.Width -gt 0 -and $_.Height -gt 0 })
        for ($i=0; $i -lt $children.Count; $i++) {
            $control=$children[$i]
            $name=if ($control.Name) { $control.Name } else { $control.Text }
            if ($control.Left -lt 0 -or $control.Top -lt 0 -or $control.Right -gt $container.ClientSize.Width -or $control.Bottom -gt $container.ClientSize.Height) {
                'Outside parent: '+$name
            }
            for ($j=$i+1; $j -lt $children.Count; $j++) {
                $other=$children[$j]
                $overlap=[Drawing.Rectangle]::Intersect($control.Bounds,$other.Bounds)
                if ($overlap.Width -gt 0 -and $overlap.Height -gt 0) {
                    $otherName=if ($other.Name) { $other.Name } else { $other.Text }
                    'Overlapping siblings: '+$name+' / '+$otherName
                }
            }
        }
    }
}
function Save-WindowImage($window, [string]$file) {
    $bitmap=New-Object Drawing.Bitmap($window.Width,$window.Height)
    try {
        $window.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$window.Width,$window.Height)))
        $bitmap.Save($file)
    } finally { $bitmap.Dispose() }
}
if ($ResourceSelfTest) {
    . (Join-Path $PSScriptRoot 'ResourcePanel.test.ps1')
    exit 0
}
if ($AdvancedSelfTest) {
    try { . (Join-Path $PSScriptRoot 'AdvancedPanel.test.ps1') }
    finally { $script:allowClose=$true; $small.Dispose(); $form.Dispose(); $http.Dispose(); $monitorMenu.Dispose(); $tooltips.Dispose() }
    exit 0
}
if ($SelfTest) {
    if (-not $ScreenshotDirectory) { $ScreenshotDirectory=Join-Path $root 'logs/windows-panel' }
    [IO.Directory]::CreateDirectory($ScreenshotDirectory) | Out-Null
    $form.Show(); [Windows.Forms.Application]::DoEvents()
    foreach ($page in $tabs.TabPages) {
        if (-not $page.Enabled) { continue }
        $tabs.SelectedTab=$page; Layout-Panel; [Windows.Forms.Application]::DoEvents()
        Save-WindowImage $form (Join-Path $ScreenshotDirectory ($tabs.TabPages.IndexOf($page).ToString()+'.png'))
    }
    $script:allowClose=$true; $small.Dispose(); $form.Dispose(); $http.Dispose(); $monitorMenu.Dispose(); $tooltips.Dispose()
    Write-Output 'PORTABLE_PANEL_SELF_TEST_OK'
    exit 0
}
try { $timer.Start(); Poll-Start; Start-LanOperation 'PanelStatus'; [Windows.Forms.Application]::Run($form) }
finally { $timer.Stop(); $timer.Dispose(); Close-LanHelper; $http.Dispose(); $monitorMenu.Dispose(); $tooltips.Dispose(); $small.Dispose(); $form.Dispose() }
