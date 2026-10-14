import { isSupabaseConfigured, supabase } from "./supabase.js";
import { cartTotal, clearCart, getCart } from "./cart.js";

function loadMpSdk() {
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.onload = () => resolve(window.MercadoPago);
    script.onerror = () => reject(new Error("No se pudo cargar Mercado Pago."));
    document.head.appendChild(script);
  });
}

function overlayEls() {
  const overlay = document.querySelector("[data-pay-overlay]");
  return {
    overlay,
    lead: overlay?.querySelector("[data-pay-lead]"),
    error: overlay?.querySelector("[data-pay-error]"),
    brick: overlay?.querySelector("#paymentBrick_container"),
    status: overlay?.querySelector("#statusScreenBrick_container"),
  };
}

function setPayError(message) {
  const { error } = overlayEls();
  if (!error) return;
  error.hidden = !message;
  error.textContent = message || "";
}

export function closePayOverlay() {
  const { overlay, brick, status } = overlayEls();
  window.paymentBrickController?.unmount?.();
  window.statusScreenBrickController?.unmount?.();
  window.paymentBrickController = null;
  window.statusScreenBrickController = null;
  if (brick) brick.innerHTML = "";
  if (status) {
    status.innerHTML = "";
    status.hidden = true;
  }
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("pay-open");
}

function openPayOverlay(amount) {
  const { overlay, lead, brick, status } = overlayEls();
  if (!overlay || !brick) return false;
  setPayError("");
  if (lead) {
    lead.textContent = amount
      ? `Total a pagar: ${new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount)}`
      : "Completá el pago en Armonivet, sin salir del sitio.";
  }
  brick.hidden = false;
  brick.innerHTML = "";
  if (status) {
    status.hidden = true;
    status.innerHTML = "";
  }
  overlay.hidden = false;
  document.body.classList.add("pay-open");
  return true;
}

async function showStatusBrick(mp, paymentId) {
  const { brick, status } = overlayEls();
  if (!status) return;
  window.paymentBrickController?.unmount?.();
  window.paymentBrickController = null;
  if (brick) brick.hidden = true;
  status.hidden = false;
  status.innerHTML = "";
  const bricksBuilder = mp.bricks();
  window.statusScreenBrickController = await bricksBuilder.create("statusScreen", "statusScreenBrick_container", {
    initialization: { paymentId: String(paymentId) },
    callbacks: {
      onError: (err) => console.warn("[mp-status]", err),
    },
  });
}

async function mountPaymentBrick(session) {
  const MercadoPago = await loadMpSdk();
  const mp = new MercadoPago(session.public_key, { locale: "es-CL" });
  const bricksBuilder = mp.bricks();
  window.paymentBrickController?.unmount?.();
  window.paymentBrickController = await bricksBuilder.create("payment", "paymentBrick_container", {
    initialization: {
      amount: Number(session.amount),
      preferenceId: session.preference_id,
      payer: session.email ? { email: session.email } : undefined,
    },
    customization: {
      paymentMethods: {
        creditCard: "all",
        debitCard: "all",
        prepaidCard: "all",
        mercadoPago: "all",
      },
    },
    callbacks: {
      onReady: () => setPayError(""),
      onError: (err) => {
        console.warn("[mp-brick]", err);
        setPayError(err?.message || "No se pudo mostrar el formulario de pago.");
      },
      onSubmit: ({ selectedPaymentMethod, formData }) =>
        new Promise((resolve, reject) => {
          if (selectedPaymentMethod === "wallet_purchase") {
            resolve();
            return;
          }
          supabase.functions
            .invoke("process-payment", {
              body: {
                payment_id: session.payment_id,
                formData,
                email: session.email,
                name: session.name,
              },
            })
            .then(async ({ data, error }) => {
              if (error || data?.error) {
                setPayError(data?.error || error.message || "No se pudo cobrar.");
                reject();
                return;
              }
              if (data?.payment_id && data.status && data.status !== "pending") {
                try {
                  await showStatusBrick(mp, data.payment_id);
                } catch (err) {
                  console.warn("[mp-status]", err);
                }
                if (data.status === "approved") {
                  clearCart();
                  const params = new URLSearchParams(window.location.search);
                  params.set("pago", "ok");
                  history.replaceState({}, "", `${window.location.pathname}?${params}#agendar`);
                }
              }
              resolve();
            })
            .catch((err) => {
              setPayError(err?.message || "No se pudo cobrar.");
              reject();
            });
        }),
    },
  });
}

export async function startCheckout({ appointmentId, name, email, title, amount } = {}) {
  const items = getCart();
  const total = amount || cartTotal(items);
  if (!items.length && !total) {
    return { ok: false, error: "El carrito está vacío." };
  }
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: "El pago online se activa con Supabase configurado." };
  }

  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: {
      appointment_id: appointmentId || null,
      name: name || "",
      email: email || "",
      title: title || "",
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        amount: Number(item.price || 0),
        zone: item.zone || "",
        book: item.book || "",
      })),
      amount: total,
    },
  });

  if (error) {
    return { ok: false, error: error.message || "No se pudo crear el pago." };
  }
  if (data?.error) {
    return { ok: false, error: data.error };
  }

  if (data?.mode === "bricks" && data.public_key && data.preference_id) {
    if (!openPayOverlay(data.amount || total)) {
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return { ok: true, redirected: true, ...data };
      }
      return { ok: false, error: "No se encontró el formulario de pago." };
    }
    try {
      await mountPaymentBrick({
        public_key: data.public_key,
        preference_id: data.preference_id,
        payment_id: data.payment_id,
        amount: data.amount || total,
        email: data.email || email || "",
        name: data.name || name || "",
      });
      return { ok: true, brick: true, ...data };
    } catch (err) {
      setPayError(err?.message || "No se pudo abrir Mercado Pago.");
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return { ok: true, redirected: true, ...data };
      }
      return { ok: false, error: err?.message || "No se pudo abrir Mercado Pago." };
    }
  }

  if (data?.checkout_url) {
    window.location.href = data.checkout_url;
    return { ok: true, redirected: true, ...data };
  }
  return { ok: Boolean(data?.ok), ...data };
}

export function initCheckoutUi() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-pay-close]")) {
      e.preventDefault();
      closePayOverlay();
      return;
    }
    if (e.target.matches("[data-pay-overlay]")) closePayOverlay();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePayOverlay();
  });
}
