import { isSupabaseConfigured, requireSupabase } from "../lib/supabase.js";

export function dashboardHref() {
  return new URL("./", window.location.href).toString();
}

export function loginHref(nextHref) {
  const url = new URL("login.html", window.location.href);
  if (nextHref) url.searchParams.set("next", nextHref);
  return url.toString();
}

export function safeNextHref(raw) {
  if (!raw) return dashboardHref();
  try {
    const next = new URL(raw, window.location.href);
    if (next.origin !== window.location.origin) return dashboardHref();
    if (!next.pathname.includes("/admin")) return dashboardHref();
    return next.toString();
  } catch {
    return dashboardHref();
  }
}

export async function getSession() {
  if (!isSupabaseConfigured) return null;
  const { data } = await requireSupabase().auth.getSession();
  return data.session;
}
