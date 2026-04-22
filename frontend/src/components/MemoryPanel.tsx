import React, { useEffect, useRef, useState } from "react";
import { MemoryRecallEvent, Product, ToolCallEvent, UserContextEvent } from "../api/client";
import ProductCard from "./ProductCard";

// ─── Memory topic definitions ────────────────────────────────────────────────

const MEMORY_TOPICS = [
  { key: "style_identity",       label: "style_identity",       managed: false },
  { key: "USER_PREFERENCES",     label: "USER_PREFERENCES",     managed: true  },
  { key: "visual_style_markers", label: "visual_style_markers", managed: false },
  { key: "signature_items",      label: "signature_items",      managed: false },
  { key: "comfort_constraints",  label: "comfort_constraints",  managed: false },
  { key: "event_context",        label: "event_context",        managed: false },
  { key: "USER_PERSONAL_INFO",   label: "USER_PERSONAL_INFO",   managed: true  },
];

// Heuristic: a topic is "hit" if its key appears anywhere in the raw recall text.
function parseHitTopics(raw: string): Set<string> {
  const lower = raw.toLowerCase();
  return new Set(
    MEMORY_TOPICS
      .filter(t => lower.includes(t.key.toLowerCase()))
      .map(t => t.key)
  );
}

// Pull the first ~120 chars following a topic label in the raw text.
function snippetFor(raw: string, topicKey: string): string {
  const idx = raw.toLowerCase().indexOf(topicKey.toLowerCase());
  if (idx === -1) return "";
  const after = raw.slice(idx + topicKey.length, idx + topicKey.length + 160).trim();
  return after.replace(/^[:\-\s]+/, "").split("\n")[0].slice(0, 120);
}

// ─── Shared badge styles ──────────────────────────────────────────────────────

const CloudSQLBadge = ({ table }: { table: string }) => (
  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400">
    CloudSQL: {table}
  </span>
);

const MemBankBadge = () => (
  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-400">
    Vertex MemoryBank
  </span>
);

// ─── "NEW" flash badge (fades after 8s) ──────────────────────────────────────

