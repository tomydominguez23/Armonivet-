import { isSupabaseConfigured, requireSupabase, supabase } from "../lib/supabase.js";

const titles = {
  dashboard: ["Dashboard", "Métricas del negocio en tiempo real"],
  leads: ["Leads", "Leads capturados desde Genesis y otros canales"],
  clients: ["Clientes", "Gestión de clientes y cuestionarios"],
  followups: ["Seguimiento", "Controles pendientes y recordatorios"],
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
  if (section === "leads") return loadLeads();
  if (section === "clients") return loadClients();
  if (section === "followups") return loadFollowups();
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

  let stats = null;
  let v2Result = null;

  const { data: v2Data, error: v2Error } = await client.rpc("admin_dashboard_v2", { days: state.days });
  if (!v2Error && v2Data) {
    v2Result = v2Data;
    stats = v2Data;
  }

  if (!stats) {
    const { data, error } = await client.rpc("admin_dashboard_stats", { days: state.days });
    if (!error && data) stats = data;
  }

  if (!stats) {
    stats = await fallbackStats(client, state.days);
  }

  const map = {
    leads_new: stats.leads_new ?? 0,
    leads_total: stats.leads_total ?? 0,
    visits_unique: stats.visits_unique,
    click_agendar: stats.click_agendar,
    appointments_total: stats.appointments_total ?? stats.appointments ?? 0,
    paid: stats.paid,
    arrived: stats.arrived,
    revenue: formatCLP(stats.revenue ?? stats.revenue_estimated ?? 0),
    followups_pending: stats.followups_pending ?? 0,
  };
  Object.entries(map).forEach(([k, v]) => {
    const el = $(`[data-kpi="${k}"]`);
    if (el) el.textContent = v ?? 0;
  });

  renderVisitChart(stats.visits_by_day || []);
  renderChannels(stats.by_channel || []);
  renderFunnel(stats);
  renderStatus(stats.appointments_by_status || []);

  const recentLeadsEl = $("[data-recent-leads]");
  if (recentLeadsEl) {
    const recentLeads = v2Result?.recent_leads || [];
    if (!recentLeads.length) {
      recentLeadsEl.innerHTML = `<p class="empty">Sin leads recientes</p>`;
    } else {
      recentLeadsEl.innerHTML = recentLeads
        .map(
          (l) => `<div class="mini-card">
          <strong>${escapeHtml(l.name || "Sin nombre")}</strong>
          <small>${escapeHtml(l.phone || l.email || "—")} · ${escapeHtml(l.channel_slug || "directo")}</small>
          <span class="badge ${l.status || "nuevo"}">${escapeHtml(l.status || "nuevo")}</span>
        </div>`
        )
        .join("");
    }
  }

  const needFollowupEl = $("[data-need-followup]");
  if (needFollowupEl) {
    const needFollowup = v2Result?.clients_need_followup || [];
    if (!needFollowup.length) {
      needFollowupEl.innerHTML = `<p class="empty">Sin seguimientos pendientes</p>`;
    } else {
      needFollowupEl.innerHTML = needFollowup
        .map(
          (c) => `<div class="mini-card">
          <strong>${escapeHtml(c.name || c.pet_name || "Sin nombre")}</strong>
          <small>${escapeHtml(c.phone || "—")} · próximo: ${formatDate(c.next_followup_at)}</small>
        </div>`
        )
        .join("");
    }
  }

  const alertsEl = $("[data-topbar-alerts]");
  if (alertsEl) {
    const alerts = [];
    const overdueCount = stats.followups_overdue ?? 0;
    const newLeadsCount = stats.leads_new ?? 0;
    if (overdueCount > 0) {
      alerts.push(`<span class="topbar-alert topbar-alert--danger">${overdueCount} control${overdueCount > 1 ? "es" : ""} vencido${overdueCount > 1 ? "s" : ""}</span>`);
    }
    if (newLeadsCount > 0) {
      alerts.push(`<span class="topbar-alert topbar-alert--info">${newLeadsCount} lead${newLeadsCount > 1 ? "s" : ""} nuevo${newLeadsCount > 1 ? "s" : ""}</span>`);
    }
    alertsEl.innerHTML = alerts.join("");
  }
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
    ["Leads", stats.leads_total || 0],
    ["Clics agendar", stats.click_agendar || 0],
    ["Citas", stats.appointments_total || stats.appointments || 0],
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

/* -------------------- Leads -------------------- */
let _leadsDebounce = null;

async function loadLeads() {
  const filter = $("[data-leads-filter]")?.value || "";
  let query = requireSupabase()
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filter) query = query.eq("status", filter);
  const { data, error } = await query;
  const body = $("[data-leads-body]");
  if (!body) return;
  if (error) {
    body.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No hay leads registrados.</td></tr>`;
    return;
  }
  body.innerHTML = data
    .map(
      (l) => `<tr>
      <td><strong>${escapeHtml(l.name || "Sin nombre")}</strong></td>
      <td>${escapeHtml(l.phone || "—")}<br><small>${escapeHtml(l.email || "")}</small></td>
      <td>${escapeHtml(l.pet_type || "—")}${l.pet_name ? " · " + escapeHtml(l.pet_name) : ""}</td>
      <td>${escapeHtml(l.consultation_reason || "—")}</td>
      <td>${escapeHtml(l.channel_slug || "directo")}</td>
      <td><span class="badge ${l.status || "nuevo"}">${escapeHtml(l.status || "nuevo")}</span></td>
      <td>${formatDate(l.created_at)}</td>
      <td class="entity-actions">
        <button class="btn btn-ghost" data-view-lead="${l.id}">Ver</button>
        <button class="btn btn-ghost" data-contact-lead="${l.id}">Contactar</button>
        <button class="btn btn-ghost" data-schedule-lead="${l.id}">Agendar</button>
        <button class="btn btn-danger" data-discard-lead="${l.id}">Descartar</button>
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-view-lead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lead = data.find((x) => x.id === btn.dataset.viewLead);
      if (lead) openLeadDetailModal(lead);
    });
  });
  body.querySelectorAll("[data-contact-lead]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await requireSupabase().from("leads").update({ status: "contactado" }).eq("id", btn.dataset.contactLead);
      loadLeads();
    });
  });
  body.querySelectorAll("[data-schedule-lead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lead = data.find((x) => x.id === btn.dataset.scheduleLead);
      if (lead) {
        openAppointmentModal({
          client_name: lead.name || "",
          client_email: lead.email || "",
          client_phone: lead.phone || "",
          pet_name: lead.pet_name || "",
          pet_type: lead.pet_type || "",
          channel_slug: lead.channel_slug || "directo",
          service_title: lead.consultation_reason || "",
        });
      }
    });
  });
  body.querySelectorAll("[data-discard-lead]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Descartar este lead?")) return;
      await requireSupabase().from("leads").update({ status: "descartado" }).eq("id", btn.dataset.discardLead);
      loadLeads();
    });
  });
}

