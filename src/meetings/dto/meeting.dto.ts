import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMeetingDto {
  @ApiProperty({ example: 'Weekly sync' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  @IsDateString()
  start!: string;

  @ApiProperty({ example: '2026-07-30T11:00:00.000Z' })
  @IsDateString()
  end!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  attendeeIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    example: 'https://meet.google.com/abc-defg-hij',
    description: 'Join / redirect URL',
  })
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    enum: ['none', 'daily', 'weekly'],
    default: 'none',
    description: 'none = one-time, daily = every day, weekly = selected weekdays',
  })
  @IsOptional()
  @IsIn(['none', 'daily', 'weekly'])
  recurrence?: 'none' | 'daily' | 'weekly';

  @ApiPropertyOptional({
    type: [Number],
    example: [4, 7],
    description: 'Dart weekday numbers 1=Mon … 7=Sun (required for weekly)',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ description: 'Optional related task id' })
  @IsOptional()
  @IsString()
  taskId?: string;
}

/** Full replace of editable meeting fields (same shape as create). */
export class UpdateMeetingDto extends CreateMeetingDto {}