function NewBadge({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-400/40 text-amber-300 animate-pulse">
      NEW
    </span>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-white/5 rounded-xl bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <span className="text-xs font-bold uppercase tracking-widest text-tertiary">
          {title}
        </span>
        {badge}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ─── User Profile Section (Enhanced) ──────────────────────────────────────────

function UserProfileSection({ ctx }: { ctx: UserContextEvent | null }) {
  if (!ctx) {
    return (
      <Section title="User Profile" badge={<CloudSQLBadge table="users" />}>
        <div className="flex flex-col gap-2">
          <div className="h-4 bg-white/5 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-white/5 rounded animate-pulse w-1/2" />
        </div>
      </Section>
    );
  }
  const { profile } = ctx;
  return (
    <Section title="User Profile" badge={<CloudSQLBadge table="users" />}>
      <div className="flex items-center gap-3.5">
        {/* Avatar with gradient ring */}
        <div className="w-11 h-11 rounded-full p-[2px] bg-gradient-to-br from-primary via-pink-500 to-violet-500 shrink-0">
          <div className="w-full h-full rounded-full bg-surface flex items-center justify-center text-sm font-bold text-primary">
            {profile.name?.[0] ?? "?"}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{profile.name}</p>
          <p className="text-[11px] text-tertiary truncate">{profile.email}</p>
        </div>
      </div>

      {/* Profile detail pills */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-secondary">
          {profile.age ? `${profile.age} yo` : "Age —"}
        </span>
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary capitalize">
          {profile.body_type ?? "Body type —"}
        </span>
      </div>
    </Section>
  );
}

// ─── Memory Bank Section ──────────────────────────────────────────────────────

function MemoryBankSection({ recall }: { recall: MemoryRecallEvent | null }) {
  const facts = recall?.facts ?? [];
  const factCount = facts.length;

  return (
    <Section title="Memory Bank" badge={<MemBankBadge />}>
      {recall ? (
        <>
          <p className="text-[10px] text-tertiary mb-3">
            Recalled at{" "}
            <span className="text-secondary">
              {recall.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {" · "}
            <span className="text-emerald-400">{recall.fetchMs}ms</span>
            {" · "}
            <span className="text-secondary">{factCount} memor{factCount !== 1 ? "ies" : "y"}</span>
          </p>
          {factCount > 0 ? (
            <div className="flex flex-col gap-2">
              {facts.map((f, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-violet-400 text-xs mt-0.5 shrink-0">✦</span>
                  <p className="text-[11px] text-white/90 leading-relaxed">{f.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-tertiary italic">
              No memories stored yet — have a conversation and they'll appear on the next session.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-tertiary italic">
          No memory recalled — first session or memory bank disabled.
        </p>
      )}
    </Section>
  );
}

// ─── Wishlist Section ─────────────────────────────────────────────────────────

function WishlistSection({
  ctx,
  toolCallLog,
}: {
  ctx: UserContextEvent | null;
  toolCallLog: ToolCallEvent[];
}) {
  // Items added this session via agent tool calls
  const newItemNames = new Set(
    toolCallLog
      .filter((e) => e.tool === "add_to_wishlist")
      .map((e) => String(e.args.item_name ?? ""))
  );

  // Newly added items from tool calls (not yet in ctx snapshot)
  const sessionItems = toolCallLog
    .filter((e) => e.tool === "add_to_wishlist")
    .map((e) => ({
      id: `session-${e.ts.getTime()}`,
      item_name: String(e.args.item_name ?? ""),
      brand: e.args.brand ? String(e.args.brand) : undefined,
      category: e.args.category ? String(e.args.category) : undefined,
      price: e.args.price ? Number(e.args.price) : undefined,
      ts: e.ts,
      isNew: true,
    }));

  // Deduplicate: ctx items that don't duplicate session items
  const baseItems = (ctx?.wishlist ?? []).filter(
    (w) => !newItemNames.has(w.item_name)
  );

  // Client-side dedup by item_name (case-insensitive) to handle DB dupes
  const seen = new Set<string>();
  const dedupedBaseItems = baseItems.filter((w) => {
    const key = w.item_name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const allItems = [
    ...sessionItems,
    ...dedupedBaseItems.map((w) => ({ ...w, ts: undefined as Date | undefined, isNew: false })),
  ];

  return (
    <Section title="Wishlist" badge={<CloudSQLBadge table="wishlist_items" />}>
      {allItems.length === 0 ? (
        <p className="text-xs text-tertiary italic">No wishlist items yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {allItems.map((item) => (
            <WishlistRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </Section>
  );
}

function WishlistRow({
  item,
}: {
  item: {
    item_name: string;
    brand?: string;
    category?: string;
    price?: number;
    ts?: Date;
    isNew: boolean;
  };
}) {
  const [highlight, setHighlight] = useState(item.isNew);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (item.isNew) {
      timeoutRef.current = window.setTimeout(() => setHighlight(false), 8000);
    }
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [item.isNew]);

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-700 ${
        highlight
          ? "border-amber-400/40 bg-amber-400/5"
          : "border-white/5 bg-white/2"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <NewBadge visible={highlight} />
          <span className="text-[12px] font-medium text-white truncate">
            {item.item_name}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {item.brand && (
            <span className="text-[10px] text-tertiary">{item.brand}</span>
          )}
          {item.category && (
            <span className="text-[10px] text-tertiary capitalize">{item.category}</span>
          )}
          {item.ts && (
            <span className="text-[10px] text-tertiary ml-auto">
              {item.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
      {item.price != null && (
        <span className="text-[12px] font-semibold text-primary shrink-0">
          ${item.price.toFixed(0)}
        </span>
      )}
    </div>
  );
}

// ─── Occasions Section ────────────────────────────────────────────────────────

function OccasionsSection({
  ctx,
  toolCallLog,
}: {
  ctx: UserContextEvent | null;
  toolCallLog: ToolCallEvent[];
}) {
  const newOccNames = new Set(
    toolCallLog
      .filter((e) => e.tool === "add_occasion")
      .map((e) => String(e.args.name ?? ""))
  );

  const sessionOccs = toolCallLog
    .filter((e) => e.tool === "add_occasion")
    .map((e) => ({
      id: `session-${e.ts.getTime()}`,
      name: String(e.args.name ?? ""),
      date: e.args.date ? String(e.args.date) : undefined,
      notes: e.args.notes ? String(e.args.notes) : undefined,
      ts: e.ts,
      isNew: true,
    }));

  const baseOccs = (ctx?.upcoming_occasions ?? []).filter(
    (o) => !newOccNames.has(o.name)
  );

  const allOccs = [
    ...sessionOccs,
    ...baseOccs.map((o) => ({ ...o, ts: undefined as Date | undefined, isNew: false })),
  ];

  return (
    <Section title="Upcoming Occasions" badge={<CloudSQLBadge table="occasions" />}>
      {allOccs.length === 0 ? (
        <p className="text-xs text-tertiary italic">No upcoming occasions.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {allOccs.map((occ) => (
            <OccasionRow key={occ.id} occ={occ} />
          ))}
        </div>
      )}
    </Section>
  );
}

function OccasionRow({
  occ,
}: {
  occ: {
    name: string;
    date?: string;
    notes?: string;
    ts?: Date;
    isNew: boolean;
  };
}) {
  const [highlight, setHighlight] = useState(occ.isNew);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (occ.isNew) {
      timeoutRef.current = window.setTimeout(() => setHighlight(false), 8000);
    }
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [occ.isNew]);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-700 ${
        highlight
          ? "border-amber-400/40 bg-amber-400/5"
          : "border-white/5 bg-white/2"
      }`}
    >
      <span className="text-base shrink-0">📅</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <NewBadge visible={highlight} />
          <span className="text-[12px] font-medium text-white truncate">{occ.name}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {occ.date && (
            <span className="text-[10px] text-tertiary">{occ.date}</span>
          )}
          {occ.notes && (
            <span className="text-[10px] text-tertiary truncate">{occ.notes}</span>
          )}
          {occ.ts && (
            <span className="text-[10px] text-tertiary ml-auto">
              {occ.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Recommendations Section ──────────────────────────────────────────────────

function RecommendationsSection({ products }: { products: Product[] }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-tertiary">
          Recommended for You
        </h3>
        {products.length > 0 && (
          <span className="text-[10px] text-primary font-semibold">
            {products.length} product{products.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-40">
          <span className="text-3xl">👗</span>
          <p className="text-xs text-tertiary text-center leading-relaxed max-w-[200px]">
            Ask the stylist for outfit ideas to see personalized picks here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} highlighted />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Exported panels ──────────────────────────────────────────────────────────

interface MemoryInfoPanelProps {
  userContext: UserContextEvent | null;
  memoryRecall: MemoryRecallEvent | null;
  toolCallLog: ToolCallEvent[];
}

export function MemoryInfoPanel({
  userContext,
  memoryRecall,
  toolCallLog,
}: MemoryInfoPanelProps) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <UserProfileSection ctx={userContext} />
      <MemoryBankSection recall={memoryRecall} />
      <WishlistSection ctx={userContext} toolCallLog={toolCallLog} />
      <OccasionsSection ctx={userContext} toolCallLog={toolCallLog} />
    </div>
  );
}

interface RecommendationsPanelProps {
  recommendedProducts: Product[];
}

export function RecommendationsPanel({ recommendedProducts }: RecommendationsPanelProps) {
  return (
    <div className="flex flex-col p-4">
      <RecommendationsSection products={recommendedProducts} />
    </div>
  );
}

// ─── Default export (backwards compat) ────────────────────────────────────────

interface MemoryPanelProps {
  userContext: UserContextEvent | null;
  memoryRecall: MemoryRecallEvent | null;
  toolCallLog: ToolCallEvent[];
  recommendedProducts: Product[];
}

export default function MemoryPanel({
  userContext,
  memoryRecall,
  toolCallLog,
  recommendedProducts,
}: MemoryPanelProps) {
  return (
    <div className="flex flex-col gap-3 p-4 h-full overflow-y-auto custom-scrollbar">
      <UserProfileSection ctx={userContext} />
      <MemoryBankSection recall={memoryRecall} />
      <WishlistSection ctx={userContext} toolCallLog={toolCallLog} />
      <OccasionsSection ctx={userContext} toolCallLog={toolCallLog} />
      <RecommendationsSection products={recommendedProducts} />
    </div>
  );
}
