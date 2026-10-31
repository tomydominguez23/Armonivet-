import { json, serviceClient } from "../_shared/supabase.ts";
import { MP_API, mpPublicKey, mpToken, siteUrl, webhookUrl } from "../_shared/mercadopago.ts";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

type CartItem = { title?: string; amount?: number; id?: string };

function cleanEmail(value: unknown) {
  const email = String(value || "").trim().replace(/\s+/g, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  try {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const body = await req.json();
    const itemsIn: CartItem[] = Array.isArray(body.items) ? body.items : [];
    let lines = itemsIn
      .map((row) => ({
        title: String(row.title || "Consulta Armonivet").slice(0, 120),
        amount: Math.round(Number(row.amount || 0)),
        id: String(row.id || ""),
      }))
      .filter((row) => row.amount > 0);
    const lineSum = lines.reduce((sum, row) => sum + row.amount, 0);
    const requested = Math.round(Number(body.amount || 0));
    const amount = requested > 0 ? requested : lineSum;
    if (amount <= 0) return json({ error: "El carrito no tiene un monto para cobrar." }, 400);
    // Mercado Pago rechaza el formulario si el total no coincide con los ítems.
    // Si el carrito no suma el valor de la reserva, se cobra un solo ítem por ese valor.
    if (!lines.length || lineSum !== amount) {
      lines = [{ title: String(body.title || "Consulta Armonivet").slice(0, 120), amount, id: "consulta" }];
    }
    const email = cleanEmail(body.email);

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
        notes: [body.name, email].filter(Boolean).join(" · ") || null,
      })
      .select("*")
      .single();
    if (payErr || !payment) throw new Error(payErr?.message || "No se pudo crear el pago");

    const token = mpToken();
    const publicKey = mpPublicKey();
    const origin = siteUrl();
    const notify = webhookUrl();

    if (token) {
      const preference = await fetch(`${MP_API}/checkout/preferences`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: lines.map((row) => ({
            id: row.id || undefined,
            title: row.title,
            quantity: 1,
            currency_id: "CLP",
            unit_price: row.amount,
          })),
          payer: {
            name: String(body.name || "").slice(0, 80) || undefined,
            email: email || undefined,
          },
          back_urls: {
            success: `${origin}/?pago=ok#agendar`,
            failure: `${origin}/?pago=error#agendar`,
            pending: `${origin}/?pago=pendiente#agendar`,
          },
          auto_return: "approved",
          notification_url: notify || undefined,
          external_reference: payment.id,
          statement_descriptor: "ARMONIVET",
        }),
      });
      const pref = await preference.json();
      if (!preference.ok) {
        const cause = Array.isArray(pref?.cause)
          ? pref.cause.map((item: { description?: string; code?: string }) => item?.description || item?.code).filter(Boolean).join(". ")
          : "";
        throw new Error(cause || pref?.message || "Mercado Pago rechazó el cobro");
      }
      const checkoutUrl = pref.init_point || pref.sandbox_init_point;
      await db
        .from("payments")
        .update({ checkout_url: checkoutUrl, provider_ref: pref.id })
        .eq("id", payment.id);

      return json({
        ok: true,
        payment_id: payment.id,
        amount,
        preference_id: pref.id,
        public_key: publicKey || null,
        checkout_url: checkoutUrl,
        email,
        name: String(body.name || "").trim(),
        provider: "mercadopago",
        mode: publicKey ? "bricks" : "redirect",
      });
    }

    const fallback = settings.payment_url || null;
    if (fallback) {
      await db.from("payments").update({ checkout_url: fallback, provider: "link" }).eq("id", payment.id);
      return json({ ok: true, payment_id: payment.id, checkout_url: fallback, provider: "link", mode: "redirect" });
    }

    return json({
      ok: true,
      payment_id: payment.id,
      checkout_url: null,
      mode: "pending",
      message: "El pago quedó pendiente. Configurá MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_PUBLIC_KEY en Edge Functions.",
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
