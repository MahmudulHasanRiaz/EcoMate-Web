import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDeviceMappingDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  deviceEmployeeId: string;
}