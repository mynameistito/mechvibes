import { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeTheme } from 'electron';
import { getVolume, getMute } from 'easy-volume';
import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import log from 'electron-log';
import Store from 'electron-store';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { UiohookKeyboardEvent } from 'uiohook-napi';
import { TaggedError, Result } from 'better-result';

// NOTE: Do not update electron-log, as we have a custom transport override which may not be compatible with newer versions.

const store = new Store();

class VolumeError extends TaggedError('volume')<{ message: string; source: 'get' | 'mute' }>() {}

function validateTheme(value: unknown): 'system' | 'light' | 'dark' {
  return (['system', 'light', 'dark'] as const).includes(value as 'system') ? value as 'system' | 'light' | 'dark' : 'system';
}
nativeTheme.themeSource = validateTheme(store.get('mechvibes-theme', 'system'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const StartupHandler = require('./utils/startup_handler') as new (app: Electron.App) => {
  was_started_at_login: boolean;
  is_enabled: boolean;
  enable(): void;
  disable(): void;
  toggle(): void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StoreToggle = require('./utils/store_toggle') as new (key: string, defaultValue: boolean) => {
  is_enabled: boolean;
  enable(): void;
  disable(): void;
  toggle(): void;
};

const SYSTRAY_ICON = path.join(__dirname, '../src/assets/system-tray-icon.png');
const SYSTRAY_ICON_MUTED = path.join(__dirname, '../src/assets/system-tray-icon-muted.png');
const user_dir = app.getPath('userData');
const custom_dir = path.join(user_dir, '/custom');
const current_pack_store_id = 'mechvibes-pack';

const mute = new StoreToggle('mechvibes-muted', false);
const start_minimized = new StoreToggle('mechvibes-start-minimized', false);
const active_volume = new StoreToggle('mechvibes-active-volume', true);

const MUTE_HOTKEY_STORE_ID = 'mechvibes-mute-hotkey';
const DEFAULT_MUTE_HOTKEY = 'CommandOrControl+Shift+M';
const storage_prompted = new StoreToggle('mechvibes-migrate-asked', false);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const IpcServer = require('./utils/ipc') as {
  setRemoteUrl(url: string): void;
  identify(userInfo: unknown): Promise<{ success: boolean; identifier?: string }>;
  validate(identifier: string, userInfo: unknown): Promise<{ success: boolean }>;
};

interface DebugState {
  enabled: boolean;
  identifier: string | undefined;
  remoteUrl: string;
  enable(): Promise<void>;
  disable(): void;
}

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
      const json = await IpcServer.identify(userInfo);
      if (json.success) {
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
        if (debugWindow !== null) {
          debugWindow.webContents.send('debug-update', options);
        }
      } else {
        this.enabled = false;
        console.log(json);
      }
    } else {
      console.log('enabling early');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log.transports as any).remote.client.identifier = this.identifier;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log.transports as any).remote.level = 'silly';
      const json = await IpcServer.validate(this.identifier, userInfo);
      if (!json.success) {
        console.log('Failed validation');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (log.transports as any).remote.level = false;
        this.enabled = false;
        this.identifier = undefined;
        fs.unlinkSync(debugConfigFile);
      }
    }
    if (win !== null) {
      win.webContents.send('debug-in-use', true);
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
    if (win !== null) {
      win.webContents.send('debug-in-use', false);
    }
  },
};
IpcServer.setRemoteUrl(debug.remoteUrl);

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
(log.transports as any).remote = require('./libs/electron-log/transports/remote')(log, debug.remoteUrl);

for (const transportName in log.transports) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log.transports as any)[transportName].transportName = transportName;
}

const debugConfigFile = path.join(user_dir, '/remote-debug.json');
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
log.transports.console.format = '%c{h}:{i}:{s}.{ms}%c {sender} › {text}';
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

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuiting = false;

fs.ensureDirSync(custom_dir);

