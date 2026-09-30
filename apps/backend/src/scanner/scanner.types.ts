/**
 * Scan purpose registry — typed application-level registry (NOT a dynamic
 * database plugin system). Each purpose declares its label, identifier
 * requirements, resolution strategy, eligibility validation, execution
 * handler and result formatting. A future purpose (e.g. a new print flow)
 * is added by writing another handler class and registering it in the
 * module — the engine never changes.
 */

export type ScanPurposeId =
  | 'DISPATCH_HANDED_OVER'
  | 'DISPATCH_RETURN'
  | 'ORDER_STATUS'
  | 'STICKER_PRINT';

export interface ScanActor {
  userId: string;
  email: string;
}

export interface DispatchPreview {
  id: string;
  courier: string;
  consignmentId: string;
  trackingCode: string | null;
  status: string;
  orderId: string;
  orderDisplayId: string;
  orderStatus: string;
  orderKind: string;
}

export interface OrderPreview {
  id: string;
  displayId: string;
  status: string;
  kind: string;
  allowedStatuses: { id: string; name: string }[];
}

export interface ResolveOutcome {
  status: 'resolved' | 'selection_required' | 'not_found';
  identifier: string;
  message?: string;
  dispatches: DispatchPreview[];
  order: OrderPreview | null;
}

export type ScanResultStatus = 'success' | 'warning' | 'error' | 'duplicate';

export interface ScanResult {
  status: ScanResultStatus;
  identifier: string;
  title: string;
  message: string;
  courier?: string;
  oldState?: string;
  newState?: string;
  details?: Record<string, any>;
}

export interface ScanPurposeHandler {
  readonly purpose: ScanPurposeId;
  readonly label: string;
  readonly description: string;
  /** Preview/selection phase — NEVER mutates. */
  resolve(identifier: string): Promise<ResolveOutcome>;
  /** Execution phase — eligibility-validated, idempotent, audited. */
  execute(
    params: {
      identifier: string;
      dispatchId?: string;
      orderId?: string;
      targetStatusId?: string;
    },
    actor: ScanActor,
  ): Promise<ScanResult>;
}

export interface ScanPurposeDescriptor {
  purpose: ScanPurposeId;
  label: string;
  description: string;
}
