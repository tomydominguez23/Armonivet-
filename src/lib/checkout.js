import { isSupabaseConfigured, supabase } from "./supabase.js";
import { cartTotal, getCart } from "./cart.js";

export async function startCheckout({ appointmentId, name, email } = {}) {
  const items = getCart();
  if (!items.length) {
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
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        amount: Number(item.price || 0),
        zone: item.zone || "",
        book: item.book || "",
      })),
      amount: cartTotal(items),
    },
  });

  if (error) {
    return { ok: false, error: error.message || "No se pudo crear el pago." };
  }
  if (data?.checkout_url) {
    window.location.href = data.checkout_url;
    return { ok: true, redirected: true, ...data };
  }
  return { ok: Boolean(data?.ok), ...data };
}
