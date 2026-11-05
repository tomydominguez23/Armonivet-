import assert from "node:assert/strict";
import { formatReceiptWhen, mergeReceipt, paymentIdFromLocation, receiptNeedsServer } from "./receipt.js";

const payA = "11111111-1111-4111-8111-111111111111";
const payB = "22222222-2222-4222-8222-222222222222";
const appt = "33333333-3333-4333-8333-333333333333";

const local = {
  paymentId: payA,
  appointmentId: appt,
  title: "Consulta etológica",
  when: "2026-11-04T18:00:00.000Z",
  amount: 65000,
  name: "María",
};

assert.equal(paymentIdFromLocation(`?pago=ok&pago_id=${payA}`, "#agendar"), payA);
assert.equal(
  paymentIdFromLocation("?pago=ok", `#agendar&external_reference=${payB}&status=approved`),
  payB,
);
assert.equal(paymentIdFromLocation("?pago=ok&external_reference=no-es-uuid", ""), "");

const when = formatReceiptWhen("2026-11-04T18:00:00.000Z");
assert.match(when, /4/);
assert.match(when, /noviembre/i);
assert.match(when, /15:00/);

const same = mergeReceipt(local, null, null, payA);
assert.equal(same.title, "Consulta etológica");
assert.equal(same.when, local.when);
assert.equal(same.amount, 65000);
assert.equal(receiptNeedsServer(local, null, payA), false);

const redirect = mergeReceipt(
  { title: local.title, when: local.when, amount: local.amount, name: "María" },
  null,
  null,
  "",
);
assert.equal(redirect.title, local.title);
assert.equal(redirect.amount, 65000);
assert.equal(receiptNeedsServer(redirect, null, ""), false);

const wiped = mergeReceipt(
  null,
  null,
  { ok: true, service: "Control online", when: "2026-11-05T13:00:00.000Z", amount: 38000, appointment_id: appt },
  payB,
);
assert.equal(wiped.title, "Control online");
assert.equal(wiped.amount, 38000);
assert.equal(wiped.when, "2026-11-05T13:00:00.000Z");
assert.equal(receiptNeedsServer(null, null, payB), true);

const stale = mergeReceipt(
  local,
  null,
  { ok: true, service: "Control online", when: "2026-11-05T13:00:00.000Z", amount: 38000, appointment_id: appt },
  payB,
);
assert.equal(stale.title, "Control online");
assert.equal(stale.amount, 38000);
assert.equal(stale.name, undefined);

const staleOffline = mergeReceipt(local, null, null, payB);
assert.equal(staleOffline.title, "");
assert.equal(staleOffline.amount, 0);

const partial = mergeReceipt(
  { paymentId: payA, title: "Consulta etológica", name: "María" },
  null,
  { ok: true, service: "Consulta etológica", when: local.when, amount: 65000, appointment_id: appt },
  payA,
);
assert.equal(partial.when, local.when);
assert.equal(partial.amount, 65000);
assert.equal(partial.name, "María");

console.log("receipt ok");
