import { json, serviceClient, text } from "../_shared/supabase.ts";
import { applyMercadoPagoPayment, MP_API, mpToken } from "../_shared/mercadopago.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    if (req.method === "GET") return text("ok");
    if (req.method !== "POST") return json({ error: "method" }, 405);

    const token = mpToken();
    if (!token) return json({ error: "sin token" }, 500);

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const type = String(body?.type || body?.topic || url.searchParams.get("type") || url.searchParams.get("topic") || "");
    const paymentId = body?.data?.id || body?.id || url.searchParams.get("data.id") || url.searchParams.get("id");
    if (!paymentId) return json({ ok: true, ignored: true });
    if (type && type !== "payment" && type !== "topic_payment") {
      return json({ ok: true, ignored: true });
    }

    const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pay = await res.json();
    if (!res.ok) return json({ error: pay?.message || "mp" }, 400);

    const db = serviceClient();
    await applyMercadoPagoPayment(db, pay);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
