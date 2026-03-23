import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { QueueService } from './queue.service';
import { NotificationJobDto } from './dto/notification-job.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MSME, Role.FIC)
  async enqueue(@Body() dto: NotificationJobDto) {
    return this.queueService.enqueueSystemJob(dto);
  }

  @Get(':jobId')
  @Roles(Role.ADMIN, Role.MSME, Role.FIC)
  async getJob(@Param('jobId') jobId: string) {
    const job = await this.queueService.getJob(jobId);
    return { job };
  }
}
