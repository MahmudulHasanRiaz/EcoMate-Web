import {
  IsString,
  IsInt,
  IsOptional,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
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
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsString()
  @IsNotEmpty()
  mobile: string;
}
