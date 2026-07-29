import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, DecisionDto } from './dto/expense.dto';

@ApiTags('expenses')
@ApiBearerAuth('access-token')
@Controller('expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.expenses.list(user);
  }

  @Get('approvals/pending')
  @RequirePermissions('expense.approve')
  pending(@CurrentUser() user: AuthUser) {
    return this.expenses.pendingApprovals(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenses.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(user, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.expenses.submit(user, id);
  }

  @Post(':id/approve')
  @RequirePermissions('expense.approve')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.expenses.approve(user, id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions('expense.approve')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.expenses.reject(user, id, dto);
  }

  @Post(':id/reimburse')
  @RequirePermissions('expense.approve')
  reimburse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.expenses.reimburse(user, id, dto);
  }
}
