const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BACKEND_PORT = process.env.PORT || '8080';
let backendProcess = null;

function resolveBackendExecutable() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'ai-touchless-surgical-platform-backend.exe');
  }

  return path.join(app.getAppPath(), 'backend', 'bin', 'ai-touchless-surgical-platform-backend.exe');
}

function resolveFrontendEntry() {
  return path.join(app.getAppPath(), 'frontend', 'dist', 'index.html');
}

function waitForBackend(timeoutMs = 15000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const request = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/platform/state`, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Timed out waiting for the backend server.'));
          return;
        }

        setTimeout(tryConnect, 300);
      });
    };

    tryConnect();
  });
}

async function startBackend() {
  const backendExecutable = resolveBackendExecutable();

  if (!fs.existsSync(backendExecutable)) {
    throw new Error(`Backend executable not found at ${backendExecutable}. Build the desktop app first.`);
  }

  backendProcess = spawn(backendExecutable, [], {
    env: { ...process.env, PORT: BACKEND_PORT },
    stdio: 'ignore',
    windowsHide: true
  });

  backendProcess.on('exit', (code) => {
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox(
        'Backend stopped',
        `The Go backend exited unexpectedly with code ${code}.`
      );
    }
  });

  await waitForBackend();
}

function createWindow() {
  const frontendEntry = resolveFrontendEntry();
  if (!fs.existsSync(frontendEntry)) {
    throw new Error(`Frontend build not found at ${frontendEntry}. Build the desktop app first.`);
  }

  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#08111f',
    autoHideMenuBar: true,
    title: 'AI Touchless Surgical Platform',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(frontendEntry);
}

async function bootstrap() {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Startup failed', error.message);
    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
