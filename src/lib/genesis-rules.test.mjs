import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const agent = readFileSync(join(root, "supabase/functions/_shared/agent.ts"), "utf8");

function quotedConst(name) {
  const match = agent.match(new RegExp(`const ${name} =\\s*"([^"]+)";`));
  assert.ok(match, `falta ${name}`);
  return match[1];
}

const live = quotedConst("LIVE_AGENDA_SENTENCE");
assert.match(live, /pregunta el motivo primero/);
assert.match(live, /reserva nueva/);
assert.match(live, /no hables de Google Meet/);

const staleBlock = agent.slice(agent.indexOf("const STALE_AGENDA_SENTENCES"), agent.indexOf("export function sanitizeGenesisPrompt"));
const stale = [...staleBlock.matchAll(/"([^"]+)"/g)].map((item) => item[1]);
assert.equal(stale.length, 2);

function sanitizeGenesisPrompt(raw) {
  let text = String(raw || "");
  for (const snippet of stale) {
    if (text.includes(snippet)) text = text.split(snippet).join(live);
  }
  return text;
}

const oldPrompt = `Eres Génesis. ${stale[1]} Si pide consejo clínico profundo, agenda consulta.`;
const cleaned = sanitizeGenesisPrompt(oldPrompt);
assert.equal(cleaned.includes(stale[1]), false);
assert.equal(cleaned.includes(live), true);
assert.equal(sanitizeGenesisPrompt(live), live);
assert.equal(sanitizeGenesisPrompt(""), "");

assert.match(agent, /Orden obligatorio para agendar/);
assert.match(agent, /responde SOLO pidiendo el motivo/);
assert.match(agent, /es siempre una reserva nueva/);
assert.match(agent, /No uses consultar_pago ni consultar_disponibilidad para responder un saludo/);
assert.match(agent, /llama consultar_disponibilidad solo cuando ya sepas el motivo/);

const openai = readFileSync(join(root, "supabase/functions/_shared/openai.ts"), "utf8");
assert.match(openai, /No la uses si solo quieren agendar y todavía falta el motivo/);
assert.match(openai, /No la uses para agendar, saludar o cotizar/);

const mp = readFileSync(join(root, "supabase/functions/_shared/mercadopago.ts"), "utf8");
assert.match(mp, /is\("receipt_sent_at", null\)/);
assert.match(mp, /receipt_sent_at: null/);

assert.equal(agent.includes("coalesceInbound"), false);
assert.equal(agent.includes("await sleep("), false);
assert.match(agent, /export async function unansweredInbound/);

const webhook = readFileSync(join(root, "supabase/functions/whatsapp-webhook/index.ts"), "utf8");
assert.match(webhook, /pendingTurns/);
assert.match(webhook, /unansweredInbound/);
assert.match(webhook, /inboundSkipReasons/);
assert.equal(webhook.includes("waitUntil"), false);
assert.equal(webhook.includes("accepted: true"), false);

const whatsapp = readFileSync(join(root, "supabase/functions/_shared/whatsapp.ts"), "utf8");
assert.match(whatsapp, /export function pickWazendSession/);
assert.match(whatsapp, /api\/sessions\?all=true/);
assert.match(whatsapp, /sessionMissingError/);

function sessionMissingError(error) {
  return /session .*does not exist|session not found|unknown session/i.test(String(error || ""));
}
function pickWazendSession(sessions, preferred) {
  const wanted = String(preferred || "").trim() || "default";
  const list = Array.isArray(sessions) ? sessions : [];
  const working = list.filter((item) =>
    String(item?.status || "").toUpperCase() === "WORKING" && String(item?.name || "").trim()
  );
  const match = working.find((item) => item.name === wanted);
  if (match?.name) return match.name;
  return working[0]?.name || wanted;
}

assert.equal(sessionMissingError('Session "S0260" does not exist'), true);
assert.equal(sessionMissingError("timeout"), false);
assert.equal(pickWazendSession([{ name: "S0260", status: "STOPPED" }, { name: "S0001", status: "WORKING" }], "S0260"), "S0001");
assert.equal(pickWazendSession([{ name: "S0260", status: "WORKING" }], "S0260"), "S0260");
assert.equal(pickWazendSession([], "S0260"), "S0260");

const sql = readFileSync(join(root, "supabase/genesis_intake.sql"), "utf8");
assert.match(sql, /pregunta el motivo primero/);

console.log("genesis-rules ok");
