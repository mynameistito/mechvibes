# Plan: Extract Subsystems from main/index.ts

## Problem

`main/index.ts` is 852 lines with 6 module-level mutable variables (`win`, `tray`, `installer`, `debugWindow`, `editor_window`, `isQuiting`) and 3 StoreToggle instances (`mute`, `start_minimized`, `active_volume`) that are read/written from deeply nested closures — IPC handlers, keyboard hooks, tray menu callbacks, window event handlers. These create circular dependencies that make extraction impossible without first introducing a shared state container.

## Dependency Map

### Module-level mutable state

| Variable | Type | Written by | Read by |
|----------|------|-----------|---------|
| `win` | `BrowserWindow \| null` | `createWindow()`, win close/closed handlers | volume polling, key forwarding, debug, tray, IPC, activate, close handler |
| `tray` | `Tray \| null` | `createTrayIcon()`, show_tray_icon IPC | `toggleMute()`, `buildContextMenu()` |
| `installer` | `BrowserWindow \| null` | `openInstallWindow()`, installed IPC, resize IPC | protocol handler, installed IPC |
| `debugWindow` | `BrowserWindow \| null` | `createDebugWindow()`, closed handler | debug.enable(), fetch-debug-options IPC |
| `editor_window` | `BrowserWindow \| null` | `openEditorWindow()`, closed handler | tray menu |
| `isQuiting` | `boolean` | quit menu item, `OnBeforeQuit` | win close handler |

### StoreToggle state (reads + writes via `.is_enabled`, `.enable()`, `.disable()`, `.toggle()`)

| Instance | Read by | Written by |
|----------|---------|-----------|
| `mute` | `createWindow()` did-finish-load, `toggleMute()` | `toggleMute()` → `.enable()/.disable()` |
| `start_minimized` | `app.ready` | tray Extras menu |
| `active_volume` | `createWindow()` did-finish-load, tray Extras menu | tray Extras menu → `.toggle()` |

### Key coupling points

- **`toggleMute()`** reads/writes `muteState`, `mute`, `win`, `tray`, `watchdogTimers`, `pressedKeys` — the single most stateful function
- **`buildContextMenu()`** reads `muteState`, `startup_handler`, `start_minimized`, `active_volume`, `win`, calls `toggleMute()`, `openEditorWindow()`
- **`createTrayIcon()`** reads `muteState`, `win`, `tray`, calls `buildContextMenu()`
- **Volume polling** reads `muteState`, `win`, calls `OnBeforeQuit()`, `app.exit(1)`

## Strategy: Introduce an AppState object

Create a single mutable state container that all subsystems receive as a dependency. This breaks the circular coupling — subsystems don't reference each other, they reference the shared state.

```
src/main/
├── index.ts                 # orchestrator: creates AppState, wires everything
├── app-state.ts             # shared mutable state object
├── services/
│   ├── hotkey.ts            # ✅ already extracted (pure functions)
│   ├── volume.ts            # pollVolume, pollMute, interval
│   └── tray.ts              # createTrayIcon, buildContextMenu
├── windows/
│   ├── app-window.ts        # createWindow
│   ├── editor-window.ts     # openEditorWindow
│   ├── install-window.ts    # openInstallWindow
│   └── debug-window.ts      # createDebugWindow + DebugState
```

## Implementation Phases

### Phase 6a — Introduce AppState (1 commit)

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

In `main/index.ts`:
- Create `const state: AppState = { win: null, tray: null, ... }`
- Replace all module-level `let win`, `let tray`, etc. with `state.win`, `state.tray`, etc.
- This is a search-and-replace refactor — no behavioral changes
- All closures that currently capture `win` directly will now reference `state.win`

**Why this works:** JavaScript closures capture the `state` object reference, not the value. So when `createWindow()` sets `state.win = newWin`, the volume polling closure reading `state.win` immediately sees the new value. Same semantics as the current module-level variables.

**Verify:** `bun run build` compiles. `bun run dev` — full manual test of all features.

### Phase 6b — Extract windows (1 commit per window, 4 commits)

Each window function takes `AppState` as a parameter instead of referencing module-level vars.

