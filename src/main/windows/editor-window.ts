import { BrowserWindow, nativeTheme } from 'electron';
import * as path from 'path';
import type { AppState } from '../app-state.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openEditorWindow(state: AppState): void {
  if (state.editorWindow) {
    state.editorWindow.focus();
    return;
  }

  state.editorWindow = new BrowserWindow({
    width: 1200,
    height: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: true,
    },
  });

  const themeParam = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  if (process.env.ELECTRON_RENDERER_URL) {
    state.editorWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/editor/index.html?theme=${themeParam}`);
  } else {
    state.editorWindow.loadFile(path.join(__dirname, '../renderer/editor/index.html'), { query: { theme: themeParam } });
  }

  state.editorWindow.once('ready-to-show', () => {
    state.editorWindow?.show();
  });

  state.editorWindow.on('closed', function () {
    state.editorWindow = null;
  });
}