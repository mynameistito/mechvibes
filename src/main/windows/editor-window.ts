import { BrowserWindow } from 'electron';
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      webSecurity: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    state.editorWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/editor/index.html`);
  } else {
    state.editorWindow.loadFile(path.join(__dirname, '../../renderer/editor/index.html'));
  }

  state.editorWindow.on('closed', function () {
    state.editorWindow = null;
  });
}