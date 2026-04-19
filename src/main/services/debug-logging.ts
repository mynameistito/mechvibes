import { app } from 'electron';
import * as os from 'os';
import * as path from 'path';
import fs from 'fs-extra';
import log from 'electron-log';
import { Result } from 'better-result';
import * as IpcServer from '../../main-only/ipc.js';
import remoteTransportFactory from '../../main-only/electron-log/remote-transport.js';
import type { AppState } from '../app-state.js';
import type { DebugState } from '../windows/debug-state.js';

const LogTransportMap: Record<string, string> = {
  error: 'red', warn: 'yellow', info: 'cyan', debug: 'magenta', silly: 'green', default: 'unset',
};

export interface DebugSetup {
  debug: DebugState;
  debugConfigFile: string;
}

export function initializeDebugAndLogging(
  state: AppState,
  user_dir: string,
): DebugSetup {
  const debugConfigFile = path.join(user_dir, '/remote-debug.json');

  const debug: DebugState = {
    enabled: false,
    identifier: undefined,
    remoteUrl: 'https://beta.mechvibes.com/debug/ipc/',
    async enable() {
      this.enabled = true;
      const userInfo = {
        hostname: os.hostname(),
        username: os.userInfo().username,
        platform: os.platform(),
        version: app.getVersion(),
      };

      if (this.identifier === undefined) {
        const identifyResult = await IpcServer.identify(userInfo);
        if (Result.isOk(identifyResult) && identifyResult.value.success) {
          const json = identifyResult.value;
          this.identifier = json.identifier;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fs.writeJsonSync(debugConfigFile, { enabled: true, identifier: json.identifier });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (log.transports as any).remote.client.identifier = this.identifier;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (log.transports as any).remote.level = 'silly';
          const options = {
            enabled: debug.enabled,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            level: (log.transports as any).remote.level,
            identifier: debug.identifier,
          };
          if (state.debugWindow !== null) {
            state.debugWindow.webContents.send('debug-update', options);
          }
        } else {
          this.enabled = false;
          console.log(identifyResult);
        }
      } else {
        console.log('enabling early');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (log.transports as any).remote.client.identifier = this.identifier;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (log.transports as any).remote.level = 'silly';
        const validateResult = await IpcServer.validate(this.identifier, userInfo);
        if (!Result.isOk(validateResult) || !validateResult.value.success) {
          console.log('Failed validation');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (log.transports as any).remote.level = false;
          this.enabled = false;
          this.identifier = undefined;
          fs.unlinkSync(debugConfigFile);
        }
      }
      if (state.win !== null) {
        state.win.webContents.send('debug-in-use', true);
      }
    },
    disable() {
      this.enabled = false;
      this.identifier = undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log.transports as any).remote.level = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (log.transports as any).remote.client.identifier = undefined;
      fs.unlinkSync(debugConfigFile);
      if (state.win !== null) {
        state.win.webContents.send('debug-in-use', false);
      }
    },
  };

  void IpcServer.setRemoteUrl(debug.remoteUrl);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log.transports as any).remote = remoteTransportFactory(log, debug.remoteUrl);

  for (const transportName in log.transports) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (log.transports as any)[transportName].transportName = transportName;
  }

  if (fs.existsSync(debugConfigFile)) {
    const json = JSON.parse(fs.readFileSync(debugConfigFile, 'utf8')) as { identifier?: string; enabled?: boolean };
    console.log(json);
    if (json.identifier) {
      debug.identifier = json.identifier;
      if (json.enabled) {
        debug.enable();
        console.log('enabled?');
      }
    } else {
      fs.unlinkSync(debugConfigFile);
    }
  }

  log.transports.file.fileName = 'mechvibes.log';
  log.transports.file.level = 'info';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log.transports.file as any).resolvePath = (variables: { libraryDefaultDir: string; fileName: string }) => {
    return path.join(variables.libraryDefaultDir, variables.fileName);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log as any).variables.sender = 'main';
  log.transports.console.format = '%c{h}:{i}:{s}.{ms}%c {sender} \u203a {text}';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log.transports as any).file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]({sender}) {text}';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log.hooks.push((msg, transport: any) => {
    if ((transport as { transportName?: string })?.transportName === 'console') {
      return {
        ...msg,
        data: [`color: ${LogTransportMap[msg.level] ?? 'unset'}`, 'color: unset', ...msg.data],
      };
    }
    return msg;
  });

  return { debug, debugConfigFile };
}