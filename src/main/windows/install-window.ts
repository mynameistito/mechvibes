import { BrowserWindow } from 'electron';
import * as path from 'path';
import type { AppState } from '../app-state.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openInstallWindow(packId: string, state: AppState): void {
  state.installer = new BrowserWindow({
    width: 300,
    height: 200,
    useContentSize: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
    show: false,
    parent: state.win ?? undefined,
  });

  state.installer.removeMenu();
  if (process.env.ELECTRON_RENDERER_URL) {
    state.installer.loadURL(`${process.env.ELECTRON_RENDERER_URL}/install/index.html`);
  } else {
    state.installer.loadFile(path.join(__dirname, '../../renderer/install/index.html'));
  }

  state.installer.webContents.on('did-finish-load', () => {
    state.installer!.webContents.send('install-pack', packId);
  });

  state.installer.on('ready-to-show', () => {
    state.installer!.show();
  });

  state.installer.on('closed', function () {
    state.installer = null;
  });
}