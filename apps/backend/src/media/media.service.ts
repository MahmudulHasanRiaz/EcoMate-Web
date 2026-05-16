import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    type?: string;
    attached?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 24;
    const where: any = {};
    if (query.search)
      where.filename = { contains: query.search, mode: 'insensitive' };
    if (query.type === 'image') where.mimeType = { startsWith: 'image/' };
    if (query.type === 'video') where.mimeType = { startsWith: 'video/' };
    if (query.attached === 'yes') where.attachments = { some: {} };
    if (query.attached === 'no') where.attachments = { none: {} };

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          attachments: { select: { entityType: true, entityId: true } },
          _count: { select: { attachments: true } },
        },
      }),
      this.prisma.media.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { attachments: true, _count: { select: { attachments: true } } },
    });
    if (!media) throw new NotFoundException('Media not found');
    return media;
  }

  async getAttachments(id: string) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { attachments: true },
    });
    if (!media) throw new NotFoundException('Media not found');

    const details: {
      entityType: string;
      entityId: string;
      entityName: string;
    }[] = [];
    for (const att of media.attachments) {
      let entityName = att.entityId;
      if (att.entityType === 'product') {
        const product = await this.prisma.product.findUnique({
          where: { id: att.entityId },
          select: { name: true },
        });
        if (product) entityName = product.name;
      }
      details.push({
        entityType: att.entityType,
        entityId: att.entityId,
        entityName,
      });
    }
    return details;
  }

  async remove(id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');

    const urlParts = media.url.split('/');
    const filename = urlParts[urlParts.length - 1];
    await this.storage.delete(filename);
    await this.prisma.media.delete({ where: { id } });

    return { message: 'Media deleted' };
  }

  async attach(mediaId: string, entityType: string, entityId: string) {
    return this.prisma.mediaAttachment.upsert({
      where: { mediaId_entityType_entityId: { mediaId, entityType, entityId } },
      create: { mediaId, entityType, entityId },
      update: {},
    });
  }

  async detach(mediaId: string, entityType: string, entityId: string) {
    await this.prisma.mediaAttachment.deleteMany({
      where: { mediaId, entityType, entityId },
    });
    return { message: 'Detached' };
  }

  async syncAttachments(
    entityType: string,
    entityId: string,
    mediaIds: string[],
  ) {
    await this.prisma.mediaAttachment.deleteMany({
      where: {
        entityType,
        entityId,
        mediaId: { notIn: mediaIds.length ? mediaIds : ['__none__'] },
      },
    });
    for (const mId of mediaIds) {
      await this.prisma.mediaAttachment.upsert({
        where: {
          mediaId_entityType_entityId: { mediaId: mId, entityType, entityId },
        },
        create: { mediaId: mId, entityType, entityId },
        update: {},
      });
    }
  }
}
