import { isSupabaseConfigured, requireSupabase, supabase } from "../lib/supabase.js";

const titles = {
  dashboard: ["Dashboard", "Métricas del negocio en tiempo real"],
  appointments: ["Citas", "Agenda, abonos y asistencia"],
  channels: ["Canales", "Atribución de publicidad y UTM"],
  services: ["Servicios", "Contenido y precios de la web"],
  pricing: ["Precios", "Zonas de domicilio y extras"],
  media: ["Imágenes", "Slots visuales del sitio"],
  settings: ["Ajustes", "Enlaces y datos del negocio"],
};

const state = {
  section: "dashboard",
  days: 30,
  editing: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function formatCLP(n) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function showView(name) {
  $$("[data-view]").forEach((el) => {
    el.hidden = el.dataset.view !== name;
  });
}

function setSection(section) {
  state.section = section;
  $$("[data-nav]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.nav === section));
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === section));
  const [title, sub] = titles[section] || ["Admin", ""];
  $("[data-page-title]").textContent = title;
  $("[data-page-sub]").textContent = sub;
  document.querySelector(".admin-shell")?.classList.remove("is-nav-open");
  loadSection(section);
}

async function ensureSession() {
  if (!isSupabaseConfigured) {
    $("[data-config-hint]").hidden = false;
    showView("login");
    return null;
  }
  const client = requireSupabase();
  const { data } = await client.auth.getSession();
  return data.session;
}

async function boot() {
  const session = await ensureSession();
  if (!session) {
    showView("login");
    return;
  }
  $("[data-user-email]").textContent = session.user.email || "Admin";
  showView("app");
  setSection("dashboard");
}

$("[data-login-form]")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("[data-login-error]");
  errEl.hidden = true;
  if (!isSupabaseConfigured) {
    errEl.textContent = "Supabase no está configurado.";
    errEl.hidden = false;
    return;
  }
  const fd = new FormData(e.currentTarget);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.hidden = false;
    return;
  }
  await boot();
});

$("[data-logout]")?.addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
  showView("login");
});

$$("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => setSection(btn.dataset.nav));
});

$("[data-menu-toggle]")?.addEventListener("click", () => {
  $(".admin-shell")?.classList.toggle("is-nav-open");
});

$("[data-range]")?.addEventListener("change", (e) => {
  state.days = Number(e.target.value) || 30;
  if (state.section === "dashboard") loadDashboard();
});

async function loadSection(section) {
  if (section === "dashboard") return loadDashboard();
  if (section === "appointments") return loadAppointments();
  if (section === "channels") return loadChannels();
  if (section === "services") return loadServices();
  if (section === "pricing") return loadPricing();
  if (section === "media") return loadMedia();
  if (section === "settings") return loadSettings();
}

/* -------------------- Dashboard -------------------- */
async function loadDashboard() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("admin_dashboard_stats", { days: state.days });

  let stats = data;
  if (error || !stats) {
    stats = await fallbackStats(client, state.days);
  }

  const map = {
    visits_unique: stats.visits_unique,
    click_agendar: stats.click_agendar,
    appointments: stats.appointments,
    paid: stats.paid,
    arrived: stats.arrived,
    revenue_estimated: formatCLP(stats.revenue_estimated),
  };
  Object.entries(map).forEach(([k, v]) => {
    const el = $(`[data-kpi="${k}"]`);
    if (el) el.textContent = v ?? 0;
  });

  renderVisitChart(stats.visits_by_day || []);
  renderChannels(stats.by_channel || []);
  renderFunnel(stats);
  renderStatus(stats.appointments_by_status || []);
}

