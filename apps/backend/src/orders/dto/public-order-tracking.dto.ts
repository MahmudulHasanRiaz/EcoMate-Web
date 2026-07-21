import { IsOptional, IsString } from 'class-validator';

/** Minimal public order-tracking response. Explicit allowlist — no viewToken, paymentProof, verifier, assignee, internal notes, or staff PII. */
export class PublicOrderTrackingDto {
  id: string;
  displayId: string;
  createdAt: Date;
  status: { name: string; color?: string };
  items: Array<{
    id: string;
    quantity: number;
    price: number;
    product: { name: string; slug: string; images: string[] };
  }>;
  total: number;
  shippingAddress?: Record<string, unknown> | null;
  trackingUrl?: string | null;
  shipment?: Record<string, unknown> | null;
  timeline?: Array<{ status: string; timestamp: string; note?: string }>;
  customer?: { firstName: string; lastName: string; phoneNumber: string };
}

export class SubmitPaymentProofDto {
  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsString()
  @IsOptional()
  screenshot?: string;

  @IsString()
  @IsOptional()
  /** Required to prove ownership for unauthenticated guests. */
  token?: string;
}
