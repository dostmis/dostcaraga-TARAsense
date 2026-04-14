import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(process.env.API_PREFIX || 'api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((item: string) => item.trim()),
    credentials: true,
  });

  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`TARAsense API running on http://localhost:${port}`);
}

bootstrap();
