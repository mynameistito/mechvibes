import { app } from 'electron';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { createRequire } from 'module';
import { TaggedError } from 'better-result';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const transform = _require('electron-log/src/transform') as any;

export class NetworkError extends TaggedError('network')<{ message: string; url?: string }>() {}

interface TransportClient { name: string; identifier?: string }
interface LogMessage { date: Date; level: string; data: unknown[]; variables: Record<string, string> }
interface ElectronLog {
  transports: Record<string, unknown>;
  variables: Record<string, string>;
  logMessageWithTransports(msg: { data: unknown[]; level: string }, transports: unknown[]): void;
}

export interface RemoteTransport {
  (message: LogMessage): void;
  client: TransportClient;
  depth: number;
  level: string | false;
  requestOptions: Record<string, unknown>;
  url: string | undefined;
  onError: ((e: Error) => void) | null;
  transformBody: (body: unknown) => string;
  clear: () => never;
}

export function remoteTransportFactory(electronLog: ElectronLog, defaultUrl: string): RemoteTransport {
  function transportFn(message: LogMessage): void {
    const t = transportFn as RemoteTransport;
    if (!t.url) return;

    const data = transform.transform(message, [
      transform.removeStyles,
      transform.toJSON,
      transform.maxDepthFactory(t.depth + 1),
    ]);

    const body = t.transformBody({
      client: t.client,
      data,
      date: message.date.getTime(),
      level: message.level,
      variables: message.variables,
    });

    electronLog.variables.sender = 'log.remote › sending › ' + message.variables.sender;
    electronLog.logMessageWithTransports(
      { data, level: 'info' },
      [(electronLog.transports as Record<string, unknown>)['file']],
    );
    electronLog.variables.sender = 'main';

    const request = post(t.url, t.requestOptions, Buffer.from(body, 'utf8'));

    request.on('response', (response: http.IncomingMessage) => {
      let responseData = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { responseData += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          electronLog.variables.sender = 'log.remote';
          electronLog.logMessageWithTransports(
            { data: [`received HTTP response code ${response.statusCode} from ${t.url}`], level: 'warn' },
            [
              (electronLog.transports as Record<string, unknown>)['console'],
              (electronLog.transports as Record<string, unknown>)['ipc'],
              (electronLog.transports as Record<string, unknown>)['file'],
            ],
          );
          electronLog.variables.sender = 'main';
        }
      });
    });

    request.on('error', t.onError || ((error: Error) => {
      electronLog.variables.sender = 'log.remote';
      electronLog.logMessageWithTransports(
        { data: [`cannot send HTTP request to ${t.url}`, error], level: 'warn' },
        [
          (electronLog.transports as Record<string, unknown>)['console'],
          (electronLog.transports as Record<string, unknown>)['ipc'],
          (electronLog.transports as Record<string, unknown>)['file'],
        ],
      );
      electronLog.variables.sender = 'main';
    }));
  }

  const transport = transportFn as RemoteTransport;
  transport.client = { name: 'Mechvibes' };
  transport.depth = 6;
  transport.level = false;
  transport.requestOptions = {
    method: 'LOG',
    headers: {
      'User-Agent': `Mechvibes/${app.getVersion()} (Electron/${process.versions.electron})`,
    },
  };
  transport.url = defaultUrl;
  transport.onError = null;
  transport.transformBody = (body: unknown) => JSON.stringify(body);
  transport.clear = () => { throw new Error('Not implemented'); };

  return transport;
}

function post(
  serverUrl: string,
  requestOptions: Record<string, unknown>,
  body: Buffer,
): http.ClientRequest {
  const urlObject = new URL(serverUrl);
  const httpTransport = urlObject.protocol === 'https:' ? https : http;

  const options: http.RequestOptions = {
    hostname: urlObject.hostname,
    port: urlObject.port || undefined,
    path: urlObject.pathname + urlObject.search,
    method: 'POST',
    headers: {},
    ...requestOptions,
  };

  (options.headers as Record<string, unknown>)['Content-Length'] = body.length;
  if (!(options.headers as Record<string, string>)['Content-Type']) {
    (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  const request = httpTransport.request(options);
  request.write(body);
  request.end();
  return request;
}

export default remoteTransportFactory;
