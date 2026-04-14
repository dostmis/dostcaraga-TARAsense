import { Controller, Get, Post, Patch, Body, Query, Param, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FicAvailabilityService } from './fic-availability.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateAvailabilityDto, BulkCreateAvailabilityDto, UpdateAvailabilityDto, GetAvailableFicsQuery } from './dto/create-availability.dto';

@ApiTags('fic-availability')
@Controller('fic-availability')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FicAvailabilityController {
  constructor(private readonly ficAvailabilityService: FicAvailabilityService) {}

  @Get('calendar/:ficUserId')
  @ApiOperation({ summary: 'Get availability calendar for a specific FIC user' })
  @Roles(Role.ADMIN, Role.FIC, Role.FIC_MANAGER)
  async getCalendar(
    @Param('ficUserId') ficUserId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Request() req: any,
  ) {
    if (!startDate || !endDate) {
      // Default to current month if no dates provided
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      startDate = this.formatDate(startOfMonth);
      endDate = this.formatDate(endOfMonth);
    }

    return this.ficAvailabilityService.getFicCalendar(
      ficUserId,
      startDate,
      endDate,
      req.user,
    );
  }

  private formatDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  @Get('available-fics')
  @ApiOperation({ summary: 'Get all FICs available for a date range' })
  @Roles(Role.ADMIN, Role.MSME)
  async getAvailableFics(@Query() query: GetAvailableFicsQuery) {
    return this.ficAvailabilityService.getAvailableFics(query);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk set availability for multiple dates' })
  @Roles(Role.ADMIN, Role.FIC, Role.FIC_MANAGER)
  async bulkSetAvailability(
    @Body() dto: BulkCreateAvailabilityDto,
    @Query('ficUserId') ficUserId: string,
    @Request() req: any,
  ) {
    // If no ficUserId in query, use current user (FIC editing their own)
    const targetFicUserId = ficUserId || req.user.sub;
    
    return this.ficAvailabilityService.bulkSetAvailability(
      targetFicUserId,
      dto.dates,
      req.user,
    );
  }

  @Patch(':ficUserId/:date')
  @ApiOperation({ summary: 'Toggle availability for a single date' })
  @Roles(Role.ADMIN, Role.FIC, Role.FIC_MANAGER)
  async setAvailability(
    @Param('ficUserId') ficUserId: string,
    @Param('date') date: string,
    @Body() dto: UpdateAvailabilityDto,
    @Request() req: any,
  ) {
    return this.ficAvailabilityService.setAvailability(
      ficUserId,
      date,
      dto,
      req.user,
    );
  }
}
