# Plan: Mechvibes File Restructure

## Context

Current `src/` is a flat mix of main-process code, 4 independent renderer windows, shared libs, and utilities. No visual separation between Electron's two execution environments. Each window's `.ts`, `.html`, `.css` are split across unrelated directories. `main.ts` is 820 lines mixing concerns. Goal: clean separation of concerns, co-located window files, explicit shared/main-only boundaries.

### Preexisting Bugs Found During Audit

1. **Editor window missing `contextIsolation: false`** — `editor.ts` imports `fs`, `path`, `electron` which throw at runtime without it. All other windows have both `contextIsolation: false` and `nodeIntegration: true`.
2. **Editor window uses script tag for JS instead of preload** — `editor.html` has `<script src="../dist/editor.js">`, while all other windows use preload injection. Inconsistent and causes the editor JS to be loaded differently from other windows.
3. **`editor.html` references nonexistent `./assets/style.css`** — this file does not exist in `src/assets/`. Dead reference that should be removed.

---

## Target Structure

```
src/
├── main/
│   ├── index.ts                  # was main.ts
│   ├── windows/
│   │   ├── app-window.ts         # createWindow() extracted
│   │   ├── editor-window.ts      # openEditorWindow() extracted
│   │   ├── install-window.ts     # openInstallWindow() extracted
│   │   └── debug-window.ts       # createDebugWindow() extracted
│   └── services/
│       ├── tray.ts               # createTrayIcon(), buildContextMenu()
│       ├── hotkey.ts             # parseHotkey(), matchesHotkey(), uIOhook
│       └── volume.ts             # pollVolume(), pollMute()
│
├── renderer/
│   ├── app/
│   │   ├── index.ts              # was app.ts
│   │   ├── index.html            # was app.html
│   │   └── app.css               # was assets/app.css
│   ├── editor/
│   │   ├── index.ts              # was editor.ts
│   │   ├── index.html            # was editor.html
│   │   └── editor.css            # was assets/editor.css
│   ├── install/
│   │   ├── index.ts              # was install.ts
│   │   └── index.html            # was install.html
│   └── debug/
│       ├── index.ts              # was debug.ts
│       └── index.html            # was debug.html
│
├── shared/                       # pure code, no electron/node-only imports
│   ├── keycodes.ts               # was libs/keycodes.ts
│   ├── layouts.ts                # was libs/layouts.ts
│   ├── remapper.ts               # was utils/remapper.ts
│   └── soundpacks/               # was libs/soundpacks/
│       ├── soundpack-config.ts
│       ├── config-v1.ts
│       ├── config-v2.ts
│       └── file-manager.ts
│
├── main-only/                    # main-process-only utilities
│   ├── ipc.ts                    # was utils/ipc.ts
│   ├── store-toggle.ts           # was utils/store_toggle.ts
│   ├── startup-handler.ts        # was utils/startup_handler.ts
│   └── electron-log/
│       └── remote-transport.ts   # was libs/electron-log/transports/remote.ts
│
└── assets/                       # static files (unchanged)
    ├── icon.png
    ├── system-tray-icon.png
    ├── system-tray-icon-muted.png
    ├── jquery.js
    ├── milligram.min.css
    └── milligram.min.css.map

audio/                            # moved OUT of src/ — plain data, not compiled
├── cherrymx-black-abs/
└── ... (18 soundpack folders)
```

---

## Implementation Phases

### Phase 1 — Move main.ts + fix editor window bug (1 commit)

**Move:**
- `src/main.ts` → `src/main/index.ts`

**Config updates:**
- `package.json`: `"main"` → `"dist/main/index.js"`

**Fix preexisting bug — editor window webPreferences:**
- Add `contextIsolation: false` to `openEditorWindow()`. (`nodeIntegration: true` already present.)
- Add `preload: path.join(__dirname, '../renderer/editor/index.js')` to `openEditorWindow()` — bringing it in line with the other 3 windows.
- Remove `<script src="../dist/editor.js">` from editor.html (JS now loaded via preload, consistent with other windows).

