/**
 * Runtime sales-channel derivation and entity auto-resolution.
 *
 * Ownership (who is allowed to decide each field):
 *   Channel          — order-creation / integration context
 *   ChannelEntity    — integration / session / staff / store context
 *   Source           — attribution resolver, or explicit manual input
 *   AcquisitionType  — attribution resolver
 *
 * The rule this service enforces: the user is never asked for something the
 * system already knows. POS showroom, the connected website and the staff's
 * office are all resolved from context; a manual order simply leaves the
 * entity NULL when there is no context, and is NEVER blocked for it.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SourcePlatformsService } from './source-platforms.service';
import {
  validateSourceForChannel,
  type SourceCheckResult,
} from './validate-source-for-channel';
import type { AcquisitionType, SalesChannelV2 } from './sales-channel.constants';

export interface CanonicalInput {
  channel?: SalesChannelV2 | null;
  channelEntity?: string | null;
  sourceSlug?: string | null;
  acquisitionType?: AcquisitionType | null;
}

export interface CanonicalWrite extends CanonicalInput {
  channel: SalesChannelV2 | null;
  channelEntity: string | null;
  sourceSlug: string | null;
  acquisitionType: AcquisitionType | null;
  warnings: string[];
}

@Injectable()
export class SalesChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sourcePlatforms: SourcePlatformsService,
  ) {}

  /**
   * Website identity from the connected store config. Falls back to the
   * configured APP_URL host so a deployment always has a real value.
   */
  async resolveWebsiteEntity(): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'storefront_url' },
    });
    const candidate =
      setting?.value ||
      process.env.APP_URL ||
      process.env.STOREFRONT_URL ||
      '';
    const raw = candidate.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      return url.hostname || null;
    } catch {
      return null;
    }
  }

  /** POS showroom name — resolved from session context, never asked of the user. */
  resolvePosEntity(showroomName?: string | null): string | null {
    const v = (showroomName ?? '').trim();
    return v ? v : null;
  }

  /**
   * Office for a phone-call order.
   *
   * There is currently no staff↔office association in the schema: UserProfile
   * has no office field, and `Address` is a customer shipping-address book,
   * not a workplace. Inventing one would fabricate a fact, so this returns
   * NULL and the entity stays unset until an office model exists. A manual
   * phone order remains fully valid without it.
   */
  async resolveOfficeEntity(_userId?: string | null): Promise<string | null> {
    return null;
  }

  /**
   * Finalise a canonical write: auto-fill the entity where context provides
   * one, and clear any source that is invalid or incompatible with the chosen
   * channel — reporting rather than rejecting.
   */
  async resolve(input: CanonicalInput, ctx: {
    showroomName?: string | null;
    staffUserId?: string | null;
  } = {}): Promise<CanonicalWrite> {
    const warnings: string[] = [];
    const channel: SalesChannelV2 | null = input.channel ?? null;

    // Entity: prefer explicit input, else auto-resolve from context.
    let channelEntity = (input.channelEntity ?? '').trim() || null;
    if (!channelEntity) {
      if (channel === 'POS') {
        channelEntity = this.resolvePosEntity(ctx.showroomName);
      } else if (channel === 'WEBSITE') {
        channelEntity = await this.resolveWebsiteEntity();
      } else if (channel === 'PHONE_CALL') {
        channelEntity = await this.resolveOfficeEntity(ctx.staffUserId);
      }
      // MESSAGING resolves from a connected page/account once an Inbox
      // integration exists; until then it stays NULL and never blocks.
    }

    const knownSlugs = await this.sourcePlatforms.slugSet();
    const capabilitiesBySlug = new Map<string, string[]>();
    for (const row of await this.sourcePlatforms.listAll()) {
      capabilitiesBySlug.set(row.slug, row.capabilities);
    }

    const checked: SourceCheckResult = validateSourceForChannel({
      channel,
      sourceSlug: input.sourceSlug,
      knownSlugs,
      capabilitiesBySlug,
    });
    if (!checked.ok) warnings.push(checked.warning);

    // Acquisition is taken as given (resolver/operator supplied). It is NEVER
    // derived from the channel here: POS and PHONE_CALL stay NULL unless real
    // attribution evidence exists.
    const acquisitionType: AcquisitionType | null = input.acquisitionType ?? null;

    return {
      channel,
      channelEntity,
      sourceSlug: checked.sourceSlug,
      acquisitionType,
      warnings,
    };
  }
}
