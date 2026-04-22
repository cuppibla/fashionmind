import React, { useEffect, useState, useCallback } from "react";
import { getProducts, type Product } from "../api/client";
import ProductCard from "./ProductCard";
import HandTrackingOverlay from "./HandTrackingOverlay";
import { useHandTracking } from "../hooks/useHandTracking";

interface Props {
  onPhoneGesture: () => void;
}

const CATEGORIES = ["All", "Tops", "Bottoms", "Dresses", "Outerwear", "Accessories"];

export default function CatalogBrowsePage({ onPhoneGesture }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");

  const { isTracking, gestureState, startTracking } = useHandTracking({
    onPhoneGesture,
  });

  // Start hand tracking on mount
  useEffect(() => {
    void startTracking();
  }, [startTracking]);

  // Load products
  useEffect(() => {
    getProducts()
      .then(setProducts)
      .catch((err) => console.error("Failed to load products:", err))
      .finally(() => setLoading(false));
  }, []);

  const filteredProducts =
    activeCategory === "All"
      ? products
      : products.filter(
          (p) => p.category?.toLowerCase() === activeCategory.toLowerCase(),
        );

  return (
    <div className="min-h-screen bg-app text-white">
      {/* Hand tracking overlay */}
      <HandTrackingOverlay gestureState={gestureState} isTracking={isTracking} />

      {/* Navigation */}
      <nav className="sticky top-0 z-40 bg-app/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-primary">Fashion</span>Mind
          </h1>
          <div className="flex items-center gap-6 text-sm font-medium text-tertiary">
            <span className="text-white cursor-pointer">Home</span>
            <span className="hover:text-white cursor-pointer transition-colors">New Arrivals</span>
            <span className="hover:text-white cursor-pointer transition-colors">Collections</span>
            <span className="hover:text-white cursor-pointer transition-colors">About</span>
          </div>
          {/* Fallback call button */}
          <button
            onClick={onPhoneGesture}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/20 border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/30 transition-colors"
          >
            📞 Talk to AI Stylist
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-16 flex items-center gap-12">
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-3">
              Spring Collection 2026
            </p>
            <h2 className="text-5xl font-bold leading-tight mb-5">
              Discover Your <br />
              <span className="text-primary">Signature Style</span>
            </h2>
            <p className="text-tertiary text-lg leading-relaxed mb-8 max-w-md">
              Browse our curated collection and talk to your AI stylist — just hold up the phone gesture to start a conversation.
            </p>
            <button
              onClick={onPhoneGesture}
              className="px-8 py-3 rounded-full bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors shadow-lg shadow-primary/30"
            >
              Shop Now
            </button>
          </div>
          <div className="flex-1 relative">
            <div className="aspect-[3/4] max-w-sm mx-auto rounded-3xl bg-surface border border-white/5 overflow-hidden shadow-2xl">
              {products[0]?.images[0] && (
                <img
                  src={products[0].images[0]}
                  alt="Featured"
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-app via-transparent to-transparent" />
            </div>
          </div>
        </div>
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      </section>

      {/* Category Tabs */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-200 border
                ${activeCategory === cat
                  ? "bg-primary/20 border-primary/40 text-primary"
                  : "bg-surface border-white/5 text-tertiary hover:text-white hover:border-white/10"
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      <div className="max-w-7xl mx-auto px-6 pb-20">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] bg-surface rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
        {!loading && filteredProducts.length === 0 && (
          <p className="text-center text-tertiary py-20">No products in this category.</p>
        )}
      </div>

      {/* Hand tracking status — show enable button or retry on error */}
      {(!isTracking || gestureState === "error") && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={() => startTracking()}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold transition-colors ${
              gestureState === "error"
                ? "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30"
                : "bg-surface border-white/10 text-tertiary hover:text-white hover:border-white/20"
            }`}
          >
            {gestureState === "error" ? "🔄 Retry Hand Tracking" : "✋ Enable Hand Tracking"}
          </button>
        </div>
      )}
    </div>
  );
}
