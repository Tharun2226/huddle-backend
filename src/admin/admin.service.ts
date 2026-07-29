import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import {
  CreateRoleDto,
  CreateTaskPriorityDto,
  CreateTaskStatusDto,
  UpdateRoleDto,
  UpdateTaskPriorityDto,
  UpdateTaskStatusDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Organization ---

  async getOrg(user: AuthUser) {
    const org = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return { id: org.id, name: org.name, slug: org.slug };
  }

  async renameOrg(user: AuthUser, name: string) {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org';

    return this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { name: name.trim(), slug },
      select: { id: true, name: true, slug: true },
    });
  }

  // --- Roles ---

  async listRoles(user: AuthUser) {
    const roles = await this.prisma.role.findMany({
      where: { organizationId: user.organizationId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      isAdmin: r.isAdmin,
      isDefault: r.isDefault,
      sortOrder: r.sortOrder,
      permissions: r.permissions.map((rp) => rp.permission.code),
    }));
  }

  async createRole(user: AuthUser, dto: CreateRoleDto) {
    const slug = dto.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const role = await this.prisma.role.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name.trim(),
        slug,
        isDefault: dto.isDefault ?? false,
        isAdmin: dto.isAdmin ?? false,
      },
    });

    if (dto.permissions.length > 0) {
      const perms = await this.prisma.permission.findMany({
        where: { code: { in: dto.permissions } },
      });
      for (const p of perms) {
        await this.prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: p.id },
        });
      }
    }

    return this.listRoles(user).then((roles) => roles.find((r) => r.id === role.id));
  }

  async updateRole(user: AuthUser, id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!role) throw new NotFoundException('Role not found');

    const slug = dto.name
      ? dto.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      : undefined;

    await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim(), slug } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.isAdmin !== undefined ? { isAdmin: dto.isAdmin } : {}),
      },
    });

    if (dto.permissions) {
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      const perms = await this.prisma.permission.findMany({
        where: { code: { in: dto.permissions } },
      });
      for (const p of perms) {
        await this.prisma.rolePermission.create({
          data: { roleId: id, permissionId: p.id },
        });
      }
    }

    return this.listRoles(user).then((roles) => roles.find((r) => r.id === id));
  }

  async deleteRole(user: AuthUser, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!role) throw new NotFoundException('Role not found');

    const count = await this.prisma.userRole.count({ where: { roleId: id } });
    if (count > 0) {
      throw new BadRequestException('Cannot delete a role that has users assigned');
    }

    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }

  // --- Task Statuses ---

  async listTaskStatuses(user: AuthUser) {
    return this.prisma.orgTaskStatus.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createTaskStatus(user: AuthUser, dto: CreateTaskStatusDto) {
    const slug = dto.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return this.prisma.orgTaskStatus.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name.trim(),
        slug,
        color: dto.color ?? '#6B7280',
        sortOrder: dto.sortOrder ?? 0,
        isDefault: dto.isDefault ?? false,
        isDone: dto.isDone ?? false,
      },
    });
  }

  async updateTaskStatus(user: AuthUser, id: string, dto: UpdateTaskStatusDto) {
    const status = await this.prisma.orgTaskStatus.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!status) throw new NotFoundException('Task status not found');

    const slug = dto.name
      ? dto.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      : undefined;

    return this.prisma.orgTaskStatus.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim(), slug } : {}),
        ...(dto.color ? { color: dto.color } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.isDone !== undefined ? { isDone: dto.isDone } : {}),
      },
    });
  }

  async deleteTaskStatus(user: AuthUser, id: string) {
    const status = await this.prisma.orgTaskStatus.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!status) throw new NotFoundException('Task status not found');

    await this.prisma.orgTaskStatus.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  }

  // --- Task Priorities ---

  async listTaskPriorities(user: AuthUser) {
    return this.prisma.orgTaskPriority.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createTaskPriority(user: AuthUser, dto: CreateTaskPriorityDto) {
    const slug = dto.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return this.prisma.orgTaskPriority.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name.trim(),
        slug,
        color: dto.color ?? '#6B7280',
        sortOrder: dto.sortOrder ?? 0,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async updateTaskPriority(user: AuthUser, id: string, dto: UpdateTaskPriorityDto) {
    const priority = await this.prisma.orgTaskPriority.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!priority) throw new NotFoundException('Task priority not found');

    const slug = dto.name
      ? dto.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      : undefined;

    return this.prisma.orgTaskPriority.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim(), slug } : {}),
        ...(dto.color ? { color: dto.color } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
    });
  }

  async deleteTaskPriority(user: AuthUser, id: string) {
    const priority = await this.prisma.orgTaskPriority.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!priority) throw new NotFoundException('Task priority not found');

    await this.prisma.orgTaskPriority.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  }

  // --- Permissions ---

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { code: 'asc' } });
  }
}
