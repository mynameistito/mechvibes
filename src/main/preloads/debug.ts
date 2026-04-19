import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onDebugOptions: (cb: (opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => void) => {
    ipcRenderer.once('debug-options', (_e, opts) => cb(opts));
  },
  onDebugUpdate: (cb: (opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => cb(opts);
    ipcRenderer.on('debug-update', handler);
    return () => ipcRenderer.removeListener('debug-update', handler);
  },
  setDebugOptions: (opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => {
    ipcRenderer.send('set-debug-options', opts);
  },
});
