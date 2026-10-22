import { Body, Controller, Get, Post } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScanExecuteDto, ScanResolveDto } from './dto/scanner.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

/**
 * Scanner API. Thin controllers — all domain logic lives in the purpose
 * handlers / RtnService / DispatchService / OrdersService.
 *
 * Authorization: warehouse operations feature (admin_barcode_search) with
 * staff roles. Every handler re-validates eligibility server-side; there is
 * no scanner-specific role bypass.
 */
@Controller('scanner')
@Roles('superadmin', 'admin', 'employee')
@RequiresFeature('admin_barcode_search')
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Get('purposes')
  listPurposes() {
    return this.scannerService.listPurposes();
  }

  /**
   * Resolve a scanned identifier WITHOUT mutating anything. Used for
   * previews and multiple-dispatch selection.
   */
  @Post('resolve')
  resolve(@Body() dto: ScanResolveDto) {
    return this.scannerService.resolve(dto.purpose, dto.identifier);
  }

  /**
   * Execute a scan purpose. Idempotent + concurrency-safe per handler.
   */
  @Post('scan')
  scan(
    @Body() dto: ScanExecuteDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.scannerService.execute(
      dto.purpose,
      {
        identifier: dto.identifier,
        dispatchId: dto.dispatchId,
        dispatchIds: dto.dispatchIds,
        orderId: dto.orderId,
        orderIds: dto.orderIds,
        targetStatusId: dto.targetStatusId,
        returnId: dto.returnId,
        exchangeId: dto.exchangeId,
        items: dto.items,
      },
      { userId: user.userId, email: user.email },
    );
  }
}
