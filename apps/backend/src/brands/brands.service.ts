import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  async create(createBrandDto: CreateBrandDto) {
    const existing = await this.prisma.brand.findUnique({
      where: { slug: createBrandDto.slug },
    });

    if (existing) {
      throw new ConflictException('Brand with this slug already exists');
    }

    return this.prisma.brand.create({
      data: createBrandDto,
    });
  }

  async findAll(activeOnly = false) {
    return this.prisma.brand.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    if (!brand) {
      throw new NotFoundException(`Brand with ID ${id} not found`);
    }

    return brand;
  }

  async update(id: string, updateBrandDto: UpdateBrandDto) {
    await this.findOne(id);

    if (updateBrandDto.slug) {
      const existing = await this.prisma.brand.findUnique({
        where: { slug: updateBrandDto.slug },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Brand with this slug already exists');
      }
    }

    return this.prisma.brand.update({
      where: { id },
      data: updateBrandDto,
      include: {
        _count: {
          select: { products: true },
        },
      },
    });
  }

  async remove(id: string) {
    const brand = await this.findOne(id);
    if (brand._count.products > 0) {
      throw new ConflictException(
        `Cannot delete brand "${brand.name}": ${brand._count.products} product(s) are associated with it`,
      );
    }
    return this.prisma.brand.delete({
      where: { id },
    });
  }
}
