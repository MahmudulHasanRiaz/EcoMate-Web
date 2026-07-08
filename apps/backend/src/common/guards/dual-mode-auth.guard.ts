import { Injectable, ExecutionContext, Inject, UnauthorizedException } from '@nestjs/common';
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

    // 1. Try legacy JWT first if Authorization header is present
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

    // 2. Try Better Auth session (role/permissions attached directly to user by customSession plugin)
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers }).catch(() => null);

    const sessionUser = session?.user;
    if (sessionUser) {
      request.user = { ...sessionUser, userId: sessionUser.id, betterAuthSession: session };
      return true;
    }

    // 3. Public routes: allow through
    if (isPublic) return true;

    // 401 so admin panel auto-refresh can detect and re-try with new token
    throw new UnauthorizedException('Authentication required');
  }
}
