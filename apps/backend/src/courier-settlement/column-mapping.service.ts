// ── Provider-scoped column mapping (§12).
//
// Safety rules (frozen): a manual mapping is stored as a CANDIDATE
// (active=false) and only becomes effective after an explicit, audited
// "always use this mapping". Two active columns claiming the same canonical
// field ⇒ ambiguity: both stay/become inactive, the conflict is surfaced, and
// the parser applies nothing (fail-closed) — an ambiguous mapping can never
// propagate silently, and a mapping never changes format detection.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CourierSettlementAliasOrigin } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CourierSettlementActivityService } from './activity.service';
import { getDescriptor } from './parsing/descriptors';
import type { ParseAlias } from './parsing/invoice-parser.service';

/** Canonical fields an operator may map a source column onto. */
export const MAPPABLE_FIELDS = [
  'consignmentId',
  'displayId',
  'trackingCode',
  'orderId',
  'collected',
  'charges',
  'net',
  'collectable',
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];

const FIELD_LABELS: Record<string, string> = {
  consignmentId: 'Consignment / tracking ID',
  displayId: 'Order number',
  trackingCode: 'Tracking code',
  orderId: 'Order ID',
  collected: 'Collected amount (gross COD)',
  charges: 'Courier charges',
  net: 'Net settlement (payout)',
  collectable: 'Collectable amount',
};

export interface MappingDto {
  courier: string;
  sourceHeader: string;
  field: string;
  /** explicit "always use this mapping" ⇒ active immediately (audited) */
  alwaysUse?: boolean;
  reason?: string;
  /** optional invoice the mapping was authored from (audit trail) */
  invoiceId?: string;
}

