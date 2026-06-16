import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('admin/search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Roles('admin', 'manager', 'superadmin', 'cashier')
  @Get()
  async search(@Query(new ValidationPipe({ transform: true })) query: SearchQueryDto) {
    return this.searchService.search(query.q, query.limit ?? 5);
  }
}
