# Sets up the ytx transcript server on Windows (PowerShell).
# Clones ytx into .\server\ytx and installs its dependencies. Safe to re-run.
#   powershell -ExecutionPolicy Bypass -File scripts\setup-ytx.ps1
$ErrorActionPreference = "Stop"

$YtxUrl = "https://github.com/Enayat-Hassani/youtube-transcript-extractor.git"
$Root   = Split-Path -Parent $PSScriptRoot
$Dest   = Join-Path $Root "server\ytx"

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "'uv' is not installed (ytx uses it to manage its Python env)." -ForegroundColor Red
    Write-Host "Install it, then re-run this script:"
    Write-Host '    powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
    Write-Host "(docs: https://docs.astral.sh/uv/)"
    exit 1
}

if (Test-Path (Join-Path $Dest ".git")) {
    Write-Host "Updating ytx in $Dest"
    git -C $Dest pull --ff-only
} else {
    Write-Host "Cloning ytx into $Dest"
    New-Item -ItemType Directory -Force -Path (Join-Path $Root "server") | Out-Null
    git clone $YtxUrl $Dest
}

Write-Host "Installing ytx dependencies (uv sync)..."
Push-Location $Dest
uv sync --all-packages
Pop-Location

Write-Host ""
Write-Host "ytx is ready." -ForegroundColor Green
Write-Host ""
Write-Host "Run it (leave it running in a terminal):"
Write-Host "    cd `"$Dest`"; uv run uvicorn ytx_api.main:app --host 127.0.0.1 --port 8722"
Write-Host ""
Write-Host "To keep it always-on, register a Task Scheduler task that runs the command"
Write-Host "above at logon (see the README). The extension expects http://localhost:8722."
