import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, DecisionDto } from './dto/expense.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.expenses.list(user);
  }

  @Get('approvals/pending')
  @Roles(UserRole.MANAGER)
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
  @Roles(UserRole.MANAGER)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.expenses.approve(user, id, dto);
  }

  @Post(':id/reject')
  @Roles(UserRole.MANAGER)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.expenses.reject(user, id, dto);
  }

  @Post(':id/reimburse')
  @Roles(UserRole.MANAGER)
  reimburse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.expenses.reimburse(user, id, dto);
  }
}
