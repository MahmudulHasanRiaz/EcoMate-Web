import { Module } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { SCAN_PURPOSE_HANDLERS, ScannerService } from './scanner.service';
import { HandedOverPurpose } from './purposes/handed-over.purpose';
import { ReturnPurpose } from './purposes/return.purpose';
import { OrderStatusPurpose } from './purposes/order-status.purpose';
import { StickerPrintPurpose } from './purposes/sticker-print.purpose';
import { ReturnReceivePurpose } from './purposes/return-receive.purpose';
import { DispatchModule } from '../dispatch/dispatch.module';
import { RtnModule } from '../rtn/rtn.module';
import { OrdersModule } from '../orders/orders.module';
import { ReturnsModule } from '../returns/returns.module';

@Module({
  controllers: [ScannerController],
  providers: [
    ScannerService,
    HandedOverPurpose,
    ReturnPurpose,
    OrderStatusPurpose,
    StickerPrintPurpose,
    ReturnReceivePurpose,
    {
      provide: SCAN_PURPOSE_HANDLERS,
      useFactory: (
        handedOver: HandedOverPurpose,
        returnPurpose: ReturnPurpose,
        orderStatus: OrderStatusPurpose,
        stickerPrint: StickerPrintPurpose,
        returnReceive: ReturnReceivePurpose,
      ) => [handedOver, returnPurpose, orderStatus, stickerPrint, returnReceive],
      inject: [HandedOverPurpose, ReturnPurpose, OrderStatusPurpose, StickerPrintPurpose, ReturnReceivePurpose],
    },
  ],
  imports: [DispatchModule, RtnModule, OrdersModule, ReturnsModule],
})
export class ScannerModule {}
