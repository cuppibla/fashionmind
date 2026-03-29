import React, { useEffect, useState } from "react";
import { getProducts, type Product } from "../api/client";

interface Props {
  recommendedProducts?: Product[];
}

function ProductCard({
  product,
  highlighted,
}: {
  product: Product;
  highlighted: boolean;
}) {
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
        <span className={`text-sm font-semibold mt-1 ${highlighted ? "text-primary" : "text-primary"}`}>
          ${product.price.toFixed(2)}
        </span>
      </div>
    </div>
  );
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
