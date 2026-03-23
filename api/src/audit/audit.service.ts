import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  action: string;
  resource: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string | string[];
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput) {
    const userAgent = Array.isArray(input.userAgent) ? input.userAgent.join('; ') : input.userAgent;

    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        resource: input.resource,
        actorId: input.actorId,
        metadata: input.metadata as never,
        ipAddress: input.ipAddress,
        userAgent,
      },
    });
  }
}
