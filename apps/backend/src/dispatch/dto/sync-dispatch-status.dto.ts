import { IsArray, ArrayNotEmpty, IsString } from 'class-validator';

export class SyncDispatchStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}