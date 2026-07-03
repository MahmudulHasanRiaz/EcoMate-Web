import { IsString, IsNumber, Min } from 'class-validator';

export class OpenSessionDto {
  @IsString()
  showroomId: string;

  @IsNumber()
  @Min(0)
  openingBalance: number;
}
