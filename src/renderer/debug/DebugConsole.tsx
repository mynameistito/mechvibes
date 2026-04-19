import { useState, useEffect } from 'react';

interface DebugOptions {
  enabled: boolean;
  identifier: string | undefined;
  level?: string | false;
}

interface DebugAPI {
  onDebugOptions: (cb: (opts: DebugOptions) => void) => void;
  onDebugUpdate: (cb: (opts: DebugOptions) => void) => () => void;
  setDebugOptions: (opts: DebugOptions) => void;
}

const api = () => window.electronAPI as DebugAPI;

export function DebugConsole() {
  const [debug, setDebug] = useState<DebugOptions | null>(null);

  useEffect(() => {
    api().onDebugOptions(setDebug);
    const cleanup = api().onDebugUpdate(setDebug);
    return cleanup;
  }, []);

  function toggleEnabled() {
    if (!debug) return;
    const next = { ...debug, enabled: !debug.enabled };
    if (!next.enabled) next.identifier = undefined;
    setDebug(next);
    api().setDebugOptions(next);
  }

  return (
    <div className="p-8 text-[13px] font-sans text-[#333] dark:text-[#e0e0e0]">
      <div className="mb-4 text-xl font-bold">Mechvibes</div>

      <div className="flex items-center justify-between py-3 border-b border-[#e6e6e6] dark:border-[#444]">
        <div>
          <div>Enable Remote Debugging</div>
          <div className="text-[0.8em] opacity-70 leading-tight mt-0.5">
            Please do not enable this feature unless you've been asked to.
          </div>
        </div>
        <input
          type="checkbox"
          className="w-4 h-4 cursor-pointer"
          checked={debug?.enabled ?? false}
          onChange={toggleEnabled}
        />
      </div>

      {debug?.enabled && (
        <div className="mt-4">
          <div className="mb-1 font-medium">Debug Code</div>
          <input
            type="text"
            readOnly
            value={debug.identifier ?? ''}
            placeholder="You don't have a debug code yet."
            className="w-full px-2 py-1.5 border border-[#e6e6e6] dark:border-[#444] rounded bg-[#f5f5f5] dark:bg-[#2a2a2a] text-[13px] font-mono"
          />
          <div className="text-[0.8em] opacity-70 leading-tight mt-1">
            Give this code to a developer upon request for live assistance.
          </div>
        </div>
      )}
    </div>
  );
}
