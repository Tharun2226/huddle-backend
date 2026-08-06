export class AuthUser {
  id!: string;
  email!: string;
  name!: string;
  title!: string;
  organizationId!: string;
  permissions!: string[];
  isAdmin!: boolean;
  isSuperAdmin!: boolean;
  roleNames!: string[];
}

export class JwtPayload {
  sub!: string;
  email!: string;
  organizationId!: string;
  permissions!: string[];
  isAdmin!: boolean;
  isSuperAdmin!: boolean;
  /** Embedded so every request avoids a heavy roles/permissions join. */
  roleNames!: string[];
  name?: string;
  title?: string;
}
