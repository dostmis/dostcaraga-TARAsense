import { Controller, DefaultValuePipe, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('logs')
  @Roles(Role.ADMIN)
  async listLogs(@Query('limit', new DefaultValuePipe(100)) limitRaw: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { logs };
  }
}
