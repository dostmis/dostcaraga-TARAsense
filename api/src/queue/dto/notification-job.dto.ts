import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class NotificationJobDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsOptional()
  payload?: Record<string, unknown>;
}
