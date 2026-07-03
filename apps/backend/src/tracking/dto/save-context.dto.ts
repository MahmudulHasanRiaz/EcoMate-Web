import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SaveContextDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsOptional()
  fbp?: string;

  @IsString()
  @IsOptional()
  fbc?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  referrer?: string;
}
