import { json, serviceClient } from "../_shared/supabase.ts";
import { applyMercadoPagoPayment, MP_API, mpToken, webhookUrl } from "../_shared/mercadopago.ts";

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
    const token = mpToken();
    if (!token) return json({ error: "Falta MERCADOPAGO_ACCESS_TOKEN." }, 500);

    const body = await req.json();
    const paymentId = String(body.payment_id || "");
    const formData = (body.formData && typeof body.formData === "object" ? body.formData : body) as Record<
      string,
      unknown
    >;
    if (!paymentId) return json({ error: "Falta payment_id." }, 400);

    const db = serviceClient();
    const { data: row, error: rowErr } = await db.from("payments").select("*").eq("id", paymentId).maybeSingle();
    if (rowErr || !row) return json({ error: "No encontramos ese pago." }, 404);
    if (row.status === "pagado") {
      return json({ ok: true, status: "approved", payment_id: row.provider_ref, amount: row.amount, already: true });
    }

    const cardToken = String(formData.token || "");
    if (!cardToken) {
      return json({
        ok: true,
        status: "pending",
        redirected: true,
        message: "Seguí las instrucciones de Mercado Pago para terminar el pago.",
      });
    }

    const payer = (formData.payer && typeof formData.payer === "object" ? formData.payer : {}) as Record<
      string,
      unknown
    >;
    const identification = (payer.identification && typeof payer.identification === "object"
      ? payer.identification
      : {}) as Record<string, unknown>;

    const email = String(payer.email || body.email || "").trim().replace(/\s+/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Escribe un correo válido para continuar el pago. La hora sigue reservada." }, 400);
    }
    const issuerRaw = formData.issuer_id;
    const issuerNum = Number(issuerRaw);
    const issuerId =
      issuerRaw == null || issuerRaw === "" || !Number.isFinite(issuerNum) || issuerNum === 0
        ? undefined
        : issuerNum;

    const payload = {
      transaction_amount: Number(row.amount),
      token: cardToken,
      description: "Armonivet",
      installments: Number(formData.installments || 1),
      payment_method_id: String(formData.payment_method_id || ""),
      issuer_id: issuerId,
      capture: true,
      external_reference: row.id,
      notification_url: webhookUrl() || undefined,
      statement_descriptor: "ARMONIVET",
      payer: {
        email,
        first_name: String(payer.first_name || body.name || "").slice(0, 80) || undefined,
        identification:
          identification.number
            ? {
                type: String(identification.type || "RUT"),
                number: String(identification.number),
              }
            : undefined,
      },
    };

    const idempotency = `${row.id}:${cardToken.slice(0, 24)}`;
    const res = await fetch(`${MP_API}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotency,
      },
      body: JSON.stringify(payload),
    });
    const pay = await res.json();
    if (!res.ok) {
      const cause = Array.isArray(pay?.cause)
        ? pay.cause.map((item: { description?: string; code?: string }) => item?.description || item?.code).filter(Boolean).join(". ")
        : "";
      throw new Error(cause || pay?.message || pay?.error || "Mercado Pago rechazó el pago");
    }

    await applyMercadoPagoPayment(db, pay);
    return json({
      ok: true,
      status: pay.status,
      status_detail: pay.status_detail,
      payment_id: pay.id,
      amount: pay.transaction_amount ?? row.amount,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
