/**
 * Stores module — central-commerce P1 foundation.
 *
 * Registers the provider contract (all three slugs), the registry with the
 * NATIVE throwing guard (BR-20), and the Stores API (§10 Stores subset).
 * No queues yet: sync-engine queues land in P4.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EncryptionService } from '../common/utils/encryption';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { WooCommerceProvider } from './providers/woocommerce.provider';
import { ShopifyProvider } from './providers/shopify.provider';
import { CustomBridgeProvider } from './providers/custom-bridge.provider';

@Module({
  imports: [PrismaModule],
  controllers: [StoresController],
  providers: [
    StoresService,
    ProviderRegistryService,
    WooCommerceProvider,
    ShopifyProvider,
    CustomBridgeProvider,
    EncryptionService,
  ],
  exports: [StoresService, ProviderRegistryService],
})
export class StoresModule {}
