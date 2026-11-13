import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStoreLocationDto,
  UpdateStoreLocationDto,
} from './dto/store-location.dto';

@Injectable()
export class StoreLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public storefront list: active locations only, in admin sort order. */
  async findAllPublic() {
    return this.prisma.storeLocation.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Public single location: inactive locations behave as not found. */
  async findOnePublic(id: string) {
    const location = await this.prisma.storeLocation.findFirst({
      where: { id, isActive: true },
    });
    if (!location) throw new NotFoundException('Store location not found');
    return location;
  }

  /** Admin list: every location, including inactive ones. */
  async findAllAdmin() {
    return this.prisma.storeLocation.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** Admin single location, regardless of isActive. */
  async findOneAdmin(id: string) {
    const location = await this.prisma.storeLocation.findUnique({
      where: { id },
    });
    if (!location) throw new NotFoundException('Store location not found');
    return location;
  }

  async create(dto: CreateStoreLocationDto) {
    return this.prisma.storeLocation.create({
      data: this.toData(dto),
    });
  }

  async update(id: string, dto: UpdateStoreLocationDto) {
    const existing = await this.prisma.storeLocation.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Store location not found');
    return this.prisma.storeLocation.update({
      where: { id },
      data: this.toData(dto),
    });
  }

  /**
   * HARD delete. Precedent in this codebase: cms-pages and brands both
   * hard-delete (`prisma.delete`). Safe here: no other model references a
   * StoreLocation, so there is nothing to orphan — unlike orders/products,
   * which soft-delete because of their history. Returns the same
   * `{ message }` shape as the CMS delete.
   */
  async remove(id: string) {
    const existing = await this.prisma.storeLocation.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Store location not found');
    await this.prisma.storeLocation.delete({ where: { id } });
    return { message: 'Store location deleted' };
  }

  /**
   * Normalises DTO input for Prisma: blank strings become null (so the
   * admin can clear an optional field), socials drop rows with a blank
   * platform or URL, and openingDate becomes a Date.
   */
  private toData(dto: CreateStoreLocationDto | UpdateStoreLocationDto) {
    const data: Record<string, unknown> = {};
    const blankToNull = (v: unknown) =>
      v === undefined ? undefined : v === '' || v === null ? null : v;
    for (const key of [
      'name',
      'type',
      'address',
      'city',
      'district',
      'phone',
      'email',
      'hours',
      'mapUrl',
      'photo',
    ] as const) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined) data[key] = blankToNull(value);
    }
    if (dto.socials !== undefined) {
      data.socials =
        dto.socials.filter((s) => s.platform?.trim() && s.url?.trim()) ?? [];
    }
    if (dto.comingSoon !== undefined) data.comingSoon = dto.comingSoon;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.openingDate !== undefined) {
      data.openingDate = dto.openingDate ? new Date(dto.openingDate) : null;
    }
    return data as any;
  }
}
