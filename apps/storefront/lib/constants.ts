export const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

export interface Category {
  id: string;
  name: string;
  image: string;
  slug: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "1",
    name: "Repair Services",
    image:
      "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?auto=format&fit=crop&q=80&w=200",
    slug: "repair",
  },
  {
    id: "2",
    name: "Accessories",
    image:
      "https://images.unsplash.com/photo-1546868889-4e0c68a242ac?auto=format&fit=crop&q=80&w=200",
    slug: "accessories",
  },
  {
    id: "3",
    name: "Smart Gadgets",
    image:
      "https://images.unsplash.com/photo-1502419678662-da6656bfc197?auto=format&fit=crop&q=80&w=200",
    slug: "gadgets",
  },
  {
    id: "4",
    name: "Premium Phones",
    image:
      "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&q=80&w=200",
    slug: "phones",
  },
];

export const PRODUCTS = [
  {
    id: "p1",
    name: "iPhone 15 Pro Max Screen Repair",
    price: 35000,
    originalPrice: 38000,
    saveAmount: 3000,
    image: "https://images.unsplash.com/photo-1635334241088-29177114ff06?auto=format&fit=crop&q=80&w=600",
    category: "repair",
    badge: "Most Popular"
  },
  {
    id: "p2",
    name: "MagSafe Silicone Case for iPhone 15",
    price: 2500,
    originalPrice: 3500,
    saveAmount: 1000,
    image: "https://images.unsplash.com/photo-1603313011101-31c23a4a5b81?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  },
  {
    id: "p3",
    name: "Apple AirPods Pro (2nd Generation)",
    price: 24500,
    originalPrice: 28000,
    saveAmount: 3500,
    image: "https://images.unsplash.com/photo-1588423713664-01d54424344a?auto=format&fit=crop&q=80&w=600",
    category: "gadgets",
    badge: "Sale"
  },
  {
    id: "p4",
    name: "Samsung Galaxy S24 Ultra Battery Change",
    price: 8500,
    originalPrice: 10000,
    saveAmount: 1500,
    image: "https://images.unsplash.com/photo-1610940882244-5966236ca94c?auto=format&fit=crop&q=80&w=600",
    category: "repair",
  },
  {
    id: "p5",
    name: "Apple Watch Series 9 GPS 45mm",
    price: 45000,
    originalPrice: 48000,
    saveAmount: 3000,
    image: "https://images.unsplash.com/photo-1434493907317-a46b53b81822?auto=format&fit=crop&q=80&w=600",
    category: "gadgets",
  },
  {
    id: "p6",
    name: "USB-C to Lightning Cable (2m)",
    price: 1800,
    originalPrice: 2200,
    saveAmount: 400,
    image: "https://images.unsplash.com/photo-1585144860106-998ca0f2922a?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  },
  {
    id: "p7",
    name: "Full Phone Custom Skin",
    price: 1200,
    originalPrice: 1500,
    saveAmount: 300,
    image: "https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  },
  {
    id: "p8",
    name: "Google Pixel 8 Pro Tempered Glass",
    price: 800,
    originalPrice: 1200,
    saveAmount: 400,
    image: "https://images.unsplash.com/photo-1599249300675-c39f1dd2d6be?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  },
  {
    id: "p9",
    name: "DJI Osmo Mobile 6 Gimbal",
    price: 16500,
    originalPrice: 18000,
    saveAmount: 1500,
    image: "https://images.unsplash.com/photo-1540608801275-6e88301ec114?auto=format&fit=crop&q=80&w=600",
    category: "gadgets",
  },
  {
    id: "p10",
    name: "Apple 20W USB-C Power Adapter",
    price: 2200,
    originalPrice: 2800,
    saveAmount: 600,
    image: "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  },
  {
    id: "p11",
    name: "iPad Air 5th Gen (Wi-Fi, 64GB)",
    price: 68000,
    originalPrice: 72000,
    saveAmount: 4000,
    image: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&q=80&w=600",
    category: "phones",
  },
  {
    id: "p12",
    name: "MacBook Air M2 Screen Replacement",
    price: 45000,
    originalPrice: 50000,
    saveAmount: 5000,
    image: "https://images.unsplash.com/photo-1611186871348-b1ec696e52c9?auto=format&fit=crop&q=80&w=600",
    category: "repair",
  },
  {
    id: "p13",
    name: "Sony WH-1000XM5 Headphones",
    price: 36500,
    originalPrice: 40000,
    saveAmount: 3500,
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=600",
    category: "gadgets",
  },
  {
    id: "p14",
    name: "Apple Pencil (2nd Generation)",
    price: 13500,
    originalPrice: 15000,
    saveAmount: 1500,
    image: "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  },
  {
    id: "p15",
    name: "Nothing Phone (2) 12/256GB",
    price: 54000,
    originalPrice: 58000,
    saveAmount: 4000,
    image: "https://images.unsplash.com/photo-1688649102473-099b9d16aa32?auto=format&fit=crop&q=80&w=600",
    category: "phones",
  },
  {
    id: "p16",
    name: "Anker 737 Power Bank (PowerCore 24K)",
    price: 14500,
    originalPrice: 16000,
    saveAmount: 1500,
    image: "https://images.unsplash.com/photo-1619441207978-3d326c46e2c9?auto=format&fit=crop&q=80&w=600",
    category: "accessories",
  }
] as const;