$("[data-leads-filter]")?.addEventListener("change", () => loadLeads());

$("[data-open-lead]")?.addEventListener("click", () => {
  openModal({
    title: "Nuevo lead",
    fields: `
      <label>Nombre <input name="name" required /></label>
      <div class="form-row">
        <label>Email <input name="email" type="email" /></label>
        <label>Teléfono <input name="phone" /></label>
      </div>
      <div class="form-row">
        <label>Mascota <input name="pet_name" /></label>
        <label>Tipo <input name="pet_type" placeholder="perro/gato" /></label>
      </div>
      <label>Motivo consulta <textarea name="consultation_reason" rows="2"></textarea></label>
      <label>Canal <input name="channel_slug" value="directo" /></label>
      <label>Estado
        <select name="status">
          <option value="nuevo" selected>nuevo</option>
          <option value="contactado">contactado</option>
          <option value="en_proceso">en_proceso</option>
          <option value="convertido">convertido</option>
          <option value="descartado">descartado</option>
        </select>
      </label>
      <label>Notas <textarea name="notes" rows="2"></textarea></label>
    `,
    onSave: async (fd) => {
      const payload = {
        name: String(fd.get("name") || "").trim(),
        email: String(fd.get("email") || "").trim() || null,
        phone: String(fd.get("phone") || "").trim() || null,
        pet_name: String(fd.get("pet_name") || "").trim() || null,
        pet_type: String(fd.get("pet_type") || "").trim() || null,
        consultation_reason: String(fd.get("consultation_reason") || "").trim() || null,
        channel_slug: String(fd.get("channel_slug") || "").trim() || null,
        status: String(fd.get("status") || "nuevo"),
        notes: String(fd.get("notes") || "").trim() || null,
      };
      await requireSupabase().from("leads").insert(payload);
      await loadLeads();
    },
  });
});

