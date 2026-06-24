import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async create(createSupplierDto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({
      where: { slug: createSupplierDto.slug },
    });

    if (existing) {
      throw new ConflictException('Supplier with this slug already exists');
    }

    return this.prisma.supplier.create({
      data: createSupplierDto,
    });
  }

  async findAll(activeOnly = false) {
    return this.prisma.supplier.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { purchases: true }
        }
      }
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found`);
    }

    return supplier;
  }

  async update(id: string, updateSupplierDto: UpdateSupplierDto) {
    await this.findOne(id);

    if (updateSupplierDto.slug) {
      const existing = await this.prisma.supplier.findUnique({
        where: { slug: updateSupplierDto.slug },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Supplier with this slug already exists');
      }
    }

    return this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.supplier.delete({
      where: { id },
    });
  }
}
