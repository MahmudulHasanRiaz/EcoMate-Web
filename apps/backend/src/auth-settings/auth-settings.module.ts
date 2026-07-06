import { Module } from '@nestjs/common';
import { AuthSettingsService } from './auth-settings.service';
import { AuthSettingsController } from './auth-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthSettingsController],
  providers: [AuthSettingsService],
  exports: [AuthSettingsService],
})
export class AuthSettingsModule {}
