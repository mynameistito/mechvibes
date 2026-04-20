import * as path from 'path';
import log from 'electron-log';

const LogTransportMap: Record<string, string> = {
  error: 'red', warn: 'yellow', info: 'cyan', debug: 'magenta', silly: 'green', default: 'unset',
};

export function initializeDebugAndLogging(): void {
  log.transports.file.fileName = 'mechvibes.log';
  log.transports.file.level = 'info';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (log.transports.file as any).resolvePathFn = (variables: { libraryDefaultDir: string; fileName: string }) => {
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

}
