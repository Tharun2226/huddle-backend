import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';

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

  @Patch(':id')
  @RequirePermissions('meeting.create')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.meetings.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('meeting.create')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetings.remove(user, id);
  }
}
