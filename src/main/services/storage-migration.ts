import { dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import fs from 'fs-extra';
import log from 'electron-log';
import { showDialogWindow } from '../windows/dialog-window.js';

export async function checkAndMigrateStorage(options: {
  shouldCheck: boolean;
  markAsked: () => void;
  homeDir: string;
  customDir: string;
  win: BrowserWindow | null;
}): Promise<void> {
  if (!options.shouldCheck) return;

  const old_custom_dir = path.join(options.homeDir, '/mechvibes_custom');
  if (!fs.existsSync(old_custom_dir)) return;

  log.debug('Old custom directory exists, prompting user for migration...');
  const response = await showDialogWindow(options.win, {
    message: "Soundpacks have moved to a new location. Do you want to migrate your old soundpacks to the new location? We'll only ask you this once.",
    buttons: ['Yes', 'Not right now', "Don't ask again"],
    cancelId: 1,
  });

  if (response === 0) {
    log.debug('User requested migration, migrating...');
    const oldCustomFiles = fs.readdirSync(old_custom_dir);
    const failedFiles: string[] = [];
    oldCustomFiles.forEach((file) => {
      const sourcePath = path.join(old_custom_dir, file);
      const destinationPath = path.join(options.customDir, file);
      log.silly(`Moving ${sourcePath.replace(options.homeDir, '~')} to ${destinationPath.replace(options.homeDir, '~')}`);
      try {
        fs.moveSync(sourcePath, destinationPath, { overwrite: true });
      } catch (e) {
        log.error(`Failed to move ${file}: ${String(e)}`);
        failedFiles.push(file);
      }
    });
    if (failedFiles.length > 0) {
      dialog.showErrorBox('Migration failed', `The following files could not be moved:\n${failedFiles.join('\n')}`);
    } else {
      log.silly('Removing old custom directory...');
      fs.removeSync(old_custom_dir);
      log.debug('Migration complete.');
      options.win?.reload();
    }
  } else if (response === 2) {
    options.markAsked();
  }
}
