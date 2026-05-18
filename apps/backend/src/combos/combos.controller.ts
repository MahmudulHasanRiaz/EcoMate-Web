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
  ) {
    return this.combosService.findAll({
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 10,
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

  @Post()
  async create(@Body() dto: CreateComboDto) {
    return this.combosService.create(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateComboDto) {
    return this.combosService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.combosService.remove(id);
  }
}
