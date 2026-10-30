const STORAGE_KEY = "armonivet.cart.v1";

export const CATALOG = [
  {
    id: "consulta-online",
    title: "Consulta Online Preferente",
    book: "Consulta remota",
    zone: "Online",
    price: 50000,
    desc: "Ideal para agresividad, miedo y ansiedad. Mismo plan de 30 días, desde cualquier comuna.",
    image: "https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80",
    tag: "Más vendido",
  },
  {
    id: "consulta-presencial",
    title: "Consulta Etología Clínica",
    book: "Consulta presencial",
    zone: "",
    price: 65000,
    desc: "Evaluación diagnóstica, guía de trabajo y plan de modificación conductual por 30 días.",
    image: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "entrenamiento-temprano",
    title: "Educación temprana para cachorros",
    book: "Educación temprana para cachorros",
    zone: "",
    price: 45000,
    desc: "Educación temprana para cachorros: orientación sobre eliminación, mordidas, socialización e independencia.",
    image: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=900&q=80",
    tag: "Cachorros",
  },
  {
    id: "entrenamiento",
    title: "Entrenamiento canino profesional",
    book: "Entrenamiento",
    zone: "",
    price: 45000,
    desc: "Entrenamiento de obediencia básica con refuerzo positivo: sentarse, echarse, acudir al llamado y caminar con correa.",
    image: "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "sitter",
    title: "Cat y pet sitter / paseos educativos",
    book: "Cat y pet sitter / paseos educativos",
    zone: "",
    price: null,
    priceLabel: "Sujeto a disponibilidad",
    desc: "Cuidado y paseos educativos sujetos a disponibilidad.",
    image: "https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "dos-pacientes",
    title: "2 pacientes mismo hogar",
    book: "2 pacientes mismo hogar",
    zone: "",
    price: null,
    priceLabel: "A confirmar",
    desc: "Consulta de etología para dos pacientes que viven en el mismo hogar.",
    image: "https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=900&q=80",
    tag: "Mismo hogar",
  },
  {
    id: "control-online",
    title: "Control online",
    book: "Control remoto",
    zone: "Online",
    price: 38000,
    desc: "Seguimiento por videollamada después de la primera consulta.",
    image: "https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "control-presencial",
    title: "Control presencial",
    book: "Control presencial",
    zone: "",
    price: 50000,
    desc: "Control a domicilio. Sector A $50.000 · Sector B $55.000.",
    image: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "pack-inicio-online",
    title: "Pack Inicio online",
    book: "Consulta remota",
    zone: "Online",
    price: 84000,
    desc: "Un primer paso para comprender qué le ocurre a tu mascota y comenzar a trabajar en sus problemas de comportamiento con orientación profesional.",
    image: "https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80",
    tag: "Pack",
  },
  {
    id: "pack-continuidad-online",
    title: "Pack Continuidad online",
    book: "Consulta remota",
    zone: "Online",
    price: 120000,
    desc: "Ideal para quienes buscan un seguimiento más cercano y necesitan tiempo para implementar las recomendaciones, evaluar avances y resolver nuevas dudas durante el proceso.",
    image: "https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80",
    tag: "Pack",
  },
  {
    id: "pack-mixto",
    title: "Pack 3: Acompañamiento mixto",
    book: "Consulta presencial",
    zone: "",
    price: 98000,
    desc: "Una alternativa para quienes prefieren comenzar con una atención presencial en el hogar y continuar el proceso mediante controles online.",
    image: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80",
    tag: "Pack",
  },
  {
    id: "pack-seguimiento-presencial",
    title: "Pack 4: Seguimiento presencial",
    book: "Consulta presencial",
    zone: "",
    price: 155000,
    desc: "Para quienes prefieren realizar el proceso con atención presencial y seguimiento en el entorno cotidiano de su mascota.",
    image: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80",
    tag: "Pack",
  },
];

