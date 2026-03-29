@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not on PATH. Reopen your terminal after installing Node.js.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not on PATH. Reopen your terminal after installing Node.js.
  pause
  exit /b 1
)

where go >nul 2>nul
if errorlevel 1 (
  echo Go is not on PATH. Reopen your terminal after installing Go.
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  pause
  exit /b 1
)

call npm run frontend:install
if errorlevel 1 (
  pause
  exit /b 1
)

call npm run desktop:pack
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Desktop build complete. Look in the release folder.
pause

endlocal
