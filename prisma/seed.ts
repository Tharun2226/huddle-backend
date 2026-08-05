/**
 * Simple production seeder.
 *
 * Creates permissions, platform super-admin, one org with Admin/Manager/Member
 * roles, default task statuses/priorities/tags, and one org admin user.
 *
 * Env (optional):
 *   SEED_PASSWORD          default Huddle@123
 *   SEED_ORG_NAME          default Huddle
 *   SEED_ORG_SLUG          default huddle
 *   SEED_ADMIN_EMAIL       default admin@huddle.app
 *   SEED_ADMIN_NAME        default Admin
 *   SEED_SUPERADMIN_EMAIL  default superadmin@huddle.app
 *   SEED_RESET=true        wipe all data before seeding (dev only)
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'test@123';
const ORG_NAME = process.env.SEED_ORG_NAME ?? 'Huddle';
const ORG_SLUG = process.env.SEED_ORG_SLUG ?? 'huddle';
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@gmail.com').toLowerCase();
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Admin';
const SUPERADMIN_EMAIL = (
  process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@gmail.com'
).toLowerCase();
const RESET = process.env.SEED_RESET === 'true';

const PERMISSIONS = [
  'task.create',
  'task.assign',
  'task.update',
  'task.view_all',
  'expense.create',
  'expense.approve',
  'expense.reject',
  'expense.reimburse',
  'expense.view_all',
  'meeting.create',
  'meeting.view_all',
  'user.invite',
  'user.update',
  'role.manage',
  'org.settings',
  'activity.view',
];

const MANAGER_PERMISSIONS = new Set([
  'task.create',
  'task.assign',
  'task.update',
  'task.view_all',
  'expense.create',
  'expense.approve',
  'expense.reject',
  'expense.reimburse',
  'expense.view_all',
  'meeting.create',
  'meeting.view_all',
  'user.invite',
  'activity.view',
]);

const MEMBER_PERMISSIONS = new Set([
  'task.create',
  'task.update',
  'expense.create',
]);

async function wipeAll() {
  await prisma.appNotification.deleteMany().catch(() => undefined);
  await prisma.userDevice.deleteMany().catch(() => undefined);
  await prisma.auditLog.deleteMany();
  await prisma.activityEvent.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.taskChecklistItem.deleteMany();
  await prisma.taskAssignee.deleteMany().catch(() => undefined);
  await prisma.meetingAttendee.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.task.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.orgTaskStatus.deleteMany();
  await prisma.orgTaskPriority.deleteMany();
  await prisma.orgTaskTag.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.permission.deleteMany();
}

async function ensurePermissions() {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      create: { code },
      update: {},
    });
  }
  return prisma.permission.findMany({
    where: { code: { in: PERMISSIONS } },
  });
}

async function seedCatalog(organizationId: string) {
  const statuses = [
    {
      name: 'To Do',
      slug: 'todo',
      sortOrder: 0,
      isDefault: true,
      color: '#6B7280',
      icon: 'radio_button_unchecked',
    },
    {
      name: 'In Progress',
      slug: 'in_progress',
      sortOrder: 1,
      color: '#3B82F6',
      icon: 'timelapse',
    },
    {
      name: 'In Review',
      slug: 'in_review',
      sortOrder: 2,
      color: '#F59E0B',
      icon: 'rate_review',
    },
    {
      name: 'Done',
      slug: 'done',
      sortOrder: 3,
      isDone: true,
      color: '#10B981',
      icon: 'check_circle',
    },
  ];
  for (const s of statuses) {
    await prisma.orgTaskStatus.upsert({
      where: {
        organizationId_slug: { organizationId, slug: s.slug },
      },
      create: { organizationId, ...s },
      update: {
        name: s.name,
        sortOrder: s.sortOrder,
        color: s.color,
        icon: s.icon,
        isDefault: s.isDefault ?? false,
        isDone: s.isDone ?? false,
      },
    });
  }

  const priorities = [
    {
      name: 'Urgent',
      slug: 'urgent',
      sortOrder: 0,
      color: '#EF4444',
      icon: 'priority_high',
    },
    {
      name: 'High',
      slug: 'high',
      sortOrder: 1,
      color: '#F59E0B',
      icon: 'keyboard_double_arrow_up',
    },
    {
      name: 'Normal',
      slug: 'normal',
      sortOrder: 2,
      isDefault: true,
      color: '#6B7280',
      icon: 'remove',
    },
    {
      name: 'Low',
      slug: 'low',
      sortOrder: 3,
      color: '#3B82F6',
      icon: 'keyboard_arrow_down',
    },
  ];
  for (const p of priorities) {
    await prisma.orgTaskPriority.upsert({
      where: {
        organizationId_slug: { organizationId, slug: p.slug },
      },
      create: { organizationId, ...p },
      update: {
        name: p.name,
        sortOrder: p.sortOrder,
        color: p.color,
        icon: p.icon,
        isDefault: p.isDefault ?? false,
      },
    });
  }

  const tags = [
    { name: 'Frontend', slug: 'frontend', color: '#3B82F6', sortOrder: 0, isDefault: true },
    { name: 'Backend', slug: 'backend', color: '#8B5CF6', sortOrder: 1 },
    { name: 'Design', slug: 'design', color: '#EC4899', sortOrder: 2 },
    { name: 'Mobile', slug: 'mobile', color: '#14B8A6', sortOrder: 3 },
    { name: 'QA', slug: 'qa', color: '#F59E0B', sortOrder: 4 },
    { name: 'DevOps', slug: 'devops', color: '#64748B', sortOrder: 5 },
  ];
  for (const t of tags) {
    await prisma.orgTaskTag.upsert({
      where: {
        organizationId_slug: { organizationId, slug: t.slug },
      },
      create: { organizationId, ...t },
      update: {
        name: t.name,
        color: t.color,
        sortOrder: t.sortOrder,
        isDefault: t.isDefault ?? false,
      },
    });
  }
}

async function ensureRole(
  organizationId: string,
  opts: {
    name: string;
    slug: string;
    isAdmin?: boolean;
    isDefault?: boolean;
    sortOrder: number;
    permissionCodes: Set<string> | 'all';
    allPerms: { id: string; code: string }[];
  },
) {
  const role = await prisma.role.upsert({
    where: {
      organizationId_slug: { organizationId, slug: opts.slug },
    },
    create: {
      organizationId,
      name: opts.name,
      slug: opts.slug,
      isAdmin: opts.isAdmin ?? false,
      isDefault: opts.isDefault ?? false,
      sortOrder: opts.sortOrder,
    },
    update: {
      name: opts.name,
      isAdmin: opts.isAdmin ?? false,
      isDefault: opts.isDefault ?? false,
      sortOrder: opts.sortOrder,
    },
  });

  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  const perms =
    opts.permissionCodes === 'all'
      ? opts.allPerms
      : opts.allPerms.filter((p) =>
          (opts.permissionCodes as Set<string>).has(p.code),
        );
  for (const perm of perms) {
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function main() {
  if (RESET) {
    console.log('SEED_RESET=true — wiping database…');
    await wipeAll();
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const allPerms = await ensurePermissions();

  const platform = await prisma.organization.upsert({
    where: { slug: 'platform' },
    create: {
      name: 'Huddle Platform',
      slug: 'platform',
      isActive: true,
    },
    update: { name: 'Huddle Platform', isActive: true },
  });

  const existingSuper = await prisma.user.findFirst({
    where: { email: SUPERADMIN_EMAIL, organizationId: platform.id },
  });
  if (existingSuper) {
    await prisma.user.update({
      where: { id: existingSuper.id },
      data: {
        name: 'Super Admin',
        passwordHash,
        isSuperAdmin: true,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        organizationId: platform.id,
        name: 'Super Admin',
        email: SUPERADMIN_EMAIL,
        title: 'Platform Admin',
        passwordHash,
        isSuperAdmin: true,
      },
    });
  }

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: {
      name: ORG_NAME,
      slug: ORG_SLUG,
      isActive: true,
    },
    update: { name: ORG_NAME, isActive: true },
  });

  const adminRole = await ensureRole(org.id, {
    name: 'Admin',
    slug: 'admin',
    isAdmin: true,
    sortOrder: 0,
    permissionCodes: 'all',
    allPerms,
  });
  await ensureRole(org.id, {
    name: 'Manager',
    slug: 'manager',
    sortOrder: 1,
    permissionCodes: MANAGER_PERMISSIONS,
    allPerms,
  });
  await ensureRole(org.id, {
    name: 'Member',
    slug: 'member',
    isDefault: true,
    sortOrder: 2,
    permissionCodes: MEMBER_PERMISSIONS,
    allPerms,
  });

  await seedCatalog(org.id);

  const existingAdmin = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL, organizationId: org.id },
  });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          name: ADMIN_NAME,
          passwordHash,
        },
      })
    : await prisma.user.create({
        data: {
          organizationId: org.id,
          name: ADMIN_NAME,
          email: ADMIN_EMAIL,
          title: 'Organization Admin',
          passwordHash,
        },
      });

  await prisma.userRole.deleteMany({ where: { userId: admin.id } });
  await prisma.userRole.create({
    data: { userId: admin.id, roleId: adminRole.id },
  });

  console.log('Seed complete.');
  console.log(`  Org:          ${ORG_NAME} (${ORG_SLUG})`);
  console.log(`  Admin:        ${ADMIN_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`  Super admin:  ${SUPERADMIN_EMAIL} / ${SEED_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
