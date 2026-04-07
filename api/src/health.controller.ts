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

    const dbOk = await this.prisma.$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    const redis = await this.redis.ping();
    const redisOk = redis === 'PONG';
    const overallStatus = dbOk ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: now,
      checks: {
        database: dbOk ? 'ok' : 'degraded',
        redis: redisOk ? 'ok' : 'degraded',
      },
    };
  }
}
