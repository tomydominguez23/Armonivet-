import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { GENESIS_TOOLS, outputText, resolveModel, runOpenAI } from "./openai.ts";
import { sendWhatsAppText, wazendDestination } from "./whatsapp.ts";
import { normalizePhone } from "./supabase.ts";

type Settings = {
  enabled?: boolean;
  model?: string;
  model_complex?: string;
  deposit_amount?: number;
  min_price?: number;
  payment_url?: string;
  calendly_url?: string;
  timezone?: string;
  slot_hours?: string[];
  workdays?: number[];
  system_prompt?: string;
};

const PIPELINE = new Set([
  "nuevo",
  "contactado",
  "calificado",
  "quiere_agendar",
  "esperando_pago",
  "pagado",
  "agendado",
  "atendido",
  "seguimiento",
  "control",
  "no_responde",
  "cancelado",
  "perdido",
  "derivado_humano",
]);

export async function loadGenesisSettings(db: SupabaseClient): Promise<Settings> {
  const { data } = await db.from("site_settings").select("value").eq("key", "genesis").maybeSingle();
  return (data?.value || {}) as Settings;
}

export async function upsertInbound(db: SupabaseClient, input: {
  phone: string;
  aliasPhone?: string;
  chatId?: string;
  name?: string;
  text: string;
  waMessageId?: string;
  type?: string;
}) {
  const phone = normalizePhone(input.phone);
  const alias = normalizePhone(input.aliasPhone);
  if (!phone) throw new Error("Teléfono vacío");
  const chatMetadata = input.chatId ? { wazend_chat_id: input.chatId } : {};

  if (input.waMessageId) {
    const { data: existing } = await db
      .from("wa_messages")
      .select("id, conversation_id")
      .eq("wa_message_id", input.waMessageId)
      .maybeSingle();
    if (existing) return { conversationId: existing.conversation_id as string, duplicate: true };
  }

  let { data: client } = await db.from("clients").select("*").eq("wa_phone", phone).maybeSingle();
  if (!client && alias) {
    const { data: byAlias } = await db.from("clients").select("*").eq("wa_phone", alias).maybeSingle();
    client = byAlias;
  }
  if (!client) {
    const { data: byPhone } = await db.from("clients").select("*").eq("phone", phone).maybeSingle();
    client = byPhone;
  }
  if (!client && alias) {
    const { data: byAliasPhone } = await db.from("clients").select("*").eq("phone", alias).maybeSingle();
    client = byAliasPhone;
  }
  if (!client) {
    const { data: created, error } = await db
      .from("clients")
      .insert({
        name: input.name || "WhatsApp",
        phone,
        wa_phone: phone,
        wa_name: input.name || null,
        status: "lead",
        channel_slug: "whatsapp",
      })
      .select("*")
      .single();
    if (error) throw error;
    client = created;
  } else if (!client.wa_phone || client.wa_phone === alias) {
    await db.from("clients").update({ phone, wa_phone: phone, wa_name: input.name || client.wa_name }).eq("id", client.id);
  }

  let { data: lead } = await db
    .from("leads")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lead) {
    const { data: created, error } = await db
      .from("leads")
      .insert({
        client_id: client.id,
        source: "whatsapp",
        name: input.name || client.name,
        phone,
        status: "nuevo",
        pipeline: "nuevo",
        channel_slug: "whatsapp",
      })
      .select("*")
      .single();
    if (error) throw error;
    lead = created;
  }

  let { data: conv } = await db.from("wa_conversations").select("*").eq("wa_phone", phone).maybeSingle();
  if (!conv && alias) {
    const { data: byAlias } = await db.from("wa_conversations").select("*").eq("wa_phone", alias).maybeSingle();
    conv = byAlias;
  }
  const previousMeta = conv?.metadata && typeof conv.metadata === "object" ? conv.metadata : {};
  if (!conv) {
    const { data: created, error } = await db
      .from("wa_conversations")
      .insert({
        client_id: client.id,
        lead_id: lead.id,
        wa_phone: phone,
        wa_name: input.name || client.name,
        metadata: chatMetadata,
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
        unread_count: 1,
      })
      .select("*")
      .single();
    if (error) throw error;
    conv = created;
  } else {
    await db
      .from("wa_conversations")
      .update({
        wa_phone: phone,
        client_id: conv.client_id || client.id,
        metadata: { ...previousMeta, ...chatMetadata },
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
        unread_count: (conv.unread_count || 0) + 1,
        wa_name: input.name || conv.wa_name,
        status: conv.status === "cerrada" ? "abierta" : conv.status,
      })
      .eq("id", conv.id);
  }

  const { error: msgError } = await db.from("wa_messages").insert({
    conversation_id: conv.id,
    direction: "in",
    author: "cliente",
    message_type: input.type || "text",
    content: input.text,
    wa_message_id: input.waMessageId || null,
  });
  if (msgError && !/duplicate|unique/i.test(msgError.message)) throw msgError;

  return { conversationId: conv.id as string, duplicate: false, client, lead, conv };
}

