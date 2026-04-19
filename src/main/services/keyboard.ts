import { uIOhook } from 'uiohook-napi';
import type { UiohookKeyboardEvent } from 'uiohook-napi';
import { matchesHotkey } from './hotkey.js';
import type { AppState } from '../app-state.js';

export function startKeyboardHooks(
  state: AppState,
  onMuteToggle: () => void,
): void {
  uIOhook.start();

  uIOhook.on('keydown', (event: UiohookKeyboardEvent) => {
    if (state.parsedMuteHotkey && matchesHotkey(event, state.parsedMuteHotkey)) {
      if (!state.hotkeyPhysicallyDown) {
        state.hotkeyPhysicallyDown = true;
        onMuteToggle();
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
    if (state.parsedMuteHotkey && state.parsedMuteHotkey.keycodes.includes(event.keycode)) {
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
}