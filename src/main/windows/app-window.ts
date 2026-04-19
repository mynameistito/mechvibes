import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import type { AppState } from '../app-state.js';
import type { DebugState } from './debug-state.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAppWindow(show: boolean, state: AppState, debug: DebugState): BrowserWindow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.win = new BrowserWindow({
    width: 400,
    height: 720,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../../renderer/app/index.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
    show: false,
  } as Electron.BrowserWindowConstructorOptions & { name?: string });
  (state.win as unknown as { _name: string })._name = 'app';

  state.win.removeMenu();

  state.win.loadFile('./src/renderer/app/index.html');

  state.win.webContents.on('did-finish-load', () => {
    if (debug.enabled) {
      state.win!.webContents.send('debug-in-use', true);
    }
    state.win!.webContents.send('ava-toggle', state.activeVolume.is_enabled);
    state.win!.webContents.send('mechvibes-mute-status', state.mute.is_enabled);
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

  if (show) {
    state.win.show();
  }

  return state.win;
}