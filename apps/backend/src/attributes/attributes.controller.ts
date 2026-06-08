import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AttributesService } from './attributes.service';
import {
  CreateAttributeDto,
  UpdateAttributeDto,
  CreateAttributeValueDto,
} from './dto/attribute.dto';

@Controller('attributes')
export class AttributesController {
  constructor(private readonly svc: AttributesService) {}

  @Get() findAll() {
    return this.svc.findAll();
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post() create(@Body() dto: CreateAttributeDto) {
    return this.svc.create(dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateAttributeDto) {
    return this.svc.update(id, dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Delete(':id') remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/values') addValue(
    @Param('id') id: string,
    @Body() dto: CreateAttributeValueDto,
  ) {
    return this.svc.addValue(id, dto);
  }
  @Roles('superadmin', 'admin', 'manager')
  @Delete(':id/values/:valueId') removeValue(
    @Param('valueId') valueId: string,
  ) {
    return this.svc.removeValue(valueId);
  }
}
