import { ForbiddenException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, AuthUser } from './auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Prefer JWT permission claims. One light user+role-name select replaces the
   * previous roles→permissions join tree on every authenticated request.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        name: true,
        title: true,
        isSuperAdmin: true,
        organization: { select: { isActive: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    });

    if (user && !user.organization.isActive) {
      throw new ForbiddenException('Organization is inactive');
    }

    const roleNames =
      payload.roleNames?.length
        ? payload.roleNames
        : (user?.roles ?? []).map((ur) => ur.role.name);

    return {
      id: payload.sub,
      email: payload.email,
      name: user?.name ?? payload.name ?? '',
      title: user?.title ?? payload.title ?? '',
      organizationId: payload.organizationId,
      permissions: payload.permissions ?? [],
      isAdmin: payload.isAdmin ?? false,
      isSuperAdmin: user?.isSuperAdmin ?? payload.isSuperAdmin ?? false,
      roleNames,
    };
  }
}
