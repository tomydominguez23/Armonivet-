// =============================================================================
// Génesis como asistente de la doctora.
//
// Si el que escribe al WhatsApp de Armonivet es un número de GENESIS_ADMIN_PHONES
// (secreto de Supabase), Génesis no lo trata como cliente: responde como
// asistente interna, con herramientas para consultar agenda, ingresos, fichas
// y chats, y para escribirle a un cliente. Todo envío a un cliente pasa por una
// confirmación explícita ("sí") que se resuelve en código, no en el modelo.
//
// También manda avisos a esos números: reserva pagada y chat derivado a humano.
// Tablas: supabase/genesis_admin.sql.
// =============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { outputText, resolveModel, runOpenAI, type GenesisTool } from "./openai.ts";
import { sendWhatsAppText, toWazendChatId, wazendDestination, wazendPhoneForLid } from "./whatsapp.ts";
import { normalizePhone } from "./supabase.ts";

const TZ = "America/Santiago";
const CONFIRM_WINDOW_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Quién es admin
// ---------------------------------------------------------------------------

/** Normaliza a dígitos con código de país; acepta "+56 9 1234 5678" o "912345678". */
export function normalizeAdminPhone(raw: string) {
  let digits = normalizePhone(raw);
  if (digits.length === 9 && digits.startsWith("9")) digits = `56${digits}`;
  if (digits.length === 8) digits = `569${digits}`;
  return digits;
}

export function adminPhones() {
  return String(Deno.env.get("GENESIS_ADMIN_PHONES") || "")
    .split(/[,;\n]+/)
    .map(normalizeAdminPhone)
    .filter((p) => p.length >= 8);
}

type InboundMsg = { from: string; aliasPhone?: string; chatId?: string; name?: string; id?: string; text: string };

const lidCache = new Map<string, string>();

/** Devuelve el teléfono admin si el mensaje viene de la doctora; si no, "". */
export async function matchAdminSender(msg: InboundMsg) {
  const admins = adminPhones();
  if (!admins.length) return "";
  const candidates = [msg.from, msg.aliasPhone, String(msg.chatId || "").split("@")[0]]
    .map((v) => normalizePhone(v))
    .filter(Boolean);
  const direct = candidates.find((c) => admins.includes(c));
  if (direct) return direct;

  // WhatsApp a veces identifica al remitente solo con su ID interno (@lid).
  // Wazend lo traduce a número; se guarda en memoria para no repetir la consulta.
  const chatId = String(msg.chatId || "");
  if (!chatId.endsWith("@lid")) return "";
  if (!lidCache.has(chatId)) lidCache.set(chatId, await wazendPhoneForLid(chatId));
  const phone = lidCache.get(chatId) || "";
  return admins.includes(phone) ? phone : "";
}

// ---------------------------------------------------------------------------
// Utilidades de fecha (Chile) y formato
// ---------------------------------------------------------------------------

function chileDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Inicio del día YYYY-MM-DD en Chile, como instante UTC (maneja horario de verano). */
export function chileDayStart(day: string) {
  for (const offset of ["-03:00", "-04:00", "-05:00"]) {
    const candidate = new Date(`${day}T00:00:00${offset}`);
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(candidate);
    if (chileDateKey(candidate) === day && hour === "00") return candidate;
  }
  return new Date(`${day}T00:00:00-03:00`);
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function validDay(raw: unknown) {
  const value = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** Rango [desde, hasta] inclusive en días de Chile; por defecto el mes en curso. */
function dayRange(args: Record<string, unknown>, fallback: "month" | "week") {
  const today = chileDateKey(new Date());
  let from = validDay(args.desde);
  let to = validDay(args.hasta);
  if (!from) from = fallback === "month" ? `${today.slice(0, 7)}-01` : today;
  if (!to) to = fallback === "month" ? today : addDays(from, 6);
  if (to < from) [from, to] = [to, from];
  return { from, to, start: chileDayStart(from).toISOString(), end: chileDayStart(addDays(to, 1)).toISOString() };
}

function formatWhen(iso: unknown) {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatCLP(amount: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
}

function plain(text: string) {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2").replace(/\*\*/g, "").trim();
}

function filled(record: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(
    Object.entries(record || {}).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)),
  );
}

function isPaidAppt(a: Record<string, unknown>) {
  return a.deposit_paid === true || ["abonada", "llegó", "completada"].includes(String(a.status || ""));
}

// ---------------------------------------------------------------------------
// Mensajes con la doctora
// ---------------------------------------------------------------------------

async function logAdminMessage(
  db: SupabaseClient,
  adminPhone: string,
  direction: "in" | "out",
  content: string,
  waMessageId?: string,
) {
  const { error } = await db.from("genesis_admin_messages").insert({
    admin_phone: adminPhone,
    direction,
    content,
    wa_message_id: waMessageId || null,
  });
  if (error && /duplicate|unique/i.test(error.message || "")) return { duplicate: true };
  if (error) throw error;
  return { duplicate: false };
}

async function replyToAdmin(db: SupabaseClient, adminPhone: string, chatId: string, text: string) {
  const body = plain(text);
  const sent = await sendWhatsAppText(chatId || toWazendChatId(adminPhone), body);
  await logAdminMessage(db, adminPhone, "out", sent.ok ? body : `[no salió: ${sent.error || "error"}] ${body}`);
  return sent;
}

/** Aviso a todos los números de la doctora. Nunca corta el flujo que lo llama. */
export async function notifyOwner(db: SupabaseClient, text: string) {
  const phones = adminPhones();
  for (const phone of phones) {
    try {
      await replyToAdmin(db, phone, toWazendChatId(phone), text);
    } catch (err) {
      console.warn("[admin notify]", err instanceof Error ? err.message : err);
    }
  }
  return phones.length;
}

/** Aviso de reserva pagada, una sola vez por pago (payments.owner_notified_at). */
export async function notifyPaidBooking(db: SupabaseClient, paymentId: string, appointmentId: string, amount: number) {
  if (!adminPhones().length) return;
  try {
    const claimedAt = new Date().toISOString();
    const { data: claimed, error } = await db
      .from("payments")
      .update({ owner_notified_at: claimedAt })
      .eq("id", paymentId)
      .is("owner_notified_at", null)
      .select("id")
      .maybeSingle();
    if (error || !claimed) return;
    const { data: appt } = await db
      .from("appointments")
      .select("client_name, client_phone, pet_name, pet_type, service_title, scheduled_at")
      .eq("id", appointmentId)
      .maybeSingle();
    const lines = [
      "Nueva reserva pagada ✅",
      [appt?.client_name, appt?.client_phone ? `+${normalizePhone(appt.client_phone)}` : ""].filter(Boolean).join(" · "),
      appt?.pet_name ? `Paciente: ${appt.pet_name}${appt.pet_type ? ` (${appt.pet_type})` : ""}` : "",
      appt?.service_title ? `Servicio: ${appt.service_title}` : "",
      appt?.scheduled_at ? `Hora: ${formatWhen(appt.scheduled_at)}` : "",
      amount > 0 ? `Pagó: ${formatCLP(amount)}` : "",
    ].filter(Boolean);
    await notifyOwner(db, lines.join("\n"));
  } catch (err) {
    console.warn("[admin notify booking]", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Herramientas del modo asistente
// ---------------------------------------------------------------------------

const rangeParams = {
  type: "object",
  properties: {
    desde: { type: "string", description: "YYYY-MM-DD en hora de Chile, o vacío" },
    hasta: { type: "string", description: "YYYY-MM-DD en hora de Chile (inclusive), o vacío" },
  },
  required: ["desde", "hasta"],
  additionalProperties: false,
};

export const ADMIN_TOOLS: GenesisTool[] = [
  {
    type: "function",
    name: "resumen_ingresos",
    description:
      "Ingresos en un rango de días. Devuelve lo cobrado (pagos acreditados por fecha de pago) y las consultas pagadas por fecha de la cita. Sin fechas usa el mes en curso.",
    parameters: rangeParams,
    strict: true,
  },
  {
    type: "function",
    name: "agenda",
    description: "Citas no canceladas en un rango de días, con cliente, paciente, servicio, estado y si está pagada. Sin fechas usa hoy y los 6 días siguientes.",
    parameters: rangeParams,
    strict: true,
  },
  {
    type: "function",
    name: "buscar_cliente",
    description: "Busca clientes por nombre, teléfono, correo o nombre de la mascota. Devuelve id para usar en ficha_cliente o preparar_mensaje.",
    parameters: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "ficha_cliente",
    description: "Ficha completa de un cliente: datos, mascota, formulario previo, citas, pagos y últimos mensajes de WhatsApp.",
    parameters: {
      type: "object",
      properties: { cliente_id: { type: "string" } },
      required: ["cliente_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "chats_pendientes",
    description: "Chats de WhatsApp que esperan respuesta o que Génesis derivó a la doctora (últimos 7 días).",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "preparar_mensaje",
    description:
      "Deja listo un mensaje de WhatsApp para un cliente, SIN enviarlo. Se envía solo si la doctora responde SÍ. Usa cliente_id si lo tienes; si no, telefono. El mensaje va tal cual al cliente.",
    parameters: {
      type: "object",
      properties: {
        cliente_id: { type: "string", description: "id del cliente o vacío" },
        telefono: { type: "string", description: "teléfono con código de país o vacío" },
        mensaje: { type: "string" },
      },
      required: ["cliente_id", "telefono", "mensaje"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function toolResumenIngresos(db: SupabaseClient, args: Record<string, unknown>) {
  const r = dayRange(args, "month");
  const [{ data: payments }, { data: appts }] = await Promise.all([
    db.from("payments").select("id,amount,kind,paid_at,appointment_id").eq("status", "pagado")
      .gte("paid_at", r.start).lt("paid_at", r.end).limit(2000),
    db.from("appointments").select("id,amount,status,deposit_paid,scheduled_at,client_name,service_title")
      .gte("scheduled_at", r.start).lt("scheduled_at", r.end).limit(2000),
  ]);
  const paid = payments || [];
  const cobrado = paid.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paidAppts = (appts || []).filter((a) => isPaidAppt(a));
  const consultas = paidAppts.reduce((sum, a) => sum + Number(a.amount || 0), 0);
  return {
    desde: r.from,
    hasta: r.to,
    cobrado_total: cobrado,
    cobrado_texto: formatCLP(cobrado),
    cantidad_pagos: paid.length,
    ticket_promedio: paid.length ? formatCLP(Math.round(cobrado / paid.length)) : null,
    consultas_pagadas_en_el_periodo: paidAppts.length,
    valor_consultas_pagadas: formatCLP(consultas),
    citas_sin_pagar: (appts || []).filter((a) => !isPaidAppt(a) && a.status !== "cancelada").length,
    nota: "cobrado = pagos acreditados con fecha de pago en el rango. consultas = citas del rango que están pagadas.",
  };
}

async function toolAgenda(db: SupabaseClient, args: Record<string, unknown>) {
  const r = dayRange(args, "week");
  const { data } = await db
    .from("appointments")
    .select("id,scheduled_at,client_id,client_name,client_phone,pet_name,service_title,status,deposit_paid,amount")
    .gte("scheduled_at", r.start)
    .lt("scheduled_at", r.end)
    .neq("status", "cancelada")
    .order("scheduled_at", { ascending: true })
    .limit(60);
  return {
    desde: r.from,
    hasta: r.to,
    total: (data || []).length,
    citas: (data || []).map((a) => ({
      cuando: formatWhen(a.scheduled_at),
      cliente: a.client_name,
      cliente_id: a.client_id,
      telefono: a.client_phone,
      paciente: a.pet_name,
      servicio: a.service_title,
      estado: a.status,
      pagada: isPaidAppt(a),
      monto: a.amount ? formatCLP(Number(a.amount)) : null,
    })),
  };
}

async function toolBuscarCliente(db: SupabaseClient, args: Record<string, unknown>) {
  // Se sacan los caracteres que rompen el filtro or() de PostgREST.
  const q = String(args.texto || "").replace(/[,()*%"'\\]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return { error: "Escribe al menos 2 letras o números para buscar." };
  const digits = normalizePhone(q);
  const filters = [`name.ilike.%${q}%`, `pet_name.ilike.%${q}%`, `email.ilike.%${q}%`];
  if (digits.length >= 4) filters.push(`phone.ilike.%${digits.slice(-8)}%`);
  const { data } = await db
    .from("clients")
    .select("id,name,phone,email,pet_name,pet_type,status,last_contact_at")
    .or(filters.join(","))
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .limit(8);
  return { encontrados: (data || []).length, clientes: (data || []).map((c) => filled(c)) };
}

async function toolFichaCliente(db: SupabaseClient, args: Record<string, unknown>) {
  const id = String(args.cliente_id || "");
  const { data: client } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) return { error: "No encontré ese cliente. Búscalo primero con buscar_cliente." };
  const [{ data: intake }, { data: appts }, { data: payments }, { data: conv }] = await Promise.all([
    db.from("intake_forms").select("raw_answers,created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("appointments").select("scheduled_at,service_title,status,deposit_paid,amount").eq("client_id", id).order("scheduled_at", { ascending: false }).limit(10),
    db.from("payments").select("amount,status,kind,paid_at").eq("client_id", id).order("created_at", { ascending: false }).limit(10),
    db.from("wa_conversations").select("id,status,pipeline,last_message_at").eq("client_id", id).order("last_message_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let mensajes: unknown[] = [];
  if (conv?.id) {
    const { data: msgs } = await db
      .from("wa_messages")
      .select("author,content,created_at")
      .eq("conversation_id", conv.id)
      .neq("author", "sistema")
      .order("created_at", { ascending: false })
      .limit(10);
    mensajes = (msgs || []).reverse().map((m) => ({ quien: m.author, cuando: formatWhen(m.created_at), texto: String(m.content || "").slice(0, 300) }));
  }
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = client as Record<string, unknown>;
  return {
    cliente_id: id,
    datos: filled(rest),
    formulario_previo: intake?.raw_answers || null,
    citas: (appts || []).map((a) => ({ cuando: formatWhen(a.scheduled_at), servicio: a.service_title, estado: a.status, pagada: isPaidAppt(a), monto: a.amount })),
    pagos: (payments || []).map((p) => ({ monto: p.amount, estado: p.status, tipo: p.kind, pagado: formatWhen(p.paid_at) })),
    whatsapp: conv ? { estado: conv.status, etapa: conv.pipeline, ultimos_mensajes: mensajes } : null,
  };
}

async function toolChatsPendientes(db: SupabaseClient) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await db
    .from("wa_conversations")
    .select("id,client_id,wa_name,wa_phone,status,assigned_to,pipeline,last_inbound_at,last_outbound_at")
    .gte("last_inbound_at", since)
    .order("last_inbound_at", { ascending: false })
    .limit(40);
  const pending = (data || []).filter((c) =>
    c.assigned_to === "humano" || c.status === "pausada_humano" || c.pipeline === "derivado_humano" ||
    !c.last_outbound_at || String(c.last_outbound_at) < String(c.last_inbound_at)
  );
  const result = [];
  for (const c of pending.slice(0, 12)) {
    const { data: last } = await db
      .from("wa_messages")
      .select("content")
      .eq("conversation_id", c.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    result.push({
      nombre: c.wa_name,
      telefono: c.wa_phone,
      cliente_id: c.client_id,
      motivo: c.assigned_to === "humano" || c.status === "pausada_humano" ? "derivado a la doctora" : "sin respuesta",
      ultimo_mensaje: String(last?.content || "").slice(0, 200),
      cuando: formatWhen(c.last_inbound_at),
    });
  }
  return { total: result.length, chats: result };
}

async function toolPrepararMensaje(db: SupabaseClient, adminPhone: string, args: Record<string, unknown>) {
  const text = String(args.mensaje || "").trim();
  if (!text) return { error: "Falta el texto del mensaje." };
  let client: Record<string, unknown> | null = null;
  const clientId = String(args.cliente_id || "").trim();
  if (clientId) {
    const { data } = await db.from("clients").select("id,name,phone,wa_phone").eq("id", clientId).maybeSingle();
    client = data;
    if (!client) return { error: "No encontré ese cliente. Búscalo con buscar_cliente." };
  }
  const phone = normalizeAdminPhone(String(client?.wa_phone || client?.phone || args.telefono || ""));
  let conv: Record<string, unknown> | null = null;
  if (client?.id) {
    const { data } = await db.from("wa_conversations").select("id,wa_phone,metadata,client_id").eq("client_id", client.id)
      .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
    conv = data;
  }
  if (!conv && phone) {
    const { data } = await db.from("wa_conversations").select("id,wa_phone,metadata,client_id").eq("wa_phone", phone).maybeSingle();
    conv = data;
  }
  if (!conv && phone.length < 10) return { error: "Ese cliente no tiene un teléfono válido para WhatsApp." };
  const to = conv ? wazendDestination(conv as { wa_phone?: string; metadata?: unknown }) : toWazendChatId(phone);
  const name = String(client?.name || "") || (phone ? `+${phone}` : "el cliente");

  // Un solo borrador vivo por número de la doctora.
  await db.from("genesis_admin_actions").update({ status: "cancelado", resolved_at: new Date().toISOString() })
    .eq("admin_phone", adminPhone).eq("status", "pendiente");
  const { data: action, error } = await db.from("genesis_admin_actions").insert({
    admin_phone: adminPhone,
    kind: "enviar_mensaje",
    payload: { to, name, phone, text, conversation_id: conv?.id || null, client_id: client?.id || conv?.client_id || null },
  }).select("id").single();
  if (error) throw error;
  return {
    borrador_id: action.id,
    para: name,
    telefono: phone ? `+${phone}` : to,
    mensaje: text,
    estado: "NO ENVIADO todavía",
    instruccion: "Muéstrale a quién va y el texto exacto, y pídele que responda SÍ para enviarlo o NO para cancelarlo.",
  };
}

async function executeAdminTool(db: SupabaseClient, adminPhone: string, name: string, args: Record<string, unknown>) {
  try {
    if (name === "resumen_ingresos") return await toolResumenIngresos(db, args);
    if (name === "agenda") return await toolAgenda(db, args);
    if (name === "buscar_cliente") return await toolBuscarCliente(db, args);
    if (name === "ficha_cliente") return await toolFichaCliente(db, args);
    if (name === "chats_pendientes") return await toolChatsPendientes(db);
    if (name === "preparar_mensaje") return await toolPrepararMensaje(db, adminPhone, args);
    return { error: `herramienta desconocida: ${name}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Confirmación SÍ / NO (en código: el modelo nunca envía a un cliente)
// ---------------------------------------------------------------------------

const YES = /^(s[ií]+|sip|dale|ok(ey|ay)?|okay|confirmo|confirmado|env[ií]a(lo)?|m[aá]nda(lo)?|perfecto|de acuerdo|listo)[\s.!👍✅]*$/i;
const NO = /^(no+|nop|cancela(r|lo)?|mejor no|no lo mandes|no env[ií]es)[\s.!]*$/i;

async function pendingAction(db: SupabaseClient, adminPhone: string) {
  const { data } = await db
    .from("genesis_admin_actions")
    .select("id,kind,payload,created_at")
    .eq("admin_phone", adminPhone)
    .eq("status", "pendiente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (Date.now() - Date.parse(String(data.created_at)) > CONFIRM_WINDOW_MS) return null;
  return data as { id: string; kind: string; payload: Record<string, unknown> };
}

async function sendDraftToClient(db: SupabaseClient, action: { id: string; payload: Record<string, unknown> }) {
  // Se reclama el borrador con un UPDATE condicionado: un reintento del webhook
  // o un "sí" doble no lo envían dos veces.
  const { data: claimed } = await db
    .from("genesis_admin_actions")
    .update({ status: "enviando", resolved_at: new Date().toISOString() })
    .eq("id", action.id)
    .eq("status", "pendiente")
    .select("id")
    .maybeSingle();
  if (!claimed) return "Ese mensaje ya se había procesado.";

  const p = action.payload;
  const text = String(p.text || "");
  const sent = await sendWhatsAppText(String(p.to || ""), text);
  await db.from("genesis_admin_actions").update({ status: sent.ok ? "enviado" : "error", result: sent }).eq("id", action.id);
  if (!sent.ok) return `No pude enviarle el mensaje a ${p.name}: ${sent.error || "error de WhatsApp"}.`;

  const now = new Date().toISOString();
  let conversationId = String(p.conversation_id || "");
  if (!conversationId && p.phone) {
    const { data: conv } = await db.from("wa_conversations").insert({
      client_id: p.client_id || null,
      wa_phone: String(p.phone),
      wa_name: String(p.name || ""),
      metadata: { wazend_chat_id: String(p.to || "") },
      last_message_at: now,
      last_outbound_at: now,
    }).select("id").single();
    conversationId = conv?.id || "";
  }
  if (conversationId) {
    await db.from("wa_messages").insert({
      conversation_id: conversationId,
      direction: "out",
      author: "humano",
      message_type: "text",
      content: text,
      payload: { via: "asistente_doctora", send: sent },
    });
    await db.from("wa_conversations").update({ last_message_at: now, last_outbound_at: now }).eq("id", conversationId);
  }
  return `Listo, se lo mandé a ${p.name}.`;
}

// ---------------------------------------------------------------------------
// Turno del asistente
// ---------------------------------------------------------------------------

function adminInstructions(pending: { payload: Record<string, unknown> } | null) {
  const today = new Intl.DateTimeFormat("es-CL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date());
  return [
    "Eres Génesis, la asistente personal de la Dra. Bárbara, dueña de Armonivet (etología clínica, entrenamiento canino y Flores de Bach). Estás hablando con ella por WhatsApp; no es una clienta.",
    `Hoy es ${today} (hora de Chile, fecha ${chileDateKey(new Date())}). Interpreta hoy, mañana, esta semana, este mes, etc. desde esa fecha y pasa las fechas como YYYY-MM-DD.`,
    "Responde breve y claro, en texto plano: sin asteriscos, negritas ni markdown. Listas cortas con guiones si ayudan. Montos en pesos chilenos.",
    "Usa siempre las herramientas para datos: agenda, ingresos, clientes, fichas y chats. Nunca inventes nombres, montos, horas ni antecedentes clínicos. Si una herramienta no trae algo, dilo.",
    "Para escribirle a un cliente: identifícalo (buscar_cliente; si hay más de uno posible, pregúntale cuál), redacta el mensaje en el tono cercano y profesional de Armonivet y llama preparar_mensaje. Nunca digas que lo enviaste: muéstrale a quién va y el texto exacto, y pídele que responda SÍ para enviarlo o NO para cancelarlo.",
    "Si te pide algo que tus herramientas no hacen (por ejemplo cambiar precios, crear citas o borrar datos), dile que eso se hace desde el panel de administración.",
    pending
      ? `Hay un mensaje esperando su confirmación para ${pending.payload.name}: "${pending.payload.text}". Si te pide cambiarlo, prepara uno nuevo con preparar_mensaje.`
      : "",
  ].filter(Boolean).join("\n\n");
}

export async function handleAdminMessage(db: SupabaseClient, adminPhone: string, msg: InboundMsg) {
  const chatId = String(msg.chatId || "").includes("@") ? String(msg.chatId) : toWazendChatId(adminPhone);
  const logged = await logAdminMessage(db, adminPhone, "in", msg.text, msg.id);
  if (logged.duplicate) return { admin: true, skipped: "duplicate" };

  try {
    const text = msg.text.trim();
    const pending = await pendingAction(db, adminPhone);
    if (pending && YES.test(text)) {
      const reply = await sendDraftToClient(db, pending);
      await replyToAdmin(db, adminPhone, chatId, reply);
      return { admin: true, action: "sent" };
    }
    if (pending && NO.test(text)) {
      await db.from("genesis_admin_actions").update({ status: "cancelado", resolved_at: new Date().toISOString() })
        .eq("id", pending.id).eq("status", "pendiente");
      await replyToAdmin(db, adminPhone, chatId, "Ok, no lo mando.");
      return { admin: true, action: "cancelled" };
    }

    const { data: history } = await db
      .from("genesis_admin_messages")
      .select("direction,content,created_at")
      .eq("admin_phone", adminPhone)
      .order("created_at", { ascending: false })
      .limit(20);
    const input: unknown[] = (history || [])
      .reverse()
      .filter((m) => m.content)
      .map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: String(m.content) }));

    const { data: settingsRow } = await db.from("site_settings").select("value").eq("key", "genesis").maybeSingle();
    const model = resolveModel((settingsRow?.value as { model?: string } | null)?.model);
    const instructions = adminInstructions(pending);
    let response = await runOpenAI({ model, instructions, input, tools: ADMIN_TOOLS });
    for (let loops = 0; loops < 6; loops++) {
      const calls = (response.output || []).filter((item: { type?: string }) => item.type === "function_call");
      if (!calls.length) break;
      input.push(...response.output);
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executeAdminTool(db, adminPhone, call.name, args);
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      }
      response = await runOpenAI({ model, instructions, input, tools: ADMIN_TOOLS });
    }
    const reply = outputText(response) || "Listo.";
    await replyToAdmin(db, adminPhone, chatId, reply);
    return { admin: true, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await replyToAdmin(db, adminPhone, chatId, `No pude responder eso: ${message}`).catch(() => {});
    return { admin: true, error: message };
  }
}
