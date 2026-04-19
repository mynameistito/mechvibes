'use strict';

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
// const gkm = require('gkm');
const Store = require('electron-store');
const store = new Store();
const { Howl } = require('howler');
const { shell, remote, ipcRenderer } = require('electron');
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const { platform } = process;
const { GetFileFromArchive } = require('./libs/soundpacks/file-manager');

const MV_PACK_LSID = remote.getGlobal("current_pack_store_id");
const MV_VOL_LSID = 'mechvibes-volume';
const MV_TRAY_LSID = 'mechvibes-hidden';
const MV_THEME_LSID = 'mechvibes-theme';

const CUSTOM_PACKS_DIR = remote.getGlobal('custom_dir');
const OFFICIAL_PACKS_DIR = path.join(__dirname, 'audio');
const APP_VERSION = remote.getGlobal('app_version');

let active_volume = true;
let system_volume = 50; // a default just incase the algorithm needs to run before the volume is set
let is_system_muted = false;
let current_pack = null;
let current_key_down = null;
const packs = [];
const all_sound_files = {};

const log = {
  silly(message){
    raise_log_message("silly", message);
  },
  debug(message){
    raise_log_message("debug", message);
  },
  verbose(message){
    raise_log_message("verbose", message);
  },
  info(message){
    raise_log_message("info", message);
  },
  warn(message){
    raise_log_message("warn", message);
  },
  error(message){
    raise_log_message("error", message);
  }
}
function raise_log_message(level, message){
  ipcRenderer.send("electron-log", message, level);
}

function loadPack(packId = null){
  if(packId === null){
    Object.keys(packs).map((pid) => {
      const _pack = packs[pid];
      if(_pack.pack_id == current_pack.pack_id){
        packId = pid;
      }
    })
  }

  const app_logo = document.getElementById('logo');
  const app_body = document.getElementById('app-body');

  log.info(`Loading ${packId}`)
  app_logo.innerHTML = 'Loading...';
  app_body.classList.add('loading');
  _loadPack(packId).then(() => {
    log.info("loaded");
    app_logo.innerHTML = 'Mechvibes';
    app_body.classList.remove('loading');
  }).catch((e) => {
    app_logo.innerHTML = 'Failed';
    console.warn(e);
    log.warn(`Failed to load pack: ${e}`);
  });
}

function _loadPack(packId){
  return new Promise((resolve, reject) => {
    if(packs[packId] !== undefined){
      unloadAllPacks(); // unload all loaded packs before attempting to load a new pack.
      const pack = packs[packId];
      if(pack.key_define_type == 'single'){
        pack.LoadSounds().then(() => {
          resolve();
        }).catch((e) => {
          console.warn("Failed to load pack", e);
          reject(e);
        });
      }else{
        pack.LoadSounds().then(() => {
          resolve();
        }).catch((e) => {
          console.warn("Failed to load pack", e);
          reject(e);
        });
      }
    }else{
      reject("That packID doesn't exist");
    }
  })
}

function unloadPack(packId){
  if(packs[packId] !== undefined){
    packs[packId].UnloadSounds();
    return [true];
  }else{
    return [false, "pack doesn't exist"];
  }
}

function unloadAllPacks(){
  Object.keys(packs).map((packId) => {
    if(packs[packId].sound !== undefined){
      unloadPack(packId);
    }
  })
}

