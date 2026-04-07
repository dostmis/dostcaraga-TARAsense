import { Module } from '@nestjs/common';
import { FicAvailabilityService } from './fic-availability.service';
import { FicAvailabilityController } from './fic-availability.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FicAvailabilityController],
  providers: [FicAvailabilityService],
  exports: [FicAvailabilityService],
})
export class FicAvailabilityModule {}
