import React, { useEffect, useState } from "react";
import { getProducts, type Product } from "../api/client";

export default function MerchantCatalogPanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface p-4 gap-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-bold tracking-tight">Catalog</h2>
        <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full font-semibold">
          {loading ? "..." : `${products.length} Items`}
        </span>
      </div>

      {loading && (
        <p className="text-sm text-tertiary text-center py-8">Loading catalog...</p>
      )}

      {error && (
        <p className="text-sm text-red-400 text-center py-8">
          Failed to load catalog: {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-8">
        {products.map((product) => (
          <div
            key={product.id}
            className="group flex flex-col bg-app rounded-2xl overflow-hidden hover:shadow-product transition-all duration-300 border border-white/5 hover:border-primary/30 cursor-pointer"
          >
            <div className="aspect-[4/5] bg-surface relative overflow-hidden">
              <img
                src={product.images[0]}
                alt={product.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-app/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            </div>
            <div className="p-3 flex flex-col gap-1">
              <span className="text-xs font-medium text-tertiary">
                {product.subtitle}
              </span>
              <h3 className="text-sm font-bold text-white truncate">
                {product.title}
              </h3>
              <span className="text-sm font-semibold text-primary mt-1">
                ${product.price.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
