import { Injectable, Logger } from '@nestjs/common';
import { RateLimitPolicy } from './rate-limit-policy.interface';
import { BlockedEntriesService } from '../../blocked-entries/blocked-entries.service';
import { SecurityEventEmitterService } from '../../security-dashboard/services/security-event-emitter.service';
import { SecurityEventType } from '../../security-dashboard/registries/event-type.registry';
import { SecurityEventSource } from '../../security-dashboard/registries/source.registry';

interface ScoreEntry {
  score: number;
  firstViolation: number;
}

@Injectable()
export class RiskScoreService {
  private readonly logger = new Logger(RiskScoreService.name);
  private scores = new Map<string, ScoreEntry>();

  constructor(
    private readonly blockedEntries: BlockedEntriesService,
    private readonly eventEmitter: SecurityEventEmitterService,
  ) {}

  /**
   * Record a rate limit violation. Returns auto-block triggered.
   * Does NOT immediately auto-block — risk score accumulates.
   * Auto-block only triggers after repeated violations above threshold.
   */
  async recordViolation(
    identity: string,
    ip: string,
    policy: RateLimitPolicy,
    isWhitelisted: boolean,
  ): Promise<{ autoBlocked: boolean; riskScore: number }> {
    if (isWhitelisted) {
      return { autoBlocked: false, riskScore: 0 };
    }

    const now = Date.now();
    const windowMs = policy.limits[policy.name === 'auth' || policy.name === 'checkout' ? 'unknown' : 'unknown']
      ? 60000
      : policy.riskScore.autoBlockThreshold * 60000;
    const entry = this.scores.get(identity) || { score: 0, firstViolation: now };

    if (now - entry.firstViolation > Math.max(windowMs, 300000)) {
      entry.score = 0;
      entry.firstViolation = now;
    }

    entry.score += policy.riskScore.violationWeight;
    this.scores.set(identity, entry);

    // Fire-and-forget: emit risk score violation event
    this.eventEmitter.emit({
      eventType: SecurityEventType.RISK_SCORE_VIOLATION,
      severity: entry.score >= policy.riskScore.autoBlockThreshold ? 'CRITICAL' as any : 'HIGH' as any,
      category: 'RATE_LIMIT' as any,
      source: SecurityEventSource.RISK_SCORE,
      actorType: identity.startsWith('user:') ? ('USER' as any) : identity.startsWith('sess:') ? ('SESSION' as any) : identity.startsWith('bt:') ? ('BROWSER_TRUST' as any) : ('IP' as any),
      ipAddress: ip,
      riskScore: entry.score,
      description: `Risk score ${entry.score}/${policy.riskScore.autoBlockThreshold} for identity ${identity} on policy "${policy.name}"`,
      retentionOverride: false,
    }).catch(() => {});

    if (entry.score >= policy.riskScore.autoBlockThreshold) {
      try {
        const duration = policy.riskScore.autoBlockDurationMinutes;
        await this.blockedEntries.createAutoBlock('ip', ip, 'order', duration);
        this.logger.warn(
          `Risk-score auto-block: IP ${ip}, identity ${identity},` +
          ` policy=${policy.name}, score=${entry.score}` +
          ` threshold=${policy.riskScore.autoBlockThreshold}` +
          ` duration=${duration}m`
        );

        // Fire-and-forget: emit auto-block event
        this.eventEmitter.emit({
          eventType: SecurityEventType.AUTO_BLOCK_CREATED,
          severity: 'CRITICAL' as any,
          category: 'BLOCK' as any,
          source: SecurityEventSource.RISK_SCORE,
          actorType: ('SYSTEM' as any),
          ipAddress: ip,
          description: `Auto-blocked IP ${ip} — risk score ${entry.score} exceeded threshold ${policy.riskScore.autoBlockThreshold} on policy "${policy.name}", duration ${duration}m`,
          riskScore: entry.score,
          metadata: { durationMinutes: duration, policyName: policy.name },
          retentionOverride: true,
        }).catch(() => {});

        this.scores.delete(identity);
        return { autoBlocked: true, riskScore: entry.score };
      } catch (err: any) {
        this.logger.error(`Risk-score auto-block failed: ${err.message}`);
      }
    }

    return { autoBlocked: false, riskScore: entry.score };
  }

  /**
   * Decay risk scores periodically.
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.scores.entries()) {
      if (now - entry.firstViolation > 600000) {
        this.scores.delete(key);
      }
    }
  }
}