export const ZONE_PRICE = {
  "Sector A": 65000,
  "Sector A y B": 65000,
  "Sector B": 70000,
  "Sector C": 70000,
  Online: 50000,
};
export const CONTROL_ZONE_PRICE = {
  "Sector A": 50000,
  "Sector A y B": 50000,
  "Sector B": 55000,
  "Sector C": 55000,
  Online: 38000,
};

export const ZONES = [
  {
    id: "Sector A",
    communes:
      "Ñuñoa, Macul, Providencia, Santiago Centro (hasta Santa Lucía), San Joaquín, Vitacura (límite), Las Condes (hasta Padre Hurtado), La Reina (hasta Valenzuela Llano), Peñalolén (hasta Consistorial), San Miguel y La Florida",
  },
  {
    id: "Sector B",
    communes:
      "Santiago Centro (U. de Chile a Los Héroes), Lo Barnechea, La Dehesa, San Carlos de Apoquindo, oriente de Las Condes, La Reina, Vitacura y Peñalolén, San Bernardo, Puente Alto y Huechuraba",
  },
];

/** Nombres públicos: A+B → Sector A, antiguo C → Sector B. */
export function toPublicZoneName(name) {
  const n = String(name || "").trim();
  if (!n) return n;
  if (/^sector\s+a\s*y\s*b$/i.test(n)) return "Sector A";
  if (/^sector\s+c$/i.test(n)) return "Sector B";
  return n;
}

export function mergeSamePriceZones(zones) {
  const groups = [];
  for (const zone of zones || []) {
    const price = Number(zone?.price);
    const existing = Number.isFinite(price) ? groups.find((group) => Number(group.price) === price) : null;
    if (!existing) groups.push({ price, parts: [zone] });
    else existing.parts.push(zone);
  }
  return groups.map((group) => {
    const parts = group.parts;
    if (parts.length === 1) {
      const alone = parts[0];
      const name = toPublicZoneName(alone.name);
      return name === alone.name ? alone : { ...alone, name, badge: name };
    }
    const letters = parts
      .map((part) => String(part.name || "").match(/sector\s+([abc])/i)?.[1]?.toUpperCase())
      .filter(Boolean);
    let name =
      letters.length === parts.length ? `Sector ${letters.join(" y ")}` : parts.map((part) => part.name).filter(Boolean).join(" y ");
    name = toPublicZoneName(name);
    if (letters.includes("A") && letters.includes("B") && !letters.includes("C")) name = "Sector A";
    const communes = parts
      .map((part) => String(part.zones_text || "").replace(/<[^>]+>/g, "").trim().replace(/\.$/, ""))
      .filter(Boolean)
      .join(". ");
    const featured = parts.find((part) => part.featured) || parts[0];
    return {
      ...featured,
      name,
      badge: name,
      price: group.price,
      zones_text: communes,
      featured: parts.some((part) => part.featured),
    };
  });
}

export function foldText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function serviceMode(service, zone) {
  const blob = foldText(`${service || ""} ${zone || ""}`);
  if (blob.includes("presencial") || blob.includes("domicilio")) return "presencial";
  if (
    blob.includes("online") ||
    blob.includes("remot") ||
    blob.includes("tempran") ||
    blob.includes("educacion") ||
    foldText(zone) === "online"
  ) {
    return "online";
  }
  return "presencial";
}

export function isFixedPrice(service) {
  const s = foldText(service);
  return (
    s.includes("pack") ||
    s.includes("entren") ||
    s.includes("tempran") ||
    s.includes("educacion") ||
    s.includes("sitter") ||
    s.includes("paciente") ||
    s.includes("mismo hogar")
  );
}

