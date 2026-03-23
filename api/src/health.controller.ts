import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async getHealth() {
    const now = new Date().toISOString();

    const db = await this.prisma.$queryRaw`SELECT 1`;
    const redis = await this.redis.ping();

    return {
      status: 'ok',
      timestamp: now,
      checks: {
        database: Array.isArray(db) ? 'ok' : 'ok',
        redis: redis === 'PONG' ? 'ok' : 'degraded',
      },
    };
  }
}
