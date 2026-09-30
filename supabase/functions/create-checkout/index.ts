import { json, serviceClient } from "../_shared/supabase.ts";

const MP_API = "https://api.mercadopago.com";

function siteUrl() {
  return Deno.env.get("PUBLIC_SITE_URL") || "https://tomydominguez23.github.io/Armonivet-/";
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  try {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const body = await req.json();
    const itemsIn = Array.isArray(body.items) ? body.items : [];
    const amount = Number(body.amount || itemsIn.reduce((sum: number, row: { amount?: number }) => sum + Number(row.amount || 0), 0));
    if (amount <= 0) return json({ error: "El carrito no tiene un monto para cobrar." }, 400);

    const db = serviceClient();
    const { data: settingsRow } = await db.from("site_settings").select("value").eq("key", "genesis").maybeSingle();
    const settings = (settingsRow?.value || {}) as { payment_url?: string };

    const { data: payment, error: payErr } = await db
      .from("payments")
      .insert({
        appointment_id: body.appointment_id || null,
        amount,
        kind: "saldo",
        status: "pendiente",
        provider: "mercadopago",
        currency: "CLP",
        items: itemsIn,
        notes: [body.name, body.email].filter(Boolean).join(" · ") || null,
      })
      .select("*")
      .single();
    if (payErr || !payment) throw new Error(payErr?.message || "No se pudo crear el pago");

    const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || "";
    if (token) {
      const preference = await fetch(`${MP_API}/checkout/preferences`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: itemsIn.map((row: { title?: string; amount?: number }) => ({
            title: String(row.title || "Consulta Armonivet").slice(0, 120),
            quantity: 1,
            currency_id: "CLP",
            unit_price: Number(row.amount || 0),
          })),
          payer: {
            name: String(body.name || "").slice(0, 80) || undefined,
            email: String(body.email || "").trim() || undefined,
          },
          back_urls: {
            success: `${siteUrl()}?pago=ok#agendar`,
            failure: `${siteUrl()}?pago=error#agendar`,
            pending: `${siteUrl()}?pago=pendiente#agendar`,
          },
          auto_return: "approved",
          notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
          external_reference: payment.id,
        }),
      });
      const pref = await preference.json();
      if (!preference.ok) {
        throw new Error(pref?.message || "Mercado Pago rechazó el cobro");
      }
      const checkoutUrl = pref.init_point || pref.sandbox_init_point;
      await db.from("payments").update({ checkout_url: checkoutUrl, provider_ref: pref.id }).eq("id", payment.id);
      return json({ ok: true, payment_id: payment.id, checkout_url: checkoutUrl, provider: "mercadopago" });
    }

    const fallback = settings.payment_url || null;
    if (fallback) {
      await db.from("payments").update({ checkout_url: fallback, provider: "link" }).eq("id", payment.id);
      return json({ ok: true, payment_id: payment.id, checkout_url: fallback, provider: "link" });
    }

    return json({
      ok: true,
      payment_id: payment.id,
      checkout_url: null,
      message: "El pago quedó pendiente. Configurá MERCADOPAGO_ACCESS_TOKEN en Edge Functions para cobrar en la plataforma.",
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
