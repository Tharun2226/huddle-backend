import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  attendeeIds!: string[];

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
