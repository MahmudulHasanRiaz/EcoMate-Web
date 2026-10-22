import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveScanIdentifier } from './scanner-resolver';
import {
  ScanActor,
  ScanPurposeDescriptor,
  ScanPurposeHandler,
  ScanPurposeId,
  ScanResult,
} from './scanner.types';

export const SCAN_PURPOSE_HANDLERS = Symbol('SCAN_PURPOSE_HANDLERS');

/**
 * Scanner engine — purpose registry + dispatch. Contains NO business logic
 * of its own: every mutation lives in a purpose handler (or the domain
 * service it delegates to). New purposes are registered in the module
 * providers; this engine never changes.
 */
@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private readonly handlers = new Map<ScanPurposeId, ScanPurposeHandler>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCAN_PURPOSE_HANDLERS) handlers: ScanPurposeHandler[],
  ) {
    for (const handler of handlers) {
      this.handlers.set(handler.purpose, handler);
    }
    this.logger.log(
      `Scanner engine initialised with purposes: ${[...this.handlers.keys()].join(', ')}`,
    );
  }

  listPurposes(): ScanPurposeDescriptor[] {
    return [...this.handlers.values()].map((h) => ({
      purpose: h.purpose,
      label: h.label,
      description: h.description,
    }));
  }

  /**
   * Resolve a scanned identifier WITHOUT mutating anything. With a purpose,
   * the purpose's own resolution strategy applies (e.g. ORDER_STATUS
   * rejects Return Orders); without one, the generic resolver runs.
   */
  async resolve(
    purpose: ScanPurposeId | undefined,
    identifier: string,
  ): Promise<ReturnType<typeof resolveScanIdentifier>> {
    const handler = purpose ? this.handlers.get(purpose) : undefined;
    if (handler) return handler.resolve(identifier);
    return resolveScanIdentifier(this.prisma, identifier);
  }

  async execute(
    purpose: ScanPurposeId,
    params: {
      identifier: string;
      dispatchId?: string;
      dispatchIds?: string[];
      orderId?: string;
      orderIds?: string[];
      targetStatusId?: string;
      returnId?: string;
      exchangeId?: string;
      /** Confirmed receive lines (damage split included) — never stripped. */
      items?: Array<{
        productId: string;
        variantId?: string | null;
        quantity: number;
        damagedQuantity?: number;
      }>;
    },
    actor: ScanActor,
  ): Promise<ScanResult> {
    const handler = this.handlers.get(purpose);
    if (!handler) {
      return {
        status: 'error',
        identifier: params.identifier,
        title: 'Unknown scan purpose',
        message: `Unknown scan purpose "${purpose}".`,
      };
    }
    return handler.execute(params, actor);
  }
}
