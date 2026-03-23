import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: Number(this.configService.get<string>('REDIS_PORT') || 6379),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(this.configService.get<string>('REDIS_DB') || 0),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  getClient() {
    return this.client;
  }

  async ping() {
    return this.client.ping();
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, payload);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
