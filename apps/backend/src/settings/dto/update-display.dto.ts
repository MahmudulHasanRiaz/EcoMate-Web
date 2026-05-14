import { IsArray, IsString } from 'class-validator';

export class UpdateDisplayDto {
  @IsArray()
  @IsString({ each: true })
  items: string[];
}
