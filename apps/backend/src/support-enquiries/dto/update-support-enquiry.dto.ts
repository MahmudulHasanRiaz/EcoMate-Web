import { IsIn, IsString } from 'class-validator';

export const SUPPORT_ENQUIRY_STATUSES = ['NEW', 'REPLIED'] as const;

export class UpdateSupportEnquiryDto {
  @IsString()
  @IsIn([...SUPPORT_ENQUIRY_STATUSES])
  status: 'NEW' | 'REPLIED';
}
