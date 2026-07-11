import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | undefined;

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: 'OCPP 客户端',
    backgroundColor: '#13202B',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? false
        : {
            color: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#e5edf7' : '#475569',
            height: 40
          },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  if (process.platform !== 'darwin') {
    window.removeMenu();
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => {
    if (!isDev) {
      event.preventDefault();
    }
  });

  registerIpc(window);

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  mainWindow = undefined;

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
