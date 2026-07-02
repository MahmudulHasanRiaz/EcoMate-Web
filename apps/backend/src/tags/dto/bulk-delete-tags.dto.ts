import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';

export class BulkDeleteTagsDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayMinSize(1)
  ids: string[];
}
