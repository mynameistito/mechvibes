import { ipcMain, nativeTheme, app } from 'electron';
import log from 'electron-log';
import Store from 'electron-store';
import type { AppState } from '../app-state.js';
import StartupHandler from '../../main-only/startup-handler.js';
import { createTrayIcon, buildContextMenu } from './tray.js';
import type { TrayCallbacks } from './tray.js';
import { parseHotkey } from './hotkey.js';

export interface IpcDependencies {
  state: AppState;
  store: Store;
  startupHandler: StartupHandler;
  customDir: string;
  currentPackStoreId: string;
  muteHotkeyStoreId: string;
  defaultMuteHotkey: string;
  userDir: string;
  toggleMute: () => void;
  trayCallbacks: TrayCallbacks;
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  const {
    state, store, startupHandler,
    customDir, currentPackStoreId, muteHotkeyStoreId,
    defaultMuteHotkey, userDir, toggleMute, trayCallbacks,
  } = deps;

  ipcMain.handle('get-globals', () => ({
    custom_dir: customDir,
    current_pack_store_id: currentPackStoreId,
    app_version: app.getVersion(),
    is_packaged: app.isPackaged,
    resources_path: process.resourcesPath,
    active_volume: state.activeVolume.is_enabled,
  }));

  ipcMain.on('toggle-mute', () => {
    toggleMute();
  });

  ipcMain.on('get-mute-status', (event) => {
    event.reply('mechvibes-mute-status', state.muteState);
    event.reply('mute-hotkey', store.get(muteHotkeyStoreId, defaultMuteHotkey));
  });

  ipcMain.on('get-startup-status', (event) => {
    event.reply('startup-status', startupHandler.is_enabled);
  });

  ipcMain.on('set-startup', (_event, enabled: boolean) => {
    if (enabled) {
      startupHandler.enable();
    } else {
      startupHandler.disable();
    }
    if (state.tray !== null) {
      state.tray.setContextMenu(buildContextMenu(state, startupHandler, userDir, customDir, trayCallbacks));
    }
  });

  ipcMain.on('set-hotkey', (_event, hotkey: string) => {
    const parsed = parseHotkey(hotkey);
    if (!parsed) {
      log.warn(`Rejecting unsupported hotkey: ${hotkey}`);
      return;
    }
    if (state.parsedMuteHotkey) {
      for (const kc of state.parsedMuteHotkey.keycodes) {
        const key = String(kc);
        delete state.pressedKeys[key];
        if (state.watchdogTimers[key] !== undefined) {
          clearTimeout(state.watchdogTimers[key]);
          delete state.watchdogTimers[key];
        }
      }
    }
    store.set(muteHotkeyStoreId, hotkey);
    state.parsedMuteHotkey = parsed;
    state.hotkeyPhysicallyDown = false;
    log.info(`Mute hotkey updated to: ${hotkey}`);
  });

  ipcMain.on('set-theme', (_event, theme: string) => {
    if (!(['system', 'light', 'dark'] as const).includes(theme as 'system')) return;
    nativeTheme.themeSource = theme as 'system' | 'light' | 'dark';
  });

  ipcMain.on('show_tray_icon', (_event, show: boolean) => {
    if (show && state.tray === null) {
      createTrayIcon(state, startupHandler, userDir, customDir, trayCallbacks);
    } else if (!show && state.tray !== null) {
      state.tray.destroy();
      state.tray = null;
    }
  });

  const ALLOWED_LOG_LEVELS = new Set(['error', 'warn', 'info', 'verbose', 'debug', 'silly']);

  ipcMain.on('electron-log', (event, message: string, level: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const window_options = (event.sender as any).browserWindowOptions as { name?: string } | undefined;
    if (window_options?.name !== undefined && typeof window_options.name === 'string') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log as any).variables.sender = window_options.name;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log as any).variables.sender = 'u/w';
    }
    const safeLevel = typeof level === 'string' && ALLOWED_LOG_LEVELS.has(level) ? level : 'info';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (log as any)[safeLevel](message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (log as any).variables.sender = 'main';
  });

  ipcMain.on('resize-installer', (_event, size: number) => {
    if (!state.installer) return;
    const diff = state.installer.getSize()[1] - state.installer.getContentSize()[1];
    log.silly(`Installer requested ${size}, offset is ${diff}, so size is ${size + diff}`);
    state.installer.setSize(300, size + diff, true);
  });

  ipcMain.on('installed', (_event, packFolder: string) => {
    log.silly(`Installed ${packFolder}`);
    store.set(currentPackStoreId, 'custom-' + packFolder);
    state.win?.reload();
    state.installer?.close();
    state.installer = null;
  });
}