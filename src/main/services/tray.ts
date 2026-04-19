import { Tray, Menu, app, shell } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import type { AppState } from '../app-state.js';
import StartupHandler from '../../main-only/startup-handler.js';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYSTRAY_ICON = path.join(__dirname, '../../../src/assets/system-tray-icon.png');
const SYSTRAY_ICON_MUTED = path.join(__dirname, '../../../src/assets/system-tray-icon-muted.png');

export interface TrayCallbacks {
  toggleMute: () => void;
  openEditorWindow: () => void;
  onQuit: () => void;
}

export function buildContextMenu(
  state: AppState,
  startup_handler: StartupHandler,
  user_dir: string,
  custom_dir: string,
  callbacks: TrayCallbacks,
): Electron.Menu {
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
        callbacks.openEditorWindow();
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
        callbacks.toggleMute();
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
        callbacks.onQuit();
      },
    },
  ]);
}

export function createTrayIcon(
  state: AppState,
  startup_handler: StartupHandler,
  user_dir: string,
  custom_dir: string,
  callbacks: TrayCallbacks,
): void {
  if (state.tray !== null) return;
  state.tray = new Tray(state.muteState ? SYSTRAY_ICON_MUTED : SYSTRAY_ICON);
  state.tray.setToolTip('Mechvibes');

  const contextMenu = buildContextMenu(state, startup_handler, user_dir, custom_dir, callbacks);

  if (process.platform === 'darwin') {
    state.tray.on('click', () => {
      state.tray!.popUpContextMenu(buildContextMenu(state, startup_handler, user_dir, custom_dir, callbacks));
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

export { SYSTRAY_ICON, SYSTRAY_ICON_MUTED };