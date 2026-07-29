import { PrismaClient, UserRole, TaskStatus, TaskPriority, ExpenseStatus, ExpenseCategory, ActivityType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'Huddle@123';

const IDS = {
  org: 'org_huddle',
  you: 'u_you',
  aisha: 'u_aisha',
  rahul: 'u_rahul',
  priya: 'u_priya',
};

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

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // Wipe pilot data in dependency order for idempotent re-seed
  await prisma.auditLog.deleteMany({ where: { organizationId: IDS.org } });
  await prisma.activityEvent.deleteMany({ where: { organizationId: IDS.org } });
  await prisma.taskComment.deleteMany({
    where: { task: { organizationId: IDS.org } },
  });
  await prisma.taskChecklistItem.deleteMany({
    where: { task: { organizationId: IDS.org } },
  });
  await prisma.meetingAttendee.deleteMany({
    where: { meeting: { organizationId: IDS.org } },
  });
  await prisma.refreshToken.deleteMany({
    where: { user: { organizationId: IDS.org } },
  });
  await prisma.expense.deleteMany({ where: { organizationId: IDS.org } });
  await prisma.task.deleteMany({ where: { organizationId: IDS.org } });
  await prisma.meeting.deleteMany({ where: { organizationId: IDS.org } });
  await prisma.user.deleteMany({ where: { organizationId: IDS.org } });
  await prisma.organization.deleteMany({ where: { id: IDS.org } });

  await prisma.organization.create({
    data: {
      id: IDS.org,
      name: 'Huddle',
      slug: 'huddle',
    },
  });

  const users = [
    {
      id: IDS.you,
      name: 'Ajyothee Reddy',
      email: 'ajyotheeswarreddy@gmail.com',
      role: UserRole.MANAGER,
      title: 'Engineering Manager',
    },
    {
      id: IDS.aisha,
      name: 'Aisha Khan',
      email: 'aisha@huddle.team',
      role: UserRole.MEMBER,
      title: 'Product Designer',
    },
    {
      id: IDS.rahul,
      name: 'Rahul Menon',
      email: 'rahul@huddle.team',
      role: UserRole.MEMBER,
      title: 'Backend Engineer',
    },
    {
      id: IDS.priya,
      name: 'Priya Nair',
      email: 'priya@huddle.team',
      role: UserRole.MEMBER,
      title: 'Mobile Engineer',
    },
  ];

  for (const u of users) {
    await prisma.user.create({
      data: {
        id: u.id,
        organizationId: IDS.org,
        name: u.name,
        email: u.email.toLowerCase(),
        role: u.role,
        title: u.title,
        passwordHash,
      },
    });
  }

  const s = soon();

  const meetings = [
    {
      id: 'm_standup',
      title: 'Daily Standup',
      start: s,
      end: new Date(s.getTime() + 15 * 60 * 1000),
      attendeeIds: [IDS.you, IDS.aisha, IDS.rahul],
      location: 'Google Meet',
      notes: 'Blockers, yesterday, today. Keep it to 15.',
    },
    {
      id: 'm_design',
      title: 'Design Review — Expense Flow',
      start: new Date(s.getTime() + 2 * 60 * 60 * 1000),
      end: new Date(s.getTime() + 3 * 60 * 60 * 1000),
      attendeeIds: [IDS.you, IDS.aisha, IDS.priya],
      location: 'Meeting Room 2',
      notes: 'Walk through the receipt capture screens end to end.',
    },
    {
      id: 'm_1on1',
      title: '1:1 with Rahul',
      start: at(1, 11, 30),
      end: at(1, 12),
      attendeeIds: [IDS.you, IDS.rahul],
      location: 'Zoom',
      notes: 'Career growth, Q3 goals.',
    },
    {
      id: 'm_sprint',
      title: 'Sprint Planning',
      start: at(2, 10),
      end: at(2, 11, 30),
      attendeeIds: [IDS.you, IDS.aisha, IDS.rahul, IDS.priya],
      location: 'Meeting Room 1',
      notes: 'Groom the backlog and size the next two weeks.',
    },
    {
      id: 'm_client',
      title: 'Client Sync — Northwind',
      start: at(3, 15),
      end: at(3, 16),
      attendeeIds: [IDS.you, IDS.rahul],
      location: 'Google Meet',
      notes: '',
    },
  ];

  for (const m of meetings) {
    await prisma.meeting.create({
      data: {
        id: m.id,
        organizationId: IDS.org,
        title: m.title,
        start: m.start,
        end: m.end,
        location: m.location,
        notes: m.notes,
        attendees: {
          create: m.attendeeIds.map((userId) => ({ userId })),
        },
      },
    });
  }

  type SeedTask = {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: Date;
    assigneeId: string;
    tags: string[];
    createdAt: Date;
    checklist?: { id: string; label: string; done?: boolean }[];
    comments?: { id: string; authorId: string; body: string; createdAt: Date }[];
  };

  const tasks: SeedTask[] = [
    {
      id: 't_deck',
      title: 'Finalize Q3 roadmap deck',
      description:
        'Pull the milestone table from the planning doc, tighten the narrative to five slides, and get it in front of leadership before Friday.',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      dueDate: at(0, 17),
      assigneeId: IDS.aisha,
      tags: ['planning', 'q3'],
      createdAt: at(-3, 9),
      checklist: [
        { id: 'c1_deck', label: 'Outline the narrative', done: true },
        { id: 'c2_deck', label: 'Pull milestone table', done: true },
        { id: 'c3_deck', label: 'Design pass on charts' },
        { id: 'c4_deck', label: 'Share for review' },
      ],
      comments: [
        {
          id: 'cm1',
          authorId: IDS.you,
          body: 'Lead with the outcome slide — leadership skims the rest.',
          createdAt: at(-1, 14, 20),
        },
        {
          id: 'cm2',
          authorId: IDS.aisha,
          body: 'Makes sense. Reordering now, should have a draft by 4.',
          createdAt: at(-1, 15, 5),
        },
      ],
    },
    {
      id: 't_pr',
      title: 'Review PR #221 — auth token refresh',
      description:
        'Rahul reworked the refresh interceptor. Check the retry path and that we are not looping on a 401.',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.HIGH,
      dueDate: at(0, 18),
      assigneeId: IDS.you,
      tags: ['code-review'],
      createdAt: at(-1, 11),
      checklist: [
        { id: 'c1_pr', label: 'Read the diff', done: true },
        { id: 'c2_pr', label: 'Pull and run locally' },
      ],
    },
    {
      id: 't_invoice',
      title: 'Send Northwind invoice',
      description: 'March retainer. Finance needs it filed before month end.',
      status: TaskStatus.DONE,
      priority: TaskPriority.NORMAL,
      dueDate: at(0, 12),
      assigneeId: IDS.rahul,
      tags: ['finance'],
      createdAt: at(-2, 10),
    },
    {
      id: 't_smartscan',
      title: 'Wire SmartScan receipt parsing',
      description:
        'Hook the receipt upload into the BFF endpoint and show parsed merchant and amount back to the user for confirmation.',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.URGENT,
      dueDate: at(1, 17),
      assigneeId: IDS.priya,
      tags: ['expenses', 'api'],
      createdAt: at(-4, 9, 30),
      checklist: [
        { id: 'c1_ss', label: 'Camera + gallery picker', done: true },
        { id: 'c2_ss', label: 'Upload to BFF' },
        { id: 'c3_ss', label: 'Confirmation sheet' },
      ],
    },
    {
      id: 't_overdue',
      title: 'Update the onboarding runbook',
      description: 'The setup steps drifted after the tooling change.',
      status: TaskStatus.TODO,
      priority: TaskPriority.LOW,
      dueDate: at(-2, 17),
      assigneeId: IDS.rahul,
      tags: ['docs'],
      createdAt: at(-8, 14),
    },
    {
      id: 't_webhook',
      title: 'Set up ClickUp webhook receiver',
      description:
        'Real-time status updates pushed to the BFF so the board does not need polling.',
      status: TaskStatus.TODO,
      priority: TaskPriority.NORMAL,
      dueDate: at(2, 17),
      assigneeId: IDS.rahul,
      tags: ['api', 'infra'],
      createdAt: at(-1, 16),
    },
    {
      id: 't_empty_states',
      title: 'Design empty states for Tasks & Expenses',
      status: TaskStatus.TODO,
      priority: TaskPriority.NORMAL,
      dueDate: at(3, 17),
      assigneeId: IDS.aisha,
      tags: ['design'],
      createdAt: at(-1, 10),
    },
    {
      id: 't_fcm',
      title: 'Meeting reminder notifications (15 min prior)',
      description: 'FCM scheduled push, 15 minutes before a meeting or task due time.',
      status: TaskStatus.TODO,
      priority: TaskPriority.NORMAL,
      dueDate: at(5, 17),
      assigneeId: IDS.priya,
      tags: ['notifications'],
      createdAt: day(-1),
    },
    {
      id: 't_offline',
      title: 'Offline cache for tasks and expenses',
      description: 'Hive boxes for read-only viewing when the network drops.',
      status: TaskStatus.TODO,
      priority: TaskPriority.LOW,
      dueDate: at(7, 17),
      assigneeId: IDS.priya,
      tags: ['offline'],
      createdAt: day(-2),
    },
    {
      id: 't_policy',
      title: 'Category policy limits',
      description: 'Flag expenses over the category cap before submission.',
      status: TaskStatus.DONE,
      priority: TaskPriority.NORMAL,
      dueDate: at(-1, 17),
      assigneeId: IDS.you,
      tags: ['expenses'],
      createdAt: day(-5),
    },
  ];

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        id: t.id,
        organizationId: IDS.org,
        title: t.title,
        description: t.description ?? '',
        status: t.status,
        priority: t.priority,
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
        comments: t.comments
          ? {
              create: t.comments.map((c) => ({
                id: c.id,
                authorId: c.authorId,
                body: c.body,
                createdAt: c.createdAt,
              })),
            }
          : undefined,
      },
    });
  }

  const expenses = [
    {
      id: 'e_lunch',
      amount: 1200,
      category: ExpenseCategory.CLIENT,
      date: day(-1),
      merchant: 'Toit Brewpub',
      notes: 'Lunch with the Northwind team after the quarterly review.',
      status: ExpenseStatus.SUBMITTED,
      submitterId: IDS.rahul,
      createdAt: at(-1, 14),
    },
    {
      id: 'e_taxi',
      amount: 450,
      category: ExpenseCategory.TRAVEL,
      date: day(-1),
      merchant: 'Uber',
      notes: 'Airport drop for the client visit.',
      status: ExpenseStatus.SUBMITTED,
      submitterId: IDS.aisha,
      createdAt: at(-1, 19),
    },
    {
      id: 'e_figma',
      amount: 1350,
      category: ExpenseCategory.SOFTWARE,
      date: day(-4),
      merchant: 'Figma',
      notes: 'Monthly seat for the design system work.',
      status: ExpenseStatus.APPROVED,
      submitterId: IDS.aisha,
      createdAt: at(-4, 11),
      decidedAt: at(-3, 9),
      decidedById: IDS.you,
    },
    {
      id: 'e_hotel',
      amount: 6800,
      category: ExpenseCategory.ACCOMMODATION,
      date: day(-12),
      merchant: 'Ibis Bengaluru',
      notes: 'Two nights for the onsite.',
      status: ExpenseStatus.REIMBURSED,
      submitterId: IDS.rahul,
      createdAt: at(-12, 20),
      decidedAt: at(-10, 10),
      decidedById: IDS.you,
      reimbursedAt: day(-6),
    },
    {
      id: 'e_coffee',
      amount: 320,
      category: ExpenseCategory.MEALS,
      date: day(0),
      merchant: 'Third Wave Coffee',
      notes: 'Team coffee after standup.',
      status: ExpenseStatus.DRAFT,
      submitterId: IDS.you,
      createdAt: at(0, 9, 40),
    },
    {
      id: 'e_monitor',
      amount: 14500,
      category: ExpenseCategory.SUPPLIES,
      date: day(-8),
      merchant: 'Croma',
      notes: 'Second monitor for the new desk setup.',
      status: ExpenseStatus.REJECTED,
      submitterId: IDS.priya,
      createdAt: at(-8, 17),
      decidedAt: at(-7, 11),
      decidedById: IDS.you,
      decisionNote:
        'Over the supplies cap — please raise a hardware request instead so it comes out of the equipment budget.',
    },
    {
      id: 'e_parking',
      amount: 180,
      category: ExpenseCategory.TRAVEL,
      date: day(-2),
      merchant: 'Phoenix Mall Parking',
      notes: '',
      status: ExpenseStatus.REIMBURSED,
      submitterId: IDS.priya,
      createdAt: at(-2, 18),
      decidedAt: at(-2, 20),
      decidedById: IDS.you,
      reimbursedAt: day(-1),
    },
  ];

  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        id: e.id,
        organizationId: IDS.org,
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
        decisionNote: e.decisionNote ?? '',
        reimbursedAt: e.reimbursedAt,
      },
    });
  }

  const activity = [
    {
      id: 'a1',
      actorId: IDS.rahul,
      type: ActivityType.EXPENSE_SUBMITTED,
      subject: 'Toit Brewpub',
      amount: 1200,
      at: at(-1, 14),
      targetId: 'e_lunch',
    },
    {
      id: 'a2',
      actorId: IDS.aisha,
      type: ActivityType.EXPENSE_SUBMITTED,
      subject: 'Uber',
      amount: 450,
      at: at(-1, 19),
      targetId: 'e_taxi',
    },
    {
      id: 'a3',
      actorId: IDS.rahul,
      type: ActivityType.TASK_COMPLETED,
      subject: 'Send Northwind invoice',
      at: at(0, 11, 45),
      targetId: 't_invoice',
    },
    {
      id: 'a4',
      actorId: IDS.aisha,
      type: ActivityType.TASK_COMMENTED,
      subject: 'Finalize Q3 roadmap deck',
      at: at(-1, 15, 5),
      targetId: 't_deck',
    },
    {
      id: 'a5',
      actorId: IDS.you,
      type: ActivityType.EXPENSE_REJECTED,
      subject: 'Croma',
      amount: 14500,
      at: at(-7, 11),
      targetId: 'e_monitor',
    },
    {
      id: 'a6',
      actorId: IDS.you,
      type: ActivityType.TASK_COMPLETED,
      subject: 'Category policy limits',
      at: at(-1, 16, 30),
      targetId: 't_policy',
    },
    {
      id: 'a7',
      actorId: IDS.priya,
      type: ActivityType.TASK_MOVED,
      subject: 'Wire SmartScan receipt parsing',
      at: at(0, 10, 15),
      targetId: 't_smartscan',
    },
    {
      id: 'a8',
      actorId: IDS.you,
      type: ActivityType.EXPENSE_APPROVED,
      subject: 'Figma',
      amount: 1350,
      at: at(-3, 9),
      targetId: 'e_figma',
    },
  ];

  for (const a of activity) {
    await prisma.activityEvent.create({
      data: {
        id: a.id,
        organizationId: IDS.org,
        actorId: a.actorId,
        type: a.type,
        subject: a.subject,
        amount: a.amount,
        at: a.at,
        targetId: a.targetId,
      },
    });
  }

  console.log('Huddle seed complete.');
  console.log('Pilot password for all users:', SEED_PASSWORD);
  console.log('Manager:', 'ajyotheeswarreddy@gmail.com');
  console.log('Members: aisha@huddle.team, rahul@huddle.team, priya@huddle.team');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
