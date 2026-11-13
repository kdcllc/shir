# Headless launch smoke (Windows PowerShell 5.1 and pwsh 7). Keep this file pure ASCII.
# Runs -Binary with SHIR_SMOKE=1 and requires exit 0 plus a line exactly SHIR_READY
# before -TimeoutSec seconds. Exit codes: 0 pass, 1 fail, 2 usage.
param(
    [string]$Binary = '',
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = 'Stop'

$usage = 'usage: smoke-launch.ps1 -Binary <path> [-TimeoutSec 120]'

if ([string]::IsNullOrEmpty($Binary) -or -not (Test-Path -LiteralPath $Binary -PathType Leaf)) {
    [Console]::Error.WriteLine($usage)
    exit 2
}

$full = (Resolve-Path -LiteralPath $Binary).Path
$isWin = ($env:OS -eq 'Windows_NT')

# Mirror the bash script: off Windows, a file without the owner exec bit is a usage
# error. Probe for File.GetUnixFileMode (.NET 7+) instead of catching a missing method,
# and check before any temp file exists so this exit path leaks nothing.
if (-not $isWin) {
    $modeApi = [System.IO.File].GetMethod('GetUnixFileMode', [type[]]@([string]))
    if ($null -ne $modeApi) {
        $mode = [int][System.IO.File]::GetUnixFileMode($full)
        if (($mode -band 64) -eq 0) {
            [Console]::Error.WriteLine($usage)
            exit 2
        }
    }
}

$outLog = [System.IO.Path]::GetTempFileName()
$errLog = [System.IO.Path]::GetTempFileName()
$env:SHIR_SMOKE = '1'

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$reason = ''
$p = $null
try {
    try {
        $p = Start-Process -FilePath $full -PassThru -NoNewWindow `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    } catch {
        [Console]::Error.WriteLine($usage)
        Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
        exit 2
    }
    # Touching Handle right after start keeps ExitCode readable after exit.
    $null = $p.Handle
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        $reason = 'timeout'
        if ($isWin) {
            & taskkill /T /F /PID $p.Id *> $null
        } else {
            $p.Kill()
        }
        $null = $p.WaitForExit(5000)
    } else {
        $p.WaitForExit()
        $code = $p.ExitCode
        if ($code -ne 0) {
            $reason = "exit $code"
        }
    }
} catch {
    $reason = "exit launch error: $($_.Exception.Message)"
}
$sw.Stop()

$lines = @()
foreach ($f in @($outLog, $errLog)) {
    $lines += @(Get-Content -LiteralPath $f -ErrorAction SilentlyContinue)
}

if ($reason -eq '') {
    $ready = @($lines | Where-Object { $_.TrimEnd("`r") -ceq 'SHIR_READY' })
    if ($ready.Count -eq 0) {
        $reason = 'no SHIR_READY marker'
    }
}

Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

if ($reason -ne '') {
    [Console]::Out.WriteLine("smoke: FAIL - $reason")
    $lines | Select-Object -Last 50 | ForEach-Object { [Console]::Out.WriteLine($_) }
    exit 1
}

$secs = [int][math]::Floor($sw.Elapsed.TotalSeconds)
[Console]::Out.WriteLine("smoke: PASS (${secs}s)")
exit 0
