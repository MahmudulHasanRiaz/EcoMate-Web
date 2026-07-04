import { IsOptional, IsString } from 'class-validator';

export class UpdateDispatchDto {
  @IsOptional()
  @IsString()
  status?: string;
  @IsOptional()
  @IsString()
  trackingCode?: string;
  @IsOptional()
  @IsString()
  notes?: string;
  @IsOptional()
  productMapping?: any;
}
