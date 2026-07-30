import {
  PrismaClient,
  ExpenseStatus,
  ExpenseCategory,
  ActivityType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'Huddle@123';

const IDS = {
  platformOrg: 'org_platform',
  cloveOrg: 'org_clove',
  superAdmin: 'u_superadmin',
  admin: 'u_jyotheeswar',
  kiran: 'u_kiran',
  sowith: 'u_sowith',
  tharun: 'u_tharun',
  reddy: 'u_reddy',
  sai: 'u_sai',
  subbu: 'u_subbu',
};

const DEFAULT_PERMISSIONS = [
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

const MANAGER_PERMISSIONS = [
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
];

function day(offset: number) {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  d.setDate(d.getDate() + offset);
  return d;
}

function at(dayOffset: number, hour: number, minute = 0) {
  const d = day(dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function soon() {
  const n = new Date(Date.now() + 45 * 60 * 1000);
  n.setMinutes(Math.floor(n.getMinutes() / 5) * 5, 0, 0);
  return n;
}

async function wipeAll() {
  await prisma.auditLog.deleteMany();
  await prisma.activityEvent.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.taskChecklistItem.deleteMany();
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
}

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  await wipeAll();

  for (const code of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      create: { code },
      update: {},
    });
  }
  const allPerms = await prisma.permission.findMany({
    where: { code: { in: DEFAULT_PERMISSIONS } },
  });

  // Platform org + super admin
  await prisma.organization.create({
    data: {
      id: IDS.platformOrg,
      name: 'Huddle Platform',
      slug: 'platform',
      isActive: true,
    },
  });
  await prisma.user.create({
    data: {
      id: IDS.superAdmin,
      organizationId: IDS.platformOrg,
      name: 'Super Admin',
      email: 'superadmin@huddle.app',
      title: 'Platform Admin',
      passwordHash,
      isSuperAdmin: true,
    },
  });

  // Clove org
  await prisma.organization.create({
    data: {
      id: IDS.cloveOrg,
      name: 'Clove',
      slug: 'clove',
      isActive: true,
    },
  });

  const adminRole = await prisma.role.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Admin',
      slug: 'admin',
      isAdmin: true,
      sortOrder: 0,
    },
  });
  for (const perm of allPerms) {
    await prisma.rolePermission.create({
      data: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  const managerRole = await prisma.role.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Manager',
      slug: 'manager',
      sortOrder: 1,
    },
  });
  for (const perm of allPerms.filter((p) => MANAGER_PERMISSIONS.includes(p.code))) {
    await prisma.rolePermission.create({
      data: { roleId: managerRole.id, permissionId: perm.id },
    });
  }

  const memberRole = await prisma.role.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Member',
      slug: 'member',
      isDefault: true,
      sortOrder: 2,
    },
  });
  for (const perm of allPerms.filter((p) =>
    ['task.create', 'task.update', 'expense.create'].includes(p.code),
  )) {
    await prisma.rolePermission.create({
      data: { roleId: memberRole.id, permissionId: perm.id },
    });
  }

  const statusTodo = await prisma.orgTaskStatus.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'To Do',
      slug: 'todo',
      sortOrder: 0,
      isDefault: true,
      color: '#6B7280',
    },
  });
  const statusDoing = await prisma.orgTaskStatus.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'In Progress',
      slug: 'in_progress',
      sortOrder: 1,
      color: '#3B82F6',
    },
  });
  const statusReview = await prisma.orgTaskStatus.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'In Review',
      slug: 'in_review',
      sortOrder: 2,
      color: '#F59E0B',
    },
  });
  const statusDone = await prisma.orgTaskStatus.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Done',
      slug: 'done',
      sortOrder: 3,
      isDone: true,
      color: '#10B981',
    },
  });

  const priorityHigh = await prisma.orgTaskPriority.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'High',
      slug: 'high',
      sortOrder: 1,
      color: '#F59E0B',
    },
  });
  const priorityNormal = await prisma.orgTaskPriority.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Normal',
      slug: 'normal',
      sortOrder: 2,
      isDefault: true,
      color: '#6B7280',
    },
  });
  await prisma.orgTaskPriority.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Urgent',
      slug: 'urgent',
      sortOrder: 0,
      color: '#EF4444',
    },
  });
  await prisma.orgTaskPriority.create({
    data: {
      organizationId: IDS.cloveOrg,
      name: 'Low',
      slug: 'low',
      sortOrder: 3,
      color: '#3B82F6',
    },
  });

  const defaultTags = [
    { name: 'Frontend', slug: 'frontend', color: '#3B82F6', sortOrder: 0, isDefault: true },
    { name: 'Backend', slug: 'backend', color: '#8B5CF6', sortOrder: 1, isDefault: false },
    { name: 'Design', slug: 'design', color: '#EC4899', sortOrder: 2, isDefault: false },
    { name: 'Mobile', slug: 'mobile', color: '#14B8A6', sortOrder: 3, isDefault: false },
    { name: 'QA', slug: 'qa', color: '#F59E0B', sortOrder: 4, isDefault: false },
    { name: 'DevOps', slug: 'devops', color: '#64748B', sortOrder: 5, isDefault: false },
  ];
  for (const tag of defaultTags) {
    await prisma.orgTaskTag.create({
      data: { organizationId: IDS.cloveOrg, ...tag },
    });
  }

  const users: Array<{
    id: string;
    name: string;
    email: string;
    title: string;
    roleId: string;
    managerId?: string;
  }> = [
    {
      id: IDS.admin,
      name: 'Jyotheeswar Reddy',
      email: 'ajyotheeswarreddy@gmail.com',
      title: 'Organization Admin',
      roleId: adminRole.id,
    },
    {
      id: IDS.kiran,
      name: 'Kiran',
      email: 'kiran@clove.team',
      title: 'Engineering Manager',
      roleId: managerRole.id,
    },
    {
      id: IDS.sowith,
      name: 'Sowith',
      email: 'sowith@clove.team',
      title: 'Product Manager',
      roleId: managerRole.id,
    },
    {
      id: IDS.tharun,
      name: 'Tharun',
      email: 'tharun@clove.team',
      title: 'Backend Engineer',
      roleId: memberRole.id,
      managerId: IDS.kiran,
    },
    {
      id: IDS.reddy,
      name: 'Reddy',
      email: 'reddy@clove.team',
      title: 'Frontend Engineer',
      roleId: memberRole.id,
      managerId: IDS.kiran,
    },
    {
      id: IDS.sai,
      name: 'Sai',
      email: 'sai@clove.team',
      title: 'QA Engineer',
      roleId: memberRole.id,
      managerId: IDS.kiran,
    },
    {
      id: IDS.subbu,
      name: 'Subbu',
      email: 'subbu@clove.team',
      title: 'Designer',
      roleId: memberRole.id,
      managerId: IDS.sowith,
    },
  ];

  for (const u of users) {
    await prisma.user.create({
      data: {
        id: u.id,
        organizationId: IDS.cloveOrg,
        name: u.name,
        email: u.email.toLowerCase(),
        title: u.title,
        managerId: u.managerId,
        passwordHash,
        roles: { create: { roleId: u.roleId } },
      },
    });
  }

  const s = soon();
  const meetings = [
    {
      id: 'm_standup',
      title: 'Clove Daily Standup',
      start: s,
      end: new Date(s.getTime() + 15 * 60 * 1000),
      attendeeIds: [IDS.kiran, IDS.tharun, IDS.reddy, IDS.sai],
      location: 'Google Meet',
      notes: 'Kiran team blockers and plans.',
      recurrence: 'daily',
      weekdays: [] as number[],
    },
    {
      id: 'm_design',
      title: 'Design Sync',
      start: new Date(s.getTime() + 2 * 60 * 60 * 1000),
      end: new Date(s.getTime() + 3 * 60 * 60 * 1000),
      attendeeIds: [IDS.sowith, IDS.subbu],
      location: 'Meeting Room 1',
      notes: 'Review Subbu mockups.',
      recurrence: 'weekly',
      // Dart weekdays: 2=Tue, 4=Thu
      weekdays: [2, 4],
    },
    {
      id: 'm_leadership',
      title: 'Leadership Check-in',
      start: at(1, 11),
      end: at(1, 11, 30),
      attendeeIds: [IDS.admin, IDS.kiran, IDS.sowith],
      location: 'Zoom',
      notes: 'Weekly org pulse.',
      recurrence: 'weekly',
      // 5=Fri
      weekdays: [5],
    },
  ];

  for (const m of meetings) {
    await prisma.meeting.create({
      data: {
        id: m.id,
        organizationId: IDS.cloveOrg,
        title: m.title,
        start: m.start,
        end: m.end,
        location: m.location,
        notes: m.notes,
        recurrence: m.recurrence,
        weekdays: m.weekdays,
        attendees: { create: m.attendeeIds.map((userId) => ({ userId })) },
      },
    });
  }

  const tasks = [
    {
      id: 't_api',
      title: 'Finish auth refresh endpoint',
      description: 'Validate refresh rotation and inactive-org checks.',
      statusId: statusDoing.id,
      priorityId: priorityHigh.id,
      dueDate: at(0, 17),
      assigneeId: IDS.tharun,
      tags: ['backend'],
      createdAt: at(-2, 10),
      checklist: [
        { id: 'c_api_1', label: 'Write unit tests', done: true },
        { id: 'c_api_2', label: 'Update Swagger notes' },
      ],
    },
    {
      id: 't_ui',
      title: 'Polish team roster cards',
      description: 'Show manager name under each member.',
      statusId: statusReview.id,
      priorityId: priorityNormal.id,
      dueDate: at(0, 16),
      assigneeId: IDS.reddy,
      tags: ['frontend'],
      createdAt: at(-1, 11),
    },
    {
      id: 't_qa',
      title: 'Regression pass on expenses',
      description: 'Cover submit → approve → reimburse path.',
      statusId: statusTodo.id,
      priorityId: priorityHigh.id,
      dueDate: at(1, 17),
      assigneeId: IDS.sai,
      tags: ['qa'],
      createdAt: at(-1, 9),
    },
    {
      id: 't_mgr_kiran',
      title: 'Plan sprint board for Kiran team',
      description: 'Prioritize Tharun / Reddy / Sai capacity.',
      statusId: statusDoing.id,
      priorityId: priorityNormal.id,
      dueDate: at(0, 18),
      assigneeId: IDS.kiran,
      tags: ['planning'],
      createdAt: at(-3, 9),
    },
    {
      id: 't_design',
      title: 'Expense empty-state illustrations',
      description: 'Two light-mode frames for Subbu review with Sowith.',
      statusId: statusDoing.id,
      priorityId: priorityNormal.id,
      dueDate: at(1, 15),
      assigneeId: IDS.subbu,
      tags: ['design'],
      createdAt: at(-2, 14),
    },
    {
      id: 't_sowith',
      title: 'Product roadmap outline',
      description: 'Next two releases for Clove.',
      statusId: statusTodo.id,
      priorityId: priorityHigh.id,
      dueDate: at(2, 17),
      assigneeId: IDS.sowith,
      tags: ['product'],
      createdAt: at(-1, 10),
    },
    {
      id: 't_admin',
      title: 'Review org permissions matrix',
      description: 'Confirm Manager has Create users enabled.',
      statusId: statusDone.id,
      priorityId: priorityNormal.id,
      dueDate: at(-1, 17),
      assigneeId: IDS.admin,
      tags: ['admin'],
      createdAt: at(-4, 10),
    },
  ];

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        id: t.id,
        organizationId: IDS.cloveOrg,
        title: t.title,
        description: t.description,
        statusId: t.statusId,
        priorityId: t.priorityId,
        dueDate: t.dueDate,
        assigneeId: t.assigneeId,
        tags: t.tags,
        createdAt: t.createdAt,
        checklist: t.checklist
          ? {
              create: t.checklist.map((c, i) => ({
                id: c.id,
                label: c.label,
                done: c.done ?? false,
                sortOrder: i,
              })),
            }
          : undefined,
      },
    });
  }

  const expenses = [
    {
      id: 'e_lunch',
      amount: 850,
      category: ExpenseCategory.MEALS,
      date: day(-1),
      merchant: 'Third Wave Coffee',
      notes: 'Team lunch after standup.',
      status: ExpenseStatus.SUBMITTED,
      submitterId: IDS.tharun,
      createdAt: at(-1, 13),
    },
    {
      id: 'e_cab',
      amount: 420,
      category: ExpenseCategory.TRAVEL,
      date: day(-1),
      merchant: 'Uber',
      notes: 'Client office visit.',
      status: ExpenseStatus.SUBMITTED,
      submitterId: IDS.sai,
      createdAt: at(-1, 19),
    },
    {
      id: 'e_figma',
      amount: 1500,
      category: ExpenseCategory.SOFTWARE,
      date: day(-5),
      merchant: 'Figma',
      notes: 'Design seat.',
      status: ExpenseStatus.APPROVED,
      submitterId: IDS.subbu,
      createdAt: at(-5, 11),
      decidedAt: at(-4, 10),
      decidedById: IDS.sowith,
    },
    {
      id: 'e_supplies',
      amount: 2200,
      category: ExpenseCategory.SUPPLIES,
      date: day(-3),
      merchant: 'Amazon',
      notes: 'Desk accessories.',
      status: ExpenseStatus.DRAFT,
      submitterId: IDS.reddy,
      createdAt: at(-3, 16),
    },
    {
      id: 'e_reimb',
      amount: 600,
      category: ExpenseCategory.TRAVEL,
      date: day(-10),
      merchant: 'Metro Card',
      notes: '',
      status: ExpenseStatus.REIMBURSED,
      submitterId: IDS.tharun,
      createdAt: at(-10, 9),
      decidedAt: at(-9, 11),
      decidedById: IDS.kiran,
      reimbursedAt: day(-7),
    },
  ];

  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        id: e.id,
        organizationId: IDS.cloveOrg,
        amount: e.amount,
        category: e.category,
        date: e.date,
        merchant: e.merchant,
        notes: e.notes,
        status: e.status,
        submitterId: e.submitterId,
        createdAt: e.createdAt,
        decidedAt: e.decidedAt,
        decidedById: e.decidedById,
        reimbursedAt: e.reimbursedAt,
      },
    });
  }

  const activity = [
    {
      id: 'a1',
      actorId: IDS.tharun,
      type: ActivityType.EXPENSE_SUBMITTED,
      subject: 'Third Wave Coffee',
      amount: 850,
      at: at(-1, 13),
      targetId: 'e_lunch',
    },
    {
      id: 'a2',
      actorId: IDS.sai,
      type: ActivityType.EXPENSE_SUBMITTED,
      subject: 'Uber',
      amount: 420,
      at: at(-1, 19),
      targetId: 'e_cab',
    },
    {
      id: 'a3',
      actorId: IDS.sowith,
      type: ActivityType.EXPENSE_APPROVED,
      subject: 'Figma',
      amount: 1500,
      at: at(-4, 10),
      targetId: 'e_figma',
    },
    {
      id: 'a4',
      actorId: IDS.reddy,
      type: ActivityType.TASK_MOVED,
      subject: 'Polish team roster cards',
      at: at(0, 10, 15),
      targetId: 't_ui',
    },
    {
      id: 'a5',
      actorId: IDS.admin,
      type: ActivityType.TASK_COMPLETED,
      subject: 'Review org permissions matrix',
      at: at(-1, 16),
      targetId: 't_admin',
    },
  ];

  for (const a of activity) {
    await prisma.activityEvent.create({
      data: {
        id: a.id,
        organizationId: IDS.cloveOrg,
        actorId: a.actorId,
        type: a.type,
        subject: a.subject,
        amount: a.amount,
        at: a.at,
        targetId: a.targetId,
      },
    });
  }

  console.log('Clove seed complete.');
  console.log('Password for all users:', SEED_PASSWORD);
  console.log('');
  console.log('Super Admin: superadmin@huddle.app');
  console.log('Org: Clove');
  console.log('Admin:   ajyotheeswarreddy@gmail.com (Jyotheeswar Reddy)');
  console.log('Manager: kiran@clove.team  → members tharun, reddy, sai');
  console.log('Manager: sowith@clove.team → member subbu');
  console.log('Members: tharun@clove.team, reddy@clove.team, sai@clove.team, subbu@clove.team');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
