import React, { useEffect, useState } from "react";
import { getProducts, type Product } from "../api/client";
import ProductCard from "./ProductCard";

interface Props {
  recommendedProducts?: Product[];
}

export default function MerchantCatalogPanel({ recommendedProducts = [] }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProducts()
      .then(setProducts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const recommendedIds = new Set(recommendedProducts.map((p) => p.id));

  // Full catalog with recommended products visually distinguished
  const catalogWithFlags = products.map((p) => ({
    product: p,
    highlighted: recommendedIds.has(p.id),
  }));

  // Recommended products that also exist in the loaded catalog (for the header section)
  const confirmedRecs = recommendedProducts.filter((p) =>
    products.some((cp) => cp.id === p.id),
  );

  return (
    <div className="flex flex-col h-full bg-surface p-4 gap-4 overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="flex justify-between items-center mb-2 shrink-0">
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

      {/* Recommended section — only shown when agent has made recommendations */}
      {confirmedRecs.length > 0 && (
        <div className="shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              ✦ Recommended for you
            </span>
            <span className="text-[10px] text-tertiary">
              {confirmedRecs.length} pick{confirmedRecs.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {confirmedRecs.map((product) => (
              <ProductCard key={product.id} product={product} highlighted />
            ))}
          </div>
          <div className="mt-4 mb-1 border-t border-white/5" />
        </div>
      )}

      {/* Full catalog */}
      {!loading && (
        <>
          {confirmedRecs.length > 0 && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-tertiary shrink-0 -mb-1">
              Full Catalog
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-8">
            {catalogWithFlags.map(({ product, highlighted }) => (
              <ProductCard
                key={product.id}
                product={product}
                highlighted={highlighted}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
