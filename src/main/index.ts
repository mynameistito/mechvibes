import { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeTheme, powerMonitor, dialog } from 'electron';
import { getVolume, getMute } from 'easy-volume';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import log from 'electron-log';
import Store from 'electron-store';
import { uIOhook } from 'uiohook-napi';
import type { UiohookKeyboardEvent } from 'uiohook-napi';
import { parseHotkey, matchesHotkey, type ParsedHotkey } from './services/hotkey.js';
import { TaggedError, Result } from 'better-result';
import StartupHandler from '../main-only/startup-handler.js';
import StoreToggle from '../main-only/store-toggle.js';
import * as IpcServer from '../main-only/ipc.js';
import remoteTransportFactory from '../main-only/electron-log/remote-transport.js';
import type { AppState } from './app-state.js';
import { createAppWindow } from './windows/app-window.js';
import { openEditorWindow } from './windows/editor-window.js';
import { openInstallWindow } from './windows/install-window.js';
import { createDebugWindow } from './windows/debug-window.js';
import type { DebugState } from './windows/debug-state.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// NOTE: Do not update electron-log, as we have a custom transport override which may not be compatible with newer versions.

const store = new Store();

class VolumeError extends TaggedError('volume')<{ message: string; source: 'get' | 'mute' }>() {}

function validateTheme(value: unknown): 'system' | 'light' | 'dark' {
  return (['system', 'light', 'dark'] as const).includes(value as 'system') ? value as 'system' | 'light' | 'dark' : 'system';
}
nativeTheme.themeSource = validateTheme(store.get('mechvibes-theme', 'system'));


const SYSTRAY_ICON = path.join(__dirname, '../../src/assets/system-tray-icon.png');
const SYSTRAY_ICON_MUTED = path.join(__dirname, '../../src/assets/system-tray-icon-muted.png');
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
};

const debugConfigFile = path.join(user_dir, '/remote-debug.json');

const debug: DebugState = {
  enabled: false,
  identifier: undefined,
  remoteUrl: 'https://beta.mechvibes.com/debug/ipc/',
  async enable() {
    this.enabled = true;
    const userInfo = {
      hostname: os.hostname(),
      username: os.userInfo().username,
      platform: os.platform(),
      version: app.getVersion(),
    };

    if (this.identifier === undefined) {
      const identifyResult = await IpcServer.identify(userInfo);
      if (Result.isOk(identifyResult) && identifyResult.value.success) {
        const json = identifyResult.value;
        this.identifier = json.identifier;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fs.writeJsonSync(debugConfigFile, { enabled: true, identifier: json.identifier });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (log.transports as any).remote.client.identifier = this.identifier;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (log.transports as any).remote.level = 'silly';
        const options = {
          enabled: debug.enabled,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          level: (log.transports as any).remote.level,
          identifier: debug.identifier,
        };
        if (state.debugWindow !== null) {
          state.debugWindow.webContents.send('debug-update', options);
        }
      } else {
        this.enabled = false;
        console.log(identifyResult);
      }
    } else {
      console.log('enabling early');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log.transports as any).remote.client.identifier = this.identifier;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log.transports as any).remote.level = 'silly';
      const validateResult = await IpcServer.validate(this.identifier, userInfo);
      if (!Result.isOk(validateResult) || !validateResult.value.success) {
        console.log('Failed validation');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (log.transports as any).remote.level = false;
        this.enabled = false;
        this.identifier = undefined;
        fs.unlinkSync(debugConfigFile);
      }
    }
    if (state.win !== null) {
      state.win.webContents.send('debug-in-use', true);
    }
  },
  disable() {
    this.enabled = false;
    this.identifier = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (log.transports as any).remote.level = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (log.transports as any).remote.client.identifier = undefined;
    fs.unlinkSync(debugConfigFile);
    if (state.win !== null) {
      state.win.webContents.send('debug-in-use', false);
    }
  },
};
void IpcServer.setRemoteUrl(debug.remoteUrl);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(log.transports as any).remote = remoteTransportFactory(log, debug.remoteUrl);

for (const transportName in log.transports) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log.transports as any)[transportName].transportName = transportName;
}

