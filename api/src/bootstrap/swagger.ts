import { API_DOCS_PATH, REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
    .addTag('Health', 'Liveness and dependency checks')
    .addTag('Authentication', 'Registration, login, token rotation')
    .addTag('Workspaces', 'Tenant containers and membership')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(API_DOCS_PATH.replace(/^\//, ''), app, document, {
    customSiteTitle: 'CoreTask API reference',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' },
  });
}
