import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DialogConfig {
  message: string;
  buttons: string[];
  cancelId?: number;
}

export function showDialogWindow(
  parent: BrowserWindow | null,
  config: DialogConfig,
): Promise<number> {
  return new Promise((resolve) => {
    const cancelId = config.cancelId ?? 1;
    let resolved = false;

    const settle = (index: number) => {
      if (!resolved) {
        resolved = true;
        resolve(index);
      }
    };

    const win = new BrowserWindow({
      width: 420,
      height: 170,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      parent: parent ?? undefined,
      modal: parent !== null,
      show: false,
      title: 'Mechvibes',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        preload: path.join(__dirname, '../preload/dialog.mjs'),
      },
    });

    win.removeMenu();
    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/dialog/index.html`);
    } else {
      win.loadFile(path.join(__dirname, '../../renderer/dialog/index.html'));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onResult = (_event: any, buttonIndex: number) => {
      ipcMain.removeListener('dialog-result', onResult);
      settle(buttonIndex);
      if (!win.isDestroyed()) win.close();
    };

    ipcMain.on('dialog-result', onResult);

    win.on('closed', () => {
      ipcMain.removeListener('dialog-result', onResult);
      settle(cancelId);
    });

    win.webContents.on('did-finish-load', () => {
      win.webContents.send('dialog-config', config);
    });

    win.on('ready-to-show', () => {
      win.show();
    });
  });
}
