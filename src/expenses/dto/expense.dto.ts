import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ExpenseCategory } from '@prisma/client';

export class CreateExpenseDto {
  @ApiProperty({ example: 42.5 })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: ExpenseCategory })
  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @ApiProperty({ example: '2026-07-29T00:00:00.000Z' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'Starbucks' })
  @IsString()
  @MinLength(1)
  merchant!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @ApiPropertyOptional({ description: 'Submit immediately after create' })
  @IsOptional()
  @IsBoolean()
  submitNow?: boolean;
}

/** Patch draft / rejected expenses before resubmit. */
export class UpdateExpenseDto {
  @ApiPropertyOptional({ example: 42.5 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;

  @ApiPropertyOptional({ example: '2026-07-29T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ example: 'Starbucks' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  merchant?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @ApiPropertyOptional({ description: 'Also submit after update' })
  @IsOptional()
  @IsBoolean()
  submitNow?: boolean;
}

export class DecisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
