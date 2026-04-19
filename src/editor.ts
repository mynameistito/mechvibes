/// <reference types="jquery" />
import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import Store from 'electron-store';
import remapper from './utils/remapper.js';
import { win32 as layoutWin32, darwin as layoutDarwin, linux as layoutLinux, sizes } from './libs/layouts.js';
import { win32 as kcWin32, darwin as kcDarwin, linux as kcLinux } from './libs/keycodes.js';
import type { Layout } from './libs/layouts.js';
import type { KeycodeMap, Platform, KeyDefines } from './libs/keycodes.js';
export {};

// jQuery is loaded via <script> tag in editor.html before this module runs
declare const $: JQueryStatic;

const _store = new Store();
const layoutsByPlatform: Record<string, Layout> = { win32: layoutWin32, darwin: layoutDarwin, linux: layoutLinux };
const kcByPlatform: Record<string, KeycodeMap> = { win32: kcWin32, darwin: kcDarwin, linux: kcLinux };
const layout = layoutsByPlatform[process.platform] ?? layoutWin32;
const os_keycode = kcByPlatform[process.platform] ?? kcWin32;

const CUSTOM_PACKS_DIR = path.join(__dirname, '../../../custom');

type DefineValue = [number, number] | string | null;

interface PackData {
  id: string;
  name: string;
  key_define_type: 'single' | 'multi';
  includes_numpad: boolean;
  sound: string;
  defines: Record<string, DefineValue>;
}

let selected_keycode: number | null = null;
let current_edit_mode = 'visual';
let current_key_define_mode: 'single' | 'multi' = 'single';

const pack_data: PackData = {
  id: `custom-sound-pack-${Date.now()}`,
  name: 'Untitled',
  key_define_type: 'single',
  includes_numpad: false,
  sound: 'sound.ogg',
  defines: Object.fromEntries(
    Object.keys(os_keycode).map((kc) => [kc, null]),
  ),
};

