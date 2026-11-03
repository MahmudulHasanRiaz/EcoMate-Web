import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MediaDerivatives {
  derivativeManifest: Record<string, string> | null;
  blurUrl: string | null;
  updatedAt: Date;
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
      select: {
        url: true,
        derivativeManifest: true,
        blurUrl: true,
        updatedAt: true,
      },
    });

    const map: DerivativeMap = {};
    for (const m of media) {
      map[m.url] = {
        derivativeManifest: m.derivativeManifest as Record<string, string> | null,
        blurUrl: m.blurUrl,
        updatedAt: m.updatedAt,
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

  /**
   * Format-aware resolution (P3). Manifest keys are additive:
   * `<variant>` = WebP, `<variant>_avif` = AVIF, `<variant>_jpg` = JPEG.
   * Asking for 'avif' on a pre-P3 manifest (no `_avif` key) falls back
   * to the WebP URL — old media keep working until backfilled.
   */
  resolveFormat(
    manifest: Record<string, string> | null | undefined,
    variant: 'thumbnail' | 'small' | 'medium' | 'large',
    format: 'avif' | 'webp' | 'jpeg' = 'webp',
  ): string | null {
    if (!manifest) return null;
    if (format === 'avif') return manifest[`${variant}_avif`] ?? manifest[variant] ?? null;
    if (format === 'jpeg') return manifest[`${variant}_jpg`] ?? manifest[variant] ?? null;
    return manifest[variant] ?? null;
  }

  resolveBlur(
    derivatives: MediaDerivatives | undefined,
  ): string | null {
    return derivatives?.blurUrl ?? null;
  }
}
