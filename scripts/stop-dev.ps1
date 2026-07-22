<#
.SYNOPSIS
Stops the Dataset Studio development process tree for this checkout.

.DESCRIPTION
Finds the exact scripts/start-dev.ps1 launcher and terminates only its process tree.
If the launcher has already exited, a conservative fallback finds known Dataset Studio
frontend, API, worker, desktop, and Rust processes rooted in this checkout.

.EXAMPLE
pwsh -NoProfile -File .\scripts\stop-dev.ps1

.EXAMPLE
pwsh -NoProfile -File .\scripts\stop-dev.ps1 -ListOnly

.EXAMPLE
pwsh -NoProfile -File .\scripts\stop-dev.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "Medium")]
param(
    [switch]$ListOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StartScript = Join-Path $PSScriptRoot "start-dev.ps1"
$HiddenLauncher = Join-Path $PSScriptRoot "start-dev-hidden.vbs"
$CurrentProcessId = $PID

function Test-ContainsPath {
    param(
        [AllowNull()]
        [string]$Value,
        [Parameter(Mandatory)]
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    return $Value.IndexOf($Path, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-PathWithinRoot {
    param(
        [AllowNull()]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$ExpectedRoot
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    $rootPrefix = $ExpectedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    return $Path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-KnownProjectProcess {
    param(
        [Parameter(Mandatory)]
        [object]$Process
    )

    $name = [string]$Process.Name
    $commandLine = [string]$Process.CommandLine
    $executablePath = [string]$Process.ExecutablePath
    $backendRoot = Join-Path $Root "backend\.venv"
    $nodeModulesRoot = Join-Path $Root "node_modules"
    $tauriTargetRoot = Join-Path $Root "src-tauri\target"

    if ($name -ieq "dataset-annotation-studio.exe") {
        return Test-PathWithinRoot -Path $executablePath -ExpectedRoot $tauriTargetRoot
    }

    if ($name -in @("dataset-studio-api.exe", "dataset-studio-worker.exe", "codex.exe")) {
        return Test-PathWithinRoot -Path $executablePath -ExpectedRoot $backendRoot
    }

    if ($name -ieq "python.exe") {
        return (Test-ContainsPath -Value $commandLine -Path (Join-Path $backendRoot "Scripts\dataset-studio-api.exe")) -or
            (Test-ContainsPath -Value $commandLine -Path (Join-Path $backendRoot "Scripts\dataset-studio-worker.exe"))
    }

    if ($name -ieq "node.exe") {
        return (Test-ContainsPath -Value $commandLine -Path (Join-Path $nodeModulesRoot "@tauri-apps")) -or
            (Test-ContainsPath -Value $commandLine -Path (Join-Path $nodeModulesRoot ".bin\..\@tauri-apps")) -or
            (Test-ContainsPath -Value $commandLine -Path (Join-Path $nodeModulesRoot "concurrently")) -or
            (Test-ContainsPath -Value $commandLine -Path (Join-Path $nodeModulesRoot ".bin\..\concurrently")) -or
            (Test-ContainsPath -Value $commandLine -Path (Join-Path $Root "frontend\node_modules"))
    }

    if ($name -ieq "esbuild.exe") {
        return Test-PathWithinRoot -Path $executablePath -ExpectedRoot $nodeModulesRoot
    }

    if ($name -ieq "rustc.exe") {
        return Test-ContainsPath -Value $commandLine -Path $tauriTargetRoot
    }

    return $false
}

$allProcesses = @(Get-CimInstance Win32_Process)
$processesById = @{}
$childrenByParentId = @{}

foreach ($process in $allProcesses) {
    $processId = [int]$process.ProcessId
    $parentProcessId = [int]$process.ParentProcessId
    $processesById[$processId] = $process

    if (-not $childrenByParentId.ContainsKey($parentProcessId)) {
        $childrenByParentId[$parentProcessId] = [Collections.Generic.List[object]]::new()
    }
    $childrenByParentId[$parentProcessId].Add($process)
}

$targetsById = @{}

function Add-Target {
    param(
        [Parameter(Mandatory)]
        [object]$Process,
        [Parameter(Mandatory)]
        [int]$Depth,
        [Parameter(Mandatory)]
        [string]$Reason
    )

    $processId = [int]$Process.ProcessId
    if ($processId -eq $CurrentProcessId) {
        return
    }

    if ($targetsById.ContainsKey($processId)) {
        $existing = $targetsById[$processId]
        if ($Depth -gt $existing.Depth) {
            $existing.Depth = $Depth
        }
        if ($existing.Reason -notlike "*$Reason*") {
            $existing.Reason = "$($existing.Reason)；$Reason"
        }
        return
    }

    $targetsById[$processId] = [pscustomobject]@{
        ProcessId = $processId
        ParentProcessId = [int]$Process.ParentProcessId
        Name = [string]$Process.Name
        CommandLine = [string]$Process.CommandLine
        Depth = $Depth
        Reason = $Reason
    }
}

function Add-ProcessTree {
    param(
        [Parameter(Mandatory)]
        [object]$RootProcess,
        [int]$BaseDepth = 0,
        [string]$Reason = "开发进程树"
    )

    $pending = [Collections.Generic.Stack[object]]::new()
    $pending.Push([pscustomobject]@{ Process = $RootProcess; Depth = $BaseDepth })

    while ($pending.Count -gt 0) {
        $item = $pending.Pop()
        $process = $item.Process
        $depth = [int]$item.Depth
        Add-Target -Process $process -Depth $depth -Reason $Reason

        $processId = [int]$process.ProcessId
        if (-not $childrenByParentId.ContainsKey($processId)) {
            continue
        }

        foreach ($child in $childrenByParentId[$processId]) {
            $pending.Push([pscustomobject]@{ Process = $child; Depth = $depth + 1 })
        }
    }
}

$launchers = @(
    $allProcesses | Where-Object {
        $_.Name -in @("pwsh.exe", "powershell.exe") -and
        (Test-ContainsPath -Value $_.CommandLine -Path $StartScript)
    }
)

foreach ($launcher in $launchers) {
    Add-ProcessTree -RootProcess $launcher -Reason "start-dev.ps1 启动的进程树"

    $parentProcessId = [int]$launcher.ParentProcessId
    if ($processesById.ContainsKey($parentProcessId)) {
        $parent = $processesById[$parentProcessId]
        if ($parent.Name -in @("wscript.exe", "cscript.exe") -and
            (Test-ContainsPath -Value $parent.CommandLine -Path $HiddenLauncher)) {
            # Stop the waiting VBS bridge first so force-stopping its child does not show a failure dialog.
            Add-Target -Process $parent -Depth ([int]::MaxValue) -Reason "双击启动桥接进程"
        }
    }
}

if ($launchers.Count -eq 0) {
    foreach ($process in $allProcesses) {
        if (-not (Test-KnownProjectProcess -Process $process)) {
            continue
        }

        Add-ProcessTree -RootProcess $process -Reason "保守匹配的 Dataset Studio 进程"

        if ($process.Name -ieq "rustc.exe") {
            $parentProcessId = [int]$process.ParentProcessId
            while ($processesById.ContainsKey($parentProcessId)) {
                $parent = $processesById[$parentProcessId]
                if ($parent.Name -ine "cargo.exe") {
                    break
                }
                Add-Target -Process $parent -Depth 1 -Reason "Dataset Studio Rust 编译父进程"
                $parentProcessId = [int]$parent.ParentProcessId
            }
        }
    }
}

$targets = @(
    $targetsById.Values |
        Sort-Object -Property @{ Expression = "Depth"; Descending = $true }, ProcessId
)

if ($targets.Count -eq 0) {
    Write-Host "[Dataset Studio] 没有发现正在运行的项目进程。" -ForegroundColor Green
    exit 0
}

Write-Host "[Dataset Studio] 将处理 $($targets.Count) 个项目进程：" -ForegroundColor Cyan
$targets |
    Select-Object ProcessId, ParentProcessId, Name, Reason |
    Format-Table -AutoSize

if ($ListOnly) {
    Write-Host "[Dataset Studio] 仅列出进程，未执行停止。" -ForegroundColor Yellow
    exit 0
}

$targetDescription = "$($targets.Count) 个 Dataset Studio 开发进程"
if (-not $PSCmdlet.ShouldProcess($targetDescription, "强制停止")) {
    exit 0
}

$stopErrors = [Collections.Generic.List[string]]::new()
foreach ($target in $targets) {
    try {
        Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
    } catch {
        if (Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue) {
            $stopErrors.Add("$($target.Name) (PID $($target.ProcessId))：$($_.Exception.Message)")
        }
    }
}

Start-Sleep -Milliseconds 400
$remaining = @(
    $targets | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
)

if ($remaining.Count -gt 0 -or $stopErrors.Count -gt 0) {
    $details = @($stopErrors)
    $details += $remaining | ForEach-Object { "$($_.Name) (PID $($_.ProcessId)) 仍在运行" }
    Write-Error "未能完全停止 Dataset Studio：$($details -join '；')"
    exit 1
}

Write-Host "[Dataset Studio] 已停止全部开发进程。" -ForegroundColor Green
