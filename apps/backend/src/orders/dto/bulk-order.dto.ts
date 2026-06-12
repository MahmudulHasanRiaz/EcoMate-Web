import { IsArray, IsString, ValidateIf } from 'class-validator';

export class BulkOrdersDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class BulkStatusDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsString()
  statusId: string;
}

export class BulkDispatchDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @IsString()
  courier: string;
}

export class BulkAssignDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @ValidateIf((o) => o.assignedToId !== null)
  @IsString()
  assignedToId: string | null;
}
