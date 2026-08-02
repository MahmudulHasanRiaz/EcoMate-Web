import { IsDate, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Admin DEAD-outbox list row (`GET /tracking/admin/dead`, design §4.10).
 * `eventId`/`eventType` are resolved from the tracking snapshot (the outbox row
 * does not denormalize them); `versions` is the pinned replay-archive versions
 * when an archive has been written for the outbox. Response-shape DTO — the
 * endpoints take no request body (replay targets a snapshotId path param).
 */
export class ReplayDeadOutboxDto {
  @IsString()
  id: string;

  @IsString()
  snapshotId: string;

  @IsString()
  @IsOptional()
  eventId?: string | null;

  @IsString()
  @IsOptional()
  eventType?: string | null;

  @IsString()
  @IsOptional()
  lastError?: string | null;

  @IsDate()
  createdAt: Date;

  @IsInt()
  attemptCount: number;

  @IsOptional()
  versions?: Record<string, unknown> | null;
}
