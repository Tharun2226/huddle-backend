import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export function hasManagerRole(user: AuthUser) {
  if (user.roleNames.some((name) => {
    const n = name.toLowerCase();
    return n === 'manager' || n.endsWith(' manager');
  })) {
    return true;
  }
  // Fallback when older tokens omit roleNames but still carry manager permissions.
  return (
    !user.isAdmin &&
    (user.permissions.includes('user.invite') ||
      user.permissions.includes('task.assign'))
  );
}

/**
 * User ids visible to this actor for scoped lists.
 * Admins: returns [] — callers MUST use organizationId-only filters when isAdmin.
 * Managers: self + direct reports.
 * Members: self only.
 */
export async function getScopedUserIds(
  prisma: PrismaService,
  user: AuthUser,
): Promise<string[]> {
  // Admins filter by organizationId only — skip a full-org user scan.
  if (user.isAdmin) {
    return [];
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
