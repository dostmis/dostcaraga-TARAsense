import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { RedisService } from '../redis/redis.service';

@Injectable()
@Processor('system-jobs')
export class QueueProcessor extends WorkerHost {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(private readonly redisService: RedisService) {
    super();
  }

  async process(job: Job<Record<string, unknown>, unknown, string>) {
    await this.redisService.set(`jobs:${job.id}`, { state: 'processing', type: job.name }, 900);

    // Placeholder worker: add actual business flows here (emails, analytics jobs, etc.).
    await new Promise((resolve) => setTimeout(resolve, 150));

    return {
      processed: true,
      job: job.name,
      at: new Date().toISOString(),
    };
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<Record<string, unknown>, unknown, string>) {
    await this.redisService.set(`jobs:${job.id}`, { state: 'completed', type: job.name }, 900);
    this.logger.log(`Job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<Record<string, unknown>, unknown, string> | undefined, error: Error) {
    if (job) {
      await this.redisService.set(
        `jobs:${job.id}`,
        { state: 'failed', type: job.name, reason: error.message },
        900,
      );
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      return;
    }

    this.logger.error(`Queue worker failure before job binding: ${error.message}`);
  }
}
