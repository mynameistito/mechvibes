import fs from 'fs';
import path from 'path';
import { ipcRenderer } from 'electron';

const BASE_URL = 'https://www.mechvibes.com/sound-packs';

let CUSTOM_PACKS_DIR = '';
const getGlobalsPromise = ipcRenderer.invoke('get-globals').then((globals: { custom_dir: string }) => {
  CUSTOM_PACKS_DIR = globals.custom_dir;
}).catch(console.error);

const errorTranslation: Record<number, string> = {
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

function resizeWindow(): void {
  setTimeout(() => {
    ipcRenderer.send('resize-installer', document.scrollingElement!.scrollHeight);
  }, 5);
}

ipcRenderer.on('install-pack', (_event, packId: string) => {
  const logo = document.getElementById('logo')!;
  const packageNameSection = document.getElementById('package-section')!;
  const packageNameHolder = document.getElementById('package-name')!;
  const askPrompt = document.getElementById('ask')!;

  let installation: InstallManifest;
  const PACK_URL = `${BASE_URL}/${packId}/dist`;

  fetch(`${PACK_URL}/install.json`).then((response) => {
    if (response.ok) {
      response.json().then((data: InstallManifest) => {
        installation = data;
        logo.innerText = 'Sound Pack';
        packageNameHolder.innerText = data.name;
        packageNameSection.style.display = 'block';
        askPrompt.style.display = 'block';
        resizeWindow();
      }).catch(() => {
        logo.innerText = 'Error (PARSE)';
      });
    } else {
      logo.innerText = errorTranslation[response.status]
        ? `Error (${errorTranslation[response.status]})`
        : 'Error (UNKNOWN)';
    }
  });

  const yesBtn = document.getElementById('answer-yes')!;
  const noBtn = document.getElementById('answer-no')!;

  yesBtn.onclick = async () => {
    await getGlobalsPromise;

    const progStatus = document.getElementById('status-text')!;
    const progSection = document.getElementById('prog')!;
    const progBar = document.getElementById('prog-bar')!;
    askPrompt.style.display = 'none';

    const INSTALL_DIR = path.resolve(CUSTOM_PACKS_DIR, installation.folder);
    if (!INSTALL_DIR.startsWith(path.resolve(CUSTOM_PACKS_DIR) + path.sep)) {
      logo.innerText = 'Error (TRAVERSAL)';
      return;
    }
    if (!fs.existsSync(INSTALL_DIR)) {
      fs.mkdirSync(INSTALL_DIR);
    }

    setTimeout(async () => {
      progSection.style.display = 'block';
      resizeWindow();
      let error: { status: number; file: string } | null = null;

      for (let i = 0; i < installation.files.length; i++) {
        const file = installation.files[i];
        try {
          progStatus.innerText = `Downloading ${file}...`;
          const request = await fetch(`${PACK_URL}/${file}`);
          if (!request.ok) {
            error = { status: request.status, file };
            break;
          }
          const blob = await request.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const destPath = path.resolve(INSTALL_DIR, file);
          if (!destPath.startsWith(path.resolve(INSTALL_DIR) + path.sep)) {
            error = { status: 0, file };
            break;
          }
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, buffer);
          progBar.style.width = `${((i + 1) / installation.files.length) * 100}%`;
        } catch {
          error = { status: 0, file };
          break;
        }
      }

      if (error !== null) {
        progStatus.innerText = errorTranslation[error.status]
          ? `Failed to download ${error.file} (${errorTranslation[error.status]})`
          : `Failed to download ${error.file} (UNKNOWN)`;
      } else {
        progStatus.innerText = 'Installing...';
        ipcRenderer.send('installed', installation.folder);
      }
    }, 50);
  };

  noBtn.onclick = () => { window.close(); };
});

ipcRenderer.on('resize-done', () => {});
