import { isSupabaseConfigured, supabase } from "./supabase.js";
import { cartTotal, clearCart, formatCLP, getCart } from "./cart.js";

const INTAKE_KEY = "armonivet.intakePending.v1";
const HOLD_KEY = "armonivet.hold.v1";
const INTAKE_FORM =
  "https://docs.google.com/forms/d/e/1FAIpQLSc4AlHaQq3HRlGzBbTLffJDYGjSMW3_UpL2BD2-gdSRW_q6uQ/viewform?embedded=true";

let intakeLocked = false;
let intakeFrameLoads = 0;
let intakeOpenedAt = 0;
let paymentCompleted = false;
let redirectingToMp = false;
let paymentInFlight = false;
let activeSession = null;

function readHold() {
  try {
    const raw = sessionStorage.getItem(HOLD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function rememberHold(hold) {
  paymentCompleted = false;
  const next = { ...(hold || {}), paid: false };
  try {
    sessionStorage.setItem(HOLD_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function markHoldPaid(extra = {}) {
  paymentCompleted = true;
  const next = { ...(readHold() || {}), ...(extra || {}), paid: true };
  try {
    sessionStorage.setItem(HOLD_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function releaseHoldKeepalive(appointmentId) {
  const url = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !key || !appointmentId) return;
  fetch(`${url}/rest/v1/rpc/release_unpaid_hold`, {
    method: "POST",
    keepalive: true,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_appointment_id: appointmentId }),
  }).catch(() => {});
}

export function abandonHold() {
  if (paymentCompleted) return Promise.resolve();
  const hold = readHold();
  try {
    sessionStorage.removeItem(HOLD_KEY);
  } catch {
    /* ignore */
  }
  if (!hold?.appointmentId || hold.paid) return Promise.resolve();
  window.dispatchEvent(new CustomEvent("armonivet:hold-released"));
  if (!supabase) return Promise.resolve();
  return supabase
    .rpc("release_unpaid_hold", { p_appointment_id: hold.appointmentId })
    .then(() => {}, () => {});
}

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

export function closePayOverlay({ release = true } = {}) {
  if (paymentInFlight) {
    setPayError("El pago sigue en proceso. Esperá el resultado antes de cerrar.");
    return;
  }
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
  if (release && !paymentCompleted) abandonHold();
}

function openPayOverlay(amount) {
  const { overlay, lead, brick, status } = overlayEls();
  if (!overlay || !brick) return false;
  setPayError("");
  if (lead) {
    lead.textContent = amount
      ? `Total a pagar: ${formatCLP(amount)}. Si cierras sin pagar, la hora se libera.`
      : "Completa el pago en Armonivet. Si cierras sin pagar, la hora se libera.";
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
            redirectingToMp = true;
            resolve();
            return;
          }
          paymentInFlight = true;
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
              paymentInFlight = false;
              if (error || data?.error) {
                setPayError(data?.error || error.message || "No se pudo cobrar.");
                reject();
                return;
              }
              if (data?.status === "approved") {
                clearCart();
                const paidAmount = Number(data.amount || session.amount || 0);
                showPaidIntake({
                  ...(activeSession || {}),
                  amount: paidAmount || activeSession?.amount,
                  mpId: data.payment_id,
                });
                resolve();
                return;
              }
              if (data?.status === "rejected" || data?.status === "cancelled" || data?.status === "refunded") {
                setPayError("El pago no se aprobó. La hora volvió a quedar libre.");
                await abandonHold();
                resolve();
                return;
              }
              if (data?.payment_id && data.status && data.status !== "pending" && data.status !== "in_process") {
                try {
                  await showStatusBrick(mp, data.payment_id);
                } catch (err) {
                  console.warn("[mp-status]", err);
                }
              }
              resolve();
            })
            .catch((err) => {
              paymentInFlight = false;
              setPayError(err?.message || "No se pudo cobrar.");
              reject();
            });
        }),
    },
  });
}

export async function startCheckout({ appointmentId, name, email, title, amount, when, phone, pet } = {}) {
  const items = getCart();
  const total = amount || cartTotal(items);
  activeSession = {
    appointmentId: appointmentId || null,
    name: name || "",
    email: email || "",
    title: title || "",
    amount: total || 0,
    when: when || "",
    phone: phone || "",
    pet: pet || "",
  };
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
        redirectingToMp = true;
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
        title: title || "",
        when: when || "",
      });
      return { ok: true, brick: true, ...data };
    } catch (err) {
      setPayError(err?.message || "No se pudo abrir Mercado Pago.");
      if (data.checkout_url) {
        redirectingToMp = true;
        window.location.href = data.checkout_url;
        return { ok: true, redirected: true, ...data };
      }
      return { ok: false, error: err?.message || "No se pudo abrir Mercado Pago." };
    }
  }

  if (data?.checkout_url) {
    redirectingToMp = true;
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
    receipt: overlay?.querySelector("[data-receipt]"),
  };
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fillReceipt(receipt) {
  const { receipt: box } = intakeEls();
  if (!box) return;
  const service = String(receipt?.title || receipt?.service || "").trim();
  const when = receipt?.when ? formatWhen(receipt.when) : "";
  const amount = Number(receipt?.amount || 0);
  const has = Boolean(service || when || amount > 0);
  box.hidden = !has;
  const serviceEl = box.querySelector("[data-receipt-service]");
  const whenEl = box.querySelector("[data-receipt-when]");
  const amountEl = box.querySelector("[data-receipt-amount]");
  if (serviceEl) serviceEl.textContent = service || "Consulta";
  if (whenEl) whenEl.textContent = when || "—";
  if (amountEl) amountEl.textContent = amount > 0 ? formatCLP(amount) : "—";
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

export function showPaidIntake(receipt) {
  const { overlay, frame, wait, actions, closeBtn } = intakeEls();
  if (!overlay || !frame) return;
  const details = markHoldPaid(receipt || {});
  closePayOverlay({ release: false });
  fillReceipt(details);
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
    const payOpen = document.querySelector("[data-pay-overlay]");
    if (payOpen && !payOpen.hidden) closePayOverlay();
  });
  window.addEventListener("beforeunload", (e) => {
    if (!intakeLocked) return;
    e.preventDefault();
    e.returnValue = "Es obligatorio completar y enviar el formulario antes de comenzar la primera consulta.";
  });
  window.addEventListener("pagehide", () => {
    if (paymentCompleted || redirectingToMp || paymentInFlight) return;
    const hold = readHold();
    if (!hold?.appointmentId || hold.paid) return;
    try {
      sessionStorage.removeItem(HOLD_KEY);
    } catch {
      /* ignore */
    }
    releaseHoldKeepalive(hold.appointmentId);
  });

  const paid = new URLSearchParams(window.location.search).get("pago");
  let pending = false;
  try {
    pending = localStorage.getItem(INTAKE_KEY) === "1";
  } catch {
    pending = false;
  }
  if (paid === "error") {
    abandonHold();
    return;
  }
  if (paid === "ok" || pending) {
    clearCart();
    showPaidIntake(readHold());
  }
}
