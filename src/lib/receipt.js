const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value) {
  return String(value || "").trim();
}

function amountOf(value) {
  const amount = Math.round(Number(value || 0));
  return amount > 0 ? amount : 0;
}

export function hasReceiptDetails(source) {
  if (!source) return false;
  return Boolean(clean(source.title || source.service) && source.when && amountOf(source.amount) > 0);
}

/** Mercado Pago a veces deja external_reference en la query y a veces después del #. */
export function paymentIdFromLocation(search = "", hash = "") {
  const query = String(search || "").replace(/^\?/, "");
  const fromSearch = new URLSearchParams(query);
  const hashBody = String(hash || "").replace(/^#/, "");
  const cut = hashBody.includes("?") ? hashBody.indexOf("?") : hashBody.indexOf("&");
  const hashQuery = cut >= 0 ? hashBody.slice(cut + 1) : "";
  const fromHash = new URLSearchParams(hashQuery);
  const raw =
    fromSearch.get("external_reference") ||
    fromSearch.get("pago_id") ||
    fromHash.get("external_reference") ||
    fromHash.get("pago_id") ||
    "";
  return UUID_RE.test(raw) ? raw : "";
}

export function formatReceiptWhen(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function identityFrom(source) {
  return {
    name: clean(source?.name),
    email: clean(source?.email),
    phone: clean(source?.phone),
    pet: clean(source?.pet),
    petType: clean(source?.petType),
  };
}

/**
 * Junta lo guardado en el navegador, lo que todavía está en memoria
 * y, si hace falta, el comprobante que devuelve el servidor.
 * Si la vuelta de Mercado Pago trae otro pago, no se reutiliza la reserva anterior.
 */
export function mergeReceipt(stored, incoming, server, urlPaymentId) {
  const base = { ...(stored || {}), ...(incoming || {}) };
  const serverOk = Boolean(server?.ok);
  const conflicts = Boolean(urlPaymentId && base.paymentId && urlPaymentId !== base.paymentId);
  const unconfirmed = Boolean(urlPaymentId && !base.paymentId);
  const paymentId = urlPaymentId || base.paymentId || "";
  const useServer = serverOk && (conflicts || unconfirmed || !hasReceiptDetails(base));

  if (useServer) {
    const title = clean(server.service);
    return {
      ...(conflicts ? {} : identityFrom(base)),
      paymentId,
      appointmentId: server.appointment_id || "",
      title,
      service: title,
      when: server.when || "",
      amount: amountOf(server.amount),
      paid: true,
    };
  }

  if (conflicts) {
    return {
      paymentId,
      appointmentId: "",
      title: "",
      service: "",
      when: "",
      amount: 0,
      paid: true,
    };
  }

  const title = clean(base.title || base.service);
  return {
    ...identityFrom(base),
    paymentId,
    appointmentId: base.appointmentId || "",
    title,
    service: title,
    when: base.when || "",
    amount: amountOf(base.amount),
    paid: true,
  };
}

export function receiptNeedsServer(stored, incoming, urlPaymentId) {
  const base = { ...(stored || {}), ...(incoming || {}) };
  const paymentId = urlPaymentId || base.paymentId || "";
  if (!paymentId) return false;
  if (urlPaymentId && base.paymentId && urlPaymentId !== base.paymentId) return true;
  if (urlPaymentId && !base.paymentId) return true;
  return !hasReceiptDetails(base);
}