// ==================================================
// load all pack
async function loadPacks() {
  // get all audio folders
  const official_packs = await glob.sync(OFFICIAL_PACKS_DIR.replace(/\\/g, '/') + '/*');
  const custom_packs = await glob.sync(CUSTOM_PACKS_DIR.replace(/\\/g, '/') + '/*');
  const folders = [...official_packs, ...custom_packs];

  log.info(`Loading ${folders.length} packs`);
  log.debug(OFFICIAL_PACKS_DIR);
  log.debug(CUSTOM_PACKS_DIR);

  // get pack data
  folders.map((folder) => {
    // get folder name
    const folder_name = path.basename(folder);
    // define if custom pack
    const normalizedCustomDir = CUSTOM_PACKS_DIR.replace(/\\/g, '/');
    const is_custom = folder.startsWith(normalizedCustomDir);
    const is_archive = path.extname(folder) == '.zip';

    let config_json = null;
    let soundpack_metadata = null;

    if(!is_archive){
      // define config file path
      const config_file = `${folder.replace(/\/$/, '')}/config.json`;

      // get pack info and defines data
      if(fs.existsSync(config_file)){
        // get config file
        config_json = require(config_file);
        // compile soundpack metadata
        soundpack_metadata = {
          pack_id: `${is_custom ? 'custom' : 'default'}-${folder_name}`,
          group: is_custom ? 'Custom' : 'Default',
          abs_path: folder,
          folder_name,
          is_custom,
          is_archive,
        };
      }
    }else{
      // get config file
      const config_file = GetFileFromArchive(folder, "config.json");
      if(config_file === null){
        console.warn(`Failed to load config.json from archive: ${folder_name}`);
        return;
      }
      config_json = JSON.parse(config_file);
      // compile soundpack metadata
      soundpack_metadata = {
        pack_id: `${is_custom ? 'custom' : 'default'}-${folder_name}`,
        group: is_custom ? 'Custom' : 'Default',
        abs_path: folder,
        folder_name,
        is_custom,
        is_archive,
      };
    }

    if(config_json === null || soundpack_metadata === null){
      console.warn(`Failed to load config.json: ${folder_name}`);
      return;
    }

    // get soundpack config
    let soundpack_config = null;
    if(config_json.version === undefined){
      const SoundpackConfig = require("./libs/soundpacks/config-v1");
      soundpack_config = new SoundpackConfig(config_json, soundpack_metadata);
    }else{
      try{
        const SoundpackConfig = require(`./libs/soundpacks/config-v${config_json.version}`);
        soundpack_config = new SoundpackConfig(config_json, soundpack_metadata);
      }catch{
        log.warn(`Unsupported config version (${config_json.version}): ${folder_name}`);
      }
    }

    if(soundpack_config === null){
      console.warn(`Failed to load soundpack config: ${folder_name}`);
      return;
    }
    packs.push(soundpack_config);
  });

  // end load
  return;
}

function getPack(pack_id){
  return packs.find((pack) => pack.pack_id == pack_id);
}

function getSavedPack() {
  if (store.has(MV_PACK_LSID)) {
    const pack_id = store.get(MV_PACK_LSID);
    const pack = getPack(pack_id);
    if (!pack) {
      return packs[0];
    }else{
      return pack;
    }
  } else {
    return packs[0];
  }
}

// set pack by its index in the packs array
function setPack(pack_id){
  let index = 0;
  Object.keys(packs).map((packId) => {
    if(packs[packId].pack_id == pack_id){
      index = packId;
    }
  })
  loadPack(index);
  current_pack = packs[index];
  store.set(MV_PACK_LSID, current_pack.pack_id);
}

// set pack by its string id
function setPackByIndex(index){
  loadPack(index);
  current_pack = packs[index];
  store.set(MV_PACK_LSID, current_pack.pack_id);
}

// ==================================================
// transform pack to select option list
function packsToOptions(packs, pack_list) {
  // get saved pack id
  const selected_pack_id = store.get(MV_PACK_LSID);
  const groups = [];
  packs.map((pack) => {
    const exists = groups.find((group) => group.id == pack.group);
    if (!exists) {
      const group = {
        id: pack.group,
        name: pack.group || 'Default',
        packs: [pack],
      };
      groups.push(group);
    } else {
      exists.packs.push(pack);
    }
  });

  for (let group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.name;
    for (let pack of group.packs) {
      // check if selected
      const is_selected = selected_pack_id == pack.pack_id;
      if (is_selected) {
        // pack current pack to saved pack
        setPack(pack.pack_id);
      }
      // add pack to pack list
      const opt = document.createElement('option');
      opt.text = `${pack.name} [v${pack.config_version}]`;
      opt.value = pack.pack_id;
      opt.selected = is_selected ? 'selected' : false;
      optgroup.appendChild(opt);
    }
    pack_list.appendChild(optgroup);
  }

  // on select an option
  // update saved list id
  pack_list.addEventListener('change', (e) => {
    const selected_id = e.target.options[e.target.selectedIndex].value;
    setPack(selected_id);
  });
}

