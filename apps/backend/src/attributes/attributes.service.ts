import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAttributeDto, UpdateAttributeDto, CreateAttributeValueDto } from './dto/attribute.dto';

@Injectable()
export class AttributesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.attribute.findMany({
      include: { values: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const attr = await this.prisma.attribute.findUnique({
      where: { id },
      include: { values: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!attr) throw new NotFoundException('Attribute not found');
    return attr;
  }

  async create(dto: CreateAttributeDto) {
    const existing = await this.prisma.attribute.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Attribute already exists');

    return this.prisma.attribute.create({
      data: {
        name: dto.name,
        values: dto.values ? {
          createMany: { data: dto.values as any[] },
        } : undefined,
      },
      include: { values: true },
    });
  }

  async update(id: string, dto: UpdateAttributeDto) {
    const attr = await this.prisma.attribute.findUnique({ where: { id } });
    if (!attr) throw new NotFoundException('Attribute not found');
    return this.prisma.attribute.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.attribute.findUniqueOrThrow({ where: { id } });
    await this.prisma.attribute.delete({ where: { id } });
    return { message: 'Attribute deleted' };
  }

  async addValue(attributeId: string, dto: CreateAttributeValueDto) {
    await this.prisma.attribute.findUniqueOrThrow({ where: { id: attributeId } });
    return this.prisma.attributeValue.create({
      data: { value: dto.value, sortOrder: dto.sortOrder || 0, attributeId },
    });
  }

  async removeValue(valueId: string) {
    await this.prisma.attributeValue.delete({ where: { id: valueId } });
    return { message: 'Value deleted' };
  }
}
