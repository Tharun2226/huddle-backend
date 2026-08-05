import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../auth/auth.types';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

export const ADMIN_ONLY_KEY = 'admin_only';
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

export const SUPER_ADMIN_KEY = 'super_admin';
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const superAdminOnly = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPerms = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!superAdminOnly && !adminOnly && !requiredPerms?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    if (user.isSuperAdmin) return true;

    if (superAdminOnly) {
      throw new ForbiddenException('Super admin access required');
    }

    if (adminOnly) {
      if (!user.isAdmin) throw new ForbiddenException('Admin access required');
      return true;
    }

    if (requiredPerms?.length) {
      if (user.isAdmin) return true;
      const has = requiredPerms.every((p) => user.permissions.includes(p));
      if (!has) throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
