import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  provider: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsDateString()
  tokenExpiry?: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;
}

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsDateString()
  tokenExpiry?: string;

  @IsOptional()
  @IsString()
  providerUserId?: string;
}

export class AddAdAccountDto {
  @IsString()
  @IsNotEmpty()
  connectionId: string;

  @IsString()
  @IsNotEmpty()
  providerAccountId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class DiscoverAdAccountsDto {
  @IsString()
  @IsNotEmpty()
  connectionId: string;
}

export class UpdateAdAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  isActive?: boolean;
}

export class CreateFundingDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  fundingType?: string;

  @IsString()
  @IsNotEmpty()
  fundingSource: string;

  @IsDateString()
  fundingDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsNumber()
  @Min(0)
  currencyAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  baseCurrency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  effectiveRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class PostFundingDto {
  @IsString()
  @IsNotEmpty()
  fundingAccountId: string;
}

export class ConsumeFundingDto {
  @IsString()
  @IsNotEmpty()
  campaignId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}

export class CaptureSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionToken: string;

  @IsOptional()
  @IsString()
  visitorId?: string;

  @IsOptional()
  @IsString()
  fbclid?: string;

  @IsOptional()
  @IsString()
  clickId?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  utmContent?: string;

  @IsOptional()
  @IsString()
  utmTerm?: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  // Platform click ids beyond Meta — each one is the only proof of a paid click
  // on that platform, so they are accepted individually and folded into the
  // generic clickId column in precedence order.
  @IsOptional()
  @IsString()
  gclid?: string;

  @IsOptional()
  @IsString()
  wbraid?: string;

  @IsOptional()
  @IsString()
  gbraid?: string;

  @IsOptional()
  @IsString()
  msclkid?: string;

  @IsOptional()
  @IsString()
  ttclid?: string;

  @IsOptional()
  @IsString()
  twclid?: string;

  @IsOptional()
  @IsString()
  igshid?: string;

  @IsOptional()
  @IsString()
  landingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class CampaignAliasDto {
  @IsString()
  @IsNotEmpty()
  utmValue: string;

  @IsString()
  @IsNotEmpty()
  campaignId: string;
}

/** Replaces the whole alias map — the UI sends the full list it displays. */
export class SetCampaignAliasesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampaignAliasDto)
  aliases: CampaignAliasDto[];
}

export class AttributionRebuildDto {  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  isArchived?: boolean;
}

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerPaymentId?: string;

  @IsNumber()
  @Min(0)
  platformAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  platformCurrency?: string;

  @IsDateString()
  paymentDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  sourceAccountId?: string;
}

export class ReconcilePaymentDto {
  @IsNumber()
  @Min(0)
  actualCost: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  baseCurrency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  feeAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  processingFee?: number;
}