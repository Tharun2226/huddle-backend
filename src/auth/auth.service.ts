import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/auth.dto';
import { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase() },
      include: { organization: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.organization.isActive) {
      throw new ForbiddenException('Organization is inactive');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user.id);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { organization: true } } },
    });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) {
        await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (!stored.user.organization.isActive) {
      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new ForbiddenException('Organization is inactive');
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    return this.issueTokens(stored.user.id);
  }

  async me(user: AuthUser) {
    const full = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        organization: true,
        manager: true,
        roles: { include: { role: true } },
      },
    });
    if (!full) throw new ForbiddenException('User not found');
    if (!full.organization.isActive) {
      throw new ForbiddenException('Organization is inactive');
    }

    const config = await this.getOrgConfig(full.organizationId);
    return { user: this.toPublicUser(full), config };
  }

  async logout(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
    return { ok: true };
  }

  private async issueTokens(userId: string) {
    const userWithRoles = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        organization: true,
        manager: true,
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    if (!userWithRoles.organization.isActive) {
      throw new ForbiddenException('Organization is inactive');
    }

    const permissions = [
      ...new Set(
        userWithRoles.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.code),
        ),
      ),
    ];
    const isAdmin = userWithRoles.roles.some((ur) => ur.role.isAdmin);

    const payload: JwtPayload = {
      sub: userWithRoles.id,
      email: userWithRoles.email,
      organizationId: userWithRoles.organizationId,
      permissions,
      isAdmin,
      isSuperAdmin: userWithRoles.isSuperAdmin,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES', '15m'),
    });

    const refreshToken = randomBytes(48).toString('hex');
    const days = this.parseRefreshDays(
      this.config.get('JWT_REFRESH_EXPIRES', '7d'),
    );
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: userWithRoles.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    const config = await this.getOrgConfig(userWithRoles.organizationId);

    return {
      accessToken,
      refreshToken,
      user: this.toPublicUser(userWithRoles),
      config,
    };
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    name: string;
    title: string;
    organizationId: string;
    isSuperAdmin?: boolean;
    managerId?: string | null;
    manager?: { id: string; name: string } | null;
    roles?: { role: { name: string; isAdmin: boolean } }[];
  }) {
    const roleNames = user.roles?.map((ur) => ur.role.name) ?? [];
    const isAdmin = user.roles?.some((ur) => ur.role.isAdmin) ?? false;
    const primaryRole = isAdmin
      ? 'admin'
      : roleNames.some((name) => name.toLowerCase() === 'manager')
        ? 'manager'
        : 'member';

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      title: user.title,
      role: primaryRole,
      organizationId: user.organizationId,
      roles: roleNames,
      isAdmin,
      isSuperAdmin: user.isSuperAdmin ?? false,
      managerId: user.managerId ?? null,
      managerName: user.manager?.name ?? null,
    };
  }

  private async getOrgConfig(organizationId: string) {
    const [roles, taskStatuses, taskPriorities] = await Promise.all([
      this.prisma.role.findMany({
        where: { organizationId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.orgTaskStatus.findMany({
        where: { organizationId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.orgTaskPriority.findMany({
        where: { organizationId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return {
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        isAdmin: r.isAdmin,
        isDefault: r.isDefault,
      })),
      taskStatuses: taskStatuses.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        color: s.color,
        isDefault: s.isDefault,
        isDone: s.isDone,
      })),
      taskPriorities: taskPriorities.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        color: p.color,
        isDefault: p.isDefault,
      })),
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseRefreshDays(value: string): number {
    const match = /^(\d+)d$/.exec(value);
    return match ? Number(match[1]) : 7;
  }
}
