import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

/**
 * Admin GDPR-style deletion request (`POST /tracking/admin/delete`). Exactly one
 * of the two selectors is required — either the tracking `externalId` or the
 * store `customerId`. `@ValidateIf` makes each selector mandatory only when the
 * other is absent, so a body with neither (or only empty strings) fails
 * class-validator with a 400.
 */
export class DeletionDto {
  /** Journey/context externalId (guest or customer-keyed). */
  @IsString()
  @IsNotEmpty()
  @ValidateIf((o) => !o.customerId)
  externalId?: string;

  /** Store customer id; the workflow resolves it to orders + tracking contexts. */
  @IsString()
  @IsNotEmpty()
  @ValidateIf((o) => !o.externalId)
  customerId?: string;
}
