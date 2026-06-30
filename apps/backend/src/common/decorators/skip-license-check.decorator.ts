import { SetMetadata } from '@nestjs/common';

export const SKIP_LICENSE_CHECK = 'skip_license_check';
export const SkipLicenseCheck = () => SetMetadata(SKIP_LICENSE_CHECK, true);
