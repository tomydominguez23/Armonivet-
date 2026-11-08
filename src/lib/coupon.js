export function normalizeCouponCode(raw) {
  return String(raw || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function isControlService(service) {
  return String(service || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("control");
}

/** Misma regla que quote_coupon en supabase/coupons.sql. */
export function priceWithCoupon(amount, coupon, service) {
  const base = Math.round(Number(amount) || 0);
  if (!coupon) return { ok: false, error: "Ese cupón no está disponible." };
  if (base < 1000) return { ok: false, error: "El monto es demasiado bajo para un cupón." };
  const appliesTo = coupon.applies_to === "all" ? "all" : "control";
  if (appliesTo === "control" && !isControlService(service)) {
    return { ok: false, error: "Este cupón solo aplica al siguiente control." };
  }
  let discount = 0;
  if (coupon.percent != null && coupon.percent !== "") {
    discount = Math.round((base * Number(coupon.percent)) / 100);
  } else {
    discount = Math.round(Number(coupon.amount_off) || 0);
  }
  if (discount < 1) return { ok: false, error: "Este cupón no tiene un descuento." };
  if (base - discount < 1000) discount = base - 1000;
  if (discount < 1) return { ok: false, error: "El monto es demasiado bajo para un cupón." };
  return { ok: true, discount, amount: base - discount };
}

export function reviewPitch({ code = "RESENA", percent = 5, appliesTo = "control", amountOff = null } = {}) {
  const off = percent ? `${percent}%` : "";
  const fixed = !percent && amountOff ? `${Number(amountOff).toLocaleString("es-CL")} pesos` : "";
  const discount = off || fixed || "un descuento";
  const where = appliesTo === "all" ? "en tu próxima hora" : "en el siguiente control";
  return `Si dejas una reseña positiva en Google, tienes ${discount} de descuento ${where}. Al pagar, escribe el código ${normalizeCouponCode(code) || "RESENA"}.`;
}

export function uniqueReviewCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (const byte of bytes) tail += alphabet[byte % alphabet.length];
  return `RESENA-${tail}`;
}
