[CmdletBinding()]
param(
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $Root "backend"

function Assert-Command {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$Hint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "缺少命令 '$Name'。$Hint"
    }
}

function Assert-LastExitCode {
    param([Parameter(Mandatory)][string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step 失败，退出码：$LASTEXITCODE"
    }
}

Assert-Command -Name "pnpm" -Hint "请安装 Node.js 与 pnpm。"
Assert-Command -Name "uv" -Hint "请安装 uv。"
Assert-Command -Name "cargo" -Hint "请安装 Rust 工具链。"
Assert-Command -Name "rustc" -Hint "请安装 Rust 工具链。"

try {
    $Host.UI.RawUI.WindowTitle = "Dataset Studio · 源码开发版"
} catch {
    # 非交互式终端可能不支持设置标题，不影响启动。
}

Push-Location $Root
try {
    Write-Host "[Dataset Studio] 检查前端依赖..." -ForegroundColor Cyan
    & pnpm install --frozen-lockfile --prefer-offline --reporter=append-only
    Assert-LastExitCode -Step "前端依赖同步"

    Write-Host "[Dataset Studio] 检查 Python 环境..." -ForegroundColor Cyan
    & uv sync --project $Backend --all-groups --locked
    Assert-LastExitCode -Step "Python 依赖同步"

    if ($CheckOnly) {
        Write-Host "[Dataset Studio] 开发环境检查通过。" -ForegroundColor Green
        return
    }

    Write-Host ""
    Write-Host "[Dataset Studio] 正在启动源码开发版..." -ForegroundColor Green
    Write-Host "首次启动需要编译桌面壳，之后会使用增量缓存。关闭窗口即可结束服务。"
    Write-Host ""

    & pnpm dev
    Assert-LastExitCode -Step "Dataset Studio"
} finally {
    Pop-Location
}