export function quoteAmount(service, zone) {
  const s = foldText(service);
  const z = zone || "";
  if (s.includes("pack")) return null;
  if (s.includes("sitter") || s.includes("paciente") || s.includes("mismo hogar")) return null;
  if (s.includes("tempran") || s.includes("educacion") || s.includes("entren")) return 45000;
  if (s.includes("control")) {
    if (s.includes("remot") || s.includes("online") || foldText(z) === "online") return 38000;
    return CONTROL_ZONE_PRICE[z] || 50000;
  }
  if (s.includes("remot") || s.includes("online") || foldText(z) === "online") return 50000;
  return ZONE_PRICE[z] || 65000;
}

export function zoneById(id) {
  return ZONES.find((zone) => zone.id === id) || null;
}

export function applyZoneToCart(service, zone) {
  const items = readCart();
  if (!items.length || !zone) return items;
  const wanted = foldText(service);
  let changed = false;
  const next = items.map((item) => {
    const book = `${item.book || ""} ${item.title || ""}`;
    if (isFixedPrice(book)) return item;
    const same =
      !wanted ||
      foldText(item.book) === wanted ||
      foldText(item.title).includes(wanted) ||
      wanted.includes(foldText(item.book));
    if (!same) return item;
    if (serviceMode(item.book, zone) === "online" && serviceMode(service, "") === "presencial") return item;
    const price = quoteAmount(item.book || service, zone);
    if (!price || (item.price === price && item.zone === zone)) return item;
    changed = true;
    const base = String(item.title || service || "Consulta").replace(/\s*·\s*(Sector .+|Online)$/i, "").trim();
    return { ...item, price, zone, title: zone ? `${base} · ${zone}` : base };
  });
  if (changed) writeCart(next);
  return changed ? next : items;
}

export function formatCLP(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readCart() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("armonivet:cart", { detail: { items } }));
}

export function getCart() {
  return readCart();
}

export function cartTotal(items = readCart()) {
  return items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
}

export function catalogById(id) {
  return CATALOG.find((item) => item.id === id) || null;
}

function itemFromTrigger(el) {
  const card = el.closest("article, .promo-spotlight-card");
  const rawId = el.getAttribute("data-add") || slugFromBook(el.getAttribute("data-book"));
  const aliases = {
    "etologia-clinica": "consulta-presencial",
    "entrenamiento-basico": "entrenamiento",
    "cat-pet-sitter": "sitter",
  };
  const id = aliases[rawId] || rawId;
  if (id === "asesoria" || id === "asesoria-felina-canina") return null;
  const catalog = catalogById(id) || {};
  const pick = card?.querySelector("[data-zone-pick]");
  const zone = pick?.value || el.getAttribute("data-zone") || "";
  const pickedPrice = pick?.selectedOptions?.[0]?.getAttribute("data-price");
  const priceAttr = pickedPrice || el.getAttribute("data-price");
  const hasPrice = priceAttr != null && priceAttr !== "";
  const isControl = id.includes("control") || String(catalog.book || "").toLowerCase().includes("control");
  const priceOnRequest = !hasPrice && (catalog.price === null || el.hasAttribute("data-price-label"));
  const price = hasPrice
    ? Number(priceAttr)
    : isControl
      ? CONTROL_ZONE_PRICE[zone] ?? catalog.price ?? 50000
      : priceOnRequest
        ? null
        : ZONE_PRICE[zone] ?? (catalog.price === null ? null : catalog.price ?? 65000);
  const img = card?.querySelector("img");
  return {
    id,
    title: el.getAttribute("data-title") || card?.querySelector("h3")?.textContent?.trim() || catalog.title || "Consulta",
    book: el.getAttribute("data-book") || catalog.book || "Consulta presencial",
    zone,
    price: Number.isFinite(price) ? price : null,
    priceLabel: el.getAttribute("data-price-label") || catalog.priceLabel || "",
    desc:
      card?.querySelector("p:not(.plan-badge):not(.plan-price):not(.plan-note):not(.zone-detail)")?.textContent?.trim() ||
      catalog.desc ||
      "",
    image: img?.currentSrc || img?.getAttribute("src") || img?.getAttribute("data-fallback") || catalog.image || "",
    qty: 1,
  };
}