$(document).ready(() => {
  const _savedTheme = _store.get('mechvibes-theme', 'system') as string;
  const _prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (_savedTheme === 'dark' || (_savedTheme === 'system' && _prefersDark)) {
    document.body.classList.add('dark');
  }

  Array.from(document.getElementsByClassName('open-in-browser')).forEach((elem) => {
    elem.addEventListener('click', (e) => {
      e.preventDefault();
      shell.openExternal((e.target as HTMLAnchorElement).href);
    });
  });

  $('#open-custom-pack-folder').on('click', () => {
    shell.showItemInFolder(CUSTOM_PACKS_DIR);
  });

  ($('#pack-name') as JQuery<HTMLInputElement>).val(pack_data.name);
  ($('#single-sound-file') as JQuery<HTMLInputElement>).val(pack_data.sound);

  const keyboard_holder = $('#kb');
  keyboard_holder.html('');

  for (const zone of ['main', 'edit', 'numpad'] as const) {
    const zone_wrapper = $(`<div id="zone-${zone}"></div>`);
    const manual_zone_wrapper = $(`#pack-zone-${zone}`);
    const zone_rows = layout[zone];
    let r = 0;
    for (const row of zone_rows) {
      const _row = $(`<div class="key-row ${r === 0 ? 'key-row-top' : ''}"></div>`);
      if (row.length) {
        for (const key of row as number[]) {
          const _key = $(`
            <div id="key-${key}" class="key ${sizes[key] ?? ''} ${key ? '' : 'key-blank'}" data-keycode="${key}">
              <div class="letter">${os_keycode[key] ?? ''}</div>
            </div>
          `);
          _key.appendTo(_row);
          _genPopover(_key, key, r > 3, zone === 'numpad');
          if (key) {
            const manual_key = $(`
              <div id="manual-key-${key}" style="border-bottom:1px solid #eee;padding:10px;display:flex;justify-content:space-between;align-items:center" class="manual-key">
                <div style="font-weight:bold;margin-right:10px">${os_keycode[key]}</div>
                <div class="define-mode define-mode-single">
                  <div style="display:flex;">
                    <input type="number" placeholder="Start..." style="margin-right:5px;width:60px;" class="key-define custom-input sound-start" data-keycode="${key}"/>
                    <input type="number" placeholder="Length..." style="width:60px;" class="key-define custom-input sound-length" data-keycode="${key}"/>
                  </div>
                </div>
                <div class="define-mode define-mode-multi">
                  <input type="text" placeholder="File name..." style="margin-right:5px;width:100%;" class="key-define custom-input sound-file" data-keycode="${key}"/>
                </div>
              </div>
            `);
            manual_key.appendTo(manual_zone_wrapper);
          }
        }
      }
      r++;
      _row.appendTo(zone_wrapper);
    }
    zone_wrapper.appendTo(keyboard_holder);
  }

  $('#kb').on('click', '.key', (e) => {
    const target = $(e.currentTarget);
    if (target.hasClass('key-blank')) { e.preventDefault(); return false; }
    const keycode = target.data('keycode') as number;
    if (!$(e.target).hasClass('close')) {
      $('.key').removeClass('key-pressed key-show-popover').addClass('key-hide');
      target.addClass('key-pressed key-show-popover').removeClass('key-hide');
    }
    selected_keycode = keycode;
  });

  $('#kb').on('click', '.popover .close', () => {
    setTimeout(() => { $('.key').removeClass('key-pressed key-show-popover key-hide'); });
  });

  $('#kb').on('click', '.popover .save', (e) => {
    setTimeout(() => {
      $('.key').removeClass('key-pressed key-show-popover key-hide');
      const keycode = $(e.currentTarget).data('keycode') as string;
      if (!current_key_define_mode || current_key_define_mode === 'single') {
        const start = $(e.currentTarget).find('.sound-start');
        const length = $(e.currentTarget).find('.sound-length');
        pack_data.defines[keycode] = [Number(start.val()), Number(length.val())];
      } else {
        const file_name = $(e.currentTarget).find('.sound-name');
        pack_data.defines[keycode] = file_name.val() as string;
      }
      _checkIfHasSound();
    });
  });

  $('.edit-mode-manual').on('change', '.key-define', (e) => {
    const keycode = $(e.target).data('keycode') as string;
    if (!current_key_define_mode || current_key_define_mode === 'single') {
      if (!pack_data.defines[keycode]) pack_data.defines[keycode] = [0, 0];
      if ($(e.target).hasClass('sound-start')) {
        (pack_data.defines[keycode] as [number, number])[0] = Number($(e.target).val());
      } else {
        (pack_data.defines[keycode] as [number, number])[1] = Number($(e.target).val());
      }
    } else {
      pack_data.defines[keycode] = $(e.target).val() as string;
    }
    _checkIfHasSound();
  });

  ($('#single-sound-file') as JQuery<HTMLInputElement>).on('change', (e) => {
    pack_data.sound = (e.target as HTMLInputElement).value || 'sound.ogg';
    genResults();
  });

  ($('#pack-name') as JQuery<HTMLInputElement>).on('change', (e) => {
    pack_data.name = (e.target as HTMLInputElement).value || 'Untitled';
    genResults();
  });

  $('.edit-mode-manual').hide();
  ($('#edit-mode') as JQuery<HTMLSelectElement>).on('change', (e) => {
    current_edit_mode = (e.target as HTMLSelectElement).value;
    $('.edit-mode').hide();
    $(`.edit-mode-${current_edit_mode}`).show();
    if (current_edit_mode === 'manual') {
      for (const kc in pack_data.defines) {
        const val = pack_data.defines[kc];
        if (val != null && $(`.sound-file[data-keycode="${kc}"]`)) {
          if (typeof val === 'string') {
            $(`.sound-file[data-keycode="${kc}"]`).val(val);
          } else {
            $(`.sound-start[data-keycode="${kc}"]`).val(val[0]);
            $(`.sound-length[data-keycode="${kc}"]`).val(val[1]);
          }
        }
      }
    } else {
      for (const kc in pack_data.defines) {
        const val = pack_data.defines[kc];
        if (val != null && $(`.sound-file[data-keycode="${kc}"]`)) {
          if (typeof val === 'string') {
            $(`.key[data-keycode="${kc}"]`).find('.sound-name').val(val);
          } else {
            $(`.key[data-keycode="${kc}"]`).find('.sound-start').val(val[0]);
            $(`.key[data-keycode="${kc}"]`).find('.sound-length').val(val[1]);
          }
        }
      }
    }
  });

  $('.define-mode-multi').hide();
  ($('#key-define-mode') as JQuery<HTMLSelectElement>).on('change', (e) => {
    const val = (e.target as HTMLSelectElement).value as 'single' | 'multi';
    pack_data.key_define_type = val;
    current_key_define_mode = val;
    $('.define-mode').hide();
    $(`.define-mode-${val}`).show();
    $('.key-define').each((_i, el) => { (el as HTMLInputElement).value = ''; });
    for (const kc of Object.keys(pack_data.defines)) {
      pack_data.defines[kc] = null;
    }
    _checkIfHasSound();
  });

  $('#create').on('click', () => {
    Object.assign(pack_data, {
      id: `custom-sound-pack-${Date.now()}`,
      key_define_type: 'single',
      name: 'Untitled',
      sound: 'sound.ogg',
    });
    for (const kc of Object.keys(pack_data.defines)) { pack_data.defines[kc] = null; }
    ($('#pack-name') as JQuery<HTMLInputElement>).val(pack_data.name);
    ($('#single-sound-file') as JQuery<HTMLInputElement>).val(pack_data.sound);
    $('.key-define').val('');
  });

  ($('#import') as JQuery<HTMLElement>).on('click', () => {
    ($('#import-input') as JQuery<HTMLInputElement>)[0].click();
  });
  ($('#import-input') as JQuery<HTMLInputElement>).on('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files || !files[0]) return;
    const buffer = fs.readFileSync(files[0].path);
    const imported_data = JSON.parse(buffer.toString()) as PackData;
    importPack(imported_data);
    _checkIfHasSound();
    genResults();
  });

  $('#export').on('click', () => {
    const a = document.createElement('a');
    const file = new Blob([JSON.stringify(pack_data, null, 2)], { type: 'text/plain' });
    a.href = URL.createObjectURL(file);
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
});

function _checkIfHasSound(): void {
  for (const kc of Object.keys(pack_data.defines)) {
    if (pack_data.defines[kc] != null) {
      $(`.key[data-keycode=${kc}]`).addClass('key-has-sound');
      $(`#manual-key-${kc}`).addClass('key-has-sound');
    } else {
      $(`.key[data-keycode=${kc}]`).removeClass('key-has-sound');
      $(`#manual-key-${kc}`).removeClass('key-has-sound');
    }
  }
  genResults();
}

function _genPopover(target: JQuery, keycode: number, up: boolean, left: boolean): void {
  const popover = $(`
    <div class="popover ${up ? 'up' : ''} ${left ? 'left' : ''}" style="min-width:250px;position:absolute">
      <div class="define-mode define-mode-single" style="margin-bottom:10px">
        <div style="margin-bottom:5px">Set start and length (ms)</div>
        <div style="display:flex;">
          <input type="number" placeholder="Start..." style="margin-right:10px;width:50%;" class="key-define custom-input sound-start" data-keycode="${keycode}"/>
          <input type="number" placeholder="Length..." style="width:50%" class="key-define custom-input sound-length" data-keycode="${keycode}"/>
        </div>
      </div>
      <div class="define-mode define-mode-multi" style="margin-bottom:10px">
        <div style="margin-bottom:5px">Enter audio file name:</div>
        <input type="text" placeholder="Sound file name..." class="key-define custom-input sound-name" data-keycode="${keycode}" style="width:95%;margin-right:10px;"/>
      </div>
      <div style="display:flex;justify-content:space-between">
        <button class="save" data-keycode="${keycode}">Save</button>
        <button class="close">Close</button>
      </div>
    </div>
  `);
  popover.appendTo(target);
}

function genResults(): void {
  const container = $('#result');
  pack_data.defines = remapper(process.platform as Platform, 'standard', pack_data.defines as KeyDefines) as PackData['defines'];
  container.html(JSON.stringify(pack_data, null, 2));
}

function importPack(imported: PackData): void {
  Object.assign(pack_data, imported);
  ($('#pack-name') as JQuery<HTMLInputElement>).val(pack_data.name);
  ($('#single-sound-file') as JQuery<HTMLInputElement>).val(pack_data.sound);
  pack_data.defines = remapper('standard', process.platform as Platform, pack_data.defines as KeyDefines) as PackData['defines'];

  const key_define_type = imported.key_define_type || 'single';
  $('.define-mode').hide();
  $(`.define-mode-${key_define_type}`).show();
  ($('#key-define-mode') as JQuery<HTMLSelectElement>).val(key_define_type);
  current_key_define_mode = key_define_type;

  for (const kc in pack_data.defines) {
    const val = pack_data.defines[kc];
    if (val && $(`.sound-file[data-keycode="${kc}"]`) && val !== '' && JSON.stringify(val) !== '[0,0]') {
      if (current_key_define_mode === 'single') {
        if (typeof val === 'string') {
          $(`.key[data-keycode="${kc}"]`).find('.sound-name').val(val);
        } else {
          $(`.key[data-keycode="${kc}"]`).find('.sound-start').val(val[0]);
          $(`.key[data-keycode="${kc}"]`).find('.sound-length').val(val[1]);
        }
      } else {
        if (typeof val === 'string') {
          $(`.sound-file[data-keycode="${kc}"]`).val(val);
        } else {
          $(`.sound-start[data-keycode="${kc}"]`).val(val[0]);
          $(`.sound-length[data-keycode="${kc}"]`).val(val[1]);
        }
      }
    }
  }
}
