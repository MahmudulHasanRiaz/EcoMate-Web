import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MediaDerivatives {
  derivativeManifest: Record<string, string> | null;
  blurUrl: string | null;
}

export type DerivativeMap = Record<string, MediaDerivatives>;

@Injectable()
export class MediaResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(urls: string[]): Promise<DerivativeMap> {
    const unique = [...new Set(urls.filter(Boolean))];
    if (unique.length === 0) return {};

    const media = await this.prisma.media.findMany({
      where: { url: { in: unique } },
      select: { url: true, derivativeManifest: true, blurUrl: true },
    });

    const map: DerivativeMap = {};
    for (const m of media) {
      map[m.url] = {
        derivativeManifest: m.derivativeManifest as Record<string, string> | null,
        blurUrl: m.blurUrl,
      };
    }
    return map;
  }

  resolveBest(
    manifest: Record<string, string> | null | undefined,
    variant: 'thumbnail' | 'small' | 'medium' | 'large',
  ): string | null {
    return manifest?.[variant] ?? null;
  }

  resolveBlur(
    derivatives: MediaDerivatives | undefined,
  ): string | null {
    return derivatives?.blurUrl ?? null;
  }
}
