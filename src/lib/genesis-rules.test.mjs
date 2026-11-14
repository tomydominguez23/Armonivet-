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
    if (text.includes(snippet)) text = text.replaceAll(snippet, live);
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

const webhook = readFileSync(join(root, "supabase/functions/whatsapp-webhook/index.ts"), "utf8");
assert.match(webhook, /pendingTurns/);

const sql = readFileSync(join(root, "supabase/genesis_intake.sql"), "utf8");
assert.match(sql, /pregunta el motivo primero/);

console.log("genesis-rules ok");
