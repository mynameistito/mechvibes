import { ipcRenderer } from 'electron';
import { useState, useEffect } from 'react';

interface DialogConfig {
  message: string;
  buttons: string[];
}

export function Dialog() {
  const [config, setConfig] = useState<DialogConfig | null>(null);

  useEffect(() => {
    ipcRenderer.on('dialog-config', (_event, cfg: DialogConfig) => {
      setConfig(cfg);
    });
  }, []);

  if (!config) return null;

  return (
    <div className="flex flex-col gap-4 p-6 h-full select-none">
      <p className="flex-1 m-0 text-[13px] leading-relaxed text-[#333] dark:text-[#e0e0e0]">
        {config.message}
      </p>
      <div className="flex gap-2 flex-wrap justify-end shrink-0">
        {config.buttons.map((label, index) => (
          <button
            key={index}
            onClick={() => ipcRenderer.send('dialog-result', index)}
            className={
              index === 0
                ? 'px-3.5 h-8 rounded text-[11px] font-extrabold tracking-wide uppercase cursor-pointer border border-transparent bg-[#ff5050] text-white hover:opacity-85 active:opacity-70 transition-opacity'
                : 'px-3.5 h-8 rounded text-[11px] font-extrabold tracking-wide uppercase cursor-pointer border border-[#e6e6e6] bg-white text-[#333] dark:bg-[#242424] dark:border-[#444] dark:text-[#ccc] hover:opacity-85 active:opacity-70 transition-opacity'
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
