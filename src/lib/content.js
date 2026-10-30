import { isSupabaseConfigured, supabase } from "./supabase.js";
import { applyMediaCache, collectMediaUrls, writeMediaCache } from "./media-cache.js";
import { CONTROL_ZONE_PRICE, formatCLP as formatCartCLP, mergeSamePriceZones, serviceMode } from "./cart.js";

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
    return "Evaluación diagnóstica, guía de trabajo y plan de modificación conductual por 30 días.";
  }
  return raw;
}

const HIDDEN_SERVICE_SLUGS = new Set(["asesoria-felina-canina", "asesoria"]);
const LOCK_COPY_SLUGS = new Set(["entrenamiento-basico", "entrenamiento-temprano", "entrenamiento"]);
const PUBLIC_COPY = {
  "entrenamiento-basico": {
    title: "Entrenamiento canino profesional",
    description:
      "Entrenamiento de obediencia básica con refuerzo positivo: sentarse, echarse, acudir al llamado y caminar con correa.",
    book: "Entrenamiento",
  },
  entrenamiento: {
    title: "Entrenamiento canino profesional",
    description:
      "Entrenamiento de obediencia básica con refuerzo positivo: sentarse, echarse, acudir al llamado y caminar con correa.",
    book: "Entrenamiento",
  },
  "entrenamiento-temprano": {
    title: "Educación temprana para cachorros",
    description:
      "Educación temprana para cachorros: orientación sobre eliminación, mordidas, socialización e independencia.",
    book: "Educación temprana para cachorros",
  },
};

function isHiddenService(service) {
  const slug = String(service?.slug || "").toLowerCase();
  const title = String(service?.title || "").toLowerCase();
  return HIDDEN_SERVICE_SLUGS.has(slug) || /asesor[ií]a\s+felina/i.test(title);
}

function publicCopy(service) {
  return PUBLIC_COPY[service?.slug] || {
    title: service?.title || "",
    description: etologiaCopy(service?.description, { fallback: service?.slug === "etologia-clinica" }),
    book: service?.title || "Consulta presencial",
  };
}

