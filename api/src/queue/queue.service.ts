import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NotificationJobDto } from './dto/notification-job.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('system-jobs') private readonly systemQueue: Queue,
    private readonly redisService: RedisService,
  ) {}

  async enqueueSystemJob(dto: NotificationJobDto) {
    const job = await this.systemQueue.add(dto.type, dto.payload || {}, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1500,
      },
      removeOnComplete: true,
      removeOnFail: 50,
    });

    // Keep a lightweight cache key for quick status checks.
    await this.redisService.set(`jobs:${job.id}`, { state: 'queued', type: dto.type }, 900);

    return {
      id: job.id,
      name: job.name,
      queue: 'system-jobs',
    };
  }

  async getJob(jobId: string) {
    const job = await this.systemQueue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      state,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
    };
  }
}
