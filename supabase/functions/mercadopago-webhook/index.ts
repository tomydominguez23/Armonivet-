import { json, serviceClient, text } from "../_shared/supabase.ts";

const MP_API = "https://api.mercadopago.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    if (req.method === "GET") return text("ok");
    if (req.method !== "POST") return json({ error: "method" }, 405);

    const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
    if (!token) return json({ error: "sin token" }, 500);

    const body = await req.json().catch(() => ({}));
    const paymentId = body?.data?.id || body?.id;
    if (!paymentId) return json({ ok: true, ignored: true });

    const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pay = await res.json();
    if (!res.ok) return json({ error: pay?.message || "mp" }, 400);

    const reference = String(pay.external_reference || "");
    if (!reference) return json({ ok: true, ignored: true });

    const db = serviceClient();
    const approved = pay.status === "approved";
    await db
      .from("payments")
      .update({
        status: approved ? "pagado" : pay.status === "rejected" ? "cancelado" : "pendiente",
        provider_ref: String(paymentId),
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

    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
