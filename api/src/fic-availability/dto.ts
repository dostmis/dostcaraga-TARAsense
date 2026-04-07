import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAvailabilityDto {
  @ApiProperty({ example: '2025-03-15', description: 'Date in YYYY-MM-DD format' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: true, description: 'Whether FIC is available on this date' })
  @IsBoolean()
  isAvailable!: boolean;
}

export class BulkCreateAvailabilityDto {
  @ApiProperty({ type: [CreateAvailabilityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAvailabilityDto)
  dates!: CreateAvailabilityDto[];
}

export class UpdateAvailabilityDto {
  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isAvailable?: boolean;

  @ApiProperty({ example: 'stud_123', required: false })
  @IsString()
  @IsOptional()
  lockedById?: string;
}

export class GetAvailableFicsQuery {
  @ApiProperty({ example: '2025-03-01', description: 'Start date in YYYY-MM-DD format' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2025-03-30', description: 'End date in YYYY-MM-DD format' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({ example: 'FIC CSU Main Campus', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  facility?: string;
}
