import { Module } from '@nestjs/common';
import { AccessPresetsController } from './access-presets.controller';
import { AccessPresetsService } from './access-presets.service';

@Module({
  controllers: [AccessPresetsController],
  providers: [AccessPresetsService],
  exports: [AccessPresetsService],
})
export class AccessPresetsModule {}