function openLeadDetailModal(lead) {
  const fields = [
    ["Nombre", lead.name],
    ["Email", lead.email],
    ["Teléfono", lead.phone],
    ["Mascota", lead.pet_name],
    ["Tipo mascota", lead.pet_type],
    ["Motivo consulta", lead.consultation_reason],
    ["Canal", lead.channel_slug],
    ["Estado", lead.status],
    ["Notas", lead.notes],
    ["Creado", formatDate(lead.created_at)],
    ["Actualizado", formatDate(lead.updated_at)],
  ];

  openModal({
    title: `Lead: ${escapeHtml(lead.name || "Sin nombre")}`,
    fields: `
      <div class="detail-view">
        ${fields
          .map(
            ([label, value]) =>
              `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value || "—")}</span></div>`
          )
          .join("")}
      </div>
      <div class="form-row" style="margin-top:1rem;gap:.5rem">
        <button type="button" class="btn btn-ghost" data-modal-contact-lead="${lead.id}">Contactar</button>
        <button type="button" class="btn btn-ghost" data-modal-schedule-lead="${lead.id}">Agendar cita</button>
        <button type="button" class="btn btn-danger" data-modal-discard-lead="${lead.id}">Descartar</button>
      </div>
    `,
    onSave: async () => {},
  });

  setTimeout(() => {
    $(`[data-modal-contact-lead="${lead.id}"]`)?.addEventListener("click", async () => {
      await requireSupabase().from("leads").update({ status: "contactado" }).eq("id", lead.id);
      $("[data-modal]").close();
      loadLeads();
    });
    $(`[data-modal-schedule-lead="${lead.id}"]`)?.addEventListener("click", () => {
      $("[data-modal]").close();
      openAppointmentModal({
        client_name: lead.name || "",
        client_email: lead.email || "",
        client_phone: lead.phone || "",
        pet_name: lead.pet_name || "",
        pet_type: lead.pet_type || "",
        channel_slug: lead.channel_slug || "directo",
        service_title: lead.consultation_reason || "",
      });
    });
    $(`[data-modal-discard-lead="${lead.id}"]`)?.addEventListener("click", async () => {
      await requireSupabase().from("leads").update({ status: "descartado" }).eq("id", lead.id);
      $("[data-modal]").close();
      loadLeads();
    });
  }, 0);
}

/* -------------------- Clients -------------------- */
let _clientsDebounce = null;

async function loadClients() {
  const search = $("[data-clients-search]")?.value || "";
  const filter = $("[data-clients-filter]")?.value || "";
  let query = requireSupabase()
    .from("clients")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (filter) query = query.eq("status", filter);
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,pet_name.ilike.%${search}%`);
  const { data, error } = await query;
  const body = $("[data-clients-body]");
  if (!body) return;
  if (error) {
    body.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">No hay clientes registrados.</td></tr>`;
    return;
  }
  body.innerHTML = data
    .map(
      (c) => `<tr>
      <td><strong>${escapeHtml(c.name || "—")}</strong>${c.tutor_name ? "<br><small>Tutor: " + escapeHtml(c.tutor_name) + "</small>" : ""}</td>
      <td>${escapeHtml(c.pet_name || "—")}${c.pet_type ? " · " + escapeHtml(c.pet_type) : ""}</td>
      <td>${escapeHtml(c.phone || "—")}<br><small>${escapeHtml(c.email || "")}</small></td>
      <td><span class="badge ${c.status || "activo"}">${escapeHtml(c.status || "activo")}</span></td>
      <td>${formatDate(c.last_contact_at)}</td>
      <td>${formatDate(c.next_followup_at)}</td>
      <td class="entity-actions">
        <button class="btn btn-ghost" data-view-client="${c.id}">Ver ficha</button>
        <button class="btn btn-ghost" data-followup-client="${c.id}">Seguimiento</button>
        <button class="btn btn-ghost" data-edit-client-status="${c.id}">Editar estado</button>
        <button class="btn btn-ghost" data-schedule-client="${c.id}">Agendar</button>
      </td>
    </tr>`
    )
    .join("");

  body.querySelectorAll("[data-view-client]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const client = data.find((x) => x.id === btn.dataset.viewClient);
      if (client) openClientDetailModal(client);
    });
  });
  body.querySelectorAll("[data-followup-client]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const client = data.find((x) => x.id === btn.dataset.followupClient);
      if (client) openFollowupModal(null, client.id);
    });
  });
  body.querySelectorAll("[data-edit-client-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const client = data.find((x) => x.id === btn.dataset.editClientStatus);
      if (!client) return;
      openModal({
        title: `Cambiar estado: ${escapeHtml(client.name || client.pet_name || "")}`,
        fields: `
          <label>Estado
            <select name="status">
              ${["activo", "inactivo", "pendiente", "completado"]
                .map((s) => `<option value="${s}" ${client.status === s ? "selected" : ""}>${s}</option>`)
                .join("")}
            </select>
          </label>
        `,
        onSave: async (fd) => {
          await requireSupabase().from("clients").update({ status: String(fd.get("status")) }).eq("id", client.id);
          await loadClients();
        },
      });
    });
  });
  body.querySelectorAll("[data-schedule-client]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const client = data.find((x) => x.id === btn.dataset.scheduleClient);
      if (client) {
        openAppointmentModal({
          client_name: client.name || client.tutor_name || "",
          client_email: client.email || "",
          client_phone: client.phone || "",
          pet_name: client.pet_name || "",
          pet_type: client.pet_type || "",
        });
      }
    });
  });
}

