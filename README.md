# AI Touchless Surgical Platform

A full-stack prototype with:

- React frontend dashboard
- Go backend API
- Electron desktop shell
- Gesture control simulation
- Voice control simulation
- Recording and playback controls
- Live overlays and alerts
- Web dashboard with system modes
- Risk detection visualization

## Structure

- `frontend/`: React + Vite dashboard
- `backend/`: Go API server
- `desktop/`: Electron desktop wrapper
- `scripts/`: build helpers

## Build a desktop app

This project can now be packaged as a Windows desktop application.

From the project root:

```powershell
npm install
npm run frontend:install
npm run desktop:pack
```

Or double-click:

- `Build Desktop App.cmd`

That build flow will:

- compile the Go backend into `backend/bin/ai-touchless-surgical-platform-backend.exe`
- build the React frontend into `frontend/dist`
- package everything into a Windows portable desktop app

After a successful build, look in:

- `release\`

The clickable desktop app will be created there as a `.exe`.

## Run the desktop app locally

To launch the Electron shell directly after building:

```powershell
npm run desktop:start
```

## Run the backend

```powershell
cd backend
go run .
```

The Go API starts on `http://localhost:8080`.

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite app starts on `http://localhost:5173` and talks to the backend on port `8080`.

## Start both with one command

From the project root:

```powershell
.\start.ps1
```

If PowerShell blocks scripts on your system, you can just double-click:

- `Launch AI Touchless Surgical Platform.bat`
- `Launch AI Touchless Surgical Platform.cmd`

Or run it from PowerShell/cmd:

```powershell
.\Launch AI Touchless Surgical Platform.bat
```

This will:

- check that `go`, `node`, and `npm` exist
- run `npm install` for the frontend
- open one PowerShell window for the backend
- open one PowerShell window for the frontend

If you already installed frontend dependencies and want a faster launch:

```powershell
.\start.ps1 -SkipInstall
```

## Included system modes

- `LOCKED`
- `ANALYSIS`
- `LIVE`

## Important setup note

If `go`, `node`, or `npm` are reported as missing even after installation, fully close and reopen PowerShell, Command Prompt, VS Code, and Visual Studio so Windows reloads your `PATH`.
