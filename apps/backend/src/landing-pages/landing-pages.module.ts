import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LandingPagesController } from './landing-pages.controller';
import { LandingPagesService } from './landing-pages.service';

@Module({
  imports: [PrismaModule],
  controllers: [LandingPagesController],
  providers: [LandingPagesService],
  exports: [LandingPagesService],
})
export class LandingPagesModule {}
