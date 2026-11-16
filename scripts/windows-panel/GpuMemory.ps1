# Read-only WDDM snapshots. LUID/physical index are not CUDA or NVML indices.
function Get-GpuMemoryCounters {
    return @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction Stop)
}
function Convert-GpuMemoryCounters($Counters) {
    $unique=@{}
    foreach ($sample in $Counters) {
        if ($sample.Name -notmatch '^pid_(\d+)_luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_(\d+)(?:#\d+)?$') { continue }
        $processId=[int]$Matches[1]
        $adapter=$Matches[2]+'_'+$Matches[3]+'/phys_'+$Matches[4]
        $key=$processId.ToString()+'/'+$adapter
        # Duplicate provider instances must not inflate a process's allocation.
        $bytes=[double]$sample.DedicatedUsage
        if (-not $unique.ContainsKey($key) -or $bytes -gt $unique[$key].bytes) {
            $unique[$key]=@{pid=$processId;adapter=$adapter;bytes=$bytes}
        }
    }
    return @($unique.Values | Where-Object { $_.bytes -gt 10MB } | Sort-Object { [double]$_.bytes } -Descending)
}
function Get-NvidiaMemorySnapshot {
    $command=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $command) { return @{available=$false;reason='nvidia-smi unavailable';cards=@()} }
    $p=New-Object Diagnostics.Process
    $p.StartInfo=New-Object Diagnostics.ProcessStartInfo
    $p.StartInfo.FileName=$command.Source
    $p.StartInfo.Arguments='--query-gpu=index,name,memory.total,memory.used,memory.free --format=csv,noheader,nounits'
    $p.StartInfo.UseShellExecute=$false; $p.StartInfo.CreateNoWindow=$true
    $p.StartInfo.RedirectStandardOutput=$true; $p.StartInfo.RedirectStandardError=$true
    try {
        $null=$p.Start(); $stdout=$p.StandardOutput.ReadToEndAsync(); $stderr=$p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit(5000)) { $p.Kill(); throw 'nvidia-smi timeout' }
        if ($p.ExitCode -ne 0) { throw 'nvidia-smi failed' }
        $cards=@($stdout.GetAwaiter().GetResult() | ConvertFrom-Csv -Header index,name,total,used,free | ForEach-Object {
            @{index=$_.index.Trim();name=$_.name.Trim();totalMiB=$_.total.Trim();usedMiB=$_.used.Trim();freeMiB=$_.free.Trim()}
        })
        return @{available=$true;cards=$cards}
    } catch { return @{available=$false;reason=$_.Exception.Message;cards=@()} }
    finally { $p.Dispose() }
}
function Get-GpuMemorySnapshot {
    $rows=@(); $warnings=@(); $available=$false
    try {
        $samples=@(Convert-GpuMemoryCounters (Get-GpuMemoryCounters)); $available=$true
        $identity=Get-ResourceIdentity
        foreach ($sample in $samples) {
            $name='(exited / inaccessible)'; $category='readonly'
            try {
                $p=Get-Process -Id $sample.pid -ErrorAction Stop
                $name=$p.ProcessName+'.exe'
                $protected=$p.ProcessName -in @('dwm','csrss','winlogon','services','lsass','System','Registry','Memory Compression','explorer','ShellHost','StartMenuExperienceHost','SearchHost','TextInputHost','WindowsTerminal','cmd','powershell','pwsh','python','node','strata','strata-vision','Codex','msedgewebview2')
                if ($protected) { $category='protected' }
                elseif ($p.SessionId -eq $identity.session -and $p.ProcessName -in @($resourceApps.process)) { $category='allowlisted' }
            } catch { }
            $rows+=@{pid=$sample.pid;name=$name;adapter=$sample.adapter;dedicatedMiB=[math]::Round($sample.bytes/1MB,1);category=$category}
        }
    } catch { $warnings+=('WDDM counters unavailable: '+$_.Exception.Message) }
    $snapshot=@{time=[DateTime]::UtcNow.ToString('o');counterAvailable=$available;processes=$rows;nvidia=(Get-NvidiaMemorySnapshot);warnings=$warnings}
    Save-ResourceJson (Join-Path $resourceRoot 'gpu-last-scan.json') $snapshot
    return $snapshot
}
