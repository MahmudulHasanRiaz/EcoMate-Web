"use client";

import { ProductImageGallery } from '../ProductImageGallery';
import type { MediaMeta } from '@/lib/types';

interface Props {
  images: string[];
  productName: string;
  mediaMeta?: MediaMeta;
  fallbackImage?: string;
  galleryKey: string;
}

/**
 * PDP gallery unit (mockup §2): desktop = vertical thumb strip + 4:5 main
 * with counter; mobile = swipe slides + horizontal thumb row below.
 * All behavior (autoplay, lightbox, swipe) lives in ProductImageGallery —
 * this unit owns layout only, so §3 gallery behavior cannot regress here.
 */
export function PdpGallery({ images, productName, mediaMeta, fallbackImage, galleryKey }: Props) {
  return (
    <div className="pdp-gallery min-w-0" data-testid="pdp-gallery">
      <ProductImageGallery
        key={galleryKey}
        images={images}
        productName={productName}
        mediaMeta={mediaMeta}
        fallbackImage={fallbackImage}
      />
    </div>
  );
}