async function insertSystemNote(db: SupabaseClient, conversationId: string, content: string) {
  const { data: last } = await db
    .from("wa_messages")
    .select("author,content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.author === "sistema" && last?.content === content) return;
  await db.from("wa_messages").insert({
    conversation_id: conversationId,
    direction: "out",
    author: "sistema",
    message_type: "text",
    content,
  });
  await db
    .from("wa_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
}

async function logAction(
  db: SupabaseClient,
  conversationId: string,
  clientId: string | null,
  action: string,
  parameters: unknown,
  result: unknown,
  status: "ok" | "error" = "ok",
) {
  await db.from("genesis_actions").insert({
    conversation_id: conversationId,
    client_id: clientId,
    action,
    parameters,
    result,
    status,
  });
}

type SlotRow = { at?: string; date?: string; time?: string; label?: string; mode?: string };

const LIVE_AGENDA_SENTENCE =
  "Si el cliente quiere agendar o una consulta y todavía no dijo el motivo, pregunta el motivo primero y no ofrezcas horarios en ese mensaje. Recién cuando sepas el motivo consulta la agenda en vivo y ofrece exactamente 2 horarios libres en hora de Chile. No inventes otros ni pidas nombre o teléfono antes de mostrar esas 2 opciones. Si no hay disponibilidad, dilo y no propongas ninguna hora. Agendar, precio o el link de armonivet.com/#agendar es una reserva nueva: no hables de Google Meet ni de conectarse a una consulta ya pagada.";

const STALE_AGENDA_SENTENCES = [
  "Si el cliente necesita una hora, ofrece 2 opciones reales. Si no hay disponibilidad, dilo.",
  "Si el cliente quiere una hora, un control, cambiar el día o pregunta si hay disponibilidad, consulta la agenda en vivo en ese mismo turno y ofrece exactamente 2 horarios libres que devolvió la agenda, en hora de Chile. No inventes otros ni pidas nombre, teléfono o datos de la mascota antes de mostrar esas 2 opciones. Si no hay disponibilidad, dilo y no propongas ninguna hora.",
];

export function sanitizeGenesisPrompt(raw: string) {
  let text = String(raw || "");
  for (const snippet of STALE_AGENDA_SENTENCES) {
    if (text.includes(snippet)) text = text.split(snippet).join(LIVE_AGENDA_SENTENCE);
  }
  return text;
}

const INTAKE_RULE = [
  "Orden obligatorio para agendar, no lo inviertas:",
  "1) Si quieren agendar, una consulta o una hora y todavía no dijeron el motivo, pregunta el motivo primero. Si no sabes si es perro o gato, pregúntalo en el mismo mensaje.",
  "2) Con el motivo, decide la modalidad (online o presencial) según las reglas de abajo.",
  "3) Da el precio de esa modalidad. Si preguntan cuánto sale, llama listar_servicios y responde el valor. No ofrezcas horarios si todavía falta el motivo.",
  "4) Recién ahí llama consultar_disponibilidad y ofrece 2 horarios.",
  "5) Cierra con el link de reserva en el modo correcto.",
  "Si te piden agendar y no hay motivo, responde SOLO pidiendo el motivo. Nada de horarios, nada de Google Meet, nada de pago acreditado, nada de consulta de hoy, nada de que no puedes llamar.",
].join(" ");

const AGENDA_RULE = [
  "Agenda en vivo: llama consultar_disponibilidad solo cuando ya sepas el motivo, o cuando pregunten explícitamente por horas, disponibilidad o cambiar el día.",
  "Si el caso prioriza online, llama consultar_disponibilidad con modalidad online aunque hayan pedido presencial. Si no, usa la modalidad que pidieron.",
  "Ofrece exactamente 2 horarios copiados de offer o slots, con su label, en hora de Chile. Esos horarios ya están libres.",
  "No inventes otros ni ofrezcas una hora que no venga en slots.",
  "No pidas nombre ni teléfono antes de mostrar esas 2 opciones.",
  "Si slots está vacío, di que no hay horas en ese período y no propongas ninguna.",
  "No crees la cita ni el pago dentro del chat. Las 2 horas son solo una orientación.",
].join(" ");

const FUNNEL_RULE = [
  "Cierre en la web: asesora y después redirige al calendario que corresponde. Online: https://armonivet.com/#agendar?modo=online. Presencial: https://armonivet.com/#agendar?modo=presencial.",
  "No mandes el link sin modo. En cada respuesta de precio u hora, recuerda que la reserva se confirma pagando en ese link. No digas que la hora ya quedó tomada por WhatsApp.",
  "Solo online, aunque pidan visita a domicilio, cuando haya miedo o agresividad con personas desconocidas, la mascota se lleve mal con extraños, ansiedad por separación o no pueda quedar sola, miedo o fobia a la pirotecnia, introducción entre gatos, agresividad en gatos, cualquier consulta de gatos, o perros grandes que tiren de la correa o se suban encima de las personas.",
  "Esta regla pisa cualquier instrucción anterior. En esos casos la única reserva es online: dos horarios online, el precio online y el link online. No preguntes comuna, no cotices sector y no mandes el link presencial.",
  "Convence con cercanía y en una frase corta, sin discurso ni tono pesado. Reconoce lo que cuentan y explica que el primer acercamiento se hace online porque es más seguro para la doctora y para el tutor. No asustes, no enumeres riesgos y no repitas el mismo argumento en cada mensaje.",
  "Si insisten en presencial, sigue cercana: valida que quieren verla en casa y mantén la consulta online como el camino. No ofrezcas la hora presencial ni la dejes como alternativa.",
  "Si pide presencial y el caso no está en esa lista, pregunta la comuna sin enumerar sectores ni comunas. Cuando la diga, llama listar_servicios y responde solo el sector cuyo zones_text la incluye. Si pide qué comunas cubre un sector, nómbralas en una frase corta.",
].join(" ");

const MEET_RULE = [
  "Agendar, quiero una consulta, cuánto sale o un link de armonivet.com/#agendar es siempre una reserva nueva.",
  "No preguntes si se refieren a conectarse a una consulta, ni hables de Google Meet, ni de pago acreditado, ni de la consulta de hoy.",
  "El link de Meet lo envía el sistema solo en el comprobante cuando el pago queda acreditado. Tú no lo mandes ni lo expliques, salvo que la persona tenga una cita online pagada próxima y pregunte explícitamente por el enlace, cómo ingresar, o que no le llegó.",
  "No uses consultar_pago ni consultar_disponibilidad para responder un saludo, un agendar o un precio.",
  "Si payments está vacío, no hay ningún pago pendiente: no digas que falta acreditar un pago.",
].join(" ");

const HISTORY_LIMIT = 40;

/** Recibe mensajes del más nuevo al más antiguo y los deja en orden de conversación. */
export function chronological<T extends { created_at?: string | null }>(rows: T[]) {
  const at = (row: T) => {
    const ms = Date.parse(String(row.created_at || ""));
    return Number.isFinite(ms) ? ms : 0;
  };
  return [...rows].sort((a, b) => at(a) - at(b));
}

function plainReply(text: string) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, "$1$2")
    .replace(/\*\*/g, "")
    .trim();
}

