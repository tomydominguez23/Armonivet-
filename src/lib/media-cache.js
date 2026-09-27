const CACHE_KEY = "armonivet.media.v1";

function isSafeImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /^https?:\/\//i.test(url) || url.startsWith("/") || url.startsWith("./") || url.startsWith("../");
}

export function readMediaCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return data && data.urls && typeof data.urls === "object" ? data.urls : {};
  } catch {
    return {};
  }
}

export function writeMediaCache(urls) {
  const next = {};
  Object.entries(urls || {}).forEach(([key, url]) => {
    if (key && isSafeImageUrl(url)) next[key] = url;
  });
  localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), urls: next }));
  if (typeof window !== "undefined" && window.__ARM_MEDIA__) {
    window.__ARM_MEDIA__.urls = next;
  }
  return next;
}

function urlFor(el, urls) {
  const slot = el.getAttribute("data-cms-slot");
  const service = el.getAttribute("data-cms-service");
  return (slot && urls[slot]) || (service && urls[`service:${service}`]) || "";
}

export function applyMediaCache(urls = readMediaCache()) {
  document.querySelectorAll("[data-cms-slot], [data-cms-service]").forEach((el) => {
    const url = urlFor(el, urls);
    if (!isSafeImageUrl(url)) return;
    if (el.getAttribute("src") !== url) el.src = url;
  });
}

export function collectMediaUrls({ media = [], services = [] } = {}) {
  const urls = { ...readMediaCache() };
  (media || []).forEach((row) => {
    if (row?.slot && isSafeImageUrl(row.url)) urls[row.slot] = row.url;
  });
  (services || []).forEach((service) => {
    if (service?.slug && isSafeImageUrl(service.image_url)) {
      urls[`service:${service.slug}`] = service.image_url;
    }
  });
  return urls;
}
