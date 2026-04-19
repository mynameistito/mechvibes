import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import type { AppState } from '../app-state.js';
import type { DebugState } from './debug-state.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { type DebugState } from './debug-state.js';

export function createDebugWindow(state: AppState, debug: DebugState, debugConfigFile: string): void {
  if (state.debugWindow) {
    state.debugWindow.focus();
    return;
  }

  state.debugWindow = new BrowserWindow({
    width: 350,
    height: 500,
    useContentSize: false,
    webPreferences: {
      preload: path.join(__dirname, '../../renderer/debug/index.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
    show: false,
    parent: state.win ?? undefined,
  });

  state.debugWindow.removeMenu();
  state.debugWindow.loadFile('./src/renderer/debug/index.html');

  state.debugWindow.webContents.on('did-finish-load', () => {
    const options = {
      enabled: debug.enabled,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      level: (log.transports as any).remote.level,
      identifier: debug.identifier,
    };
    state.debugWindow!.webContents.send('debug-options', options);
  });

  const handleFetchDebugOptions = () => {
    const options = { ...debug, path: debugConfigFile };
    state.debugWindow?.webContents.send('debug-options', options);
  };
  ipcMain.on('fetch-debug-options', handleFetchDebugOptions);

  state.debugWindow.on('ready-to-show', () => {
    state.debugWindow!.show();
  });

  state.debugWindow.on('closed', function () {
    ipcMain.removeListener('fetch-debug-options', handleFetchDebugOptions);
    state.debugWindow = null;
  });
}