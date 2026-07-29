import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export function hasManagerRole(user: AuthUser) {
  return user.roleNames.some((name) => {
    const n = name.toLowerCase();
    return n === 'manager' || n.endsWith(' manager');
  });
}

export async function getScopedUserIds(
  prisma: PrismaService,
  user: AuthUser,
): Promise<string[]> {
  if (user.isAdmin) {
    const users = await prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return users.map((entry) => entry.id);
  }

  if (hasManagerRole(user)) {
    const reports = await prisma.user.findMany({
      where: { organizationId: user.organizationId, managerId: user.id },
      select: { id: true },
    });
    // Managers only see themselves + direct reports — never other managers' teams.
    return [user.id, ...reports.map((entry) => entry.id)];
  }

  return [user.id];
}
