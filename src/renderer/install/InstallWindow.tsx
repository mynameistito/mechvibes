import { ipcRenderer } from 'electron';
import fs from 'fs';
import path from 'path';
import { useState, useEffect } from 'react';

const BASE_URL = 'https://www.mechvibes.com/sound-packs';

const errorCode: Record<number, string> = {
  400: 'INVREQ', 401: 'UNAUTH', 402: 'PAYMENT', 403: 'FORBID',
  404: 'NOTFOUND', 405: 'BADMETH', 418: 'TEAPOT', 429: 'TOOFAST',
  451: 'DMCA', 500: 'SERVERR', 502: 'SERVBAD', 503: 'SERVUNAV',
  504: 'SERVSLOW', 521: 'SERVOFF', 522: 'SERVSLOW', 523: 'SERVOFF',
  524: 'SERVSLOW', 525: 'SERVSSL', 526: 'SERVSSL',
};

interface InstallManifest {
  name: string;
  folder: string;
  files: string[];
}

type Phase =
  | { type: 'idle' }
  | { type: 'confirm'; packName: string; manifest: InstallManifest; packUrl: string }
  | { type: 'progress'; statusText: string; progress: number }
  | { type: 'error'; message: string };

export function InstallWindow() {
  const [phase, setPhase] = useState<Phase>({ type: 'idle' });
  const [customDir, setCustomDir] = useState('');

  useEffect(() => {
    ipcRenderer.invoke('get-globals').then((g: { custom_dir: string }) => {
      setCustomDir(g.custom_dir);
    }).catch(console.error);

    ipcRenderer.on('install-pack', (_event, packId: string) => {
      const packUrl = `${BASE_URL}/${packId}/dist`;
      fetch(`${packUrl}/install.json`)
        .then(r => {
          if (!r.ok) {
            setPhase({ type: 'error', message: `Error (${errorCode[r.status] ?? 'UNKNOWN'})` });
            return;
          }
          r.json().then((manifest: InstallManifest) => {
            setPhase({ type: 'confirm', packName: manifest.name, manifest, packUrl });
            ipcRenderer.send('resize-installer', document.scrollingElement!.scrollHeight);
          });
        })
        .catch(() => setPhase({ type: 'error', message: 'Error (PARSE)' }));
    });

    ipcRenderer.on('resize-done', () => {});
  }, []);

  async function install(manifest: InstallManifest, packUrl: string) {
    const installDir = path.resolve(customDir, manifest.folder);
    if (!installDir.startsWith(path.resolve(customDir) + path.sep)) {
      setPhase({ type: 'error', message: 'Error (TRAVERSAL)' });
      return;
    }
    if (!fs.existsSync(installDir)) fs.mkdirSync(installDir);

    setPhase({ type: 'progress', statusText: 'Starting...', progress: 0 });
    ipcRenderer.send('resize-installer', document.scrollingElement!.scrollHeight);

    for (let i = 0; i < manifest.files.length; i++) {
      const file = manifest.files[i];
      setPhase({ type: 'progress', statusText: `Downloading ${file}...`, progress: (i / manifest.files.length) * 100 });
      try {
        const req = await fetch(`${packUrl}/${file}`);
        if (!req.ok) {
          setPhase({ type: 'error', message: `Failed: ${file} (${errorCode[req.status] ?? 'UNKNOWN'})` });
          return;
        }
        const buf = Buffer.from(await (await req.blob()).arrayBuffer());
        const dest = path.resolve(installDir, file);
        if (!dest.startsWith(path.resolve(installDir) + path.sep)) {
          setPhase({ type: 'error', message: 'Error (TRAVERSAL)' });
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      } catch {
        setPhase({ type: 'error', message: `Failed: ${file} (NETWORK)` });
        return;
      }
    }

    setPhase({ type: 'progress', statusText: 'Installing...', progress: 100 });
    ipcRenderer.send('installed', manifest.folder);
  }

  return (
    <div className="p-8 text-[13px] font-sans text-[#333] dark:text-[#e0e0e0] overflow-hidden">
      <div className="text-[1.5em] font-bold mb-6">
        {phase.type === 'idle' ? 'Loading...' : 'Sound Pack'}
      </div>

      {phase.type === 'confirm' && (
        <>
          <p className="text-center text-[1.5em] mb-4">{phase.packName}</p>
          <button
            onClick={() => install(phase.manifest, phase.packUrl)}
            className="w-full flex items-center justify-center h-9 mb-2 rounded border border-[#e6e6e6] bg-white dark:bg-[#242424] dark:border-[#444] cursor-pointer hover:opacity-85 transition-opacity"
          >
            Install
          </button>
          <button
            onClick={() => window.close()}
            className="w-full flex items-center justify-center h-9 rounded border border-[#e6e6e6] bg-white dark:bg-[#242424] dark:border-[#444] cursor-pointer hover:opacity-85 transition-opacity"
          >
            Cancel
          </button>
        </>
      )}

      {phase.type === 'progress' && (
        <div>
          <small className="text-[0.9em] opacity-70">{phase.statusText}</small>
          <div className="mt-2 w-full h-2 bg-[#e6e6e6] dark:bg-[#444] rounded overflow-hidden">
            <div
              className="h-full bg-[#ff5050] transition-all duration-200"
              style={{ width: `${phase.progress}%` }}
            />
          </div>
        </div>
      )}

      {phase.type === 'error' && (
        <p className="text-[#ff5050] text-center">{phase.message}</p>
      )}
    </div>
  );
}
