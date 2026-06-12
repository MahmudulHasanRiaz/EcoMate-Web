import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';

async function bootstrap() {
  if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
    throw new Error(
      'JWT_SECRET and JWT_REFRESH_SECRET environment variables are required',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    maxAge: '1y',
    immutable: true,
  } as any);
  app.useStaticAssets(join(process.cwd(), 'public'), {
    prefix: '/assets/',
    maxAge: '1y',
    immutable: true,
  } as any);
  app.use(cookieParser());

  app.enableCors({
    origin: process.env['CORS_ORIGIN']
      ? process.env['CORS_ORIGIN'].split(',').map((o) => o.trim())
      : [
          'http://localhost:5173',
          'http://localhost:3000',
          'https://mac.riaz.com.bd',
        ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.setGlobalPrefix('api', { exclude: ['/'] });

  const port = process.env['PORT'] || 4000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
}
bootstrap();
