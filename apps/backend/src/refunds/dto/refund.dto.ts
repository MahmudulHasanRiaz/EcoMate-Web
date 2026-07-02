import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  Min,
  IsUUID,
} from 'class-validator';

export class CreateRefundDto {
  @IsUUID() orderId: string;
  @IsNumber() @Min(1) amount: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateRefundStatusDto {
  @IsString()
  @IsIn(['pending', 'approved', 'completed', 'rejected'])
  status: string;
  @IsOptional() @IsString() notes?: string;
}
