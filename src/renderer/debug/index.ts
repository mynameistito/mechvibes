import { ipcRenderer } from 'electron';

interface DebugOptions {
  enabled: boolean;
  identifier: string | undefined;
  level?: string | false;
}

let debug: DebugOptions | undefined;

function onReady(): void {
  if (debug === undefined) {
    console.error("debug options aren't set yet?");
    return;
  }

  const enable_toggle_group = document.getElementById('remote_toggle_group')!;
  const debug_code = document.getElementById('debug_code') as HTMLInputElement;

  enable_toggle_group.addEventListener('click', () => {
    if (!debug) return;
    debug.enabled = !debug.enabled;
    if (!debug.enabled) {
      debug.identifier = undefined;
    }
    setDebugOptions(debug);
    refresh();
  });

  debug_code.addEventListener('focus', () => {
    debug_code.select();
  });

  refresh();
}

function refresh(): void {
  if (!debug) return;
  const enable_toggle = document.getElementById('remote_toggle') as HTMLInputElement;
  const remote_options_group = document.getElementById('remote_options') as HTMLElement;
  const debug_code = document.getElementById('debug_code') as HTMLInputElement;

  enable_toggle.checked = debug.enabled;
  if (debug.enabled) {
    remote_options_group.style.display = 'block';
    debug_code.value = debug.identifier ?? '';
  } else {
    remote_options_group.style.display = 'none';
    debug_code.value = '';
  }
}

function setDebugOptions(options: DebugOptions): void {
  ipcRenderer.send('set-debug-options', options);
}

ipcRenderer.once('debug-options', (_event, json: DebugOptions) => {
  debug = json;
  onReady();
});

ipcRenderer.on('debug-update', (_event, json: DebugOptions) => {
  debug = json;
  refresh();
});
