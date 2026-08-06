import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { DeviceService } from './device.service';
import { NotificationService } from './notification.service';
import { ReminderScheduler } from './reminder.scheduler';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly devices: DeviceService,
    private readonly notifications: NotificationService,
    private readonly reminders: ReminderScheduler,
  ) {}

  /** Register / refresh FCM device token for the authenticated user. */
  @Post('users/register-device')
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.devices.register(user, dto);
  }

  @Get('notifications')
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.listForUser(user);
  }

  /** Clear the whole inbox for the current user. */
  @Delete('notifications')
  clearAll(@CurrentUser() user: AuthUser) {
    return this.notifications.clearAll(user);
  }

  /** Manually run reminder scan (useful while testing). */
  @Post('notifications/run-reminders')
  runReminders() {
    return this.reminders.runReminders();
  }

  @Put('notifications/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }

  /** Spec alias: PUT /api/notifications/read/:id */
  @Put('notifications/read/:id')
  markReadAlias(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user, id);
  }

  @Delete('notifications/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.remove(user, id);
  }
}
