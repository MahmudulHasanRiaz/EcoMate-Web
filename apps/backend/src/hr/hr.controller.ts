import { Controller, Get } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { HrService } from './hr.service';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('overview')
  getOverview() {
    return this.hrService.getOverview();
  }
}