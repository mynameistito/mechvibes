import { getVolume, getMute } from 'easy-volume';
import { TaggedError, Result } from 'better-result';
import type { AppState } from '../app-state.js';

export class VolumeError extends TaggedError('volume')<{ message: string; source: 'get' | 'mute' }>() {}

export interface VolumeCallbacks {
  onFatalError: () => void;
}

export function startVolumePolling(
  state: AppState,
  log: { error: (msg: string) => void },
  callbacks: VolumeCallbacks,
): ReturnType<typeof setInterval> {
  let volumeLevel = -1;
  let system_mute = false;
  let system_volume_error = false;

  const pollVolume = async (): Promise<Result<void, VolumeError>> => {
    return Result.tryPromise({
      try: async () => {
        const v = await getVolume();
        if (v !== volumeLevel) {
          volumeLevel = v;
          if (state.win && !state.win.isDestroyed()) {
            state.win.webContents.send('system-volume-update', volumeLevel);
          }
        }
      },
      catch: (e) => new VolumeError({ message: e instanceof Error ? e.message : String(e), source: 'get' }),
    });
  };

  const pollMute = async (): Promise<Result<void, VolumeError>> => {
    return Result.tryPromise({
      try: async () => {
        const m = await getMute();
        if (m !== system_mute) {
          system_mute = m;
          if (state.win && !state.win.isDestroyed()) {
            state.win.webContents.send('system-mute-status', system_mute);
          }
        }
      },
      catch: (e) => new VolumeError({ message: e instanceof Error ? e.message : String(e), source: 'mute' }),
    });
  };

  const sysCheckInterval = setInterval(async () => {
    if (!state.muteState) {
      const volResult = await pollVolume();
      if (!Result.isOk(volResult)) {
        clearInterval(sysCheckInterval);
        const err = volResult.error.message;
        if (err === '' && !system_volume_error) {
          system_volume_error = true;
        }
        log.error(`Volume Error: ${err}`);
        return;
      }

      const muteResult = await pollMute();
      if (!Result.isOk(muteResult)) {
        clearInterval(sysCheckInterval);
        const err = muteResult.error.message;
        if (err === '' && !system_volume_error) {
          system_volume_error = true;
          callbacks.onFatalError();
        }
        log.error(`Mute Error: ${err}`);
      }
    }
  }, 3000);

  return sysCheckInterval;
}