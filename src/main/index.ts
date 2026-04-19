import { app, nativeTheme, powerMonitor } from 'electron';
import * as path from 'path';
import fs from 'fs-extra';
import log from 'electron-log';
import Store from 'electron-store';
import StoreToggle from '../main-only/store-toggle.js';
import { parseHotkey } from './services/hotkey.js';
import { startVolumePolling } from './services/volume.js';
import { buildContextMenu, SYSTRAY_ICON, SYSTRAY_ICON_MUTED } from './services/tray.js';
import type { TrayCallbacks } from './services/tray.js';
import { initializeDebugAndLogging } from './services/debug-logging.js';
import { startKeyboardHooks } from './services/keyboard.js';
import { registerIpcHandlers } from './services/ipc-handlers.js';
import { checkAndMigrateStorage } from './services/storage-migration.js';
import StartupHandler from '../main-only/startup-handler.js';
import type { AppState } from './app-state.js';
import { createAppWindow } from './windows/app-window.js';
import { openEditorWindow } from './windows/editor-window.js';
import { openInstallWindow } from './windows/install-window.js';

// NOTE: Do not update electron-log, as we have a custom transport override which may not be compatible with newer versions.

const store = new Store();

function validateTheme(value: unknown): 'system' | 'light' | 'dark' {
  return (['system', 'light', 'dark'] as const).includes(value as 'system') ? value as 'system' | 'light' | 'dark' : 'system';
}
nativeTheme.themeSource = validateTheme(store.get('mechvibes-theme', 'system'));

const user_dir = app.getPath('userData');
const custom_dir = path.join(user_dir, '/custom');
const current_pack_store_id = 'mechvibes-pack';

const mute = new StoreToggle('mechvibes-muted', false);
const start_minimized = new StoreToggle('mechvibes-start-minimized', false);
const active_volume = new StoreToggle('mechvibes-active-volume', true);

const MUTE_HOTKEY_STORE_ID = 'mechvibes-mute-hotkey';
const DEFAULT_MUTE_HOTKEY = 'CommandOrControl+Shift+M';
const storage_prompted = new StoreToggle('mechvibes-migrate-asked', false);

const state: AppState = {
  win: null,
  tray: null,
  installer: null,
  debugWindow: null,
  editorWindow: null,
  isQuiting: false,
  muteState: mute.is_enabled,
  mute,
  startMinimized: start_minimized,
  activeVolume: active_volume,
  hotkeyPhysicallyDown: false,
  pressedKeys: {},
  watchdogTimers: {},
  sysCheckInterval: null,
  parsedMuteHotkey: null,
};

const { debug, debugConfigFile } = initializeDebugAndLogging(state, user_dir);

fs.ensureDirSync(custom_dir);

const gotTheLock = app.requestSingleInstanceLock();

const protocolCommands: Record<string, (...args: string[]) => void> = {
  install(packId: string) {
    if (state.installer === null) {
      log.debug(`Processing request to install ${packId}...`);
      openInstallWindow(packId, state);
    } else {
      state.installer.focus();
      state.installer.webContents.send('install-pack', packId);
    }
  },
};

function callProtocolCommand(command: string, ...args: string[]) {
  protocolCommands[command]?.(...args);
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (state.win) {
      if (process.platform === 'darwin') {
        app.dock?.show();
      } else {
        const url = commandLine.pop();
        if (url) {
          const command = decodeURI(url.slice('mechvibes://'.length)).split(' ');
          if (protocolCommands[command[0]]) {
            callProtocolCommand(...command as [string, ...string[]]);
          }
        }
      }
      if (state.win.isMinimized()) {
        state.win.restore();
      }
      state.win.show();
      state.win.focus();
    }
  });

  app.on('open-url', (_event, url) => {
    const command = decodeURI(url.slice('mechvibes://'.length)).split(' ');
    if (protocolCommands[command[0]]) {
      callProtocolCommand(...command as [string, ...string[]]);
    }
  });

  app.on('ready', () => {
    log.silly('Ready event has fired.');
    app.setAsDefaultProtocolClient('mechvibes');
    const startup_handler = new StartupHandler(app);

    log.silly('Creating main window for the first time...');
    if (startup_handler.was_started_at_login && state.startMinimized.is_enabled) {
      state.win = createAppWindow(false, state, debug);
    } else {
      state.win = createAppWindow(true, state, debug);
    }

    state.parsedMuteHotkey = parseHotkey(store.get(MUTE_HOTKEY_STORE_ID, DEFAULT_MUTE_HOTKEY) as string);
    state.muteState = mute.is_enabled;
    state.hotkeyPhysicallyDown = false;
    state.pressedKeys = {};
    state.watchdogTimers = {};

    state.sysCheckInterval = startVolumePolling(state, log, {
      onFatalError: () => {
        OnBeforeQuit();
        app.exit(1);
      },
    });

    startKeyboardHooks(state, toggleMute);

    function toggleMute() {
      state.muteState = !state.muteState;
      if (state.muteState) {
        state.mute.enable();
        for (const t of Object.values(state.watchdogTimers)) clearTimeout(t);
        state.watchdogTimers = {};
        state.pressedKeys = {};
      } else {
        state.mute.disable();
      }
      log.info(`Mute toggled: ${state.muteState}`);
      if (state.win && !state.win.isDestroyed()) {
        state.win.webContents.send('mechvibes-mute-status', state.muteState);
        if (state.muteState) {
          state.win.webContents.send('clear-pressed-keys');
        }
      }
      if (state.tray !== null) {
        state.tray.setImage(state.muteState ? SYSTRAY_ICON_MUTED : SYSTRAY_ICON);
        state.tray.setContextMenu(buildContextMenu(state, startup_handler, user_dir, custom_dir, trayCallbacks));
      }
    }

    const trayCallbacks: TrayCallbacks = {
      toggleMute,
      openEditorWindow: () => openEditorWindow(state),
      onQuit: () => {
        if (state.sysCheckInterval !== null) clearInterval(state.sysCheckInterval);
        state.isQuiting = true;
        app.quit();
      },
    };

    registerIpcHandlers({
      state,
      store,
      startupHandler: startup_handler,
      debug,
      debugConfigFile,
      customDir: custom_dir,
      currentPackStoreId: current_pack_store_id,
      muteHotkeyStoreId: MUTE_HOTKEY_STORE_ID,
      defaultMuteHotkey: DEFAULT_MUTE_HOTKEY,
      userDir: user_dir,
      toggleMute,
      trayCallbacks,
    });

    log.debug(`Platform: ${process.platform}`);
    log.info('App is ready and has been initialized');

    if (process.platform === 'darwin') {
      powerMonitor.on('shutdown', () => {
        app.quit();
      });
    }

    checkAndMigrateStorage({
      shouldCheck: !storage_prompted.is_enabled,
      markAsked: () => storage_prompted.enable(),
      homeDir: app.getPath('home'),
      customDir: custom_dir,
      win: state.win,
    });
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.on('window-all-closed', function () {
  log.silly('All windows were closed.');
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  log.silly('App has been activated');
  if (state.win === null) {
    createAppWindow(true, state, debug);
  } else {
    if (process.platform === 'darwin') {
      app.dock?.show();
    }
    if (state.win.isMinimized()) {
      state.win.restore();
    }
    state.win.show();
    state.win.focus();
  }
});

function OnBeforeQuit() {
  log.silly('Shutting down...');
}
app.on('before-quit', OnBeforeQuit);

app.on('quit', () => {
  log.silly('Goodbye.');
  app.quit();
});