function zoneShort(text) {
  const raw = String(text || "").replace(/<[^>]+>/g, "").trim();
  if (!raw) return "";
  return raw.length > 52 ? `${raw.slice(0, 50)}…` : raw;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fillZoneSelect(select, zones) {
  const current = select.value;
  const kind = select.getAttribute("data-price-kind") || "consulta";
  const options = zones.map((zone) => {
    const price = kind === "control" ? CONTROL_ZONE_PRICE[zone.name] || zone.price : zone.price;
    const communes = String(zone.zones_text || "").replace(/<[^>]+>/g, "").trim();
    const selected = zone.name === current ? " selected" : "";
    return `<option value="${escapeHtml(zone.name)}" data-price="${price ?? ""}" data-communes="${escapeHtml(communes)}"${selected}>${escapeHtml(zone.name)} · ${formatCLP(price)} · ${escapeHtml(zoneShort(communes))}</option>`;
  });
  const online =
    select.hasAttribute("data-booking-zone")
      ? `<option value="Online" data-price="50000" data-communes="Cualquier comuna, por videollamada"${current === "Online" ? " selected" : ""}>Online · ${formatCLP(50000)} · Cualquier comuna</option>`
      : "";
  const placeholder = select.hasAttribute("data-booking-zone") ? `<option value="">Elige la zona</option>` : "";
  select.innerHTML = placeholder + options.join("") + online;
  if (current) select.value = current;
  const card = select.closest("article");
  const option = select.selectedOptions?.[0];
  const detail = card?.querySelector("[data-zone-detail]");
  if (detail && option) {
    detail.textContent = [formatCLP(option.getAttribute("data-price")), option.getAttribute("data-communes")].filter(Boolean).join(". ");
  }
  const btn = card?.querySelector("[data-add]");
  if (btn && option?.value && !select.hasAttribute("data-booking-zone")) {
    btn.setAttribute("data-zone", option.value);
    if (option.getAttribute("data-price")) btn.setAttribute("data-price", option.getAttribute("data-price"));
  }
  const shown = option?.getAttribute("data-price");
  const priceEl = card?.querySelector("[data-offer-price], .plan-price");
  if (priceEl && shown && !select.hasAttribute("data-booking-zone")) {
    priceEl.innerHTML = `<strong>${formatCLP(shown)}</strong>`;
  }
}

function offerPriceMarkup(service) {
  if (service?.price_from) {
    const label = String(service.price_label || "");
    if (label && !/desde/i.test(label)) return `<strong>${escapeHtml(label)}</strong>`;
    return `Desde <strong>${formatCartCLP(service.price_from)}</strong>`;
  }
  return `<strong>${escapeHtml(service?.price_label || "A confirmar")}</strong>`;
}

function offerCardMarkup(service) {
  const copy = publicCopy(service);
  const target = bookForService(service);
  const tag = service.tag
    ? `<span class="offer-tag${/vendido/i.test(service.tag) ? "" : " offer-tag--alt"}">${escapeHtml(service.tag)}</span>`
    : "";
  const priceAttr = service.price_from != null && service.price_from !== "" ? ` data-price="${escapeHtml(service.price_from)}"` : "";
  const labelAttr = !service.price_from ? ` data-price-label="${escapeHtml(service.price_label || "A confirmar")}"` : "";
  const zoneAttr = target.zone ? ` data-zone="${escapeHtml(target.zone)}"` : "";
  const img = isSafeImageUrl(service.image_url) ? ` src="${escapeHtml(service.image_url)}"` : "";
  return `
    <article class="offer-card reveal is-visible">
      <figure>
        <img data-cms-service="${escapeHtml(service.slug)}"${img} alt="${escapeHtml(copy.title)}" />
        ${tag}
      </figure>
      <div class="offer-body">
        <h3>${escapeHtml(copy.title)}</h3>
        <p>${escapeHtml(copy.description || "")}</p>
        <div class="offer-price-row">
          <span>${offerPriceMarkup(service)}</span>
          <button type="button" class="btn btn-buy btn-buy--sm" data-add="${escapeHtml(service.slug)}" data-book="${escapeHtml(target.book)}" data-title="${escapeHtml(copy.title)}"${zoneAttr}${priceAttr}${labelAttr}>Agendar</button>
        </div>
      </div>
    </article>`;
}

function bookForService(service) {
  const blob = `${service?.title || ""} ${service?.slug || ""}`.toLowerCase();
  if (blob.includes("presencial") || blob.includes("domicilio")) {
    return { book: blob.includes("control") ? "Control presencial" : "Consulta presencial", zone: "" };
  }
  if (blob.includes("cachorr") || blob.includes("tempran")) {
    return { book: "Educación temprana para cachorros", zone: "Online" };
  }
  if (blob.includes("entren")) return { book: "Entrenamiento", zone: "" };
  if (blob.includes("sitter")) return { book: "Cat y pet sitter / paseos educativos", zone: "" };
  if (blob.includes("paciente") || blob.includes("mismo hogar")) return { book: "2 pacientes mismo hogar", zone: "" };
  if (blob.includes("control") && (blob.includes("online") || blob.includes("remot"))) {
    return { book: "Control remoto", zone: "Online" };
  }
  if (blob.includes("online") || blob.includes("remot")) return { book: "Consulta remota", zone: "Online" };
  return { book: service?.title || "Consulta presencial", zone: "" };
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
  const offerServices = (services || [])
    .filter((s) => s.section === "ofertas" || s.section === "ambos")
    .filter((s) => !isHiddenService(s));
  if (offerGrid) {
    Array.from(offerGrid.querySelectorAll(".offer-card")).forEach((card) => {
      const slug = card.querySelector("[data-cms-service]")?.getAttribute("data-cms-service") || "";
      const titleText = card.querySelector("h3")?.textContent || "";
      if (HIDDEN_SERVICE_SLUGS.has(slug) || /asesor[ií]a\s+felina/i.test(titleText)) {
        card.remove();
        return;
      }
      const service = offerServices.find((row) => row.slug === slug);
      if (!service) return;
      const img = card.querySelector("img");
      if (img) {
        img.setAttribute("data-cms-service", service.slug);
        setImgSrc(img, service.image_url);
      }
      if (LOCK_COPY_SLUGS.has(service.slug)) return;
      const title = card.querySelector("h3");
      const desc = card.querySelector(".offer-body p");
      if (title && service.title) title.textContent = service.title;
      if (desc) desc.textContent = etologiaCopy(service.description, { fallback: service.slug === "etologia-clinica" });
    });

    const present = new Set();
    offerGrid.querySelectorAll("[data-cms-service], [data-add]").forEach((el) => {
      const value = el.getAttribute("data-cms-service") || el.getAttribute("data-add");
      if (value) present.add(value);
    });
    if (present.has("entrenamiento") || present.has("entrenamiento-basico")) {
      present.add("entrenamiento");
      present.add("entrenamiento-basico");
    }
    if (present.has("sitter") || present.has("cat-pet-sitter")) {
      present.add("sitter");
      present.add("cat-pet-sitter");
    }
    if (present.has("etologia-clinica") || present.has("consulta-presencial")) {
      present.add("etologia-clinica");
      present.add("consulta-presencial");
    }
    const missingOffers = offerServices.filter((service) => {
      if (!service?.slug || present.has(service.slug)) return false;
      if (/^(pack|control)-/.test(service.slug) || service.slug === "flores-de-bach") return false;
      return true;
    });
    if (missingOffers.length) {
      offerGrid.insertAdjacentHTML("beforeend", missingOffers.map((service) => offerCardMarkup(service)).join(""));
    }
  }

  document.querySelectorAll("[data-cms-service]").forEach((img) => {
    const slug = img.getAttribute("data-cms-service");
    const service = (services || []).find((s) => s.slug === slug);
    if (service?.image_url) setImgSrc(img, service.image_url);
  });

  document.querySelectorAll("[data-plan-slug]").forEach((card) => {
    const slug = card.getAttribute("data-plan-slug");
    const titleText = card.querySelector("h3")?.textContent || "";
    if (HIDDEN_SERVICE_SLUGS.has(slug) || /asesor[ií]a\s+felina/i.test(titleText)) {
      card.remove();
      return;
    }
    const service = (services || []).find((s) => s.slug === slug);
    if (!service) return;
    const img = card.querySelector("img");
    if (img && slug) img.setAttribute("data-cms-service", slug);
    setImgSrc(img, service.image_url);
    if (LOCK_COPY_SLUGS.has(slug)) return;
    const title = card.querySelector("h3");
    const desc = card.querySelector(":scope > div > p");
    if (title && service.title) title.textContent = service.title;
    if (desc) desc.textContent = etologiaCopy(service.description, { fallback: slug === "etologia-clinica" });
  });

  const publicZones = mergeSamePriceZones(zones);
  if (publicZones.length) {
    document.querySelectorAll("[data-zone-pick], [data-booking-zone]").forEach((select) => fillZoneSelect(select, publicZones));
    window.dispatchEvent(new CustomEvent("armonivet:zones"));
  }

  const known = new Set([
    "consulta-online",
    "consulta-presencial",
    "etologia-clinica",
    "entrenamiento",
    "entrenamiento-basico",
    "entrenamiento-temprano",
    "sitter",
    "cat-pet-sitter",
    "dos-pacientes",
    "pack-inicio-online",
    "pack-continuidad-online",
    "pack-mixto",
    "pack-seguimiento-presencial",
    "control-online",
    "control-presencial",
    "flores-de-bach",
  ]);
  document.querySelectorAll("[data-add], [data-plan-slug]").forEach((el) => {
    const id = el.getAttribute("data-add") || el.getAttribute("data-plan-slug");
    if (id) known.add(id);
  });
  const extraRoot = document.querySelector("[data-extra-packs]");
  const extraServices = (services || []).filter((service) => service.active !== false && !isHiddenService(service) && !known.has(service.slug));
  if (extraRoot && extraServices.length) {
    extraRoot.innerHTML = extraServices
      .map((service) => {
        const target = bookForService(service);
        const price = service.price_from;
        const mode = serviceMode(target.book, target.zone);
        return `
          <article class="plan-card">
            <p class="plan-badge">${escapeHtml(service.tag || (mode === "online" ? "Online" : "Presencial"))}</p>
            <h3>${escapeHtml(service.title)}</h3>
            <p class="plan-price">${price ? `<strong>${formatCartCLP(price)}</strong>` : escapeHtml(service.price_label || "A confirmar")}</p>
            <p>${escapeHtml(service.description || "")}</p>
            <button type="button" class="btn btn-buy btn-buy--sm" data-add="${escapeHtml(service.slug)}" data-book="${escapeHtml(target.book)}" data-zone="${escapeHtml(target.zone)}" data-price="${price ?? ""}" data-title="${escapeHtml(service.title)}">Elegir este pack</button>
          </article>`;
      })
      .join("");
  }

  // Pricing zones: mapa arriba, sin foto de relleno
  const zonePanels = document.querySelector("[data-zones-grid]") || document.querySelector(".zone-panels");
  if (zonePanels && publicZones.length) {
    zonePanels.innerHTML = publicZones
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
          <p class="price-sector">Primera consulta</p>
          <p class="price-amount">${formatCLP(z.price)}</p>
          <p class="price-control">Control ${formatCLP(CONTROL_ZONE_PRICE[z.name] || 50000)}</p>
          <p class="price-zones">${z.zones_text || ""}</p>
          <button type="button" class="btn btn-buy btn-buy--sm" data-add="consulta-presencial" data-book="Consulta presencial" data-zone="${z.name || ""}" data-price="${z.price ?? 65000}" data-title="Consulta presencial · ${z.name || ""}">Agendar consulta</button>
          <button type="button" class="btn btn-ghost btn-buy--sm" data-add="control-presencial" data-book="Control presencial" data-zone="${z.name || ""}" data-price="${CONTROL_ZONE_PRICE[z.name] || 50000}" data-title="Control presencial · ${z.name || ""}">Agendar control</button>
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