$("[data-clients-search]")?.addEventListener("input", (e) => {
  clearTimeout(_clientsDebounce);
  _clientsDebounce = setTimeout(() => loadClients(), 350);
});
$("[data-clients-filter]")?.addEventListener("change", () => loadClients());

$("[data-open-client]")?.addEventListener("click", () => {
  openModal({
    title: "Nuevo cliente",
    fields: `
      <label>Nombre <input name="name" required /></label>
      <label>Nombre tutor <input name="tutor_name" /></label>
      <div class="form-row">
        <label>Email <input name="email" type="email" /></label>
        <label>Teléfono <input name="phone" /></label>
      </div>
      <div class="form-row">
        <label>Mascota <input name="pet_name" /></label>
        <label>Tipo <input name="pet_type" placeholder="perro/gato" /></label>
      </div>
      <div class="form-row">
        <label>Raza <input name="pet_breed" /></label>
        <label>Edad <input name="pet_age" /></label>
      </div>
      <label>Peso (kg) <input name="pet_weight" type="number" step="0.1" /></label>
      <label>Dirección <input name="address" /></label>
      <label>Comuna <input name="comuna" /></label>
      <label>Cuestionario / notas <textarea name="questionnaire_notes" rows="3"></textarea></label>
      <label>Estado
        <select name="status">
          <option value="activo" selected>activo</option>
          <option value="inactivo">inactivo</option>
          <option value="pendiente">pendiente</option>
          <option value="completado">completado</option>
        </select>
      </label>
    `,
    onSave: async (fd) => {
      const payload = {
        name: String(fd.get("name") || "").trim(),
        tutor_name: String(fd.get("tutor_name") || "").trim() || null,
        email: String(fd.get("email") || "").trim() || null,
        phone: String(fd.get("phone") || "").trim() || null,
        pet_name: String(fd.get("pet_name") || "").trim() || null,
        pet_type: String(fd.get("pet_type") || "").trim() || null,
        pet_breed: String(fd.get("pet_breed") || "").trim() || null,
        pet_age: String(fd.get("pet_age") || "").trim() || null,
        pet_weight: fd.get("pet_weight") ? Number(fd.get("pet_weight")) : null,
        address: String(fd.get("address") || "").trim() || null,
        comuna: String(fd.get("comuna") || "").trim() || null,
        questionnaire_notes: String(fd.get("questionnaire_notes") || "").trim() || null,
        status: String(fd.get("status") || "activo"),
      };
      await requireSupabase().from("clients").insert(payload);
      await loadClients();
    },
  });
});

