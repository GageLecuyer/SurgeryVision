param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $root "backend"
$outputDir = Join-Path $backendPath "bin"
$outputFile = Join-Path $outputDir "ai-touchless-surgical-platform-backend.exe"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "go is not installed or not on PATH. Install Go and reopen your terminal."
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Push-Location $backendPath
try {
    go build -o $outputFile .
}
finally {
    Pop-Location
}

Write-Host "Built backend executable at $outputFile" -ForegroundColor Green
