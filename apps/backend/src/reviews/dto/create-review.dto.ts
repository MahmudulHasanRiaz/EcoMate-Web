import { IsString, IsNumber, IsOptional, Min, Max, MinLength } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  productId: string;

  @IsString()
  @MinLength(2)
  customerName: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  text?: string;
}
