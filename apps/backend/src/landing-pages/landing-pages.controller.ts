import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { LandingPagesService } from './landing-pages.service';
import { Public } from '../common/decorators/public.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { isInternalRequest } from '../common/rate-limit/internal-request';

@Controller('landing-pages')
export class LandingPagesController {
  constructor(private readonly svc: LandingPagesService) {}

  @Permissions('view_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Get()
  list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.svc.list({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
    });
  }

  @Permissions('view_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Public()
  @Get('published/:slug')
  findPublished(@Param('slug') slug: string) {
    return this.svc.findPublishedBySlug(slug);
  }

  /**
   * Draft/unpublished preview. Stays `@Public()` so the global auth guard
   * does not 401 the storefront's server-to-server fetch — but the call
   * itself is gated on the internal-request check (shared secret +
   * private peer, the same pattern `serverFetch` uses for every internal
   * call). A direct public request has neither, so an unpublished slug is
   * not viewable by guessing it.
   *
   * Consequence to know: the admin Preview button works only where
   * INTERNAL_SHARED_SECRET is set to the same value on backend +
   * storefront (supported env in docker-compose.yml / portainer-stack).
   * Where it is unset, preview returns 403 and the button shows the
   * storefront 404 page; the published endpoint is unaffected.
   */
  @Public()
  @Get('preview/:slug')
  findPreview(@Param('slug') slug: string, @Req() req: any) {
    if (!isInternalRequest(req)) {
      throw new ForbiddenException(
        'Preview is only available from the storefront server',
      );
    }
    return this.svc.findBySlug(slug);
  }

  @Permissions('create_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Post()
  create(@Body() body: Record<string, any>) {
    return this.svc.create(body);
  }

  @Permissions('edit_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.svc.update(id, body);
  }

  @Permissions('edit_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.svc.publish(id);
  }

  @Permissions('edit_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Post(':id/unpublish')
  unpublish(@Param('id') id: string) {
    return this.svc.unpublish(id);
  }

  @Permissions('delete_landing_pages')
  @RequiresFeature('admin_landing_pages')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
