import Store from 'electron-store';
import { Howler } from 'howler';
import { shell, ipcRenderer } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { GetFileFromArchive } from '../../shared/soundpacks/file-manager.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { SoundpackConfigV1 } from '../../shared/soundpacks/config-v1.js';
import { SoundpackConfigV2 } from '../../shared/soundpacks/config-v2.js';
import { Result } from 'better-result';
import type { ISoundpackConfig, SoundpackMeta } from '../../shared/soundpacks/soundpack-config.js';

const store = new Store();

const MV_VOL_LSID = 'mechvibes-volume';
const MV_TRAY_LSID = 'mechvibes-hidden';
const MV_THEME_LSID = 'mechvibes-theme';

let MV_PACK_LSID = 'mechvibes-pack';
let CUSTOM_PACKS_DIR = '';
let APP_VERSION = '';

let OFFICIAL_PACKS_DIR = path.join(__dirname, '../../../audio');

let active_volume = true;
let system_volume = 50;
let is_system_muted = false;
let current_pack: ISoundpackConfig | null = null;
const packs: ISoundpackConfig[] = [];

const log = {
  silly(message: string)   { raise_log_message('silly', message); },
  debug(message: string)   { raise_log_message('debug', message); },
  verbose(message: string) { raise_log_message('verbose', message); },
  info(message: string)    { raise_log_message('info', message); },
  warn(message: string)    { raise_log_message('warn', message); },
  error(message: string)   { raise_log_message('error', message); },
};

function raise_log_message(level: string, message: string) {
  ipcRenderer.send('electron-log', message, level);
}

const CONFIG_VERSIONS: Record<number, new (config: unknown, meta: SoundpackMeta) => ISoundpackConfig> = {
  1: SoundpackConfigV1 as unknown as new (config: unknown, meta: SoundpackMeta) => ISoundpackConfig,
  2: SoundpackConfigV2 as unknown as new (config: unknown, meta: SoundpackMeta) => ISoundpackConfig,
};

function loadPack(packId: number | null = null) {
  if (packId === null) {
    packs.forEach((_pack, pid) => {
      if (current_pack && _pack.pack_id === current_pack.pack_id) {
        packId = pid;
      }
    });
  }

  const app_logo = document.getElementById('logo')!;
  const app_body = document.getElementById('app-body')!;

  log.info(`Loading ${packId}`);
  app_logo.innerHTML = 'Loading...';
  app_body.classList.add('loading');
  _loadPack(packId!).then(() => {
    log.info('loaded');
    app_logo.innerHTML = 'Mechvibes';
    app_body.classList.remove('loading');
  }).catch((e: unknown) => {
    app_logo.innerHTML = 'Failed';
    console.warn(e);
    log.warn(`Failed to load pack: ${e}`);
  });
}

async function _loadPack(packId: number): Promise<void> {
  if (packs[packId] === undefined) {
    throw new Error("That packID doesn't exist");
  }
  unloadAllPacks();
  const result = await packs[packId].LoadSounds();
  if (!Result.isOk(result)) {
    throw new Error(result.error.message);
  }
}

function unloadPack(packId: number) {
  if (packs[packId] !== undefined) {
    packs[packId].UnloadSounds();
    return true;
  }
  return false;
}

function unloadAllPacks() {
  packs.forEach((pack, packId) => {
    if (pack.audio !== undefined) {
      unloadPack(packId);
    }
  });
}

function listDir(dir: string): string[] {
  const normalized = dir.replace(/\\/g, '/').replace(/\/$/, '');
  if (!fs.existsSync(normalized)) return [];
  return fs.readdirSync(normalized).map((f) => normalized + '/' + f);
}

