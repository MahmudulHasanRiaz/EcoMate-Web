import { serverFetch } from "@/lib/api-server";
import TestimonialsCarousel from "./TestimonialsCarousel";

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

async function getLatestReviews(): Promise<ReviewItem[]> {
  try {
    const data = await serverFetch<ReviewItem[]>("/reviews/latest?limit=6", {
      next: { revalidate: 300 },
    });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default async function Testimonials() {
  const reviews = await getLatestReviews();

  if (reviews.length === 0) return null;

  return (
    <section className="py-16 bg-[#fcfcfc] overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
          What Our Customers Say
        </h2>
        <p className="text-gray-500 text-sm md:text-base mb-10">
          Real reviews from real people
        </p>
        <TestimonialsCarousel reviews={reviews} />
      </div>
    </section>
  );
}
