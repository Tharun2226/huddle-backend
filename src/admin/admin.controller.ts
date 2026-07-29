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
import { AdminService } from './admin.service';
import {
  CreateRoleDto,
  CreateTaskPriorityDto,
  CreateTaskStatusDto,
  UpdateRoleDto,
  UpdateTaskPriorityDto,
  UpdateTaskStatusDto,
} from './dto/admin.dto';
import { UpdateOrgDto } from './dto/org.dto';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // --- Organization ---

  @Get('org')
  @RequirePermissions('org.settings')
  getOrg(@CurrentUser() user: AuthUser) {
    return this.admin.getOrg(user);
  }

  @Patch('org')
  @RequirePermissions('org.settings')
  renameOrg(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrgDto) {
    return this.admin.renameOrg(user, dto.name);
  }

  // --- Roles ---

  @Get('roles')
  @RequirePermissions('role.manage')
  listRoles(@CurrentUser() user: AuthUser) {
    return this.admin.listRoles(user);
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  createRole(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.admin.createRole(user, dto);
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.admin.updateRole(user, id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions('role.manage')
  deleteRole(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.deleteRole(user, id);
  }

  // --- Task Statuses ---

  @Get('task-statuses')
  @RequirePermissions('org.settings')
  listTaskStatuses(@CurrentUser() user: AuthUser) {
    return this.admin.listTaskStatuses(user);
  }

  @Post('task-statuses')
  @RequirePermissions('org.settings')
  createTaskStatus(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskStatusDto) {
    return this.admin.createTaskStatus(user, dto);
  }

  @Patch('task-statuses/:id')
  @RequirePermissions('org.settings')
  updateTaskStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.admin.updateTaskStatus(user, id, dto);
  }

  @Delete('task-statuses/:id')
  @RequirePermissions('org.settings')
  deleteTaskStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.deleteTaskStatus(user, id);
  }

  // --- Task Priorities ---

  @Get('task-priorities')
  @RequirePermissions('org.settings')
  listTaskPriorities(@CurrentUser() user: AuthUser) {
    return this.admin.listTaskPriorities(user);
  }

  @Post('task-priorities')
  @RequirePermissions('org.settings')
  createTaskPriority(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskPriorityDto) {
    return this.admin.createTaskPriority(user, dto);
  }

  @Patch('task-priorities/:id')
  @RequirePermissions('org.settings')
  updateTaskPriority(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskPriorityDto,
  ) {
    return this.admin.updateTaskPriority(user, id, dto);
  }

  @Delete('task-priorities/:id')
  @RequirePermissions('org.settings')
  deleteTaskPriority(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.deleteTaskPriority(user, id);
  }

  // --- Permissions ---

  @Get('permissions')
  @RequirePermissions('role.manage')
  listPermissions() {
    return this.admin.listPermissions();
  }
}
