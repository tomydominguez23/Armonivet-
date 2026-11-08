import assert from "node:assert/strict";
import { isControlService, normalizeCouponCode, priceWithCoupon, reviewPitch } from "./coupon.js";

assert.equal(normalizeCouponCode("  reseña 5 "), "RESENA5");
assert.equal(normalizeCouponCode("resena"), "RESENA");
assert.equal(isControlService("Control remoto"), true);
assert.equal(isControlService("Consulta presencial"), false);

const five = priceWithCoupon(50000, { percent: 5, applies_to: "control" }, "Control presencial");
assert.equal(five.ok, true);
assert.equal(five.discount, 2500);
assert.equal(five.amount, 47500);

const online = priceWithCoupon(38000, { percent: 5, applies_to: "control" }, "Control remoto");
assert.equal(online.discount, 1900);
assert.equal(online.amount, 36100);

const wrong = priceWithCoupon(50000, { percent: 5, applies_to: "control" }, "Consulta remota");
assert.equal(wrong.ok, false);

const capped = priceWithCoupon(2000, { percent: 90, applies_to: "all" }, "Control presencial");
assert.equal(capped.amount, 1000);
assert.equal(capped.discount, 1000);

const fixed = priceWithCoupon(50000, { amount_off: 5000, applies_to: "control" }, "Control online");
assert.equal(fixed.amount, 45000);

assert.match(reviewPitch({ code: "resena", percent: 5 }), /5%/);
assert.match(reviewPitch({ code: "resena", percent: 5 }), /RESENA/);
assert.match(reviewPitch({ code: "resena", percent: 5 }), /siguiente control/);

console.log("coupon ok");
