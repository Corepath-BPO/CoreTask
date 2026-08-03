import { API_PREFIX } from '@coretask/contracts';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../common/middleware/request-id.middleware';
import { AppConfigService } from '../config/app-config.service';

import { setupSwagger } from './swagger';

/**
 * Builds the fully configured HTTP application.
 *
 * Shared by `main.ts` and the e2e suite so tests exercise the same middleware,
 * pipes, filters and interceptors as production rather than a reduced stand-in.
 */
export async function createApp(): Promise<INestApplication> {
  // Imported lazily so `load-env` has already populated process.env.
  const { AppModule } = await import('../app.module');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // The filter below owns error rendering.
    abortOnError: false,
  });

  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  // The version lives in the prefix (`/api/v1`); Nest's URI versioning would
  // add a second segment on top of it.
  app.setGlobalPrefix(API_PREFIX);

  // First in the chain so every later log line and error carries the id.
  app.use(requestIdMiddleware);

  app.use(
    helmet({
      // Swagger UI needs inline styles/scripts; the API itself serves no HTML.
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // Behind nginx/ALB, `req.ip` and secure-cookie detection need the proxy hop.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Constraint text is safe to return; it is authored in our DTOs.
      disableErrorMessages: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(config.isProduction));

  setupSwagger(app, config.http.apiUrl);

  // Lets Nest run onModuleDestroy hooks (Prisma disconnect, Redis quit) on
  // SIGTERM so a rolling deploy drains cleanly.
  app.enableShutdownHooks();

  return app;
}
