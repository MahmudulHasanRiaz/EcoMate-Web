import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
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
          if (user.status !== 'active') {
            throw new UnauthorizedException('Account is not active');
          }
          if (user.lockoutUntil && user.lockoutUntil > new Date()) {
            throw new UnauthorizedException('Account is temporarily locked');
          }
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
      const userProfile = await this.prisma.userProfile.findFirst({
        where: { betterAuthUserId: sessionUser.id },
      });

      if (userProfile) {
        // Check account status — prevents deactivated/locked users from accessing API via BA session
        if (userProfile.status !== 'active') {
          throw new UnauthorizedException('Account is not active');
        }
        if (userProfile.lockoutUntil && userProfile.lockoutUntil > new Date()) {
          throw new UnauthorizedException('Account is temporarily locked');
        }
        request.user = {
          ...userProfile,
          userId: userProfile.id,
          permissions: (session.user as any).permissions || [],
          betterAuthSession: session,
        };
      } else {
        // Auto-create UserProfile for social-login / BA-only users
        try {
          const nameParts = (
            sessionUser.name ||
            sessionUser.email ||
            'User'
          ).split(' ');
          const firstName = nameParts[0] || 'User';
          const lastName = nameParts.slice(1).join(' ') || 'User';
          const baseUsername = (sessionUser.email || 'user').split('@')[0];
          let username = baseUsername;
          let counter = 1;
          while (
            await this.prisma.userProfile.findUnique({ where: { username } })
          ) {
            username = `${baseUsername}${counter++}`;
          }

          const newProfile = await this.prisma.userProfile.create({
            data: {
              firstName,
              lastName,
              username,
              email: sessionUser.email || '',
              phoneNumber: '',
              password: '',
              role: (sessionUser as any).role || 'customer',
              emailVerified: sessionUser.emailVerified || false,
              betterAuthUserId: sessionUser.id,
            },
          });

          await this.prisma.userSettings.create({
            data: { userId: newProfile.id },
          });

          request.user = {
            ...newProfile,
            userId: newProfile.id,
            permissions: (session.user as any).permissions || [],
            betterAuthSession: session,
          };
        } catch {
          // Race condition: another concurrent request created the UserProfile first.
          // Retry findFirst to get the existing record.
          const existing = await this.prisma.userProfile.findFirst({
            where: { betterAuthUserId: sessionUser.id },
          });
          if (!existing) {
            throw new UnauthorizedException('Failed to create user profile');
          }
          request.user = {
            ...existing,
            userId: existing.id,
            permissions: (session.user as any).permissions || [],
            betterAuthSession: session,
          };
        }
      }
      return true;
    }

    // 3. Public routes: allow through
    if (isPublic) return true;

    // 401 so admin panel auto-refresh can detect and re-try with new token
    throw new UnauthorizedException('Authentication required');
  }
}
