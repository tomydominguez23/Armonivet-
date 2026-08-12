import { isSupabaseConfigured, supabase } from "./supabase.js";

function formatCLP(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export async function hydrateSiteContent() {
  if (!isSupabaseConfigured || !supabase) return;

  const [{ data: services }, { data: zones }, { data: extras }, { data: media }, { data: settingsRow }] =
    await Promise.all([
      supabase.from("services").select("*").eq("active", true).order("sort_order"),
      supabase.from("pricing_zones").select("*").eq("active", true).order("sort_order"),
      supabase.from("price_extras").select("*").eq("active", true).order("sort_order"),
      supabase.from("site_media").select("*"),
      supabase.from("site_settings").select("value").eq("key", "business").maybeSingle(),
    ]);

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
    if (slot?.url && img) img.src = slot.url;
  });

  // Gallery
  document.querySelectorAll(".gallery-grid figure img").forEach((img, i) => {
    const slot = mediaMap[`gallery_${i + 1}`];
    if (slot?.url) {
      img.src = slot.url;
      if (slot.alt_text) img.alt = slot.alt_text;
    }
  });

  // Doctor photo
  const doctor = document.querySelector(".about-doctor img");
  if (doctor && mediaMap.about_doctor?.url) {
    doctor.src = mediaMap.about_doctor.url;
  }

  const midBanner = document.querySelector(".mid-banner-photo img");
  if (midBanner && mediaMap.mid_banner?.url) {
    midBanner.src = mediaMap.mid_banner.url;
  }

  // Offers / services cards
  const offerGrid = document.querySelector("[data-offers-grid]") || document.querySelector(".offer-grid");
  const offerServices = (services || []).filter((s) => s.section === "ofertas" || s.section === "ambos").slice(0, 4);
  if (offerGrid && offerServices.length) {
    offerGrid.innerHTML = offerServices
      .map(
        (s) => `
      <article class="offer-card reveal is-visible">
        <figure>
          <img src="${s.image_url || ""}" alt="${s.title}" />
          ${s.tag ? `<span class="offer-tag">${s.tag}</span>` : ""}
        </figure>
        <div class="offer-body">
          <h3>${s.title}</h3>
          <p>${s.description || ""}</p>
          <div class="offer-price-row">
            <span>${s.price_label || (s.price_from != null ? `Desde <strong>${formatCLP(s.price_from)}</strong>` : "")}</span>
            <a class="btn btn-buy btn-buy--sm" href="${s.calendly_url || settings.calendly_url || "#"}" target="_blank" rel="noopener noreferrer">Agendar</a>
          </div>
        </div>
      </article>`
      )
      .join("");
  }

  const serviceCards = document.querySelector("[data-services-grid]") || document.querySelector(".service-cards");
  const listServices = (services || []).filter((s) => s.section === "servicios" || s.section === "ambos");
  if (serviceCards && listServices.length) {
    serviceCards.innerHTML = listServices
      .map(
        (s, idx) => `
      <article class="service-card reveal is-visible">
        <img src="${s.image_url || ""}" alt="${s.title}" />
        <div>
          <span class="service-index">${String(idx + 1).padStart(2, "0")}</span>
          <h3>${s.title}</h3>
          <p>${s.description || ""}</p>
          <a class="btn btn-buy btn-buy--sm" href="${s.calendly_url || settings.calendly_url || "#"}" target="_blank" rel="noopener noreferrer">Agendar</a>
        </div>
      </article>`
      )
      .join("");
  }

  // Pricing zones
  const zonePanels = document.querySelector("[data-zones-grid]") || document.querySelector(".zone-panels");
  if (zonePanels && zones?.length) {
    zonePanels.innerHTML = zones
      .map(
        (z) => `
      <article class="zone-card reveal is-visible${z.featured ? " featured" : ""}" role="listitem">
        <div class="zone-media">
          <img src="${z.image_url || ""}" alt="${z.name}" />
          <span class="zone-badge">${z.badge || z.name}</span>
        </div>
        <div class="zone-body">
          <p class="price-sector">Desde</p>
          <p class="price-amount">${formatCLP(z.price)}</p>
          <p class="price-zones">${z.zones_text || ""}</p>
          <a class="btn btn-buy btn-buy--sm" href="${settings.calendly_url || "https://calendly.com/armonivet/consulta-etologia-clinica"}" target="_blank" rel="noopener noreferrer">Agendar ${z.name}</a>
        </div>
        ${
          z.map_embed_url
            ? `<div class="zone-map"><iframe title="Mapa ${z.name}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen src="${z.map_embed_url}"></iframe></div>`
            : ""
        }
      </article>`
      )
      .join("");
  }

  const extrasBox = document.querySelector("[data-price-extras]") || document.querySelector(".price-extras");
  if (extrasBox && extras?.length) {
    extrasBox.innerHTML = extras
      .map((e) => `<p><strong>${e.label}:</strong> ${formatCLP(e.amount)}</p>`)
      .join("");
  }
}
