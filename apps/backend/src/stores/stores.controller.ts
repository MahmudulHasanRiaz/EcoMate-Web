/**
 * Stores controller — central-commerce §10 (P1: Stores subset).
 *
 * Double-gated (BR-25): `@RequiresFeature('admin_stores')` AND the
 * fail-closed runtime flags (`THIRD_PARTY_STORES_ENABLED` +
 * `store_sync_enabled`). Reads never include secrets; credentials rotate
 * through a write-only endpoint.
 *
 * Sync-run endpoints (`POST /stores/:id/sync`, `/sync/*`) land with the
 * sync engine in P4; the P1 `sync` route below answers 501 explicitly
 * rather than silently queuing nothing.
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StoresService } from './stores.service';
import { storesEnabled } from './store-flags';
import {
  CreateStoreDto,
  RotateStoreCredentialsDto,
  TestConnectionDto,
  UpdateStoreDto,
} from './dto/stores.dto';

@Roles('superadmin', 'admin', 'manager')
@Controller('stores')
@RequiresFeature('admin_stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  private assertEnabled(): void {
    if (!storesEnabled()) {
      throw new ForbiddenException('Third-party stores are disabled');
    }
  }

  @Get()
  list() {
    this.assertEnabled();
    return this.stores.list();
  }

  @Post()
  @Roles('superadmin', 'admin')
  create(@Body() dto: CreateStoreDto, @CurrentUser() user?: any) {
    this.assertEnabled();
    return this.stores.connect(dto, user?.sub);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.stores.detail(id);
  }

  @Patch(':id')
  @Roles('superadmin', 'admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStoreDto) {
    this.assertEnabled();
    return this.stores.update(id, dto);
  }

  /** Disconnect — retains identity, mappings, history (§8.10). */
  @Delete(':id')
  @Roles('superadmin', 'admin')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.stores.disconnect(id);
  }

  /** Write-only credential rotation — never echoes the payload. */
  @Post(':id/credentials')
  @Roles('superadmin', 'admin')
  rotateCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateStoreCredentialsDto,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.stores.rotateCredentials(id, dto, user?.sub);
  }

  @Post(':id/test-connection')
  testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestConnectionDto,
  ) {
    this.assertEnabled();
    return this.stores.testConnection(id, dto);
  }

  /** Re-auth onto the same Store row (§8.10). */
  @Post(':id/reconnect')
  @Roles('superadmin', 'admin')
  reconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateStoreCredentialsDto,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.stores.reconnect(id, dto, user?.sub);
  }

  @Get(':id/health')
  health(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.stores.health(id);
  }

  /** P4: provider hook registration. P1 answers 501 explicitly. */
  @Post(':id/webhooks/ensure')
  @Roles('superadmin', 'admin')
  ensureWebhooks(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    void id;
    throw new ForbiddenException(
      'Webhook provisioning lands with the sync engine (P4)',
    );
  }

  /** P4: manual sync trigger (`{ scope } → { runId }`). P1: explicit 501. */
  @Post(':id/sync')
  @Roles('superadmin', 'admin')
  triggerSync(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scope?: string },
  ) {
    this.assertEnabled();
    void id;
    void body;
    throw new ForbiddenException('Manual sync lands with the sync engine (P4)');
  }
}
