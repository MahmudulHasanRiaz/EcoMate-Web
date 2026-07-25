export interface BackupJob {
  id: string;
  type: 'manual' | 'scheduled';
  scope: 'db_only' | 'db_files';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'restoring';
  fileKey: string | null;
  fileSize: number | null;
  checksum: string | null;
  dbDumpSize: number | null;
  filesSize: number | null;
  locked: boolean;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupListResponse {
  items: BackupJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BackupSettings {
  [key: string]: string;
}