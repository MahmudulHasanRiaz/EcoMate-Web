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
  BadRequestException,
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
import { SyncQueuesService } from './sync/sync-queues.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { productSyncEnabled, storesEnabled } from './store-flags';
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
  constructor(
    private readonly stores: StoresService,
    private readonly queues: SyncQueuesService,
    private readonly registry: ProviderRegistryService,
  ) {}

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

  /** Provider hook registration (P4 live). */
  @Post(':id/webhooks/ensure')
  @Roles('superadmin', 'admin')
  async ensureWebhooks(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    const store = await this.stores.detail(id);
    const provider = this.registry.providerFor({ kind: (store as any).kind });
    const full = await this.stores.storeWithSecrets(id);
    return provider.ensureWebhooks(full, resolveWebhookCallbackBase());
  }

  /** Manual sync trigger (`{ scope } → { runId }`, BR-21: returns now). */
  @Post(':id/sync')
  @Roles('superadmin', 'admin')
  async triggerSync(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scope?: string },
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    if (!productSyncEnabled()) {
      throw new ForbiddenException('Product sync is disabled');
    }
    await this.stores.detail(id);
    const scope = (body.scope ?? 'PRODUCT') as 'PRODUCT' | 'PUBLISH';
    return this.queues.triggerStoreSync(id, scope, user?.sub);
  }
}

/**
 * Resolve the public callback base for provider webhook registration.
 * A relative URL is doomed (Shopify 422s "address is invalid") — fail
 * loudly here instead of registering garbage. Exported for unit tests.
 */
export function resolveWebhookCallbackBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = String(env.PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new BadRequestException(
      'Webhook callback base URL is not configured (PUBLIC_API_BASE_URL must be an https:// URL)',
    );
  }
  return base;
}
