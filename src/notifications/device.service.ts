import { Injectable, Logger } from '@nestjs/common';
import { DevicePlatform } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(user: AuthUser, dto: RegisterDeviceDto) {
    const platform = dto.platform as DevicePlatform;
    const device = await this.prisma.userDevice.upsert({
      where: { deviceToken: dto.deviceToken },
      create: {
        userId: user.id,
        organizationId: user.organizationId,
        deviceToken: dto.deviceToken,
        platform,
        lastUsedAt: new Date(),
      },
      update: {
        userId: user.id,
        organizationId: user.organizationId,
        platform,
        lastUsedAt: new Date(),
      },
    });
    this.logger.log(`Registered ${platform} device for user ${user.id}`);
    return {
      id: device.id,
      platform: device.platform,
      lastUsedAt: device.lastUsedAt.toISOString(),
    };
  }

  async removeToken(deviceToken: string) {
    await this.prisma.userDevice
      .deleteMany({ where: { deviceToken } })
      .catch(() => undefined);
  }

  async tokensForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { deviceToken: true },
    });
    return rows.map((r) => r.deviceToken);
  }
}
