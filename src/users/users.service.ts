import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { PRISMA_TX } from '../common/prisma-tx';
import { getScopedUserIds } from '../common/team-scope';
import { InviteUserDto, UpdateUserDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOrg(user: AuthUser) {
    // Admins see the full org roster. Managers/members use team scope.
    // (getScopedUserIds returns [] for admins — that must NOT be used with `id: { in: [] }`.)
    const where = user.isAdmin
      ? { organizationId: user.organizationId }
      : {
          organizationId: user.organizationId,
          id: { in: await getScopedUserIds(this.prisma, user) },
        };

    const users = await this.prisma.user.findMany({
      where,
      include: { roles: { include: { role: true } }, manager: true },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => this.toPublic(u));
  }

  async invite(actor: AuthUser, dto: InviteUserDto) {
    if (!actor.isAdmin && !actor.permissions.includes('user.invite')) {
      throw new ForbiddenException('You do not have permission to create users');
    }

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    let role;
    let managerId = dto.managerId ?? null;

    // Non-admins may only create members on their own team.
    if (!actor.isAdmin) {
      role = await this.prisma.role.findFirst({
        where: {
          organizationId: actor.organizationId,
          slug: 'member',
        },
      });
      if (!role) {
        throw new BadRequestException(
          'Member role is not configured for this organization',
        );
      }
      managerId = actor.id;
    } else {
      if (!dto.roleId) {
        throw new BadRequestException('Role is required');
      }
      role = await this.prisma.role.findFirst({
        where: { id: dto.roleId, organizationId: actor.organizationId },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (managerId) {
        await this.ensureManager(actor.organizationId, managerId);
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        email,
        name: dto.name.trim(),
        title: dto.title?.trim() || '',
        managerId: role.isAdmin ? null : managerId,
        passwordHash,
        roles: { create: { roleId: role.id } },
      },
      include: { roles: { include: { role: true } }, manager: true },
    });
    return this.toPublic(created);
  }

  async update(actor: AuthUser, userId: string, dto: UpdateUserDto) {
    if (!actor.isAdmin && !actor.permissions.includes('user.update')) {
      throw new ForbiddenException('You do not have permission to update users');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw new NotFoundException('User not found');

    if (
      !dto.roleId &&
      dto.title === undefined &&
      dto.name === undefined &&
      dto.managerId === undefined
    ) {
      throw new BadRequestException('Nothing to update');
    }

    let nextRole = target.roles[0]?.role ?? null;
    if (dto.roleId) {
      const newRole = await this.prisma.role.findFirst({
        where: { id: dto.roleId, organizationId: actor.organizationId },
      });
      if (!newRole) throw new NotFoundException('Role not found');

      const currentIsAdmin = target.roles.some((ur) => ur.role.isAdmin);
      if (currentIsAdmin && !newRole.isAdmin && target.id === actor.id) {
        const adminCount = await this.prisma.userRole.count({
          where: { role: { organizationId: actor.organizationId, isAdmin: true } },
        });
        if (adminCount <= 1) {
          throw new BadRequestException(
            'Cannot demote the only admin in the organization',
          );
        }
      }
      nextRole = newRole;
    }

    let nextManagerId: string | null | undefined = undefined;
    if (dto.managerId !== undefined) {
      nextManagerId = dto.managerId || null;
    }
    if (nextRole?.isAdmin || nextRole?.slug === 'manager') {
      nextManagerId = null;
    } else if (nextManagerId) {
      await this.ensureManager(actor.organizationId, nextManagerId);
      if (nextManagerId === userId) {
        throw new BadRequestException('A user cannot report to themselves');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.roleId && nextRole) {
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.create({ data: { userId, roleId: nextRole.id } });
      }

      return tx.user.update({
        where: { id: target.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(nextManagerId !== undefined ? { managerId: nextManagerId } : {}),
        },
        include: { roles: { include: { role: true } }, manager: true },
      });
    }, { ...PRISMA_TX });

    return this.toPublic(updated);
  }

  private toPublic(u: {
    id: string;
    email: string;
    name: string;
    title: string;
    managerId?: string | null;
    manager?: { id: string; name: string } | null;
    roles: { role: { name: string; isAdmin: boolean } }[];
  }) {
    const roleNames = u.roles.map((ur) => ur.role.name);
    const isAdmin = u.roles.some((ur) => ur.role.isAdmin);
    const isManager = !isAdmin && roleNames.some((name) => name.toLowerCase() === 'manager');
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      title: u.title,
      role: isAdmin ? 'admin' : isManager ? 'manager' : 'member',
      roles: roleNames,
      isAdmin,
      managerId: u.managerId ?? null,
      managerName: u.manager?.name ?? null,
    };
  }

  private async ensureManager(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('Manager not found');
    const valid = user.roles.some(
      (entry) => entry.role.isAdmin || entry.role.name.toLowerCase() === 'manager',
    );
    if (!valid) {
      throw new BadRequestException('Selected user is not a manager');
    }
  }
}