if (fs.existsSync(debugConfigFile)) {
  const json = JSON.parse(fs.readFileSync(debugConfigFile, 'utf8')) as { identifier?: string; enabled?: boolean };
  console.log(json);
  if (json.identifier) {
    debug.identifier = json.identifier;
    if (json.enabled) {
      debug.enable();
      console.log('enabled?');
    }
  } else {
    fs.unlinkSync(debugConfigFile);
  }
}

log.transports.file.fileName = 'mechvibes.log';
log.transports.file.level = 'info';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(log.transports.file as any).resolvePath = (variables: { libraryDefaultDir: string; fileName: string }) => {
  return path.join(variables.libraryDefaultDir, variables.fileName);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(log as any).variables.sender = 'main';
log.transports.console.format = '%c{h}:{i}:{s}.{ms}%c {sender} \u203a {text}';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(log.transports as any).file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]({sender}) {text}';

const LogTransportMap: Record<string, string> = {
  error: 'red', warn: 'yellow', info: 'cyan', debug: 'magenta', silly: 'green', default: 'unset',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
log.hooks.push((msg, transport: any) => {
  if ((transport as { transportName?: string })?.transportName === 'console') {
    return {
      ...msg,
      data: [`color: ${LogTransportMap[msg.level] ?? 'unset'}`, 'color: unset', ...msg.data],
    };
  }
  return msg;
});

fs.ensureDirSync(custom_dir);

const firstWindow = createAppWindow(false, state, debug);

const gotTheLock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (state.win) {
    if (process.platform === 'darwin') {
      app.dock?.show();
    }
    state.win.show();
    state.win.focus();
  }
});

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

    let parsedMuteHotkey = parseHotkey(store.get(MUTE_HOTKEY_STORE_ID, DEFAULT_MUTE_HOTKEY) as string);

    state.muteState = mute.is_enabled;
    state.hotkeyPhysicallyDown = false;
    state.pressedKeys = {};
    state.watchdogTimers = {};

    uIOhook.start();

    let volumeLevel = -1;
    let system_mute = false;
    let system_volume_error = false;

    const pollVolume = async (): Promise<Result<void, VolumeError>> => {
      return Result.tryPromise({
        try: async () => {
          const v = await getVolume();
          if (v !== volumeLevel) {
            volumeLevel = v;
            state.win?.webContents.send('system-volume-update', volumeLevel);
          }
        },
        catch: (e) => new VolumeError({ message: String(e), source: 'get' }),
      });
    };

    const pollMute = async (): Promise<Result<void, VolumeError>> => {
      return Result.tryPromise({
        try: async () => {
          const m = await getMute();
          if (m !== system_mute) {
            system_mute = m;
            state.win?.webContents.send('system-mute-status', system_mute);
          }
        },
        catch: (e) => new VolumeError({ message: String(e), source: 'mute' }),
      });
    };

    state.sysCheckInterval = setInterval(async () => {
      if (!state.muteState) {
        const volResult = await pollVolume();
        if (!Result.isOk(volResult)) {
          if (state.sysCheckInterval !== null) clearInterval(state.sysCheckInterval);
          const err = volResult.error.message;
          if (err === '' && !system_volume_error) {
            system_volume_error = true;
          }
          log.error(`Volume Error: ${err}`);
        }

        const muteResult = await pollMute();
        if (!Result.isOk(muteResult)) {
          if (state.sysCheckInterval !== null) clearInterval(state.sysCheckInterval);
          const err = muteResult.error.message;
          if (err === '' && !system_volume_error) {
            system_volume_error = true;
            OnBeforeQuit();
            app.exit(1);
          }
          log.error(`Mute Error: ${err}`);
        }
      }
    }, 3000);

    uIOhook.on('keydown', (event: UiohookKeyboardEvent) => {
      if (matchesHotkey(event, parsedMuteHotkey)) {
        if (!state.hotkeyPhysicallyDown) {
          state.hotkeyPhysicallyDown = true;
          toggleMute();
        }
        return;
      }
      const key = `${event.keycode}`;
      const isRepeat = !!state.pressedKeys[key];

      if (state.watchdogTimers[key]) clearTimeout(state.watchdogTimers[key]);
      state.watchdogTimers[key] = setTimeout(() => {
        delete state.pressedKeys[key];
        delete state.watchdogTimers[key];
      }, 2000);

      if (!state.muteState) {
        if (!isRepeat) {
          if (state.win && !state.win.isDestroyed()) {
            state.pressedKeys[key] = true;
            state.win.webContents.send('keydown', { ...event, isRepeat: false });
          }
        } else {
          if (state.win && !state.win.isDestroyed()) {
            state.win.webContents.send('keydown', { ...event, isRepeat: true });
          }
        }
      }
    });

    uIOhook.on('keyup', (event: UiohookKeyboardEvent) => {
      if (parsedMuteHotkey && parsedMuteHotkey.keycodes.includes(event.keycode)) {
        state.hotkeyPhysicallyDown = false;
      }
      const key = `${event.keycode}`;
      if (state.watchdogTimers[key]) {
        clearTimeout(state.watchdogTimers[key]);
        delete state.watchdogTimers[key];
      }
      if (!state.muteState) {
        state.pressedKeys[key] = false;
        if (state.win && !state.win.isDestroyed()) {
          state.win.webContents.send('keyup', event);
        }
      }
    });

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
        state.tray.setContextMenu(buildContextMenu());
      }
    }

    function buildContextMenu(): Electron.Menu {
      return Menu.buildFromTemplate([
        {
          label: 'Mechvibes',
          click: function () {
            if (process.platform === 'darwin') {
              app.dock?.show();
            }
            state.win!.show();
            state.win!.focus();
          },
        },
        {
          label: 'Editor',
          click: function () {
            openEditorWindow(state);
          },
        },
        {
          label: 'Folders',
          submenu: [
            {
              label: 'Custom Soundpacks',
              click: function () {
                shell.openPath(custom_dir).then((err) => {
                  if (err) log.error(err);
                });
              },
            },
            {
              label: 'Application Data',
              click: function () {
                shell.openPath(user_dir).then((err) => {
                  if (err) log.error(err);
                });
              },
            },
          ],
        },
        {
          label: 'Mute',
          type: 'checkbox',
          checked: state.muteState,
          click: function () {
            toggleMute();
          },
        },
        {
          label: 'Extras',
          submenu: [
            {
              label: 'Enable at Startup',
              type: 'checkbox',
              checked: startup_handler.is_enabled,
              click: function () {
                startup_handler.toggle();
              },
            },
            {
              label: 'Start Minimized',
              type: 'checkbox',
              checked: state.startMinimized.is_enabled,
              click: function () {
                state.startMinimized.toggle();
              },
            },
            {
              label: 'Active Volume Adjustment',
              type: 'checkbox',
              checked: state.activeVolume.is_enabled,
              click: function () {
                state.activeVolume.toggle();
                state.win?.webContents.send('ava-toggle', state.activeVolume.is_enabled);
              },
            },
          ],
        },
        {
          label: 'Quit',
          click: function () {
            if (state.sysCheckInterval !== null) clearInterval(state.sysCheckInterval);
            state.isQuiting = true;
            app.quit();
          },
        },
      ]);
    }

    function createTrayIcon() {
      if (state.tray !== null) return;
      state.tray = new Tray(state.muteState ? SYSTRAY_ICON_MUTED : SYSTRAY_ICON);
      state.tray.setToolTip('Mechvibes');
      const contextMenu = buildContextMenu();

      if (process.platform === 'darwin') {
        state.tray.on('click', () => {
          state.tray!.popUpContextMenu(buildContextMenu());
        });
        state.tray.on('right-click', () => {
          app.dock?.show();
          state.win!.show();
          state.win!.focus();
        });
      } else {
        state.tray.setContextMenu(contextMenu);
        state.tray.on('double-click', () => {
          state.win!.show();
          state.win!.focus();
        });
      }
    }

    ipcMain.handle('get-globals', () => ({
      custom_dir,
      current_pack_store_id,
      app_version: app.getVersion(),
      is_packaged: app.isPackaged,
      resources_path: process.resourcesPath,
    }));

    ipcMain.on('toggle-mute', () => {
      toggleMute();
    });

    ipcMain.on('get-mute-status', (event) => {
      event.reply('mechvibes-mute-status', state.muteState);
      event.reply('mute-hotkey', store.get(MUTE_HOTKEY_STORE_ID, DEFAULT_MUTE_HOTKEY));
    });

    ipcMain.on('get-startup-status', (event) => {
      event.reply('startup-status', startup_handler.is_enabled);
    });

    ipcMain.on('set-startup', (_event, enabled: boolean) => {
      if (enabled) {
        startup_handler.enable();
      } else {
        startup_handler.disable();
      }
      if (state.tray !== null) {
        state.tray.setContextMenu(buildContextMenu());
      }
    });

    ipcMain.on('set-hotkey', (_event, hotkey: string) => {
      const parsed = parseHotkey(hotkey);
      if (!parsed) {
        log.warn(`Rejecting unsupported hotkey: ${hotkey}`);
        return;
      }
      store.set(MUTE_HOTKEY_STORE_ID, hotkey);
      parsedMuteHotkey = parsed;
      state.hotkeyPhysicallyDown = false;
      log.info(`Mute hotkey updated to: ${hotkey}`);
    });

    ipcMain.on('set-theme', (_event, theme: string) => {
      if (!(['system', 'light', 'dark'] as const).includes(theme as 'system')) return;
      nativeTheme.themeSource = theme as 'system' | 'light' | 'dark';
      if (state.win && !state.win.isDestroyed() && typeof (state.win as unknown as Record<string, unknown>)['setTitleBarOverlay'] === 'function') {
        const useDark = nativeTheme.shouldUseDarkColors;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (state.win as any).setTitleBarOverlay({
          color: useDark ? '#1a1a1a' : '#f0f0f0',
          symbolColor: useDark ? '#e0e0e0' : '#333333',
        });
      }
    });

    ipcMain.on('show_tray_icon', (_event, show: boolean) => {
      if (show && state.tray === null) {
        createTrayIcon();
      } else if (!show && state.tray !== null) {
        state.tray.destroy();
        state.tray = null;
      } else if (!show && state.tray === null) {
        createTrayIcon();
      }
    });

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log as any)[level](message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log as any).variables.sender = 'main';
    });

    ipcMain.on('open-debug-options', () => {
      createDebugWindow(state, debug, debugConfigFile);
    });

    ipcMain.on('set-debug-options', (_event, json: { enabled: boolean }) => {
      if (json.enabled && !debug.enabled) {
        debug.enable();
      } else if (!json.enabled && debug.enabled) {
        debug.disable();
      }
    });

    ipcMain.on('resize-installer', (_event, size: number) => {
      if (!state.installer) return;
      const diff = state.installer.getSize()[1] - state.installer.getContentSize()[1];
      log.silly(`Installer requested ${size}, offset is ${diff}, so size is ${size + diff}`);
      state.installer.setSize(300, size + diff, true);
    });

    ipcMain.on('installed', (_event, packFolder: string) => {
      log.silly(`Installed ${packFolder}`);
      store.set(current_pack_store_id, 'custom-' + packFolder);
      state.win?.reload();
      state.installer?.close();
      state.installer = null;
    });

    log.debug(`Platform: ${process.platform}`);
    log.info('App is ready and has been initialized');

    if (process.platform === 'darwin') {
      powerMonitor.on('shutdown', () => {
        app.quit();
      });
    }

    if (storage_prompted.is_enabled) {
      const home_dir = app.getPath('home');
      const old_custom_dir = path.join(home_dir, '/mechvibes_custom');
      if (fs.existsSync(old_custom_dir)) {
        log.debug('Old custom directory exists, prompting user for migration...');
        const response = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['Yes', 'Not right now', "Don't ask again"],
          title: 'Mechvibes',
          message: "Soundpacks have moved to a new location, do you want to migrate your old soundpacks to the new location? We'll only ask you this once.",
          defaultId: 0,
          cancelId: 1,
        });

        if (response === 0) {
          log.debug('User requested migration, migrating...');
          const oldCustomFiles = fs.readdirSync(old_custom_dir);
          oldCustomFiles.forEach((file) => {
            const sourcePath = path.join(old_custom_dir, file);
            const destinationPath = path.join(custom_dir, file);
            log.silly(`Moving ${sourcePath.replace(home_dir, '~')} to ${destinationPath.replace(home_dir, '~')}`);
            fs.moveSync(sourcePath, destinationPath, { overwrite: true });
          });
          log.silly('Removing old custom directory...');
          fs.removeSync(old_custom_dir);
          log.debug('Migration complete.');
          state.win?.reload();
        } else if (response === 2) {
          storage_prompted.enable();
        }
      }
    }
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
  app.removeAsDefaultProtocolClient('mechvibes');
}
app.on('before-quit', OnBeforeQuit);

app.on('quit', () => {
  log.silly('Goodbye.');
  app.quit();
});