async function loadPacks() {
  const official_packs = listDir(OFFICIAL_PACKS_DIR);
  const custom_packs = listDir(CUSTOM_PACKS_DIR);
  const folders = [...official_packs, ...custom_packs];

  log.info(`Loading ${folders.length} packs`);
  log.debug(OFFICIAL_PACKS_DIR);
  log.debug(CUSTOM_PACKS_DIR);

  folders.forEach((folder) => {
    const folder_name = path.basename(folder);
    const normalizedCustomDir = CUSTOM_PACKS_DIR.replace(/\\/g, '/');
    const is_custom = folder.startsWith(normalizedCustomDir);
    const is_archive = path.extname(folder) === '.zip';

    let config_json: { version?: number; [key: string]: unknown } | null = null;
    let soundpack_metadata: SoundpackMeta | null = null;

    if (!is_archive) {
      const config_file = `${folder.replace(/\/$/, '')}/config.json`;
      if (fs.existsSync(config_file)) {
        try {
          config_json = JSON.parse(fs.readFileSync(config_file, 'utf8')) as { version?: number; [key: string]: unknown };
        } catch {
          console.warn(`Failed to parse config.json: ${folder_name}`);
          return;
        }
        soundpack_metadata = {
          pack_id: `${is_custom ? 'custom' : 'default'}-${folder_name}`,
          group: is_custom ? 'Custom' : 'Default',
          abs_path: folder,
          folder_name,
          is_custom,
          is_archive,
        };
      }
    } else {
      const fileResult = GetFileFromArchive(folder, 'config.json');
      if (!Result.isOk(fileResult)) {
        console.warn(`Failed to load config.json from archive: ${folder_name}`);
        return;
      }
      try {
        config_json = JSON.parse(fileResult.value) as { version?: number; [key: string]: unknown };
      } catch {
        console.warn(`Failed to parse config.json from archive: ${folder_name}`);
        return;
      }
      soundpack_metadata = {
        pack_id: `${is_custom ? 'custom' : 'default'}-${folder_name}`,
        group: is_custom ? 'Custom' : 'Default',
        abs_path: folder,
        folder_name,
        is_custom,
        is_archive,
      };
    }

    if (config_json === null || soundpack_metadata === null) {
      console.warn(`Failed to load config.json: ${folder_name}`);
      return;
    }

    const version = config_json.version ?? 1;
    const ConfigClass = CONFIG_VERSIONS[version];
    if (!ConfigClass) {
      log.warn(`Unsupported config version (${version}): ${folder_name}`);
      return;
    }

    let soundpack_config: ISoundpackConfig | null = null;
    try {
      soundpack_config = new ConfigClass(config_json, soundpack_metadata);
    } catch (e: unknown) {
      console.warn(`Failed to load soundpack config: ${folder_name}`, e);
      return;
    }

    if (soundpack_config === null) {
      console.warn(`Failed to load soundpack config: ${folder_name}`);
      return;
    }
    packs.push(soundpack_config);
  });
}

function getPack(pack_id: string): ISoundpackConfig | undefined {
  return packs.find((pack) => pack.pack_id === pack_id);
}

function getSavedPack(): ISoundpackConfig {
  if (store.has(MV_PACK_LSID)) {
    const pack_id = store.get(MV_PACK_LSID) as string;
    const pack = getPack(pack_id);
    return pack ?? packs[0];
  }
  return packs[0];
}

function setPack(pack_id: string) {
  let index = 0;
  packs.forEach((_pack, i) => {
    if (_pack.pack_id === pack_id) index = i;
  });
  loadPack(index);
  current_pack = packs[index];
  store.set(MV_PACK_LSID, current_pack.pack_id);
}

function setPackByIndex(index: number) {
  loadPack(index);
  current_pack = packs[index];
  store.set(MV_PACK_LSID, current_pack.pack_id);
}

interface PackGroup {
  id: string;
  name: string;
  packs: ISoundpackConfig[];
}

function packsToOptions(packList: HTMLSelectElement) {
  const selected_pack_id = store.get(MV_PACK_LSID) as string | undefined;
  const groups: PackGroup[] = [];

  packs.forEach((pack) => {
    const exists = groups.find((group) => group.id === pack.group);
    if (!exists) {
      groups.push({ id: pack.group, name: pack.group || 'Default', packs: [pack] });
    } else {
      exists.packs.push(pack);
    }
  });

  for (const group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.name;
    for (const pack of group.packs) {
      const is_selected = selected_pack_id === pack.pack_id;
      if (is_selected) {
        setPack(pack.pack_id);
      }
      const opt = document.createElement('option');
      opt.text = `${pack.name} [v${pack.config_version}]`;
      opt.value = pack.pack_id;
      opt.selected = is_selected;
      optgroup.appendChild(opt);
    }
    packList.appendChild(optgroup);
  }

  packList.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    const selected_id = target.options[target.selectedIndex].value;
    setPack(selected_id);
  });
}

