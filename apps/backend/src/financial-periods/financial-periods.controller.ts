import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FinancialPeriodsService } from './financial-periods.service';
import { CreateFinancialPeriodDto } from './dto/create-financial-period.dto';
import { AccountingEnabledGuard } from '../accounting/accounting-enabled.guard';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('superadmin', 'admin')
@UseGuards(AccountingEnabledGuard)
@Controller('financial-periods')
@RequiresFeature('admin_accounting')
export class FinancialPeriodsController {
  constructor(
    private readonly financialPeriodsService: FinancialPeriodsService,
  ) {}

  @Post()
  create(@Body() dto: CreateFinancialPeriodDto) {
    return this.financialPeriodsService.create(dto);
  }

  /**
   * The admin's accounting pages consume this endpoint exactly like
   * GET /accounting/entries: a paginated envelope (`{ data, meta }`).
   * Returning the service's bare array left every period list in the UI
   * permanently empty (the pages read `response.data.data`), even though
   * the periods exist — e.g. the twelve months the accounting module
   * bootstraps at startup. The service keeps returning the plain array
   * for its internal callers; the envelope is applied here, at the HTTP
   * boundary, mirroring AccountingController.findAllEntries.
   */
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const perPageNum = perPage ? parseInt(perPage, 10) : 10;
    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
      throw new BadRequestException(
        'Page and perPage must be positive numbers',
      );
    }
    const periods = await this.financialPeriodsService.findAll();
    const total = periods.length;
    const totalPages = Math.max(1, Math.ceil(total / perPageNum));
    const start = (pageNum - 1) * perPageNum;
    return {
      data: periods.slice(start, start + perPageNum),
      meta: { total, page: pageNum, perPage: perPageNum, totalPages },
    };
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