function slugFromBook(book) {
  const value = foldText(book);
  if (value.includes("inicio online")) return "pack-inicio-online";
  if (value.includes("continuidad")) return "pack-continuidad-online";
  if (value.includes("mixto")) return "pack-mixto";
  if (value.includes("seguimiento presencial")) return "pack-seguimiento-presencial";
  if (value.includes("control") && (value.includes("remot") || value.includes("online"))) return "control-online";
  if (value.includes("control")) return "control-presencial";
  if (value.includes("remota") || value.includes("online")) return "consulta-online";
  if (value.includes("temprano") || value.includes("educacion")) return "entrenamiento-temprano";
  if (value.includes("sitter")) return "sitter";
  if (value.includes("paciente") || value.includes("mismo hogar")) return "dos-pacientes";
  if (value.includes("entrenamiento") || value.includes("obediencia")) return "entrenamiento";
  return "consulta-presencial";
}

export function addToCart(item) {
  if (!item || item.id === "asesoria" || item.id === "asesoria-felina-canina") return readCart();
  const items = readCart();
  const idx = items.findIndex((row) => row.id === item.id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...item, qty: 1 };
  } else {
    items.push({ ...item, qty: 1 });
  }
  writeCart(items);
  return items;
}

export function removeFromCart(id) {
  const items = readCart().filter((row) => row.id !== id);
  writeCart(items);
  return items;
}

export function clearCart() {
  writeCart([]);
}

function suggestionsFor(item) {
  const inCart = new Set(readCart().map((row) => row.id));
  return CATALOG.filter((row) => row.id !== item?.id && !inCart.has(row.id)).slice(0, 3);
}

function itemCard(item, { compact = false, removable = false } = {}) {
  const priceText = item.price != null ? formatCLP(item.price) : item.priceLabel || "Consultar";
  const zone = item.zone ? `<span class="cart-item-zone">${escapeHtml(item.zone)}</span>` : "";
  const remove = removable
    ? `<button type="button" class="cart-item-remove" data-cart-remove="${escapeHtml(item.id)}" aria-label="Quitar">Quitar</button>`
    : "";
  return `
    <article class="cart-item${compact ? " is-compact" : ""}">
      <img src="${escapeHtml(item.image)}" alt="" />
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        ${zone}
        ${compact ? "" : `<p>${escapeHtml(item.desc || "")}</p>`}
        <strong>${priceText}</strong>
        ${remove}
      </div>
    </article>`;
}

function suggestCard(item) {
  const priceText = item.price != null ? `Desde ${formatCLP(item.price)}` : item.priceLabel || "Consultar";
  return `
    <article class="cart-suggest-card">
      <img src="${escapeHtml(item.image)}" alt="" />
      <div>
        <h4>${escapeHtml(item.title)}</h4>
        <p>${priceText}</p>
        <p class="cart-suggest-mode">${serviceMode(item.book, item.zone) === "online" ? "Horario online" : "Horario presencial"}</p>
        <button
          type="button"
          class="btn btn-buy btn-buy--sm"
          data-add="${escapeHtml(item.id)}"
          data-book="${escapeHtml(item.book)}"
          data-zone="${escapeHtml(item.zone || "")}"
          data-price="${item.price ?? ""}"
          data-title="${escapeHtml(item.title)}"
        >Agendar</button>
      </div>
    </article>`;
}

function renderBadge(count) {
  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    el.textContent = String(count);
    el.hidden = count === 0;
  });
}

