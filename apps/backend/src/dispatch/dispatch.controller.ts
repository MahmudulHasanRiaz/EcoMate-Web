import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { DispatchQueryDto } from './dto/dispatch-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  findAll(@Query() query: DispatchQueryDto) {
    return this.dispatchService.findAll(query);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('metrics')
  getMetrics() {
    return this.dispatchService.getMetrics();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('flagged')
  findFlagged() {
    return this.dispatchService.findFlagged();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post(':id/resolve-flagged')
  resolveFlagged(
    @Param('id') id: string,
    @Body('action') action: 'accept' | 'accessories' | 'cancel',
  ) {
    return this.dispatchService.resolveFlagged(id, action);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post()
  create(@Body() dto: CreateDispatchDto) {
    return this.dispatchService.create(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: { email: string },
    @Body('performedBy') performedBy?: string,
  ) {
    return this.dispatchService.updateStatus(id, status, performedBy || user.email);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin')
  remove(@Param('id') id: string) {
    return this.dispatchService.remove(id);
  }
}
