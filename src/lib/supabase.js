import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(
  url && anonKey && !String(url).includes("YOUR_") && !String(anonKey).includes("YOUR_")
);

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase no está configurado. Copia .env.example a .env y completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY."
    );
  }
  return supabase;
}
