"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import apiClient from "@/lib/api-client";

interface ReviewItem {
  id: string;
  customerName: string;
  rating: number;
  text: string | null;
  createdAt: string;
  product: {
    id: string;
    name: string;
    slug: string;
    images: string[];
  };
}

export default function Testimonials() {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get("/reviews/latest", { params: { limit: 6 } })
      .then((res) => setReviews(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const items = reviews.slice(0, 6);

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="py-12 bg-[#fcfcfc]">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {items.map((r) => {
            const imgKey = r.id;
            const productImage =
              r.product?.images?.[0] || PLACEHOLDER_IMAGE;
            return (
              <div
                key={r.id}
                className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm text-left"
              >
                <div className="flex items-center gap-1 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={14}
                      className={
                        i < r.rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-gray-200"
                      }
                    />
                  ))}
                </div>
                <p className="text-[13px] md:text-[14px] text-gray-600 italic mb-6 leading-relaxed">
                  &ldquo;{r.text}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <img
                    src={imgErrors[imgKey] ? PLACEHOLDER_IMAGE : productImage}
                    alt={r.customerName}
                    className="w-10 h-10 rounded-full object-cover border border-gray-100 bg-gray-50"
                    onError={() =>
                      setImgErrors((prev) => ({ ...prev, [imgKey]: true }))
                    }
                  />
                  <div>
                    <h4 className="text-[14px] font-bold text-gray-800">
                      {r.customerName}
                    </h4>
                    <p className="text-[11px] text-gray-400 font-medium">
                      {r.product?.name || "Verified Buyer"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
