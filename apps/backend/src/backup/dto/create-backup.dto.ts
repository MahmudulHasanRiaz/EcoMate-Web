import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateBackupDto {
  @IsIn(['db_only', 'db_files'])
  scope: 'db_only' | 'db_files';
}