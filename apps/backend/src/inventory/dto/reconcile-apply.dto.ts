import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
} from 'class-validator';

/**
 * POST /inventory/reconcile/apply body (directive §2.8). The service
 * re-checks every rule server-side (confirmed === true, non-empty
 * backupId, flag-off env, no concurrent run) — these decorators only
 * shape the payload.
 */
export class ReconcileApplyDto {
  @IsString()
  @IsNotEmpty()
  backupId!: string;

  @IsArray()
  @IsString({ each: true })
  rowIds!: string[];

  @IsBoolean()
  confirmed!: boolean;
}
