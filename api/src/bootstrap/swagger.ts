import {
  API_DOCS_PATH,
  API_KEY_HEADER,
  API_KEY_PREFIX,
  REFRESH_TOKEN_COOKIE,
} from '@coretask/contracts';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { SESSION_ONLY_EXTENSION } from '../common/decorators/session-only.decorator';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/**
 * Swagger UI only sends the credentials of a scheme an operation lists, so an
 * API key pasted into the Authorize dialog is dropped unless `api-key` is on
 * the operation. Controllers declare `bearer`; this adds `api-key` beside it
 * everywhere except the routes `@SessionOnly()` marked, which the guard would
 * refuse a key on anyway — and says so in their description.
 */
function offerApiKeyWhereAccepted(document: OpenAPIObject): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.security?.some((requirement) => 'bearer' in requirement)) continue;

      const extensions = operation as unknown as Record<string, unknown>;
      if (extensions[SESSION_ONLY_EXTENSION] === true) {
        operation.description = [
          operation.description,
          'Signed-in users only: a workspace API key is refused with 403 `API_KEY_NOT_ALLOWED`.',
        ]
          .filter(Boolean)
          .join('\n\n');
        continue;
      }

      // A class-level `@ApiBearerAuth()` hands every method the same array, so
      // replace rather than push, or one controller's routes stack duplicates.
      if (!operation.security.some((requirement) => 'api-key' in requirement)) {
        operation.security = [...operation.security, { 'api-key': [] }];
      }
    }
  }
}

export function setupSwagger(app: INestApplication, apiUrl: string): void {
  const config = new DocumentBuilder()
    .setTitle('CoreTask API')
    .setDescription(
      [
        'REST API for the CoreTask project-management and ticketing platform.',
        '',
        '**Response envelope** — every endpoint answers with',
        '`{ success: true, data, meta }` or `{ success: false, error: { code, message, details } }`.',
        'Branch on `error.code`, never on the message text.',
        '',
        '**Authentication** — send the short-lived access token as `Authorization: Bearer <token>`.',
        `The rotating refresh token is delivered as the HTTP-only \`${REFRESH_TOKEN_COOKIE}\` cookie`,
        'and is only accepted by the `/auth` routes.',
        '',
        `**Integrations** — a workspace API key goes in \`${API_KEY_HEADER}\` (or as a Bearer token; it starts with \`${API_KEY_PREFIX}\`).`,
        'It acts as a service account in one workspace and cannot manage people, keys or sessions.',
        'Call `GET /integration/whoami` first to learn the workspace id.',
      ].join('\n'),
    )
    .setVersion('1.0')
    // Origin only. The document is generated after `setGlobalPrefix`, so every
    // path already starts with `/api/v1`; including it here as well would make
    // "Try it out" request `/api/v1/api/v1/...`.
    .addServer(apiUrl, 'Current environment')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token' },
      'bearer',
    )
    .addCookieAuth(REFRESH_TOKEN_COOKIE, { type: 'apiKey', in: 'cookie' }, REFRESH_TOKEN_COOKIE)
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Workspace API key' },
      'api-key',
    )
    .addTag('Health', 'Liveness and dependency checks')
    .addTag('Integrations', 'API keys and the tools that use them')
    .addTag('Authentication', 'Registration, login, token rotation')
    .addTag('Workspaces', 'Tenant containers and membership')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  offerApiKeyWhereAccepted(document);

  SwaggerModule.setup(API_DOCS_PATH.replace(/^\//, ''), app, document, {
    customSiteTitle: 'CoreTask API reference',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' },
  });
}
