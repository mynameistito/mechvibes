import type { Result } from 'better-result';
import { TaggedError } from 'better-result';

export class SoundpackError extends TaggedError('soundpack')<{ message: string }>() {}

export interface SoundpackMeta {
  pack_id: string;
  group: string;
  abs_path: string;
  folder_name?: string;
  is_custom: boolean;
  is_archive: boolean;
}

export interface KeyEvent {
  type: 'keydown' | 'keyup';
  keycode: number;
}

export interface ISoundpackConfig {
  readonly name: string;
  readonly pack_id: string;
  readonly group: string;
  readonly abs_path: string;
  readonly is_custom: boolean;
  readonly is_archive: boolean;
  readonly version: number;
  readonly config_version: number;
  audio?: unknown;
  LoadSounds(): Promise<Result<void, SoundpackError>>;
  HandleEvent(event: KeyEvent): void;
  UnloadSounds(): void;
}
