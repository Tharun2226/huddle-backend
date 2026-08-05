import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-org.dto';

const DEFAULT_PERMISSIONS = [
  'task.create', 'task.assign', 'task.update', 'task.view_all',
  'expense.create', 'expense.approve', 'expense.reject', 'expense.reimburse', 'expense.view_all',
  'meeting.create', 'meeting.view_all',
  'user.invite', 'user.update', 'role.manage', 'org.settings', 'activity.view',
];

const MANAGER_PERMISSIONS = [
  'task.create', 'task.assign', 'task.update', 'task.view_all',
  'expense.create', 'expense.approve', 'expense.reject', 'expense.reimburse', 'expense.view_all',
  'meeting.create', 'meeting.view_all', 'user.invite', 'activity.view',
];

const DEFAULT_TASK_STATUSES = [
  { name: 'To Do', slug: 'todo', sortOrder: 0, isDefault: true, isDone: false, color: '#6B7280', icon: 'circle_outlined' },
  { name: 'In Progress', slug: 'in_progress', sortOrder: 1, isDefault: false, isDone: false, color: '#3B82F6', icon: 'timelapse' },
  { name: 'In Review', slug: 'in_review', sortOrder: 2, isDefault: false, isDone: false, color: '#F59E0B', icon: 'visibility' },
  { name: 'Done', slug: 'done', sortOrder: 3, isDefault: false, isDone: true, color: '#10B981', icon: 'check_circle' },
];

const DEFAULT_TASK_PRIORITIES = [
  { name: 'Urgent', slug: 'urgent', sortOrder: 0, isDefault: false, color: '#EF4444', icon: 'bolt' },
  { name: 'High', slug: 'high', sortOrder: 1, isDefault: false, color: '#F59E0B', icon: 'arrow_upward' },
  { name: 'Normal', slug: 'normal', sortOrder: 2, isDefault: true, color: '#6B7280', icon: 'remove' },
  { name: 'Low', slug: 'low', sortOrder: 3, isDefault: false, color: '#3B82F6', icon: 'arrow_downward' },
];

const DEFAULT_TASK_TAGS = [
  { name: 'Frontend', slug: 'frontend', sortOrder: 0, isDefault: true, color: '#3B82F6' },
  { name: 'Backend', slug: 'backend', sortOrder: 1, isDefault: false, color: '#8B5CF6' },
  { name: 'Design', slug: 'design', sortOrder: 2, isDefault: false, color: '#EC4899' },
  { name: 'Mobile', slug: 'mobile', sortOrder: 3, isDefault: false, color: '#14B8A6' },
  { name: 'QA', slug: 'qa', sortOrder: 4, isDefault: false, color: '#F59E0B' },
  { name: 'DevOps', slug: 'devops', sortOrder: 5, isDefault: false, color: '#64748B' },
];

@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrganization(dto: CreateOrganizationDto) {
    const email = dto.adminEmail.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email } });
    if (existing) throw new ConflictException('Email is already registered');

    const slug = await this.uniqueSlug(dto.organizationName);
    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

    // Serverless (Vercel US) → remote Postgres can be slow; default 5s tx timeout fails.
    const result = await this.prisma.$transaction(
      async (tx) => {
        const org = await tx.organization.create({
          data: { name: dto.organizationName.trim(), slug, isActive: true },
        });

        await Promise.all(
          DEFAULT_PERMISSIONS.map((code) =>
            tx.permission.upsert({
              where: { code },
              create: { code },
              update: {},
            }),
          ),
        );
        const allPerms = await tx.permission.findMany({
          where: { code: { in: DEFAULT_PERMISSIONS } },
        });

        const adminRole = await tx.role.create({
          data: {
            organizationId: org.id,
            name: 'Admin',
            slug: 'admin',
            isAdmin: true,
            sortOrder: 0,
          },
        });
        await tx.rolePermission.createMany({
          data: allPerms.map((perm) => ({
            roleId: adminRole.id,
            permissionId: perm.id,
          })),
          skipDuplicates: true,
        });

        const managerPerms = allPerms.filter((p) =>
          MANAGER_PERMISSIONS.includes(p.code),
        );
        const managerRole = await tx.role.create({
          data: {
            organizationId: org.id,
            name: 'Manager',
            slug: 'manager',
            sortOrder: 1,
          },
        });
        await tx.rolePermission.createMany({
          data: managerPerms.map((perm) => ({
            roleId: managerRole.id,
            permissionId: perm.id,
          })),
          skipDuplicates: true,
        });

        const memberPerms = allPerms.filter((p) =>
          ['task.create', 'task.update', 'expense.create'].includes(p.code),
        );
        await tx.role.create({
          data: {
            organizationId: org.id,
            name: 'Member',
            slug: 'member',
            isDefault: true,
            sortOrder: 2,
            permissions: {
              create: memberPerms.map((p) => ({ permissionId: p.id })),
            },
          },
        });

        await tx.orgTaskStatus.createMany({
          data: DEFAULT_TASK_STATUSES.map((s) => ({
            organizationId: org.id,
            ...s,
          })),
        });
        await tx.orgTaskPriority.createMany({
          data: DEFAULT_TASK_PRIORITIES.map((p) => ({
            organizationId: org.id,
            ...p,
          })),
        });
        await tx.orgTaskTag.createMany({
          data: DEFAULT_TASK_TAGS.map((t) => ({
            organizationId: org.id,
            ...t,
          })),
        });

        const user = await tx.user.create({
          data: {
            organizationId: org.id,
            email,
            name: dto.adminName.trim(),
            title: dto.adminTitle?.trim() || 'Admin',
            passwordHash,
            roles: { create: { roleId: adminRole.id } },
          },
        });

        return { org, user };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );

    return {
      organization: {
        id: result.org.id,
        name: result.org.name,
        slug: result.org.slug,
      },
      admin: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
      },
    };
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
    let slug = base;
    let i = 2;
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${i}`;
      i += 1;
    }
    return slug;
  }

  async listOrganizations() {
    const orgs = await this.prisma.organization.findMany({
      where: {
        users: {
          some: { isSuperAdmin: false },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true } },
      },
    });

    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      isActive: o.isActive,
      createdAt: o.createdAt,
      memberCount: o._count.users,
    }));
  }

  async getOrganizationDetail(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        users: {
          where: { isSuperAdmin: false },
          select: {
            id: true,
            name: true,
            email: true,
            title: true,
            createdAt: true,
            roles: { include: { role: { select: { name: true, isAdmin: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!org) throw new NotFoundException('Organization not found');

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      isActive: org.isActive,
      createdAt: org.createdAt,
      stats: {
        members: org.users.length,
      },
      members: org.users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        title: u.title,
        createdAt: u.createdAt,
        roles: u.roles.map((r) => r.role.name),
        isAdmin: u.roles.some((r) => r.role.isAdmin),
      })),
    };
  }

  async updateOrganizationStatus(orgId: string, isActive: boolean) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        users: {
          select: { isSuperAdmin: true },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.users.every((user) => user.isSuperAdmin)) {
      throw new ConflictException('Platform organization cannot be deactivated');
    }

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { isActive },
      select: { id: true, name: true, isActive: true },
    });

    return updated;
  }
}
