import { app } from 'electron';
import { TaggedError, Result } from 'better-result';

export class IpcError extends TaggedError('ipc')<{ message: string; src: string }>() {}

let remoteUrl: string | undefined;

function buildHeaders(): Record<string, string> {
  return {
    'User-Agent': `Mechvibes/${app.getVersion()} (Electron/${process.versions.electron})`,
    'Content-Type': 'application/json',
  };
}

export async function setRemoteUrl(url: string): Promise<void> {
  remoteUrl = url;
}

export async function identify(info: object): Promise<Result<{ success: boolean; identifier?: string }, IpcError>> {
  if (remoteUrl === undefined) {
    return Result.err(new IpcError({ message: 'Remote URL not set', src: 'ipc-identify' }));
  }
  return Result.tryPromise({
    try: async () => {
      const res = await fetch(remoteUrl!, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ method: 'AUTH', body: { type: 'identify', userInfo: info } }),
      });
      return res.json() as Promise<{ success: boolean; identifier?: string }>;
    },
    catch: (e) => new IpcError({ message: String(e), src: 'ipc-identify' }),
  });
}

export async function validate(
  identifier: string,
  info: object,
): Promise<Result<{ success: boolean }, IpcError>> {
  if (remoteUrl === undefined) {
    return Result.err(new IpcError({ message: 'Remote URL not set', src: 'ipc-validate' }));
  }
  return Result.tryPromise({
    try: async () => {
      const res = await fetch(remoteUrl!, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ method: 'AUTH', body: { type: 'validate', data: identifier, userInfo: info } }),
      });
      return res.json() as Promise<{ success: boolean }>;
    },
    catch: (e) => new IpcError({ message: String(e), src: 'ipc-validate' }),
  });
}
