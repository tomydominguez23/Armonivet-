import { isSupabaseConfigured, requireSupabase, supabase } from "../lib/supabase.js";
import { getSession, loginHref } from "./session.js";

const titles = {
  dashboard: ["Dashboard", "Resumen operativo del consultorio"],
  agenda: ["Agenda", "Hoy, esta semana y citas por confirmar"],
  leads: ["Leads", "Leads capturados desde Genesis y otros canales"],
  clients: ["Clientes", "Gestión de clientes y cuestionarios"],
  followups: ["Seguimiento", "Controles pendientes y recordatorios"],
  appointments: ["Citas", "Agenda, abonos y asistencia"],
  genesis: ["Chats web", "Conversaciones del widget Genesis en la web"],
  whatsapp: ["WhatsApp", "Bandeja de Génesis y toma humana"],
  genesis_config: ["Génesis IA", "Prompt, modelo, pagos y horarios del agente"],
  intakes: ["Cuestionarios", "Fichas pre-consulta para la Dra. Bárbara"],
  channels: ["Canales", "Atribución de publicidad y UTM"],
  services: ["Servicios", "Contenido y precios de la web"],
  pricing: ["Precios", "Zonas de domicilio y extras"],
  media: ["Imágenes", "Galería visual de la web: hero, servicios y zonas"],
  settings: ["Ajustes", "Enlaces y datos del negocio"],
};

const CLIENT_STATUSES = [
  "lead",
  "contactado",
  "agendado",
  "abonado",
  "atendido",
  "en_seguimiento",
  "control_pendiente",
  "completado",
  "perdido",
];

const state = {
  section: "dashboard",
  days: 30,
  editing: null,
  mediaFilter: "all",
  mediaItems: [],
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

function edgeErrorMessage(error, data, fallback) {
  const raw = String(data?.error || data?.message || error?.message || fallback || "Error");
  if (/no credits remaining|insufficient_quota|exceeded your current quota/i.test(raw)) {
    return "OpenAI no tiene créditos. Cargá saldo en platform.openai.com → Billing y volvé a simular. No hace falta redesplegar las funciones.";
  }
  if (/invalid api key|incorrect api key/i.test(raw)) {
    return "La OPENAI_API_KEY de Supabase no es válida. Revisala en Project Settings → Edge Functions → Secrets.";
  }
  if (/Failed to send|not found|404/i.test(raw)) {
    return "La función no está desplegada. En GitHub: Actions → Deploy Edge Functions → Run workflow.";
  }
  return raw;
}

function goToLogin() {
  window.location.replace(loginHref(window.location.href));
}

function setSection(section, { syncHash = true } = {}) {
  if (!titles[section]) section = "dashboard";
  state.section = section;
  document.querySelector(".admin-shell")?.setAttribute("data-section", section);
  $$("[data-nav]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.nav === section));
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === section));
  const [title, sub] = titles[section] || ["Admin", ""];
  $("[data-page-title]").textContent = title;
  $("[data-page-sub]").textContent = sub;
  document.querySelector(".admin-shell")?.classList.remove("is-nav-open");
  if (syncHash && location.hash !== `#${section}`) {
    history.replaceState(null, "", `#${section}`);
  }
  loadSection(section);
}

async function boot() {
  const status = $("[data-boot-status]");
  if (!isSupabaseConfigured) {
    goToLogin();
    return;
  }
  const session = await getSession();
  if (!session) {
    goToLogin();
    return;
  }
  $("[data-user-email]").textContent = session.user.email || "Admin";
  $("[data-view='app']").hidden = false;
  if (status) status.hidden = true;
  const fromHash = location.hash.replace("#", "");
  setSection(titles[fromHash] ? fromHash : "dashboard", { syncHash: true });
}

$("[data-logout]")?.addEventListener("click", async () => {
  if (supabase) await supabase.auth.signOut();
  goToLogin();
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
  if (section === "agenda") return loadAgenda();
  if (section === "leads") return loadLeads();
  if (section === "clients") return loadClients();
  if (section === "followups") return loadFollowups();
  if (section === "appointments") return loadAppointments();
  if (section === "whatsapp") return loadWhatsApp();
  if (section === "genesis") return loadGenesis();
  if (section === "intakes") return loadIntakes();
  if (section === "genesis_config") return loadGenesisConfig();
  if (section === "channels") return loadChannels();
  if (section === "services") return loadServices();
  if (section === "pricing") return loadPricing();
  if (section === "media") return loadMedia();
  if (section === "settings") return loadSettings();
}

window.addEventListener("hashchange", () => {
  const section = location.hash.replace("#", "");
  if (section && section !== state.section) setSection(section, { syncHash: false });
});

document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-goto]");
  if (!goto) return;
  const section = goto.dataset.goto;
  if (section && titles[section]) setSection(section);
});

/* -------------------- Dashboard -------------------- */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function pct(n, d) {
  if (!d) return "—";
  return `${Math.round((Number(n || 0) / Number(d)) * 100)}%`;
}

