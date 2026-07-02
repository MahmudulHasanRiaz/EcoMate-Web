import { IsString, IsNotEmpty } from 'class-validator';

export class MergeTagsDto {
  @IsString()
  @IsNotEmpty()
  keepId: string;

  @IsString()
  @IsNotEmpty()
  removeId: string;
}