**Update all `__dirname`-relative paths in `main/index.ts`:**

After moving from `dist/main.js` (depth: `dist/`) to `dist/main/index.js` (depth: `dist/main/`), all `__dirname`-relative paths gain one more `../`:

| Path | Current | After Phase 1 |
|------|---------|---------------|
| Preload: app | `path.join(__dirname, 'app.js')` | `path.join(__dirname, '../app.js')` |
| Preload: install | `path.join(__dirname, 'install.js')` | `path.join(__dirname, '../install.js')` |
| Preload: debug | `path.join(__dirname, 'debug.js')` | `path.join(__dirname, '../debug.js')` |
| Preload: editor | *(new)* | `path.join(__dirname, '../editor.js')` |
| Tray icon | `path.join(__dirname, '../src/assets/system-tray-icon.png')` | `path.join(__dirname, '../../src/assets/system-tray-icon.png')` |
| Tray icon (muted) | `path.join(__dirname, '../src/assets/system-tray-icon-muted.png')` | `path.join(__dirname, '../../src/assets/system-tray-icon-muted.png')` |

> **Note:** Preload paths pointing to `../app.js` etc. are temporary — Phase 2 will move renderer files into subdirectories, at which point these become `../renderer/app/index.js` etc. The two-phase approach means Phase 1 can be verified independently before touching renderer layout.

**Verify:** `bun run build && bun run dev` — app launches, all 4 windows work.

---

### Phase 2 — Create per-window renderer folders (1 commit per window, 4 commits)

Each commit moves one window's files and updates references. Process in isolation so each window can be verified independently.

#### 2a — App window

**Move files:**
| From | To |
|------|----|
| `src/app.ts` | `src/renderer/app/index.ts` |
| `src/app.html` | `src/renderer/app/index.html` |
| `src/assets/app.css` | `src/renderer/app/app.css` |

**Update `main/index.ts`:**
- `loadFile('./src/app.html')` → `loadFile('./src/renderer/app/index.html')`
- `preload: path.join(__dirname, '../app.js')` → `path.join(__dirname, '../renderer/app/index.js')`

**Update `src/renderer/app/index.html` — all asset references change relative to new location:**
| Reference | Current | New |
|-----------|---------|-----|
| Icon | `./assets/icon.png` | `../../assets/icon.png` |
| Stylesheet (shared) | `./assets/milligram.min.css` | `../../assets/milligram.min.css` |
| Stylesheet (own) | `./assets/app.css` | `./app.css` |

**Update `src/renderer/app/index.ts` — `__dirname`-relative paths:**
- `OFFICIAL_PACKS_DIR`: `'../src/audio'` → `'../../../src/audio'` (compiled JS now at `dist/renderer/app/index.js`, goes up 3 levels to project root, then into `src/audio`). *Will change again in Phase 4.*

**Update `src/renderer/app/index.ts` — import paths:**
- `'./libs/soundpacks/file-manager.js'` → `'../../shared/soundpacks/file-manager.js'` (and similar for config-v1, config-v2, soundpack-config) — *if Phase 3 hasn't run yet, keep old paths.*

> **Sequencing note:** If doing Phase 2 before Phase 3, renderer imports still point to `../../libs/` and `../../utils/`. Phase 3 then updates them. If doing Phase 3 first, imports already use `../../shared/` before moving. Either order works; Phase 3 just needs a find-and-replace pass across the new paths.

#### 2b — Editor window

**Move files:**
| From | To |
|------|----|
| `src/editor.ts` | `src/renderer/editor/index.ts` |
| `src/editor.html` | `src/renderer/editor/index.html` |
| `src/assets/editor.css` | `src/renderer/editor/editor.css` |

**Update `main/index.ts`:**
- `loadFile('./src/editor.html')` → `loadFile('./src/renderer/editor/index.html')`
- `preload: path.join(__dirname, '../editor.js')` → `path.join(__dirname, '../renderer/editor/index.js')`

