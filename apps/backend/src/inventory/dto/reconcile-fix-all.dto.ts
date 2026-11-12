import { IsBoolean } from 'class-validator';

/**
 * POST /inventory/reconcile/fix-all body. The service re-checks
 * confirmed === true server-side — this decorator only shapes the
 * payload. No backupId: fix-all takes its own db_only backup first.
 */
export class ReconcileFixAllDto {
  @IsBoolean()
  confirmed!: boolean;
}
