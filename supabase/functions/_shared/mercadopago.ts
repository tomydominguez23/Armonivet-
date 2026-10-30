import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { sendWhatsAppText } from "./whatsapp.ts";

export const MP_API = "https://api.mercadopago.com";

export function mpToken() {
  return Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
}

export function mpPublicKey() {
  return Deno.env.get("MERCADOPAGO_PUBLIC_KEY") || "";
}

export function siteUrl() {
  const raw = Deno.env.get("PUBLIC_SITE_URL") || "https://armonivet.com";
  return raw.replace(/\/+$/, "");
}

export function webhookUrl() {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  return base ? `${base}/functions/v1/mercadopago-webhook` : "";
}

export function mapPaymentStatus(status: string): "pagado" | "cancelado" | "pendiente" {
  if (status === "approved") return "pagado";
  if (status === "rejected" || status === "cancelled" || status === "refunded" || status === "charged_back") {
    return "cancelado";
  }
  return "pendiente";
}

type MpPayment = {
  id?: number | string;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
};

function formatCLP(amount: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatChile(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function chargedAmount(pay: MpPayment, fallback: unknown) {
  const fromMp = Number(pay.transaction_amount);
  if (Number.isFinite(fromMp) && fromMp > 0) return Math.round(fromMp);
  const stored = Number(fallback);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return 0;
}

async function sendPaymentReceipt(
  db: SupabaseClient,
  paymentId: string,
  appointmentId: string,
  amount: number,
  mpId: number | string | undefined,
) {
  try {
    const { data: payRow, error } = await db
      .from("payments")
      .select("receipt_sent_at")
      .eq("id", paymentId)
      .maybeSingle();
    if (error || payRow?.receipt_sent_at) return;

    const { data: appt } = await db
      .from("appointments")
      .select("client_name, client_phone, pet_name, service_title, scheduled_at")
      .eq("id", appointmentId)
      .maybeSingle();
    const phone = String(appt?.client_phone || "").trim();
    if (!phone) return;

    const when = appt?.scheduled_at ? formatChile(String(appt.scheduled_at)) : "";
    const who = String(appt?.client_name || "").trim();
    const lines = [
      "Comprobante Armonivet",
      `Hola${who ? ` ${who}` : ""}. Recibimos tu pago de ${formatCLP(amount)}.`,
      appt?.service_title ? `Servicio: ${appt.service_title}` : "",
      appt?.pet_name ? `Paciente: ${appt.pet_name}` : "",
      when ? `Hora: ${when} (hora de Chile)` : "",
      mpId != null ? `Mercado Pago: ${mpId}` : "",
      "Tu hora quedó confirmada. Guardá este mensaje como comprobante.",
    ].filter(Boolean);

    const sent = await sendWhatsAppText(phone, lines.join("\n"));
    if (sent?.ok) {
      await db.from("payments").update({ receipt_sent_at: new Date().toISOString() }).eq("id", paymentId);
    }
  } catch (err) {
    console.warn("[receipt]", err instanceof Error ? err.message : err);
  }
}

export async function applyMercadoPagoPayment(db: SupabaseClient, pay: MpPayment) {
  const reference = String(pay.external_reference || "");
  if (!reference) return { updated: false, amount: 0 };
  const approved = pay.status === "approved";
  const status = mapPaymentStatus(String(pay.status || ""));
  const { data: current } = await db
    .from("payments")
    .select("appointment_id, amount")
    .eq("id", reference)
    .maybeSingle();
  const amount = chargedAmount(pay, current?.amount);

  const paymentUpdate: Record<string, unknown> = {
    status,
    provider_ref: pay.id != null ? String(pay.id) : undefined,
    paid_at: approved ? new Date().toISOString() : null,
  };
  if (approved && amount > 0) paymentUpdate.amount = amount;

  await db.from("payments").update(paymentUpdate).eq("id", reference);

  const appointmentId = current?.appointment_id ? String(current.appointment_id) : "";
  if (approved && appointmentId) {
    const apptUpdate: Record<string, unknown> = { deposit_paid: true, status: "abonada" };
    if (amount > 0) apptUpdate.amount = amount;
    await db.from("appointments").update(apptUpdate).eq("id", appointmentId);

    const { data: apptRow } = await db
      .from("appointments")
      .select("client_id, notes")
      .eq("id", appointmentId)
      .maybeSingle();
    if (apptRow?.client_id) {
      const notes = String(apptRow.notes || "");
      const addressMatch = notes.match(/Direcci[oó]n:\s*([^·\n]+)/i);
      const address = addressMatch?.[1]?.trim() || "";
      const clientPatch: Record<string, unknown> = {
        status: "abonado",
        last_contact_at: new Date().toISOString(),
      };
      if (address) clientPatch.address = address;
      await db.from("clients").update(clientPatch).eq("id", apptRow.client_id);
    }

    if (amount > 0) await sendPaymentReceipt(db, reference, appointmentId, amount, pay.id);
  } else if (status === "cancelado" && appointmentId) {
    const { data: appt } = await db
      .from("appointments")
      .select("status, notes, deposit_paid")
      .eq("id", appointmentId)
      .maybeSingle();
    if (appt && appt.status === "pendiente_pago" && appt.deposit_paid !== true) {
      const notes = [appt.notes, "Pago rechazado o cancelado. La hora volvió a quedar libre."]
        .filter(Boolean)
        .join(" ")
        .trim();
      await db
        .from("appointments")
        .update({ status: "cancelada", notes })
        .eq("id", appointmentId)
        .eq("status", "pendiente_pago");
    }
  }
  return { updated: true, status, amount };
}