**Update `src/renderer/editor/index.html` — all asset references:**
| Reference | Current | New |
|-----------|---------|-----|
| Icon (link) | `./assets/icon.png` | `../../assets/icon.png` |
| **Stylesheet (dead ref — remove)** | `./assets/style.css` | *(remove entire `<link>` line)* |
| Stylesheet (own) | `./assets/editor.css` | `./editor.css` |
| Icon (img tag) | `./assets/icon.png` | `../../assets/icon.png` |
| jQuery | `./assets/jquery.js` | `../../assets/jquery.js` |
| **Script tag (remove)** | `<script src="../dist/editor.js">` | *(remove — JS loaded via preload now)* |

**Update `src/renderer/editor/index.ts` — import paths** (Phase 3 or as part of this commit):
- `'./utils/remapper.js'` → `'../../shared/remapper.js'`
- `'./libs/layouts.js'` → `'../../shared/layouts.js'`
- `'./libs/keycodes.js'` → `'../../shared/keycodes.js'`

**Update `src/renderer/editor/index.ts` — `__dirname`-relative paths:**
- `CUSTOM_PACKS_DIR`: `'../../../custom'` → `'../../../../custom'` (compiled JS now at `dist/renderer/editor/index.js`, needs 4 levels up to project root)

#### 2c — Install window

**Move files:**
| From | To |
|------|----|
| `src/install.ts` | `src/renderer/install/index.ts` |
| `src/install.html` | `src/renderer/install/index.html` |

**Note:** `install.html` references `./assets/app.css` and `./assets/milligram.min.css` (not its own CSS). These become `../../assets/app.css` and `../../assets/milligram.min.css`.

**Update `main/index.ts`:**
- `loadFile('./src/install.html')` → `loadFile('./src/renderer/install/index.html')`
- `preload: path.join(__dirname, '../install.js')` → `path.join(__dirname, '../renderer/install/index.js')`

