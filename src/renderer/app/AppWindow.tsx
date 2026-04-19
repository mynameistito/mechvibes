import Store from 'electron-store';
import { Howler } from 'howler';
import { shell, ipcRenderer } from 'electron';
import fs from 'fs';
import path from 'path';
import { useState, useEffect, useRef, useCallback } from 'react';
import { GetFileFromArchive } from '../../shared/soundpacks/file-manager';
import { SoundpackConfigV1 } from '../../shared/soundpacks/config-v1';
import { SoundpackConfigV2 } from '../../shared/soundpacks/config-v2';
import { Result } from 'better-result';
import type { ISoundpackConfig, SoundpackMeta } from '../../shared/soundpacks/soundpack-config';

const store = new Store();

const CONFIG_VERSIONS: Record<number, new (config: unknown, meta: SoundpackMeta) => ISoundpackConfig> = {
  1: SoundpackConfigV1 as unknown as new (config: unknown, meta: SoundpackMeta) => ISoundpackConfig,
  2: SoundpackConfigV2 as unknown as new (config: unknown, meta: SoundpackMeta) => ISoundpackConfig,
};

interface PackOption {
  pack_id: string;
  name: string;
  version: number;
  group: string;
}

function listDir(dir: string): string[] {
  const normalized = dir.replace(/\\/g, '/').replace(/\/$/, '');
  if (!fs.existsSync(normalized)) return [];
  return fs.readdirSync(normalized).map((f) => normalized + '/' + f);
}

function sendLog(level: string, message: string) {
  ipcRenderer.send('electron-log', message, level);
}

function HotkeyCaps({ hotkey, recording }: { hotkey: string | null; recording: boolean }) {
  if (recording) {
    return <span className="text-[10px] text-[#999] italic">Press a key combo...</span>;
  }
  if (!hotkey || hotkey === '-') {
    return <span className="text-[10px] text-[#999] italic">Click to set</span>;
  }
  const parts = hotkey.split('+');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[11px] font-bold text-[#666] dark:text-[#aaa]">+</span>}
          <span className="inline-flex items-center justify-center bg-[#d8d8d8] dark:bg-[#2e2e2e] text-[#111] dark:text-[#f0f0f0] rounded px-1.5 py-px text-[9px] font-bold min-w-5 shadow-[0_2px_0_#777] dark:shadow-[0_2px_0_#111] border border-[#999] dark:border-[#4a4a4a] uppercase tracking-wide">
            {part}
          </span>
        </span>
      ))}
    </>
  );
}

