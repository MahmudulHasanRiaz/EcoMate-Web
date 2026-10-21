import { Module } from '@nestjs/common';
import { DispatchCancelService } from './dispatch-cancel.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Cancel a DISPATCHED order with the dispatch (owner directive, 2026-10-21).
 *
 * A leaf module on purpose: it only needs the Prisma client (the courier
 * client is loaded lazily inside the service, the same pattern the orders
 * service uses) so both the orders module and the refunds module can import
 * it without a module cycle.
 */
@Module({
  imports: [PrismaModule],
  providers: [DispatchCancelService],
  exports: [DispatchCancelService],
})
export class DispatchCancelModule {}
