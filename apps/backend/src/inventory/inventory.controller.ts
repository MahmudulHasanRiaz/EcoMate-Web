import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InventoryEnabledGuard } from '../stock/inventory-enabled.guard';
import { StockReconciliationService } from '../stock/stock-reconciliation.service';
import {
  AdjustInventoryDto,
  BulkAdjustInventoryDto,
} from './dto/adjust-inventory.dto';
import { ValuationQueryDto, StockTransferDto } from './dto/valuation.dto';
import { RejectTransferRequestDto } from './dto/transfer-request.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';

@Controller('inventory')
@RequiresFeature('admin_inventory')
export class InventoryController {
  /** Hard ceiling for list endpoints — an unbounded perPage is a DB/memory hazard. */
  private static readonly MAX_PER_PAGE = 100;

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly reconciliation: StockReconciliationService,
  ) {}

  /** Parse a client perPage into 1..MAX_PER_PAGE (fallback on garbage input). */
  private clampPerPage(value?: string, fallback = 20): number {
    const parsed = value ? parseInt(value, 10) : fallback;
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, InventoryController.MAX_PER_PAGE);
  }

  /** Parse a client page into a positive integer (fallback 1). */
  private clampPage(value?: string): number {
    const parsed = value ? parseInt(value, 10) : 1;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('low-stock')
  async lowStock() {
    return this.inventoryService.lowStock();
  }

  @Roles('superadmin', 'admin', 'employee')
  @UseGuards(InventoryEnabledGuard)
  @Get('replenishment')
  async physicalReplenishment() {
    return this.inventoryService.physicalReplenishment();
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('logs')
  async logs(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('type') type?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.inventoryService.logs(
      this.clampPage(page),
      this.clampPerPage(perPage),
      type,
      warehouseId,
      productId,
    );
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('transfers')
  async transfers(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.inventoryService.listTransfers(
      this.clampPage(page),
      this.clampPerPage(perPage),
      search,
      status,
    );
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('stock-overview')
  async stockOverview(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('type') type?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.inventoryService.stockOverview({
      page: this.clampPage(page),
      perPage: this.clampPerPage(perPage),
      search,
      categoryId,
      type,
      sortBy,
      sortOrder: sortOrder as 'asc' | 'desc' | undefined,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('adjust')
  async adjust(
    @Body() body: AdjustInventoryDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.adjust(
      body.productId,
      body.quantity,
      body.reason,
      user.email,
      body.variantId,
      body.comboId,
      body.confirmDestructive,
    );
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('bulk-adjust')
  async bulkAdjust(
    @Body() body: BulkAdjustInventoryDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.bulkAdjust(body.items, user.email);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('valuation')
  async valuation(@Query() query: ValuationQueryDto) {
    return this.inventoryService.valuation(query);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('valuation/managed')
  async managedStockValue(@Query() query: ValuationQueryDto) {
    return this.inventoryService.managedStockValue(query);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('ledger')
  async getLedger(@Query() query: LedgerQueryDto) {
    return this.inventoryService.getLedger(query);
  }

  @Roles('superadmin', 'admin', 'employee')
  @UseGuards(InventoryEnabledGuard)
  @Post('transfer')
  async transfer(
    @Body() body: StockTransferDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.transfer(body, user.email);
  }

  /**
   * POS transfer requests ("See where → Request transfer" in the POS app).
   * A request is a StockTransfer row with items but no stock movement yet;
   * approving it runs the transfer() pipeline, rejecting it closes it out.
   */
  @Roles('superadmin', 'admin', 'employee')
  @Get('transfer-requests')
  async transferRequests() {
    return this.inventoryService.listTransferRequests();
  }

  @Roles('superadmin', 'admin', 'employee')
  @UseGuards(InventoryEnabledGuard)
  @Post('transfer-requests/:id/approve')
  async approveTransferRequest(
    @Param('id') id: string,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.approveTransferRequest(id, user.email);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('transfer-requests/:id/reject')
  async rejectTransferRequest(
    @Param('id') id: string,
    @Body() body: RejectTransferRequestDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.inventoryService.rejectTransferRequest(
      id,
      user.email,
      body?.reason,
    );
  }

  /**
   * On-demand stock reconciliation / healing.
   * Heals orders whose stock state drifted from their status (delivered-but-not-
   * deducted, cancelled-but-not-released, returned-but-not-restored).
   * Idempotent. Optional ?orderId=... to heal a single order.
   */
  @Roles('superadmin', 'admin', 'employee')
  @Post('reconcile')
  async reconcile(
    @Query('orderId') orderId?: string,
  ) {
    if (orderId) {
      const outcome = await this.reconciliation.healOrder(orderId);
      return { orderId, outcome };
    }
    const result = await this.reconciliation.healAll();
    return {
      scanned: result.scanned,
      deducted: result.deliveredDeducted,
      restored: result.cancelledRestored,
      blocked: result.blocked,
      delta: result.delta,
      verification: result.verification,
      summary: result.summary,
    };
  }
}
