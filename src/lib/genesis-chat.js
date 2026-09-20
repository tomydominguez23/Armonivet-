import { isSupabaseConfigured, supabase } from "./supabase.js";

const CALENDLY_URL = "https://calendly.com/armonivet";

const STEPS = [
  { key: "pet_type", msg: "¡Hola! Soy Genesis, asistente de Armonivet 🐾 Te ayudaré a preparar tu consulta. ¿Tienes perro o gato?", buttons: ["Perro", "Gato", "Otro"] },
  { key: "pet_name", msg: "¿Cuál es el nombre de tu mascota?" },
  { key: "pet_age", msg: () => `¿Qué edad tiene ${a().pet_name}?` },
  { key: "tutor_name", msg: "¿Cuál es tu nombre completo?" },
  { key: "email", msg: "¿Tu correo electrónico?", type: "email" },
  { key: "phone", msg: "¿Tu número de teléfono (con código de área)?" },
  { key: "address", msg: "¿Dirección exacta (Calle, n°, dpto)?" },
  { key: "tutor_info", msg: "Datos del tutor: edad, profesión u ocupación" },
  { key: "patient_data", msg: () => `Datos de ${a().pet_name}: Raza, Tamaño y Peso aproximado` },
  { key: "pet_purpose", msg: () => `¿Cuál es el motivo de la tenencia de ${a().pet_name}?` },
  { key: "is_neutered", msg: () => `¿${a().pet_name} está esterilizado/a o castrado/a? ¿Cuándo fue la cirugía?`, buttons: ["Sí", "No"] },
  { key: "last_vet_visit", msg: "¿Cuándo fue la última visita al veterinario y cuál fue el motivo?" },
  { key: "vaccines_status", msg: "¿Tiene vacunas y desparasitaciones al día?", buttons: ["Sí", "No", "No sé"] },
  { key: "diagnosed_conditions", msg: "¿Está diagnosticado/a con alguna enfermedad? ¿Tiene tratamiento actual?" },
  { key: "household_members", msg: "¿Quiénes componen el núcleo familiar? (niños, más animales, etc.)" },
  { key: "pet_history", msg: () => `Cuéntame brevemente la historia de ${a().pet_name}: ¿De dónde lo sacaron? ¿Qué edad tenía? ¿Había pertenecido a alguien?` },
  { key: "consultation_reason", msg: "¿Cuál es el motivo de la consulta etológica?" },
  { key: "behavior_timing", msg: "¿Cuándo ocurren estas conductas? (frecuencia, momento del día)" },
  { key: "previous_ethologist", msg: "¿Ha consultado antes con otro etólogo o entrenador?", buttons: ["Sí", "No"] },
  { key: "known_commands", msg: '¿Conoce órdenes de entrenamiento? ¿Cuáles? (si no, conteste "no")' },
  { key: "attempted_solutions", msg: "¿Qué han hecho para intentar solucionar el problema?" },
  { key: "life_changes", msg: () => `¿Hubo algún cambio importante en la vida de ${a().pet_name}?` },
  { key: "housing_info", msg: () => `¿En qué tipo de vivienda vive y dónde pasa más tiempo ${a().pet_name}?` },
  { key: "pandemic_adoption", msg: "¿Fue adoptado/a en pandemia?", buttons: ["Sí", "Antes de la Pandemia", "Después de la Pandemia"] },
];

let state;
const STORAGE_KEY = "genesis_chat_state";

function a() { return state.answers; }

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveState() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function resetState() {
  state = { sessionId: crypto.randomUUID(), step: 0, answers: {}, messages: [], done: false };
}