function appointmentContext(appts: Array<Record<string, unknown>> | null | undefined) {
  const now = Date.now();
  const upcoming: Array<Record<string, unknown>> = [];
  let past = 0;
  for (const item of appts || []) {
    const at = item?.scheduled_at ? new Date(String(item.scheduled_at)).getTime() : NaN;
    const status = String(item?.status || "");
    const done = /cancel|atendid|ausente/i.test(status) || !Number.isFinite(at) || at < now - 4 * 3600_000;
    if (done) {
      past += 1;
      continue;
    }
    upcoming.push({
      id: item.id,
      scheduled_at: item.scheduled_at,
      status: item.status,
      service_title: item.service_title,
      amount: item.amount,
      deposit_paid: item.deposit_paid,
    });
  }
  return {
    citas_proximas: upcoming,
    citas_pasadas: past,
    hint: "Si piden agendar, una consulta o el precio, es una reserva NUEVA. No asumas que quieren conectarse a una cita previa ni menciones Meet.",
  };
}

export async function unansweredInbound(db: SupabaseClient, conversationId: string) {
  const { data } = await db
    .from("wa_messages")
    .select("direction, author")
    .eq("conversation_id", conversationId)
    .neq("author", "sistema")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.direction === "in";
}

async function loadAvailableSlots(db: SupabaseClient, days = 21, mode?: string | null) {
  const payload: { p_days: number; p_mode?: string | null } = { p_days: days };
  if (mode) payload.p_mode = mode;
  let { data, error } = await db.rpc("list_available_slots", payload);
  if (error && payload.p_mode) {
    ({ data, error } = await db.rpc("list_available_slots", { p_days: days }));
  }
  if (error) {
    throw new Error("No pude leer la agenda. Hay que correr booking.sql y booking_modes.sql en Supabase.");
  }
  return (data || {}) as {
    timezone?: string;
    deposit?: number;
    hours?: string[];
    slots?: SlotRow[];
    duration_online?: number;
    duration_presencial?: number;
  };
}

