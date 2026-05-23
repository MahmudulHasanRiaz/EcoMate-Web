"use client";

import React from 'react';
import { ShoppingCart } from "lucide-react";
import type { Product } from "@/lib/types";
import { useCart } from "@/context/CartContext";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/tracking";

const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { items, addToCart, updateQuantity } = useCart();
  const router = useRouter();
  const [imageError, setImageError] = React.useState(false);

  const cartItem = items.find((item) => item.id === product.id);
  const inCart = !!cartItem;
  const quantity = cartItem?.quantity || 0;

  const handleAddToCart = (e: React.MouseEvent<HTMLButtonElement>) => {
    const img = document.getElementById(`img-${product.id}`);
    let x = 0, y = 0;
    if (img) {
      const rect = img.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    }
    window.dispatchEvent(new CustomEvent('fly-to-cart', {
      detail: { x, y, image: imageError ? PLACEHOLDER_IMAGE : product.image }
    }));
    trackEvent('AddToCart', { 
      content_ids: [product.id], 
      value: product.price, 
      currency: 'BDT',
      contents: [{ id: product.id, quantity: 1, item_price: product.price }]
    });
    addToCart({
      id: product.id,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      image: product.image,
      quantity: 1,
      slug: product.slug,
      category: product.category,
    });
  };

  const imageSrc = imageError || !product.image ? PLACEHOLDER_IMAGE : product.image;
  const linkUrl = product.slug ? `/products/${product.slug}` : `/products/${product.id}`;

  return (
    <div className="bg-white rounded-[8px] overflow-hidden flex flex-col h-full border border-gray-200 relative group transition-all">
      {(product.saveAmount && product.originalPrice) && (
        <div className="absolute top-2 right-2 bg-[#2ecc71] text-white text-[10px] md:text-[11px] px-2 py-0.5 rounded-sm z-10 font-bold shadow-sm">
          Save {Math.round((product.saveAmount / product.originalPrice) * 100)}%
        </div>
      )}

      <div className="relative w-full aspect-square bg-white flex items-center justify-center p-0 cursor-pointer overflow-hidden"
        onClick={() => router.push(linkUrl)}>
        <motion.img id={`img-${product.id}`}
          whileHover={{ scale: 1.05 }} transition={{ duration: 0.4, ease: "easeOut" }}
          src={imageSrc} alt={product.name} className="w-full h-full object-contain"
          onError={() => setImageError(true)} />
      </div>

      <div className="p-2 md:p-3 flex flex-col flex-1 bg-white">
        <h4 className="text-[12px] md:text-[14px] text-gray-800 line-clamp-2 mb-2 font-medium leading-normal cursor-pointer hover:text-brand-blue transition-colors min-h-[2.2rem] md:min-h-[2.5rem]"
          onClick={() => router.push(linkUrl)}>
          {product.name}
        </h4>

        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[15px] md:text-[18px] font-black text-brand-blue">৳{product.price.toLocaleString()}</span>
            {product.originalPrice && (
              <span className="text-[12px] md:text-[14px] font-medium text-gray-300 line-through">৳{product.originalPrice.toLocaleString()}</span>
            )}
          </div>

          {inCart ? (
            <div className="flex items-center h-[34px] md:h-[40px] w-full border-2 border-brand-blue/20 rounded-lg overflow-hidden">
              <button onClick={() => updateQuantity(product.id, quantity - 1)}
                className="w-10 h-full bg-white text-brand-blue border-r border-brand-blue/10 flex items-center justify-center font-black hover:bg-brand-blue/5 transition-colors">-</button>
              <div className="flex-1 h-full flex items-center justify-center font-black text-brand-blue bg-brand-blue/5 text-[14px]">{quantity}</div>
              <button onClick={() => updateQuantity(product.id, quantity + 1)}
                className="w-10 h-full bg-white text-brand-blue border-l border-brand-blue/10 flex items-center justify-center font-black hover:bg-brand-blue/5 transition-colors">+</button>
            </div>
          ) : (
            <button onClick={handleAddToCart}
              className="w-full h-[34px] md:h-[40px] bg-white text-brand-blue font-bold text-[12px] md:text-[13px] border-2 border-brand-blue/20 rounded-lg flex items-center justify-center gap-2 hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all group/btn">
              <ShoppingCart size={16} strokeWidth={2.5} className="group-hover/btn:scale-110 transition-transform" />
              ADD TO CART
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
