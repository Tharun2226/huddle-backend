import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { TodayService } from './today.service';

@Controller('today')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.today.get(user);
  }
}
