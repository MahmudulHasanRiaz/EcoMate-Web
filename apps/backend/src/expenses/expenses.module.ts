import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CompensationExpenseService } from './compensation-expense.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, CompensationExpenseService],
  exports: [ExpensesService, CompensationExpenseService],
})
export class ExpensesModule {}
