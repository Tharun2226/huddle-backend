import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOrg(user: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      title: u.title,
      role: u.role === 'MANAGER' ? 'manager' : 'member',
    }));
  }
}
