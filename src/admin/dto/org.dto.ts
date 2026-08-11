import { ApiPropertyOptional } from '@nestjs/swagger';
import { MeetingMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOrgDto {
  @ApiPropertyOptional({ example: 'New Org Name' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({
    enum: MeetingMode,
    description: 'BOTH | ONLINE_ONLY | IN_PERSON_ONLY',
  })
  @IsOptional()
  @IsEnum(MeetingMode)
  meetingMode?: MeetingMode;

  @ApiPropertyOptional({
    description: 'Whether task tags are shown in the app',
  })
  @IsOptional()
  @IsBoolean()
  showTags?: boolean;
}
