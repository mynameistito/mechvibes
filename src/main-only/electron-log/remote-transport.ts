import { app } from 'electron';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { TaggedError } from 'better-result';

export class NetworkError extends TaggedError('network')<{ message: string; url?: string }>() {}

interface TransportClient { name: string; identifier?: string }
interface LogMessage { date: Date; level: string; data: unknown[]; variables: Record<string, string> }
interface ElectronLog {
  transports: Record<string, unknown>;
  variables: Record<string, string>;
  processMessage(msg: { data: unknown[]; level: string; [key: string]: unknown }, opts?: { transports?: Record<string, unknown> }): void;
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

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30000;

function serializeData(data: unknown[], maxDepth: number): unknown[] {
  function limitDepth(value: unknown, depth: number): unknown {
    if (depth <= 0) return '[Object]';
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(v => limitDepth(v, depth - 1));
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as object)) {
      result[key] = limitDepth((value as Record<string, unknown>)[key], depth - 1);
    }
    return result;
  }
  try {
    return JSON.parse(JSON.stringify(data.map(v => limitDepth(v, maxDepth))));
  } catch {
    return data.map(v => String(v));
  }
}

export function remoteTransportFactory(electronLog: ElectronLog, defaultUrl: string): RemoteTransport {
  function transportFn(message: LogMessage): void {
    const t = transportFn as RemoteTransport;
    if (!t.url) return;

    const data = serializeData(message.data, t.depth + 1);

    const body = t.transformBody({
      client: t.client,
      data,
      date: message.date.getTime(),
      level: message.level,
      variables: message.variables,
    });

    try {
      electronLog.variables.sender = 'log.remote › sending › ' + message.variables.sender;
      electronLog.processMessage(
        { data, level: 'info' },
        { transports: { file: (electronLog.transports as Record<string, unknown>)['file'] } },
      );
    } finally {
      electronLog.variables.sender = 'main';
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(t.url);
    } catch {
      handleError(new Error(`Invalid URL: ${t.url}`));
      return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      handleError(new Error(`Unsupported protocol: ${parsedUrl.protocol}`));
      return;
    }

    const request = post(t.url, t.requestOptions, Buffer.from(body, 'utf8'));

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Request timed out'));
    });

    request.on('response', (response: http.IncomingMessage) => {
      let responseBytes = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        responseBytes += Buffer.byteLength(chunk, 'utf8');
        if (responseBytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error(`Response exceeded ${MAX_RESPONSE_BYTES} bytes`));
        }
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          try {
            electronLog.variables.sender = 'log.remote';
            electronLog.processMessage(
              { data: [`received HTTP response code ${response.statusCode} from ${t.url}`], level: 'warn' },
              {
                transports: {
                  console: (electronLog.transports as Record<string, unknown>)['console'],
                  ipc: (electronLog.transports as Record<string, unknown>)['ipc'],
                  file: (electronLog.transports as Record<string, unknown>)['file'],
                },
              },
            );
          } finally {
            electronLog.variables.sender = 'main';
          }
        }
      });
    });

    request.on('error', t.onError || ((error: Error) => {
      try {
        electronLog.variables.sender = 'log.remote';
        electronLog.processMessage(
          { data: [`cannot send HTTP request to ${t.url}`, error], level: 'warn' },
          {
            transports: {
              console: (electronLog.transports as Record<string, unknown>)['console'],
              ipc: (electronLog.transports as Record<string, unknown>)['ipc'],
              file: (electronLog.transports as Record<string, unknown>)['file'],
            },
          },
        );
      } finally {
        electronLog.variables.sender = 'main';
      }
    }));

    function handleError(error: Error): void {
      if (t.onError) {
        t.onError(error);
      } else {
        try {
          electronLog.variables.sender = 'log.remote';
          electronLog.processMessage(
            { data: [`cannot send HTTP request to ${t.url}`, error], level: 'warn' },
            {
              transports: {
                console: (electronLog.transports as Record<string, unknown>)['console'],
                ipc: (electronLog.transports as Record<string, unknown>)['ipc'],
                file: (electronLog.transports as Record<string, unknown>)['file'],
              },
            },
          );
        } finally {
          electronLog.variables.sender = 'main';
        }
      }
    }
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
