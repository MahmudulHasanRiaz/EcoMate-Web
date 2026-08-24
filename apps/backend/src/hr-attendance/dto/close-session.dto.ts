import { IsNotEmpty, IsString } from 'class-validator';

export class CloseSessionDto {
  @IsString()
  @IsNotEmpty()
  dayId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
