import { isSupabaseConfigured, supabase } from "./supabase.js";
import { cartTotal, clearCart, getCart } from "./cart.js";

const INTAKE_KEY = "armonivet.intakePending.v1";
const INTAKE_FORM =
  "https://docs.google.com/forms/d/e/1FAIpQLSc4AlHaQq3HRlGzBbTLffJDYGjSMW3_UpL2BD2-gdSRW_q6uQ/viewform?embedded=true";

let intakeLocked = false;
let intakeFrameLoads = 0;
let intakeOpenedAt = 0;

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
              if (data?.status === "approved") {
                clearCart();
                showPaidIntake();
                resolve();
                return;
              }
              if (data?.payment_id && data.status && data.status !== "pending") {
                try {
                  await showStatusBrick(mp, data.payment_id);
                } catch (err) {
                  console.warn("[mp-status]", err);
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

function intakeEls() {
  const overlay = document.querySelector("[data-intake-overlay]");
  return {
    overlay,
    frame: overlay?.querySelector("[data-intake-frame]"),
    wait: overlay?.querySelector("[data-intake-wait]"),
    actions: overlay?.querySelector("[data-intake-actions]"),
    closeBtn: overlay?.querySelector("[data-intake-close]"),
  };
}

function markIntakeSent() {
  const { wait, actions, closeBtn } = intakeEls();
  intakeLocked = false;
  try {
    localStorage.removeItem(INTAKE_KEY);
  } catch {
    /* ignore */
  }
  if (wait) wait.hidden = true;
  if (actions) actions.hidden = false;
  if (closeBtn) closeBtn.hidden = false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("pago")) {
    params.delete("pago");
    const query = params.toString();
    history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}#agendar`);
  }
}

export function closePaidIntake() {
  if (intakeLocked) return;
  const { overlay, frame } = intakeEls();
  if (frame) frame.src = "about:blank";
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("intake-open");
}

export function showPaidIntake() {
  const { overlay, frame, wait, actions, closeBtn } = intakeEls();
  if (!overlay || !frame) return;
  closePayOverlay();
  intakeLocked = true;
  intakeFrameLoads = 0;
  intakeOpenedAt = Date.now();
  try {
    localStorage.setItem(INTAKE_KEY, "1");
  } catch {
    /* ignore */
  }
  if (wait) wait.hidden = false;
  if (actions) actions.hidden = true;
  if (closeBtn) closeBtn.hidden = true;
  overlay.hidden = false;
  document.body.classList.add("intake-open");
  frame.src = INTAKE_FORM;
}

export function initCheckoutUi() {
  const { frame } = intakeEls();
  frame?.addEventListener("load", () => {
    if (frame.getAttribute("src") === "about:blank") return;
    intakeFrameLoads += 1;
    if (intakeFrameLoads >= 2 && Date.now() - intakeOpenedAt > 1500) markIntakeSent();
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-pay-close]")) {
      e.preventDefault();
      closePayOverlay();
      return;
    }
    if (e.target.matches("[data-pay-overlay]")) closePayOverlay();
    if (e.target.closest("[data-intake-done], [data-intake-close]")) {
      e.preventDefault();
      closePaidIntake();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (intakeLocked) {
      e.preventDefault();
      return;
    }
    closePaidIntake();
    closePayOverlay();
  });
  window.addEventListener("beforeunload", (e) => {
    if (!intakeLocked) return;
    e.preventDefault();
    e.returnValue = "Todavía falta enviar el formulario obligatorio.";
  });

  const paid = new URLSearchParams(window.location.search).get("pago");
  let pending = false;
  try {
    pending = localStorage.getItem(INTAKE_KEY) === "1";
  } catch {
    pending = false;
  }
  if (paid === "ok" || pending) {
    clearCart();
    showPaidIntake();
  }
}