function createWindow(show = false): BrowserWindow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  win = new BrowserWindow({
    width: 400,
    height: 720,
    backgroundThrottling: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'app.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
    show: false,
  } as Electron.BrowserWindowConstructorOptions & { name?: string });
  (win as unknown as { _name: string })._name = 'app';

  win.removeMenu();

  if (typeof (win as unknown as Record<string, unknown>)['setTitleBarOverlay'] === 'function') {
    const isDark = nativeTheme.shouldUseDarkColors;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (win as any).setTitleBarOverlay({
      color: isDark ? '#1a1a1a' : '#f0f0f0',
      symbolColor: isDark ? '#e0e0e0' : '#333333',
    });
  }

  win.loadFile('./src/app.html');

  win.webContents.on('did-finish-load', () => {
    if (debug.enabled) {
      win!.webContents.send('debug-in-use', true);
    }
    win!.webContents.send('ava-toggle', active_volume.is_enabled);
    win!.webContents.send('mechvibes-mute-status', mute.is_enabled);
  });

  win.on('closed', function () {
    win = null;
  });

  win.on('close', function (event) {
    if (!isQuiting) {
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
      event.preventDefault();
      win!.hide();
    }
    return false;
  });

  win.on('unresponsive', () => {
    log.warn('Window has entered unresponsive state');
    console.log('unresponsive');
  });

  if (show) {
    win.show();
  } else {
    win.close();
  }

  return win;
}

let installer: BrowserWindow | null = null;
function openInstallWindow(packId: string) {
  installer = new BrowserWindow({
    width: 300,
    height: 200,
    useContentSize: false,
    webPreferences: {
      preload: path.join(__dirname, 'install.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
    show: false,
    parent: win ?? undefined,
  });

  installer.removeMenu();
  installer.loadFile('./src/install.html');

  installer.webContents.on('did-finish-load', () => {
    installer!.webContents.send('install-pack', packId);
  });

  installer.on('ready-to-show', () => {
    installer!.show();
  });

  installer.on('closed', function () {
    installer = null;
  });
}

let debugWindow: BrowserWindow | null = null;
function createDebugWindow() {
  debugWindow = new BrowserWindow({
    width: 350,
    height: 500,
    useContentSize: false,
    webPreferences: {
      preload: path.join(__dirname, 'debug.js'),
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false,
    },
    show: false,
    parent: win ?? undefined,
  });

  debugWindow.removeMenu();
  debugWindow.loadFile('./src/debug.html');

  debugWindow.webContents.on('did-finish-load', () => {
    const options = {
      enabled: debug.enabled,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      level: (log.transports as any).remote.level,
      identifier: debug.identifier,
    };
    debugWindow!.webContents.send('debug-options', options);
  });

  ipcMain.on('fetch-debug-options', () => {
    const options = { ...debug, path: debugConfigFile };
    debugWindow?.webContents.send('debug-options', options);
  });

  debugWindow.on('ready-to-show', () => {
    debugWindow!.show();
  });

  debugWindow.on('closed', function () {
    debugWindow = null;
  });
}

const gotTheLock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (win) {
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    win.show();
    win.focus();
  }
});

