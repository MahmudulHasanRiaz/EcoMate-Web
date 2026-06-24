import { PartialType } from '@nestjs/mapped-types';
import { CreateNotificationSettingDto } from './create-notification-setting.dto';

export class UpdateNotificationSettingDto extends PartialType(CreateNotificationSettingDto) {}
