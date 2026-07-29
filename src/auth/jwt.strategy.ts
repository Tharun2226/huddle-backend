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

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        organization: true,
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });

    if (!user) {
      return {
        id: payload.sub,
        email: payload.email,
        name: '',
        title: '',
        organizationId: payload.organizationId,
        permissions: payload.permissions ?? [],
        isAdmin: payload.isAdmin ?? false,
        isSuperAdmin: payload.isSuperAdmin ?? false,
        roleNames: [],
      };
    }
    if (!user.organization.isActive) {
      throw new ForbiddenException('Organization is inactive');
    }

    const permissions = [
      ...new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.code),
        ),
      ),
    ];
    const isAdmin = user.roles.some((ur) => ur.role.isAdmin);
    const roleNames = user.roles.map((ur) => ur.role.name);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      title: user.title,
      organizationId: user.organizationId,
      permissions,
      isAdmin,
      isSuperAdmin: user.isSuperAdmin,
      roleNames,
    };
  }
}
