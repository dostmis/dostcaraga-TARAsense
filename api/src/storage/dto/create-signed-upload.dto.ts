import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSignedUploadDto {
  @IsString()
  @IsNotEmpty()
  originalName!: string;

  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20_000_000)
  size?: number;

  @IsOptional()
  @IsString()
  @IsIn(['private', 'public'])
  visibility?: 'private' | 'public';
}
