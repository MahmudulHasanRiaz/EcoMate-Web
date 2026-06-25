import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { FinancialPeriodsService } from './financial-periods.service';
import { CreateFinancialPeriodDto } from './dto/create-financial-period.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('superadmin', 'admin')
@Controller('financial-periods')
export class FinancialPeriodsController {
  constructor(private readonly financialPeriodsService: FinancialPeriodsService) {}

  @Post()
  create(@Body() dto: CreateFinancialPeriodDto) {
    return this.financialPeriodsService.create(dto);
  }

  @Get()
  findAll() {
    return this.financialPeriodsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.financialPeriodsService.findOne(id);
  }

  @Patch(':id/close')
  closePeriod(@Param('id') id: string) {
    return this.financialPeriodsService.closePeriod(id);
  }

  @Patch(':id/open')
  openPeriod(@Param('id') id: string) {
    return this.financialPeriodsService.openPeriod(id);
  }
}