function injectStyles() {
  if (document.getElementById("genesis-chat-css")) return;
  const style = document.createElement("style");
  style.id = "genesis-chat-css";
  style.textContent = `
.gc-fab{position:fixed;right:1.1rem;bottom:1.1rem;z-index:9999;width:56px;height:56px;border-radius:50%;background:#25d366;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 4px 16px rgba(37,211,102,.4);transition:transform .25s cubic-bezier(.4,0,.2,1),opacity .2s}
.gc-fab:hover{transform:translateY(-2px) scale(1.05)}
.gc-fab svg{width:28px;height:28px;fill:currentColor}
.gc-panel{position:fixed;right:1.1rem;bottom:5rem;z-index:9999;width:350px;max-height:520px;background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;transform:scale(.85) translateY(20px);opacity:0;pointer-events:none;transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .25s}
.gc-panel.is-open{transform:scale(1) translateY(0);opacity:1;pointer-events:auto}
.gc-header{background:linear-gradient(135deg,#25d366,#128c4e);color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.gc-header-title{font-weight:700;font-size:.95rem}
.gc-close{background:none;border:none;color:#fff;cursor:pointer;font-size:1.3rem;line-height:1;padding:0 4px;opacity:.85;transition:opacity .15s}
.gc-close:hover{opacity:1}
.gc-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;scroll-behavior:smooth}
.gc-bubble{max-width:82%;padding:10px 14px;border-radius:14px;font-size:.88rem;line-height:1.45;word-break:break-word;animation:gc-pop .25s ease}
.gc-bot{align-self:flex-start;background:#f0f0f0;color:#1a1a1a;border-bottom-left-radius:4px}
.gc-user{align-self:flex-end;background:#25d366;color:#fff;border-bottom-right-radius:4px}
.gc-options{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;animation:gc-pop .25s ease}
.gc-opt-btn{background:#fff;border:1.5px solid #25d366;color:#128c4e;border-radius:20px;padding:6px 16px;font-size:.84rem;font-weight:600;cursor:pointer;transition:background .15s,color .15s}
.gc-opt-btn:hover{background:#25d366;color:#fff}
.gc-input-row{display:flex;gap:0;border-top:1px solid #e8e8e8;flex-shrink:0}
.gc-input{flex:1;border:none;padding:12px 14px;font-size:.9rem;outline:none;font-family:inherit}
.gc-send{background:#25d366;border:none;color:#fff;padding:0 16px;cursor:pointer;font-size:1.1rem;transition:background .15s}
.gc-send:hover{background:#128c4e}
.gc-send:disabled{background:#ccc;cursor:default}
.gc-typing{display:flex;gap:4px;align-self:flex-start;padding:8px 14px}
.gc-typing span{width:7px;height:7px;background:#aaa;border-radius:50%;animation:gc-bounce .6s infinite alternate}
.gc-typing span:nth-child(2){animation-delay:.15s}
.gc-typing span:nth-child(3){animation-delay:.3s}
.gc-link-btn{display:inline-block;background:#25d366;color:#fff;text-decoration:none;padding:10px 22px;border-radius:24px;font-weight:700;font-size:.88rem;margin-top:8px;text-align:center;transition:background .15s}
.gc-link-btn:hover{background:#128c4e}
@keyframes gc-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes gc-bounce{to{transform:translateY(-5px);opacity:.5}}
@media(max-width:480px){.gc-panel{right:0;bottom:0;width:100%;max-height:100dvh;border-radius:0}.gc-fab{right:.75rem;bottom:.75rem}}
  `;
  document.head.appendChild(style);
}

function createDOM() {
  const wrap = document.createElement("div");
  wrap.id = "genesis-chat";
  wrap.innerHTML = `
<button class="gc-fab" aria-label="Abrir chat Genesis" title="Chat Genesis">
  <svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16z"/><path d="M7 9h10v2H7zm0-3h10v2H7zm0 6h7v2H7z"/></svg>
</button>
<div class="gc-panel">
  <div class="gc-header">
    <span class="gc-header-title">Genesis · Armonivet</span>
    <button class="gc-close" aria-label="Cerrar chat">&times;</button>
  </div>
  <div class="gc-messages"></div>
  <div class="gc-input-row">
    <input class="gc-input" type="text" placeholder="Escribe tu respuesta..." autocomplete="off"/>
    <button class="gc-send" aria-label="Enviar">&#10148;</button>
  </div>
</div>`;
  document.body.appendChild(wrap);
  return wrap;
}