function isPaidAppt(a) {
  return Boolean(a.deposit_paid) || ["abonada", "llegó", "completada"].includes(a.status);
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const t = startOfDay();
  return d >= t && d <= endOfDay();
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function formatDay(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

function emptyMini(text) {
  return `<p class="empty">${text}</p>`;
}

async function safeSelect(table, columns, build) {
  try {
    let query = requireSupabase().from(table).select(columns);
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

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

  const extras = await loadDashboardExtras();
  const merged = { ...stats, ...extras.counts, recent_leads: v2Result?.recent_leads || extras.recentLeads };
  merged.clients_need_followup = v2Result?.clients_need_followup || extras.needFollowup;

  const dateEl = $("[data-dash-date]");
  if (dateEl) {
    dateEl.textContent = new Intl.DateTimeFormat("es-CL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
  }

  const summaryEl = $("[data-dash-summary]");
  if (summaryEl) {
    summaryEl.textContent = `${extras.today.length} cita${extras.today.length === 1 ? "" : "s"} hoy · ${merged.leads_new || 0} leads nuevos · ${merged.followups_pending || 0} seguimientos pendientes`;
  }

  const map = {
    visits_unique: merged.visits_unique ?? 0,
    leads_total: merged.leads_total ?? extras.leads.length,
    appointments_total: merged.appointments_total ?? merged.appointments ?? extras.appointments.length,
    paid: merged.paid ?? extras.paidCount,
    arrived: merged.arrived ?? extras.arrivedCount,
    revenue: formatCLP(merged.revenue ?? merged.revenue_estimated ?? extras.revenue),
    followups_pending: merged.followups_pending ?? extras.followupsPending,
    chats_active: extras.chatsActive,
  };
  Object.entries(map).forEach(([k, v]) => {
    const el = $(`[data-kpi="${k}"]`);
    if (el) el.textContent = v ?? 0;
  });

  setText("[data-kpi-sub='visits_total']", `${merged.visits_total ?? 0} hits`);
  setText("[data-kpi-sub='leads_new']", `${merged.leads_new ?? 0} nuevos`);
  setText("[data-kpi-sub='appointments_today']", `${extras.today.length} hoy`);
  setText("[data-kpi-sub='unpaid']", `${extras.unpaid.length} sin abono`);
  setText("[data-kpi-sub='no_show']", `${extras.noShowCount} no asistió`);
  setText("[data-kpi-sub='ticket']", extras.paidCount ? `ticket ${formatCLP(extras.revenue / extras.paidCount)}` : "sin ticket");
  setText("[data-kpi-sub='controls_overdue']", `${merged.controls_overdue ?? extras.overdueFollowups} vencidos`);
  setText("[data-kpi-sub='intakes_done']", `${extras.intakes.length} fichas`);

  renderConversionRates(merged, extras);
  renderVisitChart(merged.visits_by_day || []);
  renderChannels(merged.by_channel || []);
  renderFunnel(merged);
  renderStatus(merged.appointments_by_status || extras.statusRows);
  renderAgendaPreview("[data-today-agenda]", extras.today, "Sin citas para hoy");
  renderAgendaPreview("[data-week-agenda]", extras.week, "Sin citas en los próximos 7 días");
  renderPipeline(extras.clients);
  renderDashAlerts(merged, extras);

  const recentLeadsEl = $("[data-recent-leads]");
  if (recentLeadsEl) {
    const recentLeads = (merged.recent_leads || extras.recentLeads).slice(0, 8);
    recentLeadsEl.innerHTML = recentLeads.length
      ? recentLeads
          .map(
            (l) => `<button type="button" class="mini-card" data-goto="leads">
          <strong>${escapeHtml(l.name || "Sin nombre")}</strong>
          <small>${escapeHtml(l.phone || l.email || "—")} · ${escapeHtml(l.channel_slug || l.source || "directo")}</small>
          <span class="badge ${l.status || "nuevo"}">${escapeHtml(l.status || "nuevo")}</span>
        </button>`
          )
          .join("")
      : emptyMini("Sin leads recientes");
  }

  const needFollowupEl = $("[data-need-followup]");
  if (needFollowupEl) {
    const needFollowup = (merged.clients_need_followup || extras.needFollowup).slice(0, 8);
    needFollowupEl.innerHTML = needFollowup.length
      ? needFollowup
          .map(
            (c) => `<button type="button" class="mini-card" data-goto="followups">
          <strong>${escapeHtml(c.name || c.pet_name || "Sin nombre")}</strong>
          <small>${escapeHtml(c.phone || "—")} · próximo: ${formatDate(c.next_followup_at)}</small>
        </button>`
          )
          .join("")
      : emptyMini("Sin seguimientos pendientes");
  }

  const unpaidEl = $("[data-unpaid-list]");
  if (unpaidEl) {
    unpaidEl.innerHTML = extras.unpaid.length
      ? extras.unpaid
          .slice(0, 8)
          .map(
            (a) => `<button type="button" class="mini-card" data-goto="appointments">
          <strong>${escapeHtml(a.client_name || "Sin nombre")}</strong>
          <small>${formatDay(a.scheduled_at)} · ${escapeHtml(a.service_title || "Consulta")} · ${formatCLP(a.amount)}</small>
          <span class="badge ${a.status}">${escapeHtml(a.status)}</span>
        </button>`
          )
          .join("")
      : emptyMini("Todas las citas tienen abono");
  }

  const genesisEl = $("[data-genesis-preview]");
  if (genesisEl) {
    const chats = extras.chats.slice(0, 6);
    genesisEl.innerHTML = chats.length
      ? chats
          .map((c) => {
            const answers = c.answers || {};
            return `<button type="button" class="mini-card" data-goto="genesis">
          <strong>${escapeHtml(c.visitor_name || answers.tutor_name || "Visitante")}</strong>
          <small>${escapeHtml(answers.pet_name || "—")} · ${escapeHtml(c.status || "activa")}</small>
          <span class="badge ${c.status || "activa"}">${escapeHtml(c.status || "activa")}</span>
        </button>`;
          })
          .join("")
      : emptyMini("Sin chats recientes");
  }

  const alertsEl = $("[data-topbar-alerts]");
  if (alertsEl) {
    const alerts = [];
    const overdueCount = merged.controls_overdue ?? extras.overdueFollowups;
    const newLeadsCount = merged.leads_new ?? 0;
    if (overdueCount > 0) {
      alerts.push(
        `<button type="button" class="topbar-alert topbar-alert--danger" data-goto="followups">${overdueCount} control${overdueCount > 1 ? "es" : ""} vencido${overdueCount > 1 ? "s" : ""}</button>`
      );
    }
    if (newLeadsCount > 0) {
      alerts.push(
        `<button type="button" class="topbar-alert topbar-alert--info" data-goto="leads">${newLeadsCount} lead${newLeadsCount > 1 ? "s" : ""} nuevo${newLeadsCount > 1 ? "s" : ""}</button>`
      );
    }
    if (extras.today.length) {
      alerts.push(
        `<button type="button" class="topbar-alert" data-goto="agenda">${extras.today.length} hoy</button>`
      );
    }
    alertsEl.innerHTML = alerts.join("");
  }
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

async function loadDashboardExtras() {
  const since = new Date(Date.now() - state.days * 86400000).toISOString();
  const weekEnd = new Date(startOfDay());
  weekEnd.setDate(weekEnd.getDate() + 7);
  const fortnight = new Date(startOfDay());
  fortnight.setDate(fortnight.getDate() + 14);

  const [appointments, leads, clients, followups, chats, intakes] = await Promise.all([
    safeSelect("appointments", "*", (q) => q.order("scheduled_at", { ascending: true }).limit(250)),
    safeSelect("leads", "*", (q) => q.order("created_at", { ascending: false }).limit(80)),
    safeSelect("clients", "id,name,phone,pet_name,status,next_followup_at,last_contact_at", (q) =>
      q.order("updated_at", { ascending: false }).limit(200)
    ),
    safeSelect("followups", "id,client_id,type,content,scheduled_at,completed,clients(name,pet_name,phone)", (q) =>
      q.eq("completed", false).order("scheduled_at", { ascending: true }).limit(80)
    ),
    safeSelect("chat_conversations", "*", (q) => q.order("updated_at", { ascending: false }).limit(40)),
    safeSelect("intake_forms", "*", (q) => q.order("created_at", { ascending: false }).limit(40)),
  ]);

  const periodAppts = appointments.filter((a) => !a.created_at || a.created_at >= since || (a.scheduled_at && a.scheduled_at >= since));
  const today = appointments
    .filter((a) => isToday(a.scheduled_at) && a.status !== "cancelada")
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const week = appointments
    .filter((a) => {
      if (!a.scheduled_at || a.status === "cancelada") return false;
      const d = new Date(a.scheduled_at);
      return d > endOfDay() && d <= weekEnd;
    })
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const unpaid = appointments.filter(
    (a) => a.status !== "cancelada" && a.status !== "completada" && !isPaidAppt(a) && a.scheduled_at && new Date(a.scheduled_at) >= startOfDay()
  );
  const paidCount = periodAppts.filter(isPaidAppt).length;
  const arrivedCount = periodAppts.filter((a) => ["llegó", "completada"].includes(a.status)).length;
  const noShowCount = periodAppts.filter((a) => a.status === "no_asistió").length;
  const revenue = periodAppts.filter(isPaidAppt).reduce((sum, a) => sum + Number(a.amount || 0), 0);
  const statusMap = {};
  periodAppts.forEach((row) => {
    statusMap[row.status] = (statusMap[row.status] || 0) + 1;
  });
  const now = new Date();
  const overdueFollowups = followups.filter((f) => f.scheduled_at && new Date(f.scheduled_at) < now).length;
  const needFollowup = clients.filter(
    (c) =>
      ["en_seguimiento", "control_pendiente", "atendido"].includes(c.status) &&
      (!c.next_followup_at || new Date(c.next_followup_at) <= new Date(Date.now() + 3 * 86400000))
  );

  return {
    appointments,
    leads,
    clients,
    followups,
    chats,
    intakes,
    today,
    week,
    unpaid,
    paidCount,
    arrivedCount,
    noShowCount,
    revenue,
    followupsPending: followups.length,
    overdueFollowups,
    chatsActive: chats.filter((c) => c.status === "activa").length,
    recentLeads: leads.slice(0, 10),
    needFollowup,
    statusRows: Object.entries(statusMap).map(([status, total]) => ({ status, total })),
    fortnight,
    counts: {
      leads_total: leads.filter((l) => !l.created_at || l.created_at >= since).length,
      leads_new: leads.filter((l) => l.status === "nuevo").length,
    },
  };
}

function renderConversionRates(stats, extras) {
  const root = $("[data-conversion-rates]");
  if (!root) return;
  const visits = stats.visits_unique || 0;
  const leads = stats.leads_total || extras.counts?.leads_total || 0;
  const clicks = stats.click_agendar || 0;
  const appts = stats.appointments_total || stats.appointments || 0;
  const paid = stats.paid || extras.paidCount || 0;
  const arrived = stats.arrived || extras.arrivedCount || 0;
  const rates = [
    ["Visita → lead", pct(leads, visits), `${leads}/${visits || "—"}`],
    ["Lead → cita", pct(appts, leads), `${appts}/${leads || "—"}`],
    ["Clic agendar", pct(clicks, visits), `${clicks} clics`],
    ["Cita → abono", pct(paid, appts), `${paid} abonaron`],
    ["Cita → llegó", pct(arrived, appts), `${arrived} asistieron`],
    ["No show", pct(extras.noShowCount, appts), `${extras.noShowCount} ausencias`],
  ];
  root.innerHTML = rates
    .map(
      ([label, value, sub]) => `<article class="rate-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <em>${escapeHtml(sub)}</em>
      </article>`
    )
    .join("");
}

function renderAgendaPreview(sel, rows, emptyText) {
  const root = $(sel);
  if (!root) return;
  if (!rows.length) {
    root.innerHTML = emptyMini(emptyText);
    return;
  }
  root.innerHTML = rows
    .slice(0, 6)
    .map(
      (a) => `<button type="button" class="agenda-item" data-goto="agenda">
        <time>${escapeHtml(isToday(a.scheduled_at) ? formatTime(a.scheduled_at) : formatDay(a.scheduled_at))}</time>
        <div>
          <strong>${escapeHtml(a.client_name || "Sin nombre")}</strong>
          <small>${escapeHtml(a.pet_name || "—")} · ${escapeHtml(a.service_title || "Consulta")}</small>
        </div>
        <span class="badge ${a.status}">${escapeHtml(a.status)}</span>
      </button>`
    )
    .join("");
}

function renderPipeline(clients) {
  const root = $("[data-client-pipeline]");
  if (!root) return;
  const counts = Object.fromEntries(CLIENT_STATUSES.map((s) => [s, 0]));
  clients.forEach((c) => {
    if (counts[c.status] != null) counts[c.status] += 1;
  });
  root.innerHTML = CLIENT_STATUSES.map(
    (status) => `<button type="button" class="pipeline-col" data-goto="clients">
      <strong>${counts[status] || 0}</strong>
      <span>${escapeHtml(status.replaceAll("_", " "))}</span>
    </button>`
  ).join("");
}

function renderDashAlerts(stats, extras) {
  const root = $("[data-dash-alerts]");
  if (!root) return;
  const cards = [];
  if (extras.overdueFollowups > 0) {
    cards.push(
      `<button type="button" class="alert-card" data-goto="followups"><h4>${extras.overdueFollowups} controles vencidos</h4><p>Hay clientes con seguimiento atrasado.</p></button>`
    );
  }
  if (extras.unpaid.length) {
    cards.push(
      `<button type="button" class="alert-card warning" data-goto="appointments"><h4>${extras.unpaid.length} citas sin abono</h4><p>Confirma el depósito antes de la visita.</p></button>`
    );
  }
  if ((stats.leads_new || extras.counts.leads_new) > 0) {
    cards.push(
      `<button type="button" class="alert-card info" data-goto="leads"><h4>${stats.leads_new || extras.counts.leads_new} leads nuevos</h4><p>Contactar desde Genesis o WhatsApp.</p></button>`
    );
  }
  if (extras.chatsActive > 0) {
    cards.push(
      `<button type="button" class="alert-card info" data-goto="genesis"><h4>${extras.chatsActive} chats activos</h4><p>Hay conversaciones Genesis sin terminar.</p></button>`
    );
  }
  root.innerHTML = cards.join("");
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

$$("[data-open-appointment]").forEach((btn) => {
  btn.addEventListener("click", () => openAppointmentModal(null));
});

function appointmentRowActions(a) {
  return `<td class="entity-actions">
        <button class="btn btn-ghost" data-edit-appointment="${a.id}">Editar</button>
        <button class="btn btn-danger" data-del-appointment="${a.id}">Borrar</button>
      </td>`;
}

function bindAppointmentRowActions(root, data) {
  root.querySelectorAll("[data-edit-appointment]").forEach((btn) => {
    btn.addEventListener("click", () => openAppointmentModal(data.find((x) => x.id === btn.dataset.editAppointment)));
  });
  root.querySelectorAll("[data-del-appointment]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta cita?")) return;
      await requireSupabase().from("appointments").delete().eq("id", btn.dataset.delAppointment);
      if (state.section === "agenda") loadAgenda();
      else loadAppointments();
    });
  });
}

async function loadAgenda() {
  const rows = await safeSelect("appointments", "*", (q) => q.order("scheduled_at", { ascending: true }).limit(250));
  const today = rows.filter((a) => isToday(a.scheduled_at) && a.status !== "cancelada");
  const until = new Date(startOfDay());
  until.setDate(until.getDate() + 14);
  const upcoming = rows.filter((a) => {
    if (!a.scheduled_at || a.status === "cancelada") return false;
    const d = new Date(a.scheduled_at);
    return d > endOfDay() && d <= until;
  });
  const unpaid = rows.filter((a) => a.status !== "cancelada" && !isPaidAppt(a) && a.scheduled_at && new Date(a.scheduled_at) >= startOfDay());

  const alerts = $("[data-agenda-alerts]");
  if (alerts) {
    const cards = [];
    if (today.length) cards.push(`<div class="alert-card info"><h4>${today.length} citas hoy</h4><p>Revisa abonos y horarios.</p></div>`);
    if (unpaid.length) cards.push(`<div class="alert-card warning"><h4>${unpaid.length} sin abono</h4><p>Pendientes de depósito.</p></div>`);
    alerts.innerHTML = cards.join("");
  }

  const todayBody = $("[data-agenda-today-body]");
  if (todayBody) {
    todayBody.innerHTML = today.length
      ? today
          .map(
            (a) => `<tr>
        <td>${formatTime(a.scheduled_at)}</td>
        <td><strong>${escapeHtml(a.client_name)}</strong><br><small>${escapeHtml(a.client_phone || a.client_email || "")}</small></td>
        <td>${escapeHtml(a.pet_name || "—")}</td>
        <td>${escapeHtml(a.service_title || "Consulta")}</td>
        <td><span class="badge ${a.status}">${escapeHtml(a.status)}</span></td>
        <td>${formatCLP(a.amount)}</td>
        ${appointmentRowActions(a)}
      </tr>`
          )
          .join("")
      : `<tr><td colspan="7" class="empty">No hay citas para hoy.</td></tr>`;
    bindAppointmentRowActions(todayBody, rows);
  }

  const weekBody = $("[data-agenda-week-body]");
  if (weekBody) {
    weekBody.innerHTML = upcoming.length
      ? upcoming
          .map(
            (a) => `<tr>
        <td>${formatDay(a.scheduled_at)} ${formatTime(a.scheduled_at)}</td>
        <td><strong>${escapeHtml(a.client_name)}</strong></td>
        <td>${escapeHtml(a.pet_name || "—")}</td>
        <td>${escapeHtml(a.service_title || "Consulta")}</td>
        <td><span class="badge ${a.status}">${escapeHtml(a.status)}</span></td>
        <td>${isPaidAppt(a) ? "Pagado" : "Pendiente"}</td>
        ${appointmentRowActions(a)}
      </tr>`
          )
          .join("")
      : `<tr><td colspan="7" class="empty">Sin citas en los próximos 14 días.</td></tr>`;
    bindAppointmentRowActions(weekBody, rows);
  }

  await renderAgendaCalendar(rows);
}

const WEEKDAYS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
let agendaCalCursor = new Date();
agendaCalCursor.setDate(1);
let agendaCalSelected = null;
let agendaCalBound = false;
let agendaCalAppointments = [];

function chileDateKey(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function monthTitle(d) {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(d);
}

async function renderAgendaCalendar(appointments) {
  const root = $("[data-admin-cal]");
  if (!root) return;
  agendaCalAppointments = appointments || [];
  bindAgendaCalendarOnce();

  const blocks = await safeSelect("booking_blocks", "id,day,reason");
  const blocked = new Set(blocks.map((b) => chileDateKey(b.day)));
  const byDay = {};
  for (const a of agendaCalAppointments) {
    if (!a.scheduled_at || a.status === "cancelada") continue;
    const key = chileDateKey(a.scheduled_at);
    byDay[key] = (byDay[key] || 0) + 1;
  }

  const monthEl = $("[data-cal-month]");
  const grid = $("[data-cal-grid]");
  if (monthEl) monthEl.textContent = monthTitle(agendaCalCursor);
  if (!grid) return;

  const year = agendaCalCursor.getFullYear();
  const month = agendaCalCursor.getMonth();
  const startPad = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = WEEKDAYS_ES.map((name) => `<span class="booking-dow">${name}</span>`);
  for (let i = 0; i < startPad; i += 1) cells.push(`<span class="booking-day is-empty"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = byDay[key] || 0;
    const isBlocked = blocked.has(key);
    const selected = agendaCalSelected === key ? " is-selected" : "";
    const blockedCls = isBlocked ? " is-blocked" : "";
    cells.push(
      `<button type="button" class="booking-day${blockedCls}${selected}" data-cal-day="${key}">
        <strong>${day}</strong>
        <em>${isBlocked ? "Bloqueado" : count ? `${count} cita${count === 1 ? "" : "s"}` : "Libre"}</em>
      </button>`,
    );
  }
  grid.innerHTML = cells.join("");
  grid.querySelectorAll("[data-cal-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      agendaCalSelected = btn.getAttribute("data-cal-day");
      renderAgendaCalendar(agendaCalAppointments);
    });
  });

  const panel = $("[data-cal-day-panel]");
  const label = $("[data-cal-day-label]");
  const list = $("[data-cal-day-appts]");
  const toggle = $("[data-cal-toggle-block]");
  if (!panel || !agendaCalSelected) return;
  panel.hidden = false;
  const selectedDate = new Date(`${agendaCalSelected}T12:00:00`);
  if (label) {
    label.textContent = new Intl.DateTimeFormat("es-CL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(selectedDate);
  }
  const dayAppts = agendaCalAppointments.filter(
    (a) => chileDateKey(a.scheduled_at) === agendaCalSelected && a.status !== "cancelada",
  );
  if (list) {
    list.innerHTML = dayAppts.length
      ? dayAppts
          .map(
            (a) =>
              `<li><strong>${escapeHtml(formatTime(a.scheduled_at))}</strong> · ${escapeHtml(a.client_name || "—")} · ${escapeHtml(a.service_title || "Consulta")} · ${escapeHtml(a.status)}</li>`,
          )
          .join("")
      : `<li class="empty">Sin citas este día.</li>`;
  }
  if (toggle) {
    const isBlocked = blocked.has(agendaCalSelected);
    toggle.textContent = isBlocked ? "Desbloquear día" : "Bloquear día";
    toggle.dataset.blocked = isBlocked ? "1" : "0";
  }
}

function bindAgendaCalendarOnce() {
  if (agendaCalBound) return;
  agendaCalBound = true;
  $("[data-cal-prev]")?.addEventListener("click", () => {
    agendaCalCursor.setMonth(agendaCalCursor.getMonth() - 1);
    renderAgendaCalendar(agendaCalAppointments);
  });
  $("[data-cal-next]")?.addEventListener("click", () => {
    agendaCalCursor.setMonth(agendaCalCursor.getMonth() + 1);
    renderAgendaCalendar(agendaCalAppointments);
  });
  $("[data-cal-toggle-block]")?.addEventListener("click", async () => {
    if (!agendaCalSelected) return;
    const toggle = $("[data-cal-toggle-block]");
    const blocked = toggle?.dataset.blocked === "1";
    if (blocked) {
      await requireSupabase().from("booking_blocks").delete().eq("day", agendaCalSelected);
    } else {
      const { error } = await requireSupabase().from("booking_blocks").insert({
        day: agendaCalSelected,
        reason: "Bloqueo admin",
      });
      if (error) {
        alert(error.message || "No se pudo bloquear. ¿Corriste booking.sql?");
        return;
      }
    }
    await renderAgendaCalendar(agendaCalAppointments);
  });
}

async function loadWhatsApp() {
  const listEl = $("[data-wa-list]");
  if (!listEl) return;
  const rows = await safeSelect("wa_conversations", "*", (q) => q.order("last_message_at", { ascending: false }).limit(80));
  state.waConversations = rows;
  if (!rows.length) {
    listEl.innerHTML = `<p class="empty">Aún no hay chats de WhatsApp. Usá “Simular mensaje” o conectá el webhook.</p>`;
  } else {
    listEl.innerHTML = rows
      .map((c) => {
        const active = state.waConversationId === c.id ? "is-active" : "";
        const who = c.assigned_to === "humano" ? "Humano" : "Génesis";
        return `<button type="button" class="wa-item ${active}" data-open-wa="${c.id}">
          <strong>${escapeHtml(c.wa_name || c.wa_phone)}</strong>
          <small>${escapeHtml(c.pipeline || "nuevo")} · ${who}${c.unread_count ? ` · ${c.unread_count} nuevo` : ""}</small>
        </button>`;
      })
      .join("");
    listEl.querySelectorAll("[data-open-wa]").forEach((btn) => {
      btn.addEventListener("click", () => openWaThread(btn.dataset.openWa));
    });
  }
  if (state.waConversationId) await openWaThread(state.waConversationId);
  subscribeWaRealtime();
}

async function openWaThread(id) {
  state.waConversationId = id;
  const conv = (state.waConversations || []).find((c) => c.id === id);
  const thread = $("[data-wa-thread]");
  if (!thread) return;
  await requireSupabase().from("wa_conversations").update({ unread_count: 0 }).eq("id", id);
  const messages = await safeSelect("wa_messages", "*", (q) => q.eq("conversation_id", id).order("created_at", { ascending: true }).limit(200));
  const paused = conv?.assigned_to === "humano";
  thread.innerHTML = `
    <header class="wa-thread-head">
      <div>
        <strong>${escapeHtml(conv?.wa_name || conv?.wa_phone || "Chat")}</strong>
        <small>${escapeHtml(conv?.wa_phone || "")} · ${escapeHtml(conv?.pipeline || "")}</small>
      </div>
      <div class="btn-row">
        ${paused
          ? `<button type="button" class="btn btn-primary" data-wa-resume>Devolver a Génesis</button>`
          : `<button type="button" class="btn btn-ghost" data-wa-pause>Tomar conversación</button>`}
      </div>
    </header>
    <div class="wa-bubbles" data-wa-bubbles>
      ${messages
        .map(
          (m) => `<div class="wa-bubble wa-bubble--${m.direction}"><small>${escapeHtml(m.author)}</small><p>${escapeHtml(m.content || "")}</p></div>`
        )
        .join("") || `<p class="empty">Sin mensajes</p>`}
    </div>
    <form class="wa-composer" data-wa-composer>
      <input name="content" required placeholder="${paused ? "Escribí como Armonivet…" : "Génesis está activa. Tomá el chat para escribir."}" ${paused ? "" : "disabled"} />
      <button class="btn btn-primary" type="submit" ${paused ? "" : "disabled"}>Enviar</button>
    </form>`;
  const bubbles = $("[data-wa-bubbles]");
  if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;
  $("[data-wa-pause]")?.addEventListener("click", async () => {
    await requireSupabase()
      .from("wa_conversations")
      .update({ assigned_to: "humano", status: "pausada_humano", pipeline: "derivado_humano" })
      .eq("id", id);
    await loadWhatsApp();
  });
  $("[data-wa-resume]")?.addEventListener("click", async () => {
    await requireSupabase()
      .from("wa_conversations")
      .update({ assigned_to: "genesis", status: "abierta" })
      .eq("id", id);
    await loadWhatsApp();
  });
  $("[data-wa-composer]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = String(new FormData(e.currentTarget).get("content") || "").trim();
    if (!content) return;
    const { data, error } = await requireSupabase().functions.invoke("whatsapp-send", {
      body: { conversation_id: id, content },
    });
    if (error) {
      alert(edgeErrorMessage(error, data, "No se pudo enviar. Revisá que whatsapp-send esté desplegada."));
      return;
    }
    await openWaThread(id);
  });
  $$("[data-open-wa]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.openWa === id));
}

function subscribeWaRealtime() {
  if (!supabase || state.waChannel) return;
  state.waChannel = supabase
    .channel("wa-inbox")
    .on("postgres_changes", { event: "*", schema: "public", table: "wa_messages" }, () => {
      if (state.section === "whatsapp") loadWhatsApp();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "wa_conversations" }, () => {
      if (state.section === "whatsapp") loadWhatsApp();
    })
    .subscribe();
}

$("[data-wa-refresh]")?.addEventListener("click", () => loadWhatsApp());
$("[data-wa-simulate]")?.addEventListener("click", () => {
  openModal({
    title: "Simular mensaje de WhatsApp",
    fields: `
      <p>Sirve para probar Génesis y el dashboard sin Meta. No envía un WhatsApp real.</p>
      <label>Teléfono <input name="sim_phone" type="tel" inputmode="numeric" autocomplete="off" value="56912345678" placeholder="56912345678" /></label>
      <label>Nombre <input name="name" autocomplete="off" value="Camila" /></label>
      <label>Mensaje <textarea name="text" rows="3" autocomplete="off">Hola, necesito hora para mi perro porque cuando queda solo destruye todo.</textarea></label>
    `,
    saveLabel: "Simular",
    onSave: async (fd) => {
      const phone = String(fd.get("sim_phone") || "").trim();
      const text = String(fd.get("text") || "").trim();
      if (!phone) throw new Error("Escribí un teléfono para simular, o Cancelar para volver al dashboard.");
      if (!text) throw new Error("Escribí un mensaje para simular, o Cancelar para volver al dashboard.");
      const { data, error } = await requireSupabase().functions.invoke("genesis-simulate", {
        body: {
          phone,
          name: String(fd.get("name") || ""),
          text,
        },
      });
      if (error) {
        throw new Error(
          edgeErrorMessage(error, data, "No se pudo simular. Revisá OPENAI_API_KEY en Supabase → Edge Functions → Secrets."),
        );
      }
      state.waConversationId = data?.conversation_id || state.waConversationId;
      await loadWhatsApp();
    },
  });
});

async function loadGenesisConfig() {
  const { data } = await requireSupabase().from("site_settings").select("value").eq("key", "genesis").maybeSingle();
  const v = data?.value || {};
  const form = $("[data-genesis-form]");
  if (!form) return;
  form.enabled.checked = v.enabled !== false;
  form.model.value = v.model || "gpt-5.6-luna";
  form.model_complex.value = v.model_complex || v.model || "gpt-5.6-luna";
  form.deposit_amount.value = v.deposit_amount ?? 20000;
  form.min_price.value = v.min_price ?? 40000;
  form.payment_url.value = v.payment_url || "";
  form.slot_hours.value = Array.isArray(v.slot_hours) ? v.slot_hours.join("\n") : "10:00\n12:00\n15:00\n17:30";
  const workdays = Array.isArray(v.workdays) && v.workdays.length ? v.workdays.map(Number) : [1, 2, 3, 4, 5, 6];
  form.querySelectorAll('input[name="wd"]').forEach((box) => {
    box.checked = workdays.includes(Number(box.value));
  });
  form.system_prompt.value = v.system_prompt || "";
}

$("[data-genesis-form]")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const { data: prevRow } = await requireSupabase().from("site_settings").select("value").eq("key", "genesis").maybeSingle();
  const value = {
    ...(prevRow?.value || {}),
    enabled: fd.get("enabled") === "on",
    model: String(fd.get("model") || "gpt-5.6-luna").trim(),
    model_complex: String(fd.get("model_complex") || "gpt-5.6-luna").trim(),
    deposit_amount: Number(fd.get("deposit_amount") || 20000),
    min_price: Number(fd.get("min_price") || 40000),
    payment_url: String(fd.get("payment_url") || "").trim(),
    timezone: "America/Santiago",
    slot_hours: String(fd.get("slot_hours") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    workdays: fd
      .getAll("wd")
      .map((n) => Number(n))
      .filter((n) => n >= 0 && n <= 6),
    system_prompt: String(fd.get("system_prompt") || "").trim(),
  };
  if (!value.workdays.length) value.workdays = [1, 2, 3, 4, 5, 6];
  await requireSupabase().from("site_settings").upsert({ key: "genesis", value });
  const ok = $("[data-genesis-ok]");
  if (ok) {
    ok.hidden = false;
    setTimeout(() => {
      ok.hidden = true;
    }, 2000);
  }
});

async function loadGenesis() {
  const rows = await safeSelect("chat_conversations", "*", (q) => q.order("updated_at", { ascending: false }).limit(100));
  const body = $("[data-genesis-body]");
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">Aún no hay conversaciones Genesis.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((c) => {
      const answers = c.answers || {};
      return `<tr>
        <td><strong>${escapeHtml(c.visitor_name || answers.tutor_name || "Visitante")}</strong><br><small>${escapeHtml(answers.phone || answers.email || c.session_id || "")}</small></td>
        <td><span class="badge ${c.status || "activa"}">${escapeHtml(c.status || "activa")}</span></td>
        <td>${Number(c.current_step || 0) + 1}</td>
        <td>${escapeHtml(answers.pet_name || answers.pet_type || "—")}<br><small>${escapeHtml((answers.consultation_reason || "").slice(0, 80))}</small></td>
        <td>${formatDate(c.updated_at || c.created_at)}</td>
        <td class="entity-actions"><button class="btn btn-ghost" data-view-chat="${c.id}">Ver ficha</button></td>
      </tr>`;
    })
    .join("");
  body.querySelectorAll("[data-view-chat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows.find((x) => x.id === btn.dataset.viewChat);
      if (row) openGenesisModal(row);
    });
  });
}

function openGenesisModal(row) {
  const answers = row.answers || {};
  const fields = Object.entries({
    Estado: row.status,
    Visitante: row.visitor_name || answers.tutor_name,
    Email: answers.email,
    Teléfono: answers.phone,
    Dirección: answers.address,
    Mascota: answers.pet_name,
    Tipo: answers.pet_type,
    Edad: answers.pet_age,
    Motivo: answers.consultation_reason,
    Paso: row.current_step,
    Actualizado: formatDate(row.updated_at),
  });
  openModal({
    title: "Chat Genesis",
    fields: `<div class="detail-view">${fields
      .map(
        ([label, value]) =>
          `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value ?? "—")}</span></div>`
      )
      .join("")}</div>`,
    onSave: async () => {},
  });
}

async function loadIntakes() {
  const rows = await safeSelect("intake_forms", "*", (q) => q.order("created_at", { ascending: false }).limit(100));
  const body = $("[data-intakes-body]");
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No hay cuestionarios pre-consulta todavía.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (f) => `<tr>
        <td><strong>${escapeHtml(f.patient_name || f.raw_answers?.pet_name || "—")}</strong></td>
        <td>${escapeHtml(f.email || f.raw_answers?.tutor_name || "—")}</td>
        <td>${escapeHtml((f.consultation_reason || "").slice(0, 90) || "—")}</td>
        <td><span class="badge ${f.completed ? "completada" : "pendiente"}">${f.completed ? "completo" : "incompleto"}</span></td>
        <td>${formatDate(f.created_at)}</td>
        <td class="entity-actions"><button class="btn btn-ghost" data-view-intake="${f.id}">Ver ficha</button></td>
      </tr>`
    )
    .join("");
  body.querySelectorAll("[data-view-intake]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows.find((x) => x.id === btn.dataset.viewIntake);
      if (row) openIntakeModal(row);
    });
  });
}

function openIntakeModal(row) {
  const raw = row.raw_answers || {};
  const fields = [
    ["Paciente", row.patient_name],
    ["Correo", row.email],
    ["Dirección", row.address],
    ["Tutor", row.tutor_info || raw.tutor_name],
    ["Datos del paciente", row.patient_data],
    ["Para qué la tiene", row.pet_purpose],
    ["Esterilizado", row.is_neutered],
    ["Última visita vet", row.last_vet_visit],
    ["Vacunas", row.vaccines_status],
    ["Diagnósticos", row.diagnosed_conditions],
    ["Hogar", row.household_members],
    ["Historia", row.pet_history],
    ["Motivo", row.consultation_reason],
    ["Cuándo ocurre", row.behavior_timing],
    ["Etólogo previo", row.previous_ethologist],
    ["Órdenes conocidas", row.known_commands],
    ["Qué ya intentaron", row.attempted_solutions],
    ["Cambios de vida", row.life_changes],
    ["Vivienda", row.housing_info],
    ["Adopción pandemia", row.pandemic_adoption],
  ];
  openModal({
    title: `Cuestionario · ${row.patient_name || "Paciente"}`,
    fields: `<div class="detail-view">${fields
      .map(
        ([label, value]) =>
          `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value || "—")}</span></div>`
      )
      .join("")}</div>`,
    onSave: async () => {},
  });
}

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

$$("[data-open-lead]").forEach((btn) => {
  btn.addEventListener("click", () => {
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
          <option value="calificado">calificado</option>
          <option value="agendado">agendado</option>
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
        source: "admin",
        metadata: { notes: String(fd.get("notes") || "").trim() || null },
      };
      await requireSupabase().from("leads").insert(payload);
      await loadLeads();
    },
  });
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
              ${CLIENT_STATUSES
                .map((s) => `<option value="${s}" ${client.status === s ? "selected" : ""}>${s.replaceAll("_", " ")}</option>`)
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
          ${CLIENT_STATUSES.map((s) => `<option value="${s}" ${s === "lead" ? "selected" : ""}>${s.replaceAll("_", " ")}</option>`).join("")}
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
        pet_type: ["perro", "gato", "otro"].includes(String(fd.get("pet_type") || "").trim().toLowerCase())
          ? String(fd.get("pet_type") || "").trim().toLowerCase()
          : null,
        pet_breed: String(fd.get("pet_breed") || "").trim() || null,
        pet_age: String(fd.get("pet_age") || "").trim() || null,
        pet_weight: String(fd.get("pet_weight") || "").trim() || null,
        address: String(fd.get("address") || "").trim() || null,
        notes: String(fd.get("questionnaire_notes") || "").trim() || null,
        status: String(fd.get("status") || "lead"),
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
      <td><strong>${escapeHtml(clientName)}</strong><br><small>${escapeHtml(f.clients?.phone || "")}</small></td>
      <td>${escapeHtml(petName || "—")}</td>
      <td><span class="badge ${f.type || "general"}">${escapeHtml(f.type || "general")}</span></td>
      <td>${escapeHtml((f.content || "").slice(0, 80))}${(f.content || "").length > 80 ? "…" : ""}</td>
      <td>${formatDate(f.scheduled_at)}</td>
      <td><span class="badge ${f.completed ? "completada" : isOverdue ? "vencido" : "pendiente"}">${f.completed ? "completado" : isOverdue ? "vencido" : "pendiente"}</span></td>
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

$$("[data-open-followup]").forEach((btn) => {
  btn.addEventListener("click", () => openFollowupModal(null, null));
});

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
          ${["nota", "llamada", "whatsapp", "email", "control", "recordatorio"]
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
        type: String(fd.get("type") || "nota"),
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
      (s) => `<article class="entity-card entity-card--photo">
      <button type="button" class="entity-photo" data-change-service-image="${s.id}" title="Cambiar imagen">
        <img src="${escapeAttr(s.image_url || "")}" alt="${escapeAttr(s.title)}" />
        <span>Cambiar foto</span>
      </button>
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
  root.querySelectorAll("[data-change-service-image]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = data.find((x) => x.id === btn.dataset.changeServiceImage);
      if (s) {
        openMediaEditor({
          kind: "service",
          id: s.id,
          slot: s.id,
          title: s.title,
          url: s.image_url || "",
          alt_text: s.title,
          group: "services",
          where: `Servicio · ${s.section}`,
          aspect: "photo",
          raw: s,
        });
      }
    });
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
      <label>Notas de agenda <input name="calendly_url" value="${escapeAttr(row?.calendly_url || "")}" placeholder="Opcional" /></label>
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
      (z) => `<article class="entity-card entity-card--photo">
      <button type="button" class="entity-photo" data-change-zone-image="${z.id}" title="Cambiar imagen">
        <img src="${escapeAttr(z.image_url || "")}" alt="${escapeAttr(z.name)}" />
        <span>Cambiar foto</span>
      </button>
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
  zonesRoot.querySelectorAll("[data-change-zone-image]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const z = zones.find((x) => x.id === btn.dataset.changeZoneImage);
      if (z) {
        openMediaEditor({
          kind: "zone",
          id: z.id,
          slot: z.id,
          title: z.name,
          url: z.image_url || "",
          alt_text: z.name,
          group: "zones",
          where: "Zona de precio",
          aspect: "photo",
          raw: z,
        });
      }
    });
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
const MEDIA_GROUPS = [
  { id: "hero", label: "Carrusel de inicio", where: "Portada · slides del hero", aspect: "wide" },
  { id: "gallery", label: "Galería", where: "Sección “Así acompañamos…”", aspect: "square" },
  { id: "about", label: "Doctora", where: "Bloque Sobre Armonivet", aspect: "portrait" },
  { id: "banner", label: "Banners", where: "Banner intermedio de la web", aspect: "wide" },
  { id: "services", label: "Servicios y ofertas", where: "Tarjetas de consulta y servicios", aspect: "photo" },
  { id: "zones", label: "Zonas de precio", where: "Precios por comuna", aspect: "photo" },
];

const KNOWN_SLOTS = [
  { slot: "hero_1", group: "hero", title: "Hero 1 · slide principal" },
  { slot: "hero_2", group: "hero", title: "Hero 2" },
  { slot: "hero_3", group: "hero", title: "Hero 3" },
  { slot: "gallery_1", group: "gallery", title: "Galería 1" },
  { slot: "gallery_2", group: "gallery", title: "Galería 2" },
  { slot: "gallery_3", group: "gallery", title: "Galería 3" },
  { slot: "gallery_4", group: "gallery", title: "Galería 4" },
  { slot: "gallery_5", group: "gallery", title: "Galería 5" },
  { slot: "gallery_6", group: "gallery", title: "Galería 6" },
  { slot: "about_doctor", group: "about", title: "Foto Dra. Bárbara" },
  { slot: "mid_banner", group: "banner", title: "Banner medio" },
];

function slotGroup(slot) {
  if (String(slot).startsWith("hero")) return "hero";
  if (String(slot).startsWith("gallery")) return "gallery";
  if (String(slot).includes("doctor") || String(slot).includes("about")) return "about";
  if (String(slot).includes("banner")) return "banner";
  return "banner";
}

function mediaPreviewSrc(url) {
  if (!url) return "";
  if (url.startsWith("./") || url.startsWith("../")) {
    const base = `${window.location.origin}${window.location.pathname.replace(/admin(?:\/index\.html)?\/?$/, "")}`;
    return new URL(url, base.endsWith("/") ? base : `${base}/`).toString();
  }
  return url;
}

async function loadMedia() {
  const root = $("[data-media-grid]");
  if (!root) return;
  const client = requireSupabase();
  const [{ data: slots, error }, { data: services }, { data: zones }] = await Promise.all([
    client.from("site_media").select("*").order("slot"),
    client.from("services").select("id,title,image_url,section,active").order("sort_order"),
    client.from("pricing_zones").select("id,name,image_url,active").order("sort_order"),
  ]);
  if (error) {
    root.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    return;
  }

  const items = [];
  const slotMap = Object.fromEntries((slots || []).map((s) => [s.slot, s]));
  KNOWN_SLOTS.forEach((known) => {
    const row = slotMap[known.slot];
    const group = MEDIA_GROUPS.find((g) => g.id === known.group);
    items.push({
      kind: "slot",
      id: row?.id || known.slot,
      slot: known.slot,
      title: row?.title || known.title,
      url: row?.url || "",
      alt_text: row?.alt_text || "",
      group: known.group,
      where: group?.where || "",
      aspect: group?.aspect || "photo",
      missing: !row,
      raw: row,
    });
  });
  (slots || []).forEach((row) => {
    if (KNOWN_SLOTS.some((k) => k.slot === row.slot)) return;
    const groupId = slotGroup(row.slot);
    const group = MEDIA_GROUPS.find((g) => g.id === groupId);
    items.push({
      kind: "slot",
      id: row.id,
      slot: row.slot,
      title: row.title || row.slot,
      url: row.url,
      alt_text: row.alt_text || "",
      group: groupId,
      where: group?.where || "Web pública",
      aspect: group?.aspect || "photo",
      raw: row,
    });
  });
  (services || []).forEach((s) => {
    items.push({
      kind: "service",
      id: s.id,
      slot: s.id,
      title: s.title,
      url: s.image_url || "",
      alt_text: s.title,
      group: "services",
      where: `Servicio · ${s.section}${s.active === false ? " (oculto)" : ""}`,
      aspect: "photo",
      raw: s,
    });
  });
  (zones || []).forEach((z) => {
    items.push({
      kind: "zone",
      id: z.id,
      slot: z.id,
      title: z.name,
      url: z.image_url || "",
      alt_text: z.name,
      group: "zones",
      where: `Zona de precio${z.active === false ? " (oculta)" : ""}`,
      aspect: "photo",
      raw: z,
    });
  });
  state.mediaItems = items;
  await renderMediaStudio();
}

async function renderMediaStudio() {
  const root = $("[data-media-grid]");
  if (!root) return;
  const q = ($("[data-media-search]")?.value || "").trim().toLowerCase();
  const filter = state.mediaFilter || "all";
  const visible = state.mediaItems.filter((item) => {
    if (filter !== "all" && item.group !== filter) return false;
    if (!q) return true;
    return `${item.title} ${item.slot} ${item.where} ${item.alt_text}`.toLowerCase().includes(q);
  });

  const groups = MEDIA_GROUPS.filter((g) => visible.some((i) => i.group === g.id));
  if (!groups.length) {
    root.innerHTML = `<p class="empty">No hay imágenes en este filtro.</p>`;
    return;
  }

  root.innerHTML = groups
    .map((group) => {
      const cards = visible
        .filter((i) => i.group === group.id)
        .map((item) => {
          const src = mediaPreviewSrc(item.url);
          return `<article class="media-card media-card--${item.aspect}" data-media-id="${escapeAttr(String(item.id))}" data-media-kind="${item.kind}">
            <button type="button" class="media-preview" data-media-zoom="${escapeAttr(String(item.id))}" aria-label="Ver grande">
              ${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(item.alt_text || item.title)}" />` : `<span class="media-placeholder">Sin imagen</span>`}
              <span class="media-chip">${escapeHtml(group.label)}</span>
            </button>
            <div class="body">
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.where)}${item.slot && item.kind === "slot" ? ` · ${escapeHtml(item.slot)}` : ""}</small>
              <div class="media-actions">
                <label class="btn btn-primary btn-file">
                  Subir archivo
                  <input type="file" accept="image/*" data-upload-item="${escapeAttr(`${item.kind}:${item.id}`)}" />
                </label>
                <button type="button" class="btn btn-ghost" data-edit-item="${escapeAttr(`${item.kind}:${item.id}`)}">Editar</button>
                ${src ? `<button type="button" class="btn btn-ghost" data-copy-url="${escapeAttr(src)}">Copiar URL</button>` : ""}
              </div>
            </div>
          </article>`;
        })
        .join("");
      return `<section class="media-group"><header><h3>${escapeHtml(group.label)}</h3><p>${escapeHtml(group.where)}</p></header><div class="media-grid">${cards}</div></section>`;
    })
    .join("");

  bindMediaStudio(root);
  checkMediaBucket();
}

function findMediaItem(kind, id) {
  return state.mediaItems.find((i) => i.kind === kind && String(i.id) === String(id));
}

function parseMediaKey(value) {
  const [kind, ...rest] = String(value || "").split(":");
  return { kind, id: rest.join(":") };
}

function bindMediaStudio(root) {
  root.querySelectorAll("[data-upload-item]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      const { kind, id } = parseMediaKey(input.dataset.uploadItem);
      const item = findMediaItem(kind, id);
      if (!file || !item) return;
      try {
        await saveMediaFile(item, file);
      } catch (err) {
        alert(err.message || "No se pudo subir la imagen");
      }
    });
  });
  root.querySelectorAll("[data-edit-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { kind, id } = parseMediaKey(btn.dataset.editItem);
      const item = findMediaItem(kind, id);
      if (item) openMediaEditor(item);
    });
  });
  root.querySelectorAll("[data-media-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.mediaItems.find((i) => String(i.id) === String(btn.dataset.mediaZoom));
      if (item?.url) openLightbox(item);
    });
  });
  root.querySelectorAll("[data-copy-url]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyUrl);
        btn.textContent = "Copiada";
        setTimeout(() => {
          btn.textContent = "Copiar URL";
        }, 1200);
      } catch {
        prompt("URL de la imagen", btn.dataset.copyUrl);
      }
    });
  });
  root.querySelectorAll(".media-card").forEach((card) => {
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("is-drop");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop"));
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.classList.remove("is-drop");
      const file = e.dataTransfer?.files?.[0];
      const item = findMediaItem(card.dataset.mediaKind, card.dataset.mediaId);
      if (!file || !item) return;
      try {
        await saveMediaFile(item, file);
      } catch (err) {
        alert(err.message || "No se pudo subir la imagen");
      }
    });
  });
}

async function checkMediaBucket() {
  const el = $("[data-media-status]");
  if (!el) return;
  try {
    const { error } = await requireSupabase().storage.getBucket("site-images");
    if (error && /not found|NoSuchBucket/i.test(`${error.message} ${error.error || ""}`)) {
      el.hidden = false;
      el.className = "media-status is-warn";
      el.innerHTML = `No se encontró el bucket <code>site-images</code>. Podés pegar una URL; subir archivo puede fallar.`;
      return;
    }
    el.hidden = true;
  } catch {
    el.hidden = true;
  }
}

async function refreshAfterMedia() {
  if (state.section === "services") return loadServices();
  if (state.section === "pricing") return loadPricing();
  return loadMedia();
}

async function saveMediaFile(item, file) {
  const folder = item.kind === "service" ? "services" : item.kind === "zone" ? "zones" : "site";
  const name = item.slot || item.id;
  const url = await uploadImage(file, `${folder}/${name}-${Date.now()}-${file.name}`);
  await persistMediaUrl(item, url, item.title, item.alt_text);
  await refreshAfterMedia();
}

async function persistMediaUrl(item, url, title, altText) {
  const client = requireSupabase();
  if (item.kind === "service") {
    const { error } = await client.from("services").update({ image_url: url }).eq("id", item.id);
    if (error) throw error;
    return;
  }
  if (item.kind === "zone") {
    const { error } = await client.from("pricing_zones").update({ image_url: url }).eq("id", item.id);
    if (error) throw error;
    return;
  }
  if (item.missing || !item.raw?.id) {
    const { error } = await client.from("site_media").insert({
      slot: item.slot,
      title: title || item.title,
      url,
      alt_text: altText || null,
    });
    if (error) throw error;
    return;
  }
  const { error } = await client
    .from("site_media")
    .update({ url, title: title || item.title, alt_text: altText || null })
    .eq("id", item.raw.id);
  if (error) throw error;
}

function openMediaEditor(item) {
  const src = mediaPreviewSrc(item.url);
  openModal({
    title: `Imagen · ${item.title}`,
    wide: true,
    fields: `
      <div class="media-editor">
        <div class="media-editor-preview">
          ${src ? `<img data-media-live-preview src="${escapeAttr(src)}" alt="" />` : `<div class="media-placeholder" data-media-live-preview>Sin imagen todavía</div>`}
          <p class="media-drop-hint">Arrastrá una foto aquí o usá los campos de la derecha.</p>
        </div>
        <div class="media-editor-fields">
          <p class="media-where">${escapeHtml(item.where)}</p>
          <label>Título <input name="title" value="${escapeAttr(item.title || "")}" /></label>
          <label>Texto alternativo (accesibilidad)
            <input name="alt_text" value="${escapeAttr(item.alt_text || "")}" placeholder="Describe la foto" />
          </label>
          <label>URL de la imagen
            <input name="url" data-media-url-input value="${escapeAttr(item.url || "")}" placeholder="https://… o subí un archivo" />
          </label>
          <label class="btn btn-primary btn-file">
            Elegir archivo del computador
            <input type="file" name="image_file" accept="image/*" data-media-file />
          </label>
          <div class="btn-row">
            ${item.url ? `<a class="btn btn-ghost" href="${escapeAttr(src)}" target="_blank" rel="noopener">Abrir original</a>` : ""}
            ${item.kind === "service" ? `<button type="button" class="btn btn-ghost" data-goto="services" value="cancel">Ir a servicios</button>` : ""}
            ${item.kind === "zone" ? `<button type="button" class="btn btn-ghost" data-goto="pricing" value="cancel">Ir a precios</button>` : ""}
          </div>
        </div>
      </div>
    `,
    onSave: async (fd) => {
      const file = fd.get("image_file");
      let url = String(fd.get("url") || "").trim();
      const title = String(fd.get("title") || "").trim() || item.title;
      const altText = String(fd.get("alt_text") || "").trim();
      if (file && file.size) {
        const folder = item.kind === "service" ? "services" : item.kind === "zone" ? "zones" : "site";
        url = await uploadImage(file, `${folder}/${item.slot || item.id}-${Date.now()}-${file.name}`);
      }
      if (!url) throw new Error("Agrega una URL o sube un archivo");
      await persistMediaUrl(item, url, title, altText);
      await refreshAfterMedia();
    },
    afterOpen: () => {
      const pane = $(".media-editor-preview");
      const urlInput = $("[data-media-url-input]");
      const fileInput = $("[data-media-file]");
      const setPreview = (next) => {
        if (!next || !pane) return;
        let img = pane.querySelector("img[data-media-live-preview]");
        if (!img) {
          img = document.createElement("img");
          img.dataset.mediaLivePreview = "";
          pane.querySelector("[data-media-live-preview]")?.replaceWith(img);
          if (!img.isConnected) pane.prepend(img);
        }
        img.src = next;
      };
      urlInput?.addEventListener("input", () => setPreview(urlInput.value.trim()));
      fileInput?.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) setPreview(URL.createObjectURL(file));
      });
      pane?.addEventListener("dragover", (e) => {
        e.preventDefault();
        pane.classList.add("is-drop");
      });
      pane?.addEventListener("dragleave", () => pane.classList.remove("is-drop"));
      pane?.addEventListener("drop", (e) => {
        e.preventDefault();
        pane.classList.remove("is-drop");
        const file = e.dataTransfer?.files?.[0];
        if (!file || !fileInput) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        setPreview(URL.createObjectURL(file));
      });
    },
  });
}

function openLightbox(item) {
  const box = $("[data-lightbox]");
  if (!box) return;
  $("[data-lightbox-img]").src = mediaPreviewSrc(item.url);
  $("[data-lightbox-caption]").textContent = `${item.title} · ${item.where}`;
  box.showModal();
}

$("[data-lightbox-close]")?.addEventListener("click", () => $("[data-lightbox]")?.close());
$("[data-lightbox]")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

$$("[data-media-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.mediaFilter = btn.dataset.mediaFilter || "all";
    $$("[data-media-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderMediaStudio();
  });
});

$("[data-media-search]")?.addEventListener("input", () => {
  clearTimeout(state._mediaSearch);
  state._mediaSearch = setTimeout(() => renderMediaStudio(), 180);
});
$("[data-media-refresh]")?.addEventListener("click", () => loadMedia());

$("[data-open-media-slot]")?.addEventListener("click", () => {
  openModal({
    title: "Nuevo espacio de imagen",
    fields: `
      <label>Nombre interno (slot)
        <input name="slot" required placeholder="gallery_7 o instagram_1" />
      </label>
      <label>Título <input name="title" required placeholder="Foto para…" /></label>
      <label>Texto alternativo <input name="alt_text" /></label>
      <label>URL <input name="url" placeholder="https://…" /></label>
      <label>Subir archivo <input type="file" name="image_file" accept="image/*" /></label>
      <p class="empty">Los slots conocidos (hero_1, gallery_1…) aparecen solos en la web. Un slot nuevo se guarda y podés usarlo después.</p>
    `,
    onSave: async (fd) => {
      let url = String(fd.get("url") || "").trim();
      const file = fd.get("image_file");
      const slot = String(fd.get("slot") || "").trim().toLowerCase().replace(/\s+/g, "_");
      if (file && file.size) url = await uploadImage(file, `site/${slot}-${Date.now()}-${file.name}`);
      if (!url) throw new Error("Agrega una URL o sube un archivo");
      const { error } = await requireSupabase().from("site_media").insert({
        slot,
        title: String(fd.get("title") || "").trim(),
        url,
        alt_text: String(fd.get("alt_text") || "").trim() || null,
      });
      if (error) throw error;
      await loadMedia();
    },
  });
});

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

function closeModal() {
  const modal = $("[data-modal]");
  if (modal?.open) modal.close();
  modalSaveHandler = null;
  const saveBtn = $("[data-modal-save]");
  if (saveBtn) saveBtn.textContent = "Guardar";
}

function openModal({ title, fields, onSave, wide = false, afterOpen, saveLabel }) {
  const modal = $("[data-modal]");
  modal.classList.toggle("is-wide", Boolean(wide));
  $("[data-modal-title]").textContent = title;
  $("[data-modal-body]").innerHTML = fields;
  const saveBtn = $("[data-modal-save]");
  if (saveBtn) saveBtn.textContent = saveLabel || "Guardar";
  modalSaveHandler = onSave;
  modal.showModal();
  afterOpen?.();
}

$("[data-modal]")?.addEventListener("click", (e) => {
  if (e.target.closest("[data-modal-cancel]")) {
    e.preventDefault();
    closeModal();
  }
});

$("[data-modal]")?.addEventListener("cancel", () => {
  modalSaveHandler = null;
  const saveBtn = $("[data-modal-save]");
  if (saveBtn) saveBtn.textContent = "Guardar";
});

$("[data-modal-form]")?.addEventListener("submit", async (e) => {
  const submitter = e.submitter;
  const value = submitter?.value || "cancel";
  if (value !== "save") {
    e.preventDefault();
    closeModal();
    return;
  }
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  try {
    if (modalSaveHandler) await modalSaveHandler(fd);
    closeModal();
  } catch (err) {
    alert(err.message || "No se pudo guardar");
  }
});

async function uploadImage(file, path) {
  if (!file) throw new Error("No hay archivo");
  if (!String(file.type || "").startsWith("image/")) throw new Error("El archivo no es una imagen");
  if (file.size > 8 * 1024 * 1024) throw new Error("La imagen supera 8 MB. Subí una más liviana.");
  const client = requireSupabase();
  const clean = path.replace(/[^a-zA-Z0-9._/-]/g, "-");
  const { error } = await client.storage.from("site-images").upload(clean, file, {
    upsert: true,
    cacheControl: "3600",
    contentType: file.type || "image/jpeg",
  });
  if (error) {
    const msg = error.message || "No se pudo subir";
    if (/bucket|not found/i.test(msg)) {
      throw new Error("Falta el bucket site-images en Supabase Storage.");
    }
    throw new Error(msg);
  }
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
      goToLogin();
    }
  });
}

boot();
