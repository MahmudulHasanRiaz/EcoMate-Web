import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateNotificationSettingDto } from './dto/create-notification-setting.dto';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';
import { SendNotificationDto } from './dto/send-notification.dto';

@Controller('notifications')
@RequiresFeature('admin_notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get('settings')
  findAllSettings() {
    return this.svc.findAllSettings();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('settings')
  createSetting(@Body() dto: CreateNotificationSettingDto) {
    return this.svc.createSetting(dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Put('settings/:id')
  updateSetting(@Param('id') id: string, @Body() dto: UpdateNotificationSettingDto) {
    return this.svc.updateSetting(id, dto);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Delete('settings/:id')
  removeSetting(@Param('id') id: string) {
    return this.svc.removeSetting(id);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Post('send')
  sendNotification(@Body() dto: SendNotificationDto, @CurrentUser() user: any) {
    return this.svc.sendNotification(dto, user?.userId);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('logs')
  findAllLogs(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.findAllLogs(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
      channel,
      status,
    );
  }
}
