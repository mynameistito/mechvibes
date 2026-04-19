import { Howl } from 'howler';
import { keycodesRemap } from '../keycodes.js';
import { GetSoundpackFile } from './file-manager.js';
import { SoundpackError } from './soundpack-config.js';
import { Result } from 'better-result';
import type { ISoundpackConfig, SoundpackMeta, KeyEvent } from './soundpack-config.js';

interface V1Config {
  name: string;
  key_define_type: 'single' | 'multi';
  includes_numpad: boolean;
  sound: string;
  defines: Record<string, unknown>;
  version?: number;
}

type SingleAudio = Howl;
type MultiAudio = Record<string, Howl>;

export class SoundpackConfigV1 implements ISoundpackConfig {
  readonly name: string;
  readonly key_define_type: 'single' | 'multi';
  readonly includes_numpad: boolean;
  readonly sound: string;
  readonly defines: Record<string, unknown>;
  readonly pack_id: string;
  readonly group: string;
  readonly abs_path: string;
  readonly is_archive: boolean;
  readonly is_custom: boolean;
  readonly config_version = 1;
  readonly version = 1;
  audio?: SingleAudio | MultiAudio;

  constructor(config: V1Config, meta: SoundpackMeta) {
    this.name = config.name;
    this.key_define_type = config.key_define_type;
    this.includes_numpad = config.includes_numpad;
    this.sound = config.sound;
    this.defines = config.defines;
    this.pack_id = meta.pack_id;
    this.group = meta.group;
    this.abs_path = meta.abs_path;
    this.is_archive = meta.is_archive;
    this.is_custom = meta.is_custom;

    for (const key of Object.keys(this) as (keyof this)[]) {
      if (this[key] === null || this[key] === undefined) {
        throw new Error(`SoundpackConfigV1: Missing required property: ${String(key)}`);
      }
    }
  }

  LoadSounds(): Promise<Result<void, SoundpackError>> {
    return new Promise((resolve) => {
      const cleanup = () => {
        if (this.key_define_type === 'single') {
          (this.audio as SingleAudio | undefined)?.unload();
        } else if (this.key_define_type === 'multi') {
          if (this.audio) {
            for (const kc of Object.keys(this.audio as MultiAudio)) {
              (this.audio as MultiAudio)[kc].unload();
            }
          }
        }
        delete this.audio;
      };

      const fail = (msg: string) => {
        cleanup();
        resolve(Result.err(new SoundpackError({ message: msg })));
      };

      const timeout = setTimeout(() => fail('The soundpack took too long to load.'), 3000);

      const waitForLoad = (audio: Howl): Promise<void> => new Promise((res, rej) => {
        if (audio.state() === 'loaded') { res(); return; }
        audio.once('load', () => res());
        audio.once('loaderror', (_, e) => rej(e));
      });

      if (this.key_define_type === 'single') {
        const fileResult = GetSoundpackFile(this.abs_path, this.sound);
        if (!Result.isOk(fileResult)) {
          clearTimeout(timeout);
          resolve(Result.err(new SoundpackError({ message: fileResult.error.message })));
          return;
        }
        const audio = new Howl({ src: [fileResult.value], sprite: keycodesRemap(this.defines) as Record<string, [number, number]> });
        waitForLoad(audio).then(() => {
          clearTimeout(timeout);
          this.audio = audio;
          resolve(Result.ok(undefined));
        }).catch((e: unknown) => { clearTimeout(timeout); fail(String(e)); });

      } else if (this.key_define_type === 'multi') {
        const sound_data: Record<string, { src: string[] }> = {};
        for (const kc of Object.keys(this.defines)) {
          if (this.defines[kc]) {
            const fileResult = GetSoundpackFile(this.abs_path, this.defines[kc] as string);
            if (Result.isOk(fileResult)) {
              sound_data[kc] = { src: [fileResult.value] };
            }
          }
        }
        this.audio = {} as MultiAudio;
        const remapped = keycodesRemap(sound_data) as Record<string, { src: string[] }>;
        for (const kc of Object.keys(remapped)) {
          const audio = new Howl(remapped[kc]);
          waitForLoad(audio).then(() => {
            clearTimeout(timeout);
            (this.audio as MultiAudio)[kc] = audio;
            resolve(Result.ok(undefined));
          }).catch((e: unknown) => { clearTimeout(timeout); fail(String(e)); });
        }
      } else {
        clearTimeout(timeout);
        fail('Invalid key_define_type');
      }
    });
  }

  HandleEvent(event: KeyEvent): void {
    if (event.type === 'keyup') return;
    const sound_id = `keycode-${event.keycode}`;
    const play_type = this.key_define_type || 'single';
    const sound = play_type === 'single'
      ? (this.audio as SingleAudio)
      : (this.audio as MultiAudio)?.[sound_id];
    if (!sound) return;
    if (play_type === 'single') {
      (sound as SingleAudio).play(sound_id);
    } else {
      (sound as Howl).play();
    }
  }

  UnloadSounds(): void {
    if (!this.audio) return;
    if (this.key_define_type === 'single') {
      (this.audio as SingleAudio).unload();
    } else {
      for (const kc of Object.keys(this.audio as MultiAudio)) {
        (this.audio as MultiAudio)[kc].unload();
      }
    }
    delete this.audio;
  }
}

export default SoundpackConfigV1;
