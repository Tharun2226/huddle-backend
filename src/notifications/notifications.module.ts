import { Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DeviceService } from './device.service';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { CronController } from './cron.controller';
import { ReminderScheduler } from './reminder.scheduler';
import { initFirebaseAdmin } from './firebase-admin';

const scheduleImports = process.env.VERCEL
  ? []
  : [ScheduleModule.forRoot()];

@Module({
  imports: scheduleImports,
  controllers: [NotificationsController, CronController],
  providers: [DeviceService, NotificationService, ReminderScheduler],
  exports: [NotificationService, DeviceService],
})
export class NotificationsModule implements OnModuleInit {
  onModuleInit() {
    initFirebaseAdmin();
  }
}
