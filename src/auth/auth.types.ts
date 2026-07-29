import { UserRole } from '@prisma/client';

export class AuthUser {
  id!: string;
  email!: string;
  name!: string;
  title!: string;
  role!: UserRole;
  organizationId!: string;
}

export class JwtPayload {
  sub!: string;
  email!: string;
  role!: UserRole;
  organizationId!: string;
}
