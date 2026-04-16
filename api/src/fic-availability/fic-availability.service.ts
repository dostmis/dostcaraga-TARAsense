import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAvailabilityDto, UpdateAvailabilityDto, GetAvailableFicsQuery } from './dto/create-availability.dto';
import { Role } from '../common/enums/role.enum';
import type { FicAvailability } from '@prisma/client';

@Injectable()
export class FicAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get availability calendar for a specific FIC user
   */
  async getFicCalendar(ficUserId: string, startDate: string, endDate: string, currentUser: any) {
    // Authorization: Users can only see their own calendar, or admins can see any
    if (currentUser.role !== Role.ADMIN && currentUser.sub !== ficUserId) {
      throw new UnauthorizedException('You can only view your own availability calendar');
    }

    const availabilities = await this.prisma.ficAvailability.findMany({
      where: {
        ficUserId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    return availabilities;
  }

  /**
   * Get all FICs that are available for a date range
   */
  async getAvailableFics(query: GetAvailableFicsQuery) {
    const { startDate, endDate, region, facility } = query;

    // First, get all FIC users (role FIC or FIC_MANAGER)
    const fics = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.FIC, Role.FIC_MANAGER] },
        assignedRegion: { not: null },
        assignedFacility: { not: null },
        ...(region && { assignedRegion: region }),
        ...(facility && { assignedFacility: facility }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        organization: true,
        assignedRegion: true,
        assignedFacility: true,
      },
    });

    // Then check availability for each FIC in the date range
    const availableFics = await Promise.all(
      fics.map(async (fic) => {
        const availability = await this.prisma.ficAvailability.findMany({
          where: {
            ficUserId: fic.id,
            date: {
              gte: startDate,
              lte: endDate,
            },
            isAvailable: true,
            isLocked: false,
          },
          orderBy: { date: 'asc' },
        });

        const availableDates = availability.map((a: FicAvailability) => a.date);
        const totalDays = this.getDaysBetween(startDate, endDate).length;
        const availabilityPercentage = Math.round((availableDates.length / totalDays) * 100);

        return {
          ...fic,
          availableDates,
          availabilityPercentage,
        };
      }),
    );

    // Filter out FICs with no availability
    return availableFics.filter((fic: any) => fic.availableDates.length > 0);
  }

  /**
   * Bulk set availability for multiple dates
   */
  async bulkSetAvailability(ficUserId: string, availabilityDtos: CreateAvailabilityDto[], currentUser: any) {
    // Authorization
    if (currentUser.role !== Role.ADMIN && currentUser.sub !== ficUserId) {
      throw new UnauthorizedException('You can only modify your own availability');
    }

    const results = [];
    const errors = [];

    for (const dto of availabilityDtos) {
      try {
        // Check if date is locked
        const existing = await this.prisma.ficAvailability.findUnique({
          where: {
            ficUserId_date: {
              ficUserId,
              date: dto.date,
            },
          },
        });

        if (existing?.isLocked) {
          errors.push({
            date: dto.date,
            error: 'Cannot modify locked date (already booked by study)',
          });
          continue;
        }

        const availability = await this.prisma.ficAvailability.upsert({
          where: {
            ficUserId_date: {
              ficUserId,
              date: dto.date,
            },
          },
          update: {
            isAvailable: dto.isAvailable,
          },
          create: {
            ficUserId,
            date: dto.date,
            isAvailable: dto.isAvailable,
          },
        });

        results.push(availability);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          date: dto.date,
          error: errorMessage,
        });
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Set availability for a single date (toggle)
   */
  async setAvailability(ficUserId: string, date: string, dto: UpdateAvailabilityDto, currentUser: any) {
    // Authorization
    if (currentUser.role !== Role.ADMIN && currentUser.sub !== ficUserId) {
      throw new UnauthorizedException('You can only modify your own availability');
    }

    // Check if date is locked
    const existing = await this.prisma.ficAvailability.findUnique({
      where: {
        ficUserId_date: {
          ficUserId,
          date,
        },
      },
    });

    if (existing?.isLocked) {
      throw new ConflictException('Cannot modify locked date (already booked by study)');
    }

    return this.prisma.ficAvailability.upsert({
      where: {
        ficUserId_date: {
          ficUserId,
          date,
        },
      },
      update: {
        isAvailable: dto.isAvailable ?? existing?.isAvailable ?? false,
      },
      create: {
        ficUserId,
        date,
        isAvailable: dto.isAvailable ?? false,
      },
    });
  }

  /**
   * Lock dates when a study books them
   */
  async lockDatesForStudy(ficUserId: string, dates: string[], studyId: string) {
    if (!dates || dates.length === 0) {
      throw new BadRequestException('Dates array is required');
    }

    // Verify dates are not already locked by another study
    const lockedDates = await this.prisma.ficAvailability.findMany({
      where: {
        ficUserId,
        date: { in: dates },
        isLocked: true,
        NOT: { lockedById: studyId },
      },
    });

    if (lockedDates.length > 0) {
      throw new ConflictException(
        `Dates ${lockedDates.map((d: any) => d.date).join(', ')} are already booked by another study`,
      );
    }

    // Lock the dates
    return this.prisma.$transaction(
      dates.map((date: string) =>
        this.prisma.ficAvailability.upsert({
          where: {
            ficUserId_date: {
              ficUserId,
              date,
            },
          },
          update: {
            isLocked: true,
            lockedById: studyId,
            lockedAt: new Date(),
          },
          create: {
            ficUserId,
            date,
            isAvailable: true, // Assume available if not existed
            isLocked: true,
            lockedById: studyId,
            lockedAt: new Date(),
          },
        }),
      ),
    );
  }

  /**
   * Unlock dates when a study is cancelled or rescheduled
   */
  async unlockDatesForStudy(ficUserId: string, studyId: string, dates?: string[]) {
    const whereClause: any = {
      ficUserId,
      lockedById: studyId,
      isLocked: true,
    };

    if (dates && dates.length > 0) {
      whereClause.date = { in: dates };
    }

    return this.prisma.ficAvailability.updateMany({
      where: whereClause,
      data: {
        isLocked: false,
        lockedById: null,
        lockedAt: null,
      },
    });
  }

  /**
   * Helper: Get all days between two dates
   */
  private getDaysBetween(startDate: string, endDate: string): string[] {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates: string[] = [];

    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }

    return dates;
  }
}
