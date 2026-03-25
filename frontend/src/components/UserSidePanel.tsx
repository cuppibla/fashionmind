import React, { useEffect, useState, useCallback } from "react";
import {
  getUser,
  getOccasions,
  getWishlist,
  getPurchases,
  getMemory,
  UserProfile,
  Occasion,
  WishlistItem,
  PurchaseItem,
} from "../api/client";

interface Props {
  userId: string;
  sessionId?: string;
}

function formatDate(str?: string) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMonth(str: string) {
  return new Date(str).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function Skeleton() {
  return <div className="h-4 bg-surface rounded animate-pulse w-full mb-2" />;
}

function SourceBadge({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-tertiary bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
      {label}
    </span>
  );
}

export default function UserSidePanel({ userId, sessionId }: Props) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseItem[]>([]);
  const [memories, setMemories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [u, o, w, p, m] = await Promise.all([
        getUser(userId),
        getOccasions(userId),
        getWishlist(userId),
        getPurchases(userId),
        getMemory(userId),
      ]);
      setUser(u);
      setOccasions(o);
      setWishlist(w);
      setPurchases(p);
      setMemories(m.memories);
    } catch (e) {
      console.error("Failed to load side panel data:", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchAll(); }, [fetchAll, sessionId]);

  return (
    <div className="flex flex-col h-full bg-transparent p-5 gap-6 overflow-y-auto">
      {/* Profile card */}
      <div className="bg-surface rounded-2xl border border-white/5 p-5 shadow-sm">
        {loading ? (
          <><Skeleton /><Skeleton /></>
        ) : user ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-bold text-white tracking-tight">{user.name}</h2>
              <SourceBadge label="Cloud SQL" />
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {user.body_type && (
                <span className="text-xs font-semibold bg-primary/10 border border-primary/30 text-primary rounded-full px-3 py-1">
                  {user.body_type}
                </span>
              )}
              {user.age && (
                <span className="text-sm font-medium text-tertiary">Age: {user.age}</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-tertiary text-sm">No profile loaded</p>
        )}
      </div>

      {/* Upcoming Occasions */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h3 className="text-sm font-bold tracking-wide text-tertiary uppercase">📅 Occasions</h3>
          <SourceBadge label="Cloud SQL" />
        </div>
        {loading ? <><Skeleton /><Skeleton /></> : occasions.length === 0 ? (
          <p className="text-secondary text-sm italic px-1">No occasions yet</p>
        ) : (
          <div className="flex flex-col gap-3">
            {occasions.slice(0, 5).map((o) => (
              <div key={o.id} className="bg-surface rounded-xl border border-white/5 p-4 hover:border-primary/20 transition-colors">
                <div className="flex justify-between items-center">
                  <span className="text-white font-semibold">{o.name}</span>
                  <span className="text-primary text-xs font-bold">{formatDate(o.date)}</span>
                </div>
                {o.notes && (
                  <p className="text-tertiary text-xs mt-1.5 line-clamp-2 leading-relaxed">{o.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Wishlist */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h3 className="text-sm font-bold tracking-wide text-tertiary uppercase">🛍️ Wishlist</h3>
          <SourceBadge label="Cloud SQL" />
        </div>
        {loading ? <><Skeleton /><Skeleton /></> : wishlist.length === 0 ? (
          <p className="text-secondary text-sm italic px-1">Nothing saved yet</p>
        ) : (
          <div className="flex flex-col gap-3">
            {wishlist.slice(0, 5).map((w) => (
              <div key={w.id} className="bg-surface rounded-xl border border-white/5 p-4">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-white font-medium text-sm flex-1 leading-snug">{w.item_name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 whitespace-nowrap ${
                    w.status === "purchased"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-secondary/30 text-tertiary border border-white/10"
                  }`}>
                    {w.status}
                  </span>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {w.brand && <span className="text-tertiary text-xs font-semibold">{w.brand}</span>}
                  {w.category && (
                    <span className="text-[10px] bg-white/5 text-tertiary rounded px-1.5 py-0.5">{w.category}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Purchases */}
      <section>
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h3 className="text-sm font-bold tracking-wide text-tertiary uppercase">🧾 Purchases</h3>
          <SourceBadge label="Cloud SQL" />
        </div>
        {loading ? <Skeleton /> : purchases.length === 0 ? (
          <p className="text-secondary text-sm italic px-1">No purchases yet</p>
        ) : (
          <div className="flex flex-col gap-3">
            {purchases.slice(0, 3).map((p) => (
              <div key={p.id} className="bg-surface rounded-xl border border-white/5 p-3 flex flex-col gap-1">
                <span className="text-white text-sm font-medium">{p.item_name}</span>
                <div className="flex gap-2 items-center">
                  {p.brand && <span className="text-tertiary text-[11px] font-bold">{p.brand}</span>}
                  {p.brand && <span className="text-white/20 text-[10px]">•</span>}
                  <span className="text-secondary text-[11px]">{formatMonth(p.purchased_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Memory */}
      <section className="mb-4">
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h3 className="text-sm font-bold tracking-wide text-tertiary uppercase">🧠 Memory</h3>
          <SourceBadge label="Memory Bank" />
        </div>
        {loading ? <Skeleton /> : memories.length === 0 ? (
          <p className="text-secondary text-sm italic px-1">
            Start a conversation, share a style detail, then refresh to load cross-session memory.
          </p>
        ) : (
          <div className="bg-surface/50 rounded-xl p-4 border border-white/5 flex flex-col gap-2">
            {memories.map((m, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-primary text-xs mt-0.5">✦</span>
                <p className="text-tertiary text-xs leading-relaxed">{m}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Refresh */}
      <button
        onClick={fetchAll}
        className="mt-auto py-2 px-4 rounded-full bg-surface text-tertiary text-xs font-bold hover:bg-white/10 hover:text-white transition-colors self-center border border-white/5 shadow-sm"
      >
        ↻ Refresh Cloud SQL + Memory
      </button>
    </div>
  );
}