**`windows/app-window.ts`** — `createAppWindow(show: boolean, state: AppState): BrowserWindow`
- Sets `state.win` internally
- Reads `state.debug`, `state.activeVolume`, `state.mute` for did-finish-load
- Reads `state.isQuiting` for close handler
- Returns the created window

**`windows/editor-window.ts`** — `openEditorWindow(state: AppState): void`
- Sets `state.editorWindow` internally
- No other state coupling — cleanest extraction

**`windows/install-window.ts`** — `openInstallWindow(packId: string, state: AppState): void`
- Sets `state.installer` internally
- Reads `state.win` for parent window

**`windows/debug-window.ts`** — `createDebugWindow(state: AppState, debug, debugConfigFile): void`
- Sets `state.debugWindow` internally
- Reads `state.win` for parent window
- Also houses the `DebugState` object and its `enable()`/`disable()` methods

**Verify after each:** `bun run build` compiles. `bun run dev` — test the extracted window.

### Phase 6c — Extract volume polling (1 commit)

**`services/volume.ts`** — `startVolumePolling(state: AppState): ReturnType<typeof setInterval>`
- Receives `state` to read `state.win`, `state.muteState`
- Returns the interval ID so the caller can clear it on quit
- The `VolumeError` class moves here too
- The `OnBeforeQuit` / `app.exit(1)` on fatal mute error is replaced by a callback: `onFatalError: () => void`

```typescript
export function startVolumePolling(
  state: AppState,
  log: Logger,
  onFatalError: () => void
): ReturnType<typeof setInterval>
```

**Verify:** `bun run build && bun run dev` — volume indicator updates in UI.

### Phase 6d — Extract tray (1 commit)

**`services/tray.ts`** — `createTrayIcon(state: AppState, callbacks: TrayCallbacks): void`

Because `buildContextMenu()` calls `openEditorWindow()` and `toggleMute()`, these need to be injected as callbacks:

```typescript
export interface TrayCallbacks {
  toggleMute: () => void;
  openEditorWindow: () => void;
}

export function createTrayIcon(state: AppState, callbacks: TrayCallbacks): void
export function buildContextMenu(state: AppState, callbacks: TrayCallbacks): Electron.Menu
```

In `main/index.ts`, the orchestrator passes concrete implementations:
```typescript
createTrayIcon(state, {
  toggleMute,
  openEditorWindow: () => openEditorWindow(state),
});
```

**Verify:** `bun run build && bun run dev` — tray icon, context menu, mute toggle all work.

### Phase 6e — Final orchestrator cleanup (1 commit)

After all extractions, `main/index.ts` becomes a slim orchestrator:
1. Creates `AppState`
2. Initializes logging, debug, store toggles
3. Sets up `app.whenReady()` which:
   - Creates windows via `createAppWindow()`, `openEditorWindow()`, etc.
   - Starts volume polling via `startVolumePolling()`
   - Creates tray via `createTrayIcon()`
   - Registers all IPC handlers (or these could be extracted to `ipc-handlers.ts`)
4. Wires up `toggleMute()`, `openEditorWindow()`, `OnBeforeQuit()`

Expected line count reduction: ~852 → ~250 lines.

**Verify:** Full manual test of all features.

## Verification (after each phase)

1. `bun run build` — compiles cleanly
2. `bun run dev` — app launches, soundpacks load, audio plays
3. Editor window opens and works (has node APIs)
4. Install window works
5. Debug window opens
6. System tray: icon, context menu, mute toggle
7. Volume polling: indicator updates, fatal error exits
8. Hotkey: mute hotkey toggles, custom hotkey saved

## Risk Analysis

| Risk | Mitigation |
|------|-------------|
| Closures capturing stale references after state extraction | AppState is an object — closures capture the reference, property mutations are visible to all readers. Same semantics as module-level vars. |
| `this` binding in `DebugState.enable()/disable()` | These already use `debug.` not `this.`, but migration to `createDebugWindow(state)` will convert to standalone functions with explicit `debug` param |
| `toggleMute` needs both `state` and `tray` module | After Phase 6d, `toggleMute` stays in orchestrator since it's the wiring point between keyboard hooks, tray icon, and window messages |
| Window close handlers reference `state.win = null` | Works fine — same as current `win = null` pattern |