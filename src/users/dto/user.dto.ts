import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class InviteUserDto {
  @ApiProperty({ example: 'jordan@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Jordan Lee' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({
    example: 'Huddle@123',
    description: 'Temporary password the teammate uses to sign in',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({ description: 'Role ID to assign (admins only; managers always invite as Member)' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ example: 'Designer' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Manager user ID for this teammate' })
  @IsOptional()
  @IsString()
  managerId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Role ID to assign' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ example: 'Senior Engineer' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Jordan Lee' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ description: 'Manager user ID for this teammate' })
  @IsOptional()
  @IsString()
  managerId?: string;
}
