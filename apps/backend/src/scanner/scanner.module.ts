import { Module } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { SCAN_PURPOSE_HANDLERS, ScannerService } from './scanner.service';
import { HandedOverPurpose } from './purposes/handed-over.purpose';
import { ReturnPurpose } from './purposes/return.purpose';
import { OrderStatusPurpose } from './purposes/order-status.purpose';
import { StickerPrintPurpose } from './purposes/sticker-print.purpose';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RtnModule } from '../rtn/rtn.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  controllers: [ScannerController],
  providers: [
    ScannerService,
    HandedOverPurpose,
    ReturnPurpose,
    OrderStatusPurpose,
    StickerPrintPurpose,
    {
      provide: SCAN_PURPOSE_HANDLERS,
      useFactory: (
        handedOver: HandedOverPurpose,
        returnPurpose: ReturnPurpose,
        orderStatus: OrderStatusPurpose,
        stickerPrint: StickerPrintPurpose,
      ) => [handedOver, returnPurpose, orderStatus, stickerPrint],
      inject: [HandedOverPurpose, ReturnPurpose, OrderStatusPurpose, StickerPrintPurpose],
    },
  ],
  imports: [DispatchModule, RtnModule, OrdersModule],
})
export class ScannerModule {}
