import {
  Controller, Get, Post, Body, Param, Query, UseGuards, BadRequestException, Logger,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InventoryEnabledGuard } from '../stock/inventory-enabled.guard';
import { ReconciliationFinderService } from '../reconciliation/reconciliation-finder.service';
import { ReconciliationApplyService } from '../reconciliation/reconciliation-apply.service';
import { ReconcileApplyDto } from './dto/reconcile-apply.dto';
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
  private readonly logger = new Logger(InventoryController.name);
  /** Hard ceiling for list endpoints — an unbounded perPage is a DB/memory hazard. */
  private static readonly MAX_PER_PAGE = 100;

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly reconFinder: ReconciliationFinderService,
    private readonly reconApply: ReconciliationApplyService,
    private readonly prisma: PrismaService,
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

  /**
   * Variant-level product lookup for the stock-transfer picker.
   *
   * One row per SELECTABLE stock unit — a variable product fans out into its
   * active variants and never exposes a bare parent row, so a parent-SKU
   * search always forces a variant choice. See InventoryService.productLookup.
   */
  @Roles('superadmin', 'admin', 'employee')
  @Permissions('manage_stock')
  @Get('product-lookup')
  async productLookup(
    @Query('q') q?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.inventoryService.productLookup({
      q,
      warehouseId,
      perPage: this.clampPerPage(perPage, 25),
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
    // The whole movement (header, source deduction, FIFO costing, destination
    // add) is ONE transaction. Passing the tx into transfer() also puts the
    // idempotency check inside it, so two concurrent requests with the same key
    // cannot both pass the check and move stock twice.
    return this.prisma.$transaction((tx) =>
      this.inventoryService.transfer(body, user.email, tx),
    );
  }

  /**
   * POS transfer requests ("See where → Request transfer" in the POS app).
   * A request is a StockTransfer row with items but no stock movement yet;
   * approving it runs the transfer() pipeline, rejecting it closes it out.
   */
  @Roles('superadmin', 'admin', 'employee')
  @Get('transfer-requests')
  async transferRequests(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.inventoryService.listTransferRequests(
      this.clampPage(page),
      this.clampPerPage(perPage),
    );
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
   * Stock reconciliation report (2026-10-30 directive §2.3/§2.8).
   *
   * READ-ONLY: returns the finder table (R1–R5) + the Q1–Q8 verification
   * set and writes NOTHING. (This route previously triggered the blanket
   * boot heal on demand — that apply path is deleted. The only write path
   * is POST /inventory/reconcile/apply below, which applies ONLY
   * still-R1/R2 rows, never a blanket heal.)
   */
  @Permissions('run_stock_reconciliation')
  @Post('reconcile')
  async reconcile(@CurrentUser() user: { email: string }) {
    this.logger.log(`Reconciliation report requested by ${user?.email ?? 'unknown'}`);
    return this.reconFinder.buildReport();
  }

  /**
   * Guarded reconciliation Apply (§2.8): re-runs the finder, applies ONLY
   * rows that are still R1/R2 and listed in rowIds, via the guarded
   * restore primitives. Requires a tested backup id + explicit
   * confirmation; refuses while another run is RUNNING (409) and while
   * STOCK_RECONCILE_ON_BOOT=true is present in the environment. The
   * acting user is recorded from the auth token, never from the body.
   */
  @Permissions('run_stock_reconciliation')
  @Post('reconcile/apply')
  async reconcileApply(
    @Body() body: ReconcileApplyDto,
    @CurrentUser() user: { email: string },
  ) {
    if (body.confirmed !== true) {
      throw new BadRequestException(
        'Apply requires confirmed=true — preview the report and confirm first.',
      );
    }
    if (!body.backupId || !body.backupId.trim()) {
      throw new BadRequestException(
        'Apply requires the id of a restore-tested backup taken immediately before the run.',
      );
    }
    return this.reconApply.apply({
      performedBy: user?.email ?? 'unknown',
      backupId: body.backupId,
      rowIds: body.rowIds ?? [],
    });
  }
}
