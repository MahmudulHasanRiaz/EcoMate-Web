import {
  IsArray,
  IsInt,
  ArrayMaxSize,
  IsOptional,
  IsString,
} from 'class-validator';

export class SetScheduleDto {
  @IsArray()
  @IsInt({ each: true })
  @ArrayMaxSize(7)
  days: number[];

  @IsOptional()
  @IsString()
  note?: string;
}