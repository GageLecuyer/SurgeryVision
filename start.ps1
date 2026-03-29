param(
    [switch]$SkipInstall
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $root "backend"
$frontendPath = Join-Path $root "frontend"

function Require-Command {
    param(
        [string]$Name,
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "$Name is not installed or not on PATH. $InstallHint"
        exit 1
    }
}

Require-Command -Name "go" -InstallHint "Install Go from https://go.dev/dl/"
Require-Command -Name "node" -InstallHint "Install Node.js from https://nodejs.org/"
Require-Command -Name "npm" -InstallHint "Install Node.js from https://nodejs.org/"

if (-not $SkipInstall) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Push-Location $frontendPath
    npm install
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Error "npm install failed."
        exit $LASTEXITCODE
    }
    Pop-Location
}

Write-Host "Starting backend on http://localhost:8080" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$backendPath'; go run ."
)

Write-Host "Starting frontend on http://localhost:5173" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$frontendPath'; npm run dev"
)

Write-Host ""
Write-Host "Both services were launched in new PowerShell windows." -ForegroundColor Yellow
Write-Host "Open http://localhost:5173 in your browser after the servers finish starting." -ForegroundColor Yellow
