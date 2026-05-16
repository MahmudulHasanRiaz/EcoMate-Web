import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
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
  @Post() create(@Body() dto: CreateAttributeDto) {
    return this.svc.create(dto);
  }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateAttributeDto) {
    return this.svc.update(id, dto);
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
  @Post(':id/values') addValue(
    @Param('id') id: string,
    @Body() dto: CreateAttributeValueDto,
  ) {
    return this.svc.addValue(id, dto);
  }
  @Delete(':id/values/:valueId') removeValue(
    @Param('valueId') valueId: string,
  ) {
    return this.svc.removeValue(valueId);
  }
}
