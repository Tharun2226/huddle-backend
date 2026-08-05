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
import { PermissionsGuard } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { TasksService } from './tasks.service';
import {
  AddCommentDto,
  CreateTaskDto,
  UpdateTaskDto,
  UpsertChecklistItemDto,
} from './dto/task.dto';

@ApiTags('tasks')
@ApiBearerAuth('access-token')
@Controller('tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tasks.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.remove(user, id);
  }

  @Post(':id/comments')
  comment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.tasks.addComment(user, id, dto);
  }

  @Post(':id/checklist')
  addChecklist(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertChecklistItemDto,
  ) {
    return this.tasks.addChecklistItem(user, id, dto);
  }

  @Post(':id/checklist/:itemId/toggle')
  toggleChecklist(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.tasks.toggleChecklist(user, id, itemId);
  }
}
