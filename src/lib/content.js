import { isSupabaseConfigured, supabase } from "./supabase.js";
import { applyMediaCache, collectMediaUrls, writeMediaCache } from "./media-cache.js";

function formatCLP(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function isSafeImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  // Evita pisar imágenes locales con rutas rotas desde CMS
  return /^https?:\/\//i.test(url) || url.startsWith("/") || url.startsWith("./") || url.startsWith("../");
}

function setImgSrc(img, url) {
  if (!img || !isSafeImageUrl(url)) return;
  img.src = url;
}

function etologiaCopy(text, { fallback = false } = {}) {
  const raw = String(text || "").trim();
  if (/evaluaci[oó]n \+ plan \+ seguimiento/i.test(raw) || (fallback && !raw)) {
    return "Evaluación diagnóstica + plan de trabajo por 30 días (sujeto a modificar)";
  }
  return raw;
}

function zoneShort(text) {
  const raw = String(text || "").replace(/<[^>]+>/g, "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0].trim();
  return first.length > 42 ? `${first.slice(0, 40)}…` : first;
}

export async function hydrateSiteContent() {
  applyMediaCache();
  if (!isSupabaseConfigured || !supabase) return;

  const [{ data: services, error: servicesError }, { data: zones }, { data: extras }, { data: media }, { data: settingsRow }] =
    await Promise.all([
      supabase.from("services").select("*").eq("active", true).order("sort_order"),
      supabase.from("pricing_zones").select("*").eq("active", true).order("sort_order"),
      supabase.from("price_extras").select("*").eq("active", true).order("sort_order"),
      supabase.from("site_media").select("*"),
      supabase.from("site_settings").select("value").eq("key", "business").maybeSingle(),
    ]);

  if (servicesError) {
    console.warn("[content] services", servicesError);
    return;
  }

  const mediaMap = Object.fromEntries((media || []).map((m) => [m.slot, m]));
  const settings = settingsRow?.value || {};

  if (settings.promo_text) {
    const promo = document.querySelector(".promo-inner p");
    if (promo) promo.innerHTML = settings.promo_text;
  }

  // Hero images
  document.querySelectorAll("[data-hero-slide]").forEach((slide, i) => {
    const slot = mediaMap[`hero_${i + 1}`];
    const img = slide.querySelector(".hero-bg-img");
    setImgSrc(img, slot?.url);
  });

  // Gallery
  document.querySelectorAll(".gallery-grid figure img").forEach((img, i) => {
    const slot = mediaMap[`gallery_${i + 1}`];
    if (slot?.url) {
      setImgSrc(img, slot.url);
      if (slot.alt_text) img.alt = slot.alt_text;
    }
  });

  // Doctor photo — prefer absolute URL; keep local asset if CMS has relative path
  const doctor = document.querySelector(".about-doctor img");
  if (doctor && mediaMap.about_doctor?.url && /^https?:\/\//i.test(mediaMap.about_doctor.url)) {
    doctor.src = mediaMap.about_doctor.url;
  }

  const midBanner = document.querySelector(".mid-banner-photo img");
  setImgSrc(midBanner, mediaMap.mid_banner?.url);

  // Offers / services cards — only replace if we have image URLs
  const offerGrid = document.querySelector("[data-offers-grid]") || document.querySelector(".offer-grid");
  const offerServices = (services || []).filter((s) => s.section === "ofertas" || s.section === "ambos").slice(0, 4);
  if (offerGrid && offerServices.length) {
    const cards = Array.from(offerGrid.querySelectorAll(".offer-card"));
    if (cards.length === offerServices.length) {
      offerServices.forEach((s, i) => {
        const card = cards[i];
        const img = card.querySelector("img");
        if (img) {
          if (s.slug) img.setAttribute("data-cms-service", s.slug);
          setImgSrc(img, s.image_url);
        }
        const title = card.querySelector("h3");
        const desc = card.querySelector(".offer-body p");
        if (title && s.title) title.textContent = s.title;
        if (desc) desc.textContent = etologiaCopy(s.description, { fallback: s.slug === "etologia-clinica" });
      });
    } else if (offerServices.some((s) => isSafeImageUrl(s.image_url))) {
      offerGrid.innerHTML = offerServices
        .map(
          (s) => `
      <article class="offer-card reveal is-visible">
        <figure>
          <img src="${s.image_url || ""}" data-cms-service="${s.slug || ""}" alt="${s.title}" />
          ${s.tag ? `<span class="offer-tag">${s.tag}</span>` : ""}
        </figure>
        <div class="offer-body">
          <h3>${s.title}</h3>
          <p>${etologiaCopy(s.description, { fallback: s.slug === "etologia-clinica" })}</p>
          <div class="offer-price-row">
            <span>${s.price_label || (s.price_from != null ? `Desde <strong>${formatCLP(s.price_from)}</strong>` : "")}</span>
            <a class="btn btn-buy btn-buy--sm" href="#agendar" data-book="${s.title || "Consulta Etología Clínica"}">Agendar</a>
          </div>
        </div>
      </article>`
        )
        .join("");
    }
  }

  document.querySelectorAll("[data-cms-service]").forEach((img) => {
    const slug = img.getAttribute("data-cms-service");
    const service = (services || []).find((s) => s.slug === slug);
    if (service?.image_url) setImgSrc(img, service.image_url);
  });

  document.querySelectorAll("[data-plan-slug]").forEach((card) => {
    const slug = card.getAttribute("data-plan-slug");
    const service = (services || []).find((s) => s.slug === slug);
    if (!service) return;
    const img = card.querySelector("img");
    if (img && slug) img.setAttribute("data-cms-service", slug);
    setImgSrc(img, service.image_url);
    const title = card.querySelector("h3");
    const desc = card.querySelector(":scope > div > p");
    if (title && service.title) title.textContent = service.title;
    if (desc) desc.textContent = etologiaCopy(service.description, { fallback: slug === "etologia-clinica" });
  });

  const packageZones = document.querySelector("[data-package-zones]");
  if (packageZones && zones?.length) {
    packageZones.innerHTML = zones
      .map(
        (z) =>
          `<li><strong>${z.name}</strong> Desde ${formatCLP(z.price)} <span>${zoneShort(z.zones_text)}</span></li>`,
      )
      .join("");
  }

  // Pricing zones: mapa arriba, sin foto de relleno
  const zonePanels = document.querySelector("[data-zones-grid]") || document.querySelector(".zone-panels");
  if (zonePanels && zones?.length) {
    zonePanels.innerHTML = zones
      .map((z) => {
        const map = z.map_embed_url
          ? `<iframe title="Mapa ${z.name}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${z.map_embed_url}"></iframe>`
          : "";
        return `
      <article class="zone-card reveal is-visible${z.featured ? " featured" : ""}" role="listitem">
        <div class="zone-media">
          ${map}
          <span class="zone-badge">${z.badge || z.name}</span>
        </div>
        <div class="zone-body">
          <p class="price-sector">Desde</p>
          <p class="price-amount">${formatCLP(z.price)}</p>
          <p class="price-zones">${z.zones_text || ""}</p>
          <a class="btn btn-buy btn-buy--sm" href="#agendar" data-book="Consulta Etología Clínica" data-zone="${z.name || ""}">Agendar ${z.name}</a>
        </div>
      </article>`;
      })
      .join("");
  }

  const extrasBox = document.querySelector("[data-price-extras]") || document.querySelector(".price-extras");
  if (extrasBox && extras?.length) {
    extrasBox.innerHTML = extras
      .map((e) => `<p><strong>${e.label}:</strong> ${formatCLP(e.amount)}</p>`)
      .join("");
  }

  writeMediaCache(collectMediaUrls({ media, services }));
  applyMediaCache();
}
