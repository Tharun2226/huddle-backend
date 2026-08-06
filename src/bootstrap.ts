import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { ClientSafeExceptionFilter } from './common/client-safe-exception.filter';
import { uploadsRoot } from './common/uploads-path';

/**
 * Shared Nest bootstrap for local `main.ts` and the Vercel serverless handler.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Quieter cold starts on serverless.
    logger: process.env.VERCEL ? ['error', 'warn', 'log'] : undefined,
  });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ClientSafeExceptionFilter());

  // Local /tmp-friendly uploads (Vercel filesystem is ephemeral).
  const root = uploadsRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  app.useStaticAssets(root, { prefix: '/uploads/' });

  // Swagger is opt-in — building the OpenAPI doc slows cold starts on Vercel.
  if (process.env.ENABLE_SWAGGER === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Huddle API')
      .setDescription('NestJS + Prisma API for the Huddle mobile app')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  return app;
}
