import { IsOptional, IsString } from 'class-validator';

export class RefreshCustomerHistoryDto {
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  courier?: string;
}