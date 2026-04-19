import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onDialogConfig: (cb: (cfg: { message: string; buttons: string[] }) => void) => {
    ipcRenderer.on('dialog-config', (_e, cfg) => cb(cfg));
  },
  sendDialogResult: (index: number) => {
    ipcRenderer.send('dialog-result', index);
  },
});
