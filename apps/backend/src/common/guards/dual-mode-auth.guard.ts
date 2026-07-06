import { Injectable, ExecutionContext, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../better-auth/auth.config';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class DualModeAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    // 1. Try Better Auth session (profile attached via customSession plugin, cached by cookieCache)
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers }).catch(() => null);

    const sessionUser = session?.user as { profile?: unknown } | undefined;
    if (sessionUser?.profile) {
      const profile = sessionUser.profile as { id?: string };
      request.user = { ...profile, userId: profile.id, betterAuthSession: session };
      return true;
    }

    // 2. Try legacy JWT
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env['JWT_SECRET'],
        });
        const user = await this.prisma.userProfile.findUnique({
          where: { id: payload.sub },
        });
        if (user) {
          request.user = { ...user, userId: user.id };
          return true;
        }
      } catch {
        // Invalid token — continue
      }
    }

    // 3. Public routes: allow through
    if (isPublic) return true;

    return false;
  }
}
