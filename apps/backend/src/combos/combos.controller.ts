import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { CombosService } from './combos.service';
import { CreateComboDto, UpdateComboDto } from './dto/combos.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

@Controller('combos')
export class CombosController {
  constructor(private readonly combosService: CombosService) {}

  @Public()
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (cursor) {
      return this.combosService.findAllCursor({
        cursor,
        perPage: perPage ? parseInt(perPage) : undefined,
        search,
        categoryId,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
      });
    }
    return this.combosService.findAll({
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 12,
      search,
      categoryId,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      sort,
      order,
    });
  }

  @Public()
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.combosService.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_combos')
  @Post()
  async create(@Body() dto: CreateComboDto) {
    return this.combosService.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_combos')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateComboDto) {
    return this.combosService.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @RequiresFeature('admin_combos')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.combosService.remove(id);
  }
}
