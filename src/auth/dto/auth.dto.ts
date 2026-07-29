import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ajyotheeswarreddy@gmail.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Huddle@123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}
