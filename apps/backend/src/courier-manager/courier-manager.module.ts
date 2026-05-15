import { Module } from '@nestjs/common';
import { CourierManagerController } from './courier-manager.controller';
import { CourierManagerService } from './courier-manager.service';

@Module({ controllers: [CourierManagerController], providers: [CourierManagerService] })
export class CourierManagerModule {}
