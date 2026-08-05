import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ExternalAttendeeDto {
  @ApiProperty({ example: 'Alex Guest' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 'alex@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

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

  @ApiProperty({ type: [String], description: 'Org user IDs (organizer always included)' })
  @IsArray()
  @IsString({ each: true })
  attendeeIds!: string[];

  @ApiPropertyOptional({ type: [ExternalAttendeeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalAttendeeDto)
  externalAttendees?: ExternalAttendeeDto[];

  @ApiPropertyOptional({
    description: 'true = online meeting (join link); false = in person',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    example: 'https://meet.google.com/abc-defg-hij',
    description: 'Join URL — used when isOnline is true',
  })
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional({ description: 'Agenda / description' })
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
