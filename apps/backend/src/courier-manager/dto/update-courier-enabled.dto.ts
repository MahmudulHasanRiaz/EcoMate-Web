import { IsBoolean } from 'class-validator';

/**
 * Body for PATCH /couriers/credentials/:courier/enabled.
 *
 * Deliberately narrow: the settings card toggles a courier on/off without
 * committing (possibly half-typed) credential fields. Anything other than a
 * boolean is rejected by the global ValidationPipe.
 */
export class UpdateCourierEnabledDto {
  @IsBoolean()
  enabled: boolean;
}
