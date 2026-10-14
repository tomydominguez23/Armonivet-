import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

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

export async function applyMercadoPagoPayment(
  db: SupabaseClient,
  pay: { id?: number | string; status?: string; external_reference?: string },
) {
  const reference = String(pay.external_reference || "");
  if (!reference) return { updated: false };
  const approved = pay.status === "approved";
  const status = mapPaymentStatus(String(pay.status || ""));
  await db
    .from("payments")
    .update({
      status,
      provider_ref: pay.id != null ? String(pay.id) : undefined,
      paid_at: approved ? new Date().toISOString() : null,
    })
    .eq("id", reference);

  if (approved) {
    const { data: row } = await db.from("payments").select("appointment_id").eq("id", reference).maybeSingle();
    if (row?.appointment_id) {
      await db
        .from("appointments")
        .update({ deposit_paid: true, status: "abonada" })
        .eq("id", row.appointment_id);
    }
  }
  return { updated: true, status };
}