function openClientDetailModal(client) {
  const personalFields = [
    ["Nombre", client.name],
    ["Tutor", client.tutor_name],
    ["Email", client.email],
    ["Teléfono", client.phone],
    ["Dirección", client.address],
    ["Comuna", client.comuna],
    ["Estado", client.status],
  ];
  const petFields = [
    ["Nombre mascota", client.pet_name],
    ["Tipo", client.pet_type],
    ["Raza", client.pet_breed],
    ["Edad", client.pet_age],
    ["Peso", client.pet_weight ? `${client.pet_weight} kg` : null],
    ["Tamaño", client.pet_size],
    ["Temperamento", client.pet_temperament],
  ];
  const questionnaireFields = [
    ["Alimentación", client.q_food],
    ["Actividad física", client.q_exercise],
    ["Condiciones médicas", client.q_medical],
    ["Alergias", client.q_allergies],
    ["Medicamentos", client.q_medications],
    ["Vacunas al día", client.q_vaccines],
    ["Esterilizado", client.q_neutered],
    ["Último baño", client.q_last_bath],
    ["Frecuencia baño", client.q_bath_frequency],
    ["Notas cuestionario", client.questionnaire_notes],
  ];
  const metaFields = [
    ["Último contacto", formatDate(client.last_contact_at)],
    ["Próximo seguimiento", formatDate(client.next_followup_at)],
    ["Creado", formatDate(client.created_at)],
    ["Actualizado", formatDate(client.updated_at)],
  ];

  const renderSection = (title, fields) => {
    const rows = fields
      .filter(([, v]) => v != null && v !== "" && v !== "—")
      .map(
        ([label, value]) =>
          `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(String(value))}</span></div>`
      )
      .join("");
    if (!rows) return "";
    return `<h4 style="margin:1rem 0 .5rem;border-bottom:1px solid #e0e0e0;padding-bottom:.25rem">${escapeHtml(title)}</h4>${rows}`;
  };

  openModal({
    title: `Ficha: ${escapeHtml(client.name || client.pet_name || "Cliente")}`,
    fields: `
      <div class="detail-view">
        ${renderSection("Datos personales", personalFields)}
        ${renderSection("Mascota", petFields)}
        ${renderSection("Cuestionario", questionnaireFields)}
        ${renderSection("Fechas", metaFields)}
      </div>
    `,
    onSave: async () => {},
  });
}

/* -------------------- Followups -------------------- */
async function loadFollowups() {
  const filter = $("[data-followups-filter]")?.value || "pending";
  let query = requireSupabase()
    .from("followups")
    .select("*, clients(name, pet_name, phone)")
    .order("scheduled_at", { ascending: true });

  if (filter === "pending") query = query.eq("completed", false);
  else if (filter === "overdue") query = query.eq("completed", false).lt("scheduled_at", new Date().toISOString());
  else if (filter === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    query = query.gte("scheduled_at", start.toISOString()).lte("scheduled_at", end.toISOString());
  } else if (filter === "completed") {
    query = query.eq("completed", true);
  }

  const { data, error } = await query.limit(100);
  const body = $("[data-followups-body]");
  if (!body) return;
  if (error) {
    body.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="7" class="empty">No hay seguimientos para este filtro.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map((f) => {
      const clientName = f.clients?.name || "—";
      const petName = f.clients?.pet_name || "";
      const isOverdue = !f.completed && f.scheduled_at && new Date(f.scheduled_at) < new Date();
      return `<tr class="${isOverdue ? "row-overdue" : ""}">
      <td><strong>${escapeHtml(clientName)}</strong>${petName ? "<br><small>" + escapeHtml(petName) + "</small>" : ""}</td>
      <td><span class="badge ${f.type || "general"}">${escapeHtml(f.type || "general")}</span></td>
      <td>${escapeHtml((f.content || "").slice(0, 80))}${(f.content || "").length > 80 ? "…" : ""}</td>
      <td>${formatDate(f.scheduled_at)}</td>
      <td><span class="badge ${f.completed ? "completada" : isOverdue ? "vencido" : "pendiente"}">${f.completed ? "completado" : isOverdue ? "vencido" : "pendiente"}</span></td>
      <td>${escapeHtml(f.clients?.phone || "—")}</td>
      <td class="entity-actions">
        ${!f.completed ? `<button class="btn btn-ghost" data-complete-followup="${f.id}">Completar</button>` : ""}
        <button class="btn btn-ghost" data-edit-followup="${f.id}">Editar</button>
        <button class="btn btn-danger" data-del-followup="${f.id}">Eliminar</button>
      </td>
    </tr>`;
    })
    .join("");

  const alertsEl = $("[data-followup-alerts]");
  if (alertsEl) {
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const allPending = data.filter((f) => !f.completed);
    const overdueCount = allPending.filter((f) => f.scheduled_at && new Date(f.scheduled_at) < now).length;
    const todayCount = allPending.filter((f) => {
      if (!f.scheduled_at) return false;
      const d = new Date(f.scheduled_at);
      return d >= todayStart && d <= todayEnd;
    }).length;

    let newLeadsCount = 0;
    try {
      const { count } = await requireSupabase()
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("status", "nuevo");
      newLeadsCount = count || 0;
    } catch (_) {}

    const cards = [];
    if (overdueCount > 0) {
      cards.push(`<div class="alert-card alert-card--danger">${overdueCount} control${overdueCount > 1 ? "es" : ""} vencido${overdueCount > 1 ? "s" : ""}</div>`);
    }
    if (todayCount > 0) {
      cards.push(`<div class="alert-card alert-card--warning">${todayCount} seguimiento${todayCount > 1 ? "s" : ""} para hoy</div>`);
    }
    if (newLeadsCount > 0) {
      cards.push(`<div class="alert-card alert-card--info">${newLeadsCount} lead${newLeadsCount > 1 ? "s" : ""} nuevo${newLeadsCount > 1 ? "s" : ""} sin contactar</div>`);
    }
    alertsEl.innerHTML = cards.join("");
  }

  body.querySelectorAll("[data-complete-followup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await requireSupabase()
        .from("followups")
        .update({ completed: true, completed_at: new Date().toISOString() })
        .eq("id", btn.dataset.completeFollowup);
      loadFollowups();
    });
  });
  body.querySelectorAll("[data-edit-followup]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = data.find((x) => x.id === btn.dataset.editFollowup);
      if (row) openFollowupModal(row, row.client_id);
    });
  });
  body.querySelectorAll("[data-del-followup]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este seguimiento?")) return;
      await requireSupabase().from("followups").delete().eq("id", btn.dataset.delFollowup);
      loadFollowups();
    });
  });
}

