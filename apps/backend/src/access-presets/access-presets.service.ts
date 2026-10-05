import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
import { CreateAccessPresetDto } from './dto/create-access-preset.dto';
import { UpdateAccessPresetDto } from './dto/update-access-preset.dto';

@Injectable()
export class AccessPresetsService {
  constructor(
    private prisma: PrismaService,
    private permissionsService: PermissionsService,
  ) {}

  async findAll(page = 1, perPage = 20, search?: string) {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            {
              description: { contains: search, mode: 'insensitive' as const },
            },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.accessPreset.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accessPreset.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const preset = await this.prisma.accessPreset.findUnique({
      where: { id },
    });
    if (!preset) throw new NotFoundException('Access preset not found');
    return preset;
  }

  async create(dto: CreateAccessPresetDto) {
    const existing = await this.prisma.accessPreset.findUnique({
      where: { name: dto.name },
    });
    if (existing)
      throw new ConflictException('Access preset name already exists');

    // Fail loudly on unknown keys. They were previously stored verbatim and
    // then stripped by sanitizePermissions at read time, so a typo produced a
    // preset that looked granted in the editor but granted nothing at all.
    this.permissionsService.assertKnownKeys(dto.permissions);

    return this.prisma.accessPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions,
      },
    });
  }

  async update(id: string, dto: UpdateAccessPresetDto) {
    const current = await this.findOne(id);

    if (dto.name) {
      const existing = await this.prisma.accessPreset.findUnique({
        where: { name: dto.name },
      });
      if (existing && existing.id !== id)
        throw new ConflictException('Access preset name already exists');
    }

    // System presets ship with the product and back the seeded defaults
    // (including the one assigned to newly hired employees), so they cannot be
    // renamed or emptied out from under those employees.
    if (current.isSystem && (dto.name || dto.permissions)) {
      throw new ForbiddenException(
        `"${current.name}" is a built-in preset and cannot be edited. Duplicate it to make changes.`,
      );
    }

    if (dto.permissions) {
      this.permissionsService.assertKnownKeys(dto.permissions);
    }

    return this.prisma.accessPreset.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const preset = await this.findOne(id);

    if (preset.isSystem) {
      throw new ForbiddenException(
        `"${preset.name}" is a built-in preset and cannot be deleted.`,
      );
    }

    const employeeCount = await this.prisma.employee.count({
      where: { accessPresetId: id },
    });
    if (employeeCount > 0)
      throw new ConflictException('Cannot delete preset assigned to employees');

    await this.prisma.accessPreset.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}
