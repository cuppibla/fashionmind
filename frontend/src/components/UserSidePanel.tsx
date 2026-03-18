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
}

function formatDate(str?: string) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMonth(str: string) {
  return new Date(str).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function Skeleton() {
  return <div className="h-4 bg-slate-700 rounded animate-pulse w-full mb-2" />;
}

export default function UserSidePanel({ userId }: Props) {
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

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="flex flex-col h-full bg-slate-900 p-4 gap-4 overflow-y-auto">
      {/* Profile card */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
        {loading ? (
          <><Skeleton /><Skeleton /></>
        ) : user ? (
          <>
            <h2 className="text-xl font-semibold text-white">{user.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {user.body_type && (
                <span className="text-xs border border-rose-400 text-rose-400 rounded-full px-2 py-0.5">
                  {user.body_type}
                </span>
              )}
              {user.age && (
                <span className="text-xs text-slate-400">Age: {user.age}</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-slate-400 text-sm">No profile loaded</p>
        )}
      </div>

      <div className="h-px bg-slate-700" />

      {/* Upcoming Occasions */}
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">📅 Upcoming Occasions</h3>
        {loading ? <><Skeleton /><Skeleton /></> : occasions.length === 0 ? (
          <p className="text-slate-500 text-xs italic">No occasions yet — ask FashionMind to add one!</p>
        ) : (
          <div className="flex flex-col gap-2">
            {occasions.slice(0, 5).map((o) => (
              <div key={o.id} className="bg-slate-800 rounded-lg border border-slate-700 px-3 py-2">
                <div className="flex justify-between items-center">
                  <span className="text-white text-sm">{o.name}</span>
                  <span className="text-rose-400 text-xs">{formatDate(o.date)}</span>
                </div>
                {o.notes && (
                  <p className="text-slate-400 text-xs mt-0.5 truncate">{o.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="h-px bg-slate-700" />

      {/* Wishlist */}
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">🛍️ Wishlist</h3>
        {loading ? <><Skeleton /><Skeleton /></> : wishlist.length === 0 ? (
          <p className="text-slate-500 text-xs italic">Nothing saved yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {wishlist.slice(0, 5).map((w) => (
              <div key={w.id} className="bg-slate-800 rounded-lg border border-slate-700 px-3 py-2">
                <div className="flex justify-between items-center">
                  <span className="text-white text-sm">{w.item_name}</span>
                  <span className={`text-xs rounded px-1 py-0.5 ${
                    w.status === "purchased"
                      ? "bg-green-600 text-white"
                      : "border border-slate-500 text-slate-400"
                  }`}>
                    {w.status}
                  </span>
                </div>
                <div className="flex gap-2 mt-0.5 flex-wrap">
                  {w.brand && <span className="text-slate-400 text-xs">{w.brand}</span>}
                  {w.category && (
                    <span className="text-xs bg-slate-700 rounded px-1">{w.category}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="h-px bg-slate-700" />

      {/* Recent Purchases */}
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">🧾 Recent Purchases</h3>
        {loading ? <Skeleton /> : purchases.length === 0 ? (
          <p className="text-slate-500 text-xs italic">No purchases yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {purchases.slice(0, 3).map((p) => (
              <div key={p.id} className="bg-slate-800 rounded-lg border border-slate-700 px-3 py-2">
                <span className="text-white text-sm">{p.item_name}</span>
                <div className="flex gap-2 mt-0.5">
                  {p.brand && <span className="text-slate-400 text-xs">{p.brand}</span>}
                  <span className="text-slate-500 text-xs">{formatMonth(p.purchased_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="h-px bg-slate-700" />

      {/* Memory */}
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">🧠 What I Remember</h3>
        {loading ? <Skeleton /> : memories.length === 0 ? (
          <p className="text-slate-500 text-xs italic">
            Start a conversation — FashionMind will remember your style!
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {memories.map((m, i) => (
              <p key={i} className="text-slate-400 text-xs italic">{m}</p>
            ))}
          </div>
        )}
      </section>

      {/* Refresh */}
      <button
        onClick={fetchAll}
        className="mt-auto text-slate-500 text-xs hover:text-white transition-colors self-center"
      >
        ↻ Refresh
      </button>
    </div>
  );
}
