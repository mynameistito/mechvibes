import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import Zip from 'adm-zip';
import { TaggedError, Result } from 'better-result';

export class FileError extends TaggedError('file_manager')<{ message: string; path?: string }>() {}

// howlerjs needs these mime types corrected
(mime.types as Record<string, string>)['mp4'] = 'audio/mp4';
(mime.types as Record<string, string>)['wav'] = 'audio/wav';

export type ArchiveFiles = Record<string, string>;

function isArchivePath(folder: string): boolean {
  return path.extname(folder) === '.zip';
}

export function GetFilesFromArchive(folder: string): Result<ArchiveFiles, FileError> {
  return Result.try({
    try: () => {
      const zip = new Zip(folder);
      const files: ArchiveFiles = {};
      for (const file of zip.getEntries()) {
        if (file.isDirectory) continue;
        const fileName = path.basename(file.entryName).toLowerCase();
        if (fileName === 'config.json') {
          files[fileName] = file.getData().toString('utf8');
        } else {
          const mimeType = mime.lookup(fileName) || 'application/octet-stream';
          files[fileName] = `data:${mimeType};base64,${file.getData().toString('base64')}`;
        }
      }
      return files;
    },
    catch: (e) => new FileError({ message: String(e), path: folder }),
  });
}

export function GetFileFromArchive(folder: string, search: string): Result<string, FileError> {
  return Result.try({
    try: () => {
      const zip = new Zip(folder);
      for (const file of zip.getEntries()) {
        if (file.isDirectory) continue;
        const fileName = path.basename(file.entryName).toLowerCase();
        if (fileName === search) {
          if (fileName === 'config.json') {
            return file.getData().toString('utf8');
          }
          const mimeType = mime.lookup(fileName) || 'application/octet-stream';
          return `data:${mimeType};base64,${file.getData().toString('base64')}`;
        }
      }
      throw new Error(`File not found in archive: ${search}`);
    },
    catch: (e) => new FileError({ message: String(e), path: folder }),
  });
}

export function GetFileFromFolder(folder: string, file: string): Result<string, FileError> {
  return Result.try({
    try: () => {
      const filePath = path.join(folder, file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';
      return `data:${mimeType};base64,${fs.readFileSync(filePath, 'base64')}`;
    },
    catch: (e) => new FileError({ message: String(e), path: folder }),
  });
}

export function GetSoundpackFile(abs_path: string, sound: string): Result<string, FileError> {
  return isArchivePath(abs_path)
    ? GetFileFromArchive(abs_path, sound)
    : GetFileFromFolder(abs_path, sound);
}
