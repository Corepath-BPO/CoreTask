import { randomUUID } from 'node:crypto';

import { API_DOCS_PATH, REQUEST_ID_HEADER } from '@coretask/contracts';
import type { Params } from 'nestjs-pino';

import type { AppConfigService } from './app-config.service';

/** Never appears in a log line, in any environment. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'res.headers["set-cookie"]',
];

export function buildLoggerOptions(config: AppConfigService): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      // Pretty output locally; newline-delimited JSON everywhere else so log
      // shippers can parse it without a custom grok pattern.
      transport: config.isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname,req.headers,res.headers',
            },
          },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      genReqId: (req, res) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id = typeof incoming === 'string' && incoming.trim() !== '' ? incoming : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customProps: (req) => ({ requestId: req.id }),
      autoLogging: {
        // Health checks and docs assets would otherwise dominate the log volume.
        ignore: (req) => {
          const url = req.url ?? '';
          return url.startsWith(API_DOCS_PATH) || url.endsWith('/health');
        },
      },
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