**Update `src/renderer/install/index.html`:**
| Reference | Current | New |
|-----------|---------|-----|
| Icon | `./assets/icon.png` | `../../assets/icon.png` |
| Stylesheet (shared) | `./assets/milligram.min.css` | `../../assets/milligram.min.css` |
| Stylesheet (app's) | `./assets/app.css` | `../../assets/app.css` |

#### 2d — Debug window

**Move files:**
| From | To |
|------|----|
| `src/debug.ts` | `src/renderer/debug/index.ts` |
| `src/debug.html` | `src/renderer/debug/index.html` |

**Update `main/index.ts`:**
- `loadFile('./src/debug.html')` → `loadFile('./src/renderer/debug/index.html')`
- `preload: path.join(__dirname, '../debug.js')` → `path.join(__dirname, '../renderer/debug/index.js')`

**Update `src/renderer/debug/index.html`:**
| Reference | Current | New |
|-----------|---------|-----|
| Icon | `./assets/icon.png` | `../../assets/icon.png` |
| Stylesheet (shared) | `./assets/milligram.min.css` | `../../assets/milligram.min.css` |
| Stylesheet (app's) | `./assets/app.css` | `../../assets/app.css` |

**Verify after each sub-commit:** `bun run build && bun run dev` — test the moved window still renders and functions.

---

### Phase 3 — Move shared + main-only modules (1 commit)

**Moves:**
| From | To |
|------|----|
| `src/libs/keycodes.ts` | `src/shared/keycodes.ts` |
| `src/libs/layouts.ts` | `src/shared/layouts.ts` |
| `src/utils/remapper.ts` | `src/shared/remapper.ts` |
| `src/libs/soundpacks/` (entire dir) | `src/shared/soundpacks/` |
| `src/utils/ipc.ts` | `src/main-only/ipc.ts` |
| `src/utils/store_toggle.ts` | `src/main-only/store-toggle.ts` |
| `src/utils/startup_handler.ts` | `src/main-only/startup-handler.ts` |
| `src/libs/electron-log/transports/remote.ts` | `src/main-only/electron-log/remote-transport.ts` |

**Delete emptied directories:** `src/utils/`, `src/libs/`

**Import updates — main process:**
- `src/main/index.ts`: all `'./utils/*.js'` → `'../main-only/*.js'`, all `'./libs/*.js'` → `'../shared/*.js'`

**Import updates — renderer (if not done in Phase 2):**
- `src/renderer/app/index.ts`: `'./libs/soundpacks/*.js'` → `'../../shared/soundpacks/*.js'`
- `src/renderer/editor/index.ts`: `'./utils/remapper.js'` → `'../../shared/remapper.js'`, `'./libs/layouts.js'` → `'../../shared/layouts.js'`, `'./libs/keycodes.js'` → `'../../shared/keycodes.js'`

**Import updates — shared internals:**
- `src/shared/keycodes.ts`: `'../utils/remapper.js'` → `'./remapper.js'`
- `src/shared/soundpacks/*.ts`: verify intra-folder imports (most should be relative and unaffected)

**Verify:** `bun run build && bun run dev` — full functionality test.

---

### Phase 4 — Move audio/ out of src/ (1 commit)

**Move:** `src/audio/` → `audio/` (project root)

**Update paths:**
- `src/renderer/app/index.ts` — `OFFICIAL_PACKS_DIR`:
  ```typescript
  // was: path.join(__dirname, '../../../src/audio')
  // now: path.join(__dirname, '../../../audio')
  // (dist/renderer/app/index.js → 3 levels up to project root)
  ```
- `tsconfig.json` exclude: `"src/audio/**"` → `"audio/**"`

**Add `extraResources` to `package.json` build config** (audio files shouldn't live inside asar):
```json
"build": {
  "extraResources": [
    { "from": "audio", "to": "audio" }
  ]
}
```

> **Production path note:** `extraResources` places `audio/` at `resources/audio/` (next to the asar), not inside it. The `OFFICIAL_PACKS_DIR` path resolves relative to `__dirname` inside the asar, so in production it needs to go up from `resources/app.asar/dist/renderer/app/` to `resources/audio/`. This means the production path is `path.join(__dirname, '../../../../audio')` — but dev path is `path.join(__dirname, '../../../audio')`. We need a helper that detects `app.isPackaged`:
> ```typescript
> const OFFICIAL_PACKS_DIR = app.isPackaged
>   ? path.join(process.resourcesPath, 'audio')
>   : path.join(__dirname, '../../../audio');
> ```
> Currently the code doesn't handle this; it works in dev because the relative path happens to resolve. This is a separate bug to fix, but since `extraResources` changes the production layout, we should fix the path now.

**Also add `src/**/*.html` and `src/assets/**/*` to `extraResources`** — these are currently loaded from the source tree by `loadFile()`, not from `dist/`. Alternatively, refactor to copy HTML/assets into dist during build. For now, documenting the dependency:
```json
"extraResources": [
  { "from": "audio", "to": "audio" },
  { "from": "src/renderer", "to": "src/renderer", "filter": ["**/*.html", "**/*.css"] },
  { "from": "src/assets", "to": "src/assets" }
]
```

**Verify:** `bun run build && bun run dev` — audio still loads. `bun run build:win` — verify `audio/` is in the installer output.

---

### Phase 5 — Done: hotkey extracted

`services/hotkey.ts` — `parseHotkey()`, `matchesHotkey()`, `KEY_NAME_TO_CODES`, `ParsedHotkey` type extracted. Pure functions, no shared state.

---

### Phase 6 — Extract remaining subsystems via AppState pattern

`main/index.ts` is 852 lines with 6 module-level mutable variables (`win`, `tray`, `installer`, `debugWindow`, `editor_window`, `isQuiting`) and 3 StoreToggle instances (`mute`, `start_minimized`, `active_volume`) read/written from deeply nested closures — IPC handlers, keyboard hooks, tray menu callbacks, window event handlers. These create circular dependencies that block extraction.

**Strategy:** Introduce a single `AppState` object. All subsystems receive it as a dependency. This breaks circular coupling — subsystems don't reference each other, they reference shared state.

#### Module-level mutable state (dependency map)

| Variable | Type | Written by | Read by |
|----------|------|-----------|---------|
| `win` | `BrowserWindow \| null` | `createWindow()`, win close/closed | volume polling, key forwarding, debug, tray, IPC, activate, close |
| `tray` | `Tray \| null` | `createTrayIcon()`, show_tray_icon IPC | `toggleMute()`, `buildContextMenu()` |
| `installer` | `BrowserWindow \| null` | `openInstallWindow()`, installed IPC | protocol handler, installed/resize IPC |
| `debugWindow` | `BrowserWindow \| null` | `createDebugWindow()`, closed | `debug.enable()`, fetch-debug-options IPC |
| `editor_window` | `BrowserWindow \| null` | `openEditorWindow()`, closed | tray menu |
| `isQuiting` | `boolean` | quit menu item, `OnBeforeQuit` | win close handler |

#### Key coupling points

- **`toggleMute()`** — reads/writes `muteState`, `mute`, `win`, `tray`, `watchdogTimers`, `pressedKeys`
- **`buildContextMenu()`** — reads `muteState`, `startup_handler`, `start_minimized`, `active_volume`, `win`; calls `toggleMute()`, `openEditorWindow()`
- **`createTrayIcon()`** — reads `muteState`, `win`, `tray`; calls `buildContextMenu()`
- **Volume polling** — reads `muteState`, `win`; calls `OnBeforeQuit()`, `app.exit(1)`

#### Phase 6a — Introduce AppState (1 commit)

Create `src/main/app-state.ts`:

```typescript
import { BrowserWindow, Tray } from 'electron';
import StoreToggle from '../main-only/store-toggle.js';

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
}
```

In `main/index.ts`: replace all module-level `let win`, `let tray`, etc. with `const state: AppState = { ... }`. All closures reference `state.win`, `state.tray`, etc. instead. This is a search-and-replace refactor — no behavioral changes.

**Why this works:** JS closures capture the `state` object reference, not the value. When `createWindow()` sets `state.win = newWin`, the volume polling closure reading `state.win` immediately sees the new value. Same semantics as current module-level variables.

**Verify:** `bun run build` compiles. `bun run dev` — full manual test.

#### Phase 6b — Extract windows (1 commit per window, 4 commits)

Each window function takes `AppState` as parameter instead of referencing module-level vars.

| File | Signature | State dependencies |
|------|-----------|-------------------|
| `windows/editor-window.ts` | `openEditorWindow(state: AppState): void` | Sets `state.editorWindow`. Cleanest extraction — no other state coupling. |
| `windows/install-window.ts` | `openInstallWindow(packId: string, state: AppState): void` | Sets `state.installer`. Reads `state.win` for parent. |
| `windows/debug-window.ts` | `createDebugWindow(state: AppState, debug, debugConfigFile, log): void` | Sets `state.debugWindow`. Reads `state.win` for parent. Houses `DebugState`. |
| `windows/app-window.ts` | `createAppWindow(show: boolean, state: AppState, debug): BrowserWindow` | Sets `state.win`. Reads `state.isQuiting`, `state.activeVolume`, `state.mute` for did-finish-load. |

**Verify after each:** `bun run build && bun run dev` — test the extracted window.

#### Phase 6c — Extract volume polling (1 commit)

`services/volume.ts` — `startVolumePolling(state: AppState, log, onFatalError: () => void): ReturnType<typeof setInterval>`

- Receives `state` to read `state.win`, `state.muteState`
- Returns interval ID so caller can clear on quit
- Fatal mute error handled via `onFatalError` callback instead of directly calling `OnBeforeQuit()` / `app.exit(1)`
- `VolumeError` class moves here

**Verify:** `bun run build && bun run dev` — volume indicator updates in UI.

#### Phase 6d — Extract tray (1 commit)

`services/tray.ts` — `createTrayIcon(state: AppState, callbacks: TrayCallbacks): void`

`buildContextMenu()` calls `openEditorWindow()` and `toggleMute()`, so these are injected as callbacks:

```typescript
export interface TrayCallbacks {
  toggleMute: () => void;
  openEditorWindow: () => void;
}
```

In `main/index.ts`, the orchestrator passes concrete implementations:
```typescript
createTrayIcon(state, {
  toggleMute,
  openEditorWindow: () => openEditorWindow(state),
});
```

**Verify:** `bun run build && bun run dev` — tray icon, context menu, mute toggle all work.

#### Phase 6e — Final orchestrator cleanup (1 commit)

After all extractions, `main/index.ts` becomes a slim orchestrator (~250 lines):
1. Creates `AppState`
2. Initializes logging, debug, store toggles
3. Sets up `app.whenReady()` which creates windows, starts volume polling, creates tray
4. Wires up `toggleMute()`, `openEditorWindow()`, `OnBeforeQuit()`
5. Registers IPC handlers (or extract to `ipc-handlers.ts`)

**Verify:** Full manual test of all features.

#### Target structure

```
src/main/
├── index.ts                 # orchestrator (~250 lines)
├── app-state.ts             # shared mutable state interface
├── services/
│   ├── hotkey.ts            # ✅ already extracted
│   ├── volume.ts            # pollVolume, pollMute, VolumeError
│   └── tray.ts              # createTrayIcon, buildContextMenu
├── windows/
│   ├── app-window.ts        # createAppWindow
│   ├── editor-window.ts     # openEditorWindow
│   ├── install-window.ts    # openInstallWindow
│   └── debug-window.ts      # createDebugWindow + DebugState
```

#### Risk analysis

| Risk | Mitigation |
|------|-------------|
| Closures capturing stale references | AppState is an object — closures capture the reference, property mutations are visible to all readers. Same semantics as module-level vars. |
| `this` binding in `DebugState.enable()/disable()` | Already use `debug.` not `this.` — convert to standalone functions with explicit `debug` param |
| `toggleMute` needs both state and tray | Stays in orchestrator as wiring point between keyboard hooks, tray icon, and window messages |
| Window close handlers set `state.win = null` | Same pattern as current `win = null` — works fine |

---

## Critical Files

| File | Why It Matters |
|------|---------------|
| `src/main.ts` | All window creation, preload paths, IPC handlers, tray/volume/hotkey logic |
| `src/app.ts` | OFFICIAL_PACKS_DIR path, soundpack imports, `__dirname` usage |
| `src/editor.ts` | libs/keycodes, libs/layouts, utils/remapper imports, CUSTOM_PACKS_DIR path |
| `src/editor.html` | Dead `style.css` ref, `<script>` tag (remove), jquery.js ref |
| `tsconfig.json` | rootDir/outDir, audio exclusion |
| `package.json` | `"main"` field, build config (extraResources to add) |

---

## Verification Checklist

1. `bun run build` — tsgo compiles cleanly, no import errors
2. `bun run dev` — app launches, main window loads soundpacks, plays audio on keypress
3. Open editor window — loads with node APIs, no `fs/path/electron` runtime errors
4. Install a soundpack via install window — verify it appears in main window dropdown
5. Debug window opens and toggles remote debugging
6. System tray icon shows, context menu works, mute toggle works
7. `bun run build:win` — electron-builder packages; verify `audio/` folder is in the installer output (`resources/audio/`)

---

## Future Work (Out of Scope)

- **React + Tailwind migration** — Replace jQuery/vanilla renderer code with React components + Tailwind CSS. The restructured layout (co-located renderer folders) makes this migration straightforward since each window is isolated. This should be a separate plan after the restructure lands.
- **MediaPlayer migration** — Replace Howler.js with a more modern audio API.
- **Context isolation / preload bridge** — Currently `contextIsolation: false` + `nodeIntegration: true` on all windows. Long-term, move to `contextIsolation: true` with a contextBridge preload for security.