async function fallbackStats(client, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [{ data: visits }, { data: events }, { data: appointments }] = await Promise.all([
    client.from("page_visits").select("created_at,is_unique_session,channel_slug").gte("created_at", since),
    client.from("conversion_events").select("event_type,created_at").gte("created_at", since),
    client.from("appointments").select("*").gte("created_at", since),
  ]);

  const v = visits || [];
  const a = appointments || [];
  const e = events || [];

  const byChannel = {};
  const byDay = {};
  v.forEach((row) => {
    const ch = row.channel_slug || "directo";
    byChannel[ch] ||= { channel: ch, unique_visits: 0 };
    if (row.is_unique_session) byChannel[ch].unique_visits += 1;
    const day = row.created_at.slice(0, 10);
    byDay[day] ||= { day, unique_visits: 0, hits: 0 };
    byDay[day].hits += 1;
    if (row.is_unique_session) byDay[day].unique_visits += 1;
  });

  const statusMap = {};
  a.forEach((row) => {
    statusMap[row.status] = (statusMap[row.status] || 0) + 1;
  });

  return {
    visits_unique: v.filter((x) => x.is_unique_session).length,
    visits_total: v.length,
    click_agendar: e.filter((x) => x.event_type === "click_agendar").length,
    appointments: a.filter((x) => x.status !== "cancelada").length,
    paid: a.filter((x) => x.deposit_paid || ["abonada", "llegó", "completada"].includes(x.status)).length,
    arrived: a.filter((x) => ["llegó", "completada"].includes(x.status)).length,
    revenue_estimated: a
      .filter((x) => ["abonada", "llegó", "completada"].includes(x.status))
      .reduce((sum, x) => sum + (x.amount || 0), 0),
    by_channel: Object.values(byChannel).sort((a, b) => b.unique_visits - a.unique_visits),
    visits_by_day: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    appointments_by_status: Object.entries(statusMap).map(([status, total]) => ({ status, total })),
  };
}

function renderVisitChart(rows) {
  const root = $("[data-chart-visits]");
  if (!rows.length) {
    root.innerHTML = `<p class="empty">Sin visitas en el periodo</p>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.unique_visits || 0), 1);
  root.innerHTML = rows
    .map((r) => {
      const h = Math.max(4, Math.round(((r.unique_visits || 0) / max) * 140));
      const label = String(r.day).slice(5);
      return `<div class="bar" style="height:${h}px" title="${r.day}: ${r.unique_visits}"><span>${label}</span></div>`;
    })
    .join("");
}

function renderChannels(rows) {
  const root = $("[data-chart-channels]");
  if (!rows.length) {
    root.innerHTML = `<p class="empty">Aún no hay tráfico atribuido</p>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.unique_visits || 0), 1);
  root.innerHTML = rows
    .map((r) => {
      const pct = Math.round(((r.unique_visits || 0) / max) * 100);
      return `<div class="channel-row"><span>${r.channel}</span><strong>${r.unique_visits}</strong><div class="meter"><i style="width:${pct}%"></i></div></div>`;
    })
    .join("");
}

function renderFunnel(stats) {
  const root = $("[data-funnel]");
  const steps = [
    ["Visitas", stats.visits_unique || 0],
    ["Clics agendar", stats.click_agendar || 0],
    ["Citas", stats.appointments || 0],
    ["Compraron / abonaron", stats.paid || 0],
    ["Llegaron", stats.arrived || 0],
  ];
  const max = Math.max(...steps.map(([, n]) => n), 1);
  root.innerHTML = steps
    .map(([label, n]) => {
      const pct = Math.round((n / max) * 100);
      return `<div class="funnel-row"><span>${label}</span><strong>${n}</strong><div class="meter"><i style="width:${pct}%"></i></div></div>`;
    })
    .join("");
}

function renderStatus(rows) {
  const root = $("[data-chart-status]");
  if (!rows.length) {
    root.innerHTML = `<p class="empty">Sin citas registradas</p>`;
    return;
  }
  root.innerHTML = rows
    .map((r) => `<div class="status-row"><span class="badge ${r.status}">${r.status}</span><strong>${r.total}</strong></div>`)
    .join("");
}

