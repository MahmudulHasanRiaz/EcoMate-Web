import { IsString } from 'class-validator';

export class RestoreBackupDto {
  @IsString()
  backupId: string;
}
