import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { ActivityService } from './activity.service';

@ApiTags('activity')
@ApiBearerAuth('access-token')
@Controller('activity')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @RequirePermissions('activity.view')
  list(@CurrentUser() user: AuthUser) {
    return this.activity.list(user);
  }
}
