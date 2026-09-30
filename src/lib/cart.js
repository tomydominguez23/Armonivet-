const STORAGE_KEY = "armonivet.cart.v1";

export const CATALOG = [
  {
    id: "consulta-online",
    title: "Consulta Online Preferente",
    book: "Consulta remota",
    zone: "Online",
    price: 45000,
    desc: "Ideal para agresividad, miedo y ansiedad. Mismo plan de 30 días, desde cualquier comuna.",
    image: "https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80",
    tag: "Más vendido",
  },
  {
    id: "consulta-presencial",
    title: "Consulta Etología Clínica",
    book: "Consulta presencial",
    zone: "",
    price: 45000,
    desc: "Evaluación diagnóstica, guía de trabajo y plan de modificación conductual por 30 días.",
    image: "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "entrenamiento-temprano",
    title: "Entrenamiento temprano",
    book: "Entrenamiento temprano",
    zone: "",
    price: 45000,
    desc: "Educación de 3 a 6 meses: hábitos, mordidas y convivencia en casa.",
    image: "https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=900&q=80",
    tag: "Cachorros",
  },
  {
    id: "entrenamiento",
    title: "Entrenamiento canino profesional",
    book: "Entrenamiento",
    zone: "",
    price: 45000,
    desc: "Educación guiada para el día a día y el vínculo familiar.",
    image: "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "asesoria",
    title: "Asesoría felina / canina",
    book: "Asesoría felina / canina",
    zone: "",
    price: 45000,
    desc: "Miedo, ruidos, mudanzas y convivencia.",
    image: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=900&q=80",
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
];

const ZONE_PRICE = { "Sector A": 45000, "Sector B": 50000, "Sector C": 55000, Online: 45000 };

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
    "asesoria-felina-canina": "asesoria",
    "cat-pet-sitter": "sitter",
  };
  const id = aliases[rawId] || rawId;
  const catalog = catalogById(id) || {};
  const zone = el.getAttribute("data-zone") || "";
  const priceAttr = el.getAttribute("data-price");
  const hasPrice = priceAttr != null && priceAttr !== "";
  const price = hasPrice
    ? Number(priceAttr)
    : ZONE_PRICE[zone] ?? (catalog.price === null ? null : catalog.price ?? 45000);
  const img = card?.querySelector("img");
  return {
    id,
    title: el.getAttribute("data-title") || card?.querySelector("h3")?.textContent?.trim() || catalog.title || "Consulta",
    book: el.getAttribute("data-book") || catalog.book || "Consulta presencial",
    zone,
    price: Number.isFinite(price) ? price : null,
    priceLabel: el.getAttribute("data-price-label") || catalog.priceLabel || "",
    desc: card?.querySelector("p")?.textContent?.trim() || catalog.desc || "",
    image: img?.currentSrc || img?.getAttribute("src") || img?.getAttribute("data-fallback") || catalog.image || "",
    qty: 1,
  };
}

function slugFromBook(book) {
  const value = String(book || "").toLowerCase();
  if (value.includes("remota") || value.includes("online")) return "consulta-online";
  if (value.includes("temprano")) return "entrenamiento-temprano";
  if (value.includes("sitter")) return "sitter";
  if (value.includes("asesor")) return "asesoria";
  if (value.includes("entrenamiento")) return "entrenamiento";
  return "consulta-presencial";
}

export function addToCart(item) {
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
        <button
          type="button"
          class="btn btn-buy btn-buy--sm"
          data-add="${escapeHtml(item.id)}"
          data-book="${escapeHtml(item.book)}"
          data-zone="${escapeHtml(item.zone || "")}"
          data-price="${item.price ?? ""}"
          data-title="${escapeHtml(item.title)}"
        >Agregar</button>
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
}

function closeModal() {
  const overlay = document.querySelector("[data-cart-overlay]");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove("cart-open");
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
  renderBadge(readCart().length);
  renderBookingSummary();

  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (addBtn) {
      e.preventDefault();
      const item = itemFromTrigger(addBtn);
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
      closeModal();
      applyFirstItemToForm();
      return;
    }
    const removeBtn = e.target.closest("[data-cart-remove]");
    if (removeBtn) {
      removeFromCart(removeBtn.getAttribute("data-cart-remove"));
      const overlay = document.querySelector("[data-cart-overlay]");
      if (overlay && !overlay.hidden) openModal({ mode: overlay.querySelector("[data-cart-list]")?.hidden === false ? "cart" : "added" });
    }
    if (e.target.matches("[data-cart-overlay]")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  window.addEventListener("armonivet:cart", () => {
    renderBadge(readCart().length);
    renderBookingSummary();
  });
}
