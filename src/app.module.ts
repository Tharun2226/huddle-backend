import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { MeetingsModule } from './meetings/meetings.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ActivityModule } from './activity/activity.module';
import { TodayModule } from './today/today.module';
import { AdminModule } from './admin/admin.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TasksModule,
    MeetingsModule,
    ExpensesModule,
    ActivityModule,
    TodayModule,
    AdminModule,
    SuperAdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
