import { isSupabaseConfigured, supabase } from "./supabase.js";
import { cartTotal, clearCart, formatCLP, getCart } from "./cart.js";

const INTAKE_KEY = "armonivet.intakePending.v1";
const HOLD_KEY = "armonivet.hold.v1";

let intakeLocked = false;
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

export async function startCheckout({ appointmentId, name, email, title, amount, when, phone, pet, petType } = {}) {
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
    petType: petType || "",
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
    form: overlay?.querySelector("[data-intake-form]"),
    thanks: overlay?.querySelector("[data-intake-thanks]"),
    thanksText: overlay?.querySelector("[data-intake-thanks-text]"),
    error: overlay?.querySelector("[data-intake-error]"),
    kicker: overlay?.querySelector("#intake-dialog-title"),
    ok: overlay?.querySelector(".intake-ok"),
    must: overlay?.querySelector(".intake-must"),
    wait: overlay?.querySelector("[data-intake-wait]"),
    actions: overlay?.querySelector("[data-intake-actions]"),
    closeBtn: overlay?.querySelector("[data-intake-close]"),
    receipt: overlay?.querySelector("[data-receipt]"),
  };
}

function intakePending() {
  try {
    return localStorage.getItem(INTAKE_KEY) === "1";
  } catch {
    return false;
  }
}

