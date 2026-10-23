import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('accounts')
@Roles('superadmin', 'admin')
@RequiresFeature('admin_accounting')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto, @CurrentUser() user?: any) {
    return this.accountsService.create(dto, user?.sub);
  }

  /**
   * The admin accounting pages consume this endpoint exactly like
   * GET /accounting/entries and GET /financial-periods: a paginated envelope
   * (`{ data, meta }`). Returning the service's bare array left the chart of
   * accounts' parent-account picker and the journal-entry/report account
   * selects permanently empty — every one of those consumers reads
   * `response.data.data`. The service keeps returning the plain array for its
   * internal callers; the envelope is applied here, at the HTTP boundary,
   * mirroring AccountingController.findAllEntries.
   */
  @Get()
  async findAll(
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const perPageNum = perPage ? parseInt(perPage, 10) : 10;
    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
      throw new BadRequestException('Page and perPage must be positive numbers');
    }
    const accounts = await this.accountsService.findAll(type);
    const total = accounts.length;
    const totalPages = Math.max(1, Math.ceil(total / perPageNum));
    const start = (pageNum - 1) * perPageNum;
    return {
      data: accounts.slice(start, start + perPageNum),
      meta: { total, page: pageNum, perPage: perPageNum, totalPages },
    };
  }

  @Get('tree')
  getChartOfAccounts() {
    return this.accountsService.getChartOfAccounts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }
}
