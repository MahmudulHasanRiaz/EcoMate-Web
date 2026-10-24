import { Controller, Get } from '@nestjs/common';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { PermissionsService } from './permissions.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * The full permission catalogue, grouped by module.
   *
   * This is what the access-preset editor renders, so the list of grantable
   * capabilities lives in exactly one place: the backend. The frontend
   * previously carried its own hardcoded copy that had drifted — 14 of the 40
   * registered keys (all HR and courier-settlement) were missing, so an admin
   * literally could not grant them.
   */
  @Get('catalogue')
  @PermissionsAny('view_permissions', 'manage_presets', 'manage_employees')
  getCatalogue() {
    return this.permissionsService.getCatalogue();
  }

  /** Flat key list — used by the contract test and by tooling. */
  @Get('keys')
  @PermissionsAny('view_permissions', 'manage_presets', 'manage_employees')
  getKeys() {
    return this.permissionsService.getKeys();
  }
}