const protocolCommands: Record<string, (...args: string[]) => void> = {
  install(packId: string) {
    if (installer === null) {
      log.debug(`Processing request to install ${packId}...`);
      openInstallWindow(packId);
    } else {
      installer.focus();
      installer.webContents.send('install-pack', packId);
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
    if (win) {
      if (process.platform === 'darwin') {
        app.dock.show();
      } else {
        const url = commandLine.pop();
        if (url) {
          const command = decodeURI(url.slice('mechvibes://'.length)).split(' ');
          if (protocolCommands[command[0]]) {
            callProtocolCommand(...command as [string, ...string[]]);
          }
        }
      }
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();
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
    if (startup_handler.was_started_at_login && start_minimized.is_enabled) {
      win = createWindow(false);
    } else {
      win = createWindow(true);
    }

    const KEY_NAME_TO_CODES: Record<string, number[]> = {
      '1': [UiohookKey[1]], '2': [UiohookKey[2]], '3': [UiohookKey[3]], '4': [UiohookKey[4]],
      '5': [UiohookKey[5]], '6': [UiohookKey[6]], '7': [UiohookKey[7]], '8': [UiohookKey[8]],
      '9': [UiohookKey[9]], '0': [UiohookKey[0]],
      'A': [UiohookKey.A], 'B': [UiohookKey.B], 'C': [UiohookKey.C], 'D': [UiohookKey.D],
      'E': [UiohookKey.E], 'F': [UiohookKey.F], 'G': [UiohookKey.G], 'H': [UiohookKey.H],
      'I': [UiohookKey.I], 'J': [UiohookKey.J], 'K': [UiohookKey.K], 'L': [UiohookKey.L],
      'M': [UiohookKey.M], 'N': [UiohookKey.N], 'O': [UiohookKey.O], 'P': [UiohookKey.P],
      'Q': [UiohookKey.Q], 'R': [UiohookKey.R], 'S': [UiohookKey.S], 'T': [UiohookKey.T],
      'U': [UiohookKey.U], 'V': [UiohookKey.V], 'W': [UiohookKey.W], 'X': [UiohookKey.X],
      'Y': [UiohookKey.Y], 'Z': [UiohookKey.Z],
      'F1': [UiohookKey.F1], 'F2': [UiohookKey.F2], 'F3': [UiohookKey.F3], 'F4': [UiohookKey.F4],
      'F5': [UiohookKey.F5], 'F6': [UiohookKey.F6], 'F7': [UiohookKey.F7], 'F8': [UiohookKey.F8],
      'F9': [UiohookKey.F9], 'F10': [UiohookKey.F10], 'F11': [UiohookKey.F11], 'F12': [UiohookKey.F12],
      'Space': [UiohookKey.Space], 'Tab': [UiohookKey.Tab], 'Backspace': [UiohookKey.Backspace],
      'Return': [UiohookKey.Enter], 'Escape': [UiohookKey.Escape], 'CapsLock': [UiohookKey.CapsLock],
      'PrintScreen': [UiohookKey.PrintScreen], 'ScrollLock': [UiohookKey.ScrollLock],
      ...(process.platform === 'win32' ? {
        'Up': [UiohookKey.NumpadArrowUp], 'Down': [UiohookKey.NumpadArrowDown],
        'Left': [UiohookKey.NumpadArrowLeft], 'Right': [UiohookKey.NumpadArrowRight],
        'Home': [UiohookKey.NumpadHome], 'End': [UiohookKey.NumpadEnd],
        'PageUp': [UiohookKey.NumpadPageUp], 'PageDown': [UiohookKey.NumpadPageDown],
        'Insert': [UiohookKey.NumpadInsert], 'Delete': [UiohookKey.NumpadDelete],
      } : {
        'Up': [UiohookKey.ArrowUp], 'Down': [UiohookKey.ArrowDown],
        'Left': [UiohookKey.ArrowLeft], 'Right': [UiohookKey.ArrowRight],
        'Home': [UiohookKey.Home], 'End': [UiohookKey.End],
        'PageUp': [UiohookKey.PageUp], 'PageDown': [UiohookKey.PageDown],
        'Insert': [UiohookKey.Insert], 'Delete': [UiohookKey.Delete],
      }),
    };

    interface ParsedHotkey {
      keycodes: number[];
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
      meta: boolean;
    }

    function parseHotkey(hotkey: string): ParsedHotkey | null {
      if (!hotkey || hotkey === '-') return null;
      const parts = hotkey.split('+');
      const keyName = parts[parts.length - 1];
      const mods = parts.slice(0, -1);
      const isCtrl = mods.includes('CommandOrControl') || mods.includes('Ctrl');
      const isMeta = mods.includes('Meta') || mods.includes('Command') ||
                     (process.platform === 'darwin' && mods.includes('CommandOrControl'));
      const keycodes = KEY_NAME_TO_CODES[keyName];
      if (!keycodes || keycodes.length === 0) return null;
      return {
        keycodes,
        ctrl: isCtrl && process.platform !== 'darwin',
        shift: mods.includes('Shift'),
        alt: mods.includes('Alt'),
        meta: isMeta,
      };
    }

    function matchesHotkey(event: UiohookKeyboardEvent, parsed: ParsedHotkey | null): boolean {
      if (!parsed || parsed.keycodes.length === 0) return false;
      return parsed.keycodes.includes(event.keycode) &&
             !!event.ctrlKey === parsed.ctrl &&
             !!event.shiftKey === parsed.shift &&
             !!event.altKey === parsed.alt &&
             !!event.metaKey === parsed.meta;
    }

    let parsedMuteHotkey = parseHotkey(store.get(MUTE_HOTKEY_STORE_ID, DEFAULT_MUTE_HOTKEY) as string);

    let muteState = mute.is_enabled;
    let hotkeyPhysicallyDown = false;
    let pressedKeys: Record<string, boolean> = {};
    let watchdogTimers: Record<string, ReturnType<typeof setTimeout>> = {};

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
            win?.webContents.send('system-volume-update', volumeLevel);
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
            win?.webContents.send('system-mute-status', system_mute);
          }
        },
        catch: (e) => new VolumeError({ message: String(e), source: 'mute' }),
      });
    };

    const sys_check_interval = setInterval(async () => {
      if (!muteState) {
        const volResult = await pollVolume();
        if (!Result.isOk(volResult)) {
          clearInterval(sys_check_interval);
          const err = volResult.error.message;
          if (err === '' && !system_volume_error) {
            system_volume_error = true;
          }
          log.error(`Volume Error: ${err}`);
        }

        const muteResult = await pollMute();
        if (!Result.isOk(muteResult)) {
          clearInterval(sys_check_interval);
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
        if (!hotkeyPhysicallyDown) {
          hotkeyPhysicallyDown = true;
          toggleMute();
        }
        return;
      }
      const key = `${event.keycode}`;
      const isRepeat = !!pressedKeys[key];

      if (watchdogTimers[key]) clearTimeout(watchdogTimers[key]);
      watchdogTimers[key] = setTimeout(() => {
        delete pressedKeys[key];
        delete watchdogTimers[key];
      }, 2000);

      if (!muteState) {
        if (!isRepeat) {
          if (win && !win.isDestroyed()) {
            pressedKeys[key] = true;
            win.webContents.send('keydown', { ...event, isRepeat: false });
          }
        } else {
          if (win && !win.isDestroyed()) {
            win.webContents.send('keydown', { ...event, isRepeat: true });
          }
        }
      }
    });

    uIOhook.on('keyup', (event: UiohookKeyboardEvent) => {
      if (parsedMuteHotkey && parsedMuteHotkey.keycodes.includes(event.keycode)) {
        hotkeyPhysicallyDown = false;
      }
      const key = `${event.keycode}`;
      if (watchdogTimers[key]) {
        clearTimeout(watchdogTimers[key]);
        delete watchdogTimers[key];
      }
      if (!muteState) {
        pressedKeys[key] = false;
        if (win && !win.isDestroyed()) {
          win.webContents.send('keyup', event);
        }
      }
    });

    function toggleMute() {
      muteState = !muteState;
      if (muteState) {
        mute.enable();
        for (const t of Object.values(watchdogTimers)) clearTimeout(t);
        watchdogTimers = {};
        pressedKeys = {};
      } else {
        mute.disable();
      }
      log.info(`Mute toggled: ${muteState}`);
      if (win && !win.isDestroyed()) {
        win.webContents.send('mechvibes-mute-status', muteState);
        if (muteState) {
          win.webContents.send('clear-pressed-keys');
        }
      }
      if (tray !== null) {
        tray.setImage(muteState ? SYSTRAY_ICON_MUTED : SYSTRAY_ICON);
        tray.setContextMenu(buildContextMenu());
      }
    }

    function buildContextMenu(): Electron.Menu {
      return Menu.buildFromTemplate([
        {
          label: 'Mechvibes',
          click: function () {
            if (process.platform === 'darwin') {
              app.dock.show();
            }
            win!.show();
            win!.focus();
          },
        },
        {
          label: 'Editor',
          click: function () {
            openEditorWindow();
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
          checked: muteState,
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
              checked: start_minimized.is_enabled,
              click: function () {
                start_minimized.toggle();
              },
            },
            {
              label: 'Active Volume Adjustment',
              type: 'checkbox',
              checked: active_volume.is_enabled,
              click: function () {
                active_volume.toggle();
                win?.webContents.send('ava-toggle', active_volume.is_enabled);
              },
            },
          ],
        },
        {
          label: 'Quit',
          click: function () {
            clearInterval(sys_check_interval);
            isQuiting = true;
            app.quit();
          },
        },
      ]);
    }

    function createTrayIcon() {
      if (tray !== null) return;
      tray = new Tray(muteState ? SYSTRAY_ICON_MUTED : SYSTRAY_ICON);
      tray.setToolTip('Mechvibes');
      const contextMenu = buildContextMenu();

      if (process.platform === 'darwin') {
        tray.on('click', () => {
          tray!.popUpContextMenu(buildContextMenu());
        });
        tray.on('right-click', () => {
          app.dock.show();
          win!.show();
          win!.focus();
        });
      } else {
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => {
          win!.show();
          win!.focus();
        });
      }
    }

    ipcMain.handle('get-globals', () => ({
      custom_dir,
      current_pack_store_id,
      app_version: app.getVersion(),
    }));

    ipcMain.on('toggle-mute', () => {
      toggleMute();
    });

    ipcMain.on('get-mute-status', (event) => {
      event.reply('mechvibes-mute-status', muteState);
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
      if (tray !== null) {
        tray.setContextMenu(buildContextMenu());
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
      hotkeyPhysicallyDown = false;
      log.info(`Mute hotkey updated to: ${hotkey}`);
    });

    ipcMain.on('set-theme', (_event, theme: string) => {
      if (!(['system', 'light', 'dark'] as const).includes(theme as 'system')) return;
      nativeTheme.themeSource = theme as 'system' | 'light' | 'dark';
      if (win && !win.isDestroyed() && typeof (win as unknown as Record<string, unknown>)['setTitleBarOverlay'] === 'function') {
        const useDark = nativeTheme.shouldUseDarkColors;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (win as any).setTitleBarOverlay({
          color: useDark ? '#1a1a1a' : '#f0f0f0',
          symbolColor: useDark ? '#e0e0e0' : '#333333',
        });
      }
    });

    ipcMain.on('show_tray_icon', (_event, show: boolean) => {
      if (show && tray === null) {
        createTrayIcon();
      } else if (!show && tray !== null) {
        tray.destroy();
        tray = null;
      } else if (!show && tray === null) {
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
      createDebugWindow();
    });

    ipcMain.on('set-debug-options', (_event, json: { enabled: boolean }) => {
      if (json.enabled && !debug.enabled) {
        debug.enable();
      } else if (!json.enabled && debug.enabled) {
        debug.disable();
      }
    });

    ipcMain.on('resize-installer', (_event, size: number) => {
      if (!installer) return;
      const diff = installer.getSize()[1] - installer.getContentSize()[1];
      log.silly(`Installer requested ${size}, offset is ${diff}, so size is ${size + diff}`);
      installer.setSize(300, size + diff, true);
    });

    ipcMain.on('installed', (_event, packFolder: string) => {
      log.silly(`Installed ${packFolder}`);
      store.set(current_pack_store_id, 'custom-' + packFolder);
      win?.reload();
      installer?.close();
      installer = null;
    });

    log.debug(`Platform: ${process.platform}`);
    log.info('App is ready and has been initialized');

    if (process.platform === 'darwin') {
      const { powerMonitor } = require('electron') as typeof import('electron');
      powerMonitor.on('shutdown', () => {
        app.quit();
      });
    }

    if (storage_prompted.is_enabled) {
      const home_dir = app.getPath('home');
      const old_custom_dir = path.join(home_dir, '/mechvibes_custom');
      if (fs.existsSync(old_custom_dir)) {
        log.debug('Old custom directory exists, prompting user for migration...');
        const { dialog } = require('electron') as typeof import('electron');
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
          win?.reload();
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
  if (win === null) {
    createWindow(true);
  } else {
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
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

let editor_window: BrowserWindow | null = null;

function openEditorWindow() {
  if (editor_window) {
    editor_window.focus();
    return;
  }

  editor_window = new BrowserWindow({
    width: 1200,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  editor_window.loadFile('./src/editor.html');

  editor_window.on('closed', function () {
    editor_window = null;
  });
}