function slotStart(slot: SlotRow) {
  const at = slot.at ? new Date(slot.at).getTime() : NaN;
  return Number.isFinite(at) ? at : NaN;
}

function suggestOpenSlots(slots: SlotRow[], durationMin: number) {
  const duration = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 60;
  const sorted = slots
    .filter((slot) => Number.isFinite(slotStart(slot)))
    .sort((a, b) => slotStart(a) - slotStart(b));
  const picked: SlotRow[] = [];
  let lastEnd = 0;
  for (const slot of sorted) {
    const start = slotStart(slot);
    if (start < lastEnd) continue;
    picked.push(slot);
    lastEnd = start + duration * 60_000;
    if (picked.length === 2) break;
  }
  return picked;
}

function slotMatches(slots: SlotRow[] | undefined, iso: string) {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return false;
  return (slots || []).some((s) => {
    if (!s?.at) return false;
    return Math.abs(new Date(s.at).getTime() - target) < 60_000;
  });
}

async function ensureSlotFree(db: SupabaseClient, iso: string, ignoreId?: string) {
  const avail = await loadAvailableSlots(db, 45);
  if (slotMatches(avail.slots, iso)) return null;
  if (ignoreId) {
    const { data: current } = await db.from("appointments").select("scheduled_at").eq("id", ignoreId).maybeSingle();
    if (current?.scheduled_at && Math.abs(new Date(current.scheduled_at).getTime() - new Date(iso).getTime()) < 60_000) {
      return null;
    }
  }
  return {
    error: "Esa hora ya no está disponible. Elegí otra de la lista.",
    timezone: avail.timezone || "America/Santiago",
    alternatives: (avail.slots || []).slice(0, 8),
  };
}

// Génesis solo puede tocar citas del cliente con el que está hablando. Sin esto,
// cualquiera que escriba podría mover o cancelar la cita de otra persona.
async function ownedAppointment(db: SupabaseClient, id: string, clientId: string | null) {
  if (!id || !clientId) return { error: "No encontré esa cita para este cliente." };
  const { data } = await db.from("appointments").select("*").eq("id", id).maybeSingle();
  if (!data || String(data.client_id || "") !== clientId) {
    return { error: "No encontré esa cita para este cliente." };
  }
  return { appointment: data as Record<string, unknown> };
}