(function (window: Window, document: Document) {
  window.addEventListener('DOMContentLoaded', async () => {
    const globals = await ipcRenderer.invoke('get-globals') as {
      custom_dir: string;
      current_pack_store_id: string;
      app_version: string;
      is_packaged: boolean;
      resources_path: string;
    };
    CUSTOM_PACKS_DIR = globals.custom_dir;
    MV_PACK_LSID = globals.current_pack_store_id;
    APP_VERSION = globals.app_version;
    if (globals.is_packaged) {
      OFFICIAL_PACKS_DIR = path.join(globals.resources_path, 'audio');
    }

    const version = document.getElementById('app-version')!;
    const update_available = document.getElementById('update-available')!;
    const debug_in_use = document.getElementById('remote-in-use')!;
    const quick_disable_remote = document.getElementById('quick-disable-remote')!;
    const mechvibes_muted = document.getElementById('mechvibes-muted')!;
    const system_muted = document.getElementById('system-muted')!;
    const new_version = document.getElementById('new-version')!;
    const app_logo = document.getElementById('logo')!;
    const pack_list = document.getElementById('pack-list') as HTMLSelectElement;
    const random_button = document.getElementById('random-button')!;
    const debug_button = document.getElementById('open-debug-options')!;
    const debug_button_seperator = document.getElementById('debug-options-seperator')!;
    const volume_value = document.getElementById('volume-value-display')!;
    const volume = document.getElementById('volume') as HTMLInputElement;
    const tray_icon_toggle = document.getElementById('tray_icon_toggle') as HTMLInputElement;
    const tray_icon_toggle_group = document.getElementById('tray_icon_toggle_group')!;
    const theme_toggle = document.getElementById('theme_toggle') as HTMLInputElement;
    const theme_toggle_group = document.getElementById('theme_toggle_group')!;
    const startup_toggle = document.getElementById('startup_toggle') as HTMLInputElement;
    const startup_toggle_group = document.getElementById('startup_toggle_group')!;
    const mute_toggle = document.getElementById('mute_toggle') as HTMLInputElement;
    const mute_toggle_group = document.getElementById('mute_toggle_group')!;
    const hotkey_button = document.getElementById('hotkey_button')!;

    app_logo.innerHTML = 'Loading...';
    version.innerHTML = APP_VERSION;

    await loadPacks();
    packsToOptions(pack_list);

    fetch('https://api.github.com/repos/hainguyents13/mechvibes/releases/latest')
      .then((res) => res.json())
      .then((json: { tag_name: string }) => {
        if (json.tag_name.localeCompare(APP_VERSION, undefined, { numeric: true }) === 1) {
          new_version.innerHTML = json.tag_name;
          update_available.classList.remove('hidden');
        }
      });

    fetch('https://beta.mechvibes.com/debug/status/', {
      method: 'GET',
      headers: {
        'User-Agent': `Mechvibes/${APP_VERSION} (Electron/${process.versions.electron})`,
      },
    }).then(async (res) => {
      const body = await res.text();
      if (res.status === 200 && body === 'enabled') {
        debug_button.classList.remove('hidden');
        debug_button_seperator.classList.remove('hidden');
      }
    });

    Array.from(document.getElementsByClassName('open-in-browser')).forEach((elem) => {
      elem.addEventListener('click', (e) => {
        e.preventDefault();
        shell.openExternal((e.target as HTMLAnchorElement).href);
      });
    });

    current_pack = getSavedPack();
    loadPack();

    if (store.get(MV_TRAY_LSID) !== undefined) {
      tray_icon_toggle.checked = store.get(MV_TRAY_LSID) as boolean;
    }
    tray_icon_toggle_group.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      tray_icon_toggle.checked = !tray_icon_toggle.checked;
      ipcRenderer.send('show_tray_icon', tray_icon_toggle.checked);
      store.set(MV_TRAY_LSID, tray_icon_toggle.checked);
    };

    const initTray = () => { ipcRenderer.send('show_tray_icon', tray_icon_toggle.checked); };
    initTray();

    const savedTheme = store.get(MV_THEME_LSID, 'system') as string;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDarkMode = savedTheme === 'dark' || (savedTheme === 'system' && prefersDark);
    if (isDarkMode) {
      document.body.classList.add('dark');
      theme_toggle.checked = true;
    }
    theme_toggle_group.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      theme_toggle.checked = !theme_toggle.checked;
      const theme = theme_toggle.checked ? 'dark' : 'light';
      if (theme_toggle.checked) {
        document.body.classList.add('dark');
      } else {
        document.body.classList.remove('dark');
      }
      store.set(MV_THEME_LSID, theme);
      ipcRenderer.send('set-theme', theme);
    };

    ipcRenderer.on('startup-status', (_event, enabled: boolean) => {
      startup_toggle.checked = enabled;
    });
    startup_toggle_group.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      startup_toggle.checked = !startup_toggle.checked;
      ipcRenderer.send('set-startup', startup_toggle.checked);
    };
    ipcRenderer.send('get-startup-status');

    const displayVolume = () => {
      const primary = document.createElement('span');
      primary.innerText = `${volume.value}`;
      volume_value.innerHTML = `${primary.outerHTML}`;
      if (active_volume) {
        const adjusted = document.createElement('span');
        adjusted.innerText = `(${Math.round(parseInt(volume.value) * (100 / system_volume))})`;
        adjusted.style.marginLeft = '1em';
        adjusted.style.fontSize = '12px';
        adjusted.style.fontWeight = 'normal';
        adjusted.style.opacity = '0.5';
        volume_value.appendChild(adjusted);
      }
    };

    if (store.get(MV_VOL_LSID)) {
      volume.value = store.get(MV_VOL_LSID) as string;
    } else {
      volume.value = '50';
    }
    displayVolume();

    volume.oninput = function () {
      store.set(MV_VOL_LSID, (this as HTMLInputElement).value);
      displayVolume();
    };

    volume.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        volume.value = String(Math.min(parseInt(volume.max), parseInt(volume.value) + parseInt(volume.step)));
      } else {
        volume.value = String(Math.max(parseInt(volume.min), parseInt(volume.value) - parseInt(volume.step)));
      }
      store.set(MV_VOL_LSID, volume.value);
      displayVolume();
    });

    ipcRenderer.on('debug-in-use', (_event, enabled: boolean) => {
      if (enabled) {
        debug_in_use.classList.remove('hidden');
      } else {
        debug_in_use.classList.add('hidden');
      }
    });

    ipcRenderer.on('system-volume-update', (_event, vol: number) => {
      system_volume = vol;
      displayVolume();
    });

    ipcRenderer.on('system-mute-status', (_event, enabled: boolean) => {
      is_system_muted = enabled;
      if (enabled) {
        system_muted.classList.remove('hidden');
      } else {
        system_muted.classList.add('hidden');
      }
    });

    mute_toggle_group.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.send('toggle-mute');
    };

    function renderHotkey(hotkey: string | null) {
      hotkey_button.classList.remove('recording-hotkey');
      hotkey_button.innerHTML = '';
      if (!hotkey || hotkey === '-') {
        hotkey_button.classList.add('recording-hotkey');
        hotkey_button.textContent = 'Click to set';
        return;
      }
      hotkey.split('+').forEach((part, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'key-sep';
          sep.textContent = '+';
          hotkey_button.appendChild(sep);
        }
        const cap = document.createElement('span');
        cap.className = 'key-cap';
        cap.textContent = part;
        hotkey_button.appendChild(cap);
      });
    }

    let recordingHotkey = false;
    hotkey_button.addEventListener('click', () => {
      if (recordingHotkey) return;
      recordingHotkey = true;
      hotkey_button.classList.add('recording-hotkey');
      hotkey_button.innerHTML = '';
      hotkey_button.textContent = 'Press a key combo...';

      function onKeyDown(e: KeyboardEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return;

        const parts: string[] = [];
        if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');

        const key = e.key;
        if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return;

        const codeMap: Record<string, string> = {
          'Space': 'Space',
          'Enter': 'Return', 'NumpadEnter': 'Return',
          'Escape': 'Escape', 'Tab': 'Tab',
          'Backspace': 'Backspace', 'Delete': 'Delete',
          'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
          'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
          'Insert': 'Insert', 'PrintScreen': 'PrintScreen',
          'NumLock': 'NumLock', 'CapsLock': 'CapsLock', 'ScrollLock': 'ScrollLock',
        };

        let keyName: string;
        if (codeMap[e.code]) {
          keyName = codeMap[e.code];
        } else if (e.code.startsWith('Key')) {
          keyName = e.code.slice(3).toUpperCase();
        } else if (e.code.startsWith('Digit')) {
          keyName = e.code.slice(5);
        } else if (e.code.startsWith('Numpad')) {
          keyName = 'Num' + e.code.slice(6);
        } else if (e.code.startsWith('F') && e.code.length <= 3) {
          keyName = e.code;
        } else {
          keyName = key.length === 1 ? key.toUpperCase() : key;
        }

        parts.push(keyName);
        const hotkey = parts.join('+');
        document.removeEventListener('keydown', onKeyDown, true);
        recordingHotkey = false;
        renderHotkey(hotkey);
        ipcRenderer.send('set-hotkey', hotkey);
      }

      document.addEventListener('keydown', onKeyDown, true);
    });

    ipcRenderer.on('mute-hotkey', (_event, hotkey: string) => {
      renderHotkey(hotkey);
    });

    ipcRenderer.on('mechvibes-mute-status', (_event, enabled: boolean) => {
      mute_toggle.checked = enabled;
      if (enabled) {
        mechvibes_muted.classList.remove('hidden');
      } else {
        mechvibes_muted.classList.add('hidden');
      }
    });

    ipcRenderer.send('get-mute-status');

    ipcRenderer.on('ava-toggle', (_event, enabled: boolean) => {
      active_volume = enabled;
      displayVolume();
    });

    const pressed_keys = new Map<number, boolean>();
    const pressed_key_timers = new Map<number, ReturnType<typeof setTimeout>>();

    function releaseKey(keycode: number) {
      const timer = pressed_key_timers.get(keycode);
      if (timer !== undefined) clearTimeout(timer);
      pressed_key_timers.delete(keycode);
      pressed_keys.set(keycode, false);
      const anyHeld = Array.from(pressed_keys.values()).some(Boolean);
      if (!anyHeld) app_logo.classList.remove('pressed');
    }

    ipcRenderer.on('keyup', (_, { keycode }: { keycode: number }) => {
      releaseKey(keycode);
      playSound({ type: 'keyup', keycode }, parseInt(volume.value));
    });

    ipcRenderer.on('keydown', (_, { keycode, isRepeat }: { keycode: number; isRepeat: boolean }) => {
      const existing = pressed_key_timers.get(keycode);
      if (existing !== undefined) clearTimeout(existing);
      pressed_key_timers.set(keycode, setTimeout(() => releaseKey(keycode), 500));
      pressed_keys.set(keycode, true);
      app_logo.classList.add('pressed');
      if (!isRepeat) {
        playSound({ type: 'keydown', keycode }, parseInt(volume.value));
      }
    });

    ipcRenderer.on('clear-pressed-keys', () => {
      for (const timer of pressed_key_timers.values()) clearTimeout(timer);
      pressed_keys.clear();
      pressed_key_timers.clear();
      app_logo.classList.remove('pressed');
    });

    random_button.addEventListener('click', (e) => {
      e.preventDefault();
      function getRandomPackId(): number {
        const randomId = Math.floor(Math.random() * packs.length);
        if (current_pack && packs[randomId].pack_id === current_pack.pack_id) {
          return getRandomPackId();
        }
        return randomId;
      }
      const packId = getRandomPackId();
      pack_list.selectedIndex = packId;
      setPackByIndex(packId);
    });

    debug_button.addEventListener('click', (e) => {
      e.preventDefault();
      ipcRenderer.send('open-debug-options');
    });

    quick_disable_remote.addEventListener('click', (e) => {
      e.preventDefault();
      ipcRenderer.send('set-debug-options', { enabled: false });
    });
  });
})(window, document);

function playSound(event: { type: 'keydown' | 'keyup'; keycode: number }, volumeValue: number) {
  if (current_pack === null || current_pack.audio === undefined) return;

  if (active_volume) {
    const adjustedVolume = volumeValue * (100 / system_volume);
    if (!is_system_muted) {
      log.silly(`Volume: ${volumeValue}`);
      log.silly(`System Volume: ${system_volume}`);
      log.silly(`Adjusted Volume: ${adjustedVolume}`);
      log.silly(`Result Volume: ${adjustedVolume / 100}`);
    }
    Howler.masterGain.gain.setValueAtTime(Number(adjustedVolume / 100), Howler.ctx.currentTime);
  } else {
    Howler.masterGain.gain.setValueAtTime(Number(volumeValue / 100), Howler.ctx.currentTime);
  }

  if (current_pack.HandleEvent !== undefined) {
    current_pack.HandleEvent(event);
    log.info(`Playing sound for keycode: ${event.keycode} (${event.type})`);
  } else {
    log.warn("Pack version doesn't have a HandleEvent function");
  }
}
