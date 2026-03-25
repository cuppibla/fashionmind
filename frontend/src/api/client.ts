const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  age?: number;
  body_type?: string;
}

export interface Occasion {
  id: string;
  name: string;
  date?: string;
  notes?: string;
}

export interface WishlistItem {
  id: string;
  item_name: string;
  brand?: string;
  category?: string;
  price?: number;
  status: string;
}

export interface PurchaseItem {
  id: string;
  item_name: string;
  brand?: string;
  category?: string;
  purchased_at: string;
  notes?: string;
}

export interface Product {
  id: string;
  title: string;
  subtitle: string | null;
  price: number;
  images: string[];
  category: string | null;
}

export interface Message {
  role: "user" | "agent";
  text: string;
  ts: Date;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.json();
}

export const createSession = (userId: string) =>
  request<{ session_id: string }>(`/api/sessions/${userId}`, { method: "POST" });

export const getUser = (userId: string) =>
  request<UserProfile>(`/api/users/${userId}`);

export const getOccasions = (userId: string) =>
  request<Occasion[]>(`/api/users/${userId}/occasions`);

export const getWishlist = (userId: string) =>
  request<WishlistItem[]>(`/api/users/${userId}/wishlist`);

export const getPurchases = (userId: string) =>
  request<PurchaseItem[]>(`/api/users/${userId}/purchases`);

export const getMemory = (userId: string) =>
  request<{ memories: string[] }>(`/api/users/${userId}/memory`);

export const getProducts = (category?: string) => {
  const params = category ? `?category=${encodeURIComponent(category)}` : "";
  return request<Product[]>(`/api/products${params}`);
};
