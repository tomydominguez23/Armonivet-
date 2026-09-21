import { isSupabaseConfigured, requireSupabase } from "../lib/supabase.js";
import { dashboardHref, getSession, safeNextHref } from "./session.js";

const $ = (sel, root = document) => root.querySelector(sel);

function showConfigHint() {
  const hint = $("[data-config-hint]");
  if (hint) hint.hidden = false;
}

async function boot() {
  if (!isSupabaseConfigured) {
    showConfigHint();
    return;
  }
  const session = await getSession();
  if (session) {
    window.location.replace(safeNextHref(new URLSearchParams(window.location.search).get("next")));
  }
}

$("[data-login-form]")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("[data-login-error]");
  const btn = e.currentTarget.querySelector("button[type='submit']");
  errEl.hidden = true;
  if (!isSupabaseConfigured) {
    errEl.textContent = "Supabase no está configurado.";
    errEl.hidden = false;
    showConfigHint();
    return;
  }
  const fd = new FormData(e.currentTarget);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  btn.disabled = true;
  btn.textContent = "Entrando…";
  const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = "No se pudo iniciar sesión. Revisa el correo y la contraseña.";
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Entrar al panel";
    return;
  }
  window.location.replace(safeNextHref(new URLSearchParams(window.location.search).get("next")));
});

boot();
