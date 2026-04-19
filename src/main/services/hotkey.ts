import { UiohookKey } from 'uiohook-napi';
import type { UiohookKeyboardEvent } from 'uiohook-napi';

export interface ParsedHotkey {
  keycodes: number[];
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
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

export function parseHotkey(hotkey: string): ParsedHotkey | null {
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

export function matchesHotkey(event: UiohookKeyboardEvent, parsed: ParsedHotkey | null): boolean {
  if (!parsed || parsed.keycodes.length === 0) return false;
  return parsed.keycodes.includes(event.keycode) &&
         !!event.ctrlKey === parsed.ctrl &&
         !!event.shiftKey === parsed.shift &&
         !!event.altKey === parsed.alt &&
         !!event.metaKey === parsed.meta;
}