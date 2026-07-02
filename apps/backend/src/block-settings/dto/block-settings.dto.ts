import {
  ValidateNested,
  IsNumber,
  Min,
  IsBoolean,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

class PhoneOrderRestrictionDto {
  @IsNumber()
  @Min(1)
  maxOrders: number;

  @IsNumber()
  @Min(1)
  timeWindowMinutes: number;

  @IsNumber()
  @Min(1)
  blockDurationMinutes: number;
}

class IpOrderRestrictionDto {
  @IsNumber()
  @Min(1)
  maxOrders: number;

  @IsNumber()
  @Min(1)
  timeWindowMinutes: number;

  @IsNumber()
  @Min(1)
  blockDurationMinutes: number;
}

class AutoBlockDto {
  @IsNumber()
  @Min(1)
  failedLoginThreshold: number;

  @IsNumber()
  @Min(1)
  failedLoginWindowMinutes: number;

  @IsBoolean()
  autoFullBlockIp: boolean;

  @IsBoolean()
  autoOrderBlockIp: boolean;

  @IsBoolean()
  autoOrderBlockPhone: boolean;
}

class BlockMessageDto {
  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsString()
  ctaLabel: string;

  @IsString()
  ctaAction: string;
}

class BlockMessagesDto {
  @ValidateNested()
  @Type(() => BlockMessageDto)
  orderBlockPhone: BlockMessageDto;

  @ValidateNested()
  @Type(() => BlockMessageDto)
  orderBlockIp: BlockMessageDto;

  @ValidateNested()
  @Type(() => BlockMessageDto)
  fullBlockIp: BlockMessageDto;
}

export class BlockSettingsDto {
  @ValidateNested()
  @Type(() => PhoneOrderRestrictionDto)
  phoneOrderRestriction: PhoneOrderRestrictionDto;

  @ValidateNested()
  @Type(() => IpOrderRestrictionDto)
  ipOrderRestriction: IpOrderRestrictionDto;

  @ValidateNested()
  @Type(() => AutoBlockDto)
  autoBlock: AutoBlockDto;

  @ValidateNested()
  @Type(() => BlockMessagesDto)
  blockMessages: BlockMessagesDto;
}
