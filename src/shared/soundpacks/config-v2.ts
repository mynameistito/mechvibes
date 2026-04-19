import { Howl } from 'howler';
import { keycodesRemap, keycodesFill } from '../keycodes.js';
import { GetSoundpackFile } from './file-manager.js';
import { SoundpackError } from './soundpack-config.js';
import { Result } from 'better-result';
import type { ISoundpackConfig, SoundpackMeta, KeyEvent } from './soundpack-config.js';

interface V2Config {
  name: string;
  key_define_type: 'single' | 'multi';
  sound: string;
  soundup: string;
  defines: Record<string, string>;
  version?: number;
}

type MultiAudio = Record<string, Howl>;

export class SoundpackConfigV2 implements ISoundpackConfig {
  readonly name: string;
  readonly key_define_type: 'single' | 'multi';
  readonly sound: string;
  readonly soundup: string;
  defines: Record<string, string>;
  readonly pack_id: string;
  readonly group: string;
  readonly abs_path: string;
  readonly is_archive: boolean;
  readonly is_custom: boolean;
  readonly config_version = 2;
  readonly version = 2;
  audio?: MultiAudio;

  constructor(config: V2Config, meta: SoundpackMeta) {
    this.name = config.name;
    this.key_define_type = config.key_define_type;
    this.sound = config.sound;
    this.soundup = config.soundup;
    this.defines = config.defines;
    this.pack_id = meta.pack_id;
    this.group = meta.group;
    this.abs_path = meta.abs_path;
    this.is_archive = meta.is_archive;
    this.is_custom = meta.is_custom;

    for (const key of Object.keys(this) as (keyof this)[]) {
      if (key === 'audio') continue;
      if (this[key] === null || this[key] === undefined) {
        throw new Error(`SoundpackConfigV2: Missing required property: ${String(key)}`);
      }
    }

    const resolveSound = (sound: string): string => {
      if (!sound.includes('{')) return sound;
      const rangeMatch = sound.match(/\{(-?\d+)-(-?\d+)\}/);
      if (!rangeMatch) return sound;
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return sound;
      const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];
      const n = Math.floor(Math.random() * (high - low + 1) + low);
      return sound.replace(rangeMatch[0], String(n));
    };

    for (const kc of Object.keys(keycodesFill(this.defines))) {
      const upKey = `${kc}-up`;
      this.defines[kc] = resolveSound(this.defines[kc] || this.sound);
      this.defines[upKey] = resolveSound(this.defines[upKey] || this.soundup);
    }
  }

  LoadSounds(): Promise<Result<void, SoundpackError>> {
    return new Promise((resolve) => {
      const cleanup = () => {
        if (this.audio) {
          for (const kc of Object.keys(this.audio as MultiAudio)) {
            (this.audio as MultiAudio)[kc].unload();
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

      if (this.key_define_type === 'single' || this.key_define_type === 'multi') {
        const sound_data: Record<string, { src: string[] }> = {};
        for (const kc of Object.keys(this.defines)) {
          if (this.defines[kc]) {
            const fileResult = GetSoundpackFile(this.abs_path, this.defines[kc]);
            if (Result.isOk(fileResult)) {
              sound_data[kc] = { src: [fileResult.value] };
            }
          }
        }
        this.audio = {} as MultiAudio;
        const remapped = keycodesRemap(sound_data) as Record<string, { src: string[] }>;
        const keys = Object.keys(remapped);
        if (keys.length === 0) {
          clearTimeout(timeout);
          fail('No sounds could be loaded');
          return;
        }
        const promises = keys.map((kc) => {
          const audio = new Howl(remapped[kc]);
          (this.audio as MultiAudio)[kc] = audio;
          return waitForLoad(audio);
        });
        Promise.all(promises).then(() => {
          clearTimeout(timeout);
          resolve(Result.ok(undefined));
        }).catch((e: unknown) => { clearTimeout(timeout); fail(String(e)); });
      } else {
        clearTimeout(timeout);
        fail('Invalid key_define_type');
      }
    });
  }

  HandleEvent(event: KeyEvent): void {
    const keycode = event.type === 'keyup' ? `${event.keycode}-up` : `${event.keycode}`;
    const sound_id = `keycode-${keycode}`;
    const sound = (this.audio as MultiAudio)?.[sound_id];
    if (!sound) return;
    (sound as Howl).play();
  }

  UnloadSounds(): void {
    if (!this.audio) return;
    for (const kc of Object.keys(this.audio as MultiAudio)) {
      (this.audio as MultiAudio)[kc].unload();
    }
    delete this.audio;
  }
}

export default SoundpackConfigV2;
