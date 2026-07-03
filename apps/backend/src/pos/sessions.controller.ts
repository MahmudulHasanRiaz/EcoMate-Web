import { Controller, Post, Get, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('pos/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionsController {
  constructor(private readonly svc: SessionsService) {}

  @Post()
  @Roles('cashier', 'admin')
  open(@Body() dto: OpenSessionDto, @Req() req: any) {
    return this.svc.open(dto, req.user.id);
  }

  @Get('active')
  @Roles('cashier', 'admin')
  getActive(@Req() req: any, @Query('showroomId') showroomId: string) {
    return this.svc.getActive(req.user.id, showroomId);
  }

  @Patch(':id/close')
  @Roles('cashier', 'admin')
  close(@Param('id') id: string, @Body() dto: CloseSessionDto, @Req() req: any) {
    return this.svc.close(id, dto, req.user.id);
  }

  @Get(':id/orders')
  @Roles('cashier', 'admin')
  getOrders(@Param('id') id: string) {
    return this.svc.getOrders(id);
  }
}
