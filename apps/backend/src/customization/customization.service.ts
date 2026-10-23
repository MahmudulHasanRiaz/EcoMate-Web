import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import {
  CustomizationGroup,
  CustomizationSelection,
  CustomizationSnapshot,
  CustomizationSnapshotGroup,
} from './customization.types';

/** License feature key for the whole customization add-on feature (Q20). */
export const PRODUCT_CUSTOMIZATION_FEATURE = 'product-customization';

const GROUP_TYPES = ['single', 'multi', 'text'] as const;
const PRICING_KINDS = ['per_unit', 'per_line'] as const;
const DEFAULT_TEXT_MAX_LENGTH = 200;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deltaOrThrow(v: unknown, what: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException(`${what} must be a number ≥ 0`);
  }
  return round2(n);
}

/**
 * Validates and prices product customization (see customization.types.ts).
 * Stateless: the license flag comes from the global FeatureFlagsService.
 * Every client-supplied price is ignored — only keys/text are accepted and
 * all amounts are resolved here, against the product's CURRENT definition
 * at order time (the frozen snapshot then governs the order forever).
 */
@Injectable()
export class CustomizationService {
  constructor(private readonly featureFlags: FeatureFlagsService) {}

  isEnabled(): boolean {
    return this.featureFlags.canUse(PRODUCT_CUSTOMIZATION_FEATURE);
  }

  assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ForbiddenException(
        `Feature "${PRODUCT_CUSTOMIZATION_FEATURE}" is not licensed`,
      );
    }
  }

  /**
   * Structural validation of a DEFINITION (Product.customizations).
   * Returns the normalized groups; null/undefined → [] (no customization).
   * Throws BadRequest on any malformed entry — used at product save time
   * so a broken definition can never be stored, and again at order time
   * as defense in depth for rows written by other paths.
   */
  parseDefinition(raw: unknown, productName = 'product'): CustomizationGroup[] {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException(
        `Customizations for ${productName} must be an array of groups`,
      );
    }
    const seenGroups = new Set<string>();
    return raw.map((g, gi) => {
      if (!isRecord(g)) {
        throw new BadRequestException(`Customization group #${gi + 1} is malformed`);
      }
      const key = typeof g.key === 'string' ? g.key.trim() : '';
      const label = typeof g.label === 'string' ? g.label.trim() : '';
      if (!key || !label) {
        throw new BadRequestException(
          `Customization group #${gi + 1} needs a key and a label`,
        );
      }
      if (seenGroups.has(key)) {
        throw new BadRequestException(`Duplicate customization group key "${key}"`);
      }
      seenGroups.add(key);
      const type = g.type as (typeof GROUP_TYPES)[number];
      if (!GROUP_TYPES.includes(type)) {
        throw new BadRequestException(
          `Customization group "${key}" has an invalid type (single | multi | text)`,
        );
      }
      const required = g.required === true;
      if (type === 'text') {
        const maxLength =
          g.maxLength === undefined || g.maxLength === null
            ? DEFAULT_TEXT_MAX_LENGTH
            : Number(g.maxLength);
        if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 1000) {
          throw new BadRequestException(
            `Text group "${key}" maxLength must be an integer between 1 and 1000`,
          );
        }
        return {
          key,
          label,
          type,
          required,
          maxLength,
          priceDelta:
            g.priceDelta === undefined || g.priceDelta === null
              ? 0
              : deltaOrThrow(g.priceDelta, `Text group "${key}" price`),
          costDelta:
            g.costDelta === undefined || g.costDelta === null
              ? 0
              : deltaOrThrow(g.costDelta, `Text group "${key}" cost`),
        } satisfies CustomizationGroup;
      }
      if (!Array.isArray(g.options) || g.options.length === 0) {
        throw new BadRequestException(
          `Customization group "${key}" needs at least one option`,
        );
      }
      const seenOptions = new Set<string>();
      const options = g.options.map((o, oi) => {
        if (!isRecord(o)) {
          throw new BadRequestException(
            `Option #${oi + 1} of group "${key}" is malformed`,
          );
        }
        const oKey = typeof o.key === 'string' ? o.key.trim() : '';
        const oLabel = typeof o.label === 'string' ? o.label.trim() : '';
        if (!oKey || !oLabel) {
          throw new BadRequestException(
            `Option #${oi + 1} of group "${key}" needs a key and a label`,
          );
        }
        if (seenOptions.has(oKey)) {
          throw new BadRequestException(
            `Duplicate option key "${oKey}" in group "${key}"`,
          );
        }
        seenOptions.add(oKey);
        const pricingKind = (o.pricingKind ?? 'per_unit') as
          (typeof PRICING_KINDS)[number];
        if (!PRICING_KINDS.includes(pricingKind)) {
          throw new BadRequestException(
            `Option "${oKey}" pricingKind must be per_unit or per_line`,
          );
        }
        return {
          key: oKey,
          label: oLabel,
          priceDelta: deltaOrThrow(o.priceDelta ?? 0, `Option "${oKey}" price`),
          costDelta: deltaOrThrow(o.costDelta ?? 0, `Option "${oKey}" cost`),
          pricingKind,
        };
      });
      return { key, label, type, required, options } satisfies CustomizationGroup;
    });
  }

  /**
   * Prices a client SELECTION against a definition and freezes the
   * snapshot. Returns a null snapshot (and zero amounts) when nothing was
   * actually answered. Throws BadRequest on unknown keys, missing
   * required groups, over-length text, or a selection for a product with
   * no definition.
   */
  resolveSelection(params: {
    definition: unknown;
    selection: unknown;
    quantity: number;
    productName?: string;
  }): {
    snapshot: CustomizationSnapshot | null;
    addonAmount: number;
    addonCostAmount: number;
  } {
    const productName = params.productName ?? 'product';
    const groups = this.parseDefinition(params.definition, productName);
    const selection = params.selection;
    if (!isRecord(selection) || !Array.isArray(selection.groups)) {
      throw new BadRequestException(
        `Customization selection for ${productName} is malformed`,
      );
    }
    if (groups.length === 0) {
      throw new BadRequestException(
        `Product "${productName}" does not offer customization`,
      );
    }
    const answers = new Map<string, { optionKeys?: string[]; text?: string }>();
    for (const entry of selection.groups as unknown[]) {
      if (!isRecord(entry) || typeof entry.key !== 'string') {
        throw new BadRequestException(
          `Customization selection for ${productName} has a malformed group`,
        );
      }
      if (answers.has(entry.key)) {
        throw new BadRequestException(
          `Customization group "${entry.key}" was answered twice`,
        );
      }
      answers.set(entry.key, {
        optionKeys: Array.isArray(entry.optionKeys)
          ? (entry.optionKeys as unknown[]).map((k) => String(k))
          : undefined,
        text: typeof entry.text === 'string' ? entry.text : undefined,
      });
    }
    for (const key of answers.keys()) {
      if (!groups.some((g) => g.key === key)) {
        throw new BadRequestException(
          `Unknown customization group "${key}" for ${productName}`,
        );
      }
    }

    const snapshotGroups: CustomizationSnapshotGroup[] = [];
    let addonAmount = 0;
    let addonCostAmount = 0;
    const apply = (price: number, cost: number, kind: 'per_unit' | 'per_line') => {
      const factor = kind === 'per_unit' ? params.quantity : 1;
      addonAmount += price * factor;
      addonCostAmount += cost * factor;
    };

    for (const group of groups) {
      const answer = answers.get(group.key);
      if (group.type === 'text') {
        const text = answer?.text?.trim() ?? '';
        if (!text) {
          if (group.required) {
            throw new BadRequestException(
              `"${group.label}" is required for ${productName}`,
            );
          }
          continue;
        }
        const max = group.maxLength ?? DEFAULT_TEXT_MAX_LENGTH;
        if (text.length > max) {
          throw new BadRequestException(
            `"${group.label}" accepts at most ${max} characters`,
          );
        }
        const price = group.priceDelta ?? 0;
        const cost = group.costDelta ?? 0;
        apply(price, cost, 'per_line');
        snapshotGroups.push({
          key: group.key,
          label: group.label,
          type: 'text',
          options: [],
          text,
          priceDelta: price,
          costDelta: cost,
        });
        continue;
      }
      const keys = [...new Set(answer?.optionKeys ?? [])];
      if (keys.length === 0) {
        if (group.required) {
          throw new BadRequestException(
            `"${group.label}" is required for ${productName}`,
          );
        }
        continue;
      }
      if (group.type === 'single' && keys.length > 1) {
        throw new BadRequestException(
          `"${group.label}" allows only one choice`,
        );
      }
      const resolved = keys.map((k) => {
        const opt = group.options?.find((o) => o.key === k);
        if (!opt) {
          throw new BadRequestException(
            `Unknown option "${k}" in "${group.label}" for ${productName}`,
          );
        }
        return opt;
      });
      for (const opt of resolved) apply(opt.priceDelta, opt.costDelta, opt.pricingKind);
      snapshotGroups.push({
        key: group.key,
        label: group.label,
        type: group.type,
        options: resolved.map((o) => ({ ...o })),
      });
    }

    if (snapshotGroups.length === 0) {
      return { snapshot: null, addonAmount: 0, addonCostAmount: 0 };
    }
    return {
      snapshot: { groups: snapshotGroups },
      addonAmount: round2(addonAmount),
      addonCostAmount: round2(addonCostAmount),
    };
  }

  /**
   * Recomputes line totals from a FROZEN snapshot (never re-resolves the
   * live definition) — used when only the quantity of a customized line
   * changes during an order edit.
   */
  totalsFromSnapshot(
    snapshot: unknown,
    quantity: number,
  ): { addonAmount: number; addonCostAmount: number } {
    if (!isRecord(snapshot) || !Array.isArray(snapshot.groups)) {
      return { addonAmount: 0, addonCostAmount: 0 };
    }
    let amount = 0;
    let cost = 0;
    for (const g of snapshot.groups as CustomizationSnapshotGroup[]) {
      if (g.type === 'text') {
        amount += g.priceDelta ?? 0;
        cost += g.costDelta ?? 0;
        continue;
      }
      for (const o of g.options ?? []) {
        const factor = o.pricingKind === 'per_unit' ? quantity : 1;
        amount += (o.priceDelta ?? 0) * factor;
        cost += (o.costDelta ?? 0) * factor;
      }
    }
    return { addonAmount: round2(amount), addonCostAmount: round2(cost) };
  }
}
