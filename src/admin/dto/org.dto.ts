import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdateOrgDto {
  @ApiProperty({ example: 'New Org Name' })
  @IsString()
  @MinLength(2)
  name!: string;
}