/* -------------------- Appointments -------------------- */
async function loadAppointments() {
  const { data, error } = await requireSupabase()
    .from("appointments")
    .select("*")
    .order("scheduled_at", { ascending: false })
    .limit(100);
  const body = $("[data-appointments-body]");
  if (error) {
    body.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">No hay citas. Crea la primera.</td></tr>`;
    return;
  }
  body.innerHTML = data
    .map(
      (a) => `<tr>
      <td><strong>${escapeHtml(a.client_name)}</strong><br><small>${escapeHtml(a.client_phone || a.client_email || "")}</small></td>
      <td>${escapeHtml(a.service_title || "—")}<br><small>${escapeHtml(a.pet_name || "")}</small></td>
      <td>${formatDate(a.scheduled_at)}</td>
      <td>${escapeHtml(a.channel_slug || "—")}</td>
      <td><span class="badge ${a.status}">${a.status}</span></td>
      <td>${formatCLP(a.amount)}</td>
      <td class="entity-actions">
        <button class="btn btn-ghost" data-edit-appointment="${a.id}">Editar</button>
        <button class="btn btn-danger" data-del-appointment="${a.id}">Borrar</button>
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-edit-appointment]").forEach((btn) => {
    btn.addEventListener("click", () => openAppointmentModal(data.find((x) => x.id === btn.dataset.editAppointment)));
  });
  body.querySelectorAll("[data-del-appointment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta cita?")) return;
      await requireSupabase().from("appointments").delete().eq("id", btn.dataset.delAppointment);
      loadAppointments();
      if (state.section === "dashboard") loadDashboard();
    });
  });
}

$("[data-open-appointment]")?.addEventListener("click", () => openAppointmentModal(null));

function openAppointmentModal(row) {
  openModal({
    title: row ? "Editar cita" : "Nueva cita",
    fields: `
      <label>Nombre cliente <input name="client_name" required value="${escapeAttr(row?.client_name || "")}" /></label>
      <div class="form-row">
        <label>Email <input name="client_email" type="email" value="${escapeAttr(row?.client_email || "")}" /></label>
        <label>Teléfono <input name="client_phone" value="${escapeAttr(row?.client_phone || "")}" /></label>
      </div>
      <div class="form-row">
        <label>Mascota <input name="pet_name" value="${escapeAttr(row?.pet_name || "")}" /></label>
        <label>Tipo <input name="pet_type" placeholder="perro/gato" value="${escapeAttr(row?.pet_type || "")}" /></label>
      </div>
      <label>Servicio <input name="service_title" value="${escapeAttr(row?.service_title || "")}" /></label>
      <div class="form-row">
        <label>Fecha/hora <input name="scheduled_at" type="datetime-local" value="${toLocalInput(row?.scheduled_at)}" /></label>
        <label>Canal <input name="channel_slug" value="${escapeAttr(row?.channel_slug || "directo")}" /></label>
      </div>
      <div class="form-row">
        <label>Estado
          <select name="status">
            ${["agendada", "abonada", "llegó", "completada", "cancelada", "no_asistió"]
              .map((s) => `<option value="${s}" ${row?.status === s ? "selected" : ""}>${s}</option>`)
              .join("")}
          </select>
        </label>
        <label>Monto <input name="amount" type="number" value="${row?.amount ?? 40000}" /></label>
      </div>
      <label><input type="checkbox" name="deposit_paid" ${row?.deposit_paid ? "checked" : ""} /> Abono pagado</label>
      <label>Notas <textarea name="notes" rows="3">${escapeHtml(row?.notes || "")}</textarea></label>
    `,
    onSave: async (fd) => {
      const payload = {
        client_name: String(fd.get("client_name") || "").trim(),
        client_email: String(fd.get("client_email") || "").trim() || null,
        client_phone: String(fd.get("client_phone") || "").trim() || null,
        pet_name: String(fd.get("pet_name") || "").trim() || null,
        pet_type: String(fd.get("pet_type") || "").trim() || null,
        service_title: String(fd.get("service_title") || "").trim() || null,
        scheduled_at: fd.get("scheduled_at") ? new Date(String(fd.get("scheduled_at"))).toISOString() : null,
        channel_slug: String(fd.get("channel_slug") || "").trim() || null,
        status: String(fd.get("status") || "agendada"),
        amount: Number(fd.get("amount") || 0),
        deposit_paid: fd.get("deposit_paid") === "on",
        notes: String(fd.get("notes") || "").trim() || null,
      };
      if (row?.id) {
        await requireSupabase().from("appointments").update(payload).eq("id", row.id);
      } else {
        await requireSupabase().from("appointments").insert(payload);
      }
      await loadAppointments();
    },
  });
}

/* -------------------- Channels -------------------- */
async function loadChannels() {
  const { data, error } = await requireSupabase().from("ad_channels").select("*").order("name");
  const root = $("[data-channels-list]");
  if (error) {
    root.innerHTML = `<p class="empty">${error.message}</p>`;
    return;
  }
  root.innerHTML = (data || [])
    .map(
      (c) => `<article class="entity-card">
      <div style="width:88px;height:72px;border-radius:10px;background:${c.color || "#2f6f84"}"></div>
      <div>
        <h4>${escapeHtml(c.name)}</h4>
        <p>slug: <code>${escapeHtml(c.slug)}</code> · utm_source=${escapeHtml(c.utm_source || "—")}</p>
        <p>${c.active ? "Activo" : "Inactivo"} · ejemplo: <code>?ref=${escapeHtml(c.slug)}</code></p>
      </div>
      <div class="entity-actions">
        <button class="btn btn-ghost" data-edit-channel="${c.id}">Editar</button>
        <button class="btn btn-danger" data-del-channel="${c.id}">Borrar</button>
      </div>
    </article>`
    )
    .join("") || `<p class="empty">Sin canales</p>`;

  root.querySelectorAll("[data-edit-channel]").forEach((btn) => {
    btn.addEventListener("click", () => openChannelModal(data.find((x) => x.id === btn.dataset.editChannel)));
  });
  root.querySelectorAll("[data-del-channel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar canal?")) return;
      await requireSupabase().from("ad_channels").delete().eq("id", btn.dataset.delChannel);
      loadChannels();
    });
  });
}

$("[data-open-channel]")?.addEventListener("click", () => openChannelModal(null));

function openChannelModal(row) {
  openModal({
    title: row ? "Editar canal" : "Nuevo canal",
    fields: `
      <label>Nombre <input name="name" required value="${escapeAttr(row?.name || "")}" /></label>
      <label>Slug <input name="slug" required value="${escapeAttr(row?.slug || "")}" /></label>
      <div class="form-row">
        <label>utm_source <input name="utm_source" value="${escapeAttr(row?.utm_source || "")}" /></label>
        <label>utm_medium <input name="utm_medium" value="${escapeAttr(row?.utm_medium || "")}" /></label>
      </div>
      <label>utm_campaign <input name="utm_campaign" value="${escapeAttr(row?.utm_campaign || "")}" /></label>
      <label>Color <input name="color" type="color" value="${escapeAttr(row?.color || "#2f6f84")}" /></label>
      <label><input type="checkbox" name="active" ${row?.active !== false ? "checked" : ""} /> Activo</label>
      <label>Notas <textarea name="notes" rows="2">${escapeHtml(row?.notes || "")}</textarea></label>
    `,
    onSave: async (fd) => {
      const payload = {
        name: String(fd.get("name") || "").trim(),
        slug: String(fd.get("slug") || "").trim().toLowerCase(),
        utm_source: String(fd.get("utm_source") || "").trim() || null,
        utm_medium: String(fd.get("utm_medium") || "").trim() || null,
        utm_campaign: String(fd.get("utm_campaign") || "").trim() || null,
        color: String(fd.get("color") || "#2f6f84"),
        active: fd.get("active") === "on",
        notes: String(fd.get("notes") || "").trim() || null,
      };
      if (row?.id) await requireSupabase().from("ad_channels").update(payload).eq("id", row.id);
      else await requireSupabase().from("ad_channels").insert(payload);
      await loadChannels();
    },
  });
}

/* -------------------- Services -------------------- */
async function loadServices() {
  const { data, error } = await requireSupabase().from("services").select("*").order("sort_order");
  const root = $("[data-services-list]");
  if (error) {
    root.innerHTML = `<p class="empty">${error.message}</p>`;
    return;
  }
  root.innerHTML = (data || [])
    .map(
      (s) => `<article class="entity-card">
      <img src="${escapeAttr(s.image_url || "")}" alt="" />
      <div>
        <h4>${escapeHtml(s.title)}</h4>
        <p>${escapeHtml(s.price_label || (s.price_from != null ? formatCLP(s.price_from) : "Sin precio"))} · ${escapeHtml(s.section)}</p>
        <p>${escapeHtml(s.description || "")}</p>
      </div>
      <div class="entity-actions">
        <button class="btn btn-ghost" data-edit-service="${s.id}">Editar</button>
        <button class="btn btn-danger" data-del-service="${s.id}">Borrar</button>
      </div>
    </article>`
    )
    .join("") || `<p class="empty">Sin servicios</p>`;

  root.querySelectorAll("[data-edit-service]").forEach((btn) => {
    btn.addEventListener("click", () => openServiceModal(data.find((x) => x.id === btn.dataset.editService)));
  });
  root.querySelectorAll("[data-del-service]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar servicio?")) return;
      await requireSupabase().from("services").delete().eq("id", btn.dataset.delService);
      loadServices();
    });
  });
}

$("[data-open-service]")?.addEventListener("click", () => openServiceModal(null));

function openServiceModal(row) {
  openModal({
    title: row ? "Editar servicio" : "Nuevo servicio",
    fields: `
      <label>Título <input name="title" required value="${escapeAttr(row?.title || "")}" /></label>
      <label>Slug <input name="slug" required value="${escapeAttr(row?.slug || "")}" /></label>
      <label>Descripción <textarea name="description" rows="3">${escapeHtml(row?.description || "")}</textarea></label>
      <div class="form-row">
        <label>Precio desde <input type="number" name="price_from" value="${row?.price_from ?? ""}" /></label>
        <label>Etiqueta precio <input name="price_label" value="${escapeAttr(row?.price_label || "")}" /></label>
      </div>
      <label>Tag <input name="tag" value="${escapeAttr(row?.tag || "")}" /></label>
      <label>URL imagen <input name="image_url" value="${escapeAttr(row?.image_url || "")}" /></label>
      <label>Subir imagen <input type="file" name="image_file" accept="image/*" /></label>
      <label>Calendly URL <input name="calendly_url" value="${escapeAttr(row?.calendly_url || "")}" /></label>
      <div class="form-row">
        <label>Sección
          <select name="section">
            ${["ambos", "ofertas", "servicios"]
              .map((s) => `<option value="${s}" ${row?.section === s ? "selected" : ""}>${s}</option>`)
              .join("")}
          </select>
        </label>
        <label>Orden <input type="number" name="sort_order" value="${row?.sort_order ?? 0}" /></label>
      </div>
      <label><input type="checkbox" name="active" ${row?.active !== false ? "checked" : ""} /> Activo</label>
    `,
    onSave: async (fd) => {
      let imageUrl = String(fd.get("image_url") || "").trim() || null;
      const file = fd.get("image_file");
      if (file && file.size) {
        imageUrl = await uploadImage(file, `services/${Date.now()}-${file.name}`);
      }
      const payload = {
        title: String(fd.get("title") || "").trim(),
        slug: String(fd.get("slug") || "").trim().toLowerCase(),
        description: String(fd.get("description") || "").trim() || null,
        price_from: fd.get("price_from") === "" ? null : Number(fd.get("price_from")),
        price_label: String(fd.get("price_label") || "").trim() || null,
        tag: String(fd.get("tag") || "").trim() || null,
        image_url: imageUrl,
        calendly_url: String(fd.get("calendly_url") || "").trim() || null,
        section: String(fd.get("section") || "ambos"),
        sort_order: Number(fd.get("sort_order") || 0),
        active: fd.get("active") === "on",
      };
      if (row?.id) await requireSupabase().from("services").update(payload).eq("id", row.id);
      else await requireSupabase().from("services").insert(payload);
      await loadServices();
    },
  });
}

/* -------------------- Pricing -------------------- */
async function loadPricing() {
  const client = requireSupabase();
  const [{ data: zones }, { data: extras }] = await Promise.all([
    client.from("pricing_zones").select("*").order("sort_order"),
    client.from("price_extras").select("*").order("sort_order"),
  ]);

  const zonesRoot = $("[data-zones-list]");
  zonesRoot.innerHTML = (zones || [])
    .map(
      (z) => `<article class="entity-card">
      <img src="${escapeAttr(z.image_url || "")}" alt="" />
      <div>
        <h4>${escapeHtml(z.name)} · ${formatCLP(z.price)}</h4>
        <p>${escapeHtml(z.zones_text || "")}</p>
      </div>
      <div class="entity-actions">
        <button class="btn btn-ghost" data-edit-zone="${z.id}">Editar</button>
        <button class="btn btn-danger" data-del-zone="${z.id}">Borrar</button>
      </div>
    </article>`
    )
    .join("") || `<p class="empty">Sin zonas</p>`;

  zonesRoot.querySelectorAll("[data-edit-zone]").forEach((btn) => {
    btn.addEventListener("click", () => openZoneModal(zones.find((x) => x.id === btn.dataset.editZone)));
  });
  zonesRoot.querySelectorAll("[data-del-zone]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar zona?")) return;
      await requireSupabase().from("pricing_zones").delete().eq("id", btn.dataset.delZone);
      loadPricing();
    });
  });

  const extrasRoot = $("[data-extras-list]");
  extrasRoot.innerHTML = (extras || [])
    .map(
      (e) => `<article class="entity-card">
      <div style="width:88px;height:72px;border-radius:10px;background:#e8f2f6;display:grid;place-items:center;font-weight:700;color:#2f6f84">+</div>
      <div>
        <h4>${escapeHtml(e.label)}</h4>
        <p>${formatCLP(e.amount)}</p>
      </div>
      <div class="entity-actions">
        <button class="btn btn-ghost" data-edit-extra="${e.id}">Editar</button>
        <button class="btn btn-danger" data-del-extra="${e.id}">Borrar</button>
      </div>
    </article>`
    )
    .join("") || `<p class="empty">Sin extras</p>`;

  extrasRoot.querySelectorAll("[data-edit-extra]").forEach((btn) => {
    btn.addEventListener("click", () => openExtraModal(extras.find((x) => x.id === btn.dataset.editExtra)));
  });
  extrasRoot.querySelectorAll("[data-del-extra]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar extra?")) return;
      await requireSupabase().from("price_extras").delete().eq("id", btn.dataset.delExtra);
      loadPricing();
    });
  });
}

$("[data-open-zone]")?.addEventListener("click", () => openZoneModal(null));
$("[data-open-extra]")?.addEventListener("click", () => openExtraModal(null));

function openZoneModal(row) {
  openModal({
    title: row ? "Editar zona" : "Nueva zona",
    fields: `
      <label>Nombre <input name="name" required value="${escapeAttr(row?.name || "")}" /></label>
      <label>Badge <input name="badge" value="${escapeAttr(row?.badge || "")}" /></label>
      <label>Precio <input type="number" name="price" required value="${row?.price ?? 40000}" /></label>
      <label>Comunas / detalle <textarea name="zones_text" rows="3">${escapeHtml(row?.zones_text || "")}</textarea></label>
      <label>URL imagen <input name="image_url" value="${escapeAttr(row?.image_url || "")}" /></label>
      <label>Subir imagen <input type="file" name="image_file" accept="image/*" /></label>
      <label>Map embed URL <input name="map_embed_url" value="${escapeAttr(row?.map_embed_url || "")}" /></label>
      <div class="form-row">
        <label>Orden <input type="number" name="sort_order" value="${row?.sort_order ?? 0}" /></label>
        <label><input type="checkbox" name="featured" ${row?.featured ? "checked" : ""} /> Destacada</label>
      </div>
      <label><input type="checkbox" name="active" ${row?.active !== false ? "checked" : ""} /> Activa</label>
    `,
    onSave: async (fd) => {
      let imageUrl = String(fd.get("image_url") || "").trim() || null;
      const file = fd.get("image_file");
      if (file && file.size) imageUrl = await uploadImage(file, `zones/${Date.now()}-${file.name}`);
      const payload = {
        name: String(fd.get("name") || "").trim(),
        badge: String(fd.get("badge") || "").trim() || null,
        price: Number(fd.get("price") || 0),
        zones_text: String(fd.get("zones_text") || "").trim() || null,
        image_url: imageUrl,
        map_embed_url: String(fd.get("map_embed_url") || "").trim() || null,
        sort_order: Number(fd.get("sort_order") || 0),
        featured: fd.get("featured") === "on",
        active: fd.get("active") === "on",
      };
      if (row?.id) await requireSupabase().from("pricing_zones").update(payload).eq("id", row.id);
      else await requireSupabase().from("pricing_zones").insert(payload);
      await loadPricing();
    },
  });
}

function openExtraModal(row) {
  openModal({
    title: row ? "Editar extra" : "Nuevo extra",
    fields: `
      <label>Etiqueta <input name="label" required value="${escapeAttr(row?.label || "")}" /></label>
      <label>Monto <input type="number" name="amount" required value="${row?.amount ?? 0}" /></label>
      <label>Orden <input type="number" name="sort_order" value="${row?.sort_order ?? 0}" /></label>
      <label><input type="checkbox" name="active" ${row?.active !== false ? "checked" : ""} /> Activo</label>
    `,
    onSave: async (fd) => {
      const payload = {
        label: String(fd.get("label") || "").trim(),
        amount: Number(fd.get("amount") || 0),
        sort_order: Number(fd.get("sort_order") || 0),
        active: fd.get("active") === "on",
      };
      if (row?.id) await requireSupabase().from("price_extras").update(payload).eq("id", row.id);
      else await requireSupabase().from("price_extras").insert(payload);
      await loadPricing();
    },
  });
}

/* -------------------- Media -------------------- */
async function loadMedia() {
  const { data, error } = await requireSupabase().from("site_media").select("*").order("slot");
  const root = $("[data-media-grid]");
  if (error) {
    root.innerHTML = `<p class="empty">${error.message}</p>`;
    return;
  }
  root.innerHTML = (data || [])
    .map(
      (m) => `<article class="media-card">
      <img src="${escapeAttr(m.url)}" alt="${escapeAttr(m.alt_text || m.slot)}" />
      <div class="body">
        <strong>${escapeHtml(m.title || m.slot)}</strong>
        <small>${escapeHtml(m.slot)}</small>
        <label>Nueva imagen
          <input type="file" accept="image/*" data-upload-slot="${m.id}" data-slot-name="${escapeAttr(m.slot)}" />
        </label>
        <button class="btn btn-ghost" data-edit-media="${m.id}">Editar URL / alt</button>
      </div>
    </article>`
    )
    .join("") || `<p class="empty">Sin slots de media. Ejecuta seed.sql</p>`;

  root.querySelectorAll("[data-upload-slot]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = await uploadImage(file, `site/${input.dataset.slotName}-${Date.now()}-${file.name}`);
      await requireSupabase().from("site_media").update({ url }).eq("id", input.dataset.uploadSlot);
      loadMedia();
    });
  });

  root.querySelectorAll("[data-edit-media]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = data.find((x) => x.id === btn.dataset.editMedia);
      openModal({
        title: `Editar ${row.slot}`,
        fields: `
          <label>Título <input name="title" value="${escapeAttr(row.title || "")}" /></label>
          <label>URL <input name="url" required value="${escapeAttr(row.url || "")}" /></label>
          <label>Alt <input name="alt_text" value="${escapeAttr(row.alt_text || "")}" /></label>
        `,
        onSave: async (fd) => {
          await requireSupabase()
            .from("site_media")
            .update({
              title: String(fd.get("title") || "").trim() || null,
              url: String(fd.get("url") || "").trim(),
              alt_text: String(fd.get("alt_text") || "").trim() || null,
            })
            .eq("id", row.id);
          await loadMedia();
        },
      });
    });
  });
}

/* -------------------- Settings -------------------- */
async function loadSettings() {
  const { data } = await requireSupabase().from("site_settings").select("value").eq("key", "business").maybeSingle();
  const v = data?.value || {};
  const form = $("[data-settings-form]");
  form.name.value = v.name || "";
  form.tagline.value = v.tagline || "";
  form.calendly_url.value = v.calendly_url || "";
  form.form_url.value = v.form_url || "";
  form.instagram_url.value = v.instagram_url || "";
  form.promo_text.value = v.promo_text || "";
  form.deposit_amount.value = v.deposit_amount ?? 20000;
  form.min_price.value = v.min_price ?? 40000;
}

$("[data-settings-form]")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const value = {
    name: String(fd.get("name") || "").trim(),
    tagline: String(fd.get("tagline") || "").trim(),
    calendly_url: String(fd.get("calendly_url") || "").trim(),
    form_url: String(fd.get("form_url") || "").trim(),
    instagram_url: String(fd.get("instagram_url") || "").trim(),
    promo_text: String(fd.get("promo_text") || "").trim(),
    deposit_amount: Number(fd.get("deposit_amount") || 0),
    min_price: Number(fd.get("min_price") || 0),
  };
  await requireSupabase().from("site_settings").upsert({ key: "business", value });
  const ok = $("[data-settings-ok]");
  ok.hidden = false;
  setTimeout(() => {
    ok.hidden = true;
  }, 2000);
});

/* -------------------- Modal + helpers -------------------- */
let modalSaveHandler = null;

function openModal({ title, fields, onSave }) {
  const modal = $("[data-modal]");
  $("[data-modal-title]").textContent = title;
  $("[data-modal-body]").innerHTML = fields;
  modalSaveHandler = onSave;
  modal.showModal();
}

$("[data-modal-form]")?.addEventListener("submit", async (e) => {
  const submitter = e.submitter;
  const value = submitter?.value || "cancel";
  if (value !== "save") {
    modalSaveHandler = null;
    return;
  }
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  try {
    if (modalSaveHandler) await modalSaveHandler(fd);
    $("[data-modal]").close();
    modalSaveHandler = null;
  } catch (err) {
    alert(err.message || "No se pudo guardar");
  }
});

async function uploadImage(file, path) {
  const client = requireSupabase();
  const clean = path.replace(/[^a-zA-Z0-9._/-]/g, "-");
  const { error } = await client.storage.from("site-images").upload(clean, file, {
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw error;
  const { data } = client.storage.from("site-images").getPublicUrl(clean);
  return data.publicUrl;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session && $("[data-view='app']") && !$("[data-view='app']").hidden) {
      showView("login");
    }
  });
}

boot();
