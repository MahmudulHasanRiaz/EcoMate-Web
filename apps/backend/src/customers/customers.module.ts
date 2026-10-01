import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerLinkingService } from './customer-linking.service';
import { CustomerAddressService } from './customer-address.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLinkingService, CustomerAddressService],
  exports: [CustomersService, CustomerLinkingService, CustomerAddressService],
})
export class CustomersModule {}
