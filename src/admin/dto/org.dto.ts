import { ApiPropertyOptional } from '@nestjs/swagger';
import { MeetingMode } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

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
}
