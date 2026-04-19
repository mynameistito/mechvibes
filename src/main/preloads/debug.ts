import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onDebugOptions: (cb: (opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => void) => {
    ipcRenderer.once('debug-options', (_e, opts) => cb(opts));
  },
  onDebugUpdate: (cb: (opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => void) => {
    ipcRenderer.on('debug-update', (_e, opts) => cb(opts));
  },
  setDebugOptions: (opts: { enabled: boolean; identifier: string | undefined; level?: string | false }) => {
    ipcRenderer.send('set-debug-options', opts);
  },
});