// ==================================================
// main
(function (window, document) {
  window.addEventListener('DOMContentLoaded', async () => {
    const version = document.getElementById('app-version');
    const update_available = document.getElementById('update-available');
    const debug_in_use = document.getElementById('remote-in-use');
    const quick_disable_remote = document.getElementById('quick-disable-remote');
    const mechvibes_muted = document.getElementById('mechvibes-muted');
    const system_muted = document.getElementById('system-muted');
    const new_version = document.getElementById('new-version');
    const app_logo = document.getElementById('logo');
    const app_body = document.getElementById('app-body');
    const pack_list = document.getElementById('pack-list');
    const random_button = document.getElementById('random-button');
    const debug_button = document.getElementById('open-debug-options');
    const debug_button_seperator = document.getElementById('debug-options-seperator');
    const volume_value = document.getElementById('volume-value-display');
    const volume = document.getElementById('volume');
    const tray_icon_toggle = document.getElementById("tray_icon_toggle");
    const tray_icon_toggle_group = document.getElementById("tray_icon_toggle_group");
    const theme_toggle = document.getElementById("theme_toggle");
    const theme_toggle_group = document.getElementById("theme_toggle_group");
    const startup_toggle = document.getElementById("startup_toggle");
    const startup_toggle_group = document.getElementById("startup_toggle_group");
    const mute_toggle = document.getElementById("mute_toggle");
    const mute_toggle_group = document.getElementById("mute_toggle_group");
    const hotkey_button = document.getElementById("hotkey_button");

    // init
    app_logo.innerHTML = 'Loading...';

    // set app version
    version.innerHTML = APP_VERSION;

    // load all packs
    await loadPacks(app_logo, app_body);

    // transform packs to options list
    packsToOptions(packs, pack_list);

    // check for new version
    fetch('https://api.github.com/repos/hainguyents13/mechvibes/releases/latest')
      .then((res) => res.json())
      .then((json) => {
        if (json.tag_name.localeCompare(APP_VERSION, undefined, { numeric: true }) === 1) {
          new_version.innerHTML = json.tag_name;
          update_available.classList.remove('hidden');
        }
      });

    // check if remote debugging can be enabled by user
    fetch("https://beta.mechvibes.com/debug/status/", {
      method: "GET",
      headers: {
        "User-Agent": `Mechvibes/${APP_VERSION} (Electron/${process.versions.electron})`
      }
    }).then(async (res) => {
      const body = await res.text();
      if(res.status == 200 && body == "enabled"){
        debug_button.classList.remove("hidden");
        debug_button_seperator.classList.remove("hidden");
      }
    });

    // a little hack for open link in browser
    Array.from(document.getElementsByClassName('open-in-browser')).forEach((elem) => {
      elem.addEventListener('click', (e) => {
        e.preventDefault();
        shell.openExternal(e.target.href);
      });
    });

    // get last selected pack
    current_pack = getSavedPack();
    loadPack()

    // handle tray hiding
    if (store.get(MV_TRAY_LSID) !== undefined){
      tray_icon_toggle.checked = store.get(MV_TRAY_LSID);
    }
    tray_icon_toggle_group.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      // toggle checkbox
      tray_icon_toggle.checked = !tray_icon_toggle.checked;
      ipcRenderer.send("show_tray_icon", tray_icon_toggle.checked);
      store.set(MV_TRAY_LSID, tray_icon_toggle.checked);
    }

    // ensure tray icon is reflected
    let initTray = () => {
      ipcRenderer.send("show_tray_icon", tray_icon_toggle.checked);
    }
    initTray();

    // theme toggle
    const savedTheme = store.get(MV_THEME_LSID, 'system');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDarkMode = savedTheme === 'dark' || (savedTheme === 'system' && prefersDark);
    if (isDarkMode) {
      document.body.classList.add('dark');
      theme_toggle.checked = true;
    }
    theme_toggle_group.onclick = function(e) {
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

    // startup on boot toggle
    ipcRenderer.on("startup-status", (_event, enabled) => {
      startup_toggle.checked = enabled;
    });
    startup_toggle_group.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      startup_toggle.checked = !startup_toggle.checked;
      ipcRenderer.send('set-startup', startup_toggle.checked);
    };
    ipcRenderer.send("get-startup-status");

    // volume
    let displayVolume = () => {
      let primary = document.createElement('span');
      primary.innerText = `${volume.value}`;
      volume_value.innerHTML = `${primary.outerHTML}`;
      if(active_volume){
        let adjusted = document.createElement('span');
        adjusted.innerText = `(${Math.round(volume.value * (100 / system_volume))})`;
        adjusted.style.marginLeft = '1em';
        adjusted.style.fontSize = '12px';
        adjusted.style.fontWeight = 'normal';
        adjusted.style.opacity = '0.5';

        volume_value.appendChild(adjusted);
      }
    }
    if (store.get(MV_VOL_LSID)) {
      volume.value = store.get(MV_VOL_LSID);
    }else{
      volume.value = 50;
    }
    displayVolume();
    volume.oninput = function (e) {
      store.set(MV_VOL_LSID, this.value);
      displayVolume();
    };

    volume.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Determine the scroll direction and adjust the volume
      if (e.deltaY < 0) {
        // Scroll up, increase volume
        console.log("negative", volume.value, volume.step, volume.max);
        volume.value = Math.min(parseInt(volume.max), parseInt(volume.value) + parseInt(volume.step));

      } else {
        // Scroll down, decrease volume
        console.log("positive", volume.value, volume.step, volume.min);
        volume.value = Math.max(parseInt(volume.min), parseInt(volume.value) - parseInt(volume.step));
      }
      store.set(MV_VOL_LSID, volume.value);
      displayVolume();
    });

    // warn about debugging
    ipcRenderer.on("debug-in-use", (_event, enabled) => {
      if(enabled){
        debug_in_use.classList.remove("hidden");
      }else{
        debug_in_use.classList.add("hidden");
      }
    });

    ipcRenderer.on("system-volume-update", (_event, vol) => {
      system_volume = vol;
      displayVolume();
    });

    // warn about muted system
    ipcRenderer.on("system-mute-status", (_event, enabled) => {
      is_system_muted = enabled;
      if(enabled){
        system_muted.classList.remove("hidden");
      }else{
        system_muted.classList.add("hidden");
      }
    });

    // mute toggle button
    mute_toggle_group.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      ipcRenderer.send("toggle-mute");
    };

    function renderHotkey(hotkey) {
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

    // hotkey recording
    let recordingHotkey = false;
    hotkey_button.addEventListener('click', () => {
      if (recordingHotkey) return;
      recordingHotkey = true;
      hotkey_button.classList.add('recording-hotkey');
      hotkey_button.innerHTML = '';
      hotkey_button.textContent = 'Press a key combo...';

      function onKeyDown(e) {
        e.preventDefault();
        e.stopPropagation();

        // require at least one modifier
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return;

        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');

        const key = e.key;
        // skip bare modifier keys
        if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return;

        // derive physical key name from e.code to avoid shifted chars (e.g. Shift+1 = "!" via e.key)
        const codeMap = {
          'Space': 'Space',
          'Enter': 'Return', 'NumpadEnter': 'Return',
          'Escape': 'Escape', 'Tab': 'Tab',
          'Backspace': 'Backspace', 'Delete': 'Delete',
          'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
          'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
          'Insert': 'Insert', 'PrintScreen': 'PrintScreen',
          'NumLock': 'NumLock', 'CapsLock': 'CapsLock', 'ScrollLock': 'ScrollLock',
        };
        let keyName;
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

    // listen for hotkey updates
    ipcRenderer.on("mute-hotkey", (_event, hotkey) => {
      renderHotkey(hotkey);
    });

    // warn about muted mechvibes
    ipcRenderer.on("mechvibes-mute-status", (_event, enabled) => {
      mute_toggle.checked = enabled;
      if(enabled){
        mechvibes_muted.classList.remove("hidden");
      }else{
        mechvibes_muted.classList.add("hidden");
      }
    });

    // query initial mute state and hotkey (after listeners are registered)
    ipcRenderer.send("get-mute-status");

    ipcRenderer.on("ava-toggle", (_event, enabled) => {
      active_volume = enabled;
      displayVolume();
    });

    // tracks keys visually and provides safety auto-release in case keyup IPC is lost
    let pressed_keys = {};

    function releaseKey(keycode) {
      const key = `${keycode}`;
      if (pressed_keys[key]) {
        clearTimeout(pressed_keys[key]);
      }
      pressed_keys[key] = null;
      const anyHeld = Object.values(pressed_keys).some(Boolean);
      if (!anyHeld) {
        app_logo.classList.remove('pressed');
      }
    }

    ipcRenderer.on('keyup', (_, { keycode }) => {
      releaseKey(keycode);
      playSound({ type: "keyup", keycode }, volume.value);
    });

    ipcRenderer.on('keydown', (_, { keycode, isRepeat }) => {
      if (pressed_keys[`${keycode}`]) {
        clearTimeout(pressed_keys[`${keycode}`]);
      }
      pressed_keys[`${keycode}`] = setTimeout(() => releaseKey(keycode), 500);
      if (!isRepeat) {
        app_logo.classList.add('pressed');
        playSound({ type: "keydown", keycode }, volume.value);
      }
    });

    ipcRenderer.on('clear-pressed-keys', () => {
      for (const key in pressed_keys) {
        clearTimeout(pressed_keys[key]);
      }
      pressed_keys = {};
      app_logo.classList.remove('pressed');
    });

    // on random button click
    // set random sound
    random_button.addEventListener('click', (e) => {
      e.preventDefault();
      let getRandomPackId = () => {
        let randomId = Math.floor(Math.random() * packs.length);
        if (packs[randomId].pack_id === current_pack.pack_id) {
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
      ipcRenderer.send("open-debug-options");
    })

    quick_disable_remote.addEventListener('click', (e) => {
      e.preventDefault();
      ipcRenderer.send("set-debug-options", { enabled: false });
    });
  });
})(window, document);

// ==================================================
// universal play function
function playSound(event, volume) {
  if(current_pack === null || current_pack.audio === undefined){
    // sound for this pack hasn't been loaded
    return;
  }

  if(active_volume){
    // dynamic volume adjustment
    const adjustedVolume = volume * (100 / system_volume);
    
    if(!is_system_muted){
      log.silly(`Volume: ${volume}`);
      log.silly(`System Volume: ${system_volume}`);
      log.silly(`Adjusted Volume: ${adjustedVolume}`);
      log.silly(`Result Volume: ${adjustedVolume / 100}`);
    }

    Howler.masterGain.gain.setValueAtTime(Number(adjustedVolume / 100), Howler.ctx.currentTime);
  }else{
    Howler.masterGain.gain.setValueAtTime(Number(volume / 100), Howler.ctx.currentTime);
  }

  if(current_pack.HandleEvent !== undefined){
    // if pack has custom play sound function, use it
    current_pack.HandleEvent(event, volume);
    log.info(`Playing sound for keycode: ${event.keycode} (${event.type})`);
    return;
  }else{
    log.warn("Pack version doesn't have a HandleEvent function");
    return;
  }
}
