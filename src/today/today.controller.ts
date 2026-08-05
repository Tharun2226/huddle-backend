import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { TodayService } from './today.service';

@ApiTags('today')
@ApiBearerAuth('access-token')
@Controller('today')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.today.get(user);
  }
}
