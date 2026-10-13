import { Module } from '@nestjs/common';
import { CodMismatchService } from './cod-mismatch.service';

@Module({ providers: [CodMismatchService], exports: [CodMismatchService] })
export class CodMismatchModule {}
