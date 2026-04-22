import React from "react";
import type { Product } from "../api/client";

interface Props {
  product: Product;
  highlighted?: boolean;
}

export default function ProductCard({ product, highlighted = false }: Props) {
  return (
    <div
      className={`group flex flex-col bg-app rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer relative
        ${highlighted
          ? "border border-primary/60 shadow-[0_0_18px_-4px_rgba(238,43,91,0.45)]"
          : "border border-white/5 hover:border-primary/30 hover:shadow-product"
        }`}
    >
      {highlighted && (
        <span className="absolute top-2 left-2 z-10 text-[10px] font-bold uppercase tracking-widest bg-primary text-white px-2 py-0.5 rounded-full">
          ✦ Pick
        </span>
      )}
      <div className="aspect-[4/5] bg-surface relative overflow-hidden">
        <img
          src={product.images[0]}
          alt={product.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-app/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      </div>
      <div className="p-3 flex flex-col gap-1">
        <span className="text-xs font-medium text-tertiary">{product.subtitle}</span>
        <h3 className="text-sm font-bold text-white truncate">{product.title}</h3>
        <span className="text-sm font-semibold mt-1 text-primary">
          ${product.price.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
