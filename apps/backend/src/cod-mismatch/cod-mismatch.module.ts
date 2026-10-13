import { Module } from '@nestjs/common';
import { CodMismatchService } from './cod-mismatch.service';
import { CodMismatchController } from './cod-mismatch.controller';

@Module({
  controllers: [CodMismatchController],
  providers: [CodMismatchService],
  exports: [CodMismatchService],
})
export class CodMismatchModule {}