function renderBookingSummary() {
  const box = document.querySelector("[data-booking-cart]");
  if (!box) return;
  const items = readCart();
  if (!items.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const total = cartTotal(items);
  box.hidden = false;
  box.innerHTML = `
    <h3>Tu carrito</h3>
    ${items.map((item) => itemCard(item, { compact: true, removable: true })).join("")}
    <p class="booking-cart-total">Total <strong>${total ? formatCLP(total) : "A confirmar"}</strong></p>
  `;
}

function applyFirstItemToForm() {
  const items = readCart();
  const first = items[0];
  const form = document.querySelector("[data-booking-form]");
  if (!first || !form) return;
  const serviceSelect = form.elements?.service;
  const zoneSelect = form.elements?.zone;
  if (serviceSelect && first.book) {
    const match = Array.from(serviceSelect.options).find((o) => o.value === first.book);
    if (!match) {
      const opt = document.createElement("option");
      opt.value = first.book;
      opt.textContent = first.book;
      serviceSelect.appendChild(opt);
    }
    serviceSelect.value = first.book;
  }
  if (zoneSelect && first.zone) zoneSelect.value = first.zone;
  form.dispatchEvent(new CustomEvent("armonivet:book-target", { bubbles: true }));
}

function closeModal() {
  const overlay = document.querySelector("[data-cart-overlay]");
  if (!overlay) return;
  overlay.hidden = true;
  if (document.querySelector("[data-control-overlay]")?.hidden !== false) {
    document.body.classList.remove("cart-open");
  }
}

let pendingControlBtn = null;

function isControlAdd(el) {
  const id = String(el?.getAttribute("data-add") || "");
  const book = foldText(el?.getAttribute("data-book") || "");
  return id.startsWith("control") || book.includes("control");
}

function closeControlNotice() {
  const overlay = document.querySelector("[data-control-overlay]");
  if (!overlay) return;
  overlay.hidden = true;
  pendingControlBtn = null;
  if (document.querySelector("[data-cart-overlay]")?.hidden !== false) {
    document.body.classList.remove("cart-open");
  }
}

function openControlNotice(trigger) {
  const overlay = document.querySelector("[data-control-overlay]");
  if (!overlay) return;
  pendingControlBtn = trigger;
  const id = String(trigger?.getAttribute("data-add") || "");
  const book = foldText(trigger?.getAttribute("data-book") || "");
  const kind = id.includes("online") || book.includes("online") || book.includes("remot") ? "online" : "presencial";
  overlay.querySelectorAll("[data-control-kind]").forEach((article) => {
    article.classList.toggle("is-selected", article.getAttribute("data-control-kind") === kind);
  });
  overlay.hidden = false;
  document.body.classList.add("cart-open");
  overlay.querySelector(".control-notice-dialog")?.focus();
}

function openModal({ mode = "added", item = null } = {}) {
  const overlay = document.querySelector("[data-cart-overlay]");
  const addedEl = overlay?.querySelector("[data-cart-added]");
  const listEl = overlay?.querySelector("[data-cart-list]");
  const suggestEl = overlay?.querySelector("[data-cart-suggest]");
  const titleEl = overlay?.querySelector("[data-cart-title]");
  if (!overlay || !addedEl || !suggestEl) return;

  const items = readCart();
  const focus = item || items[items.length - 1];
  overlay.hidden = false;
  document.body.classList.add("cart-open");

  if (mode === "cart") {
    if (titleEl) titleEl.textContent = items.length ? "Tu carrito" : "El carrito está vacío";
    addedEl.hidden = true;
    if (listEl) {
      listEl.hidden = !items.length;
      listEl.innerHTML = items.map((row) => itemCard(row, { compact: true, removable: true })).join("");
    }
  } else {
    if (titleEl) titleEl.textContent = "Agregaste a tu carrito";
    addedEl.hidden = !focus;
    addedEl.innerHTML = focus ? itemCard(focus) : "";
    if (listEl) listEl.hidden = true;
  }

  const suggestions = suggestionsFor(focus);
  suggestEl.innerHTML = suggestions.length
    ? `<h3>También te podría interesar</h3><div class="cart-suggest-grid">${suggestions.map(suggestCard).join("")}</div>`
    : "";
}

export function initCart() {
  const cleaned = readCart().filter((row) => row.id !== "asesoria" && row.id !== "asesoria-felina-canina");
  if (cleaned.length !== readCart().length) writeCart(cleaned);
  renderBadge(readCart().length);
  renderBookingSummary();

  document.addEventListener("change", (e) => {
    const pick = e.target.closest("[data-zone-pick]");
    if (!pick) return;
    const card = pick.closest("article");
    const option = pick.selectedOptions?.[0];
    const zone = pick.value;
    const price = option?.getAttribute("data-price") || "";
    const communes = option?.getAttribute("data-communes") || "";
    const btn = card?.querySelector("[data-add]");
    if (btn) {
      btn.setAttribute("data-zone", zone);
      if (price) btn.setAttribute("data-price", price);
      const base = (btn.getAttribute("data-title-base") || card?.querySelector("h3")?.textContent || "Consulta presencial").trim();
      btn.setAttribute("data-title", `${base} · ${zone}`);
    }
    const detail = card?.querySelector("[data-zone-detail]");
    if (detail) {
      detail.textContent = price ? `${formatCLP(Number(price))}. ${communes}` : communes;
    }
    const priceEl = card?.querySelector("[data-offer-price], .plan-price");
    if (priceEl && price) priceEl.innerHTML = `<strong>${formatCLP(Number(price))}</strong>`;
  });

  document.addEventListener("click", (e) => {
    const card = e.target.closest(".plan-card, .package-hero, .offer-card, .promo-spotlight-card, .control-book-card");
    if (card && !e.target.closest("a, select, summary, input, textarea, button, label")) {
      const addBtn = card.querySelector("[data-add]");
      if (addBtn) addBtn.click();
      return;
    }
    if (e.target.closest("[data-control-confirm]")) {
      e.preventDefault();
      const trigger = pendingControlBtn;
      closeControlNotice();
      if (!trigger) return;
      const item = itemFromTrigger(trigger);
      if (!item) return;
      addToCart(item);
      applyFirstItemToForm();
      openModal({ mode: "added", item });
      return;
    }
    if (e.target.closest("[data-control-close]")) {
      e.preventDefault();
      closeControlNotice();
      return;
    }
    const addBtn = e.target.closest("[data-add]");
    if (addBtn) {
      e.preventDefault();
      if (isControlAdd(addBtn)) {
        openControlNotice(addBtn);
        return;
      }
      const item = itemFromTrigger(addBtn);
      if (!item) return;
      addToCart(item);
      applyFirstItemToForm();
      openModal({ mode: "added", item });
      return;
    }
    if (e.target.closest("[data-cart-open]")) {
      e.preventDefault();
      openModal({ mode: "cart" });
      return;
    }
    if (e.target.closest("[data-cart-close], [data-cart-continue]")) {
      e.preventDefault();
      closeModal();
      return;
    }
    const checkout = e.target.closest("[data-cart-checkout]");
    if (checkout) {
      e.preventDefault();
      closeModal();
      applyFirstItemToForm();
      const href = checkout.getAttribute("href") || "#agendar";
      window.dispatchEvent(new CustomEvent("armonivet:goto", { detail: { hash: href.includes("#") ? `#${href.split("#")[1]}` : "#agendar" } }));
      return;
    }
    const removeBtn = e.target.closest("[data-cart-remove]");
    if (removeBtn) {
      removeFromCart(removeBtn.getAttribute("data-cart-remove"));
      const overlay = document.querySelector("[data-cart-overlay]");
      if (overlay && !overlay.hidden) openModal({ mode: overlay.querySelector("[data-cart-list]")?.hidden === false ? "cart" : "added" });
    }
    if (e.target.matches("[data-cart-overlay]")) closeModal();
    if (e.target.matches("[data-control-overlay]")) closeControlNotice();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const control = document.querySelector("[data-control-overlay]");
    if (control && !control.hidden) {
      closeControlNotice();
      return;
    }
    closeModal();
  });

  window.addEventListener("armonivet:cart", () => {
    renderBadge(readCart().length);
    renderBookingSummary();
  });
}
