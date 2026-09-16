import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Prepare Q3 deck' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Primary assignee (used when assigneeIds omitted)',
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Org assignees. May be empty when externalAssignees has at least one name.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];

  @ApiPropertyOptional({ description: 'OrgTaskStatus ID' })
  @IsOptional()
  @IsString()
  statusId?: string;

  @ApiPropertyOptional({ description: 'OrgTaskPriority ID' })
  @IsOptional()
  @IsString()
  priorityId?: string;

  @ApiProperty({ example: '2026-08-01T10:00:00.000Z' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ type: [String], example: ['Frontend', 'Backend'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Write unit tests', 'Update docs'],
    description: 'Optional checklist item labels created with the task',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  checklist?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Client contact', 'Vendor lead'],
    description: 'Free-text people outside the organization',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  externalAssignees?: string[];
}

export class UpdateTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Org assignees. May be empty when externalAssignees has at least one name.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];

  @ApiPropertyOptional({ description: 'OrgTaskStatus ID' })
  @IsOptional()
  @IsString()
  statusId?: string;

  @ApiPropertyOptional({ description: 'OrgTaskPriority ID' })
  @IsOptional()
  @IsString()
  priorityId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Free-text people outside the organization',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  externalAssignees?: string[];
}

export class AddCommentDto {
  @ApiProperty({ example: 'Looks good to ship' })
  @IsString()
  @MinLength(1)
  body!: string;
}

export class UpsertChecklistItemDto {
  @ApiProperty({ example: 'Review slides' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  done?: boolean;
}

export class ImportTaskRowDto {
  @ApiProperty({ example: 'Teleconference on E3, E13, E15' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: '2026-08-11T09:00:00.000Z',
    description: 'Due instant (local date+time encoded as UTC ISO)',
  })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({
    example: 'PVK Bhaskar, Uma',
    description:
      'Comma/semicolon-separated names. Matched org users become assignees; unmatched go to Others. Empty → current user.',
  })
  @IsOptional()
  @IsString()
  assignees?: string;

  @ApiPropertyOptional({ example: 'Normal' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ example: 'To Do' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class ImportTasksDto {
  @ApiProperty({ type: [ImportTaskRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportTaskRowDto)
  rows!: ImportTaskRowDto[];
}
