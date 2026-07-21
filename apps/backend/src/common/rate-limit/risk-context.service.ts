import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TrustTier } from './trust-tier.enum';

export interface RiskContext {
  trustTier: TrustTier;
  identity: string;
  ip: string;
  isWhitelisted: boolean;
  policyName: string;
}

@Injectable()
export class RiskContextService {
  private readonly logger = new Logger(RiskContextService.name);

  async assemble(
    request: FastifyRequest,
    trustTier: TrustTier,
    identity: string,
    policyName: string,
    isWhitelisted: boolean,
  ): Promise<RiskContext> {
    return {
      trustTier,
      identity,
      ip: this.extractIp(request),
      isWhitelisted,
      policyName,
    };
  }

  private extractIp(request: FastifyRequest): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim();
      if (first && first !== 'unknown') return first;
    }
    return request.ip || request.socket.remoteAddress || '0.0.0.0';
  }
}
