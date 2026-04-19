import { ipcRenderer } from 'electron';

interface DialogConfig {
  message: string;
  buttons: string[];
}

ipcRenderer.on('dialog-config', (_event, config: DialogConfig) => {
  const messageEl = document.getElementById('dialog-message')!;
  const buttonsEl = document.getElementById('dialog-buttons')!;

  messageEl.textContent = config.message;

  config.buttons.forEach((label, index) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = index === 0 ? 'btn btn-primary' : 'btn btn-secondary';
    btn.addEventListener('click', () => {
      ipcRenderer.send('dialog-result', index);
    });
    buttonsEl.appendChild(btn);
  });
});
