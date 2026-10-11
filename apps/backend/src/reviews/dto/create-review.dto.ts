import {
  IsString,
  IsNumber,
  IsOptional,
  IsNotEmpty,
  Min,
  Max,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsOptional()
  @ValidateIf((o) => o.customerName !== undefined)
  @IsString()
  @MinLength(2)
  customerName?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  text?: string;

  @IsString()
  @IsNotEmpty()
  mobile: string;
}