function scrollBottom(el) {
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function addBubble(container, text, cls) {
  const div = document.createElement("div");
  div.className = `gc-bubble ${cls}`;
  div.innerHTML = text;
  container.appendChild(div);
  scrollBottom(container);
}

function addOptions(container, options, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "gc-options";
  options.forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gc-opt-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".gc-opt-btn").forEach((b) => { b.disabled = true; });
      onPick(label);
    });
    wrap.appendChild(btn);
  });
  container.appendChild(wrap);
  scrollBottom(container);
}

function showTyping(container) {
  const el = document.createElement("div");
  el.className = "gc-typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  container.appendChild(el);
  scrollBottom(container);
  return el;
}

async function submitToSupabase() {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    await supabase.rpc("submit_genesis_chat", {
      p_session_id: state.sessionId,
      p_answers: state.answers,
    });
  } catch (err) {
    console.warn("[genesis-chat] submit error", err);
  }
}

function renderFinal(container) {
  addBubble(container,
    `¡Perfecto! Ya tengo toda la información. La Dra. Bárbara revisará tus datos antes de la consulta. 🎉<br>Para agendar tu hora:<br><a class="gc-link-btn" href="${CALENDLY_URL}" target="_blank" rel="noopener noreferrer">📅 Agendar en Calendly</a>`,
    "gc-bot");
}

function replayMessages(container) {
  state.messages.forEach((m) => {
    if (m.type === "bot") addBubble(container, m.text, "gc-bot");
    else if (m.type === "user") addBubble(container, m.text, "gc-user");
  });
  if (state.done) {
    renderFinal(container);
  } else {
    const step = STEPS[state.step];
    if (step?.buttons) addOptions(container, step.buttons, () => {});
  }
}

export default function initGenesisChat() {
  const existingFab = document.querySelector(".whatsapp-fab");
  if (existingFab) existingFab.style.display = "none";

  injectStyles();
  const root = createDOM();
  const fab = root.querySelector(".gc-fab");
  const panel = root.querySelector(".gc-panel");
  const closeBtn = root.querySelector(".gc-close");
  const messagesEl = root.querySelector(".gc-messages");
  const input = root.querySelector(".gc-input");
  const sendBtn = root.querySelector(".gc-send");
  let isOpen = false;
  let processing = false;

  const saved = loadState();
  if (saved) {
    state = saved;
    replayMessages(messagesEl);
  } else {
    resetState();
  }

  function togglePanel(open) {
    isOpen = open;
    panel.classList.toggle("is-open", open);
    if (open && state.messages.length === 0) askStep();
    if (open) { input.focus(); scrollBottom(messagesEl); }
  }

  function pushMsg(type, text) {
    state.messages.push({ type, text });
    saveState();
  }

  async function askStep() {
    if (state.step >= STEPS.length) return;
    const step = STEPS[state.step];
    const text = typeof step.msg === "function" ? step.msg() : step.msg;
    const typing = showTyping(messagesEl);
    await delay(600);
    typing.remove();
    addBubble(messagesEl, text, "gc-bot");
    pushMsg("bot", text);
    if (step.buttons) {
      addOptions(messagesEl, step.buttons, (val) => handleAnswer(val));
      input.closest(".gc-input-row").style.display = "none";
    } else {
      input.closest(".gc-input-row").style.display = "";
      input.type = step.type || "text";
      input.focus();
    }
  }

  async function handleAnswer(value) {
    processing = true;
    addBubble(messagesEl, value, "gc-user");
    pushMsg("user", value);
    const step = STEPS[state.step];
    state.answers[step.key] = value;
    state.step++;
    saveState();

    if (state.step >= STEPS.length) {
      state.done = true;
      saveState();
      const typing = showTyping(messagesEl);
      await delay(800);
      typing.remove();
      renderFinal(messagesEl);
      pushMsg("bot", "__final__");
      input.closest(".gc-input-row").style.display = "none";
      submitToSupabase();
    } else {
      await askStep();
    }
    processing = false;
  }

  function onSend() {
    if (processing) return;
    const val = input.value.trim();
    if (!val) return;
    input.value = "";
    handleAnswer(val);
  }

  fab.addEventListener("click", () => togglePanel(!isOpen));
  closeBtn.addEventListener("click", () => togglePanel(false));
  sendBtn.addEventListener("click", onSend);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onSend(); } });
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
