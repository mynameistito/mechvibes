import type { App } from 'electron';
import { TaggedError, Result } from 'better-result';

export class StartupError extends TaggedError('startup_handler')<{ message: string }>() {}

export class StartupHandler {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  get is_enabled(): boolean {
    return this.app.getLoginItemSettings().openAtLogin;
  }

  get was_started_at_login(): boolean {
    if (process.platform === 'darwin') {
      return this.app.getLoginItemSettings().wasOpenedAtLogin ?? false;
    }
    return process.argv.includes('--startup');
  }

  enable(): Result<void, StartupError> {
    return Result.try({
      try: () => {
        this.app.setLoginItemSettings({ openAtLogin: true, args: ['--startup'] });
      },
      catch: (e) => new StartupError({ message: String(e) }),
    });
  }

  disable(): Result<void, StartupError> {
    return Result.try({
      try: () => {
        this.app.setLoginItemSettings({ openAtLogin: false });
      },
      catch: (e) => new StartupError({ message: String(e) }),
    });
  }

  toggle(): Result<void, StartupError> {
    return this.is_enabled ? this.disable() : this.enable();
  }
}

export default StartupHandler;
