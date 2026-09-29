import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectTransferRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
