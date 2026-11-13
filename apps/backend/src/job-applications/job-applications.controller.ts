import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JobApplicationsService } from './job-applications.service';
import { UpdateJobApplicationDto } from './dto/update-job-application.dto';

@Controller('hr/job-applications')
@Roles('superadmin', 'admin', 'employee')
@PermissionsAny('view_hr')
@RequiresFeature('admin_hr_careers')
export class JobApplicationsController {
  constructor(private readonly applications: JobApplicationsService) {}

  @Get()
  list(
    @Query('jobId') jobId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.applications.listAdmin({ jobId, status, page, perPage });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.applications.findAdmin(id);
  }

  /**
   * Admin-only CV download. Served as an attachment with a safe content
   * type — never inline, never rendered as HTML.
   */
  @Get(':id/cv')
  async downloadCv(@Param('id') id: string) {
    const { buffer, filename, mimeType } =
      await this.applications.downloadCv(id);
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateJobApplicationDto,
    @CurrentUser() user: { userId: string } | null,
  ) {
    return this.applications.update(id, dto, user?.userId);
  }

  @Delete(':id/cv')
  deleteCv(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string } | null,
  ) {
    return this.applications.deleteCv(id, user?.userId);
  }
}