@Injectable()
export class CourierSettlementMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CourierSettlementActivityService,
  ) {}

  async list(courier?: string) {
    const aliases = await this.prisma.courierSettlementColumnAlias.findMany({
      where: courier ? { courier } : {},
      orderBy: [{ courier: 'asc' }, { sourceHeader: 'asc' }],
    });
    const conflicts = this.findConflicts(aliases);
    return {
      data: aliases.map((a) => ({
        ...a,
        confidence: Number(a.confidence),
        fieldLabel: FIELD_LABELS[a.field] ?? a.field,
        conflict: conflicts.has(a.id),
      })),
      fields: MAPPABLE_FIELDS.map((f) => ({ field: f, label: FIELD_LABELS[f] })),
      total: aliases.length,
    };
  }

  /** Candidate mapping (active=false) unless `alwaysUse` explicitly declares it. */
  async propose(dto: MappingDto, actor?: string | null) {
    this.validate(dto);
    const existing = await this.prisma.courierSettlementColumnAlias.findUnique({
      where: { courier_sourceHeader: { courier: dto.courier, sourceHeader: dto.sourceHeader } },
    });

    // Competing active columns for the same field ⇒ ambiguity, fail closed.
    const rivals = await this.prisma.courierSettlementColumnAlias.findMany({
      where: { courier: dto.courier, field: dto.field, active: true },
    });
    const rival = rivals.find((r) => r.sourceHeader !== dto.sourceHeader);
    if (rival && dto.alwaysUse) {
      throw new ConflictException(
        `"${rival.sourceHeader}" is already mapped to ${FIELD_LABELS[dto.field]} for this courier. ` +
          'Disable it first, then confirm this mapping — two columns can never claim the same field.',
      );
    }

    if (existing) {
      const updated = await this.prisma.courierSettlementColumnAlias.update({
        where: { id: existing.id },
        data: {
          field: dto.field,
          normalizedHeader: normalizeHeader(dto.sourceHeader),
          active: rival ? false : dto.alwaysUse === true,
          confidence: rival ? 0.4 : dto.alwaysUse ? 1.0 : 0.6,
          origin: CourierSettlementAliasOrigin.MANUAL,
          createdBy: actor ?? existing.createdBy,
          ambiguityCount: rival ? { increment: 1 } : existing.ambiguityCount,
        },
      });
      await this.audit(dto, actor, 'updated', updated.active);
      return { ...updated, confidence: Number(updated.confidence) };
    }

    const created = await this.prisma.courierSettlementColumnAlias.create({
      data: {
        courier: dto.courier,
        sourceHeader: dto.sourceHeader,
        normalizedHeader: normalizeHeader(dto.sourceHeader),
        field: dto.field,
        confidence: rival ? 0.4 : dto.alwaysUse ? 1.0 : 0.6,
        origin: CourierSettlementAliasOrigin.MANUAL,
        active: !rival && dto.alwaysUse === true,
        ambiguityCount: rival ? 1 : 0,
        createdBy: actor ?? null,
      },
    });
    await this.audit(dto, actor, 'created', created.active);
    return { ...created, confidence: Number(created.confidence) };
  }

  /** Explicit confirmation: this column IS this field for this courier. */
  async activate(id: string, dto: { reason?: string; invoiceId?: string }, actor?: string | null) {
    const alias = await this.prisma.courierSettlementColumnAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException('Mapping not found');

    const rival = await this.prisma.courierSettlementColumnAlias.findFirst({
      where: {
        courier: alias.courier,
        field: alias.field,
        active: true,
        sourceHeader: { not: alias.sourceHeader },
      },
    });
    if (rival) {
      throw new ConflictException(
        `"${rival.sourceHeader}" already claims this field for ${alias.courier}. Deactivate it first.`,
      );
    }

    const updated = await this.prisma.courierSettlementColumnAlias.update({
      where: { id },
      data: { active: true, confidence: 1.0, lastUsedAt: new Date() },
    });
    if (dto.invoiceId) {
      await this.activity.record({
        invoiceId: dto.invoiceId,
        action: 'MAPPED',
        actor: actor ?? null,
        detail: {
          courier: alias.courier,
          sourceHeader: alias.sourceHeader,
          field: alias.field,
          reason: dto.reason ?? null,
          before: { active: alias.active },
          after: { active: true },
        },
        dedupeKey: `map:${alias.sourceHeader}:${alias.field}`,
      });
    }
    return { ...updated, confidence: Number(updated.confidence) };
  }

  async deactivate(id: string, dto: { reason?: string; invoiceId?: string }, actor?: string | null) {
    const alias = await this.prisma.courierSettlementColumnAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException('Mapping not found');
    const updated = await this.prisma.courierSettlementColumnAlias.update({
      where: { id },
      data: { active: false },
    });
    if (dto.invoiceId) {
      await this.activity.record({
        invoiceId: dto.invoiceId,
        action: 'MAPPED',
        actor: actor ?? null,
        detail: {
          courier: alias.courier,
          sourceHeader: alias.sourceHeader,
          field: alias.field,
          reason: dto.reason ?? null,
          before: { active: alias.active },
          after: { active: false },
        },
        dedupeKey: `unmap:${alias.sourceHeader}:${alias.field}:${Date.now()}`,
      });
    }
    return { ...updated, confidence: Number(updated.confidence) };
  }

  /** Active aliases replayed into the parser for a given provider. */
  async activeFor(courier: string): Promise<ParseAlias[]> {
    return this.prisma.courierSettlementColumnAlias.findMany({
      where: { courier, active: true },
      select: { courier: true, sourceHeader: true, field: true, active: true },
      take: 100,
    });
  }

  private validate(dto: MappingDto) {
    if (!dto.courier) throw new BadRequestException('courier is required');
    if (!dto.sourceHeader?.trim()) throw new BadRequestException('sourceHeader is required');
    if (!(MAPPABLE_FIELDS as readonly string[]).includes(dto.field)) {
      throw new BadRequestException(
        `field must be one of: ${MAPPABLE_FIELDS.join(', ')}`,
      );
    }
    try {
      getDescriptor(dto.courier as never);
    } catch {
      throw new BadRequestException(
        `Unsupported courier "${dto.courier}". Supported: pathao, steadfast, redx, carrybee.`,
      );
    }
    // The descriptor must actually have a slot for this field, otherwise the
    // mapping could never be applied (fail loudly instead of silently ignoring).
    const desc = getDescriptor(dto.courier as never);
    const hasSlot =
      desc.columns.some(
        (c) =>
          c.field === dto.field ||
          (dto.field === 'consignmentId' && c.kind === 'consignment') ||
          (dto.field === 'displayId' && c.kind === 'order') ||
          (dto.field === 'trackingCode' && c.kind === 'tracking') ||
          (dto.field === 'orderId' && c.kind === 'order'),
      ) ||
      (dto.field === 'collected' && !!desc.collectedHeader) ||
      (dto.field === 'net' && !!desc.netHeader) ||
      (dto.field === 'charges' && !!desc.chargesHeader) ||
      (dto.field === 'collectable' && !!desc.collectableHeader);
    if (!hasSlot) {
      throw new BadRequestException(
        `${desc.provider} has no ${FIELD_LABELS[dto.field]} slot — this column cannot be mapped.`,
      );
    }
  }

  /**
   * A conflict is two ACTIVE columns claiming the same field for the same
   * courier — a candidate next to an active one is normal (it is simply not
   * activatable while the rival is live, which `activate()` refuses anyway).
   */
  private findConflicts(aliases: {
    id: string;
    courier: string;
    field: string;
    active: boolean;
  }[]): Set<string> {
    const conflicts = new Set<string>();
    const byKey = new Map<string, { id: string; active: boolean }[]>();
    for (const a of aliases) {
      const key = `${a.courier}:${a.field}`;
      byKey.set(key, [...(byKey.get(key) ?? []), { id: a.id, active: a.active }]);
    }
    for (const entries of byKey.values()) {
      const actives = entries.filter((e) => e.active);
      if (actives.length > 1) actives.forEach((e) => conflicts.add(e.id));
    }
    return conflicts;
  }

  private async audit(
    dto: MappingDto,
    actor: string | null | undefined,
    change: 'created' | 'updated',
    active: boolean,
  ) {
    if (!dto.invoiceId) return;
    await this.activity.record({
      invoiceId: dto.invoiceId,
      action: 'MAPPED',
      actor: actor ?? null,
      detail: {
        change,
        courier: dto.courier,
        sourceHeader: dto.sourceHeader,
        field: dto.field,
        reason: dto.reason ?? null,
        after: { active },
      },
      dedupeKey: `map:${dto.sourceHeader}:${dto.field}:${change}`,
    });
  }
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}
