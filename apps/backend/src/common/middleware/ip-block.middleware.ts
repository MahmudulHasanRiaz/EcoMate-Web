import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IpBlockMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IpBlockMiddleware.name);
  private cache: { ips: Map<string, true>; timestamp: number } | null = null;
  private readonly TTL = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    const ip = req.ip || '';
    if (!ip) return next();

    const blocked = await this.isBlocked(ip);
    if (blocked) {
      this.logger.warn(`Full-blocked request from IP: ${ip}`);
      res.status(403).send({
        statusCode: 403,
        message: 'Access denied. Your IP has been blocked.',
      });
      return;
    }

    next();
  }

  invalidateCache() {
    this.cache = null;
  }

  private async isBlocked(ip: string): Promise<boolean> {
    const now = Date.now();
    if (!this.cache || now - this.cache.timestamp > this.TTL) {
      try {
        const entries = await this.prisma.blockedIp.findMany({
          where: {
            isActive: true,
            whitelisted: false,
            blockType: 'full',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { ip: true },
        });
        const ips = new Map<string, true>();
        for (const e of entries) ips.set(e.ip, true);
        this.cache = { ips, timestamp: now };
      } catch (error) {
        this.logger.error(`Failed to fetch blocked IPs, allowing traffic through: ${error instanceof Error ? error.message : error}`);
        this.cache = { ips: new Map(), timestamp: now };
      }
    }
    return this.cache.ips.has(ip);
  }
}
