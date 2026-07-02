import { IsString, IsOptional, IsIn } from 'class-validator';

export const SHIPMENT_STATUSES = [
  'pending',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function isValidTransition(
  from: string | undefined | null,
  to: string,
): boolean {
  if (!from) return SHIPMENT_STATUSES.includes(to as ShipmentStatus);
  const next = ALLOWED_TRANSITIONS[from as ShipmentStatus];
  return next?.includes(to as ShipmentStatus) ?? false;
}

export class CreateOrUpdateShipmentDto {
  @IsOptional()
  @IsString()
  trackingNo?: string;

  @IsOptional()
  @IsString()
  courier?: string;

  @IsOptional()
  @IsString()
  @IsIn(SHIPMENT_STATUSES)
  status?: string;
}