async function executeTool(
  db: SupabaseClient,
  ctx: { conversation: Record<string, unknown>; client: Record<string, unknown> | null; settings: Settings },
  name: string,
  args: Record<string, unknown>,
) {
  const convId = String(ctx.conversation.id);
  const clientId = ctx.client ? String(ctx.client.id) : null;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      await logAction(db, convId, clientId, name, args, result, "ok");
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logAction(db, convId, clientId, name, args, { error: message }, "error");
      return { error: message };
    }
  };

  if (name === "actualizar_lead") {
    return run(async () => {
      const pipeline = String(args.pipeline || "");
      if (!PIPELINE.has(pipeline)) return { error: "pipeline inválido" };
      await db.from("wa_conversations").update({ pipeline }).eq("id", convId);
      if (ctx.conversation.lead_id) {
        await db
          .from("leads")
          .update({
            pipeline,
            status: pipeline === "agendado" ? "agendado" : pipeline === "perdido" ? "descartado" : "contactado",
          })
          .eq("id", ctx.conversation.lead_id);
      }
      if (clientId && args.notes) {
        await db.from("clients").update({ notes: String(args.notes), last_contact_at: new Date().toISOString() }).eq("id", clientId);
      }
      return { pipeline };
    });
  }

  if (name === "actualizar_mascota") {
    return run(async () => {
      if (!clientId) return { error: "sin cliente" };
      const petType = ["perro", "gato", "otro"].includes(String(args.pet_type)) ? String(args.pet_type) : "otro";
      await db
        .from("clients")
        .update({
          pet_name: String(args.pet_name || ""),
          pet_type: petType,
          pet_age: String(args.pet_age || ""),
          consultation_reason: String(args.consultation_reason || ""),
        })
        .eq("id", clientId);
      return { ok: true };
    });
  }

  if (name === "listar_servicios") {
    return run(async () => {
      const [{ data: services }, { data: zones }] = await Promise.all([
        db.from("services").select("title,price_from,price_label,description,section").eq("active", true).order("sort_order"),
        db.from("pricing_zones").select("name,price,zones_text").eq("active", true).order("sort_order"),
      ]);
      return {
        services: services || [],
        zones: zones || [],
        deposit: ctx.settings.deposit_amount ?? 20000,
        min_price: ctx.settings.min_price ?? 45000,
        hint: "Para presencial, no listes todas las comunas. Si no sabes la comuna, pregúntala. Si ya la dijo, responde solo el sector que la contiene y su precio.",
      };
    });
  }

  if (name === "consultar_disponibilidad") {
    return run(async () => {
      const days = Math.min(45, Math.max(1, Number(args.days || 14)));
      const rawMode = String(args.modalidad || "todas").toLowerCase();
      const mode = rawMode.includes("online") || rawMode.includes("remot")
        ? "online"
        : rawMode.includes("presencial")
          ? "presencial"
          : null;
      const avail = await loadAvailableSlots(db, days, mode);
      const slots = (avail.slots || []).slice(0, 16);
      const duration = mode === "presencial"
        ? Number(avail.duration_presencial || 60)
        : Number(avail.duration_online || 60);
      const offer = suggestOpenSlots(slots, duration);
      return {
        timezone: avail.timezone || ctx.settings.timezone || "America/Santiago",
        deposit: avail.deposit ?? ctx.settings.deposit_amount ?? 20000,
        modalidad: mode || "todas",
        duration_minutes: duration,
        hours: avail.hours || ctx.settings.slot_hours || ["10:00", "12:00", "15:00", "17:30"],
        count: (avail.slots || []).length,
        slots,
        offer,
        hint: offer.length
          ? "Ofrece exactamente estas opciones de offer, copiando label, fecha y hora de Chile. No inventes otros horarios ni pidas datos personales antes."
          : "No hay horas libres en este período. Dilo y no propongas ninguna hora.",
      };
    });
  }

  if (name === "reagendar_cita") {
    return run(async () => {
      const id = String(args.appointment_id || "");
      const nextAt = String(args.scheduled_at || "");
      const owned = await ownedAppointment(db, id, clientId);
      if ("error" in owned) return owned;
      const prev = owned.appointment;
      const taken = await ensureSlotFree(db, nextAt, id);
      if (taken) return taken;
      let { error } = await db
        .from("appointments")
        .update({ scheduled_at: nextAt, slot_locked_at: new Date().toISOString() })
        .eq("id", id);
      if (error && /slot_locked_at/i.test(error.message || "")) {
        ({ error } = await db.from("appointments").update({ scheduled_at: nextAt }).eq("id", id));
      }
      if (error) throw error;
      return { from: prev?.scheduled_at, to: nextAt, motivo: args.motivo };
    });
  }

  if (name === "cancelar_cita") {
    return run(async () => {
      const id = String(args.appointment_id || "");
      const owned = await ownedAppointment(db, id, clientId);
      if ("error" in owned) return owned;
      const { error } = await db
        .from("appointments")
        .update({ status: "cancelada", notes: String(args.motivo || "") })
        .eq("id", id);
      if (error) throw error;
      await db.from("reminders").update({ status: "cancelado" }).eq("appointment_id", id).eq("status", "pendiente");
      await db.from("wa_conversations").update({ pipeline: "cancelado" }).eq("id", convId);
      return { cancelled: id };
    });
  }

  if (name === "consultar_pago") {
    return run(async () => {
      const { data } = await db
        .from("payments")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: false })
        .limit(5);
      return { payments: data || [] };
    });
  }

  if (name === "programar_recordatorio") {
    return run(async () => {
      const { data, error } = await db
        .from("reminders")
        .insert({
          conversation_id: convId,
          client_id: clientId,
          kind: String(args.kind || "nota"),
          body: String(args.body || ""),
          scheduled_at: String(args.scheduled_at),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    });
  }

  if (name === "escalar_a_humano") {
    return run(async () => {
      await db
        .from("wa_conversations")
        .update({
          assigned_to: "humano",
          status: "pausada_humano",
          pipeline: "derivado_humano",
        })
        .eq("id", convId);
      return { paused: true, motivo: args.motivo };
    });
  }

  return { error: `herramienta desconocida: ${name}` };
}

export async function runGenesisTurn(db: SupabaseClient, conversationId: string, opts?: { deliver?: boolean }) {
  const settings = await loadGenesisSettings(db);
  const { data: conversation, error } = await db.from("wa_conversations").select("*").eq("id", conversationId).single();
  if (error) throw error;

  if (settings.enabled === false) {
    await insertSystemNote(
      db,
      conversationId,
      "Génesis está apagada. Activala en Admin → Génesis IA, o escribí acá para responder vos.",
    );
    return { skipped: true, reason: "genesis_disabled" };
  }
  if (conversation.assigned_to === "humano" || conversation.status === "pausada_humano") {
    return { skipped: true, reason: "human_takeover" };
  }

  try {
    return await generateGenesisReply(db, conversationId, conversation, settings, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await insertSystemNote(db, conversationId, `Génesis no pudo responder: ${message}`);
    } catch {
      /* the original error matters more than the note */
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Un solo turno de Génesis a la vez por conversación.
//
// Wazend manda un webhook por mensaje y además reintenta si la función tarda.
// Sin candado, "hola" + "quería consultar" + "por mi perro" en tres mensajes
// generaban tres respuestas. Ahora el primer webhook toma el candado, espera un
// momento para juntar la ráfaga y responde a todo junto; los demás webhooks ven
// el candado y se van. Si llega algo nuevo mientras Génesis escribía, se hace
// otra vuelta antes de soltarlo.
//
// El candado es la columna wa_conversations.genesis_lock_until
// (supabase/genesis_lock.sql). Si todavía no se corrió ese SQL, se responde
// como antes, sin candado, para no dejar a Génesis muda.
// ---------------------------------------------------------------------------

const LOCK_SECONDS = 120;
const BURST_WAIT_MS = 3500;
const MAX_ROUNDS = 3;

type LockState = "claimed" | "busy" | "unsupported";

function lockNotInstalled(error: { message?: string; code?: string }) {
  return error.code === "PGRST202" || /genesis_try_lock|genesis_lock_until/i.test(error.message || "");
}

async function claimGenesisLock(db: SupabaseClient, conversationId: string): Promise<LockState> {
  // genesis_try_lock es un único UPDATE condicionado en Postgres: aunque lleguen
  // varios webhooks juntos, solo uno recibe true.
  const { data, error } = await db.rpc("genesis_try_lock", {
    p_conversation: conversationId,
    p_seconds: LOCK_SECONDS,
  });
  if (error) {
    if (lockNotInstalled(error)) {
      console.warn("[genesis] falta correr supabase/genesis_lock.sql; respondo sin candado");
      return "unsupported";
    }
    throw error;
  }
  return data === true ? "claimed" : "busy";
}

async function extendGenesisLock(db: SupabaseClient, conversationId: string) {
  const until = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
  await db.from("wa_conversations").update({ genesis_lock_until: until }).eq("id", conversationId);
}

async function releaseGenesisLock(db: SupabaseClient, conversationId: string) {
  await db.from("wa_conversations").update({ genesis_lock_until: null }).eq("id", conversationId);
}

async function latestInboundAt(db: SupabaseClient, conversationId: string) {
  const { data } = await db
    .from("wa_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? String(data.created_at) : "";
}

async function hasInboundAfter(db: SupabaseClient, conversationId: string, since: string) {
  if (!since) return false;
  const { data } = await db
    .from("wa_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .gt("created_at", since)
    .limit(1);
  return Boolean(data && data.length);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Responde una conversación desde el webhook, sin turnos en paralelo. */
export async function respondToConversation(
  db: SupabaseClient,
  conversationId: string,
  opts: { waitForBurst?: boolean; recheck?: boolean } = {},
): Promise<Record<string, unknown>> {
  const lock = await claimGenesisLock(db, conversationId);
  if (lock === "busy") return { skipped: true, reason: "turn_in_progress" };

  const results: unknown[] = [];
  let since = "";
  let lastSkipped = false;
  try {
    if (opts.waitForBurst !== false) await sleep(BURST_WAIT_MS);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const before = await latestInboundAt(db, conversationId);
      const turn = await runGenesisTurn(db, conversationId) as Record<string, unknown>;
      results.push(turn);
      // Lo último que Génesis alcanzó a leer; si no lee nada (apagada o en
      // manos de un humano), no tiene sentido otra vuelta.
      since = String(turn.lastInboundAt || before);
      lastSkipped = Boolean(turn.skipped);
      if (lastSkipped) break;
      if (!(await hasInboundAfter(db, conversationId, since))) break;
      if (lock === "claimed") await extendGenesisLock(db, conversationId);
    }
  } finally {
    if (lock === "claimed") await releaseGenesisLock(db, conversationId);
  }

  // Un mensaje que entró justo entre la última revisión y soltar el candado
  // encontró el candado tomado y se fue: se le responde aquí una vez.
  if (
    lock === "claimed" && !lastSkipped && opts.recheck !== false &&
    (await hasInboundAfter(db, conversationId, since))
  ) {
    results.push(await respondToConversation(db, conversationId, { waitForBurst: false, recheck: false }));
  }
  return results.length === 1 ? (results[0] as Record<string, unknown>) : { rounds: results };
}

async function generateGenesisReply(
  db: SupabaseClient,
  conversationId: string,
  conversation: Record<string, unknown> & { client_id?: string | null; lead_id?: string | null; wa_phone?: string; wa_name?: string; pipeline?: string },
  settings: Settings,
  opts?: { deliver?: boolean },
) {
  const [{ data: client }, { data: messages }, { data: appts }, { data: payments }, { data: intake }] = await Promise.all([
    conversation.client_id
      ? db.from("clients").select("*").eq("id", conversation.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Los MÁS RECIENTES primero (se dan vuelta abajo). Antes se pedían en orden
    // ascendente con limit, lo que traía los 30 más antiguos: pasado ese número
    // Génesis ya no veía lo último que escribió el cliente.
    db.from("wa_messages").select("direction,author,content,created_at").eq("conversation_id", conversationId).neq("author", "sistema").order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
    conversation.client_id
      ? db.from("appointments").select("id,scheduled_at,status,service_title,amount,deposit_paid").eq("client_id", conversation.client_id).order("scheduled_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
    db.from("payments").select("id,amount,status,kind,due_at,checkout_url").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(5),
    conversation.client_id
      ? db.from("intake_forms").select("raw_answers,created_at").eq("client_id", conversation.client_id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const filled = (record: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== ""));

  const instructions = [
    sanitizeGenesisPrompt(settings.system_prompt || "Eres Génesis, secretaria de Armonivet."),
    "Usa herramientas para datos reales. No inventes horas ni precios.",
    INTAKE_RULE,
    AGENDA_RULE,
    FUNNEL_RULE,
    MEET_RULE,
    "Escribe como un WhatsApp, en texto plano. No uses asteriscos, negritas, markdown ni símbolos para destacar palabras. Mensajes breves.",
    "Si el contexto incluye formulario_previo, úsalo como antecedente del paciente. No inventes datos clínicos ni de conducta. No vuelvas a pedir lo que ya está respondido, salvo que falte un dato imprescindible para agendar o confirmar la hora.",
    `Contexto cliente: ${JSON.stringify({
      client: client
        ? filled({
            name: client.name,
            phone: client.phone,
            email: client.email,
            pet_name: client.pet_name,
            pet_type: client.pet_type,
            pet_age: client.pet_age,
            neutered: client.is_neutered,
            neutered_detail: client.neutered_date,
            diagnosed_conditions: client.diagnosed_conditions,
            current_treatment: client.current_treatment,
            household_members: client.household_members,
            consultation_reason: client.consultation_reason,
            behavior_frequency: client.behavior_frequency,
            previous_ethologist: client.previous_ethologist,
            attempted_solutions: client.attempted_solutions,
            last_vet_reason: client.last_vet_reason,
            routine: client.time_spent_location,
            extra: client.life_changes,
          })
        : null,
      formulario_previo: intake?.raw_answers || null,
      pipeline: conversation.pipeline,
      appointments: appointmentContext(appts as Array<Record<string, unknown>> | null),
      payments: payments || [],
    })}`,
  ].join("\n\n");

  const history = chronological(messages || []);
  const lastInboundAt = [...history].reverse().find((m) => m.direction === "in")?.created_at || "";

  const input: unknown[] = history
    .filter((m) => m.author !== "sistema" && m.content)
    .map((m) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.content || "",
    }));

  const model = resolveModel(settings.model);
  let response = await runOpenAI({ model, instructions, input, tools: GENESIS_TOOLS });
  let loops = 0;
  while (loops < 6) {
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
      const result = await executeTool(db, { conversation, client, settings }, call.name, args);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
    response = await runOpenAI({ model, instructions, input, tools: GENESIS_TOOLS });
    loops += 1;
  }

  const reply = plainReply(outputText(response) || "Gracias por escribir. Te ayudo en un momento 🐾");
  await db.from("wa_messages").insert({
    conversation_id: conversationId,
    direction: "out",
    author: "genesis",
    message_type: "text",
    content: reply,
  });
  await db
    .from("wa_conversations")
    .update({ last_message_at: new Date().toISOString(), last_outbound_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (opts?.deliver !== false) {
    const sent = await sendWhatsAppText(wazendDestination(conversation), reply);
    if (!sent.ok) {
      await insertSystemNote(
        db,
        conversationId,
        `Génesis escribió, pero WhatsApp no salió (${sent.error || "Wazend no configurado"}). Revisá WAZEND_BASE_URL, WAZEND_API_KEY, WAZEND_SESSION y que la sesión esté WORKING.`,
      );
      return { skipped: false, reply, lastInboundAt, deliverError: sent.error || "send_failed" };
    }
  }
  return { skipped: false, reply, lastInboundAt };
}

async function paymentReminderSettled(db: SupabaseClient, item: Record<string, unknown>) {
  if (item.payment_id) {
    const { data: payment } = await db.from("payments").select("status").eq("id", item.payment_id).maybeSingle();
    if (payment && payment.status !== "pendiente") return true;
  }
  if (item.appointment_id) {
    const { data: appt } = await db
      .from("appointments")
      .select("status,deposit_paid")
      .eq("id", item.appointment_id)
      .maybeSingle();
    if (!appt) return true;
    if (appt.deposit_paid === true) return true;
    if (["abonada", "llegó", "completada", "cancelada", "no_asistió"].includes(String(appt.status || ""))) return true;
  }
  return false;
}

export async function processDueReminders(db: SupabaseClient) {
  const { data: due } = await db
    .from("reminders")
    .select("*")
    .eq("status", "pendiente")
    .lte("scheduled_at", new Date().toISOString())
    .limit(20);
  const results = [];
  for (const item of due || []) {
    const now = new Date().toISOString();
    const isPaymentReminder = String(item.kind || "").startsWith("abono_");

    // Un cobro que ya se pagó (o una cita que ya no existe) no se recuerda ni se
    // cancela: antes "abono_vence" cancelaba la cita aunque estuviera pagada.
    if (isPaymentReminder && (await paymentReminderSettled(db, item))) {
      await db.from("reminders").update({ status: "cancelado", sent_at: now }).eq("id", item.id);
      results.push({ id: item.id, ok: true, skipped: "ya_resuelto" });
      continue;
    }

    if (item.kind === "abono_vence" && item.appointment_id) {
      await db.from("appointments").update({ status: "cancelada", notes: "Abono no pagado a las 12h" }).eq("id", item.appointment_id);
      if (item.payment_id) await db.from("payments").update({ status: "vencido" }).eq("id", item.payment_id);
      if (item.conversation_id) await db.from("wa_conversations").update({ pipeline: "cancelado" }).eq("id", item.conversation_id);
    }

    let status: "enviado" | "cancelado" | "error" = "cancelado";
    if (item.conversation_id && item.body) {
      // metadata trae el chat id real de Wazend (incluye contactos @lid); con
      // solo wa_phone esos recordatorios salían a un chat que no existe.
      const { data: conv } = await db
        .from("wa_conversations")
        .select("wa_phone,assigned_to,metadata")
        .eq("id", item.conversation_id)
        .maybeSingle();
      if (conv?.wa_phone && conv.assigned_to !== "humano") {
        const sent = await sendWhatsAppText(wazendDestination(conv), item.body);
        if (sent.ok) {
          status = "enviado";
          await db.from("wa_messages").insert({
            conversation_id: item.conversation_id,
            direction: "out",
            author: "genesis",
            message_type: "text",
            content: item.body,
          });
          await db
            .from("wa_conversations")
            .update({ last_message_at: now, last_outbound_at: now })
            .eq("id", item.conversation_id);
        } else {
          status = "error";
          await insertSystemNote(
            db,
            item.conversation_id,
            `No salió un recordatorio programado (${sent.error || "error de envío"}): "${item.body}"`,
          );
        }
      }
    }
    await db.from("reminders").update({ status, sent_at: now }).eq("id", item.id);
    results.push({ id: item.id, ok: status !== "error", status });
  }
  return results;
}