export function AppWindow() {
  // --- audio-critical refs (no re-render needed) ---
  const packsRef = useRef<ISoundpackConfig[]>([]);
  const currentPackRef = useRef<ISoundpackConfig | null>(null);
  const activeVolumeRef = useRef(true);
  const systemVolumeRef = useRef(50);
  const volumeRef = useRef(50);
  const pressedKeys = useRef(new Map<number, boolean>());
  const pressedKeyTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const packStoreIdRef = useRef('mechvibes-pack');
  const recordingRef = useRef(false);
  const hotkeyListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const volumeElRef = useRef<HTMLInputElement>(null);

  // --- ui state ---
  const [loading, setLoading] = useState(true);
  const [packOptions, setPackOptions] = useState<PackOption[]>([]);
  const [selectedPackId, setSelectedPackId] = useState('');
  const [volume, setVolume] = useState(50);
  const [systemVolume, setSystemVolume] = useState(50);
  const [activeVolume, setActiveVolume] = useState(true);
  const [isSystemMuted, setIsSystemMuted] = useState(false);
  const [isMechvibesMuted, setIsMechvibesMuted] = useState(false);
  const [isDebugInUse, setIsDebugInUse] = useState(false);
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [showTrayIcon, setShowTrayIcon] = useState(true);
  const [isDark, setIsDark] = useState(false);
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [showDebugButton, setShowDebugButton] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [recordingHotkey, setRecordingHotkey] = useState(false);

  useEffect(() => {
    return () => {
      if (hotkeyListenerRef.current) {
        document.removeEventListener('keydown', hotkeyListenerRef.current, true);
      }
    };
  }, []);

  // apply dark class to document root
  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDark]);

  // --- audio helpers ---
  function unloadAllPacks() {
    packsRef.current.forEach((pack) => { if (pack.audio !== undefined) pack.UnloadSounds(); });
  }

  async function loadPackByIndex(index: number) {
    const packs = packsRef.current;
    if (packs[index] === undefined) throw new Error("Pack doesn't exist");
    unloadAllPacks();
    const result = await packs[index].LoadSounds();
    if (!Result.isOk(result)) throw new Error(result.error.message);
  }

  const playSound = useCallback((event: { type: 'keydown' | 'keyup'; keycode: number }, vol: number) => {
    const pack = currentPackRef.current;
    if (!pack || !pack.audio) return;
    if (activeVolumeRef.current) {
      const effSys = systemVolumeRef.current > 0 ? systemVolumeRef.current : 1;
      const adj = vol * (100 / effSys);
      Howler.masterGain.gain.setValueAtTime(adj / 100, Howler.ctx.currentTime);
    } else {
      Howler.masterGain.gain.setValueAtTime(vol / 100, Howler.ctx.currentTime);
    }
    pack.HandleEvent?.(event);
  }, []);

  function setPack(packId: string) {
    const packs = packsRef.current;
    const idx = packs.findIndex((p) => p.pack_id === packId);
    if (idx === -1) return;
    setLoading(true);
    setSelectedPackId(packId);
    loadPackByIndex(idx).then(() => {
      currentPackRef.current = packs[idx];
      store.set(packStoreIdRef.current, packId);
      setLoading(false);
    }).catch((e) => {
      sendLog('warn', `Failed to load pack: ${e}`);
      setLoading(false);
    });
  }

  // --- initialization ---
  useEffect(() => {
    (async () => {
      const globals = await ipcRenderer.invoke('get-globals') as {
        custom_dir: string;
        current_pack_store_id: string;
        app_version: string;
        is_packaged: boolean;
        resources_path: string;
        active_volume: boolean;
      };

      packStoreIdRef.current = globals.current_pack_store_id;
      activeVolumeRef.current = globals.active_volume;
      setActiveVolume(globals.active_volume);
      setAppVersion(globals.app_version);

      const officialDir = globals.is_packaged
        ? path.join(globals.resources_path, 'audio')
        : path.join(process.cwd(), 'audio');
      const customDir = globals.custom_dir;

      // load packs
      const folders = [...listDir(officialDir), ...listDir(customDir)];
      const loadedPacks: ISoundpackConfig[] = [];
      for (const folder of folders) {
        const folderName = path.basename(folder);
        const isCustom = folder.startsWith(customDir.replace(/\\/g, '/'));
        const isArchive = path.extname(folder) === '.zip';

        let configJson: { version?: number; [key: string]: unknown } | null = null;
        const meta: SoundpackMeta = {
          pack_id: `${isCustom ? 'custom' : 'default'}-${folderName}`,
          group: isCustom ? 'Custom' : 'Default',
          abs_path: folder,
          folder_name: folderName,
          is_custom: isCustom,
          is_archive: isArchive,
        };

        if (!isArchive) {
          const cfgFile = `${folder.replace(/\/$/, '')}/config.json`;
          if (!fs.existsSync(cfgFile)) continue;
          try { configJson = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { continue; }
        } else {
          const res = GetFileFromArchive(folder, 'config.json');
          if (!Result.isOk(res)) continue;
          try { configJson = JSON.parse(res.value); } catch { continue; }
        }

        if (!configJson) continue;
        const version = configJson.version ?? 1;
        const ConfigClass = CONFIG_VERSIONS[version];
        if (!ConfigClass) continue;
        try { loadedPacks.push(new ConfigClass(configJson, meta)); } catch { continue; }
      }

      packsRef.current = loadedPacks;

      const options: PackOption[] = loadedPacks.map((p) => ({
        pack_id: p.pack_id, name: p.name, version: p.config_version, group: p.group,
      }));
      setPackOptions(options);

      const savedId = store.get(packStoreIdRef.current) as string | undefined;
      const initPack = loadedPacks.find((p) => p.pack_id === savedId) ?? loadedPacks[0];
      if (initPack) {
        const idx = loadedPacks.indexOf(initPack);
        setSelectedPackId(initPack.pack_id);
        await loadPackByIndex(idx).catch(() => {});
        currentPackRef.current = initPack;
      }
      setLoading(false);

      // theme
      const savedTheme = store.get('mechvibes-theme', 'system') as string;
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const dark = savedTheme === 'dark' || (savedTheme === 'system' && prefersDark);
      setIsDark(dark);

      // tray
      const trayHidden = store.get('mechvibes-hidden') as boolean | undefined;
      const trayShown = trayHidden !== undefined ? trayHidden : true;
      setShowTrayIcon(trayShown);
      ipcRenderer.send('show_tray_icon', trayShown);

      // volume
      const savedVol = parseInt(store.get('mechvibes-volume', '50') as string);
      setVolume(savedVol);
      volumeRef.current = savedVol;

      // startup
      ipcRenderer.send('get-startup-status');
      ipcRenderer.send('get-mute-status');

      // debug button visibility
      fetch('https://beta.mechvibes.com/debug/status/', {
        method: 'GET',
        headers: { 'User-Agent': `Mechvibes/${globals.app_version} (Electron/${process.versions.electron})` },
      }).then(async (res) => {
        if (res.status === 200 && await res.text() === 'enabled') setShowDebugButton(true);
      }).catch(() => {});

      // update check
      fetch('https://api.github.com/repos/hainguyents13/mechvibes/releases/latest')
        .then((r) => r.json())
        .then((j: { tag_name: string }) => {
          if (j.tag_name.localeCompare(globals.app_version, undefined, { numeric: true }) === 1) {
            setNewVersion(j.tag_name);
          }
        }).catch(() => {});
    })();
  }, []);

  // --- IPC listeners ---
  useEffect(() => {
    ipcRenderer.on('ava-toggle', (_e, enabled: boolean) => {
      activeVolumeRef.current = enabled;
      setActiveVolume(enabled);
    });
    ipcRenderer.on('system-volume-update', (_e, vol: number) => {
      systemVolumeRef.current = vol;
      setSystemVolume(vol);
    });
    ipcRenderer.on('system-mute-status', (_e, enabled: boolean) => setIsSystemMuted(enabled));
    ipcRenderer.on('mechvibes-mute-status', (_e, enabled: boolean) => setIsMechvibesMuted(enabled));
    ipcRenderer.on('debug-in-use', (_e, enabled: boolean) => setIsDebugInUse(enabled));
    ipcRenderer.on('mute-hotkey', (_e, hk: string) => setHotkey(hk));
    ipcRenderer.on('startup-status', (_e, enabled: boolean) => setStartupEnabled(enabled));
    ipcRenderer.on('clear-pressed-keys', () => {
      for (const t of pressedKeyTimers.current.values()) clearTimeout(t);
      pressedKeys.current.clear();
      pressedKeyTimers.current.clear();
      setIsPressed(false);
    });
    ipcRenderer.on('keyup', (_e, { keycode }: { keycode: number }) => {
      const t = pressedKeyTimers.current.get(keycode);
      if (t !== undefined) clearTimeout(t);
      pressedKeyTimers.current.delete(keycode);
      pressedKeys.current.set(keycode, false);
      if (!Array.from(pressedKeys.current.values()).some(Boolean)) setIsPressed(false);
      playSound({ type: 'keyup', keycode }, volumeRef.current);
    });
    ipcRenderer.on('keydown', (_e, { keycode, isRepeat }: { keycode: number; isRepeat: boolean }) => {
      const existing = pressedKeyTimers.current.get(keycode);
      if (existing !== undefined) clearTimeout(existing);
      pressedKeyTimers.current.set(keycode, setTimeout(() => {
        pressedKeyTimers.current.delete(keycode);
        pressedKeys.current.set(keycode, false);
        if (!Array.from(pressedKeys.current.values()).some(Boolean)) setIsPressed(false);
      }, 500));
      pressedKeys.current.set(keycode, true);
      setIsPressed(true);
      if (!isRepeat) playSound({ type: 'keydown', keycode }, volumeRef.current);
    });
  }, [playSound]);

  // --- handlers ---
  function handleVolumeChange(val: number) {
    volumeRef.current = val;
    setVolume(val);
    store.set('mechvibes-volume', String(val));
  }

  function handleVolumeWheel(e: React.WheelEvent<HTMLInputElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const next = e.deltaY < 0
      ? Math.min(parseInt(el.max), volume + parseInt(el.step))
      : Math.max(parseInt(el.min), volume - parseInt(el.step));
    handleVolumeChange(next);
  }

  function handleTrayToggle() {
    const next = !showTrayIcon;
    setShowTrayIcon(next);
    store.set('mechvibes-hidden', next);
    ipcRenderer.send('show_tray_icon', next);
  }

  function handleThemeToggle() {
    const next = !isDark;
    setIsDark(next);
    store.set('mechvibes-theme', next ? 'dark' : 'light');
    ipcRenderer.send('set-theme', next ? 'dark' : 'light');
  }

  function handleStartupToggle() {
    const next = !startupEnabled;
    setStartupEnabled(next);
    ipcRenderer.send('set-startup', next);
  }

  function handleMuteToggle() {
    ipcRenderer.send('toggle-mute');
  }

  function handleRandomPack() {
    const packs = packsRef.current;
    if (packs.length === 0) return;
    const candidates = packs
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !currentPackRef.current || p.pack_id !== currentPackRef.current.pack_id);
    if (candidates.length === 0) return;
    const { p } = candidates[Math.floor(Math.random() * candidates.length)];
    setPack(p.pack_id);
  }

  function startHotkeyRecording() {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setRecordingHotkey(true);

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
        Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Escape: 'Escape',
        Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
        ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
        Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
        Insert: 'Insert', PrintScreen: 'PrintScreen',
        NumLock: 'NumLock', CapsLock: 'CapsLock', ScrollLock: 'ScrollLock',
      };
      let keyName: string;
      if (codeMap[e.code]) keyName = codeMap[e.code];
      else if (e.code.startsWith('Key')) keyName = e.code.slice(3).toUpperCase();
      else if (e.code.startsWith('Digit')) keyName = e.code.slice(5);
      else if (e.code.startsWith('Numpad')) keyName = 'Num' + e.code.slice(6);
      else if (e.code.startsWith('F') && e.code.length <= 3) keyName = e.code;
      else keyName = key.length === 1 ? key.toUpperCase() : key;
      parts.push(keyName);
      const hk = parts.join('+');
      document.removeEventListener('keydown', onKeyDown, true);
      hotkeyListenerRef.current = null;
      recordingRef.current = false;
      setRecordingHotkey(false);
      setHotkey(hk);
      ipcRenderer.send('set-hotkey', hk);
    }
    hotkeyListenerRef.current = onKeyDown;
    document.addEventListener('keydown', onKeyDown, true);
  }

  // --- computed display ---
  const effSys = systemVolume > 0 ? systemVolume : 1;
  const adjustedVol = activeVolume ? Math.round(volume * (100 / effSys)) : null;

  // group pack options
  const groups = packOptions.reduce<Record<string, PackOption[]>>((acc, opt) => {
    (acc[opt.group] ??= []).push(opt);
    return acc;
  }, {});

  return (
    <div className="p-8 pb-0 font-sans text-[13px] text-[#333] dark:text-[#e0e0e0] select-none overflow-hidden">
      {/* Logo */}
      <div className="flex justify-center mb-12">
        <div className={[
          'font-sans transition-all duration-100 text-[3rem] font-semibold text-center rounded-lg border-2 border-black dark:border-[#555] px-8 py-4',
          'bg-white dark:bg-[#242424] text-[#333] dark:text-[#e0e0e0]',
          isPressed
            ? 'shadow-none mt-0.5 -mb-0.5'
            : 'shadow-[0_2px_0_#ff6666] dark:shadow-[0_2px_0_#cc3333]',
        ].join(' ')}>
          {loading ? 'Loading...' : 'Mechvibes'}
        </div>
      </div>

      {/* Mute banners */}
      <div className="relative text-center text-[12px] mb-2">
        {isMechvibesMuted && (
          <div className="px-1.5 py-2 border border-[#ffb8b8] bg-[#fff2f2] dark:bg-[#2a1a1a] dark:border-[#7a3030] rounded text-[#333] dark:text-[#e0e0e0]">
            Mechvibes is currently muted.
          </div>
        )}
        {isSystemMuted && (
          <div className="px-1.5 py-2 border border-[#ffb8b8] bg-[#fff2f2] dark:bg-[#2a1a1a] dark:border-[#7a3030] rounded text-[#333] dark:text-[#e0e0e0]">
            Your system sounds are currently muted.
          </div>
        )}
      </div>

      {/* Pack selector */}
      <div className="mb-3">
        <select
          value={selectedPackId}
          onChange={(e) => setPack(e.target.value)}
          className="w-full border border-[#ccc] dark:border-[#444] rounded px-2 py-1.5 bg-white dark:bg-[#242424] text-[#333] dark:text-[#e0e0e0] text-[13px] mb-1"
        >
          {Object.entries(groups).map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((o) => (
                <option key={o.pack_id} value={o.pack_id}>
                  {o.name} [v{o.version}]
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex justify-between text-[12px]">
          <button onClick={handleRandomPack} className="text-[#ff5050] hover:underline cursor-pointer bg-transparent border-none p-0">
            Set random sound
          </button>
          <button
            onClick={() => shell.openExternal('https://mechvibes.com/sound-packs/')}
            className="text-[#ff5050] hover:underline cursor-pointer bg-transparent border-none p-0"
          >
            More sounds...
          </button>
        </div>
      </div>

      {/* Volume */}
      <div className="mb-1">
        <div className="flex items-center gap-2 mb-1">
          <span>Volume</span>
          <span className="font-bold">{volume}</span>
          {adjustedVol !== null && (
            <span className="text-[12px] font-normal opacity-50">({adjustedVol})</span>
          )}
        </div>
        <input
          ref={volumeElRef}
          type="range" min="0" max="200" step="5"
          value={volume}
          onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
          onWheel={handleVolumeWheel}
          className="w-full h-[5px] appearance-none rounded bg-[#d8d8d8] dark:bg-[#444] outline-none mb-0 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:bg-[#ff5050] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
        />
        {/* Warning level bands */}
        <div className="relative -top-1 left-0.5 flex w-full h-[5px] rounded overflow-hidden pointer-events-none opacity-70">
          <div style={{ width: '50%' }} />
          <div className="flex-1 bg-[#ffcc33]" />
          <div className="flex-1 bg-[#ff9233]" />
          <div className="flex-1 bg-[#ff3333]" />
        </div>
      </div>

      {/* Toggle rows */}
      <div className="divide-y divide-[#e4e4e4] dark:divide-[#333]">
        {([
          { label: 'Show Tray Icon', checked: showTrayIcon, onToggle: handleTrayToggle },
          { label: 'Dark Mode', checked: isDark, onToggle: handleThemeToggle },
          { label: 'Start on Boot', checked: startupEnabled, onToggle: handleStartupToggle },
          { label: 'Mute', checked: isMechvibesMuted, onToggle: handleMuteToggle },
        ] as const).map(({ label, checked, onToggle }) => (
          <div
            key={label}
            className="flex items-center justify-between py-2 cursor-pointer"
            onClick={onToggle}
          >
            <span>{label}</span>
            <div className="relative w-[1.15em] h-[1.15em] border-[0.15em] border-current rounded-[0.15em] bg-white dark:bg-[#1e1e1e] grid place-content-center pointer-events-none">
              {checked && (
                <span className="block w-[0.65em] h-[0.65em] bg-[#ff5050]" style={{
                  clipPath: 'polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)',
                }} />
              )}
            </div>
          </div>
        ))}

        {/* Hotkey row */}
        <div className="flex items-center justify-between py-2">
          <span>Mute Hotkey</span>
          <button
            onClick={startHotkeyRecording}
            className="bg-transparent border-none p-0 cursor-pointer flex gap-1 items-center justify-end flex-wrap"
          >
            <HotkeyCaps hotkey={hotkey} recording={recordingHotkey} />
          </button>
        </div>
      </div>

      <div className="block w-full border-b border-[#e4e4e4] dark:border-[#333] mt-4 mb-8" />

      {/* Footer */}
      <div className="text-[#666] dark:text-[#999] text-[12px] text-center">
        <p className="mb-1">
          Made with ❤ by{' '}
          <button
            className="text-[#ff5050] hover:underline bg-transparent border-none p-0 cursor-pointer"
            onClick={() => shell.openExternal('https://github.com/hainguyents13/mechvibes/')}
          >
            hainguyents13
          </button>
        </p>
        <div className="flex gap-4 justify-center mb-1">
          <button onClick={() => shell.openExternal('https://mechvibes.com')} className="text-[#ff5050] hover:underline bg-transparent border-none p-0 cursor-pointer">Home page</button>
          <span>|</span>
          <button onClick={() => shell.openExternal('https://buymeacoff.ee/hainguyents13')} className="text-[#ff5050] hover:underline bg-transparent border-none p-0 cursor-pointer">Buy me a coffee</button>
          {showDebugButton && (
            <>
              <span>|</span>
              <button onClick={() => ipcRenderer.send('open-debug-options')} className="text-[#ff5050] hover:underline bg-transparent border-none p-0 cursor-pointer">Advanced</button>
            </>
          )}
        </div>
        <p className="text-[#999] mb-1">{appVersion}</p>
        {newVersion && (
          <div className="px-1.5 py-2 border border-[#ffb8b8] bg-[#fff2f2] dark:bg-[#2a1a1a] dark:border-[#7a3030] rounded mb-2">
            New version of Mechvibes is available ({newVersion})
            <div className="mt-1">
              <button onClick={() => shell.openExternal('https://mechvibes.com/download/')} className="text-[#ff5050] hover:underline bg-transparent border-none p-0 cursor-pointer">Check it out</button>
            </div>
          </div>
        )}
        {isDebugInUse && (
          <div className="px-1.5 py-2 border border-[#ffb8b8] bg-[#fff2f2] dark:bg-[#2a1a1a] dark:border-[#7a3030] rounded">
            <button onClick={() => ipcRenderer.send('set-debug-options', { enabled: false })} className="text-[#ff5050] hover:underline bg-transparent border-none p-0 cursor-pointer">Click here</button>
            {' '}to disable remote debugging.
          </div>
        )}
      </div>
    </div>
  );
}
