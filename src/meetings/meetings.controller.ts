import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto } from './dto/meeting.dto';

@ApiTags('meetings')
@ApiBearerAuth('access-token')
@Controller('meetings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.meetings.list(user);
  }

  @Get('task/:taskId')
  listForTask(@CurrentUser() user: AuthUser, @Param('taskId') taskId: string) {
    return this.meetings.listForTask(user, taskId);
  }

  @Post()
  @RequirePermissions('meeting.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(user, dto);
  }
}