$("[data-followups-filter]")?.addEventListener("change", () => loadFollowups());

$("[data-open-followup]")?.addEventListener("click", () => openFollowupModal(null, null));

async function openFollowupModal(row, clientId) {
  let clientOptions = "";
  try {
    const { data: clients } = await requireSupabase()
      .from("clients")
      .select("id, name, pet_name")
      .order("name")
      .limit(500);
    clientOptions = (clients || [])
      .map(
        (c) =>
          `<option value="${c.id}" ${(clientId || row?.client_id) === c.id ? "selected" : ""}>${escapeHtml(c.name || "—")}${c.pet_name ? " (" + escapeHtml(c.pet_name) + ")" : ""}</option>`
      )
      .join("");
  } catch (_) {}

  openModal({
    title: row ? "Editar seguimiento" : "Nuevo seguimiento",
    fields: `
      <label>Cliente
        <select name="client_id" required>
          <option value="">— Seleccionar cliente —</option>
          ${clientOptions}
        </select>
      </label>
      <label>Tipo
        <select name="type">
          ${["control", "vacuna", "recordatorio", "seguimiento", "general"]
            .map((t) => `<option value="${t}" ${row?.type === t ? "selected" : ""}>${t}</option>`)
            .join("")}
        </select>
      </label>
      <label>Contenido <textarea name="content" rows="3" required>${escapeHtml(row?.content || "")}</textarea></label>
      <label>Fecha programada <input name="scheduled_at" type="datetime-local" value="${toLocalInput(row?.scheduled_at)}" required /></label>
      ${row ? `<label><input type="checkbox" name="completed" ${row.completed ? "checked" : ""} /> Completado</label>` : ""}
    `,
    onSave: async (fd) => {
      const payload = {
        client_id: String(fd.get("client_id") || "").trim(),
        type: String(fd.get("type") || "general"),
        content: String(fd.get("content") || "").trim(),
        scheduled_at: fd.get("scheduled_at") ? new Date(String(fd.get("scheduled_at"))).toISOString() : null,
        completed: fd.get("completed") === "on",
      };
      if (payload.completed && !row?.completed) {
        payload.completed_at = new Date().toISOString();
      }
      if (row?.id) {
        await requireSupabase().from("followups").update(payload).eq("id", row.id);
      } else {
        await requireSupabase().from("followups").insert(payload);
      }
      await loadFollowups();
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
