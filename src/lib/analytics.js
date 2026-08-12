import { isSupabaseConfigured, supabase } from "./supabase.js";

const SESSION_KEY = "armonivet_sid";
const CHANNEL_KEY = "armonivet_channel";
const VISIT_FLAG = "armonivet_visit_logged";

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function detectDevice(ua) {
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return "mobile";
  if (/Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

function resolveChannel(params) {
  const source = (params.get("utm_source") || "").toLowerCase();
  const medium = (params.get("utm_medium") || "").toLowerCase();
  const campaign = (params.get("utm_campaign") || "").toLowerCase();
  const ref = (params.get("ref") || params.get("channel") || "").toLowerCase();

  if (ref) return ref;
  if (source.includes("instagram") && medium.includes("paid")) return "instagram-ads";
  if (source.includes("instagram")) return "instagram";
  if (source.includes("google")) return "google-ads";
  if (source.includes("facebook") || source.includes("fb")) return "facebook-ads";
  if (source.includes("whatsapp")) return "whatsapp";
  if (source.includes("refer") || campaign.includes("boca")) return "referido";
  if (source.includes("medio") || campaign.includes("tu-dia")) return "medios";
  if (source) return source.replace(/\s+/g, "-");

  try {
    const referrer = document.referrer ? new URL(document.referrer).hostname : "";
    if (referrer.includes("instagram")) return "instagram";
    if (referrer.includes("facebook")) return "facebook-ads";
    if (referrer.includes("google")) return "google-ads";
    if (referrer.includes("whatsapp")) return "whatsapp";
  } catch {
    /* ignore */
  }
  return "directo";
}

export function getOrCreateSessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = uuid();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function getStoredChannel() {
  return sessionStorage.getItem(CHANNEL_KEY) || "directo";
}

export async function trackPageVisit() {
  if (!isSupabaseConfigured || !supabase) return;

  const params = new URLSearchParams(window.location.search);
  const channel = resolveChannel(params);
  sessionStorage.setItem(CHANNEL_KEY, channel);

  const sessionId = getOrCreateSessionId();
  const already = sessionStorage.getItem(VISIT_FLAG) === "1";
  const ua = navigator.userAgent || "";

  try {
    await supabase.from("page_visits").insert({
      session_id: sessionId,
      path: window.location.pathname + window.location.hash,
      referrer: document.referrer || null,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      channel_slug: channel,
      user_agent: ua.slice(0, 280),
      device: detectDevice(ua),
      landing_path: window.location.pathname,
      is_unique_session: !already,
    });
    sessionStorage.setItem(VISIT_FLAG, "1");
  } catch (err) {
    console.warn("[analytics] visit", err);
  }
}

export async function trackEvent(eventType, label = null, metadata = {}) {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    await supabase.from("conversion_events").insert({
      session_id: getOrCreateSessionId(),
      event_type: eventType,
      channel_slug: getStoredChannel(),
      label,
      metadata,
    });
  } catch (err) {
    console.warn("[analytics] event", err);
  }
}

export function bindConversionTracking() {
  document.querySelectorAll('a[href*="calendly.com"]').forEach((el) => {
    el.addEventListener("click", () => {
      trackEvent("click_agendar", el.textContent?.trim() || "Agendar", {
        href: el.href,
      });
    });
  });

  document.querySelectorAll('a[href*="docs.google.com/forms"]').forEach((el) => {
    el.addEventListener("click", () => {
      trackEvent("click_formulario", "Formulario previo", { href: el.href });
    });
  });

  document.querySelectorAll('a[href*="instagram.com"]').forEach((el) => {
    el.addEventListener("click", () => {
      trackEvent("click_instagram", el.textContent?.trim() || "Instagram", {
        href: el.href,
      });
    });
  });
}
