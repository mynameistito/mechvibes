import { BrowserWindow, Tray } from 'electron';
import StoreToggle from '../main-only/store-toggle.js';
import type { ParsedHotkey } from './services/hotkey.js';

export interface AppState {
  win: BrowserWindow | null;
  tray: Tray | null;
  installer: BrowserWindow | null;
  debugWindow: BrowserWindow | null;
  editorWindow: BrowserWindow | null;
  isQuiting: boolean;
  muteState: boolean;
  mute: StoreToggle;
  startMinimized: StoreToggle;
  activeVolume: StoreToggle;
  hotkeyPhysicallyDown: boolean;
  pressedKeys: Record<string, boolean>;
  watchdogTimers: Record<string, ReturnType<typeof setTimeout>>;
  sysCheckInterval: ReturnType<typeof setInterval> | null;
  parsedMuteHotkey: ParsedHotkey | null;
}