import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { GENESIS_TOOLS, outputText, resolveModel, runOpenAI } from "./openai.ts";
import { sendWhatsAppText } from "./whatsapp.ts";
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
  name?: string;
  text: string;
  waMessageId?: string;
  type?: string;
}) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("Teléfono vacío");

  if (input.waMessageId) {
    const { data: existing } = await db
      .from("wa_messages")
      .select("id, conversation_id")
      .eq("wa_message_id", input.waMessageId)
      .maybeSingle();
    if (existing) return { conversationId: existing.conversation_id as string, duplicate: true };
  }

  let { data: client } = await db.from("clients").select("*").eq("wa_phone", phone).maybeSingle();
  if (!client) {
    const { data: byPhone } = await db.from("clients").select("*").eq("phone", phone).maybeSingle();
    client = byPhone;
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
  } else if (!client.wa_phone) {
    await db.from("clients").update({ wa_phone: phone, wa_name: input.name || client.wa_name }).eq("id", client.id);
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
  if (!conv) {
    const { data: created, error } = await db
      .from("wa_conversations")
      .insert({
        client_id: client.id,
        lead_id: lead.id,
        wa_phone: phone,
        wa_name: input.name || client.name,
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

type SlotRow = { at?: string; date?: string; time?: string; label?: string };

async function loadAvailableSlots(db: SupabaseClient, days = 21) {
  const { data, error } = await db.rpc("list_available_slots", { p_days: days });
  if (error) {
    throw new Error("No pude leer la agenda. Hay que correr booking.sql en Supabase.");
  }
  return (data || {}) as {
    timezone?: string;
    deposit?: number;
    hours?: string[];
    slots?: SlotRow[];
  };
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

  if (name === "buscar_cliente") {
    return run(async () => {
      const q = String(args.query || "");
      const { data } = await db
        .from("clients")
        .select("id,name,phone,wa_phone,pet_name,pet_type,status,consultation_reason")
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%,wa_phone.ilike.%${q}%,pet_name.ilike.%${q}%`)
        .limit(8);
      return { clients: data || [] };
    });
  }

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
        min_price: ctx.settings.min_price ?? 40000,
      };
    });
  }

  if (name === "consultar_disponibilidad") {
    return run(async () => {
      const days = Math.min(45, Math.max(1, Number(args.days || 14)));
      const avail = await loadAvailableSlots(db, days);
      const slots = (avail.slots || []).slice(0, 16);
      return {
        timezone: avail.timezone || ctx.settings.timezone || "America/Santiago",
        deposit: avail.deposit ?? ctx.settings.deposit_amount ?? 20000,
        hours: avail.hours || ctx.settings.slot_hours || ["10:00", "12:00", "15:00", "17:30"],
        count: slots.length,
        slots,
        hint: slots.length
          ? "Ofrece 2 opciones concretas con fecha y hora de Chile. No inventes horarios."
          : "No hay horas libres en este período. Ofrece otra semana o escala a humano.",
      };
    });
  }

  if (name === "crear_cita") {
    return run(async () => {
      const scheduledAt = String(args.scheduled_at || "");
      const taken = await ensureSlotFree(db, scheduledAt);
      if (taken) return taken;
      const amount = Number(args.amount || ctx.settings.min_price || 40000);
      const deposit = ctx.settings.deposit_amount ?? 20000;
      const { data, error } = await db
        .from("appointments")
        .insert({
          client_id: clientId,
          client_name: ctx.client?.name || ctx.conversation.wa_name || "WhatsApp",
          client_phone: ctx.conversation.wa_phone,
          pet_name: ctx.client?.pet_name || null,
          pet_type: ctx.client?.pet_type || null,
          service_title: String(args.service_title || "Consulta"),
          scheduled_at: scheduledAt,
          status: "agendada",
          amount,
          deposit_amount: deposit,
          deposit_paid: false,
          channel_slug: "whatsapp",
        })
        .select("*")
        .single();
      if (error) throw error;
      await db.from("wa_conversations").update({ pipeline: "esperando_pago" }).eq("id", convId);
      const due = new Date(Date.now() + 12 * 3600000).toISOString();
      const { data: payment } = await db
        .from("payments")
        .insert({
          client_id: clientId,
          appointment_id: data.id,
          conversation_id: convId,
          amount: deposit,
          kind: "abono",
          status: "pendiente",
          checkout_url: ctx.settings.payment_url || null,
          due_at: due,
        })
        .select("*")
        .single();
      await db.from("reminders").insert([
        {
          conversation_id: convId,
          client_id: clientId,
          appointment_id: data.id,
          payment_id: payment?.id,
          kind: "abono_2h",
          body: "Hola 😊 te recuerdo el abono de $20.000 para confirmar la hora. Vence en 12 horas.",
          scheduled_at: new Date(Date.now() + 2 * 3600000).toISOString(),
        },
        {
          conversation_id: convId,
          client_id: clientId,
          appointment_id: data.id,
          payment_id: payment?.id,
          kind: "abono_10h",
          body: "Quedan pocas horas para confirmar con el abono. Si no se acredita, la hora se libera.",
          scheduled_at: new Date(Date.now() + 10 * 3600000).toISOString(),
        },
        {
          conversation_id: convId,
          client_id: clientId,
          appointment_id: data.id,
          payment_id: payment?.id,
          kind: "abono_vence",
          body: "La hora quedó liberada porque el abono no llegó a tiempo. Cuando quieras, te ayudo a agendar otra.",
          scheduled_at: due,
        },
      ]);
      return {
        appointment: data,
        payment,
        message: "Cita provisional creada. Abono $20.000 para confirmar, vence en 12 horas.",
      };
    });
  }

  if (name === "reagendar_cita") {
    return run(async () => {
      const id = String(args.appointment_id || "");
      const nextAt = String(args.scheduled_at || "");
      const taken = await ensureSlotFree(db, nextAt, id);
      if (taken) return taken;
      const { data: prev } = await db.from("appointments").select("*").eq("id", id).maybeSingle();
      const { error } = await db.from("appointments").update({ scheduled_at: nextAt }).eq("id", id);
      if (error) throw error;
      return { from: prev?.scheduled_at, to: nextAt, motivo: args.motivo };
    });
  }

  if (name === "cancelar_cita") {
    return run(async () => {
      const id = String(args.appointment_id || "");
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

  if (name === "crear_pago") {
    return run(async () => {
      const deposit = Number(args.amount || ctx.settings.deposit_amount || 20000);
      const { data, error } = await db
        .from("payments")
        .insert({
          client_id: clientId,
          appointment_id: args.appointment_id || null,
          conversation_id: convId,
          amount: deposit,
          kind: String(args.kind || "abono"),
          status: "pendiente",
          checkout_url: ctx.settings.payment_url || null,
          due_at: new Date(Date.now() + 12 * 3600000).toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      await db.from("wa_conversations").update({ pipeline: "esperando_pago" }).eq("id", convId);
      return data;
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
  if (settings.enabled === false) return { skipped: true, reason: "genesis_disabled" };

  const { data: conversation, error } = await db.from("wa_conversations").select("*").eq("id", conversationId).single();
  if (error) throw error;
  if (conversation.assigned_to === "humano" || conversation.status === "pausada_humano") {
    return { skipped: true, reason: "human_takeover" };
  }

  const [{ data: client }, { data: messages }, { data: appts }, { data: payments }] = await Promise.all([
    conversation.client_id
      ? db.from("clients").select("*").eq("id", conversation.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("wa_messages").select("direction,author,content,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(30),
    conversation.client_id
      ? db.from("appointments").select("id,scheduled_at,status,service_title,amount,deposit_paid").eq("client_id", conversation.client_id).order("scheduled_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] }),
    db.from("payments").select("id,amount,status,kind,due_at,checkout_url").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(5),
  ]);

  const instructions = [
    settings.system_prompt || "Eres Génesis, secretaria de Armonivet.",
    "Usa herramientas para datos reales. No inventes horas ni precios.",
    `Contexto cliente: ${JSON.stringify({
      client: client
        ? {
            name: client.name,
            phone: client.phone,
            pet_name: client.pet_name,
            pet_type: client.pet_type,
            reason: client.consultation_reason,
          }
        : null,
      pipeline: conversation.pipeline,
      appointments: appts || [],
      payments: payments || [],
    })}`,
  ].join("\n\n");

  const input: unknown[] = (messages || []).map((m) => ({
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

  const reply = outputText(response) || "Gracias por escribir. Te ayudo en un momento 🐾";
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
    await sendWhatsAppText(String(conversation.wa_phone), reply);
  }
  return { skipped: false, reply };
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
    if (item.kind === "abono_vence" && item.appointment_id) {
      await db.from("appointments").update({ status: "cancelada", notes: "Abono no pagado a las 12h" }).eq("id", item.appointment_id);
      if (item.payment_id) await db.from("payments").update({ status: "vencido" }).eq("id", item.payment_id);
      if (item.conversation_id) await db.from("wa_conversations").update({ pipeline: "cancelado" }).eq("id", item.conversation_id);
    }
    let sent = { ok: true, skipped: true };
    if (item.conversation_id && item.body) {
      const { data: conv } = await db.from("wa_conversations").select("wa_phone,assigned_to").eq("id", item.conversation_id).maybeSingle();
      if (conv?.wa_phone && conv.assigned_to !== "humano") {
        sent = await sendWhatsAppText(conv.wa_phone, item.body);
        await db.from("wa_messages").insert({
          conversation_id: item.conversation_id,
          direction: "out",
          author: "genesis",
          message_type: "text",
          content: item.body,
        });
      }
    }
    await db
      .from("reminders")
      .update({ status: sent.ok ? "enviado" : "error", sent_at: new Date().toISOString() })
      .eq("id", item.id);
    results.push({ id: item.id, ok: sent.ok });
  }
  return results;
}