function hashIsFormulario() {
  return String(window.location.hash || "").replace(/^#/, "") === "formulario";
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

function revealIntakeForm() {
  const { form, thanks, error } = intakeEls();
  if (form) form.hidden = false;
  if (thanks) thanks.hidden = true;
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
}

function prefillIntake() {
  const hold = readHold() || {};
  const { form } = intakeEls();
  if (!form) return;
  const write = (name, value) => {
    const field = form.elements.namedItem(name);
    if (!field || !value) return;
    if (typeof field.value === "string") {
      if (!field.value) field.value = value;
      return;
    }
    const options = Array.from(field);
    if (options.some((option) => option.checked)) return;
    const match = options.find((option) => option.value === value);
    if (match) match.checked = true;
  };
  write("tutor_name", hold.name);
  write("email", hold.email);
  write("phone", hold.phone);
  write("pet_name", hold.pet);
  const species = hold.petType === "perro" ? "canino" : hold.petType === "gato" ? "felino" : "";
  write("species", species);
  syncPreviousWork();
}

function syncPreviousWork() {
  const { form } = intakeEls();
  if (!form) return;
  const chosen = form.querySelector('input[name="previous_ethologist"]:checked')?.value;
  const wrap = form.querySelector("[data-previous-work]");
  const field = form.querySelector('[name="previous_work"]');
  const show = chosen === "si";
  if (wrap) wrap.hidden = !show;
  if (field) field.required = show;
}

function setIntakeError(message) {
  const { error } = intakeEls();
  if (!error) return;
  error.hidden = !message;
  error.textContent = message || "";
}

function applyIntakeChrome({ locked, paid }) {
  const { overlay, kicker, ok, must, wait, closeBtn, actions } = intakeEls();
  if (!overlay) return;
  intakeLocked = locked;
  if (kicker) kicker.textContent = paid ? "Pago aprobado" : "Formulario previo";
  if (ok) ok.hidden = !paid;
  if (must) must.hidden = !locked;
  if (wait) wait.hidden = !locked;
  if (closeBtn) closeBtn.hidden = locked;
  if (actions) actions.hidden = true;
  overlay.hidden = false;
  document.body.classList.add("intake-open");
}

function readAnswers(form) {
  const value = (name) => String(new FormData(form).get(name) || "").trim();
  return {
    tutor_name: value("tutor_name"),
    email: value("email"),
    phone: value("phone"),
    pet_name: value("pet_name"),
    species: value("species"),
    patient_profile: value("patient_profile"),
    neutered: value("neutered"),
    behavior_problem: value("behavior_problem"),
    behavior_context: value("behavior_context"),
    diagnosed: value("diagnosed"),
    medications: value("medications"),
    previous_vet: value("previous_vet"),
    household: value("household"),
    routine: value("routine"),
    consultation_reason: value("consultation_reason"),
    extra: value("extra"),
    previous_ethologist: value("previous_ethologist"),
    previous_work: value("previous_work"),
  };
}

function appointmentIdFromHold() {
  const raw = String(readHold()?.appointmentId || "");
  return /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

async function saveIntakeFallback(answers, appointmentId) {
  const previous = answers.previous_ethologist;
  const row = {
    email: answers.email,
    patient_name: answers.pet_name,
    tutor_info: answers.tutor_name,
    patient_data: answers.patient_profile,
    is_neutered: answers.neutered,
    diagnosed_conditions: answers.diagnosed,
    household_members: answers.household,
    consultation_reason: answers.consultation_reason,
    behavior_timing: answers.behavior_context,
    previous_ethologist: previous === "si" ? "Sí" : previous === "no" ? "No" : previous,
    attempted_solutions: answers.previous_work || answers.behavior_problem,
    last_vet_visit: answers.previous_vet,
    housing_info: answers.routine,
    life_changes: answers.extra,
    completed: true,
    raw_answers: answers,
  };
  let { error } = await supabase.from("intake_forms").insert({ ...row, appointment_id: appointmentId });
  if (error && /appointment_id/i.test(error.message || "")) {
    ({ error } = await supabase.from("intake_forms").insert(row));
  }
  if (error) throw error;
}

async function submitIntake(event) {
  event.preventDefault();
  const { form } = intakeEls();
  if (!form) return;
  syncPreviousWork();
  if (!form.reportValidity()) return;
  const answers = readAnswers(form);
  if (answers.previous_ethologist === "si" && !answers.previous_work) {
    setIntakeError("Cuéntanos qué han trabajado con otro etólogo o entrenador.");
    return;
  }
  if (!isSupabaseConfigured || !supabase) {
    setIntakeError("No pudimos guardar el formulario porque la ficha no está conectada.");
    return;
  }
  const submit = form.querySelector("[type='submit']");
  if (submit) submit.disabled = true;
  setIntakeError("");
  const appointmentId = appointmentIdFromHold();
  let partial = false;
  try {
    const { error } = await supabase.rpc("submit_preconsult_form", {
      p_answers: answers,
      p_appointment_id: appointmentId,
    });
    if (error) {
      const missing = /could not find the function|PGRST202|schema cache|submit_preconsult_form/i.test(error.message || "");
      if (!missing) throw error;
      await saveIntakeFallback(answers, appointmentId);
      partial = true;
    }
  } catch (err) {
    if (submit) submit.disabled = false;
    setIntakeError(err?.message || "No se pudo guardar el formulario. Inténtalo de nuevo.");
    return;
  }
  if (submit) submit.disabled = false;
  form.reset();
  syncPreviousWork();
  const { form: formEl, thanks, thanksText } = intakeEls();
  if (formEl) formEl.hidden = true;
  if (thanks) thanks.hidden = false;
  if (thanksText) {
    thanksText.textContent = partial
      ? "Guardamos el cuestionario. Para que también quede en la ficha del cliente hay que ejecutar el SQL del formulario en Supabase."
      : "Guardamos los antecedentes en la ficha de tu compañero. Génesis también puede usarlos para preparar la consulta.";
  }
  markIntakeSent();
}

export function closePaidIntake() {
  if (intakeLocked) return;
  const { overlay } = intakeEls();
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("intake-open");
}

export function openIntakeForm() {
  if (!document.querySelector("[data-intake-overlay]")) return;
  if (intakePending()) {
    showPaidIntake(readHold());
    return;
  }
  revealIntakeForm();
  prefillIntake();
  applyIntakeChrome({ locked: false, paid: false });
}

export function showPaidIntake(receipt) {
  if (!document.querySelector("[data-intake-overlay]")) return;
  const details = markHoldPaid(receipt || {});
  closePayOverlay({ release: false });
  fillReceipt(details);
  revealIntakeForm();
  prefillIntake();
  try {
    localStorage.setItem(INTAKE_KEY, "1");
  } catch {
    /* ignore */
  }
  applyIntakeChrome({ locked: true, paid: true });
}

function openFormularioHash() {
  if (!hashIsFormulario()) return;
  if (intakePending()) showPaidIntake(readHold());
  else openIntakeForm();
}

export function initCheckoutUi() {
  const { form } = intakeEls();
  form?.addEventListener("change", (event) => {
    if (event.target?.name === "previous_ethologist") syncPreviousWork();
  });
  form?.addEventListener("submit", (event) => {
    submitIntake(event).catch((err) => setIntakeError(err?.message || "No se pudo guardar el formulario."));
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-pay-close]")) {
      e.preventDefault();
      closePayOverlay();
      return;
    }
    if (e.target.matches("[data-pay-overlay]")) closePayOverlay();
    if (e.target.closest("[data-open-intake]")) {
      e.preventDefault();
      openIntakeForm();
      return;
    }
    const formLink = e.target.closest('a[href="#formulario"], a[href$="#formulario"]');
    if (formLink) {
      let url;
      try {
        url = new URL(formLink.href, window.location.href);
      } catch {
        url = null;
      }
      const here = window.location.pathname.replace(/\/index\.html$/i, "/");
      const there = url?.pathname.replace(/\/index\.html$/i, "/") || "";
      if (url && url.origin === window.location.origin && here === there) {
        e.preventDefault();
        if (window.location.hash !== "#formulario") history.pushState(null, "", "#formulario");
        openFormularioHash();
        return;
      }
    }
    if (e.target.closest("[data-intake-done], [data-intake-close]")) {
      e.preventDefault();
      closePaidIntake();
    }
  });
  window.addEventListener("hashchange", openFormularioHash);
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
    return;
  }
  if (hashIsFormulario()) openIntakeForm();
}
