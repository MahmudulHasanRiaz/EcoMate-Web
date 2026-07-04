import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAttributeDto,
  UpdateAttributeDto,
  CreateAttributeValueDto,
} from './dto/attribute.dto';

const COLOR_MAP: Record<string, string> = {
  red: '#EF4444', blue: '#3B82F6', green: '#22C55E', yellow: '#EAB308',
  orange: '#F97316', purple: '#A855F7', pink: '#EC4899', brown: '#92400E',
  grey: '#6B7280', gray: '#6B7280', black: '#000000', white: '#FFFFFF',
  cyan: '#06B6D4', teal: '#14B8A6', lime: '#84CC16', amber: '#F59E0B',
  indigo: '#6366F1', violet: '#8B5CF6', fuchsia: '#D946EF', rose: '#F43F5E',
  navy: '#1E3A5F', maroon: '#800020', coral: '#FF7F50', gold: '#D4AF37',
  silver: '#C0C0C0', beige: '#F5F5DC', khaki: '#C3B091', ivory: '#FFFFF0',
  burgundy: '#800020', mint: '#98FF98', lavender: '#E6E6FA', peach: '#FFDAB9',
  turquoise: '#40E0D0', salmon: '#FA8072', plum: '#DDA0DD', olive: '#808000',
};

function nameToHex(name: string): string {
  const key = name.toLowerCase().trim();
  if (COLOR_MAP[key]) return COLOR_MAP[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return hslToHex(hue, 55, 45);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

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
    const existing = await this.prisma.attribute.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Attribute already exists');

    return this.prisma.attribute.create({
      data: {
        name: dto.name,
        values: dto.values?.length
          ? {
              createMany: {
                data: dto.values.map((v) => ({
                  value: v.value,
                  hexCode: v.hexCode || nameToHex(v.value),
                  sortOrder: v.sortOrder ?? 0,
                })),
              },
            }
          : undefined,
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
    await this.prisma.attribute.delete({ where: { id } });
    return { message: 'Attribute deleted' };
  }

  async addValue(attributeId: string, dto: CreateAttributeValueDto) {
    const attr = await this.prisma.attribute.findUnique({
      where: { id: attributeId },
      select: { id: true },
    });
    if (!attr) throw new NotFoundException('Attribute not found');

    const existing = await this.prisma.attributeValue.findFirst({
      where: { attributeId, value: dto.value },
    });
    if (existing)
      throw new ConflictException('Value already exists for this attribute');

    return this.prisma.attributeValue.create({
      data: {
        value: dto.value,
        hexCode: dto.hexCode || nameToHex(dto.value),
        sortOrder: dto.sortOrder ?? 0,
        attributeId,
      },
    });
  }

  async removeValue(valueId: string) {
    await this.prisma.attributeValue.delete({ where: { id: valueId } });
    return { message: 'Value deleted' };
  }
}
