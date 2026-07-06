import { PartialType } from '@nestjs/mapped-types';
import { CreateAccessPresetDto } from './create-access-preset.dto';

export class UpdateAccessPresetDto extends PartialType(CreateAccessPresetDto) {}
