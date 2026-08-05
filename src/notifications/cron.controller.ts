import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ReminderScheduler } from './reminder.scheduler';

/**
 * Hit by Vercel Cron (GET). When CRON_SECRET is set in the project,
 * Vercel sends Authorization: Bearer <CRON_SECRET>.
 */
@ApiExcludeController()
@Controller('internal/cron')
export class CronController {
  constructor(private readonly reminderScheduler: ReminderScheduler) {}

  @Get('reminders')
  async runReminders(
    @Headers('authorization') authorization?: string,
  ) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      throw new UnauthorizedException('CRON_SECRET is not configured');
    }
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : authorization?.trim();
    if (token !== secret) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return this.reminderScheduler.runReminders();
  }
}
