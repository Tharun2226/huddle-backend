import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Labs' })
  @IsString()
  @MinLength(2)
  organizationName!: string;

  @ApiProperty({ example: 'Alex Manager' })
  @IsString()
  @MinLength(2)
  adminName!: string;

  @ApiProperty({ example: 'alex@acme.com' })
  @IsEmail()
  adminEmail!: string;

  @ApiProperty({ example: 'Huddle@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  adminPassword!: string;

  @ApiPropertyOptional({ example: 'Founder' })
  @IsOptional()
  @IsString()
  adminTitle?: string;
}
