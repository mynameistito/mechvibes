import Store from 'electron-store';
import { TaggedError, Result } from 'better-result';

export class StoreError extends TaggedError('store_toggle')<{ message: string }>() {}

const store = new Store();

export class StoreToggle {
  private readonly key: string;
  private readonly default: boolean;

  constructor(key: string, defaultVal: boolean) {
    this.key = key;
    this.default = defaultVal;
  }

  get is_enabled(): boolean {
    if (!store.has(this.key)) return this.default;
    const value = store.get(this.key);
    return typeof value === 'boolean' ? value : this.default;
  }

  enable(): Result<void, StoreError> {
    return Result.try({
      try: () => { store.set(this.key, true); },
      catch: (e) => new StoreError({ message: String(e) }),
    });
  }

  disable(): Result<void, StoreError> {
    return Result.try({
      try: () => { store.set(this.key, false); },
      catch: (e) => new StoreError({ message: String(e) }),
    });
  }

  toggle(): Result<void, StoreError> {
    return this.is_enabled ? this.disable() : this.enable();
  }
}

export default StoreToggle;
