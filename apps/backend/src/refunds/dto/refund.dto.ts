import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class CreateRefundDto {
  @IsString() orderId: string;
  @IsNumber() amount: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateRefundStatusDto {
  @IsString() @IsIn(['pending', 'approved', 'completed', 'rejected']) status: string;
  @IsOptional() @IsString() notes?: string;
}
