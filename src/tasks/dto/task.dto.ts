import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
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
    description: 'One or more assignees (FE + BE, etc.)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
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

  @ApiPropertyOptional({ example: '2026-08-01T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
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
