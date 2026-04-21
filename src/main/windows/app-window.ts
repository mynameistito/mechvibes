import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import type { AppState } from '../app-state.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAppWindow(show: boolean, state: AppState, darkMode: boolean): BrowserWindow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.win = new BrowserWindow({
    width: 400,
    height: 720,
    resizable: false,
    name: 'app',
    backgroundColor: darkMode ? '#1a1a1a' : '#ffffff',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
    show: false,
  } as Electron.BrowserWindowConstructorOptions & { name?: string });

  state.win.removeMenu();

  const themeParam = darkMode ? 'dark' : 'light';
  if (process.env.ELECTRON_RENDERER_URL) {
    state.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/app/index.html?theme=${themeParam}`);
  } else {
    state.win.loadFile(path.join(__dirname, '../renderer/app/index.html'), { query: { theme: themeParam } });
  }

  state.win.webContents.on('did-finish-load', () => {
    state.win!.webContents.send('ava-toggle', state.activeVolume.is_enabled);
    state.win!.webContents.send('mechvibes-mute-status', state.mute.is_enabled);
  });

  state.win.once('ready-to-show', () => {
    if (show) state.win!.show();
  });

  state.win.on('closed', function () {
    state.win = null;
  });

  state.win.on('close', function (event) {
    if (!state.isQuiting) {
      if (process.platform === 'darwin') {
        app.dock?.hide();
      }
      event.preventDefault();
      state.win!.hide();
    }
  });

  state.win.on('unresponsive', () => {
    console.log('unresponsive');
  });

  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    state.win.webContents.openDevTools({ mode: 'detach' });
  }

  return state.win;
}
