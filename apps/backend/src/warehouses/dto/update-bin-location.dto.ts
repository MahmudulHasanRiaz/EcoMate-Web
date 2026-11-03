import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateBinLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  // Warehouse move (2026-11-03): the admin bin-edit form's Warehouse select
  // used to be silently dropped because this DTO had no warehouseId at all —
  // the edit looked inert. When it differs from the bin's current warehouse
  // the service performs a validated move (see WarehousesService).
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @IsString()
  rackId?: string;

  @IsOptional()
  @IsString()
  shelfId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
