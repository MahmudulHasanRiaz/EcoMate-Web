"use client";

import type { Product } from '@/lib/types';
import VideoEmbed from '../VideoEmbed';

interface Props {
  product: Product;
  /** variant size values for the `Size Available` details row */
  sizeValues: string[];
  // Server-sanitized HTML (page.tsx runs sanitizeProductHTML on the server,
  // so isomorphic-dompurify never ships to the browser). Required: rendering
  // raw product HTML would be an XSS hole.
  sanitizedDescription: string;
  sanitizedSpecifications: string;
}

/**
 * PDP content sections (mockup §6 order): video → description → key
 * features → product details → perfect-for. Every section hides when its
 * data source is absent; nothing is hardcoded. Colors are theme tokens.
 */
export function PdpSections({ product, sizeValues, sanitizedDescription, sanitizedSpecifications }: Props) {
  const sections = product.descriptionSections;
  const rows = Array.isArray(product.detailRows) ? product.detailRows : [];
  const tags = product.tags || [];

  return (
    <div>
      {/* Mobile only: on desktop the video lives under the gallery in the
          hero grid (see ProductDetailClient), where it fills the column
          instead of sitting as a full-width block above Description. */}
      {product.videoUrl && (
        <div className="min-[901px]:hidden">
          <VideoEmbed key={product.videoUrl} url={product.videoUrl} />
        </div>
      )}

      {product.description && (
        <div className="mb-6">
          <h2 className="text-[19px] font-medium text-brand-dark m-0 mb-[14px]">Description</h2>
          <div
            className="prose prose-sm max-w-none text-[14px] text-gray-600 leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_strong]:font-semibold [&_a]:text-blue-600 [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
          />
        </div>
      )}

      {sections?.benefits && sections.benefits.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[19px] font-medium text-brand-dark m-0 mb-[14px]">Key Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {sections.benefits.map((benefit, i) => (
              <div key={i} className="flex gap-[10px] text-[15px] text-gray-700">
                <span className="text-brand-success flex-shrink-0">✓</span>
                <span>{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(rows.length > 0 || sections?.specifications) && (
        <div className="mb-6">
          <h3 className="text-[19px] font-medium text-brand-dark m-0 mb-[14px]">Product Details</h3>
          <div className="border border-brand-border rounded-[3px] bg-white px-[18px]">
            {rows.length > 0 ? (
              <dl className="m-0">
                {rows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-[11px] border-t border-brand-border first:border-t-0 text-[14px] items-center">
                    <dt className="text-gray-500 text-[13px]">{row.label}</dt>
                    <dd className="m-0 text-brand-dark font-medium">{row.value}</dd>
                  </div>
                ))}
                {sizeValues.length > 0 && (
                  <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-[11px] border-t border-brand-border text-[14px] items-center">
                    <dt className="text-gray-500 text-[13px]">Size Available</dt>
                    <dd className="m-0 text-brand-dark font-medium flex items-center gap-2 flex-wrap">
                      {sizeValues.map((s) => (
                        <span key={s} className="border border-brand-border rounded-[3px] text-[12px] px-[9px] leading-[22px] font-medium bg-white">{s}</span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <div
                className="px-0 py-3 text-[13px] text-gray-500 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizedSpecifications }}
              />
            )}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[19px] font-medium text-brand-dark m-0 mb-[14px]">Perfect For</h3>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="border border-brand-border rounded-[3px] text-[12px] px-[9px] leading-[22px] font-medium bg-white text-brand-dark">{tag}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
