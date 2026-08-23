import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { EmployeeBankAccountsController } from './employees-bank-accounts.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmployeesController, EmployeeBankAccountsController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
